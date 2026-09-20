// 匹配引擎：同一条正则的三套执行方式，对任意输入必须给出完全一致的接受/拒绝结论。
//
//  1. dfaMatch      —— 跑最小化前 DFA：当前状态唯一（确定性）。
//  2. nfaMatch      —— 集合模拟 NFA：当前是“所有可能同时活跃的状态集合”，无回溯。
//  3. backtrackMatch —— 递归下降回溯（Perl 风格）：按贪婪/懒惰顺序试路，
//                       失败时回退并记录红色回溯帧；统计转移数与回溯次数。
//
// 所有引擎都是全串匹配（正则隐式 ^…$ 语义），与自动机接受定义一致。
// frames 供前端逐帧播放；cap 为帧数保护，超出即截断并报告“疑似灾难性回溯”。

import { contains, intersect } from './charsets.js';
import { dfaTarget } from './dfa.js';

const DEFAULT_CAP = 20000;

const toCodePoints = (str) => Array.from(str).map((ch) => ch.codePointAt(0));

// ============ 1. DFA ============
export function dfaMatch(dfa, input) {
  const cps = toCodePoints(input);
  const frames = [];
  const visited = new Set([0]);
  let transitions = 0;
  let state = 0;

  frames.push({ kind: 'start', state: 0, pos: -1, detail: 'DFA 从起始状态出发' });
  for (let i = 0; i < cps.length; i += 1) {
    const next = dfaTarget(dfa, state, cps[i]);
    transitions += 1;
    frames.push({
      kind: 'consume',
      from: state,
      to: next,
      pos: i,
      char: String.fromCodePoint(cps[i]),
      detail: next === null
        ? `读入 “${String.fromCodePoint(cps[i])}” 后没有任何转移 —— 提前拒绝`
        : `读入 “${String.fromCodePoint(cps[i])}”：D${state} → D${next}`,
    });
    if (next === null) {
      frames.push({ kind: 'reject', pos: i, detail: '进入死状态，匹配失败' });
      return { accepted: false, frames, stats: { transitions, backtracks: 0, visitedStates: visited.size } };
    }
    state = next;
    visited.add(state);
  }
  const accepted = dfa.states[state].accepting;
  frames.push({
    kind: accepted ? 'accept' : 'reject',
    state,
    pos: cps.length - 1,
    detail: accepted
      ? '输入全部消费完，停在接受状态 —— 匹配成功'
      : '输入已吃完但停在非接受状态 —— 匹配失败',
  });
  return { accepted, frames, stats: { transitions, backtracks: 0, visitedStates: visited.size } };
}

// ============ 2. NFA 集合模拟 ============
export function nfaMatch(nfa, input) {
  const cps = toCodePoints(input);
  const frames = [];
  const visited = new Set();
  let transitions = 0;

  // 邻接表（闭包只应沿出边走）
  const outEdges = new Map();
  for (const id of nfa.states.keys()) outEdges.set(id, []);
  for (const e of nfa.edges.values()) outEdges.get(e.from).push(e);

  const closure = (states, pos) => {
    const stack = [...states];
    const set = new Set(states);
    while (stack.length) {
      const u = stack.pop();
      for (const e of outEdges.get(u)) {
        if (e.type === 'eps') {
          if (!set.has(e.to)) {
            set.add(e.to);
            stack.push(e.to);
          }
        } else if (e.type === 'assert') {
          // ^ 仅位置 0 可穿；$ 仅当前位置等于输入长度时可穿
          // （空串上 0===length，因此初始闭包也能穿过 $）
          const ok = e.kind === 'start' ? pos === 0 : pos === cps.length;
          if (ok && !set.has(e.to)) {
            set.add(e.to);
            stack.push(e.to);
          }
        }
      }
    }
    return set;
  };

  let current = closure(new Set([nfa.start]), 0);
  current.forEach((s) => visited.add(s));
  frames.push({
    kind: 'start',
    active: [...current].sort((a, b) => a - b),
    pos: -1,
    detail: `ε-闭包(起始)：${current.size} 个 NFA 状态可能同时活跃（^ 已按位置 0 处理）`,
  });

  // 接受判定：pos===长度时允许穿过 $ 类锚边
  const canAccept = (set, pos) => {
    if (set.has(nfa.accept)) return true;
    const stack = [...set];
    const seen = new Set(set);
    while (stack.length) {
      const u = stack.pop();
      for (const e of outEdges.get(u)) {
        let pass = false;
        if (e.type === 'eps') pass = true;
        else if (e.type === 'assert') pass = e.kind === 'end' && pos === cps.length;
        if (pass && !seen.has(e.to)) {
          if (e.to === nfa.accept) return true;
          seen.add(e.to);
          stack.push(e.to);
        }
      }
    }
    return false;
  };

  for (let i = 0; i < cps.length; i += 1) {
    // move
    const moved = new Set();
    for (const u of current) {
      for (const e of outEdges.get(u)) {
        if (e.type === 'char' && contains(e.set, cps[i])) {
          moved.add(e.to);
          transitions += 1;
        }
      }
    }
    const next = closure(moved, i + 1);
    next.forEach((s) => visited.add(s));
    frames.push({
      kind: 'consume',
      active: [...next].sort((a, b) => a - b),
      fromActive: [...current].sort((a, b) => a - b),
      pos: i,
      char: String.fromCodePoint(cps[i]),
      detail:
        next.size === 0
          ? `读入 “${String.fromCodePoint(cps[i])}” 后可能状态集合为空 —— 拒绝`
          : `读入 “${String.fromCodePoint(cps[i])}”：沿字符边推进再取 ε-闭包，剩 ${next.size} 个活跃状态`,
    });
    current = next;
    if (current.size === 0) break;
  }

  const accepted = canAccept(current, cps.length);
  frames.push({
    kind: accepted ? 'accept' : 'reject',
    active: [...current].sort((a, b) => a - b),
    pos: cps.length - 1,
    detail: accepted
      ? '活跃集合可沿 ε/$ 边到达接受状态 —— 输入中存在匹配'
      : '活跃集合无法到达接受状态 —— 匹配失败（集合模拟不回溯）',
  });
  return { accepted, frames, stats: { transitions, backtracks: 0, visitedStates: visited.size } };
}

