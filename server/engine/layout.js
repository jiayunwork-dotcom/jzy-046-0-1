// 自动机布局：
//  - NFA：按“最长路径层次”分列（起始在左、接受在右），同列内用重心法排布避免重叠，
//    回边（如量词自环）不参与分层，天然落在右侧画成回弧。
//  - DFA：BFS 确定初始层次后跑轻量力导向迭代，起始在左。

// —— 工具 ——
function adjacency(ids, edges) {
  const out = new Map(ids.map((id) => [id, []]));
  const inn = new Map(ids.map((id) => [id, []]));
  for (const e of edges) {
    out.get(e.from).push(e);
    inn.get(e.to).push(e);
  }
  return { out, inn };
}

// DFS 找出回边（指向当前 DFS 栈中祖先的边）
function findBackEdges(ids, out, start) {
  const color = new Map(ids.map((id) => [id, 0]));
  const back = new Set();
  const dfs = (u) => {
    color.set(u, 1);
    for (const e of out.get(u)) {
      if (color.get(e.to) === 1) back.add(e.id);
      else if (color.get(e.to) === 0) dfs(e.to);
    }
    color.set(u, 2);
  };
  dfs(start);
  return back;
}

export function layoutNFA({ start, accept, states, edges }) {
  const ids = [...states.keys()];
  const edgeList = [...edges.values()];
  const { out, inn } = adjacency(ids, edgeList);
  const back = findBackEdges(ids, out, start);

  // 1) 层次（x 列）：以非回边 DAG 求从起点出发的最长路径。
  //    字符边跨度大一些（3），ε 边跨度 1，让边标签有空间。
  const weight = (e) => (e.type === 'char' ? 3 : 1);
  const rank = new Map(ids.map((id) => [id, -Infinity]));
  rank.set(start, 0);
  // DAG 拓扑序：DFS 结束序
  const order = [];
  const seen = new Set();
  const visit = (u) => {
    if (seen.has(u)) return;
    seen.add(u);
    for (const e of out.get(u)) {
      if (!back.has(e.id)) visit(e.to);
    }
    order.push(u);
  };
  visit(start);
  for (const u of order.reverse()) {
    for (const e of out.get(u)) {
      if (back.has(e.id)) continue;
      const r = rank.get(u) + weight(e);
      if (r > rank.get(e.to)) rank.set(e.to, r);
    }
  }
  const maxRank = Math.max(...[...rank.values()].filter((r) => Number.isFinite(r)));
  rank.set(accept, Math.max(rank.get(accept), maxRank));

  // 2) 同列内排序：重心法迭代，减少边交叉
  const columns = new Map();
  for (const id of ids) {
    const r = rank.get(id);
    if (!columns.has(r)) columns.set(r, []);
    columns.get(r).push(id);
  }
  const colRank = [...columns.keys()].sort((a, b) => a - b);

  const bary = (list, neighborRankOf) => {
    const c = new Map();
    for (const id of list) {
      const ns = neighborRankOf(id);
      c.set(id, ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : (c.get(id) ?? 0));
    }
    return [...list].sort((a, b) => c.get(a) - c.get(b) || a - b);
  };

  for (let iter = 0; iter < 12; iter += 1) {
    for (let ci = 1; ci < colRank.length; ci += 1) {
      const col = columns.get(colRank[ci]);
      const posOf = new Map();
      const prev = columns.get(colRank[ci - 1]);
      prev.forEach((id, i) => posOf.set(id, i));
      columns.set(colRank[ci], bary(col, (id) =>
        inn.get(id).filter((e) => !back.has(e.id) && posOf.has(e.from)).map((e) => posOf.get(e.from)),
      ));
    }
    for (let ci = colRank.length - 2; ci >= 0; ci -= 1) {
      const col = columns.get(colRank[ci]);
      const posOf = new Map();
      const nxt = columns.get(colRank[ci + 1]);
      nxt.forEach((id, i) => posOf.set(id, i));
      columns.set(colRank[ci], bary(col, (id) =>
        out.get(id).filter((e) => !back.has(e.id) && posOf.has(e.to)).map((e) => posOf.get(e.to)),
      ));
    }
  }

  // 3) 落坐标
  const COL_W = 78;
  const ROW_H = 70;
  for (const r of colRank) {
    const col = columns.get(r);
    col.forEach((id, i) => {
      const st = states.get(id);
      st.x = 60 + r * COL_W;
      st.y = 60 + i * ROW_H;
    });
  }
  // 画布尺寸
  const width = 60 + (maxRank + 1) * COL_W + 40;
  const height = 60 + Math.max(...[...columns.values()].map((c) => c.length)) * ROW_H + 40;
  return { width, height, backEdgeIds: [...back] };
}

