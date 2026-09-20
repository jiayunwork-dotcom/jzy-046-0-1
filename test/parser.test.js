import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, ParseError } from '../server/engine/parser.js';

test('字面字符与串联', () => {
  const ast = parse('abc');
  assert.equal(ast.type, 'concat');
  assert.equal(ast.items.length, 3);
  assert.equal(ast.items[0].type, 'char');
  assert.equal(ast.items[0].code, 97);
  // 源码区间
  assert.deepEqual([ast.s, ast.e], [0, 3]);
});

test('字符类：区间与取反，区间集合正确', () => {
  const ast = parse('[a-c]');
  assert.equal(ast.type, 'class');
  assert.deepEqual(ast.set, [[97, 99]]);
  const neg = parse('[^0-9]');
  assert.equal(neg.negated, true);
  assert.ok(neg.set.some(([lo, hi]) => lo === 0 && hi === 47));
  assert.ok(neg.set.some(([lo, hi]) => lo === 58));
});

test('预定义类 \\d \\w \\s 及大写取反', () => {
  assert.deepEqual(parse('\\d').set, [[48, 57]]);
  const w = parse('\\w');
  assert.ok(w.set.some(([lo, hi]) => lo === 65 && hi === 90));
  assert.ok(w.set.some(([lo, hi]) => lo === 97 && hi === 122));
  const S = parse('\\S');
  assert.equal(S.negated !== undefined, true);
  // \S 不应包含空格
  assert.ok(!S.set.some(([lo, hi]) => lo <= 32 && 32 <= hi));
});

test('量词：* + ? {n} {n,m} 与贪婪/懒惰标记', () => {
  assert.equal(parse('a*').max, null);
  assert.equal(parse('a*').min, 0);
  assert.equal(parse('a+').min, 1);
  assert.equal(parse('a?').min, 0);
  assert.equal(parse('a?').max, 1);
  assert.equal(parse('a{3}').min, 3);
  assert.equal(parse('a{3}').max, 3);
  assert.equal(parse('a{2,4}').min, 2);
  assert.equal(parse('a{2,4}').max, 4);
  assert.equal(parse('a{2,}').max, null);
  assert.equal(parse('a*').lazy, false);
  assert.equal(parse('a*?').lazy, true);
});

test('捕获组与非捕获组、选择分支、锚点', () => {
  const g = parse('(a)(?:b)');
  assert.equal(g.items[0].capturing, true);
  assert.equal(g.items[0].index, 1);
  assert.equal(g.items[1].capturing, false);
  const alt = parse('a|b|c');
  assert.equal(alt.type, 'alt');
  assert.equal(alt.options.length, 3);
  assert.equal(parse('^').type, 'anchor');
  assert.equal(parse('$').type, 'anchor');
});

test('锚点类型正确', () => {
  const a = parse('^x');
  assert.equal(a.items[0].type, 'anchor');
  assert.equal(a.items[0].kind, 'start');
  const b = parse('x$');
  assert.equal(b.items[1].kind, 'end');
  assert.equal(parse('^').kind, 'start');
  assert.equal(parse('$').kind, 'end');
});

test('捕获组登记表', () => {
  const ast = parse('(a)(?:b)(c)');
  assert.equal(ast.groups.length, 2);
  assert.equal(ast.groups[0].index, 1);
  assert.equal(ast.groups[1].index, 2);
});

test('错误：括号未闭合并定位', () => {
  try {
    parse('(ab');
    assert.fail('应抛错');
  } catch (e) {
    assert.ok(e instanceof ParseError);
    assert.equal(e.index, 0);
    assert.match(e.message, /闭合/);
  }
});

test('错误：字符类未闭合', () => {
  assert.throws(() => parse('[a-z'), (e) => e instanceof ParseError && e.index === 0);
});

test('错误：{3,2} 非法量词范围', () => {
  try {
    parse('a{3,2}');
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof ParseError);
    assert.equal(e.index, 1);
    assert.match(e.message, /下限大于上限|非法/);
  }
});

test('错误：量词前缺项、未匹配右括号', () => {
  assert.throws(() => parse('*a'), (e) => e.index === 0);
  assert.throws(() => parse(')'), (e) => e.index === 0 && /右括号|匹配/.test(e.message));
});

test('裸大括号按字面字符处理', () => {
  const ast = parse('a{}b');
  const codes = ast.items.filter((n) => n.type === 'char').map((n) => n.code);
  assert.ok(codes.includes(123)); // {
  assert.ok(codes.includes(125)); // }
});

test('转义字符', () => {
  assert.equal(parse('\\.').code, 46);
  assert.equal(parse('\\n').code, 10);
  assert.equal(parse('\\u0041').code, 65);
});

test('不支持的高级语法给出明确错误', () => {
  assert.throws(() => parse('a(?=b)'), /前瞻/);
  assert.throws(() => parse('\\bword'), /边界/);
});
