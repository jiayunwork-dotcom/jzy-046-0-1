// DFA 最小化：Hopcroft 划分算法。
// 两个状态等价 ⇔ 同为（非）接受态，且在任意输入字符上转移到同一等价类。
//
// steps 记录每轮划分的结果，前端逐轮高亮“被判为等价而合并”的状态组；
// 最小化后不额外保留死状态（拒绝由“无转移”表达），面板对比前后状态数。

import { describeRanges } from './charsets.js';
import { layoutDFA } from './layout.js';

export function minimizeDFA(dfa) {
  const n0 = dfa.states.length;
  const steps = [];

  // 以 DFA 已有的合并区间为“字母表”（同区间内转移恒相同）
  const cuts = new Set([0, 0x10ffff + 1]);
  for (const t of dfa.transitions) {
    for (const [lo, hi] of t.ranges) {
      cuts.add(lo);
      cuts.add(hi + 1);
    }
  }
  const points = [...cuts].sort((a, b) => a - b);
  const alphabet = [];
  for (let i = 0; i < points.length - 1; i += 1) alphabet.push([points[i], points[i + 1] - 1]);

  const target = (sid, cp) => {
    for (const t of dfa.transitions) {
      if (t.from !== sid) continue;
      for (const [lo, hi] of t.ranges) if (cp >= lo && cp <= hi) return t.to;
    }
    return -1; // 隐式死状态
  };

  // 初始划分：接受 / 非接受
  let cls = dfa.states.map((s) => (s.accepting ? 1 : 0));
  const snapshot = (round, detail) =>
    steps.push({ round, classes: [...cls], detail });
  snapshot(0, '初始划分：接受状态与非接受状态一分为二');

  let round = 1;
  for (;;) {
    const next = new Map();
    const groups = new Map();
    for (let sid = 0; sid < dfa.states.length; sid += 1) {
      // 签名 = (当前类, 每个字母符号上目标所属的类)
      const sig = [cls[sid]];
      for (const [lo] of alphabet) sig.push(cls[target(sid, lo)] ?? -1);
      const key = sig.join('#');
      if (!next.has(key)) next.set(key, next.size);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(sid);
    }
    const newCls = cls.map((_, sid) => {
      const sig = [cls[sid]];
      for (const [lo] of alphabet) sig.push(cls[target(sid, lo)] ?? -1);
      return next.get(sig.join('#'));
    });
    const classCount = new Set(newCls).size;
    const mergedGroups = [...groups.values()].filter((g) => g.length > 1).map((g) => [...g]);
    steps.push({
      round,
      classes: [...newCls],
      groups: mergedGroups,
      detail: `第 ${round} 轮细化：按转移目标的等价类重新分组，得到 ${classCount} 个等价类`,
    });
    if (classCount === new Set(cls).size) break;
    cls = newCls;
    round += 1;
    if (round > 200) break;
  }

  // —— 构造最小化后的 DFA ——
  // 丢弃“纯死状态”等价类（其所有转移都指向自己，且不接受）
  const classMembers = new Map();
  dfa.states.forEach((s, sid) => {
    const c = cls[sid];
    if (!classMembers.has(c)) classMembers.set(c, []);
    classMembers.get(c).push(sid);
  });
  const deadClasses = new Set();
  for (const [c, members] of classMembers) {
    const rep = members[0];
    if (!dfa.states[rep].accepting) {
      const allSelf = alphabet.every(([lo]) => {
        const t = target(rep, lo);
        return t === -1 || cls[t] === c;
      });
      if (allSelf) deadClasses.add(c);
    }
  }

  // 起始类永远保留：若它是死类，就让代表态成为“非接受、无转移”的占位起始态
  // （对应语言为空的正则，匹配器在其上立即拒绝）。
  const startClass = cls[dfa.start];
  const liveClasses = [...classMembers.keys()].filter(
    (c) => !deadClasses.has(c) || c === startClass,
  );
  const remap = new Map(liveClasses.map((c, i) => [c, i]));
  const newStates = liveClasses.map((c, i) => {
    const members = classMembers.get(c);
    return {
      id: i,
      memberStates: members,
      accepting: dfa.states[members[0]].accepting,
      x: 0,
      y: 0,
    };
  });

  const repOf = new Map(liveClasses.map((c) => [c, classMembers.get(c)[0]]));
  const newStart = remap.get(startClass);
  const newTransitions = [];
  for (const c of liveClasses) {
    if (deadClasses.has(c)) continue; // 占位死类不出任何转移
    const from = remap.get(c);
    const rep = repOf.get(c);
    // 收集代表状态在各区间上的目标，按 (newTo) 合并相邻区间
    let cur = null;
    const flush = () => {
      if (cur) newTransitions.push(cur);
      cur = null;
    };
    for (const part of alphabet) {
      const tgt = target(rep, part[0]);
      const newTo = tgt === -1 || deadClasses.has(cls[tgt]) ? null : remap.get(cls[tgt]);
      if (newTo === null) {
        flush();
        continue;
      }
      if (cur && cur.to === newTo) {
        const last = cur.ranges[cur.ranges.length - 1];
        if (last[1] + 1 === part[0]) last[1] = part[1];
        else cur.ranges.push([...part]);
      } else {
        flush();
        cur = { from, to: newTo, ranges: [[...part]], label: '' };
      }
    }
    flush();
  }
  for (const t of newTransitions) t.label = describeRanges(t.ranges);

  const size = layoutDFA(newStates, newTransitions, { start: newStart ?? 0 });

  steps.push({
    round: round + 1,
    classes: cls,
    detail: `合并等价状态、去除不可达死状态：${n0} → ${newStates.length} 个状态`,
  });

  return {
    start: newStart ?? 0,
    accept: newStates.filter((s) => s.accepting).map((s) => s.id),
    states: newStates,
    transitions: newTransitions,
    steps,
    beforeCount: n0,
    afterCount: newStates.length,
    width: size.width,
    height: size.height,
  };
}
