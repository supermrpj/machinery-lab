// =============================================================================
// mesh.js — closed triangle meshes for 3-D printing, and binary STL
// -----------------------------------------------------------------------------
// A part is built from flat faces (a polygon with holes), upright walls along
// polygons, and surfaces of revolution (a profile in (r, z) turned about a
// vertical axis). Neighbouring pieces share their vertices exactly (they are
// computed by the same functions), so the result is one closed surface that
// slicers accept without repair.
//
// Each triangle is given a "hint": a direction it should face (outward from
// the material). The winding is set from it, so the pieces do not need to be
// traversed in a particular order.
//
// Units: millimetres. z is up; a part lies on the print bed at z = 0.
// =============================================================================

import earcut from '../../../node_modules/earcut/src/earcut.js';

export class Mesh {
  constructor() { this.tris = []; }

  /** One triangle (points [x, y, z]) wound to face along `hint` ([x, y, z]). */
  tri(a, b, c, hint) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
    const L = Math.hypot(nx, ny, nz);
    if (!(L > 1e-12)) return;   // a sliver with no area adds nothing
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; }
    this.tris.push({ n: [nx / L, ny / L, nz / L], v: [a, b, c] });
  }

  /** A quad a-b-c-d (in order round its edge) as two triangles. */
  quad(a, b, c, d, hint) { this.tri(a, b, c, hint); this.tri(a, c, d, hint); }

  /**
   * A flat face at height z: polygon `outer` less the polygons `holes`
   * (points {x, y}), facing up (up = true) or down.
   */
  face(outer, holes, z, up) {
    const all = [...outer, ...holes.flat()];
    const starts = []; let k = outer.length;
    for (const hl of holes) { starts.push(k); k += hl.length; }
    const idx = earcut(all.flatMap((p) => [p.x, p.y]), starts.length ? starts : null, 2);
    const hint = [0, 0, up ? 1 : -1];
    for (let i = 0; i < idx.length; i += 3) {
      const [a, b, c] = [all[idx[i]], all[idx[i + 1]], all[idx[i + 2]]];
      this.tri([a.x, a.y, z], [b.x, b.y, z], [c.x, c.y, z], hint);
    }
  }

  /**
   * The upright wall along closed polygon `loop` from z0 to z1. outward = true
   * faces away from the polygon's inside (an outer edge), false into it (a hole).
   */
  wall(loop, z0, z1, outward) {
    const ccw = signedArea(loop) > 0;
    const s = (ccw === outward) ? 1 : -1;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      const hint = [s * (b.y - a.y), -s * (b.x - a.x), 0];
      this.quad([a.x, a.y, z0], [b.x, b.y, z0], [b.x, b.y, z1], [a.x, a.y, z1], hint);
    }
  }

  /** Volume enclosed (mm³); positive when the triangles face outward. */
  volume() {
    let v = 0;
    for (const { v: [a, b, c] } of this.tris) {
      v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    return v;
  }

  /** Bounding box { min: [x, y, z], max: [x, y, z] }. */
  bounds() {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const t of this.tris) for (const p of t.v) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
    return { min, max };
  }

  /** Move every point by (dx, dy, dz). */
  translate(dx, dy, dz) {
    for (const t of this.tris) t.v = t.v.map((p) => [p[0] + dx, p[1] + dy, p[2] + dz]);
    return this;
  }

  /** Binary STL (little-endian, millimetres). */
  stl(name = 'part') {
    const tris = this.tris;
    const buf = new ArrayBuffer(84 + 50 * tris.length);
    const dv = new DataView(buf);
    // a binary STL header must not start with "solid" (readers take it for ASCII STL)
    const header = `Part: ${name}, mm`.replace(/[^\x20-\x7e]/g, '?').slice(0, 80);
    for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
    dv.setUint32(80, tris.length, true);
    let o = 84;
    for (const t of tris) {
      for (const x of t.n) { dv.setFloat32(o, x, true); o += 4; }
      for (const p of t.v) for (const x of p) { dv.setFloat32(o, x, true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return new Uint8Array(buf);
  }
}

/** Twice the signed area of a polygon (positive when counter-clockwise). */
export function signedArea(loop) {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s;
}

/**
 * Check that a mesh is one closed surface: every edge is used by exactly two
 * triangles, once in each direction. Returns { closed, open, wrong } (counts of
 * edges used once, and edges used twice in the same direction).
 */
export function checkClosed(mesh, digits = 6) {
  const key = (p) => p.map((x) => x.toFixed(digits)).join(',');
  const edges = new Map();
  for (const { v } of mesh.tris) {
    for (let i = 0; i < 3; i++) {
      const a = key(v[i]), b = key(v[(i + 1) % 3]);
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      const e = edges.get(k) || { fwd: 0, back: 0 };
      if (a < b) e.fwd++; else e.back++;
      edges.set(k, e);
    }
  }
  let open = 0, wrong = 0;
  for (const e of edges.values()) {
    if (e.fwd === 1 && e.back === 1) continue;
    if (e.fwd + e.back === 1) open++; else wrong++;
  }
  return { closed: open === 0 && wrong === 0, open, wrong, edges: edges.size };
}
