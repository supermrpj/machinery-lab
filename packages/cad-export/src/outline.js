// =============================================================================
// outline.js — the profile of a link for manufacture
// -----------------------------------------------------------------------------
// A link is drawn as the outline around its joints at distance R (half the
// link width): for two joints this is the familiar slot shape (two half
// circles joined by straight sides); for three or more it is a rounded plate.
// Mathematically: the convex hull of the joints, offset outward by R.
// Returns straight edges and arcs (angles in degrees, counter-clockwise).
// =============================================================================

import { convexHull } from '../../core-math/src/index.js';

export function linkOutline(points, R) {
  const unique = points.filter((p, i) => points.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9) === i);
  if (unique.length === 1) return { circle: { c: unique[0], r: R }, lines: [], arcs: [] };
  const hull = unique.length === 2 ? unique : convexHull(unique); // counter-clockwise
  const n = hull.length;
  const normals = [];
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    normals.push({ x: dy / L, y: -dx / L }); // outward for a counter-clockwise loop
  }
  const lines = [], arcs = [];
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n], nm = normals[i];
    lines.push({ a: { x: a.x + nm.x * R, y: a.y + nm.y * R }, b: { x: b.x + nm.x * R, y: b.y + nm.y * R } });
    // arc around vertex b, from this edge's normal to the next edge's normal
    const next = normals[(i + 1) % n];
    const deg = (v) => (Math.atan2(v.y, v.x) * 180) / Math.PI;
    arcs.push({ c: b, r: R, start: deg(nm), end: deg(next) });
  }
  return { circle: null, lines, arcs };
}
