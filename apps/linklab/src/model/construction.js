// =============================================================================
// construction.js — drafting entities on the construction layer
// -----------------------------------------------------------------------------
// Kinds (all coordinates in mm, design pose):
//   point    { p }
//   segment  { a, b }              straight line between two points
//   xline    { a, b }              construction line through a and b (infinite)
//   circle   { c, r }
//   arc      { c, r, a0, sweep }   start angle and signed sweep (radians)
//   dim      { a, b }              measured distance (shows length and angle)
// Every entity also has { id, kind, attach } — attach = null (fixed) or a link id.
// =============================================================================

import { newId } from './document.js';
import { nearestOnLine, angleInSweep } from '../../../../packages/core-math/src/index.js';

export function addConstruction(doc, kind, geom, attach = null) {
  const e = { id: newId(doc, 'c'), kind, attach, ...geom };
  doc.construction.push(e);
  return e;
}

/**
 * Apply a rigid transform to an entity. T maps a point; dphi is the rotation
 * angle (needed for arc start angles). Returns a NEW entity.
 */
export function transformEntity(e, T, dphi) {
  const out = { ...e };
  for (const key of ['p', 'a', 'b', 'c']) if (e[key]) out[key] = T(e[key]);
  if (e.kind === 'arc') out.a0 = e.a0 + dphi;
  return out;
}

/** Characteristic points of an entity (for snapping). */
export function entityPoints(e) {
  switch (e.kind) {
    case 'point': return [{ p: e.p, kind: 'point' }];
    case 'segment': return [{ p: e.a, kind: 'endpoint' }, { p: e.b, kind: 'endpoint' }];
    case 'xline': return [{ p: e.a, kind: 'point' }, { p: e.b, kind: 'point' }];
    case 'circle': return [{ p: e.c, kind: 'center' }];
    case 'arc': return [
      { p: e.c, kind: 'center' },
      { p: { x: e.c.x + e.r * Math.cos(e.a0), y: e.c.y + e.r * Math.sin(e.a0) }, kind: 'endpoint' },
      { p: { x: e.c.x + e.r * Math.cos(e.a0 + e.sweep), y: e.c.y + e.r * Math.sin(e.a0 + e.sweep) }, kind: 'endpoint' },
    ];
    case 'dim': return [{ p: e.a, kind: 'endpoint' }, { p: e.b, kind: 'endpoint' }];
    default: return [];
  }
}

/** Distance (mm) from point p to an entity — used for picking. */
export function distanceToEntity(e, p) {
  switch (e.kind) {
    case 'point': return Math.hypot(p.x - e.p.x, p.y - e.p.y);
    case 'segment':
    case 'dim': {
      const n = nearestOnLine(p, e.a, e.b, true).point;
      return Math.hypot(p.x - n.x, p.y - n.y);
    }
    case 'xline': {
      const n = nearestOnLine(p, e.a, e.b, false).point;
      return Math.hypot(p.x - n.x, p.y - n.y);
    }
    case 'circle': return Math.abs(Math.hypot(p.x - e.c.x, p.y - e.c.y) - e.r);
    case 'arc': {
      const t = Math.atan2(p.y - e.c.y, p.x - e.c.x);
      if (angleInSweep(t, e.a0, e.sweep)) return Math.abs(Math.hypot(p.x - e.c.x, p.y - e.c.y) - e.r);
      return Math.min(...entityPoints(e).slice(1).map((q) => Math.hypot(p.x - q.p.x, p.y - q.p.y)));
    }
    default: return Infinity;
  }
}

/** Human-readable name for the properties panel. */
export const ENTITY_NAMES = {
  point: 'Point', segment: 'Line', xline: 'Construction line', circle: 'Circle', arc: 'Arc', dim: 'Dimension',
};
