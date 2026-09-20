import React, { useMemo, useState } from 'react';
import NFACanvas from '../canvas/NFACanvas.jsx';
import DFACanvas from '../canvas/DFACanvas.jsx';
import PlayerControls from './PlayerControls.jsx';
import StatsPanel from './StatsPanel.jsx';
import { usePlayer } from '../player.js';

// 把某一帧换算成画布高亮信息。
function nfaHighlight(frame) {
  if (!frame) return { activeStates: [], activeEdges: [], backtrackEdges: [], pathStates: frame?.pathStates || [] };
  let activeStates = [];
  let activeEdges = [];
  let backtrackEdges = [];
  if (frame.kind === 'start') activeStates = frame.state !== undefined ? [frame.state] : (frame.active || []);
  if (frame.kind === 'consume' || frame.kind === 'epsilon') {
    activeStates = [frame.to];
    if (frame.edge) activeEdges = [edgeKey(frame.edge)];
  }
  if (frame.kind === 'backtrack') {
    if (frame.edge) backtrackEdges = [edgeKey(frame.edge)];
    activeStates = frame.toState === null ? [] : [frame.toState];
  }
  if (frame.kind === 'accept' || frame.kind === 'reject') {
    activeStates = frame.state !== undefined ? [frame.state] : (frame.active || []);
  }
  return { activeStates, activeEdges, backtrackEdges, pathStates: frame.pathStates || [] };
}

function edgeKey(e) {
  return e.id;
}

export default function MatchView({ nfa, dfa, minDfa, matchResult, input, analysis }) {
  const [engine, setEngine] = useState('backtrack'); // dfa | nfa | backtrack

  const engineData = matchResult?.engines
    ? matchResult.engines[engine === 'dfa' ? 'dfa' : engine === 'nfa' ? 'nfa' : 'backtrack']
    : null;
  const frames = engineData?.frames || [];
  const player = usePlayer(frames);
  const frame = frames[player.index] || null;

  const inputChars = useMemo(() => Array.from(input), [input]);

  // 当前消费的字符位置
  const currentPos = frame?.pos ?? -1;

  const dfaHL = useMemo(() => {
    if (!frame) return { activeStates: [], activeEdges: [] };
    if (engine !== 'dfa') return {};
    if (frame.kind === 'start') return { activeStates: [frame.state], activeEdges: [] };
    if (frame.kind === 'consume') {
      return {
        activeStates: frame.to === null || frame.to === undefined ? [] : [frame.to],
        activeEdges: frame.from !== undefined && frame.to !== null ? [{ from: frame.from, to: frame.to }] : [],
      };
    }
    if (frame.kind === 'accept' || frame.kind === 'reject') {
      return { activeStates: frame.state !== undefined ? [frame.state] : [], activeEdges: [] };
    }
    return { activeStates: [], activeEdges: [] };
  }, [frame, engine]);

  const nfaSetHL = useMemo(() => {
    if (engine !== 'nfa' || !frame) return { activeStates: [], activeEdges: [] };
    if (frame.kind === 'start' || frame.kind === 'consume' || frame.kind === 'accept' || frame.kind === 'reject') {
      return { activeStates: frame.active || [], activeEdges: [] };
    }
    return { activeStates: [], activeEdges: [] };
  }, [frame, engine]);

  const btHL = useMemo(() => (engine === 'backtrack' ? nfaHighlight(frame) : null), [frame, engine]);

  const accepted = engineData?.accepted;
  const showCanvas = () => {
    if (engine === 'dfa') {
      return (
        <DFACanvas
          dfa={minDfa || dfa}
          minimized={!!minDfa}
          activeStates={dfaHL.activeStates}
          activeEdges={dfaHL.activeEdges}
        />
      );
    }
    if (engine === 'nfa') {
      return <NFACanvas nfa={nfa} activeStates={nfaSetHL.activeStates} />;
    }
    return (
      <NFACanvas
        nfa={nfa}
        activeStates={btHL?.activeStates}
        activeEdges={btHL?.activeEdges}
        backtrackEdges={btHL?.backtrackEdges}
        currentPath={btHL?.pathStates}
      />
    );
  };

  return (
    <div className="canvas-wrap" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="canvas-toolbar" style={{ position: 'static' }}>
        <select value={engine} onChange={(e) => setEngine(e.target.value)}>
          <option value="backtrack">回溯引擎（Perl 风格）</option>
          <option value="nfa">NFA 集合模拟</option>
          <option value="dfa">DFA（最小化）</option>
        </select>
        {matchResult && (
          <span className={`consistency ${matchResult.consistent ? 'ok' : 'bad'}`}>
            {matchResult.consistent ? '✓ 三引擎结论一致' : '✗ 引擎结论不一致！'}
          </span>
        )}
        <span className="step-caption">{frame?.detail}</span>
      </div>

      <PlayerControls
        player={player}
        caption=""
        disabled={frames.length === 0}
      />

      <div className="legend">
        {engine === 'backtrack' && (
          <>
            <span><span className="dot" style={{ background: '#5b9dff' }} />当前探索状态</span>
            <span style={{ color: '#ff5d5d' }}>- - - 红色虚线：失败回退</span>
          </>
        )}
        {engine === 'nfa' && <span><span className="dot" style={{ background: '#5b9dff' }} />当前所有可能活跃的状态集合</span>}
        {engine === 'dfa' && <span><span className="dot" style={{ background: '#7ee0c0' }} />当前唯一 DFA 状态</span>}
        {engineData?.capped && <span style={{ color: '#ff5d5d', fontWeight: 600 }}>⛔ 步数被截断（灾难性回溯）</span>}
      </div>

      <div className="canvas-scroll" style={{ flex: 1 }}>
        {showCanvas()}
      </div>

      {/* 测试串逐字符高亮 */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>测试串（当前消费字符高亮）：</div>
        <div className="input-view">
          {inputChars.length === 0 && <span className="muted">（空串 ε）</span>}
          {inputChars.map((ch, i) => (
            <span
              key={i}
              className={`ch ${i === currentPos ? 'current' : i < currentPos ? 'consumed' : ''}`}
            >
              {ch === ' ' ? '␠' : ch === '\n' ? '␤' : ch === '\t' ? '␉' : ch}
            </span>
          ))}
          {frame?.kind === 'start' && <span className="pos-caret">▏</span>}
        </div>
        {matchResult && (
          <div style={{ marginTop: 8 }}>
            <div className={`verdict ${accepted ? 'accept' : 'reject'}`}>
              {accepted ? '✓ 匹配成功' : '✗ 匹配失败'}
            </div>
            <StatsPanel
              engineResult={engineData}
              inputLength={inputChars.length}
              analysis={analysis}
            />
          </div>
        )}
      </div>
    </div>
  );
}
