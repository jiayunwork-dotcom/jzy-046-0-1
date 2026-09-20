// 编排：源码字符串 -> { ast, nfa, dfa, minDfa, warnings }，并提供序列化。
import { parse, ParseError } from './parser.js';
import { buildNFA } from './nfa.js';
import { subsetConstruct, dfaAccepts } from './dfa.js';
import { minimizeDFA } from './minimize.js';
import { layoutNFA } from './layout.js';
import { analyzeAST } from './analyze.js';

export { ParseError };

export function compile(source, { dfaLimit = 256 } = {}) {
  const ast = parse(source);
  const nfa = buildNFA(ast);
  const layout = layoutNFA(nfa);
  nfa.layout = layout;
  const dfa = subsetConstruct(nfa, { limit: dfaLimit });
  const minDfa = dfa.truncated ? null : minimizeDFA(dfa);
  const analysis = analyzeAST(ast, source);
  return { source, ast, nfa, dfa, minDfa, analysis, groups: ast.groups };
}

// —— 供 JSON 响应的序列化（Map 转数组，坐标带上）——
export function serializeNFA(nfa) {
  return {
    start: nfa.start,
    accept: nfa.accept,
    states: [...nfa.states.values()],
    edges: [...nfa.edges.values()].map((e) => ({
      ...e,
      // 字符边的 set 在前端用于颜色提示，保留但裁掉超长区间
      set: e.set ? e.set.slice(0, 32) : undefined,
    })),
    splits: [...nfa.splits.entries()].map(([id, info]) => ({ state: id, ...info })),
    steps: nfa.steps,
    width: nfa.layout.width,
    height: nfa.layout.height,
    backEdges: nfa.layout.backEdgeIds,
  };
}

export function serializeDFA(dfa) {
  if (!dfa) return null;
  return {
    start: dfa.start,
    accept: dfa.accept,
    states: dfa.states.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      accepting: s.accepting,
      nfaSet: s.nfaSet,
    })),
    transitions: dfa.transitions,
    steps: dfa.steps,
    truncated: dfa.truncated,
    truncateReason: dfa.truncateReason,
    width: dfa.width,
    height: dfa.height,
  };
}

export function serializeMinDfa(m) {
  if (!m) return null;
  return {
    start: m.start,
    accept: m.accept,
    states: m.states.map((s) => ({ id: s.id, x: s.x, y: s.y, accepting: s.accepting, memberStates: s.memberStates })),
    transitions: m.transitions,
    steps: m.steps,
    beforeCount: m.beforeCount,
    afterCount: m.afterCount,
    width: m.width,
    height: m.height,
  };
}

// AST 转前端友好结构（groups 索引保持不变）
export function serializeAST(ast) {
  const label = (node) => {
    switch (node.type) {
      case 'char':
        return { type: 'char', text: labelChar(node.code) };
      case 'dot':
        return { type: 'dot', text: '.' };
      case 'class':
        return { type: 'class', text: describeClass(node) };
      case 'anchor':
        return { type: 'anchor', text: node.kind === 'start' ? '^' : '$' };
      case 'empty':
        return { type: 'empty', text: 'ε（空）' };
      case 'concat':
        return { type: 'concat', text: '串联' };
      case 'alt':
        return { type: 'alt', text: '选择 |' };
      case 'group':
        return { type: 'group', text: node.capturing ? `捕获组 #${node.index}` : '非捕获组' };
      case 'repeat': {
        const sym =
          node.max === null
            ? node.min === 0 ? '*' : node.min === 1 ? '+' : `{${node.min},}`
            : node.min === 0 && node.max === 1
              ? '?'
              : `{${node.min},${node.max}}`;
        return { type: 'repeat', text: `${sym} ${node.lazy ? '懒惰' : '贪婪'}` };
      }
      default:
        return { type: node.type, text: node.type };
    }
  };

  function toTree(node) {
    const meta = label(node);
    const tree = {
      type: meta.type,
      label: meta.text,
      s: node.s,
      e: node.e,
      children: [],
    };
    switch (node.type) {
      case 'concat':
        tree.children = node.items.map(toTree);
        break;
      case 'alt':
        tree.children = node.options.map((o, i) => ({
          type: 'branch',
          label: `分支 ${i + 1}`,
          s: o.s,
          e: o.e,
          children: [toTree(o)],
        }));
        break;
      case 'group':
        tree.children = [toTree(node.child)];
        break;
      case 'repeat':
        tree.children = [toTree(node.atom)];
        break;
      default:
        break;
    }
    return tree;
  }

  return { tree: toTree(ast), groups: ast.groups || [] };
}

function labelChar(code) {
  const ch = String.fromCodePoint(code);
  if (ch === ' ') return '空格';
  if (ch === '\n') return '\\n';
  if (ch === '\t') return '\\t';
  if (ch === '\r') return '\\r';
  return ch;
}

function describeClass(node) {
  const cp = (set) =>
    set
      .slice(0, 4)
      .map(([lo, hi]) => (lo === hi ? labelChar(lo) : `${labelChar(lo)}-${labelChar(hi)}`))
      .join('');
  const sh = node.shorthand.map((s) => '\\' + s).join(' ');
  const body = sh ? `${sh} ` : '';
  return `[${node.negated ? '^' : ''}${body}${cp(node.set)}]`;
}
