// Canvas 绘图基础：箭头、状态圈、标签、高亮状态/边。
// 所有图形按后端给定的 x/y 逻辑坐标绘制，再用 transform 适配显示尺寸。

export const COLORS = {
  state: '#222c42',
  stateStroke: '#5b9dff',
  stateActive: '#5b9dff',
  acceptStroke: '#7ee0c0',
  acceptActive: '#7ee0c0',
  edge: '#46557a',
  edgeActive: '#5b9dff',
  edgeBacktrack: '#ff5d5d',
  eps: '#6b7894',
  char: '#8fa6d4',
  text: '#cdd6ea',
  labelBg: '#0f1420',
  newState: '#ffd479',
  merged: '#c792ea',
};

const R = 19; // 状态圆半径

function drawArrowHead(ctx, x, y, angle, color, size = 8) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.55);
  ctx.lineTo(-size, size * 0.55);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// 计算一条从 p1 到 p2 的有向边的起止点（扣在圆边界上），可加弯曲弧度
function edgeGeometry(p1, p2, curve = 0) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  // 垂直方向（弯曲方向）
  const px = -uy;
  const py = ux;
  const sx = p1.x + ux * R;
  const sy = p1.y + uy * R;
  const tx = p2.x - ux * R;
  const ty = p2.y - uy * R;
  const cx = (p1.x + p2.x) / 2 + px * curve;
  const cy = (p1.y + p2.y) / 2 + py * curve;
  return { sx, sy, tx, ty, cx, cy, ux, uy };
}

// 画弯曲边（quadratic curve），返回终点角度用于箭头
function strokeCurve(ctx, g, color, width, dashed = false) {
  ctx.beginPath();
  ctx.moveTo(g.sx, g.sy);
  ctx.quadraticCurveTo(g.cx, g.cy, g.tx, g.ty);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.stroke();
  ctx.setLineDash([]);
  // 终点切线角：从控制点指向终点
  const angle = Math.atan2(g.ty - g.cy, g.tx - g.cx);
  drawArrowHead(ctx, g.tx, g.ty, angle, color, 9);
}

// 自环
function drawSelfLoop(ctx, p, color, width, dashed = false, label = '') {
  const rx = 16;
  const ry = 22;
  const cx = p.x;
  const cy = p.y - R - 6;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.stroke();
  ctx.setLineDash([]);
  drawArrowHead(ctx, cx + rx, cy, Math.PI / 2, color, 8);
  if (label) {
    ctx.font = '11px ui-monospace, monospace';
    const w = ctx.measureText(label).width;
    drawLabel(ctx, label, cx - w / 2, cy - ry - 6);
  }
}

