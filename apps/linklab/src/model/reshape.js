// =============================================================================
// reshape.js — editing a drawing while fixed lengths stay fixed
// -----------------------------------------------------------------------------
// A link's lengths are either free or fixed (link.locked; doc.lockDesign fixes
// them all). Every edit that moves a joint goes through here, so that:
//   * a fixed link keeps all the distances between its joints,
//   * a free link simply stretches,
//   * ground pivots stay where they are (unless the pivot itself is moved).
//
// The method is the simplest that does this well for a drawing of a few dozen
// joints: move the joint that was asked for, then lay every fixed link, as a
// rigid piece, back onto its joints, one link after another, until they all
// fit ("shape matching"). A joint that is asked to go where the fixed links
// cannot reach ends as near as they allow.
//
//   dragJoint(doc, jointId, p)          a joint is dragged or typed to p
//   setLinkLength(doc, linkId, length)  a length is typed
//   joinKeepingLengths(doc, keep, drop) two joints become one pin
// All three change `doc` in place and report what happened.
// =============================================================================

import { jointById, linkById, mergeJoints } from './document.js';
import { RESHAPE } from '../config.js';

/** Is this link's length fixed? */
export const isFixed = (doc, link) => !!doc.lockDesign || !!link.locked;

/** Every fixed distance in the drawing: [{ a, b, len }] (joint ids, mm). */
export function fixedDistances(doc) {
  const out = [];
  for (const link of doc.links) {
    if (!isFixed(doc, link)) continue;
    const J = link.joints.map((id) => jointById(doc, id));
    for (let i = 0; i < J.length; i++) {
      for (let k = i + 1; k < J.length; k++) {
        out.push({ a: J[i].id, b: J[k].id, len: Math.hypot(J[k].x - J[i].x, J[k].y - J[i].y) });
      }
    }
  }
  return out;
}

/** Every fixed link as a rigid shape: [{ ids, rest: [{x, y}] }] (rest: its joints as drawn). */
function fixedShapes(doc) {
  const out = [];
  for (const link of doc.links) {
    if (!isFixed(doc, link) || link.joints.length < 2) continue;
    out.push({ ids: link.joints.slice(), rest: link.joints.map((id) => { const j = jointById(doc, id); return { x: j.x, y: j.y }; }) });
  }
  return out;
}

/** Joints that never move in a reshape: ground pivots and joints riding on a rail. */
function anchorsOf(doc, except = null) {
  const out = new Set();
  for (const j of doc.joints) if (j.ground && j.id !== except) out.add(j.id);
  for (const s of doc.sliders || []) if (s.joint !== except) out.add(s.joint);
  return out;
}

/** The largest error of the fixed shapes at positions P: a distance between two of a shape's joints (mm). */
function worstError(P, shapes) {
  let worst = 0;
  for (const s of shapes) {
    for (let i = 0; i < s.ids.length; i++) {
      for (let k = i + 1; k < s.ids.length; k++) {
        const a = P.get(s.ids[i]), b = P.get(s.ids[k]);
        const len = Math.hypot(s.rest[k].x - s.rest[i].x, s.rest[k].y - s.rest[i].y);
        worst = Math.max(worst, Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - len));
      }
    }
  }
  return worst;
}

/**
 * One pass over the fixed shapes: lay each shape, turned and moved as a rigid
 * piece, as well as it can be laid on where its joints are now (held joints
 * count far more than the others), and put its other joints there.
 */
function relaxOnce(P, shapes, held) {
  for (const s of shapes) {
    const w = s.ids.map((id) => (held.has(id) ? RESHAPE.heldWeight : 1));
    const W = w.reduce((x, y) => x + y, 0);
    let rx = 0, ry = 0, px = 0, py = 0;
    s.ids.forEach((id, i) => { const p = P.get(id); rx += w[i] * s.rest[i].x; ry += w[i] * s.rest[i].y; px += w[i] * p.x; py += w[i] * p.y; });
    rx /= W; ry /= W; px /= W; py /= W;
    // the turn that fits best (two-dimensional least squares)
    let sin = 0, cos = 0;
    s.ids.forEach((id, i) => {
      const p = P.get(id), ax = s.rest[i].x - rx, ay = s.rest[i].y - ry, bx = p.x - px, by = p.y - py;
      cos += w[i] * (ax * bx + ay * by); sin += w[i] * (ax * by - ay * bx);
    });
    const n = Math.hypot(sin, cos);
    if (n < 1e-18) continue;                                // all its joints on one spot: nothing to go by
    sin /= n; cos /= n;
    s.ids.forEach((id, i) => {
      if (held.has(id)) return;
      const ax = s.rest[i].x - rx, ay = s.rest[i].y - ry, p = P.get(id);
      p.x = px + cos * ax - sin * ay; p.y = py + sin * ax + cos * ay;
    });
  }
}

/**
 * Find joint positions where every fixed shape keeps its form, starting from
 * the drawing. `held` joints stay exactly where P has them. With `pull`
 * ({ id, to }), that joint is drawn toward `to` but gives way where the fixed
 * links cannot follow. Returns { P, error } (error: the largest misfit, mm).
 */
