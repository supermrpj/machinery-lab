// =============================================================================
// instruments.js — realistic drawing of the drafting instruments
// -----------------------------------------------------------------------------
// The compass and protractor are drawn like the real objects (brushed steel,
// clear plastic with a printed scale), because looking like the real thing is
// what makes them obvious to use. All sizes are in screen pixels.
// =============================================================================

const STEEL = ['#EEF1F4', '#B9C0CA', '#8C94A0', '#D6DBE1'];
const STEEL_EDGE = '#4A515C';

/** A tapered leg from (x0,y0) width w0 to (x1,y1) width w1, brushed steel. */
function taperedLeg(ctx, a, b, w0, w1) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  ctx.beginPath();
  ctx.moveTo(a.x + nx * w0 / 2, a.y + ny * w0 / 2);
  ctx.lineTo(b.x + nx * w1 / 2, b.y + ny * w1 / 2);
  ctx.lineTo(b.x - nx * w1 / 2, b.y - ny * w1 / 2);
  ctx.lineTo(a.x - nx * w0 / 2, a.y - ny * w0 / 2);
  ctx.closePath();
  const g = ctx.createLinearGradient(a.x + nx * w0 / 2, a.y + ny * w0 / 2, a.x - nx * w0 / 2, a.y - ny * w0 / 2);
  g.addColorStop(0, STEEL[0]); g.addColorStop(0.35, STEEL[1]); g.addColorStop(0.7, STEEL[2]); g.addColorStop(1, STEEL[3]);
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = STEEL_EDGE; ctx.lineWidth = 1; ctx.stroke();
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * Draw the compass. g = { N (needle tip), P (pencil tip), H (hinge), K (grip), up }.
 * `active` highlights the grip while an arc is being drawn.
 */
export function drawCompass(ctx, g, active) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(29, 36, 51, 0.28)';
  ctx.shadowBlur = 8; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 4;

  // ---- needle leg: steel leg, then a fine needle point ----
  const nEnd = lerp(g.H, g.N, 0.9);
  taperedLeg(ctx, g.H, nEnd, 13, 6);
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#2F3540'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(nEnd.x, nEnd.y); ctx.lineTo(g.N.x, g.N.y); ctx.stroke();

  // ---- pencil leg: steel leg, clamp, pencil, sharpened graphite tip ----
  ctx.shadowColor = 'rgba(29, 36, 51, 0.28)';
  const legEnd = lerp(g.H, g.P, 0.62);
  taperedLeg(ctx, g.H, legEnd, 13, 9);
  ctx.shadowColor = 'transparent';
  const pencilEnd = lerp(g.H, g.P, 0.86);
  const woodEnd = lerp(g.H, g.P, 0.95);
  // pencil body (yellow, slightly wider than the leg end)
  taperedPencil(ctx, lerp(g.H, g.P, 0.55), pencilEnd, 9, '#E3B341', '#B88A1E');
  // sharpened wood cone and graphite
  cone(ctx, pencilEnd, woodEnd, 9, 3, '#E9CFA4', '#B79466');
  cone(ctx, woodEnd, g.P, 3, 0.8, '#3A3F47', '#1D2128');
  // clamp ring around the pencil
  const cl = lerp(g.H, g.P, 0.6);
  ring(ctx, cl, g.H, g.P, 13);

  // ---- hinge head and knurled grip ----
  ctx.shadowColor = 'rgba(29, 36, 51, 0.28)';
  const head = ctx.createRadialGradient(g.H.x - 3, g.H.y - 3, 1, g.H.x, g.H.y, 11);
  head.addColorStop(0, '#E9ECF0'); head.addColorStop(0.6, '#8C94A0'); head.addColorStop(1, '#4A515C');
  ctx.fillStyle = head;
  ctx.beginPath(); ctx.arc(g.H.x, g.H.y, 10, 0, 2 * Math.PI); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = STEEL_EDGE; ctx.lineWidth = 1; ctx.stroke();
  // grip: a short knurled cylinder along the "up" direction
  const ang = Math.atan2(g.up.y, g.up.x);
  ctx.translate(g.K.x, g.K.y);
  ctx.rotate(ang + Math.PI / 2);
  const gw = 12, gh = 20;
  const grip = ctx.createLinearGradient(-gw / 2, 0, gw / 2, 0);
  grip.addColorStop(0, active ? '#5B8DEF' : '#5A6170');
  grip.addColorStop(0.45, active ? '#BFD3FA' : '#C3C9D2');
  grip.addColorStop(1, active ? '#1E5BD7' : '#3B4250');
  ctx.fillStyle = grip;
  ctx.beginPath(); ctx.roundRect(-gw / 2, -gh / 2, gw, gh, 3); ctx.fill();
  ctx.strokeStyle = '#2F3540'; ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = 'rgba(29, 36, 51, 0.45)';
  ctx.beginPath();
  for (let x = -gw / 2 + 2.5; x < gw / 2 - 1; x += 2.5) { ctx.moveTo(x, -gh / 2 + 2); ctx.lineTo(x, gh / 2 - 2); }
  ctx.stroke();
  ctx.restore();
}

