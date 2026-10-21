// =============================================================================
// drive.js — the Move mechanism tool (a hand)
// -----------------------------------------------------------------------------
// Drag any link or joint and the mechanism moves as the real one would.
// It never changes the design, so it is the safe tool for exploring.
// =============================================================================

import { grabJoint, grabLink } from './select.js';

export const driveTool = {
  id: 'drive', label: 'Move mechanism', shortcut: 'H', group: 'Draw', icon: 'hand', layer: null,
  grab: null,
  hint(app) {
    if (this.grab) return 'Moving the mechanism by hand.';
    return app.sim.sys ? 'Drag any link or joint to move the mechanism. This tool never changes the design.' : 'Draw a mechanism first.';
  },
  cursor(app, s) {
    if (this.grab) return 'grabbing';
    const hit = app.pickAt(s);
    return hit && (hit.kind === 'link' || hit.kind === 'joint') ? 'grab' : 'default';
  },
  down(app, ev) {
    const hit = app.pickAt(ev.s);
    if (!hit) { this.grab = null; return; }
    if (hit.kind === 'joint') this.grab = grabJoint(app, hit.id);
    else if (hit.kind === 'link') this.grab = grabLink(app, hit.id, ev.w);
    else this.grab = null;
  },
  move(app, ev) {
    if (!this.grab) return;
    app.sim.dragTo(this.grab.i, this.grab.s, ev.w, app.dragOptions());
    app.poseChanged();
  },
  up() { this.grab = null; },
};
