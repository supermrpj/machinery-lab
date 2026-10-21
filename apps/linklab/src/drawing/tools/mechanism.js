// =============================================================================
// mechanism.js — tools that build the linkage
// -----------------------------------------------------------------------------
//   Ground pivot   click to place a fixed pivot (or click a joint to fix it)
//   Link           click joint → joint → joint … to draw a chain of links
//   Point on link  click a link to add a point that moves with it (coupler point)
//   Slider         click a joint, then a line it should slide along
//   Outline        draw any shape and attach it to a link
// =============================================================================

import { addJoint, addLink, addSlider, attachJoint, mergeJoints, jointById, newId } from '../../model/document.js';
import { constrainAngle } from './basic.js';
import { nearestOnLine, polygonArea } from '../../../../../packages/core-math/src/index.js';
import { THEME, DRAWING } from '../../config.js';

/**
 * Existing joint that was clicked: the snap landed on it, it sits exactly at
 * the snapped point, or the click is on its circle even though the snap chose
 * a point next to it (a construction end point, say). Without the last check
 * a click on a joint could add a second, unconnected joint beside it.
 */
function snappedJoint(app, ev) {
  if (ev.snap.kind === 'joint') return jointById(app.doc, ev.snap.ref);
  const tol = app.view.px(1);
  const there = app.doc.joints.find((j) => {
    const p = app.sim.jointPos(j.id);
    return Math.hypot(p.x - ev.snap.p.x, p.y - ev.snap.p.y) < tol;
  });
  if (there || !ev.s) return there || null;
  const w = app.view.toWorld(ev.s);
  let best = null, bd = app.view.px(DRAWING.jointRadiusPx + 3);
  for (const j of app.doc.joints) {
    const p = app.sim.jointPos(j.id), d = Math.hypot(p.x - w.x, p.y - w.y);
    if (d <= bd) { bd = d; best = j; }
  }
  return best;
}

/** Other joints on exactly the same spot as joint `id` (links that only look joined). */
function twinsOf(app, id) {
  const p = app.sim.jointPos(id), tol = app.view.px(1);
  return app.doc.joints.filter((o) => {
    if (o.id === id) return false;
    const q = app.sim.jointPos(o.id);
    return Math.hypot(q.x - p.x, q.y - p.y) <= tol;
  });
}

/**
 * Link under screen point s that does not already carry joint `jointId`
 * (so a joint can be pinned to a link that passes over it), or null.
 */
export function otherLinkAt(app, s, jointId, tolPx) {
  const hit = otherLinkHit(app, s, jointId, tolPx);
  return hit ? hit.id : null;
}

/** As otherLinkAt, with the nearest point on the link's centre line: { id, p }. */
function otherLinkHit(app, s, jointId, tolPx) {
  const w = app.view.toWorld(s), tol = app.view.px(tolPx);
  let best = null, bd = tol, bp = null;
  for (const l of app.doc.links) {
    if (l.disc || (jointId && l.joints.includes(jointId))) continue;
    const pts = l.joints.map((id) => app.sim.jointPos(id));
    for (let i = 0; i < pts.length; i++) {
      for (let k = i + 1; k < pts.length; k++) {
        const n = nearestOnLine(w, pts[i], pts[k], true).point;
        const d = Math.hypot(n.x - w.x, n.y - w.y);
        if (d < bd) { bd = d; best = l.id; bp = n; }
      }
    }
  }
  return best ? { id: best, p: bp } : null;
}


// ---- Ground pivot -------------------------------------------------------------
export const groundTool = {
  id: 'ground', label: 'Ground pivot', shortcut: 'G', group: 'Mechanism', icon: 'ground', layer: 'mechanism',
  hint: () => 'Click to place a fixed ground pivot (on a link, it pivots that link there; hold Shift to keep it apart). Click an existing joint to pin it to the ground (or free it).',
  down(app, ev) {
    const j = snappedJoint(app, ev);
    if (j) {
      // joints that only sit on top of each other become one pin, fixed to the ground
      const twins = twinsOf(app, j.id).filter((t) => !app.doc.links.some((l) => l.joints.includes(j.id) && l.joints.includes(t.id)));
      if (twins.length) {
        app.edit('Join and pin to ground', (doc) => {
          for (const t of twins) mergeJoints(doc, j.id, t.id);
          jointById(doc, j.id).ground = true;
        });
        app.flash('The joints on this spot are now one pin, fixed to the ground.');
        return;
      }
      app.edit(j.ground ? 'Free joint from ground' : 'Pin joint to ground', (doc) => {
        const jj = jointById(doc, j.id);
        jj.ground = !jj.ground;
      });
      return;
    }
    // on the body of a link: the link pivots about the ground there (as the Link tool pins a new end)
    const under = !ev.shift ? otherLinkHit(app, ev.s, null, 6) : null;
    const p = under && (!ev.snap.kind || ev.snap.kind === 'grid') ? under.p : ev.snap.p;
    app.edit('Add ground pivot', (doc) => {
      const g = addJoint(doc, p.x, p.y, { ground: true });
      if (under) attachJoint(doc, g.id, under.id);
    });
    if (under) app.flash(`Ground pivot on link ${app.linkNumbers().get(under.id)}: the link turns about it.`);
  },
};

