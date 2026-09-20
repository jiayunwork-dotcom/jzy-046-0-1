// Thompson 构造：AST -> NFA，并记录逐条构造规则（steps）供前端单步播放。
//
// NFA 数据结构：
//   {
//     start, accept,
//     states: Map<id, {id}>  （x/y 坐标由 layout.js 填）
//     edges:  Map<id, {id, from, to, type, label, set?, kind?, ast?, role?}>
//     splits: Map<splitStateId, {s,e,lazy,min,max,symbol}>
//     steps:  [ {kind, node:{s,e,type}, detail, adds:{states:[id], edges:[id]}} ]
//   }
// 边类型：'char'（含字符类，带 set 区间）| 'eps' | 'assert'（^/$，带 kind）
// 量词相关边的 role：'loop'（尝试重复体）| 'exit'（退出）| 'rejoin'（回到汇合点）

export function buildNFA(ast) {
  const ctx = {
    states: new Map(),
    edges: new Map(),
    splits: new Map(),
    steps: [],
  };
  let stateSeq = 0;
  let edgeSeq = 0;

  const addState = () => {
    const id = stateSeq++;
    ctx.states.set(id, { id });
    return id;
  };

  const addEdge = (from, to, type, extra = {}) => {
    const id = edgeSeq++;
    const edge = { id, from, to, type, ...extra };
    ctx.edges.set(id, edge);
    return edge;
  };

  // 登记一条 Thompson 规则：回调内新增的全部状态/边都归到这条步骤
  function rule(kind, node, detail, fn) {
    const s0 = stateSeq;
    const e0 = edgeSeq;
    const frag = fn();
    ctx.steps.push({
      kind,
      node: node && { type: node.type, s: node.s, e: node.e },
      detail,
      adds: {
        states: ids(s0, stateSeq),
        edges: ids(e0, edgeSeq),
      },
    });
    return frag;
  }

  function ids(from, to) {
    const out = [];
    for (let i = from; i < to; i += 1) out.push(i);
    return out;
  }

  const join = (a, b, node) => addEdge(a, b, 'eps', { label: 'ε', ast: ref(node), role: 'join' });
  const ref = (node) => (node ? { type: node.type, s: node.s, e: node.e } : null);

  function build(node) {
    switch (node.type) {
      case 'char':
        return rule('char', node, `字面字符 “${String.fromCodePoint(node.code)}”`, () => {
          const a = addState();
          const b = addState();
          addEdge(a, b, 'char', {
            label: String.fromCodePoint(node.code),
            set: [[node.code, node.code]],
            ast: ref(node),
          });
          return { in: a, out: b };
        });

      case 'dot':
        return rule('char', node, '通配符 “.”（除换行外任意字符）', () => {
          const a = addState();
          const b = addState();
          addEdge(a, b, 'char', { label: '.', set: node.set, ast: ref(node) });
          return { in: a, out: b };
        });

      case 'class':
        return rule('char', node, node.negated ? '取反字符类' : '字符类', () => {
          const a = addState();
          const b = addState();
          addEdge(a, b, 'char', { label: classLabel(node), set: node.set, ast: ref(node) });
          return { in: a, out: b };
        });

      case 'anchor':
        return rule('assert', node, node.kind === 'start' ? '行首锚点 “^”（位置 0 处的 ε）' : '行尾锚点 “$”（字符串末尾的 ε）', () => {
          const a = addState();
          const b = addState();
          addEdge(a, b, 'assert', { label: node.kind === 'start' ? '^' : '$', kind: node.kind, ast: ref(node) });
          return { in: a, out: b };
        });

      case 'empty':
        return rule('empty', node, '空表达式（ε 直接相连）', () => {
          const a = addState();
          const b = addState();
          addEdge(a, b, 'eps', { label: 'ε', ast: ref(node) });
          return { in: a, out: b };
        });

      case 'group':
        return rule('group', node, node.capturing ? `捕获组 #${node.index} (…)` : '非捕获组 (?:…)，结构与内部表达式相同', () => build(node.child));

      case 'concat':
        return rule('concat', node, `串联：依次连接 ${node.items.length} 个片段`, () => {
          let first = null;
          let prev = null;
          for (const item of node.items) {
            const f = build(item);
            if (first === null) first = f;
            if (prev !== null) join(prev.out, f.in, node);
            prev = f;
          }
          return { in: first.in, out: prev.out };
        });

      case 'alt':
        return rule('alt', node, `选择分支 |：新建分流(split)与汇合(join)状态，${node.options.length} 条路任选其一`, () => {
          const split = addState();
          const merge = addState();
          for (const opt of node.options) {
            const f = build(opt);
            addEdge(split, f.in, 'eps', { label: 'ε', ast: ref(node), role: 'branch' });
            addEdge(f.out, merge, 'eps', { label: 'ε', ast: ref(node), role: 'merge' });
          }
          return { in: split, out: merge };
        });

      case 'repeat':
        return buildRepeat(node);

      default:
        throw new Error('Thompson 构造：未知 AST 节点 ' + node.type);
    }
  }

  // 量词：贪婪时 split 的出边顺序为 [尝试重复体, 退出]；懒惰时相反。
  // 回溯引擎按出边顺序决定优先尝试哪条路；集合模拟 NFA / DFA 对顺序不敏感。
  function buildRepeat(node) {
    const { min, max, lazy } = node;
    const symbol =
      max === null
        ? min === 0 ? '*' : min === 1 ? '+' : `{${min},}`
        : min === 0 && max === 1
          ? '?'
          : `{${min},${max}}`;
    const mode = lazy ? '懒惰' : '贪婪';

    return rule('repeat', node, `${mode}量词 ${symbol}：split 决定“再试一次”还是“退出”，${lazy ? '懒惰优先退出' : '贪婪优先继续'}`, () => {
      const splitEdges = (split, bodyIn, target, labelCont, labelExit) => {
        if (lazy) {
          addEdge(split, target, 'eps', { label: labelExit, ast: ref(node), role: 'exit' });
          addEdge(split, bodyIn, 'eps', { label: labelCont, ast: ref(node), role: 'loop' });
        } else {
          addEdge(split, bodyIn, 'eps', { label: labelCont, ast: ref(node), role: 'loop' });
          addEdge(split, target, 'eps', { label: labelExit, ast: ref(node), role: 'exit' });
        }
      };

      let headIn = null;
      let lastOut = null;

      // —— 必选 min 次（普通串联）——
      for (let i = 0; i < min; i += 1) {
        const f = build(node.atom);
        if (headIn === null) headIn = f.in;
        if (lastOut !== null) join(lastOut, f.in, node);
        lastOut = f.out;
      }

      if (max === null) {
        // * / + / {n,}：一个带自环的 split
        const split = addState();
        const body = build(node.atom);
        const end = addState();
        if (lastOut !== null) join(lastOut, split, node);
        splitEdges(split, body.in, end, 'ε·再试一次', 'ε·退出');
        addEdge(body.out, split, 'eps', { label: 'ε·回到 split', ast: ref(node), role: 'rejoin' });
        ctx.splits.set(split, { ...ref(node), lazy, min, max, symbol });
        return { in: headIn !== null ? headIn : split, out: end };
      }

      const optional = max - min;
      if (optional === 1 && min === 0) {
        // a?
        const split = addState();
        const body = build(node.atom);
        const end = addState();
        splitEdges(split, body.in, end, 'ε·尝试匹配', 'ε·跳过');
        addEdge(body.out, end, 'eps', { label: 'ε', ast: ref(node), role: 'rejoin' });
        ctx.splits.set(split, { ...ref(node), lazy, min, max, symbol });
        return { in: split, out: end };
      }

      // {n,m}：optional 个串联起来的可选片段，每个配一个 split
      for (let k = 0; k < optional; k += 1) {
        const split = addState();
        const body = build(node.atom);
        const end = addState();
        if (lastOut !== null) join(lastOut, split, node);
        splitEdges(split, body.in, end, 'ε·再要一次', 'ε·不要了');
        addEdge(body.out, end, 'eps', { label: 'ε', ast: ref(node), role: 'rejoin' });
        ctx.splits.set(split, { ...ref(node), lazy, min, max, symbol });
        if (headIn === null) headIn = split;
        lastOut = end;
      }
      return { in: headIn, out: lastOut };
    });
  }

  const main = build(ast);

  // 搜索语义外壳：一条正则可以在输入的任意位置开始、任意位置结束
  // （与 JS RegExp 的 test() 语义一致，^/$ 只是位置约束）：
  //
  //   searchStart --(^位置的ε)--> main.in
  //              \--任意字符---> searchStart   （跳过前缀，从后面的位置再起）
  //   main.out --($位置的ε)--> searchAccept
  //            \--任意字符---> searchAccept   （匹配主体后跳过后缀）
  //   searchAccept --任意字符--> searchAccept
  //
  // 这样「全串匹配」自然成为搜索的特例（正则写了 ^…$ 时只有全串这一条路）。
  // 搜索语义外壳：一条正则可以在输入的任意位置开始、任意位置结束
  // （与 JS RegExp 的 test() 语义一致）。搜索重启不依赖 ^：
  //
  //   searchStart --ε--> main.in          每个位置都尝试把主体匹配一次
  //   searchStart --任意字符--> searchStart  跳过前缀（重启发生在下一位置）
  //   main.out --ε--> searchAccept        主体结束（位置约束由内部 ^/$ 表达）
  //   main.out --任意字符--> searchAccept  主体匹配后跳过后缀
  //   searchAccept --任意字符--> searchAccept
  const s0 = stateSeq;
  const e0 = edgeSeq;
  const searchStart = addState();
  const searchAccept = addState();
  addEdge(searchStart, main.in, 'eps', { label: 'ε·搜索', role: 'search-entry' });
  addEdge(searchStart, searchStart, 'char', {
    label: '任意',
    set: [[0, 0x10ffff]],
    role: 'search-skip',
  });
  addEdge(main.out, searchAccept, 'eps', { label: 'ε·命中', role: 'search-exit' });
  addEdge(main.out, searchAccept, 'char', {
    label: '任意',
    set: [[0, 0x10ffff]],
    role: 'search-skip',
  });
  addEdge(searchAccept, searchAccept, 'char', {
    label: '任意',
    set: [[0, 0x10ffff]],
    role: 'search-skip',
  });
  ctx.steps.push({
    kind: 'search',
    node: ref(ast),
    detail: '搜索语义外壳：每个输入位置都 ε-尝试一次主体匹配（左自环跳过前缀，右侧跳过后缀）',
    adds: { states: ids(s0, stateSeq), edges: ids(e0, edgeSeq) },
  });

  // 接受状态单独一条收尾规则
  const s1 = stateSeq;
  const e1 = edgeSeq;
  const accept = addState();
  addEdge(searchAccept, accept, 'eps', { label: 'ε', role: 'accept-link' });
  ctx.steps.push({
    kind: 'accept',
    node: ref(ast),
    detail: '标记接受状态（双圈）：走到这里即说明输入中存在一处匹配',
    adds: { states: ids(s1, stateSeq), edges: ids(e1, edgeSeq) },
  });

  return {
    start: searchStart,
    accept,
    states: ctx.states,
    edges: ctx.edges,
    splits: ctx.splits,
    steps: ctx.steps,
  };
}

function classLabel(node) {
  const sh = node.shorthand.map((s) => '\\' + s).join('');
  return node.negated ? `取反类 ${sh || '[^…]'}` : `字符类 ${sh || '[…]'}`;
}
