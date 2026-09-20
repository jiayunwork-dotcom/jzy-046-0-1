import React from 'react';

// 性能分析面板：状态转移次数、回溯次数、访问状态数、灾难告警。
export default function StatsPanel({ engineResult, inputLength, analysis }) {
  if (!engineResult) return <div className="muted">输入测试串后显示统计。</div>;
  const { stats } = engineResult;
  const n = Math.max(inputLength, 1);
  const ratio = (stats.transitions / n).toFixed(1);
  const danger = analysis?.level === 'exponential';
  const poly = analysis?.level === 'polynomial';

  return (
    <div>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="num">{stats.transitions}</div>
          <div className="lbl">状态转移次数</div>
        </div>
        <div className={`stat-card ${stats.backtracks > 0 ? 'danger' : ''}`}>
          <div className="num">{stats.backtracks}</div>
          <div className="lbl">回溯次数</div>
        </div>
        <div className="stat-card">
          <div className="num">{stats.visitedStates}</div>
          <div className="lbl">访问过的状态总数</div>
        </div>
        <div className="stat-card">
          <div className="num">{ratio}×</div>
          <div className="lbl">转移数 / 输入长度</div>
        </div>
      </div>

      {analysis?.notes?.map((note, i) => (
        <Warning key={`n${i}`} finding={note} />
      ))}
      {analysis?.static?.findings?.map((f, i) => (
        <Warning key={`s${i}`} finding={f} />
      ))}
      {!danger && !poly && analysis && (
        <div className="warning-box safe">
          <div className="title">✓ 未发现明显回溯风险</div>
          <div className="advice">该正则的结构在当前测试下没有指数级或平方级膨胀迹象。</div>
        </div>
      )}
    </div>
  );
}

function Warning({ finding }) {
  const cls = finding.level === 'exponential' ? 'exponential' : 'polynomial';
  const icon = finding.level === 'exponential' ? '⛔' : '⚠️';
  return (
    <div className={`warning-box ${cls}`}>
      <div className="title">{icon} {finding.title}</div>
      {finding.advice && <div className="advice">{finding.advice}</div>}
    </div>
  );
}