// ---- Link (chain) ----------------------------------------------------------------
export const linkTool = {
  id: 'link', label: 'Link', shortcut: 'K', group: 'Mechanism', icon: 'link', layer: 'mechanism',
  from: null,       // joint id where the next link starts
  current: null,
  activate() { this.from = null; this.current = null; },
  hint(app) {
    return this.from
      ? 'Click the other end of the link (an existing joint or empty space). Keep clicking to chain links. Esc or right-click to stop.'
      : 'Click a joint or ground pivot to start a link, or click empty space to start with a new joint.';
  },
  down(app, ev) {
    if (ev.button === 2) { this.from = null; return; }
    const hit = snappedJoint(app, ev);
    if (!this.from) {
      if (hit) { this.from = hit.id; return; }
      // start from a new joint, pinned to the link under it if there is one
      const under = otherLinkHit(app, ev.s, null, 6);
      const p = under && (!ev.snap.kind || ev.snap.kind === 'grid') ? under.p : ev.snap.p;
      let id = null;
      app.edit('Add joint', (doc) => {
        id = addJoint(doc, p.x, p.y).id;
        if (under) attachJoint(doc, id, under.id);
      });
      if (under) app.flash(`Pinned to link ${app.linkNumbers().get(under.id)}.`);
      this.from = id;
      return;
    }
    const to = hit ? hit.id : null;
    if (to === this.from) return;
    let p = constrainAngle(app.sim.jointPos(this.from), ev.snap.p, ev.shift);
    let endId = to;
    // a new end on the body of another link is pinned to that link (on its
    // centre line, unless it snapped to a drawn point)
    const hitLink = !to && !ev.shift ? otherLinkHit(app, ev.s, this.from, 6) : null;
    const onLink = hitLink ? hitLink.id : null;
    if (hitLink && (!ev.snap.kind || ev.snap.kind === 'grid')) p = hitLink.p;
    app.edit('Add link', (doc) => {
      if (!endId) endId = addJoint(doc, p.x, p.y).id;
      const already = doc.links.some((l) => l.joints.includes(this.from) && l.joints.includes(endId));
      if (!already) addLink(doc, [this.from, endId]);
      if (onLink) attachJoint(doc, endId, onLink);
    });
    if (onLink) app.flash(`Pinned to link ${app.linkNumbers().get(onLink)}.`);
    this.from = endId;
  },
  move(app, ev) {
    this.current = this.from ? constrainAngle(app.sim.jointPos(this.from), ev.snap.p, ev.shift) : null;
  },
  cancel() { const had = !!this.from; this.from = null; return had; },
  drawOverlay(ctx, app) {
    if (!this.from || !this.current) return;
    const a = app.view.toScreen(app.sim.jointPos(this.from)), b = app.view.toScreen(this.current);
    ctx.strokeStyle = 'rgba(30, 91, 215, 0.45)'; ctx.lineWidth = 14; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const w = app.view.toWorld(a);
    const L = Math.hypot(this.current.x - w.x, this.current.y - w.y);
    app.renderer.label({ x: b.x + 14, y: b.y - 16 }, app.units.fmt(L), THEME.preview);
  },
};