function taperedPencil(ctx, a, b, w, face, edge) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  ctx.beginPath();
  ctx.moveTo(a.x + nx * w / 2, a.y + ny * w / 2); ctx.lineTo(b.x + nx * w / 2, b.y + ny * w / 2);
  ctx.lineTo(b.x - nx * w / 2, b.y - ny * w / 2); ctx.lineTo(a.x - nx * w / 2, a.y - ny * w / 2);
  ctx.closePath();
  const g = ctx.createLinearGradient(a.x + nx * w / 2, a.y + ny * w / 2, a.x - nx * w / 2, a.y - ny * w / 2);
  g.addColorStop(0, '#F3D27A'); g.addColorStop(0.5, face); g.addColorStop(1, edge);
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
  // the faces of a hexagonal pencil
  ctx.strokeStyle = 'rgba(120, 80, 10, 0.35)';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

function cone(ctx, a, b, w0, w1, face, edge) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  ctx.beginPath();
  ctx.moveTo(a.x + nx * w0 / 2, a.y + ny * w0 / 2); ctx.lineTo(b.x + nx * w1 / 2, b.y + ny * w1 / 2);
  ctx.lineTo(b.x - nx * w1 / 2, b.y - ny * w1 / 2); ctx.lineTo(a.x - nx * w0 / 2, a.y - ny * w0 / 2);
  ctx.closePath();
  ctx.fillStyle = face; ctx.fill();
  ctx.strokeStyle = edge; ctx.lineWidth = 0.8; ctx.stroke();
}

function ring(ctx, c, from, to, w) {
  const dx = to.x - from.x, dy = to.y - from.y, L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const h = 3.5;
  ctx.beginPath();
  ctx.moveTo(c.x + nx * w / 2 - ux * h, c.y + ny * w / 2 - uy * h);
  ctx.lineTo(c.x + nx * w / 2 + ux * h, c.y + ny * w / 2 + uy * h);
  ctx.lineTo(c.x - nx * w / 2 + ux * h, c.y - ny * w / 2 + uy * h);
  ctx.lineTo(c.x - nx * w / 2 - ux * h, c.y - ny * w / 2 - uy * h);
  ctx.closePath();
  ctx.fillStyle = '#6E7683'; ctx.fill();
  ctx.strokeStyle = STEEL_EDGE; ctx.lineWidth = 1; ctx.stroke();
}

// -----------------------------------------------------------------------------
// Protractor
// -----------------------------------------------------------------------------

/**
 * Draw a clear plastic protractor.
 *   c        centre (screen px)       R      radius (px)
 *   base     baseline angle (radians, world, counter-clockwise from +x)
 *   full     true for a 360° protractor
 * Screen angles are the negative of world angles (y points down on screen).
 */
