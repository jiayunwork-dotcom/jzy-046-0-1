import React, { useEffect, useRef } from 'react';
import { drawGraph } from './draw.js';

// NFA 画布。
// props:
//   nfa: 后端序列化结果
//   visibleStates/visibleEdges: 构造动画中已出现的状态/边
//   activeStates: 匹配动画中活跃的状态集合
//   activeEdges / backtrackEdges: 匹配动画中的边
//   currentPath: 回溯路径上的状态（淡高亮）
export default function NFACanvas({
  nfa,
  visibleStates,
  visibleEdges,
  activeStates,
  activeEdges,
  backtrackEdges,
  currentPath,
}) {
  const ref = useRef(null);
  const stateSet = new Set(visibleStates ?? nfa.states.map((s) => s.id));
  const edgeSet = new Set(visibleEdges ?? nfa.edges.map((e) => e.id));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !nfa) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = nfa.width * dpr;
    canvas.height = nfa.height * dpr;
    canvas.style.width = `${nfa.width}px`;
    canvas.style.height = `${nfa.height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const states = nfa.states
      .filter((s) => stateSet.has(s.id))
      .map((s) => ({ id: s.id, x: s.x, y: s.y, accept: s.id === nfa.accept }));
    const edges = nfa.edges
      .filter((e) => edgeSet.has(e.id) && stateSet.has(e.from) && stateSet.has(e.to))
      .map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        label: e.type === 'char' ? e.label : e.type === 'assert' ? e.label : 'ε',
        type: e.type,
      }));

    // 回溯路径上的边也传进去做红色虚线
    drawGraph(ctx, { states, edges, width: nfa.width, height: nfa.height }, {
      states,
      edges,
      activeStates,
      activeEdges,
      backtrackEdges,
      startState: nfa.start,
      width: nfa.width,
      height: nfa.height,
      stateLabel: (id) => id,
    });
  }, [nfa, visibleStates, visibleEdges, activeStates, activeEdges, backtrackEdges, currentPath]);

  return (
    <canvas ref={ref} />
  );
}
