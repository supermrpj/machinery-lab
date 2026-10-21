// =============================================================================
// actuator.js — the Linear actuator tool (hydraulic or electric cylinder)
// -----------------------------------------------------------------------------
// Click the two joints the cylinder connects. Clicking empty space makes a
// fixed mount (a ground pivot) there. The new actuator becomes the input;
// other actuators hold their length, like links.
// =============================================================================

import { addJoint, addActuator, jointById } from '../../model/document.js';
import { THEME } from '../../config.js';

/** Joint under the snapped point, if any. */
function jointAt(app, ev) {
  if (ev.snap.kind === 'joint') return jointById(app.doc, ev.snap.ref);
  const tol = app.view.px(1);
  return app.doc.joints.find((j) => { const p = app.sim.jointPos(j.id); return Math.hypot(p.x - ev.snap.p.x, p.y - ev.snap.p.y) < tol; }) || null;
}

export const actuatorTool = {
  id: 'actuator', label: 'Linear actuator', shortcut: 'U', group: 'Mechanism', icon: 'actuator', layer: 'mechanism',
  first: null, current: null,
  activate() { this.first = null; },
  hint() {
    return this.first
      ? 'Click the joint the rod end pushes (or empty space for a fixed mount). The actuator becomes the input.'
      : 'Click where the cylinder is mounted: a joint, or empty space for a fixed mount on the ground.';
  },
  down(app, ev) {
    const hit = jointAt(app, ev);
    if (!this.first) { this.first = hit ? { id: hit.id } : { p: ev.snap.p }; return; }
    if (hit && this.first.id === hit.id) return;
    const a = this.first, bHit = hit, bP = ev.snap.p;
    let id = null;
    app.edit('Add linear actuator', (doc) => {
      const aId = a.id || addJoint(doc, a.p.x, a.p.y, { ground: true }).id;
      const bId = bHit ? bHit.id : addJoint(doc, bP.x, bP.y, { ground: true }).id;
      const u = addActuator(doc, aId, bId);
      doc.driver = { type: 'linear', actuator: u.id, ref: null };
      id = u.id;
    });
    this.first = null;
    if (app.sim.drivable) app.flash('Linear actuator added and set as the input. Press Enter to run it.');
    else app.flash(app.whyNotDrivable());
    app.select({ kind: 'actuator', id });
  },
  move(app, ev) { this.current = ev.snap.p; },
  cancel() { const had = !!this.first; this.first = null; return had; },
  drawOverlay(ctx, app) {
    if (!this.first || !this.current) return;
    const a = app.view.toScreen(this.first.id ? app.sim.jointPos(this.first.id) : this.first.p);
    const b = app.view.toScreen(this.current);
    ctx.strokeStyle = THEME.preview; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.globalAlpha = 0.45;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.globalAlpha = 1;
  },
};
