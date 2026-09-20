import React, { useMemo, useState } from 'react';
import NFACanvas from '../canvas/NFACanvas.jsx';
import PlayerControls from './PlayerControls.jsx';
import { usePlayer } from '../player.js';

function hl(frame) {
  if (!frame) return { activeStates: [], activeEdges: [], backtrackEdges: [] };
  if (frame.kind === 'start') return { activeStates: [frame.state], activeEdges: [], backtrackEdges: [] };
  if (frame.kind === 'consume' || frame.kind === 'epsilon') {
    return {
      activeStates: frame.to !== undefined ? [frame.to] : [],
      activeEdges: frame.edge ? [frame.edge.id] : [],
      backtrackEdges: [],
    };
  }
  if (frame.kind === 'backtrack') {
    return {
      activeStates: frame.toState === null || frame.toState === undefined ? [] : [frame.toState],
      activeEdges: [],
      backtrackEdges: frame.edge ? [frame.edge.id] : [],
    };
  }
  if (frame.kind === 'accept' || frame.kind === 'reject') {
    return { activeStates: frame.state !== undefined ? [frame.state] : frame.active || [], activeEdges: [], backtrackEdges: [] };
  }
  return { activeStates: [], activeEdges: [], backtrackEdges: [] };
}

// 贪婪 vs 懒惰并排对比。两轨用同一个播放索引，便于逐步对照差异。
export default function CompareView({ nfa, matchResult, input }) {
  const greedy = matchResult?.engines?.greedy;
  const lazy = matchResult?.engines?.lazy;

  // 以较长的帧序列做播放器，短的一边到尾后停在最后一帧
  const maxFrames = Math.max(greedy?.frames.length || 0, lazy?.frames.length || 0);
  const pseudoFrames = useMemo(() => Array.from({ length: maxFrames }, (_, i) => ({ i })), [maxFrames]);
  const player = usePlayer(pseudoFrames);
  const idx = player.index;

  const gFrame = greedy?.frames[Math.min(idx, greedy.frames.length - 1)];
  const lFrame = lazy?.frames[Math.min(idx, lazy.frames.length - 1)];
  const inputChars = useMemo(() => Array.from(input), [input]);

  if (!matchResult) {
    return <div className="muted" style={{ padding: 16 }}>输入正则和测试串后，这里并排展示贪婪与懒惰两种匹配轨迹。</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PlayerControls player={player} caption="同步逐帧对比：左侧贪婪（先尽量多吃），右侧懒惰（先尽量少吃）" disabled={maxFrames === 0} />
      <div className="legend">
        <span style={{ color: '#ffb454' }}>贪婪：回溯 {greedy?.stats.backtracks ?? '-'} 次 · 转移 {greedy?.stats.transitions ?? '-'}</span>
        <span style={{ color: '#7ee0c0' }}>懒惰：回溯 {lazy?.stats.backtracks ?? '-'} 次 · 转移 {lazy?.stats.transitions ?? '-'}</span>
      </div>
      <div className="compare-grid" style={{ flex: 1, gridTemplateColumns: '1fr 1fr', overflow: 'auto' }}>
        <ComparePane title="贪婪模式" color="#ffb454" nfa={nfa} frame={gFrame} inputChars={inputChars} />
        <ComparePane title="懒惰模式" color="#7ee0c0" nfa={nfa} frame={lFrame} inputChars={inputChars} />
      </div>
    </div>
  );
}

function ComparePane({ title, color, nfa, frame, inputChars }) {
  const h = hl(frame);
  const pos = frame?.pos ?? -1;
  return (
    <div className="compare-pane" style={{ borderColor: color }}>
      <h3 style={{ color }}>{title}</h3>
      <div style={{ overflow: 'auto', maxHeight: 340, background: 'var(--bg)', borderRadius: 6 }}>
        <NFACanvas nfa={nfa} activeStates={h.activeStates} activeEdges={h.activeEdges} backtrackEdges={h.backtrackEdges} />
      </div>
      <div className="input-view" style={{ marginTop: 6, fontSize: 12, padding: '5px 7px' }}>
        {inputChars.map((ch, i) => (
          <span key={i} className={`ch ${i === pos ? 'current' : ''}`}>
            {ch === ' ' ? '␠' : ch === '\n' ? '␤' : ch === '\t' ? '␉' : ch}
          </span>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 5, minHeight: 30 }}>{frame?.detail}</div>
    </div>
  );
}
