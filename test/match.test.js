import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../server/engine/compile.js';
import { backtrackMatch, nfaMatch } from '../server/engine/match.js';
import { analyzeAST, analyzeRuntime } from '../server/engine/analyze.js';
import { parse } from '../server/engine/parser.js';

test('回溯帧：成功路径包含字符消费帧与最终接受帧', () => {
  const c = compile('ab+c');
  const r = backtrackMatch(c.nfa, 'xabbc');
  assert.equal(r.accepted, true);
  assert.ok(r.frames.some((f) => f.kind === 'consume' && f.char === 'a'));
  assert.ok(r.frames.some((f) => f.kind === 'consume' && f.char === 'c'));
  assert.equal(r.frames.at(-1).kind, 'accept');
  // 每条消费帧都带边引用
  for (const f of r.frames) if (f.kind === 'consume') assert.ok(f.edge && typeof f.edge.id === 'number');
});

test('失败时产生回溯帧，路径状态被记录', () => {
  const c = compile('ab*c');
  const r = backtrackMatch(c.nfa, 'abx');
  assert.equal(r.accepted, false);
  assert.ok(r.stats.backtracks > 0);
  const bt = r.frames.filter((f) => f.kind === 'backtrack');
  assert.ok(bt.length > 0);
  // 回溯帧记录从哪个状态退出
  assert.ok(bt.some((f) => f.fromState !== undefined));
  assert.equal(r.frames.at(-1).kind, 'reject');
});

test('贪婪先多吃、懒惰先退出：轨迹差异体现在帧序列与回溯次数', () => {
  // a* 对 "aaa"：贪婪一口气吃完（loop 3 次再 exit），懒惰每次 split 立刻 exit。
  const c = compile('a*');
  const greedy = backtrackMatch(c.nfa, 'aaa', { mode: 'greedy' });
  const lazy = backtrackMatch(c.nfa, 'aaa', { mode: 'lazy' });
  assert.equal(greedy.accepted, lazy.accepted);
  // 贪婪在第一个搜索位置就消费 3 个 a；懒惰在位置 0 消费 0 个 a 即命中（空匹配也算成功路径），
  // 走到接受的轨迹中贪婪的字符消费帧数更多
  const greedyConsume = greedy.frames.filter((f) => f.kind === 'consume').length;
  const lazyConsume = lazy.frames.filter((f) => f.kind === 'consume').length;
  assert.notDeepEqual(
    greedy.frames.map((f) => f.kind),
    lazy.frames.map((f) => f.kind),
    '贪婪与懒惰的帧序列应当不同',
  );
  // 区别体现在 split 处的 ε 决策：贪婪反复 loop（“再试一次”），懒惰立即 exit，
  // 因此贪婪的 ε 决策帧与回溯次数都更多。
  const greedyEps = greedy.frames.filter((f) => f.kind === 'epsilon').length;
  const lazyEps = lazy.frames.filter((f) => f.kind === 'epsilon').length;
  assert.ok(greedyEps > lazyEps, `贪婪 ε 决策应更多 ${greedyEps} vs ${lazyEps}`);
  assert.ok(greedy.stats.backtracks >= lazy.stats.backtracks);

  // 对引号串：贪婪与懒惰走出的轨迹与回溯数确实不同（具体谁多取决于输入与搜索位置）
  const c2 = compile('".*?"');
  const s = '"a" and "b"';
  const forcedGreedy = backtrackMatch(c2.nfa, s, { mode: 'greedy' });
  const nativeLazy = backtrackMatch(c2.nfa, s, { mode: 'lazy' });
  assert.equal(forcedGreedy.accepted, true);
  assert.equal(nativeLazy.accepted, true);
  assert.notDeepEqual(
    forcedGreedy.frames.map((f) => `${f.kind}:${f.to ?? ''}`),
    nativeLazy.frames.map((f) => `${f.kind}:${f.to ?? ''}`),
    '贪婪与懒惰的逐帧轨迹必须可区分',
  );

  // 经典判据 a*a 对 "aaaa"：贪婪先让 a* 吃完 4 个，再逐个吐出给结尾的 a（产生回溯）；
  // 懒惰让 a* 一开始就尽量少匹配，结尾的 a 直接命中，无需回溯。
  const c3 = compile('a*a');
  const s3 = 'aaaa';
  const g3 = backtrackMatch(c3.nfa, s3, { mode: 'greedy' });
  const l3 = backtrackMatch(c3.nfa, s3, { mode: 'lazy' });
  assert.equal(g3.accepted, true);
  assert.equal(l3.accepted, true);
  assert.ok(g3.stats.backtracks > l3.stats.backtracks, `贪婪回溯应更多：${g3.stats.backtracks} vs ${l3.stats.backtracks}`);
});

