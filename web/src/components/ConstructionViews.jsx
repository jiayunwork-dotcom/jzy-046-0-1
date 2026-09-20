import React, { useMemo, useState } from 'react';
import NFACanvas from '../canvas/NFACanvas.jsx';
import DFACanvas from '../canvas/DFACanvas.jsx';
import PlayerControls from './PlayerControls.jsx';
import { usePlayer } from '../player.js';

// —— Thompson 构造单步 ——
export function NFABuildView({ nfa }) {
  const player = usePlayer(nfa.steps);
  const step = nfa.steps[player.index];

  const { visibleStates, visibleEdges } = useMemo(() => {
    const states = new Set();
    const edges = new Set();
    for (let i = 0; i <= player.index; i += 1) {
      const s = nfa.steps[i];
      s.adds.states.forEach((id) => states.add(id));
      s.adds.edges.forEach((id) => edges.add(id));
    }
    return { visibleStates: [...states], visibleEdges: [...edges] };
  }, [nfa, player.index]);

  return (
    <div className="canvas-wrap" style={{ height: '100%' }}>
      <PlayerControls player={player} caption={step?.detail} disabled={!nfa} />
      <div className="legend">
        <span><span className="dot" style={{ background: '#5b9dff' }} />普通状态</span>
        <span><span className="dot" style={{ background: '#7ee0c0' }} />接受状态（双圈）</span>
        <span style={{ color: '#8fa6d4' }}>字符边</span>
        <span style={{ color: '#6b7894' }}>ε 空转移</span>
        <span className="muted">当前规则新增 {step?.adds.states.length ?? 0} 个状态 / {step?.adds.edges.length ?? 0} 条边</span>
      </div>
      <div className="canvas-scroll">
        <NFACanvas nfa={nfa} visibleStates={visibleStates} visibleEdges={visibleEdges} />
      </div>
    </div>
  );
}

// —— 子集构造单步 ——
export function DfaBuildView({ dfa }) {
  // 构造帧：每个 birth 一帧，每个 transition 一帧（与后端 steps 一致）
  const player = usePlayer(dfa.steps);
  const step = dfa.steps[player.index];

  const { visibleStates, newState, activeEdges } = useMemo(() => {
    const states = [];
    let nu = null;
    const edges = [];
    for (let i = 0; i <= player.index; i += 1) {
      const s = dfa.steps[i];
      if (s.kind === 'birth') {
        states.push(s.dfaId);
        if (i === player.index) nu = s.dfaId;
      } else if (s.kind === 'transition') {
        edges.push({ from: s.from, to: s.to });
        if (i === player.index) nu = null;
      }
    }
    return { visibleStates: states, newState: nu, activeEdges: step?.kind === 'transition' ? [{ from: step.from, to: step.to }] : [] };
  }, [dfa, player.index, step]);

  return (
    <div className="canvas-wrap" style={{ height: '100%' }}>
      <PlayerControls player={player} caption={step?.detail} disabled={!dfa} />
      <div className="legend">
        <span><span className="dot" style={{ background: '#ffd479' }} />本帧新生成的 DFA 状态</span>
        <span className="muted">每个 DFA 状态 = 一个 NFA 状态集合（悬停 NFA 步骤可对照）</span>
        <span className="muted">集合大小：{step?.nfaSet?.length ?? '—'}</span>
      </div>
      {dfa.truncated && <div className="hint-banner">⛔ {dfa.truncateReason}</div>}
      <div className="canvas-scroll">
        <DFACanvas dfa={dfa} visibleStates={visibleStates} newState={newState} activeEdges={activeEdges} />
      </div>
    </div>
  );
}

// —— 最小化单步 ——
export function MinBuildView({ minDfa, dfa }) {
  // 前几轮在“原 DFA”上画等价类分组，最后一步切换为最小化结果
  const steps = minDfa.steps;
  const player = usePlayer(steps);
  const isLast = player.index >= steps.length - 1;
  const step = steps[player.index];

  const mergedGroups = useMemo(() => {
    if (isLast) return [];
    if (!step?.groups) return [];
    return step.groups;
  }, [step, isLast]);

  if (isLast) {
    return (
      <div className="canvas-wrap" style={{ height: '100%' }}>
        <PlayerControls player={player} caption={step?.detail} disabled={!minDfa} />
        <div className="legend">
          <span style={{ color: '#c792ea' }}>最小化后：{minDfa.beforeCount} → <b>{minDfa.afterCount}</b> 个状态</span>
          <span className="muted">等价状态已合并、不可达死状态已去除</span>
        </div>
        <div className="canvas-scroll">
          <DFACanvas dfa={minDfa} minimized />
        </div>
      </div>
    );
  }

  // 在原 DFA 上展示本轮等价类（同组虚线紫圈）
  return (
    <div className="canvas-wrap" style={{ height: '100%' }}>
      <PlayerControls player={player} caption={step?.detail} disabled={!dfa} />
      <div className="legend">
        <span><span className="dot" style={{ background: '#c792ea' }} />被判为等价、即将合并的状态</span>
        <span className="muted">等价判据：同为接受态，且任意输入转移到同一等价类</span>
      </div>
      <div className="canvas-scroll">
        <DFACanvas dfa={dfa} mergedGroups={mergedGroups} />
      </div>
    </div>
  );
}
