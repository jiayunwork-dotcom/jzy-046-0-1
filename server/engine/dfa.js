// 子集构造法：NFA -> DFA。
//
// 要点：
//  - 字符宇宙按所有 NFA 字符类端点切分成区间（partition），DFA 对每个区间建一条转移，
//    这样字符类再多也不会逐字符膨胀；最终把相邻且目标相同的区间合并成标签。
//  - ^ 锚点：仅在“输入位置 0 的闭包”里穿过 assert-start 边；
//  - $ 锚点：用 acceptsEnd 标记——该 DFA 状态仅在输入吃完时才是接受状态；
//    assert-end 边在普通闭包中不穿过（等价于“走到尽头才允许穿过”）。
//
// steps 记录每个 DFA 状态的诞生过程，前端据此播放“NFA 状态集合合并成一个 DFA 状态”。

import { intersect, describeRanges } from './charsets.js';
import { layoutDFA } from './layout.js';

export const DEFAULT_DFA_LIMIT = 256;
const STEP_LIMIT = 4000; // 动画步数上限（极端模式保护）

export function subsetConstruct(nfa, { limit = DEFAULT_DFA_LIMIT } = {}) {
  const { start, accept, edges: edgeMap, states: stateMap } = nfa;
  const edges = [...edgeMap.values()];
  const out = new Map();
  for (const id of stateMap.keys()) out.set(id, []);
  for (const e of edges) out.get(e.from).push(e);

  // —— 字符宇宙切分 ——
  const cuts = new Set([0, 0x10ffff + 1]);
  for (const e of edges) {
    if (e.type !== 'char') continue;
    for (const [lo, hi] of e.set) {
      cuts.add(lo);
      cuts.add(hi + 1);
    }
  }
  const points = [...cuts].sort((a, b) => a - b);
  const partition = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    partition.push([points[i], points[i + 1] - 1]);
  }

  // —— ε 闭包 ——
  // ^ 锚边仅在位置 0 可穿；$ 锚边在普通闭包中永不穿，只在“输入吃完后的接受判定”里穿。
  function closure(set, atPos0) {
    const stack = [...set];
    const res = new Set(set);
    while (stack.length) {
      const u = stack.pop();
      for (const e of out.get(u)) {
        if (e.type === 'eps') {
          if (!res.has(e.to)) {
            res.add(e.to);
            stack.push(e.to);
          }
        } else if (e.type === 'assert' && e.kind === 'start' && atPos0) {
          if (!res.has(e.to)) {
            res.add(e.to);
            stack.push(e.to);
          }
        }
      }
    }
    return res;
  }

  function move(set, range) {
    const res = new Set();
    for (const u of set) {
      for (const e of out.get(u)) {
        if (e.type === 'char' && intersect(e.set, [range]).length) res.add(e.to);
      }
    }
    return res;
  }

  // 是否“吃完输入后接受”：做一次不动点闭包——
  //   ε 边随时可穿；$ 边在输入吃完语境下可穿；^ 边仅在“空输入（位置 0 即末尾）”时可穿。
  // 由于子集构造不绑定具体输入，^ 的放行按保守原则：只在起始 DFA 状态接受判定时允许，
  // 对应“尚未消费任何字符”的空串情形。
  function acceptingAtEnd(set, { allowStart = false } = {}) {
    const seen = new Set(set);
    const stack = [...set];
    while (stack.length) {
      const u = stack.pop();
      if (u === accept) return true;
      for (const e of out.get(u)) {
        let pass = false;
        if (e.type === 'eps') pass = true;
        else if (e.type === 'assert' && e.kind === 'end') pass = true;
        else if (e.type === 'assert' && e.kind === 'start' && allowStart) pass = true;
        if (pass && !seen.has(e.to)) {
          seen.add(e.to);
          stack.push(e.to);
        }
      }
    }
    return false;
  }
  // 不依赖“走到输入尽头”即可接受：ε-可达 accept（搜索外壳的 ε·命中边也算）
  function acceptingPlain(set) {
    const seenSet = new Set(set);
    const stack = [...set];
    while (stack.length) {
      const u = stack.pop();
      if (u === accept) return true;
      for (const e of out.get(u)) {
        if (e.type === 'eps' && !seenSet.has(e.to)) {
          seenSet.add(e.to);
          stack.push(e.to);
        }
      }
    }
    return false;
  }

  const steps = [];
  const dfaStates = [];
  const dfaTransitions = []; // {from,to,ranges:[[lo,hi]], label}
  const keyOf = (set) => [...set].sort((a, b) => a - b).join(',');

  let truncated = false;
  let truncateReason = null;
  const queue = [];

  const birth = (startSet, isStart = false) => {
    const startState = isStart ? new Set(startSet) : closure(startSet, false);
    const id = dfaStates.length;
    // 只有起始 DFA 状态代表“消费了 0 个字符”，此时空串的 0 位置同时满足 ^ 与 $
    const needEnd = !acceptingPlain(startState) && acceptingAtEnd(startState, { allowStart: id === 0 });
    const dfaState = {
      id,
      nfaSet: [...startState].sort((a, b) => a - b),
      accepting: acceptingAtEnd(startState, { allowStart: id === 0 }),
      needEnd,
      x: 0,
      y: 0,
    };
    dfaStates.push(dfaState);
    steps.push({
      kind: 'birth',
      dfaId: id,
      nfaSet: dfaState.nfaSet,
      accepting: dfaState.accepting,
      needEnd,
      detail:
        id === 0
          ? `DFA 起始状态 = ε-闭包(NFA 起始${'，穿过 ^ 锚点'})，包含 ${dfaState.nfaSet.length} 个 NFA 状态`
          : `新 DFA 状态 D${id}：合并 ${dfaState.nfaSet.length} 个同时活跃的 NFA 状态`,
    });
    queue.push(id);
    return id;
  };

  birth(closure(new Set([start]), true), true);

  while (queue.length) {
    if (dfaStates.length >= limit) {
      truncated = true;
      truncateReason = `DFA 状态数达到上限 ${limit}，子集构造在此截断展示（实际自动机可能更大）`;
      break;
    }
    if (steps.length >= STEP_LIMIT) {
      truncated = true;
      truncateReason = `构造步数超过保护阈值 ${STEP_LIMIT}，已截断展示`;
      break;
    }
    const dId = queue.shift();
    const nfaSet = new Set(dfaStates[dId].nfaSet);

    // 按 partition 逐区间推进，把相同目标的区间收成一条边
    let current = null;
    const emit = () => {
      if (!current) return;
      dfaTransitions.push(current);
      steps.push({
        kind: 'transition',
        from: dId,
        to: current.to,
        ranges: current.ranges.map((r) => [...r]),
        label: current.label,
        nfaSet: dfaStates[current.to].nfaSet,
        detail: `D${dId} —${current.label}→ D${current.to}`,
      });
      current = null;
    };

    for (const part of partition) {
      const moved = move(nfaSet, part);
      let targetSet;
      if (moved.size === 0) {
        targetSet = null;
      } else {
        // 消费一个字符后不再位于位置 0，^ 边不再可穿过
        targetSet = closure(moved, false);
      }
      if (targetSet === null) {
        emit();
        continue;
      }
      const key = keyOf(targetSet);
      let toId = dfaStates.findIndex((s) => keyOf(new Set(s.nfaSet)) === key);
      if (toId === -1) {
        if (dfaStates.length >= limit) {
          truncated = true;
          truncateReason = `DFA 状态数达到上限 ${limit}，子集构造在此截断展示（实际自动机可能更大）`;
          break;
        }
        toId = birth(targetSet, false);
      }
      if (current && current.to === toId) {
        const last = current.ranges[current.ranges.length - 1];
        if (last[1] + 1 === part[0]) last[1] = part[1];
        else current.ranges.push([...part]);
      } else {
        emit();
        current = { from: dId, to: toId, ranges: [[...part]], label: '' };
      }
    }
    emit();
    if (truncated) break;
  }

  // 标签
  for (const t of dfaTransitions) t.label = describeRanges(t.ranges);

  // 布局
  const size = layoutDFA(dfaStates, dfaTransitions, { start: 0 });

  return {
    start: 0,
    accept: dfaStates.filter((s) => s.accepting).map((s) => s.id),
    states: dfaStates,
    transitions: dfaTransitions,
    steps,
    truncated,
    truncateReason,
    partition: partition.filter((p) => p[0] <= 0x7e).slice(0, 64), // 仅给面板展示用
    width: size.width,
    height: size.height,
  };
}

// 供匹配器使用：给定 DFA 和码点，返回转移目标
export function dfaTarget(dfa, stateId, codePoint) {
  const outgoing = dfa.transitions.filter((t) => t.from === stateId);
  for (const t of outgoing) {
    for (const [lo, hi] of t.ranges) {
      if (codePoint >= lo && codePoint <= hi) return t.to;
    }
  }
  return null;
}

export function dfaAccepts(dfa, str) {
  let state = dfa.start;
  const cps = [...str].map((ch) => ch.codePointAt(0));
  for (let i = 0; i < cps.length; i += 1) {
    state = dfaTarget(dfa, state, cps[i]);
    if (state === null) return { accepted: false };
  }
  // 到达接受态即匹配（needEnd 的状态只可能在输入吃完时抵达接受判定）
  return { accepted: dfa.states[state].accepting, state };
}