test('NFA 集合模拟无回溯（backtracks 恒为 0），且帧给出活跃集合', () => {
  const c = compile('(a|b)*c');
  const r = nfaMatch(c.nfa, 'ababc');
  assert.equal(r.stats.backtracks, 0);
  assert.equal(r.accepted, true);
  const consumeFrames = r.frames.filter((f) => f.kind === 'consume');
  for (const f of consumeFrames) assert.ok(Array.isArray(f.active) && f.active.length >= 1);
});

test('灾难性回溯：(a+)+b 在无 b 结尾时触发步数截断', () => {
  const c = compile('(a+)+b');
  const input = 'a'.repeat(22) + '!';
  const r = backtrackMatch(c.nfa, input, { cap: 20000 });
  assert.equal(r.capped, true);
  assert.equal(r.accepted, false);
  assert.ok(r.stats.backtracks > 5000, `应有海量回溯，实际 ${r.stats.backtracks}`);
  assert.ok(r.frames.length <= 20001, '帧被 cap 截断');
  // 集合模拟线性完成、不回溯
  const sim = nfaMatch(c.nfa, input);
  assert.equal(sim.capped, undefined);
  assert.equal(sim.stats.backtracks, 0);
  assert.equal(sim.accepted, false);
  // 线性步数（与输入同阶）
  assert.ok(sim.stats.transitions <= input.length * 5);
});

test('静态分析识别 (a+)+ 为指数级并给出建议', () => {
  const src = '(a+)+b';
  const r = analyzeAST(parse(src), src);
  assert.equal(r.level, 'exponential');
  assert.ok(r.findings.length >= 1);
  assert.ok(r.findings.some((f) => /嵌套|a\+/.test(f.title)));
  assert.ok(r.findings.every((f) => typeof f.advice === 'string' && f.advice.length > 0));
});

test('运行时分析：转移次数超过 2n² 报平方级', () => {
  const r = analyzeRuntime(
    { transitions: 5000, backtracks: 1000, capped: false },
    20, // n=20, 2n²=800
    { level: 'safe', findings: [] },
  );
  assert.equal(r.level, 'polynomial');
  assert.ok(r.notes.some((n) => /平方/.test(n.title)));
});

test('运行时分析：截断即报指数级', () => {
  const r = analyzeRuntime({ transitions: 1, backtracks: 0, capped: true }, 5, { level: 'safe', findings: [] });
  assert.equal(r.level, 'exponential');
});

test('安全正则不报警', () => {
  const r = analyzeAST(parse('\\d{4}-\\d{2}-\\d{2}'), '\\d{4}-\\d{2}-\\d{2}');
  assert.equal(r.level, 'safe');
  assert.equal(r.findings.length, 0);
});

test('性能统计字段齐全且为非负整数', () => {
  const c = compile('a*b');
  const r = backtrackMatch(c.nfa, 'aaab');
  for (const k of ['transitions', 'backtracks', 'visitedStates']) {
    assert.ok(Number.isInteger(r.stats[k]) && r.stats[k] >= 0);
  }
});