// DFA 布局：BFS 分层 + 轻量力导向。入参 states 与 transitions（{from,to}）。
export function layoutDFA(states, transitions, { start } = {}) {
  const ids = states.map((s) => s.id);
  const out = new Map(ids.map((id) => [id, []]));
  const edges = [];
  for (const t of transitions) {
    if (t.from === t.to) continue;
    if (!out.has(t.from) || !ids.includes(t.to)) continue;
    if (!out.get(t.from).includes(t.to)) {
      out.get(t.from).push(t.to);
      edges.push([t.from, t.to]);
    }
  }
  // BFS 层次（start 缺失时退回第一个状态）
  const startId = out.has(start) ? start : ids[0];
  const level = new Map([[startId, 0]]);
  const queue = [startId];
  while (queue.length) {
    const u = queue.shift();
    for (const v of out.get(u) || []) {
      if (!level.has(v)) {
        level.set(v, level.get(u) + 1);
        queue.push(v);
      }
    }
  }
  for (const id of ids) if (!level.has(id)) level.set(id, 0);

  const pos = new Map();
  ids.forEach((id, i) => {
    const l = level.get(id);
    const sameLevel = ids.filter((x) => level.get(x) === l);
    pos.set(id, { x: 80 + l * 150 + (i % 2) * 30, y: 60 + sameLevel.indexOf(id) * 90 });
  });

  // 力导向迭代（带力裁剪，避免远距离弹簧力发散到 Infinity 再产生 NaN）
  const k = 130;
  const MAX_FORCE = 400;
  const clampForce = (v) => Math.max(-MAX_FORCE, Math.min(MAX_FORCE, v));
  for (let iter = 0; iter < 300; iter += 1) {
    const force = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = pos.get(ids[i]);
        const b = pos.get(ids[j]);
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy) || 1;
        const rep = (k * k) / d;
        force.get(ids[i]).x += (dx / d) * rep;
        force.get(ids[i]).y += (dy / d) * rep;
        force.get(ids[j]).x -= (dx / d) * rep;
        force.get(ids[j]).y -= (dy / d) * rep;
      }
    }
    for (const [u, v] of edges) {
      const a = pos.get(u);
      const b = pos.get(v);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      // 弹簧吸引力随距离线性（F=d/k），天然有界、不发散
      const att = d / k;
      force.get(u).x += (dx / d) * att;
      force.get(u).y += (dy / d) * att;
      force.get(v).x -= (dx / d) * att;
      force.get(v).y -= (dy / d) * att;
    }
    const cooling = 1 - iter / 400; // 退火：逐渐减小步长
    for (const id of ids) {
      if (id === startId) continue;
      const p = pos.get(id);
      const f = force.get(id);
      const targetX = 80 + level.get(id) * 160;
      p.x += (clampForce(f.x) + (targetX - p.x) * 0.03) * 0.25 * cooling;
      p.y += clampForce(f.y) * 0.25 * cooling;
    }
  }

  // 归一化到左上角
  const xs = ids.map((id) => pos.get(id).x);
  const ys = ids.map((id) => pos.get(id).y);
  const minX = Math.min(...xs) - 70;
  const minY = Math.min(...ys) - 70;
  for (const id of ids) {
    const p = pos.get(id);
    p.x -= minX;
    p.y -= minY;
  }
  const width = Math.max(...ids.map((id) => pos.get(id).x)) + 90;
  const height = Math.max(...ids.map((id) => pos.get(id).y)) + 90;
  for (const s of states) {
    s.x = pos.get(s.id).x;
    s.y = pos.get(s.id).y;
  }
  return { width, height };
}
