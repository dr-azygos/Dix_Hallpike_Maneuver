// Orthographic 3D sketch of the head: current pose (solid) vs target pose (ghost).

import { col, cross, dot, normalize } from './math3d.js';

const EYE = normalize([1.3, 1.1, 0.9]); // viewer: front-right, slightly above the seated patient
const VIEW_R = normalize(cross(EYE.map((v) => -v), [0, 0, 1]));
const VIEW_U = cross(VIEW_R, EYE.map((v) => -v));

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function drawHead(canvas, current, target, inTol) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const S = Math.min(w, h) * 0.3;
  const cx = w / 2, cy = h / 2;
  const P = (p) => [cx + dot(p, VIEW_R) * S, cy - dot(p, VIEW_U) * S];
  const depth = (p) => dot(p, EYE);
  const colors = {
    grid: css('--line'), head: css('--surface-2'), nose: css('--nose'), vertex: css('--vertex'),
    ear: css('--ear'), text: css('--muted'), ok: css('--ok'),
  };

  // Floor ring and the "facing" direction set at calibration.
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let a = 0; a <= 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    const [x, y] = P([Math.cos(t) * 1.2, Math.sin(t) * 1.2, -1.1]);
    a ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  arrow(ctx, P([0, 0, -1.1]), P([0, 1.2, -1.1]), colors.grid, 1, []);
  ctx.fillStyle = colors.text;
  ctx.font = '11px system-ui, sans-serif';
  const [fx, fy] = P([0, 1.2, -1.1]);
  ctx.textAlign = 'right';
  ctx.fillText('foot of couch', Math.min(fx, w - 6), Math.min(fy + 16, h - 6));
  ctx.textAlign = 'left';

  // Head silhouette.
  ctx.fillStyle = colors.head;
  ctx.strokeStyle = inTol ? colors.ok : colors.grid;
  ctx.lineWidth = inTol ? 3 : 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (target) axes(ctx, P, depth, target, colors, true);
  axes(ctx, P, depth, current, colors, false);
}

function axes(ctx, P, depth, R, c, ghost) {
  const nose = col(R, 1), vertex = col(R, 2), ear = col(R, 0);
  const dash = ghost ? [5, 5] : [];
  const alpha = (p) => (ghost ? 0.55 : depth(p) < -0.1 ? 0.45 : 1);
  const o = [0, 0, 0];
  ctx.globalAlpha = alpha(vertex);
  arrow(ctx, P(o), P(vertex.map((v) => v * 1.05)), c.vertex, ghost ? 2 : 4, dash);
  ctx.globalAlpha = alpha(nose);
  arrow(ctx, P(o), P(nose.map((v) => v * 1.15)), c.nose, ghost ? 2 : 5, dash);
  for (const [sgn, label] of [[1, 'R'], [-1, 'L']]) {
    const p = ear.map((v) => v * 0.62 * sgn);
    ctx.globalAlpha = alpha(p);
    const [x, y] = P(p);
    ctx.fillStyle = c.ear;
    ctx.strokeStyle = c.ear;
    ctx.beginPath();
    ctx.arc(x, y, ghost ? 5 : 8, 0, Math.PI * 2);
    ghost ? ctx.stroke() : ctx.fill();
    if (!ghost) {
      ctx.fillStyle = '#000';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.fillText(label, x - 3.5, y + 3.5);
    }
  }
  ctx.globalAlpha = 1;
}

function arrow(ctx, [x0, y0], [x1, y1], color, width, dash) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.setLineDash([]);
  const a = Math.atan2(y1 - y0, x1 - x0);
  const k = 6 + width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - k * Math.cos(a - 0.4), y1 - k * Math.sin(a - 0.4));
  ctx.lineTo(x1 - k * Math.cos(a + 0.4), y1 - k * Math.sin(a + 0.4));
  ctx.closePath();
  ctx.fill();
}