function relax(doc, shapes, held, start = null, pull = null) {
  const P = new Map(doc.joints.map((j) => [j.id, { x: j.x, y: j.y }]));
  if (start) for (const [id, p] of start) P.set(id, { x: p.x, y: p.y });
  if (pull) {
    // draw the joint to the target, let the fixed links pull it back, and again
    for (let n = 0; n < RESHAPE.pullRounds; n++) {
      const p = P.get(pull.id); p.x = pull.to.x; p.y = pull.to.y;
      relaxOnce(P, shapes, held);
    }
  }
  let error = worstError(P, shapes);
  for (let n = 0; n < RESHAPE.maxPasses && error > RESHAPE.fit; n++) {
    relaxOnce(P, shapes, held);
    error = worstError(P, shapes);
  }
  return { P, error };
}

const write = (doc, P) => { for (const j of doc.joints) { const p = P.get(j.id); j.x = p.x; j.y = p.y; } };

/**
 * Move joint `jointId` to p. Fixed links keep their lengths and follow; free
 * links stretch. Where the fixed links cannot reach p, the joint goes as near
 * as they allow. Returns { reached } (false: it stopped short of p).
 */
export function dragJoint(doc, jointId, p) {
  const shapes = fixedShapes(doc);
  const anchors = anchorsOf(doc, jointId);
  // first try: the joint exactly at p
  const held = new Set([...anchors, jointId]);
  const exact = relax(doc, shapes, held, new Map([[jointId, p]]));
  if (exact.error <= RESHAPE.fit) { write(doc, exact.P); return { reached: true }; }
  // it cannot get there: as near as the fixed links allow
  const near = relax(doc, shapes, anchors, null, { id: jointId, to: p });
  if (near.error <= RESHAPE.fit) { write(doc, near.P); return { reached: false }; }
  return { reached: false };                                  // nothing fits: leave the drawing alone
}

/**
 * Set the length of a two-joint link. One end stays where it is when that is
 * possible (a ground pivot, else the first joint); fixed neighbours keep their
 * lengths and turn, free ones stretch. Returns { ok } or { ok: false, why }
 * with the drawing unchanged.
 */
export function setLinkLength(doc, linkId, length) {
  const link = linkById(doc, linkId);
  if (!link || link.joints.length !== 2 || !(length > 0)) return { ok: false, why: 'Type a length above zero.' };
  const [a, b] = link.joints;
  // every fixed link as it is, and this one as a bar of the new length
  const shapes = fixedShapes(doc).filter((sh) => !(sh.ids.length === 2 && sh.ids.includes(a) && sh.ids.includes(b)));
  shapes.push({ ids: [a, b], rest: [{ x: 0, y: 0 }, { x: length, y: 0 }] });
  const anchors = anchorsOf(doc);
  // which end stays: a ground pivot if there is one, else the first joint, then the other, then neither
  const ja = jointById(doc, a), jb = jointById(doc, b);
  const order = jb.ground && !ja.ground ? [b, a, null] : [a, b, null];
  for (const stay of order) {
    const held = new Set(anchors); if (stay) held.add(stay);
    const r = relax(doc, shapes, held);
    if (r.error <= RESHAPE.fit) { write(doc, r.P); return { ok: true }; }
  }
  return { ok: false, why: 'That length does not fit with the fixed lengths and ground pivots around it. Free one of them first (the padlock on the link).' };
}

/**
 * Join joint `dropId` into `keepId` (one pin). The fixed lengths are those
 * from before the join, so a part dropped a hair off the pin is not stretched:
 * it is moved to fit. Returns { ok } or { ok: false, why }, drawing unchanged.
 */
export function joinKeepingLengths(doc, keepId, dropId) {
  if (doc.links.some((l) => l.joints.includes(keepId) && l.joints.includes(dropId))) {
    return { ok: false, why: 'These joints are on the same link, so they cannot be joined.' };
  }
  const before = JSON.stringify(doc);
  const shapes = fixedShapes(doc).map((sh) => ({ ids: sh.ids.map((id) => (id === dropId ? keepId : id)), rest: sh.rest }));
  if (!mergeJoints(doc, keepId, dropId)) return { ok: false, why: 'These joints cannot be joined.' };
  if (!shapes.length) return { ok: true };
  const anchors = anchorsOf(doc);
  // the pin stays put if it can; otherwise it may move too (both parts fixed elsewhere)
  for (const held of [new Set([...anchors, keepId]), anchors]) {
    const r = relax(doc, shapes, held);
    if (r.error <= RESHAPE.fit) { write(doc, r.P); return { ok: true }; }
  }
  // the parts cannot meet with their lengths fixed: put everything back
  Object.assign(doc, JSON.parse(before));
  return { ok: false, why: 'The fixed lengths do not let these joints meet. Move the parts closer or free a length (the padlock on the link).' };
}
