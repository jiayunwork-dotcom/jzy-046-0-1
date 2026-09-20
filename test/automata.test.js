import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../server/engine/compile.js';
import { nfaMatch, backtrackMatch, dfaMatch } from '../server/engine/match.js';

// 对一批固定用例，验证 NFA、子集构造 DFA、最小化 DFA、回溯四者结论一致，
// 并与原生 JS RegExp 的搜索语义对齐。
const CASES = [
  ['a', 'a', true], ['a', 'b', false], ['a', 'ba', true],
  ['ab', 'xabx', true],
  ['ab*c', 'ac', true], ['ab*c', 'abbbc', true], ['ab*c', 'abx', false],
  ['ab+c', 'ac', false], ['ab+c', 'abc', true],
  ['colou?r', 'color', true], ['colou?r', 'colour', true],
  ['a|b', 'a', true], ['a|b', 'b', true], ['a|b', 'c', false],
  ['[a-z]+', 'hello', true], ['[a-z]+', 'Hello1', true /* 搜索命中 ello */],
  ['[^0-9]+', 'abc', true], ['[^0-9]+', '123', false],
  ['\\d{3}-\\d{4}', 'tel 123-4567 !', true],
  ['\\w+@\\w+\\.\\w+', 'ada@example.com', true],
  ['(https?://)?\\w+\\.com', 'http://x.com', true],
  ['(ab)+', 'ababab', true], ['(ab)+', 'aba', true /* 搜索命中 ab */],
  ['a{2,3}', 'aa', true], ['a{2,3}', 'a', false], ['a{2,3}', 'aaaa', true],
  ['.*', 'anything 123!', true],
  ['^abc', 'abc', true], ['^abc', 'xabc', false],
  ['abc$', 'abc', true], ['abc$', 'abcx', false],
  ['^a*$', 'aaa', true], ['^a*$', 'aab', false],
  ['^$', '', true], ['^$', 'x', false],
  ['^a|b$', 'axb', true], ['^a|b$', 'c', false],
  ['.*?', '"one" two', true],
  ['\\s+', 'a b', true], ['\\s+', 'abc', false],
];

test('固定用例：四引擎与原生 RegExp 全部一致', () => {
  for (const [pat, input, expected] of CASES) {
    const c = compile(pat);
    assert.equal(c.dfa.truncated, false, `${pat} 不应截断`);
    const n = nfaMatch(c.nfa, input).accepted;
    const b = backtrackMatch(c.nfa, input).accepted;
    const d = dfaMatch(c.dfa, input).accepted;
    const m = dfaMatch(c.minDfa, input).accepted;
    const js = new RegExp(pat).test(input);
    assert.equal(n, expected, `NFA ${pat} vs ${JSON.stringify(input)}`);
    assert.equal(b, expected, `回溯 ${pat}`);
    assert.equal(d, expected, `DFA ${pat}`);
    assert.equal(m, expected, `最小化 DFA ${pat}`);
    assert.equal(js, expected, `JS ${pat}`);
    assert.ok(n === b && b === d && d === m, `四引擎不一致 ${pat}`);
  }
});

test('最小化不改变接受语言，且状态数不增', () => {
  const pats = ['a(b|c)*d', '[0-9]+\\.[0-9]+', '(a|b)*abb', 'x?y+z{2,3}', '^hello$'];
  for (const p of pats) {
    const c = compile(p);
    assert.ok(c.minDfa.afterCount <= c.dfa.states.length, `${p} 最小化后状态数不应增多`);
    assert.equal(c.minDfa.beforeCount, c.dfa.states.length);
    for (const s of ['', 'a', 'abb', '12.3', 'xayyzz', 'hello', 'hellox']) {
      const before = dfaMatch(c.dfa, s).accepted;
      const after = dfaMatch(c.minDfa, s).accepted;
      assert.equal(after, before, `${p} 在 ${JSON.stringify(s)} 上最小化前后结论不一致`);
    }
  }
});

test('子集构造：每个 DFA 状态都带非空 NFA 集合', () => {
  const c = compile('(a|b)*c');
  for (const s of c.dfa.states) {
    assert.ok(Array.isArray(s.nfaSet) && s.nfaSet.length > 0);
  }
  // 起始 DFA 状态必须包含 NFA 起始态（闭包后）
  assert.ok(c.dfa.states[0].nfaSet.includes(c.nfa.start));
});

test('Thompson 构造步骤序列可逐条重放，最终覆盖全部状态与边', () => {
  const c = compile('a+b*');
  const states = new Set();
  const edges = new Set();
  for (const step of c.nfa.steps) {
    step.adds.states.forEach((id) => states.add(id));
    step.adds.edges.forEach((id) => edges.add(id));
  }
  assert.equal(states.size, c.nfa.states.size);
  assert.equal(edges.size, c.nfa.edges.size);
  assert.ok(states.has(c.nfa.start));
  assert.ok(states.has(c.nfa.accept));
});

test('DFA 状态上限截断', () => {
  // 大量互斥字符类制造状态膨胀；用很小的 limit 触发截断
  const c = compile('[^ab][^ac][^ad][^ae][^af][^ag][^ah]', { dfaLimit: 8 });
  assert.equal(c.dfa.truncated, true);
  assert.ok(c.dfa.states.length <= 8);
});

test('随机正则：四引擎与原生 RegExp 一致性', () => {
  const atoms = ['a', 'b', '\\d', '[ab]', '[^ab]', '.', '^', '$'];
  const rnd = (n) => Math.floor(Math.random() * n);
  function gen(depth) {
    const parts = [];
    const k = 1 + rnd(3);
    for (let i = 0; i < k; i += 1) {
      let e = depth > 0 && Math.random() < 0.3 ? `(?:${gen(depth - 1)})` : atoms[rnd(atoms.length)];
      if (Math.random() < 0.55) e += ['*', '+', '?', '{2}', '{1,3}'][rnd(5)] + (Math.random() < 0.2 ? '?' : '');
      parts.push(e);
    }
    let s = parts.join('');
    if (depth > 0 && Math.random() < 0.25) s = `${s}|${gen(depth - 1)}`;
    return s;
  }
  const alpha = ['a', 'b', '3', '.', ' ', ''];
  const genStr = () => Array.from({ length: rnd(6) }, () => alpha[rnd(alpha.length)]).join('');

  let checked = 0;
  for (let t = 0; t < 120; t += 1) {
    const p = gen(2);
    let re;
    try {
      re = new RegExp(p);
    } catch {
      continue;
    }
    const c = compile(p);
    if (c.dfa.truncated) continue;
    for (let u = 0; u < 5; u += 1) {
      const s = genStr();
      checked += 1;
      const want = re.test(s);
      assert.equal(nfaMatch(c.nfa, s).accepted, want, `NFA ${p} / ${JSON.stringify(s)}`);
      assert.equal(backtrackMatch(c.nfa, s).accepted, want, `BT ${p} / ${JSON.stringify(s)}`);
      assert.equal(dfaMatch(c.minDfa, s).accepted, want, `DFA ${p} / ${JSON.stringify(s)}`);
    }
  }
  assert.ok(checked > 200, `随机用例数应足够多，实际 ${checked}`);
});
