// =============================================================================
// geometry.js — intersections and nearest-point queries
// -----------------------------------------------------------------------------
// Used by the drafting tools (snapping to intersections) and by the closed-form
// kinematics. Lines are given by two points {a, b}; `infinite` lines extend
// past both points, segments do not. Circles are {c, r}.
// =============================================================================

import { sub, add, scale, dot, cross, dist, length } from './vec2.js';

const EPS = 1e-12;

/** Intersection of two lines through (p1,p2) and (p3,p4). Returns null if parallel. */
export function lineLine(p1, p2, p3, p4) {
  const d1 = sub(p2, p1), d2 = sub(p4, p3);
  const den = cross(d1, d2);
  if (Math.abs(den) < EPS * length(d1) * length(d2)) return null;
  const t = cross(sub(p3, p1), d2) / den;
  const u = cross(sub(p3, p1), d1) / den;
  return { point: add(p1, scale(d1, t)), t, u };
}

/**
 * Intersections of the line through (p1,p2) with a circle (c, r).
 * Returns 0, 1 or 2 results {point, t} where t is the parameter along p1→p2.
 */
export function lineCircle(p1, p2, c, r) {
  const d = sub(p2, p1), f = sub(p1, c);
  const A = dot(d, d);
  if (A < EPS) return [];
  const B = 2 * dot(f, d);
  const C = dot(f, f) - r * r;
  let disc = B * B - 4 * A * C;
  if (disc < -EPS * A * r * r) return [];
  disc = Math.max(disc, 0);
  const s = Math.sqrt(disc);
  const t1 = (-B - s) / (2 * A), t2 = (-B + s) / (2 * A);
  const out = [{ point: add(p1, scale(d, t1)), t: t1 }];
  if (s > 1e-9 * Math.abs(B) + EPS) out.push({ point: add(p1, scale(d, t2)), t: t2 });
  return out;
}

/** Intersections of two circles. Returns 0, 1 or 2 points. */
export function circleCircle(c1, r1, c2, r2) {
  const D = dist(c1, c2);
  if (D < EPS) return [];
  if (D > r1 + r2 + 1e-9 * (r1 + r2)) return [];
  if (D < Math.abs(r1 - r2) - 1e-9 * (r1 + r2)) return [];
  const a = (r1 * r1 - r2 * r2 + D * D) / (2 * D);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const ex = { x: (c2.x - c1.x) / D, y: (c2.y - c1.y) / D };
  const base = { x: c1.x + a * ex.x, y: c1.y + a * ex.y };
  if (h < 1e-12 * (r1 + r2)) return [base];
  return [
    { x: base.x - h * ex.y, y: base.y + h * ex.x },
    { x: base.x + h * ex.y, y: base.y - h * ex.x },
  ];
}

/** Nearest point on the line (or segment) through a,b to point p. */
export function nearestOnLine(p, a, b, segment = false) {
  const d = sub(b, a);
  const L2 = dot(d, d);
  if (L2 < EPS) return { point: { ...a }, t: 0 };
  let t = dot(sub(p, a), d) / L2;
  if (segment) t = Math.max(0, Math.min(1, t));
  return { point: add(a, scale(d, t)), t };
}

/** Nearest point on a circle to p. */
export function nearestOnCircle(p, c, r) {
  const v = sub(p, c);
  const L = length(v);
  if (L < EPS) return { x: c.x + r, y: c.y };
  return add(c, scale(v, r / L));
}

/**
 * Is angle t inside the counter-clockwise sweep that starts at a0 and spans
 * `sweep` radians (sweep may be negative for clockwise arcs)?
 */
export function angleInSweep(t, a0, sweep) {
  const TWO_PI = 2 * Math.PI;
  if (Math.abs(sweep) >= TWO_PI - 1e-9) return true;
  let rel = sweep >= 0 ? t - a0 : a0 - t;
  rel = ((rel % TWO_PI) + TWO_PI) % TWO_PI;
  return rel <= Math.abs(sweep) + 1e-9;
}

/** Signed area of a polygon (positive if counter-clockwise). */
export function polygonArea(pts) {
  let A = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    A += p.x * q.y - q.x * p.y;
  }
  return A / 2;
}

/** Point-in-polygon test (even-odd rule). */
export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Convex hull (Andrew's monotone chain), counter-clockwise. */
export function convexHull(points) {
  const pts = points.map((p) => ({ x: p.x, y: p.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const turn = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}
