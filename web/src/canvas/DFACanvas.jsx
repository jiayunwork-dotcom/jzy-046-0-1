import React, { useEffect, useRef } from 'react';
import { drawGraph } from './draw.js';

// 子集构造 DFA 画布。
//   visibleStates: 构造动画中已诞生的 DFA 状态
//   newState: 当前刚诞生的状态（金色高亮）
//   activeStates: 匹配动画当前唯一状态
//   activeEdges: 匹配动画走过的转移
//   nfaGhostSet: 某个 DFA 状态对应的 NFA 集合（在 NFA 画布上同步时可选）
export default function DFACanvas({
  dfa,
  visibleStates,
  newState,
  activeStates,
  activeEdges,
  highlightNfaSet = false,
  minimized = false,
  mergedGroups = [],
}) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !dfa) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dfa.width * dpr;
    canvas.height = dfa.height * dpr;
    canvas.style.width = `${dfa.width}px`;
    canvas.style.height = `${dfa.height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const visibleSet = new Set(visibleStates ?? dfa.states.map((s) => s.id));
    const states = dfa.states
      .filter((s) => visibleSet.has(s.id))
      .map((s) => ({ id: s.id, x: s.x, y: s.y, accept: s.accepting }));
    const edges = dfa.transitions
      .filter((t) => visibleSet.has(t.from) && visibleSet.has(t.to))
      .map((t) => ({ id: `t${t.from}-${t.to}-${t.ranges[0][0]}`, from: t.from, to: t.to, label: t.label, type: 'char', raw: t }));
    // 去重（同一 from-to 可能因区间不相邻产生两条标签边，绘图时允许并存）
    const activeEdgeIds = new Set();
    if (activeEdges) {
      for (const ae of activeEdges) {
        edges.forEach((e) => {
          if (e.raw.from === ae.from && e.raw.to === ae.to) activeEdgeIds.add(e.id);
        });
      }
    }

    drawGraph(ctx, { states, edges, width: dfa.width, height: dfa.height }, {
      states,
      edges,
      activeStates,
      activeEdges: activeEdgeIds,
      newStates: newState === undefined || newState === null ? null : [newState],
      mergedStateGroups: mergedGroups,
      startState: dfa.start,
      width: dfa.width,
      height: dfa.height,
      stateLabel: (id) => (minimized ? `M${id}` : `D${id}`),
    });
  }, [dfa, visibleStates, newState, activeStates, activeEdges, mergedGroups, minimized]);

  return <canvas ref={ref} />;
}