export function drawProtractor(ctx, c, R, base, full, handle) {
  ctx.save();
  const s0 = -base;                       // screen angle of the 0° mark
  const span = full ? 2 * Math.PI : Math.PI;
  // body
  ctx.shadowColor = 'rgba(29, 36, 51, 0.18)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
  ctx.beginPath();
  if (full) ctx.arc(c.x, c.y, R, 0, 2 * Math.PI);
  else {
    // a real protractor has a straight edge a little below the centre line
    const e = Math.min(10, R * 0.08);
    const ex = Math.cos(s0 + Math.PI / 2) * e, ey = Math.sin(s0 + Math.PI / 2) * e;
    ctx.arc(c.x, c.y, R, s0, s0 - Math.PI, true);
    ctx.lineTo(c.x + Math.cos(s0 + Math.PI) * R + ex, c.y + Math.sin(s0 + Math.PI) * R + ey);
    ctx.lineTo(c.x + Math.cos(s0) * R + ex, c.y + Math.sin(s0) * R + ey);
    ctx.closePath();
  }
  const fill = ctx.createRadialGradient(c.x, c.y, R * 0.2, c.x, c.y, R);
  fill.addColorStop(0, 'rgba(214, 233, 245, 0.30)');
  fill.addColorStop(1, 'rgba(178, 212, 235, 0.45)');
  ctx.fillStyle = fill; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(34, 86, 130, 0.75)'; ctx.lineWidth = 1.2; ctx.stroke();

  // scales: outer reads counter-clockwise from the baseline, inner the other way
  ctx.strokeStyle = 'rgba(20, 50, 80, 0.85)';
  ctx.fillStyle = 'rgba(20, 50, 80, 0.95)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const steps = full ? 360 : 180;
  const showOnes = R > 110, showFives = R > 60;
  for (let d = 0; d <= steps; d++) {
    if (full && d === 360) break;
    const t = s0 - (d * Math.PI) / 180;
    const len = d % 10 === 0 ? 0.11 : d % 5 === 0 ? 0.075 : 0.045;
    if (d % 10 !== 0 && (!showFives || (d % 5 !== 0 && !showOnes))) continue;
    const c1 = Math.cos(t), s1 = Math.sin(t);
    ctx.lineWidth = d % 10 === 0 ? 1.1 : 0.7;
    ctx.beginPath();
    ctx.moveTo(c.x + c1 * R, c.y + s1 * R);
    ctx.lineTo(c.x + c1 * R * (1 - len), c.y + s1 * R * (1 - len));
    ctx.stroke();
    if (d % 10 === 0 && R > 70) {
      ctx.font = `${Math.max(9, Math.min(12, R * 0.07))}px system-ui, "Segoe UI", sans-serif`;
      const rr = R * 0.8;
      ctx.fillText(String(d), c.x + c1 * rr, c.y + s1 * rr);
      if (!full) {
        ctx.font = `${Math.max(8, Math.min(10, R * 0.055))}px system-ui, "Segoe UI", sans-serif`;
        ctx.fillStyle = 'rgba(160, 50, 40, 0.85)';
        ctx.fillText(String(180 - d), c.x + c1 * R * 0.66, c.y + s1 * R * 0.66);
        ctx.fillStyle = 'rgba(20, 50, 80, 0.95)';
      }
    }
  }
  // inner window and baseline
  ctx.strokeStyle = 'rgba(34, 86, 130, 0.55)'; ctx.lineWidth = 1;
  ctx.beginPath();
  if (full) ctx.arc(c.x, c.y, R * 0.42, 0, 2 * Math.PI);
  else ctx.arc(c.x, c.y, R * 0.42, s0, s0 - span, true);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(20, 50, 80, 0.9)';
  ctx.beginPath();
  ctx.moveTo(c.x + Math.cos(s0 + Math.PI) * R, c.y + Math.sin(s0 + Math.PI) * R);
  ctx.lineTo(c.x + Math.cos(s0) * R, c.y + Math.sin(s0) * R);
  ctx.stroke();
  // centre mark
  ctx.beginPath(); ctx.arc(c.x, c.y, 5, 0, 2 * Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(c.x - 9, c.y); ctx.lineTo(c.x + 9, c.y); ctx.moveTo(c.x, c.y - 9); ctx.lineTo(c.x, c.y + 9); ctx.stroke();
  // rotation grip beyond the 0° end
  const gpos = { x: c.x + Math.cos(s0) * (R + 16), y: c.y + Math.sin(s0) * (R + 16) };
  ctx.beginPath(); ctx.arc(gpos.x, gpos.y, 8, 0, 2 * Math.PI);
  const gg = ctx.createRadialGradient(gpos.x - 2, gpos.y - 2, 1, gpos.x, gpos.y, 8);
  gg.addColorStop(0, handle === 'rotate' ? '#BFD3FA' : '#DDE6EE'); gg.addColorStop(1, handle === 'rotate' ? '#1E5BD7' : '#5B7894');
  ctx.fillStyle = gg; ctx.fill();
  ctx.strokeStyle = '#2B4A66'; ctx.stroke();
  ctx.restore();
  return { grip: gpos };
}
