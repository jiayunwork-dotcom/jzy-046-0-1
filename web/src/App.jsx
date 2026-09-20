import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import PatternInput from './components/PatternInput.jsx';
import ASTTree from './components/ASTTree.jsx';
import PatternSourceView from './components/PatternSourceView.jsx';
import { NFABuildView, DfaBuildView, MinBuildView } from './components/ConstructionViews.jsx';
import MatchView from './components/MatchView.jsx';
import CompareView from './components/CompareView.jsx';
import ExamplesPanel from './components/ExamplesPanel.jsx';

const DEFAULT_PATTERN = '[\\w.]+@[\\w]+\\.[a-z]{2,}';
const DEFAULT_INPUT = 'ada@example.com';
const TABS = [
  { id: 'nfa', label: '① Thompson NFA' },
  { id: 'dfa', label: '② 子集构造 DFA' },
  { id: 'min', label: '③ 最小化 DFA' },
  { id: 'match', label: '▶ 匹配演示' },
  { id: 'compare', label: '⇄ 贪婪/懒惰对比' },
];

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export default function App() {
  const [pattern, setPattern] = useState(DEFAULT_PATTERN);
  const [input, setInput] = useState(DEFAULT_INPUT);
  const [tab, setTab] = useState('nfa');

  const [parseResult, setParseResult] = useState(null); // {ast}|{error}
  const [compiled, setCompiled] = useState(null);
  const [compileErr, setCompileErr] = useState(null);
  const [matchResult, setMatchResult] = useState(null);
  const [hoverRange, setHoverRange] = useState(null);
  const [loadingMatch, setLoadingMatch] = useState(false);

  // 实时解析（轻量）
  const debouncedParse = useMemo(
    () =>
      debounce(async (p) => {
        try {
          const r = await api.parse(p);
          if (r.ok) setParseResult({ ast: r.ast });
          else setParseResult({ error: r.error });
        } catch (e) {
          setParseResult({ error: { message: String(e), index: 0 } });
        }
      }, 150),
    [],
  );

  // 完整编译（稍长防抖）
  const debouncedCompile = useMemo(
    () =>
      debounce(async (p) => {
        try {
          const r = await api.compile(p);
          if (r.ok) {
            setCompiled(r);
            setCompileErr(null);
          } else {
            setCompileErr(r.error);
          }
        } catch (e) {
          setCompileErr({ message: String(e), index: 0 });
        }
      }, 250),
    [],
  );

  useEffect(() => {
    debouncedParse(pattern);
    debouncedCompile(pattern);
  }, [pattern]);

  // 匹配（编译结果或输入变化时，且仅在相关 tab 有需要时也算好，便于切 tab 即时看到）
  const patternRef = useRef(pattern);
  patternRef.current = pattern;
  useEffect(() => {
    if (compileErr) {
      setMatchResult(null);
      return undefined;
    }
    let cancelled = false;
    setLoadingMatch(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.match(patternRef.current, input);
        if (!cancelled) {
          if (r.ok) setMatchResult(r);
          else setMatchResult(null);
        }
      } finally {
        if (!cancelled) setLoadingMatch(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [pattern, input, compileErr]);

  const error = compileErr || parseResult?.error || null;
  const ast = parseResult?.ast || null;

  const loadExample = (ex) => {
    setPattern(ex.pattern);
    setInput(ex.sample);
    setTab('match');
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>正则状态机可视化调试器</h1>
        <span className="sub">Thompson NFA → 子集构造 DFA → Hopcroft 最小化 → 回溯匹配逐帧放映</span>
      </header>

      <div className="main-grid">
        {/* 左栏：输入 + AST */}
        <div className="col">
          <div className="section">
            <h2>正则表达式</h2>
            <PatternInput value={pattern} onChange={setPattern} error={error} />
            {!error && (
              <div style={{ marginTop: 8 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 3 }}>源码片段（悬停右侧 AST 节点联动）：</div>
                <PatternSourceView source={pattern} hoverRange={hoverRange} />
              </div>
            )}
          </div>
          <div className="section">
            <h2>抽象语法树 AST</h2>
            {error ? (
              <div className="muted">修正语法错误后生成 AST</div>
            ) : (
              <ASTTree ast={ast} hoverRange={hoverRange} onHover={setHoverRange} />
            )}
            {compiled?.groups?.length > 0 && (
              <div style={{ marginTop: 8 }} className="muted">
                捕获组：{compiled.groups.map((g, i) => `#${i + 1}`).join('、')}
              </div>
            )}
          </div>
          <ExamplesPanel onSelect={loadExample} />
        </div>

        {/* 中栏：自动机/匹配画布 */}
        <div className="col" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div className="tabs">
            {TABS.map((t) => (
              <div key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </div>
            ))}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {error && (
              <div className="hint-banner" style={{ margin: 12 }}>
                当前正则有语法错误，修正后即可构造自动机。
              </div>
            )}
            {!error && compiled && tab === 'nfa' && <NFABuildView nfa={compiled.nfa} />}
            {!error && compiled && tab === 'dfa' && <DfaBuildView dfa={compiled.dfa} />}
            {!error && compiled && tab === 'min' &&
              (compiled.minDfa ? (
                <MinBuildView minDfa={compiled.minDfa} dfa={compiled.dfa} />
              ) : (
                <div className="hint-banner">DFA 已因状态上限被截断，跳过最小化。</div>
              ))}
            {!error && compiled && tab === 'match' && (
              <MatchView
                nfa={compiled.nfa}
                dfa={compiled.dfa}
                minDfa={compiled.minDfa}
                matchResult={matchResult}
                input={input}
                analysis={matchResult?.analysis}
              />
            )}
            {!error && compiled && tab === 'compare' && (
              <CompareView nfa={compiled.nfa} matchResult={matchResult} input={input} />
            )}
          </div>
        </div>

        {/* 右栏：测试串 + 统计 */}
        <div className="col">
          <div className="section">
            <h2>测试字符串</h2>
            <input
              className="text-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入要匹配的文本"
              spellCheck={false}
            />
            {loadingMatch && <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>计算中…</div>}
            {matchResult && (
              <div className={`consistency ${matchResult.consistent ? 'ok' : 'bad'}`} style={{ marginTop: 6 }}>
                {matchResult.consistent
                  ? '✓ 核心自洽性校验通过：NFA / DFA / 最小化 DFA / 回溯 四者结论完全一致'
                  : '✗ 自检失败：引擎之间结论不一致'}
              </div>
            )}
          </div>

          <div className="section">
            <h2>自动机构造结果</h2>
            {compiled && (
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="num">{compiled.nfa.states.length}</div>
                  <div className="lbl">NFA 状态</div>
                </div>
                <div className="stat-card">
                  <div className="num">{compiled.nfa.edges.length}</div>
                  <div className="lbl">NFA 转移</div>
                </div>
                <div className="stat-card">
                  <div className="num">{compiled.dfa.states.length}</div>
                  <div className="lbl">子集构造 DFA 状态</div>
                </div>
                <div className="stat-card">
                  <div className="num">{compiled.minDfa?.afterCount ?? '—'}</div>
                  <div className="lbl">最小化后状态</div>
                </div>
              </div>
            )}
            {compiled?.dfa?.truncated && (
              <div className="hint-banner" style={{ margin: '8px 0 0' }}>⛔ {compiled.dfa.truncateReason}</div>
            )}
          </div>

          <div className="section">
            <h2>回溯性能分析</h2>
            {matchResult ? (
              <BacktrackSummary matchResult={matchResult} input={input} />
            ) : (
              <div className="muted">输入测试串后显示。</div>
            )}
          </div>

          <div className="section">
            <h2>引擎语义说明</h2>
            <div className="lesson">
              <div className="part">本工具的正则采用 <b>搜索语义</b>（与 JS <code>regex.test()</code> 一致）：可在输入任意位置命中；<code>^</code>/<code>$</code> 分别约束行首与行尾。</div>
              <div className="part">NFA 集合模拟与 DFA 线性执行、<b>不回溯</b>；回溯引擎按贪婪（优先多吃）/懒惰（优先退出）试路并记录回退。</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BacktrackSummary({ matchResult, input }) {
  const bt = matchResult.engines.backtrack;
  const n = Math.max(Array.from(input).length, 1);
  const quadratic = !bt.capped && n >= 8 && bt.stats.transitions > n * n * 2;
  const level = matchResult.analysis?.level;
  return (
    <div>
      <StatsInline stats={bt.stats} capped={bt.capped} quadratic={quadratic} />
      {level === 'exponential' &&
        matchResult.analysis.static.findings
          .filter((f) => f.level === 'exponential')
          .slice(0, 2)
          .map((f, i) => (
            <div key={i} className="warning-box exponential">
              <div className="title">⛔ {f.title}</div>
              <div className="advice">{f.advice}</div>
            </div>
          ))}
      {quadratic && level !== 'exponential' && (
        <div className="warning-box polynomial">
          <div className="title">⚠️ 转移数相对输入长度呈平方级增长（&gt;2n²）</div>
          <div className="advice">检查相邻重复项的字符集是否重叠；生产环境可换用线性 DFA 执行。</div>
        </div>
      )}
    </div>
  );
}

function StatsInline({ stats, capped, quadratic }) {
  // 直接复用 StatsPanel 的卡片外观
  return (
    <div>
      <div className="stat-grid">
        <div className="stat-card"><div className="num">{stats.transitions}</div><div className="lbl">转移次数</div></div>
        <div className={`stat-card ${stats.backtracks ? 'danger' : ''}`}><div className="num">{stats.backtracks}</div><div className="lbl">回溯次数</div></div>
        <div className="stat-card"><div className="num">{stats.visitedStates}</div><div className="lbl">访问状态数</div></div>
        <div className={`stat-card ${capped || quadratic ? 'danger' : ''}`}><div className="num">{capped ? '截断' : quadratic ? 'Ω(n²)' : '正常'}</div><div className="lbl">增长趋势</div></div>
      </div>
      {capped && (
        <div className="warning-box exponential">
          <div className="title">⛔ 执行被步数上限截断：疑似灾难性回溯</div>
          <div className="advice">典型如 <code>(a+)+</code>：失败时尝试次数指数爆炸。改写为 <code>a+</code> 这类无嵌套重复的形式，或改用 DFA 执行模式。</div>
        </div>
      )}
    </div>
  );
}
