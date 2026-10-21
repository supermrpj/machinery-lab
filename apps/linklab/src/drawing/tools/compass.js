// =============================================================================
// compass.js — a movable drafting compass
// -----------------------------------------------------------------------------
// The compass is an instrument that stays on the sheet, like a real one:
//   • needle (pivot leg)  drag it to move the whole compass; the spread
//                          (radius) is kept, so a length can be carried
//   • pencil leg tip      drag it to open or close the compass (set radius);
//                          it snaps, so you can pick up an exact distance
//   • knob on top         drag it round to draw an arc with the pencil
//   • click elsewhere     puts the needle there (radius kept)
// The radius can also be typed in the Properties panel.
// =============================================================================

import { addConstruction } from '../../model/construction.js';
import { THEME, DRAWING } from '../../config.js';
import { angleDiff } from '../../../../../packages/core-math/src/index.js';
import { drawCompass } from '../instruments.js';

const HANDLE_PX = 11;

/** Screen geometry of the instrument. */
function geometry(app) {
  const c = app.compass;
  const N = app.view.toScreen(c.needle), P = app.view.toScreen(c.pencil);
  const mid = { x: (N.x + P.x) / 2, y: (N.y + P.y) / 2 };
  const dx = P.x - N.x, dy = P.y - N.y;
  const half = Math.hypot(dx, dy) / 2;
  const leg = Math.max(half * 1.15, 120);
  const height = Math.sqrt(Math.max(leg * leg - half * half, 0));
  let ux = -dy, uy = dx; // perpendicular
  const L = Math.hypot(ux, uy) || 1;
  ux /= L; uy /= L;
  if (uy > 0) { ux = -ux; uy = -uy; } // point "up" on screen
  if (half < 1e-6) { ux = 0; uy = -1; }
  const H = { x: mid.x + ux * height, y: mid.y + uy * height };
  const K = { x: H.x + ux * 24, y: H.y + uy * 24 };
  return { N, P, H, K, up: { x: ux, y: uy } };
}