// ---- Point on link (coupler point) ----------------------------------------------
export const couplerTool = {
  id: 'coupler', label: 'Point on link', shortcut: 'J', group: 'Mechanism', icon: 'coupler', layer: 'mechanism',
  hint: () => 'Click on or near a link to add a point that moves with it; its path (coupler curve) is traced. Click a joint that lies on another link to pin it to that link.',
  down(app, ev) {
    // an existing joint over another link: pin it to that link (no second joint on top)
    const j = snappedJoint(app, ev);
    if (j) {
      const target = otherLinkAt(app, ev.s, j.id, 12);
      if (!target) { app.flash('That joint is not over another link. Click on a link to add a point to it.'); return; }
      // the link may already have its own joint on this spot: join the two instead
      const p = app.sim.jointPos(j.id), tol = app.view.px(3);
      const twin = app.doc.links.find((l) => l.id === target).joints
        .find((id) => { const q = app.sim.jointPos(id); return Math.hypot(q.x - p.x, q.y - p.y) <= tol; });
      app.edit('Pin joint to link', (doc) => { if (twin) mergeJoints(doc, j.id, twin); else attachJoint(doc, j.id, target); });
      app.flash(`Joint pinned to link ${app.linkNumbers().get(target)}.`);
      return;
    }
    const hit = app.pickLink(ev.s, 40);
    if (!hit) { app.flash('Click on a link (or close to it) to add a point to it.'); return; }
    app.edit('Add point on link', (doc) => {
      const nj = addJoint(doc, ev.snap.p.x, ev.snap.p.y, { trace: true });
      doc.links.find((l) => l.id === hit).joints.push(nj.id);
    });
  },
};

// ---- Slider -------------------------------------------------------------------------
export const sliderTool = {
  id: 'slider', label: 'Slider (pin in slot)', shortcut: 'S', group: 'Mechanism', icon: 'slider', layer: 'mechanism',
  joint: null, railA: null, current: null,
  activate() { this.joint = null; this.railA = null; },
  hint() {
    if (!this.joint) return 'Click the joint that should slide (a slider-crank: the end of the rod; an inverted slider-crank: the pivot the link passes through).';
    if (!this.railA) return 'Click what it slides along: a line, a construction line or a link — or click the first point of a new fixed rail.';
    return 'Click the second point of the rail. Hold Shift for 15° steps.';
  },
  down(app, ev) {
    if (!this.joint) {
      const j = snappedJoint(app, ev);
      if (!j) { app.flash('Click an existing joint first.'); return; }
      this.joint = j.id;
      return;
    }
    let a, b, on = null;
    if (!this.railA) {
      const curve = ev.snap.kind === 'on' && app.currentConstruction().find((e) => e.id === ev.snap.ref && (e.kind === 'segment' || e.kind === 'xline'));
      const link = !curve && app.pickLink(ev.s, 10);
      if (curve) { a = curve.a; b = curve.b; on = curve.attach || null; }
      else if (link && app.doc.links.find((l) => l.id === link).joints.length >= 2 && !app.doc.links.find((l) => l.id === link).joints.includes(this.joint)) {
        // slide along the centre line of a moving link (pin in a slot cut in the link)
        const l = app.doc.links.find((x) => x.id === link);
        a = app.sim.jointPos(l.joints[0]); b = app.sim.jointPos(l.joints[1]); on = link;
      } else { this.railA = ev.snap.p; return; }
    } else {
      a = this.railA; b = constrainAngle(this.railA, ev.snap.p, ev.shift);
      if (Math.hypot(b.x - a.x, b.y - a.y) < app.view.px(4)) return;
    }
    if (on && app.doc.links.find((l) => l.id === on).joints.includes(this.joint)) {
      app.flash('A joint cannot slide along a link it belongs to.'); return;
    }
    const jid = this.joint;
    app.edit('Add slider', (doc) => {
      const j = jointById(doc, jid);
      const n = nearestOnLine(j, a, b, false).point;
      // a moving joint is put exactly on the rail; a ground pivot stays put and
      // the solver brings the link to it
      if (!j.ground) { j.x = n.x; j.y = n.y; }
      // make the rail long enough to show the full travel
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      const t = ((n.x - a.x) * dx + (n.y - a.y) * dy) / (L * L);
      const half = on ? Math.max(L * 0.75, 20) : Math.max(L / 2, 1.5 * longestLink(doc));
      const cx = a.x + dx * (on ? 0.5 : t), cy = a.y + dy * (on ? 0.5 : t), ux = dx / L, uy = dy / L;
      addSlider(doc, jid, { x: cx - ux * half, y: cy - uy * half }, { x: cx + ux * half, y: cy + uy * half }, on);
    });
    this.joint = null; this.railA = null;
    if (!app.sim.assembled) app.flash('The joint cannot reach that rail in this position. Check the link lengths.', true);
  },
  move(app, ev) { this.current = ev.snap.p; },
  cancel() { const had = !!(this.joint || this.railA); this.joint = null; this.railA = null; return had; },
  drawOverlay(ctx, app) {
    if (this.joint) {
      const p = app.view.toScreen(app.sim.jointPos(this.joint));
      ctx.strokeStyle = THEME.preview; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, 2 * Math.PI); ctx.stroke();
    }
    if (this.railA && this.current) {
      const a = app.view.toScreen(this.railA), b = app.view.toScreen(this.current);
      ctx.strokeStyle = THEME.preview; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  },
};

