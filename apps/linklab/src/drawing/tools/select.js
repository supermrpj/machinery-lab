// =============================================================================
// select.js — select, move and drive
// -----------------------------------------------------------------------------
//   click            select a joint, link, drawing item or outline
//   drag a joint     move it (changes the design; link lengths change) —
//                    unless lengths are locked: then it moves the mechanism
//   drag a link      move the mechanism by hand (does not change the design)
//   drag a drawing   move it (drag an end point or centre to move just that)
//   drag empty space pan the view
//   Tolerance tab    dragging a joint or link pushes it by hand: the motor
//                    holds the input, so it moves only within its play
//   Delete           delete the selection
// =============================================================================

import { jointById, linksAtJoint, mergeJoints } from '../../model/document.js';
import { nearestOnLine } from '../../../../../packages/core-math/src/index.js';
import { pushActive, setPush } from '../../model/tolerance.js';

/** Grab a joint as a point on the first link that carries it (for driving). */
export function grabJoint(app, jointId) {
  const sys = app.sim.sys;
  if (!sys) return null;
  const link = linksAtJoint(app.doc, jointId)[0];
  if (!link) return null;
  const i = sys.bodyIndex.get(link.id);
  return { i, s: sys.bodies[i].local.get(jointId) };
}

/** Grab a link at world point w, as a local point on its body (for driving). */
export function grabLink(app, linkId, w) {
  const sys = app.sim.sys;
  if (!sys || !sys.bodyIndex.has(linkId)) return null;
  const i = sys.bodyIndex.get(linkId);
  const q = app.sim.q;
  const c = Math.cos(q[3 * i + 2]), s = Math.sin(q[3 * i + 2]);
  const dx = w.x - q[3 * i], dy = w.y - q[3 * i + 1];
  return { i, s: { x: c * dx + s * dy, y: -s * dx + c * dy } };
}

