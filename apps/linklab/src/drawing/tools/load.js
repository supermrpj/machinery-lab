// =============================================================================
// load.js — the Force / torque tool: external loads on links
// -----------------------------------------------------------------------------
// Click a link where a force acts; drag while pressing to point it (a short
// click points it straight down). Hold Shift to add a torque instead. The
// size, direction and how it varies over the cycle are set in Properties.
// =============================================================================

import { makeLoad } from '../../model/loads.js';

const DEFAULT_N = 10;

export const loadTool = {
  id: 'load', label: 'Force or torque', shortcut: 'E', group: 'Mechanism', icon: 'force', layer: 'mechanism', advanced: true, // forces are Advanced
  start: null, cur: null,
  activate() { this.start = null; this.cur = null; },
  hint() {
    return this.start
      ? 'Drag to point the force, then let go. Set its size and how it varies in Properties.'
      : 'Click a link where a force acts — drag to point it. Hold Shift and click for a torque. Click a force already there to edit it.';
  },
  cursor: () => 'crosshair',
  down(app, ev) {
    // clicking a force or torque that is already there edits it
    const hit = app.pickAt(ev.s);
    if (hit && hit.kind === 'load') { this.start = null; app.ui.openLoad(hit.id); return; }
    const link = app.pickLink(ev.s, 14);
    if (!link) { app.flash('Click on a link to put a force on it.'); return; }
    this.start = { link, p: ev.snap.p, s: ev.s, torque: ev.shift };
    this.cur = null;
  },
  move(app, ev) {
    if (!this.start) return;
    this.cur = ev.s;
    app.requestRender();
  },
  up(app) {
    const st = this.start;
    this.start = null;
    if (!st) return;
    const d = this.cur ? { x: this.cur.x - st.s.x, y: -(this.cur.y - st.s.y) } : null;
    this.cur = null;
    let id = null;
    app.edit(st.torque ? 'Add torque' : 'Add force', (doc) => {
      doc.loads = doc.loads || [];
      const f = makeLoad(doc, st.link, st.p, st.torque ? 'torque' : 'force');
      const L = d ? Math.hypot(d.x, d.y) : 0;
      if (!st.torque && L > 8) f.F = { x: (DEFAULT_N * d.x) / L, y: (DEFAULT_N * d.y) / L };
      doc.loads.push(f);
      id = f.id;
    });
    if (id) app.select({ kind: 'load', id });
    if (!app.forcesOn()) {
      app.flash(app.mode === 'basic'
        ? 'Force added. To see what it does, switch to Advanced (top bar) and choose Static or Dynamic in the Forces panel.'
        : 'Force added. Choose Static or Dynamic in the Forces panel to see what it does.');
    }
  },
  cancel() { this.start = null; this.cur = null; return false; },
  drawOverlay(ctx, app) {
    if (!this.start || !this.cur || this.start.torque) return;
    const a = this.start.s, b = this.cur;
    const color = app.renderer.col('load'); // Sheet › Display may change it
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath(); ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - 11 * Math.cos(ang - 0.4), b.y - 11 * Math.sin(ang - 0.4));
    ctx.lineTo(b.x - 11 * Math.cos(ang + 0.4), b.y - 11 * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
  },
};
