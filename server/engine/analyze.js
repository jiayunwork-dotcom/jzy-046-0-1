// 灾难性回溯静态分析：扫描 AST 找出危险结构，并结合运行时统计给出结论与改写建议。

// 递归遍历 AST
function walk(node, fn, parent = null) {
  if (!node || typeof node !== 'object') return;
  fn(node, parent);
  switch (node.type) {
    case 'concat':
      node.items.forEach((c) => walk(c, fn, node));
      break;
    case 'alt':
      node.options.forEach((c) => walk(c, fn, node));
      break;
    case 'group':
    case 'repeat':
      walk(node.atom || node.child, fn, node);
      break;
    default:
      break;
  }
}

// 判断两个子表达式的字符集是否相交（粗略但保守：宁可误报）
function charSetOf(node) {
  if (!node) return null;
  if (node.type === 'char') return [[node.code, node.code]];
  if (node.type === 'class' || node.type === 'dot') return node.set;
  if (node.type === 'group') return charSetOf(node.child);
  if (node.type === 'repeat') return charSetOf(node.atom);
  return null; // 未知（如 alt/concat），保守视为可能重叠
}

import { intersect } from './charsets.js';

function canOverlap(a, b) {
  const sa = charSetOf(a);
  const sb = charSetOf(b);
  if (sa && sb) return intersect(sa, sb).length > 0;
  return true; // 无法确定时保守报告
}

const KNOWN = [
  {
    test: (src) => /\(\w+\+\)\+/.test(src) || /\(.\*\+\)\+/.test(src),
    level: 'exponential',
    title: '嵌套量词：(x+)+ 型指数级回溯',
    advice: '把嵌套量词拍平，例如 (a+)+ 改写为 a+；若需要分组语义，用 (?:a+) 并去掉外层 +，或给出互斥的分隔结构如 a+(?:a+)* 也无必要——直接 a+。',
  },
  {
    test: (src) => /\(.*\)\\?[*+]/.test(src) && /\|/.test(src),
    level: 'exponential',
    title: '含分支的嵌套重复',
    advice: '让分支的首字符互不相交（如 (?:ab|cd)+ 安全，(?:a|ab)+ 危险），或改用非回溯思路（占有量词/原子组，本引擎中可直接用 DFA 模式匹配）。',
  },
  {
    test: (src) => /\(\\?d\+\)\\?d/.test(src),
    level: 'polynomial',
    title: '重复体与后续字符可重叠：(\\d+)\\d 型平方级回溯',
    advice: '把重叠的边界说清楚，例如 (\\d+)\\d 改为 \\d{2,}（直接要求至少两位），或用更精确的结尾锚定 \\d+(?=\\d$) 之类。',
  },
];

export function analyzeAST(ast, source) {
  const findings = [];

  // 1) 已知模式快速识别
  for (const k of KNOWN) {
    try {
      if (k.test(source)) {
        findings.push({ level: k.level, title: k.title, advice: k.advice, s: 0, e: source.length });
      }
    } catch {
      /* ignore */
    }
  }

  // 2) 结构扫描：嵌套量词 / 相邻可重叠的重复项
  walk(ast, (node, parent) => {
    if (node.type === 'repeat') {
      // 重复体内部本身又是无界重复 → 指数级
      if (containsUnboundedRepeat(node.atom) && node.max === null) {
        const inner = findInnerRepeat(node.atom);
        if (inner) {
          findings.push({
            level: 'exponential',
            title: `嵌套无界量词（${source.slice(node.s, node.e)}）：失败时尝试次数随输入指数增长`,
            advice: '消除嵌套：把两层重复合并成一层，或让内外层匹配的字符集合互斥。',
            s: node.s,
            e: node.e,
          });
        }
      }
      // 串联中相邻的两个无界重复，字符集相交 → 多项式级
      if (parent && parent.type === 'concat' && node.max === null) {
        const idx = parent.items.indexOf(node);
        const next = parent.items[idx + 1];
        if (next && isUnboundedStart(next) && canOverlap(node.atom, firstAtom(next))) {
          findings.push({
            level: 'polynomial',
            title: `相邻的可重叠重复（${source.slice(node.s, next.e)}）：匹配失败时可能出现平方级回溯`,
            advice: '让两个重复部分的字符集互斥（一个吃字母、一个吃数字），或用更精确的结构表达。',
            s: node.s,
            e: next.e,
          });
        }
      }
    }
  });

  // 去重
  const seen = new Set();
  const deduped = findings.filter((f) => {
    const key = f.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const worst = deduped.some((f) => f.level === 'exponential')
    ? 'exponential'
    : deduped.some((f) => f.level === 'polynomial')
      ? 'polynomial'
      : 'safe';

  return { level: worst, findings: deduped };
}

function containsUnboundedRepeat(node) {
  let found = false;
  walk(node, (n) => {
    if (n.type === 'repeat' && n.max === null) found = true;
  });
  return found;
}
function findInnerRepeat(node) {
  let hit = null;
  walk(node, (n) => {
    if (!hit && n.type === 'repeat' && n.max === null) hit = n;
  });
  return hit;
}
function isUnboundedStart(node) {
  if (node.type === 'repeat') return node.max === null;
  if (node.type === 'group') return isUnboundedStart(node.child);
  if (node.type === 'concat') return node.items.length > 0 && isUnboundedStart(node.items[0]);
  return false;
}
function firstAtom(node) {
  if (node.type === 'repeat') return node.atom;
  if (node.type === 'group') return firstAtom(node.child);
  if (node.type === 'concat') return firstAtom(node.items[0]);
  return node;
}

// 结合运行时统计做动态判断
export function analyzeRuntime({ transitions, backtracks, capped }, inputLength, staticResult) {
  const notes = [];
  if (capped) {
    notes.push({
      level: 'exponential',
      title: '执行被步数上限截断',
      advice: '这条正则在当前输入上实际表现出灾难性回溯。优先参考静态分析中的改写建议；或者改用 DFA 执行模式，DFA 对每个输入字符只走一步，不会回溯。',
    });
  }
  const n = Math.max(inputLength, 1);
  if (!capped && inputLength >= 8 && transitions > n * n * 2) {
    notes.push({
      level: 'polynomial',
      title: `转移次数 ${transitions} 相对输入长度 ${inputLength} 呈平方级（>2n²）增长`,
      advice: '检查相邻重复项的字符集是否重叠；生产环境可换用线性的 DFA 执行方式。',
    });
  }
  const levels = ['safe', 'polynomial', 'exponential'];
  const rank = (l) => levels.indexOf(l);
  const level = [
    capped ? 'exponential' : 'safe',
    notes.some((n2) => n2.level === 'polynomial') ? 'polynomial' : 'safe',
    staticResult.level,
  ].reduce((a, b) => (rank(b) > rank(a) ? b : a), 'safe');
  return { level, notes, static: staticResult };
}