export const compassTool = {
  id: 'compass', label: 'Compass', shortcut: 'C', group: 'Draw', icon: 'compass', layer: 'construction',
  mode: null,       // 'move' | 'radius' | 'draw'
  sweep: 0,
  lastAngle: 0,
  startAngle: 0,
  offset: null,

  hint(app) {
    const r = app.units.fmt(app.compassRadius());
    if (this.mode === 'draw') return `Drawing arc: ${(this.sweep * 180 / Math.PI).toFixed(1)}°.  Release to finish.`;
    return `Compass radius ${r}.  Drag the needle to move it, the pencil tip to open it, the knob on top to draw.  Click anywhere to put the needle there.`;
  },

  hitTest(app, s) {
    const g = geometry(app);
    const d = (p) => Math.hypot(p.x - s.x, p.y - s.y);
    if (d(g.K) < HANDLE_PX + 3) return 'draw';
    if (d(g.P) < HANDLE_PX) return 'radius';
    if (d(g.N) < HANDLE_PX) return 'move';
    if (d(g.H) < HANDLE_PX) return 'draw';
    return null;
  },

  cursor(app, s) {
    const h = this.mode || this.hitTest(app, s);
    return h === 'draw' ? 'grab' : h ? 'move' : 'crosshair';
  },

  down(app, ev) {
    const c = app.compass;
    const hit = this.hitTest(app, ev.s);
    if (hit === 'draw') {
      this.mode = 'draw';
      this.startAngle = Math.atan2(c.pencil.y - c.needle.y, c.pencil.x - c.needle.x);
      this.lastAngle = this.startAngle;
      this.sweep = 0;
      return;
    }
    if (hit === 'radius') { this.mode = 'radius'; return; }
    if (hit === 'move') {
      this.mode = 'move';
      this.offset = { x: c.pencil.x - c.needle.x, y: c.pencil.y - c.needle.y };
      return;
    }
    // click elsewhere: put the needle there, keep the spread
    const off = { x: c.pencil.x - c.needle.x, y: c.pencil.y - c.needle.y };
    c.needle = { ...ev.snap.p };
    c.pencil = { x: c.needle.x + off.x, y: c.needle.y + off.y };
    this.mode = 'move';
    this.offset = off;
  },

  move(app, ev) {
    const c = app.compass;
    if (this.mode === 'move') {
      c.needle = { ...ev.snap.p };
      c.pencil = { x: c.needle.x + this.offset.x, y: c.needle.y + this.offset.y };
    } else if (this.mode === 'radius') {
      const p = ev.snap.p;
      if (Math.hypot(p.x - c.needle.x, p.y - c.needle.y) > app.view.px(3)) c.pencil = { ...p };
    } else if (this.mode === 'draw') {
      const a = Math.atan2(ev.w.y - c.needle.y, ev.w.x - c.needle.x);
      this.sweep += angleDiff(a, this.lastAngle);
      this.sweep = Math.max(-2 * Math.PI, Math.min(2 * Math.PI, this.sweep));
      this.lastAngle = a;
      const r = app.compassRadius();
      const t = this.startAngle + this.sweep;
      c.pencil = { x: c.needle.x + r * Math.cos(t), y: c.needle.y + r * Math.sin(t) };
    }
  },

  up(app) {
    if (this.mode === 'draw' && Math.abs(this.sweep) > (0.5 * Math.PI) / 180) {
      const c = app.compass, r = app.compassRadius();
      const full = Math.abs(this.sweep) >= 2 * Math.PI - 1e-6;
      const a0 = this.startAngle, sweep = this.sweep;
      app.edit(full ? 'Draw circle' : 'Draw arc', (doc) => {
        if (full) addConstruction(doc, 'circle', { c: { ...c.needle }, r });
        else addConstruction(doc, 'arc', { c: { ...c.needle }, r, a0, sweep });
      });
    }
    this.mode = null;
    this.sweep = 0;
  },

  /** Panel button: draw a full circle at the current setting. */
  drawCircle(app) {
    const c = app.compass;
    app.edit('Draw circle', (doc) => addConstruction(doc, 'circle', { c: { ...c.needle }, r: app.compassRadius() }));
  },

  /** Panel field: set the spread to an exact radius (mm). */
  setRadius(app, r) {
    if (!(r > 0)) return;
    const c = app.compass;
    const a = Math.atan2(c.pencil.y - c.needle.y, c.pencil.x - c.needle.x);
    c.pencil = { x: c.needle.x + r * Math.cos(a), y: c.needle.y + r * Math.sin(a) };
  },

  drawOverlay(ctx, app) {
    const g = geometry(app);
    // preview of the arc being drawn
    if (this.mode === 'draw' && Math.abs(this.sweep) > 0) {
      const r = app.compassRadius() * app.view.zoom;
      ctx.strokeStyle = THEME.preview; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(g.N.x, g.N.y, r, -this.startAngle, -(this.startAngle + this.sweep), this.sweep > 0);
      ctx.stroke();
    } else {
      // faint full circle shows where the pencil can reach
      ctx.strokeStyle = 'rgba(30, 91, 215, 0.18)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(g.N.x, g.N.y, app.compassRadius() * app.view.zoom, 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);
    }
    drawCompass(ctx, g, this.mode === 'draw');
    // small rings show the two tips you can grab
    ctx.strokeStyle = THEME.ink; ctx.lineWidth = 1.25; ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.arc(g.N.x, g.N.y, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(g.P.x, g.P.y, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    app.renderer.label({ x: (g.N.x + g.P.x) / 2 + g.up.x * -14, y: (g.N.y + g.P.y) / 2 + g.up.y * -14 },
      `r = ${app.compassRadius().toFixed(2)}`, THEME.ink);
  },
};

/** Default instrument position. */
export function defaultCompass() {
  return { needle: { x: 0, y: 0 }, pencil: { x: DRAWING.compassDefaultRadius, y: 0 } };
}