export function drawLabel(ctx, text, x, y, { color = COLORS.text, bg = COLORS.labelBg } = {}) {
  ctx.font = '11px ui-monospace, "JetBrains Mono", monospace';
  const w = ctx.measureText(text).width;
  ctx.fillStyle = bg;
  ctx.fillRect(x - 3, y - 10, w + 6, 14);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * 通用自动机绘制。
 * opts:
 *   states: [{id,x,y,accept?}]
 *   edges:  [{from,to,label,type,curveBias?}]
 *   activeStates: Set / array
 *   activeEdges: Set / array of edge-id（需带 id）
 *   backtrackEdges: Set / array
 *   newStates, fadedStates
 *   edgeColor(edge, active, isBt)
 *   stateLabel(id)
 *   dimNew?: 新状态发光色
 */
export function drawGraph(ctx, graph, opts = {}) {
  const {
    states,
    edges = [],
    activeStates,
    activeEdges,
    backtrackEdges,
    newStates,
    mergedStateGroups = [],
    stateLabel,
    width,
    height,
    startState,
  } = opts;

  const activeSet = toSet(activeStates);
  const activeEdgeSet = toSet(activeEdges);
  const btSet = toSet(backtrackEdges);
  const newSet = toSet(newStates);
  const pos = new Map(states.map((s) => [s.id, s]));

  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px ui-monospace, monospace';

  // 同起点对之间的边数，用于并排弯曲
  const pairCount = new Map();
  for (const e of edges) {
    if (e.from === e.to) continue;
    const key = e.from < e.to ? `${e.from}-${e.to}` : `${e.to}-${e.from}`;
    pairCount.set(key, (pairCount.get(key) || 0) + 1);
  }
  const pairSeen = new Map();

  // 先画边
  for (const e of edges) {
    const p1 = pos.get(e.from);
    const p2 = pos.get(e.to);
    if (!p1 || !p2) continue;
    const isBt = btSet.has(e.id);
    const active = activeEdgeSet.has(e.id);
    let color = e.type === 'eps' || e.type === 'assert' ? COLORS.eps : COLORS.char;
    let width = 1.2;
    let dashed = false;
    if (active) {
      color = COLORS.edgeActive;
      width = 2.6;
    }
    if (isBt) {
      color = COLORS.edgeBacktrack;
      width = 2.8;
      dashed = true;
    }
    if (!active && !isBt && (activeSet.size > 0 || newSet.size > 0)) {
      // 有高亮时淡化非相关边
      ctx.globalAlpha = 0.55;
    }

    if (e.from === e.to) {
      drawSelfLoop(ctx, p1, color, width, dashed, e.label);
      ctx.globalAlpha = 1;
      continue;
    }
    const key = e.from < e.to ? `${e.from}-${e.to}` : `${e.to}-${e.from}`;
    const total = pairCount.get(key) || 1;
    const seen = pairSeen.get(key) || 0;
    pairSeen.set(key, seen + 1);
    const curve = total > 1 ? (seen - (total - 1) / 2) * 26 : 0;
    const g = edgeGeometry(p1, p2, e.curve || curve);
    strokeCurve(ctx, g, color, width, dashed);
    ctx.globalAlpha = 1;
    if (e.label) {
      const lx = (g.sx + g.tx) / 2 + (-g.uy) * (curve + 14);
      const ly = (g.sy + g.ty) / 2 + (g.ux) * (curve + 14);
      drawLabel(ctx, e.label, lx, ly, {
        color: active ? COLORS.edgeActive : isBt ? COLORS.edgeBacktrack : COLORS.text,
      });
    }
  }

  // 等价合并分组高亮（最小化步骤）
  for (const group of mergedStateGroups) {
    if (group.length < 2) continue;
    ctx.save();
    ctx.strokeStyle = COLORS.merged;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.8;
    for (const id of group) {
      const s = pos.get(id);
      if (s) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, R + 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 起始状态箭头
  if (startState !== undefined && pos.has(startState)) {
    const s = pos.get(startState);
    ctx.beginPath();
    ctx.moveTo(s.x - R - 22, s.y);
    ctx.lineTo(s.x - R - 2, s.y);
    ctx.strokeStyle = COLORS.stateStroke;
    ctx.lineWidth = 2;
    ctx.stroke();
    drawArrowHead(ctx, s.x - R, s.y, 0, COLORS.stateStroke, 9);
  }

  // 状态
  for (const s of states) {
    const isActive = activeSet.has(s.id);
    const isNew = newSet.has(s.id);
    const accept = s.accept;
    ctx.beginPath();
    ctx.arc(s.x, s.y, R, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? '#1c3252' : COLORS.state;
    ctx.fill();
    ctx.lineWidth = isActive ? 3 : 2;
    let stroke = accept ? COLORS.acceptStroke : COLORS.stateStroke;
    if (isActive) stroke = accept ? COLORS.acceptActive : COLORS.stateActive;
    if (isNew) stroke = COLORS.newState;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    if (accept) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, R - 5, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
    // 编号
    ctx.fillStyle = isActive ? '#fff' : COLORS.text;
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = stateLabel ? stateLabel(s.id) : s.label ?? s.id;
    ctx.fillText(String(label), s.x, s.y + 1);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }
}

function toSet(v) {
  if (!v) return new Set();
  if (v instanceof Set) return v;
  return new Set(v);
}
