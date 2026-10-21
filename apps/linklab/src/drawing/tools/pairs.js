// =============================================================================
// pairs.js — tools for the other kinematic pairs
// -----------------------------------------------------------------------------
//   Wheel        a disc pinned at its centre (a wheel, roller or pitch circle)
//   Prismatic    one link slides along another (or the ground), no rotation
//   Roll         two contours roll on each other without slipping
//                (wheels, pitch circles of gears, a wheel on a track)
//   Roll + slip  two contours stay in contact but may slip (cam on follower,
//                real gear teeth) — a half joint
// Contours are wheels, circles or arcs from the construction layer, straight
// construction lines, or the centre line of a link.
// =============================================================================

import { addJoint, addWheel, addPair, jointById, linkById } from '../../model/document.js';
import { constrainAngle } from './basic.js';
import { THEME } from '../../config.js';

/** The joint under the snapped point, if any. */
function jointAtSnap(app, ev) {
  if (ev.snap.kind === 'joint') return jointById(app.doc, ev.snap.ref);
  const tol = app.view.px(1);
  return app.doc.joints.find((j) => { const p = app.sim.jointPos(j.id); return Math.hypot(p.x - ev.snap.p.x, p.y - ev.snap.p.y) < tol; }) || null;
}

// ---- Wheel -------------------------------------------------------------------------
export const wheelTool = {
  id: 'wheel', label: 'Wheel', shortcut: 'W', group: 'Mechanism', icon: 'wheel', layer: 'mechanism',
  centre: null, current: null,
  activate() { this.centre = null; },
  hint() {
    return this.centre
      ? 'Click to set the radius (it snaps — click the point the wheel should touch). Esc cancels.'
      : 'Click the centre of the wheel: a ground pivot (a fixed wheel or gear), a joint (a planet on an arm) or empty space.';
  },
  down(app, ev) {
    if (!this.centre) { this.centre = { p: ev.snap.p, joint: jointAtSnap(app, ev) }; return; }
    const r = Math.hypot(ev.snap.p.x - this.centre.p.x, ev.snap.p.y - this.centre.p.y);
    if (r < app.view.px(4)) return;
    const c = this.centre;
    let id = null;
    app.edit('Add wheel', (doc) => {
      const jid = c.joint ? c.joint.id : addJoint(doc, c.p.x, c.p.y).id;
      id = addWheel(doc, jid, r).id;
    });
    this.centre = null;
    app.select({ kind: 'link', id });
  },
  move(app, ev) { this.current = ev.snap.p; },
  cancel() { const had = !!this.centre; this.centre = null; return had; },
  drawOverlay(ctx, app) {
    if (!this.centre || !this.current) return;
    const c = app.view.toScreen(this.centre.p);
    const r = Math.hypot(this.current.x - this.centre.p.x, this.current.y - this.centre.p.y);
    ctx.strokeStyle = THEME.preview; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c.x, c.y, r * app.view.zoom, 0, 2 * Math.PI); ctx.stroke();
    app.renderer.label({ x: c.x, y: c.y - r * app.view.zoom - 14 }, `r = ${app.units.fmt(r)}`, THEME.preview);
  },
};

