// =============================================================================
// snap.js — snapping the cursor to exact geometric points
// -----------------------------------------------------------------------------
// Priority (nearest within the snap radius wins inside each group):
//   1. exact points: joints, construction points, end points, centres and
//      INTERSECTIONS of lines, arcs and circles
//   2. "on" a line, arc or circle (nearest point on the curve)
//   3. grid (only when grid snapping is switched on)
// Exact intersection snapping is what makes graphical constructions precise:
// a pivot found from two arcs lands exactly on their intersection.
// =============================================================================

import {
  lineLine, lineCircle, circleCircle, nearestOnLine, nearestOnCircle, angleInSweep,
} from '../../../../packages/core-math/src/index.js';
import { entityPoints } from '../model/construction.js';
import { DRAWING } from '../config.js';

/** Curves in a form the intersection routines understand. */
function asCurve(e) {
  switch (e.kind) {
    case 'segment': return { type: 'line', a: e.a, b: e.b, seg: true, id: e.id };
    case 'xline': return { type: 'line', a: e.a, b: e.b, seg: false, id: e.id };
    case 'circle': return { type: 'circle', c: e.c, r: e.r, id: e.id };
    case 'arc': return { type: 'circle', c: e.c, r: e.r, a0: e.a0, sweep: e.sweep, id: e.id };
    default: return null;
  }
}

const onCurve = (cv, p, t) => {
  if (cv.type === 'line') return !cv.seg || (t >= -1e-9 && t <= 1 + 1e-9);
  if (cv.sweep === undefined) return true;
  return angleInSweep(Math.atan2(p.y - cv.c.y, p.x - cv.c.x), cv.a0, cv.sweep);
};

function intersect(c1, c2) {
  const out = [];
  if (c1.type === 'line' && c2.type === 'line') {
    const r = lineLine(c1.a, c1.b, c2.a, c2.b);
    if (r && onCurve(c1, r.point, r.t) && onCurve(c2, r.point, r.u)) out.push(r.point);
  } else if (c1.type === 'line' || c2.type === 'line') {
    const [L, C] = c1.type === 'line' ? [c1, c2] : [c2, c1];
    for (const r of lineCircle(L.a, L.b, C.c, C.r)) if (onCurve(L, r.point, r.t) && onCurve(C, r.point)) out.push(r.point);
  } else {
    for (const p of circleCircle(c1.c, c1.r, c2.c, c2.r)) if (onCurve(c1, p) && onCurve(c2, p)) out.push(p);
  }
  return out;
}

/**
 * Collect snap targets from the drawing as it currently appears.
 * `items` = { construction: [entities at current pose], joints: [{id, p}], extra: [{p, kind}] }
 */
export function buildSnapTargets(items, options = {}) {
  const points = [];
  const curves = [];
  for (const e of items.construction) {
    for (const ep of entityPoints(e)) points.push({ ...ep, ref: e.id });
    const cv = asCurve(e);
    if (cv) curves.push(cv);
    if (options.midpoints && e.kind === 'segment') {
      points.push({ p: { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }, kind: 'midpoint', ref: e.id });
    }
  }
  for (let i = 0; i < curves.length; i++) {
    for (let k = i + 1; k < curves.length; k++) {
      for (const p of intersect(curves[i], curves[k])) points.push({ p, kind: 'intersection', ref: null, refs: [curves[i].id, curves[k].id] });
    }
  }
  for (const j of items.joints) points.push({ p: j.p, kind: 'joint', ref: j.id });
  for (const x of items.extra || []) points.push(x);
  return { points, curves };
}

/**
 * Snap a world point. `pxToMm` converts the snap radius from screen pixels.
 * `exclude(ref)` can skip targets (e.g. the point being dragged).
 */
export function snapPoint(targets, p, pxToMm, options = {}) {
  const R = DRAWING.snapRadiusPx * pxToMm;
  const exclude = options.exclude || (() => false);
  // When targets coincide (a pivot placed on an intersection), prefer
  // joints, then intersections, then other points.
  const RANK = { joint: 0, intersection: 1 };
  let best = null, bs = Infinity;
  for (const t of targets.points) {
    if (exclude(t.ref) || (t.refs && t.refs.some(exclude))) continue;
    const d = Math.hypot(t.p.x - p.x, t.p.y - p.y);
    if (d > R) continue;
    const score = d + (RANK[t.kind] ?? 2) * 0.15 * R;
    if (score < bs) { bs = score; best = t; }
  }
  if (best) return { p: { ...best.p }, kind: best.kind, ref: best.ref };

  if (options.onCurves !== false) {
    let bc = null, bdc = R * 0.75;
    for (const cv of targets.curves) {
      if (exclude(cv.id)) continue;
      let q;
      if (cv.type === 'line') {
        const n = nearestOnLine(p, cv.a, cv.b, cv.seg);
        q = n.point;
      } else {
        q = nearestOnCircle(p, cv.c, cv.r);
        if (!onCurve(cv, q)) continue;
      }
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bdc) { bdc = d; bc = { p: q, kind: 'on', ref: cv.id }; }
    }
    if (bc) return bc;
  }

  if (options.grid) {
    const g = options.grid;
    const q = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
    if (Math.hypot(q.x - p.x, q.y - p.y) < R) return { p: q, kind: 'grid', ref: null };
  }
  return { p: { ...p }, kind: null, ref: null };
}

/** Readable names for the snap marker tooltip. */
export const SNAP_NAMES = {
  point: 'point', endpoint: 'end point', center: 'centre', intersection: 'intersection',
  joint: 'joint', midpoint: 'midpoint', on: 'on curve', grid: 'grid',
};
