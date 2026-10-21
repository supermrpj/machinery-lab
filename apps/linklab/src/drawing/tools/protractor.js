// =============================================================================
// protractor.js — a movable clear-plastic protractor
// -----------------------------------------------------------------------------
//   drag the centre mark   move it (snaps to points, joints, intersections)
//   drag the round grip    rotate the baseline (snaps through a point;
//                          hold Shift for 15° steps)
//   hover                  read the angle from the baseline to the cursor
//   click                  draw a construction line through the centre at
//                          that angle (0.5° steps; Shift for 5°)
//   Alt + click            mark a point on the rim at that angle
// =============================================================================

import { addConstruction } from '../../model/construction.js';
import { drawProtractor } from '../instruments.js';
import { THEME } from '../../config.js';
import { wrap2Pi } from '../../../../../packages/core-math/src/index.js';

const DEG = Math.PI / 180;

export function defaultProtractor() {
  return { c: { x: 0, y: 0 }, base: 0, r: 60, full: false };
}

export const protractorTool = {
  id: 'protractor', label: 'Protractor', shortcut: 'A', group: 'Draw', icon: 'protractor', layer: 'construction',
  mode: null, hover: null, offset: null,

  hint(app) {
    if (this.mode === 'rotate') return `Baseline at ${(wrap2Pi(app.protractor.base) / DEG).toFixed(1)}°. Release to place.`;
    const a = this.reading(app);
    const read = a === null ? '' : `Reading ${a.toFixed(1)}°.  `;
    return `${read}Drag the centre to move it, the round grip to turn it. Click to draw a line at the angle; Alt + click to mark a point.`;
  },

  geometry(app) {
    const p = app.protractor;
    const c = app.view.toScreen(p.c);
    const R = p.r * app.view.zoom;
    const s0 = -p.base;
    return { c, R, grip: { x: c.x + Math.cos(s0) * (R + 16), y: c.y + Math.sin(s0) * (R + 16) } };
  },

  hitTest(app, s) {
    const g = this.geometry(app);
    if (Math.hypot(s.x - g.grip.x, s.y - g.grip.y) < 11) return 'rotate';
    if (Math.hypot(s.x - g.c.x, s.y - g.c.y) < 11) return 'move';
    return null;
  },

  cursor(app, s) {
    const h = this.mode || this.hitTest(app, s);
    return h === 'rotate' ? 'grab' : h === 'move' ? 'move' : 'crosshair';
  },

  /** Angle (degrees) from the baseline to the hovered direction, rounded. */
  reading(app, shift = false) {
    if (!this.hover) return null;
    const p = app.protractor;
    const dx = this.hover.x - p.c.x, dy = this.hover.y - p.c.y;
    if (Math.hypot(dx, dy) < 1e-9) return null;
    let a = wrap2Pi(Math.atan2(dy, dx) - p.base) / DEG;
    const step = shift ? 5 : 0.5;
    a = Math.round(a / step) * step;
    if (!p.full && a > 180) a = a > 270 ? 0 : 180; // a half protractor reads 0–180°
    return a % 360;
  },

  down(app, ev) {
    const hit = this.hitTest(app, ev.s);
    if (hit === 'move') { this.mode = 'move'; return; }
    if (hit === 'rotate') { this.mode = 'rotate'; return; }
    const a = this.reading(app, ev.shift);
    if (a === null) return;
    const p = app.protractor;
    const t = p.base + a * DEG;
    const dir = { x: Math.cos(t), y: Math.sin(t) };
    if (ev.alt) {
      const pt = { x: p.c.x + dir.x * p.r, y: p.c.y + dir.y * p.r };
      app.edit(`Mark ${a}°`, (doc) => addConstruction(doc, 'point', { p: pt }));
    } else {
      const b = { x: p.c.x + dir.x * p.r, y: p.c.y + dir.y * p.r };
      app.edit(`Line at ${a}°`, (doc) => addConstruction(doc, 'xline', { a: { ...p.c }, b }));
    }
  },

  move(app, ev) {
    const p = app.protractor;
    this.hover = ev.w;
    if (this.mode === 'move') p.c = { ...ev.snap.p };
    else if (this.mode === 'rotate') {
      let t;
      if (ev.snap.kind && ev.snap.kind !== 'on' && Math.hypot(ev.snap.p.x - p.c.x, ev.snap.p.y - p.c.y) > 1e-6) {
        t = Math.atan2(ev.snap.p.y - p.c.y, ev.snap.p.x - p.c.x); // baseline through a point
      } else {
        t = Math.atan2(ev.w.y - p.c.y, ev.w.x - p.c.x);
        if (ev.shift) t = Math.round(t / (15 * DEG)) * 15 * DEG;
      }
      p.base = t;
    }
  },

  up() { this.mode = null; },

  drawOverlay(ctx, app) {
    const g = this.geometry(app);
    drawProtractor(ctx, g.c, g.R, app.protractor.base, app.protractor.full, this.mode);
    // live reading: a ray from the centre towards the cursor
    const a = this.mode ? null : this.reading(app);
    if (a !== null) {
      const t = -(app.protractor.base + a * DEG);
      const L = g.R * 1.12;
      ctx.strokeStyle = THEME.preview; ctx.lineWidth = 1.25; ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.moveTo(g.c.x, g.c.y); ctx.lineTo(g.c.x + Math.cos(t) * L, g.c.y + Math.sin(t) * L); ctx.stroke();
      ctx.setLineDash([]);
      app.renderer.label({ x: g.c.x + Math.cos(t) * (L + 22), y: g.c.y + Math.sin(t) * (L + 22) }, `${a.toFixed(1)}°`, THEME.preview);
    }
  },

  /** Panel actions. */
  set(app, changes) { Object.assign(app.protractor, changes); app.requestRender(); },
};