// ---- Prismatic -------------------------------------------------------------------------
export const prismaticTool = {
  id: 'prismatic', label: 'Prismatic joint', shortcut: 'T', group: 'Mechanism', icon: 'prismatic', layer: 'mechanism',
  slider: null, guide: undefined, axisA: null, current: null,
  activate() { this.slider = null; this.guide = undefined; this.axisA = null; },
  hint(app) {
    if (!this.slider) return 'Click the link that slides (for example a piston rod, or a block).';
    if (this.guide === undefined) return 'Click the link it slides in (for example the cylinder), or empty space to slide on the ground.';
    if (!this.axisA) return `Click a line for the sliding direction, click two points, or press Enter to slide along link ${app.linkNumbers().get(this.slider)}'s centre line.`;
    return 'Click the second point of the sliding axis. Hold Shift for 15° steps.';
  },
  down(app, ev) {
    if (!this.slider) {
      const l = app.pickLink(ev.s, 12);
      if (!l) { app.flash('Click a link first.'); return; }
      this.slider = l;
      return;
    }
    if (this.guide === undefined) {
      const g = app.pickLink(ev.s, 12);
      if (g === this.slider) { app.flash('A link cannot slide in itself. Click another link, or empty space for the ground.'); return; }
      this.guide = g || null;
      return;
    }
    if (!this.axisA) {
      const line = ev.snap.kind === 'on' && app.currentConstruction().find((e) => e.id === ev.snap.ref && (e.kind === 'segment' || e.kind === 'xline'));
      if (line) { this.finish(app, line.a, line.b); return; }
      this.axisA = ev.snap.p;
      return;
    }
    const b = constrainAngle(this.axisA, ev.snap.p, ev.shift);
    if (Math.hypot(b.x - this.axisA.x, b.y - this.axisA.y) < app.view.px(4)) return;
    this.finish(app, this.axisA, b);
  },
  key(app, e) {
    if (e.key === 'Enter' && this.slider && this.guide !== undefined && !this.axisA) {
      const l = linkById(app.doc, this.slider);
      if (l.joints.length < 2) { app.flash('A wheel has no centre line. Click a line or two points instead.'); return true; }
      this.finish(app, app.sim.jointPos(l.joints[0]), app.sim.jointPos(l.joints[1]));
      return true;
    }
    return false;
  },
  finish(app, a, b) {
    const { slider, guide } = this;
    app.edit('Add prismatic joint', (doc) => addPair(doc, { type: 'prismatic', guide, slider, a: { ...a }, b: { ...b } }));
    this.activate();
    const nums = app.linkNumbers();
    app.flash(`Link ${nums.get(slider)} now slides ${guide ? `in link ${nums.get(guide)}` : 'on the ground'}.`);
  },
  move(app, ev) { this.current = ev.snap.p; },
  cancel() { const had = !!this.slider; this.activate(); return had; },
  drawOverlay(ctx, app) {
    for (const id of [this.slider, this.guide]) {
      if (!id) continue;
      const l = linkById(app.doc, id);
      if (!l) continue;
      ctx.strokeStyle = THEME.preview; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      l.joints.forEach((jid, i) => { const p = app.view.toScreen(app.sim.jointPos(jid)); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (this.axisA && this.current) {
      const a = app.view.toScreen(this.axisA), b = app.view.toScreen(this.current);
      ctx.strokeStyle = THEME.preview; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  },
};

// ---- Roll / Roll + slip ---------------------------------------------------------------

/**
 * Which contour is under the cursor? Returns { ref, label, shape, body } or null.
 * Thin construction curves win over the wide areas of wheels and links.
 */
export function pickContour(app, ev) {
  const nums = app.linkNumbers();
  const hit = app.pickAt(ev.s);
  if (hit && hit.kind === 'construction') {
    const e = app.doc.construction.find((x) => x.id === hit.id);
    const owner = e.attach ? `on link ${nums.get(e.attach)}` : 'fixed';
    if (e.kind === 'circle' || e.kind === 'arc') return { ref: { kind: 'entity', id: e.id }, shape: 'circle', body: e.attach, label: `circle (${owner})` };
    if (e.kind === 'segment' || e.kind === 'xline') return { ref: { kind: 'entity', id: e.id }, shape: 'line', body: e.attach, label: `line (${owner})` };
  }
  const l = app.pickLink(ev.s, 10);
  if (l) {
    const link = linkById(app.doc, l);
    if (link.disc) return { ref: { kind: 'disc', link: l }, shape: 'circle', body: l, label: `wheel ${nums.get(l)}` };
    if (link.joints.length >= 2) return { ref: { kind: 'linkline', link: l }, shape: 'line', body: l, label: `the centre line of link ${nums.get(l)}` };
  }
  return null;
}

function contactTool(spec) {
  return {
    ...spec,
    first: null,
    activate() { this.first = null; },
    hint() {
      return this.first
        ? `First: ${this.first.label}. Now click what it ${spec.slip ? 'touches' : 'rolls on'}: a wheel, a circle, a line or a link.`
        : `Click a wheel, a circle or arc, a construction line, or a link. ${spec.explain}`;
    },
    down(app, ev) {
      const c = pickContour(app, ev);
      if (!c) { app.flash('Click a wheel, a circle, a line or a link.'); return; }
      if (!this.first) { this.first = c; return; }
      const a = this.first;
      if (a.shape === 'line' && c.shape === 'line') { app.flash('At least one of the two must be round (a wheel, circle or arc).'); return; }
      if ((a.body || null) === (c.body || null)) { app.flash('Both contours belong to the same body, so they cannot roll on each other.'); return; }
      app.edit(spec.undoLabel, (doc) => addPair(doc, { type: spec.type, a: a.ref, b: c.ref }));
      this.first = null;
      if (!app.sim.assembled) app.flash('The two contours cannot be brought into contact in this position. Check sizes and positions.', true);
      else app.flash(`${spec.done} ${a.label} and ${c.label}.`);
    },
    cancel() { const had = !!this.first; this.first = null; return had; },
    drawOverlay(ctx, app) {
      if (!this.first) return;
      ctx.strokeStyle = THEME.preview; ctx.lineWidth = 3;
      const r = this.first.ref;
      if (r.kind === 'disc') {
        const l = linkById(app.doc, r.link);
        const c = app.view.toScreen(app.sim.jointPos(l.joints[0]));
        ctx.beginPath(); ctx.arc(c.x, c.y, l.disc * app.view.zoom, 0, 2 * Math.PI); ctx.stroke();
      } else if (r.kind === 'linkline') {
        const l = linkById(app.doc, r.link);
        const a = app.view.toScreen(app.sim.jointPos(l.joints[0])), b = app.view.toScreen(app.sim.jointPos(l.joints[1]));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      } else {
        const e = app.currentConstruction().find((x) => x.id === r.id);
        if (!e) return;
        ctx.beginPath();
        if (e.kind === 'circle' || e.kind === 'arc') { const c = app.view.toScreen(e.c); ctx.arc(c.x, c.y, e.r * app.view.zoom, 0, 2 * Math.PI); }
        else { const a = app.view.toScreen(e.a), b = app.view.toScreen(e.b); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
        ctx.stroke();
      }
    },
  };
}

export const rollTool = contactTool({
  id: 'roll', label: 'Roll joint (no slip)', shortcut: 'O', group: 'Mechanism', icon: 'roll', layer: 'mechanism',
  type: 'roll', slip: false, undoLabel: 'Add roll joint', done: 'Rolling contact (no slip) between',
  explain: 'Pure rolling, as for friction wheels or the pitch circles of gears.',
});

export const rollSlideTool = contactTool({
  id: 'rollslide', label: 'Roll + slip joint', shortcut: 'Q', group: 'Mechanism', icon: 'rollslide', layer: 'mechanism',
  type: 'rollslide', slip: true, undoLabel: 'Add roll + slip joint', done: 'Contact with slipping (half joint) between',
  explain: 'Contact that may slip, as for a cam and follower or real gear teeth.',
});