export const selectTool = {
  id: 'select', label: 'Select and move', shortcut: 'V', group: 'Draw', icon: 'select', layer: null,
  mode: null, start: null, moved: false, grab: null,

  hint(app) {
    if (this.mode === 'drive') return 'Moving the mechanism by hand.';
    if (this.mode === 'push') return 'Pushing by hand: the motor holds the input, so the links move only within their play.';
    if (pushActive(app)) return 'Drag a link to push it by hand and see its play. Move the input with the timeline.';
    if (app.doc.lockDesign) return 'Lengths are locked: drag a link or joint to move the mechanism. Click to select. Drag empty space to pan.';
    return 'Click to select. Drag a joint to change the design. Drag a link to move the mechanism by hand. Drag empty space to pan.';
  },

  cursor(app, s) {
    if (this.mode === 'pan') return 'grabbing';
    if (this.mode) return this.mode === 'drive' || this.mode === 'push' ? 'grabbing' : 'move';
    const hit = app.pickAt(s);
    if (!hit) return 'default';
    if ((hit.kind === 'joint' || hit.kind === 'link') && pushActive(app)) return 'grab';
    if (hit.kind === 'joint' && !app.jointEditable(hit.id)) return 'grab';
    return hit.kind === 'link' ? 'grab' : 'move';
  },

  down(app, ev) {
    const hit = app.pickAt(ev.s);
    this.start = ev;
    this.moved = false;
    this.grab = null;
    if (!hit) { app.select(null); this.mode = 'pan'; this.last = ev.s; return; }
    if ((hit.kind === 'joint' || hit.kind === 'link') && pushActive(app)) {
      // Tolerance tab: push it by hand (see setPush). The Properties card would
      // cover the drawing, so it opens only on a plain click (see up()).
      this.grab = hit.kind === 'joint' ? grabJoint(app, hit.id) : grabLink(app, hit.id, ev.w);
      this.mode = this.grab ? 'push' : null;
      this.clicked = hit;
      return;
    }
    app.select(hit);
    switch (hit.kind) {
      case 'joint': {
        if (app.jointEditable(hit.id)) { this.mode = 'joint'; this.grab = { id: hit.id }; break; }
        // lengths locked: move the mechanism by this joint instead
        this.grab = grabJoint(app, hit.id);
        this.mode = this.grab ? 'drive' : null;
        break;
      }
      case 'link':
        this.grab = grabLink(app, hit.id, ev.w);
        this.mode = this.grab ? 'drive' : null;
        break;
      case 'construction': {
        const e = app.currentConstruction().find((x) => x.id === hit.id);
        // grabbed near a characteristic point? then move only that point
        let key = null;
        const near = app.view.px(9);
        const keys = { point: ['p'], segment: ['a', 'b'], xline: ['a', 'b'], dim: ['a', 'b'], circle: ['c'], arc: ['c'] }[e.kind] || [];
        for (const k of keys) if (Math.hypot(e[k].x - ev.w.x, e[k].y - ev.w.y) < near) key = k;
        if (!key && e.kind === 'circle') key = 'r';
        this.mode = 'entity';
        this.grab = { id: e.id, key, last: ev.w };
        break;
      }
      case 'body': this.mode = 'body'; this.grab = { id: hit.id, last: ev.w }; break;
      default: this.mode = null;
    }
  },

  move(app, ev) {
    if (!this.mode) return;
    if (!this.moved && Math.hypot(ev.s.x - this.start.s.x, ev.s.y - this.start.s.y) < 3) return;
    const firstMove = !this.moved;
    this.moved = true;

    if (this.mode === 'pan') {
      app.view.panBy(ev.s.x - this.last.x, ev.s.y - this.last.y);
      this.last = ev.s;
      return;
    }
    if (this.mode === 'drive') {
      app.sim.dragTo(this.grab.i, this.grab.s, ev.w, app.dragOptions());
      app.poseChanged();
      return;
    }
    if (this.mode === 'push') {
      // push the way the mouse has moved since it was pressed
      setPush(app, this.grab, { x: ev.w.x - this.start.w.x, y: ev.w.y - this.start.w.y });
      app.poseChanged();
      return;
    }
    if (firstMove) {
      const label = { joint: 'Move joint', entity: 'Move drawing', body: 'Move outline' }[this.mode];
      app.beginEdit(label);
    }
    const doc = app.doc;
    if (this.mode === 'joint') {
      const j = jointById(doc, this.grab.id);
      const snap = app.snapWorld(ev.s, { exclude: (ref) => ref === j.id });
      let p = snap.p;
      // dropped on another joint: the two become one pin (on release)
      this.grab.onto = snap.kind === 'joint' ? snap.ref : null;
      const slider = doc.sliders.find((s) => s.joint === j.id && !s.on);
      if (slider) p = nearestOnLine(p, slider.a, slider.b, false).point;
      j.x = p.x; j.y = p.y;
    } else if (this.mode === 'entity') {
      const e = doc.construction.find((x) => x.id === this.grab.id);
      const k = this.grab.key;
      if (k === 'r') {
        e.r = Math.max(app.view.px(2), Math.hypot(ev.w.x - e.c.x, ev.w.y - e.c.y));
      } else if (k && (e.kind !== 'circle' && e.kind !== 'arc')) {
        e[k] = app.snapWorld(ev.s, { exclude: (ref) => ref === e.id }).p;
      } else {
        // move the whole entity (snap the grabbed centre / point if there is one)
        let d;
        if (k) {
          const p = app.snapWorld(ev.s, { exclude: (ref) => ref === e.id }).p;
          d = { x: p.x - e[k].x, y: p.y - e[k].y };
        } else {
          d = { x: ev.w.x - this.grab.last.x, y: ev.w.y - this.grab.last.y };
        }
        for (const key of ['p', 'a', 'b', 'c']) if (e[key]) e[key] = { x: e[key].x + d.x, y: e[key].y + d.y };
        this.grab.last = ev.w;
      }
    } else if (this.mode === 'body') {
      const b = doc.bodies.find((x) => x.id === this.grab.id);
      const d = { x: ev.w.x - this.grab.last.x, y: ev.w.y - this.grab.last.y };
      b.pts = b.pts.map((p) => ({ x: p.x + d.x, y: p.y + d.y }));
      this.grab.last = ev.w;
    }
    app.docChangedLive();
  },

  up(app) {
    if (this.mode === 'push' && !this.moved && this.clicked) app.select(this.clicked);   // a click, not a push
    this.clicked = null;
    if (this.moved && this.mode === 'joint' && this.grab.onto) {
      const onto = this.grab.onto;
      if (mergeJoints(app.doc, onto, this.grab.id)) {
        app.docChangedLive();
        app.select({ kind: 'joint', id: onto });
        app.flash('Joined: the two joints are now one pin.');
      } else app.flash('These joints are on the same link, so they cannot be joined.', true);
    }
    if (this.moved && ['joint', 'entity', 'body'].includes(this.mode)) app.endEdit();
    this.mode = null;
    this.grab = null;
  },

  /** Double-click a force or torque to edit it in a popup. */
  dblclick(app, ev) {
    const hit = app.pickAt(ev.s);
    if (hit && hit.kind === 'load') app.ui.openLoad(hit.id);
  },

  key(app, e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && app.selection) { app.deleteSelection(); return true; }
    return false;
  },
};