// ---- Outline (body shape) ------------------------------------------------------------
export const bodyTool = {
  id: 'body', label: 'Outline', shortcut: 'B', group: 'Mechanism', icon: 'body', layer: 'bodies',
  pts: [], current: null, drawing: false, freehand: false, downAt: null,
  activate() { this.pts = []; this.freehand = false; },
  hint() {
    if (this.freehand) return 'Drawing freehand… release to finish.';
    return this.pts.length
      ? 'Click to add corners. Click the first corner, double-click or press Enter to close the shape. Esc cancels.'
      : 'Click corners to draw a shape, or press and drag to draw freehand. It moves with the link it is drawn on.';
  },
  down(app, ev) {
    this.downAt = ev.s;
    if (this.pts.length >= 3) {
      const first = app.view.toScreen(this.pts[0]);
      if (Math.hypot(first.x - ev.s.x, first.y - ev.s.y) < 10) { this.finish(app); return; }
    }
    this.pts.push(ev.snap.p);
    this.drawing = true;
  },
  move(app, ev) {
    this.current = ev.snap.p;
    if (this.drawing && this.downAt && this.pts.length === 1 && Math.hypot(ev.s.x - this.downAt.x, ev.s.y - this.downAt.y) > 6) {
      this.freehand = true;
    }
    if (this.freehand && this.drawing) {
      const last = this.pts[this.pts.length - 1];
      if (Math.hypot(ev.w.x - last.x, ev.w.y - last.y) > app.view.px(3)) this.pts.push(ev.w);
    }
  },
  up(app) {
    this.drawing = false;
    if (this.freehand) { this.pts = simplify(this.pts, app.view.px(1.5)); this.finish(app); }
  },
  dblclick(app) { if (this.pts.length >= 3) this.finish(app); },
  key(app, e) { if (e.key === 'Enter' && this.pts.length >= 3) { this.finish(app); return true; } return false; },
  cancel() { const had = this.pts.length > 0; this.pts = []; this.freehand = false; return had; },
  finish(app) {
    // remove a duplicate last point from a double-click
    const pts = this.pts.filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) > 1e-9);
    this.pts = []; this.freehand = false;
    if (pts.length < 3 || Math.abs(polygonArea(pts)) < 1e-6) return;
    const c = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, y: s.y + p.y / pts.length }), { x: 0, y: 0 });
    const attach = app.pickLink(app.view.toScreen(c), 60) || app.pickLink(app.view.toScreen(pts[0]), 60);
    app.edit('Draw outline', (doc) => {
      doc.bodies.push({ id: newId(doc, 'b'), attach: attach || null, pts, closed: true });
    });
    app.flash(attach ? `Outline attached to link ${app.linkNumbers().get(attach)}.` : 'Outline fixed to the ground. Change it in Properties.');
  },
  drawOverlay(ctx, app) {
    if (!this.pts.length) return;
    ctx.strokeStyle = THEME.preview; ctx.lineWidth = 1.5;
    ctx.beginPath();
    this.pts.forEach((p, i) => { const s = app.view.toScreen(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
    if (this.current && !this.freehand) { const s = app.view.toScreen(this.current); ctx.lineTo(s.x, s.y); }
    ctx.stroke();
  },
};

/** Ramer–Douglas–Peucker simplification of a freehand stroke. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, k] = stack.pop();
    let best = -1, bd = tol;
    for (let m = i + 1; m < k; m++) {
      const n = nearestOnLine(pts[m], pts[i], pts[k], true).point;
      const d = Math.hypot(pts[m].x - n.x, pts[m].y - n.y);
      if (d > bd) { bd = d; best = m; }
    }
    if (best >= 0) { keep[best] = true; stack.push([i, best], [best, k]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Longest distance between two joints of any link (mm). */
function longestLink(doc) {
  let m = 0;
  for (const l of doc.links) {
    for (let i = 0; i < l.joints.length; i++) {
      for (let k = i + 1; k < l.joints.length; k++) {
        const a = jointById(doc, l.joints[i]), b = jointById(doc, l.joints[k]);
        m = Math.max(m, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
  }
  return m || 100;
}
