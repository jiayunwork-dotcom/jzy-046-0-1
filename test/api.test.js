import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../server/index.js';
import http from 'node:http';

// 直接把 Express app 挂到随机端口，用 fetch 打真实 HTTP。
let server;
let base;
before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

test('/api/parse 成功返回 AST 树', async () => {
  const r = await post('/api/parse', { pattern: 'a|b' });
  assert.equal(r.ok, true);
  assert.equal(r.ast.tree.type, 'alt');
  assert.ok(r.ast.tree.children.length === 2);
});

test('/api/parse 语法错误带定位', async () => {
  const r = await post('/api/parse', { pattern: '(' });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error.message, 'string');
  assert.equal(r.error.index, 0);
});

test('/api/compile 返回三套自动机与静态分析', async () => {
  const r = await post('/api/compile', { pattern: 'ab*c' });
  assert.equal(r.ok, true);
  assert.ok(r.nfa.states.length > 0);
  assert.ok(r.nfa.steps.length > 0);
  assert.ok(r.dfa.states.length > 0);
  assert.ok(r.minDfa.afterCount >= 1);
  assert.ok(r.minDfa.afterCount <= r.dfa.states.length);
  assert.ok(['safe', 'polynomial', 'exponential'].includes(r.analysis.level));
  // 布局坐标存在
  assert.ok(typeof r.nfa.width === 'number');
  assert.ok(typeof r.dfa.width === 'number');
});

test('/api/match 四引擎一致并返回帧与统计', async () => {
  const r = await post('/api/match', { pattern: '[a-z]+', input: 'abc123' });
  assert.equal(r.ok, true);
  assert.equal(r.accepted, true);
  assert.equal(r.consistent, true);
  for (const key of ['dfa', 'nfa', 'backtrack', 'greedy', 'lazy']) {
    assert.ok(Array.isArray(r.engines[key].frames));
    assert.ok(r.engines[key].frames.length > 0);
    assert.equal(typeof r.engines[key].stats.transitions, 'number');
  }
});

test('/api/match 灾难正则：截断标记与等级', async () => {
  const r = await post('/api/match', { pattern: '(a+)+b', input: 'a'.repeat(24) + '!', cap: 10000 });
  assert.equal(r.engines.backtrack.capped, true);
  assert.equal(r.analysis.level, 'exponential');
  assert.equal(r.consistent, true);
  // DFA 引擎线性，没有 backtracks
  assert.equal(r.engines.dfa.stats.backtracks, 0);
});

test('/api/examples 返回教学案例且字段完整', async () => {
  const r = await fetch(base + '/api/examples').then((x) => x.json());
  assert.equal(r.ok, true);
  assert.ok(r.examples.length >= 5);
  for (const ex of r.examples) {
    assert.ok(ex.id && ex.name && ex.pattern && ex.sample);
    assert.ok(Array.isArray(ex.parts) && ex.parts.length > 0);
    assert.ok(typeof ex.watch === 'string');
  }
});

test('静态资源：根路径返回前端页面', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<div id="root">/);
});
