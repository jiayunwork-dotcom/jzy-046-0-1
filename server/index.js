import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import {
  compile,
  serializeNFA,
  serializeDFA,
  serializeMinDfa,
  serializeAST,
  ParseError,
} from './engine/compile.js';
import { dfaMatch, nfaMatch, backtrackMatch } from './engine/match.js';
import { analyzeRuntime } from './engine/analyze.js';
import { EXAMPLES } from './engine/examples.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../web/dist');

const app = express();
app.use(express.json({ limit: '1mb' }));

function errorResponse(res, err) {
  if (err instanceof ParseError) {
    return res.status(200).json({
      ok: false,
      error: { message: err.message, index: err.index, length: err.length },
    });
  }
  return res.status(500).json({ ok: false, error: { message: String(err.message || err) } });
}

// 轻量解析：输入框实时调用，只要 AST + 错误定位
app.post('/api/parse', (req, res) => {
  try {
    const pattern = String(req.body.pattern ?? '');
    const { ast, groups } = compileFresh(pattern);
    return res.json({ ok: true, ast: serializeAST(ast), groups });
  } catch (err) {
    return errorResponse(res, err);
  }
});

// 完整编译：AST + NFA + DFA + 最小化 + 静态分析
app.post('/api/compile', (req, res) => {
  try {
    const pattern = String(req.body.pattern ?? '');
    const dfaLimit = Math.min(2048, Math.max(16, Number(req.body.dfaLimit) || 256));
    const result = compile(pattern, { dfaLimit });
    return res.json({
      ok: true,
      groups: result.groups,
      ast: serializeAST(result.ast),
      nfa: serializeNFA(result.nfa),
      dfa: serializeDFA(result.dfa),
      minDfa: serializeMinDfa(result.minDfa),
      analysis: result.analysis,
    });
  } catch (err) {
    return errorResponse(res, err);
  }
});

// 匹配：一次返回三套引擎的帧序列与统计
app.post('/api/match', (req, res) => {
  try {
    const pattern = String(req.body.pattern ?? '');
    const input = String(req.body.input ?? '');
    const dfaLimit = Math.min(2048, Math.max(16, Number(req.body.dfaLimit) || 256));
    const cap = Math.min(200000, Math.max(100, Number(req.body.cap) || 20000));
    const result = compile(pattern, { dfaLimit });

    const dfa = dfaMatch(result.minDfa || result.dfa, input);
    const nfa = nfaMatch(result.nfa, input);
    const native = backtrackMatch(result.nfa, input, { mode: 'native', cap });
    const greedy = backtrackMatch(result.nfa, input, { mode: 'greedy', cap });
    const lazy = backtrackMatch(result.nfa, input, { mode: 'lazy', cap });

    // 核心自洽性校验：三套引擎结论必须一致
    const consistent =
      dfa.accepted === nfa.accepted &&
      dfa.accepted === native.accepted;

    const runtime = analyzeRuntime(native.stats, Array.from(input).length, result.analysis);

    res.json({
      ok: true,
      accepted: native.accepted,
      consistent,
      engines: {
        dfa: { frames: dfa.frames, stats: dfa.stats, accepted: dfa.accepted },
        nfa: { frames: nfa.frames, stats: nfa.stats, accepted: nfa.accepted },
        backtrack: {
          frames: native.frames,
          stats: native.stats,
          accepted: native.accepted,
          capped: native.capped,
        },
        greedy: { frames: greedy.frames, stats: greedy.stats, accepted: greedy.accepted, capped: greedy.capped },
        lazy: { frames: lazy.frames, stats: lazy.stats, accepted: lazy.accepted, capped: lazy.capped },
      },
      analysis: runtime,
    });
  } catch (err) {
    return errorResponse(res, err);
  }
});

app.get('/api/examples', (_req, res) => res.json({ ok: true, examples: EXAMPLES }));

// —— 前端静态产物 ——
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
} else {
  app.get('/', (_req, res) =>
    res.status(200).send('前端尚未构建：请先运行 npm run build（开发模式可用 npm run dev:web）'),
  );
}

function compileFresh(pattern) {
  const result = compile(pattern);
  return { ast: result.ast, groups: result.groups };
}

const PORT = process.env.PORT || 3000;

// 仅在作为入口直接运行时才监听端口；被测试 import 时只导出 app。
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  app.listen(PORT, () => {
    console.log(`正则可视化调试器已启动: http://localhost:${PORT}`);
  });
}

export { app };