// ============ 3. 回溯引擎 ============
// 显式 DFS。thread 栈帧：
//   {state, pos, parentEdge, pathStates, triedEdge}
// split 出边按贪婪/懒惰排序；全局 lazy 为 'lazy' 时反转所有量词的优先级。
export function backtrackMatch(nfa, input, { mode = 'native', cap = DEFAULT_CAP } = {}) {
  const cps = toCodePoints(input);
  const frames = [];
  const outEdges = new Map();
  for (const id of nfa.states.keys()) outEdges.set(id, []);
  for (const e of nfa.edges.values()) {
    let edge = e;
    // 全局对比模式：反转量词 split 的试边顺序
    if (mode !== 'native' && nfa.splits.has(e.from) && (e.role === 'loop' || e.role === 'exit')) {
      const info = nfa.splits.get(e.from);
      if (info.lazy !== (mode === 'lazy')) edge = { ...e, flipped: true };
    }
    outEdges.get(e.from).push(edge);
  }
  // split 状态的出边决定回溯优先级：构造期已按贪婪/懒惰排好序（loop 先或 exit 先），
  // 这里只保证同 split 内 loop/exit 排在普通 join 边之前，其余保持建边顺序。
  for (const list of outEdges.values()) {
    const rank = (e) => {
      // flipped：对比模式反转优先级——“尝试/继续”降到“退出”之后
      const isLoop = e.role === 'loop' && !e.flipped;
      const isExit = e.role === 'exit' && !e.flipped;
      const isLoopF = e.role === 'loop' && e.flipped;
      const isExitF = e.role === 'exit' && e.flipped;
      if (isLoop) return 0;
      if (isExit) return 1;
      if (isExitF) return 0; // 原本退出边，反转后优先
      if (isLoopF) return 1; // 原本尝试边，反转后轮后
      if (e.role === 'branch') return 2;
      if (e.role === 'rejoin' || e.role === 'join' || e.role === 'merge') return 3;
      return 4;
    };
    list.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  }

  const stats = { transitions: 0, backtracks: 0, visitedStates: 0 };
  const seenStates = new Set([nfa.start]);
  let capped = false;

  // 真实执行步数（统计用），不受帧记录上限影响；设硬上限防止引擎真正跑挂
  const HARD_STEP_CAP = 5_000_000;
  let stepCount = 0;

  // 当前 DFS 路径上的 (状态,输入位置)，仅用于剪掉零进展 ε 环
  const pathConfigs = new Set([nfa.start * 1000003 + 0]);
  const path = [{ state: nfa.start, pos: 0, edge: null }];
  const stack = [{ state: nfa.start, pos: 0, nextIdx: 0 }];
  let frameCount = 0;
  // 记录帧但不因此中断统计：超出 cap 后停止追加帧，只保留最后一帧 cap 提示
  const pushFrame = (f) => {
    frameCount += 1;
    if (frameCount <= cap) frames.push(f);
  };

  pushFrame({
    kind: 'start',
    state: nfa.start,
    pos: -1,
    pathStates: [nfa.start],
    detail: mode === 'native' ? '回溯引擎从起始状态出发' : `对比模式：按${mode === 'lazy' ? '懒惰' : '贪婪'}顺序探索`,
  });

  let accepted = false;
  while (stack.length) {
    stepCount += 1;
    if (stepCount > HARD_STEP_CAP || frameCount > cap) {
      capped = true;
      break;
    }
    const top = stack[stack.length - 1];
    const edges = outEdges.get(top.state);

    if (top.state === nfa.accept) {
      if (top.pos === cps.length) {
        accepted = true;
        pushFrame({
          kind: 'accept',
          state: top.state,
          pos: cps.length - 1,
          pathStates: path.map((p) => p.state),
          detail: '走到接受状态且输入恰好吃完 —— 匹配成功',
        });
        break;
      }
      // 到达接受态但还有输入（一般不会发生，accept 无出边），落下去自然失败
    }

    // 选下一条可走边
    let chosen = null;
    let chosenEdge = null;
    while (top.nextIdx < edges.length) {
      const e = edges[top.nextIdx];
      top.nextIdx += 1;
      if (e.type === 'eps') {
        chosen = { state: e.to, pos: top.pos, edge: e };
      } else if (e.type === 'assert') {
        // 内部锚点：^ 仅位置 0；$ 仅输入末尾
        const ok = e.kind === 'start' ? top.pos === 0 : top.pos === cps.length;
        if (ok) chosen = { state: e.to, pos: top.pos, edge: e };
      } else if (top.pos < cps.length && contains(e.set, cps[top.pos])) {
        chosen = { state: e.to, pos: top.pos + 1, edge: e, consumed: true, charPos: top.pos };
      }
      if (chosen) {
        const cfg = chosen.state * 1000003 + chosen.pos;
        if (pathConfigs.has(cfg)) {
          chosen = null; // 当前路径已到过该 (状态,位置)：零进展环，放弃这条边
          continue;
        }
        chosenEdge = e;
        break;
      }
    }

    if (!chosen) {
      // 无路可走：回溯
      const dead = path[path.length - 1];
      stack.pop();
      path.pop();
      pathConfigs.delete(dead.state * 1000003 + dead.pos);
      stats.backtracks += 1;
      const restored = stack.length ? path[path.length - 1] : null;
      pushFrame({
        kind: 'backtrack',
        fromState: dead.state,
        fromPos: dead.pos - 1,
        toState: restored ? restored.state : null,
        toPos: restored ? restored.pos - 1 : null,
        edge: dead.edge ? { id: dead.edge.id, from: dead.edge.from, to: dead.edge.to } : null,
        pathStates: path.map((p) => p.state),
        pos: dead.pos - 1,
        detail: restored
          ? `状态 D${dead.state} 处所有选择都失败，回退到 D${restored.state} 尝试下一条分支`
          : '所有路径均已试完，匹配失败',
      });
      continue;
    }

    pathConfigs.add(chosen.state * 1000003 + chosen.pos);
    seenStates.add(chosen.state);
    stack.push({ state: chosen.state, pos: chosen.pos, nextIdx: 0 });
    path.push({ state: chosen.state, pos: chosen.pos, edge: chosen.edge });

    if (chosen.consumed) {
      stats.transitions += 1;
      pushFrame({
        kind: 'consume',
        edge: { id: chosen.edge.id, from: chosen.edge.from, to: chosen.edge.to },
        from: chosen.edge.from,
        to: chosen.state,
        pos: chosen.charPos,
        char: String.fromCodePoint(cps[chosen.charPos]),
        pathStates: path.map((p) => p.state),
        detail: `沿 “${String.fromCodePoint(cps[chosen.charPos])}” 边 ${chosen.edge.from} → ${chosen.state}` +
          (chosenEdge.flipped ? '（对比模式，优先级已反转）' : ''),
      });
    } else {
      stats.transitions += 1;
      pushFrame({
        kind: 'epsilon',
        edge: { id: chosen.edge.id, from: chosen.edge.from, to: chosen.edge.to, role: chosen.edge.role },
        from: chosen.edge.from,
        to: chosen.state,
        pos: chosen.pos - 1,
        charPos: chosen.pos - 1,
        pathStates: path.map((p) => p.state),
        detail:
          chosen.edge.type === 'assert'
            ? `沿 ${chosen.edge.label} 锚点边 ${chosen.edge.from} → ${chosen.state}`
            : `沿 ε 边 ${chosen.edge.from} → ${chosen.state}` +
              (chosen.edge.role === 'loop' ? '（量词：再试一次）' : chosen.edge.role === 'exit' ? '（量词：退出）' : ''),
      });
    }
  }

  if (!accepted && !capped) {
    pushFrame({ kind: 'reject', pos: cps.length - 1, pathStates: [], detail: '回溯穷尽所有可能，匹配失败' });
  }
  if (capped) {
    frames.push({
      kind: 'cap',
      detail: `执行步数超过 ${cap.toLocaleString()} 上限被强制截断：这通常意味着灾难性回溯，正则可能长时间无法结束`,
    });
  }
  stats.visitedStates = seenStates.size;
  return { accepted: capped ? false : accepted, frames, stats, capped };
}
