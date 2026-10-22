// =============================================================================
// export/cam.js — the cam for CAD, CAM software and 3-D printing
// -----------------------------------------------------------------------------
//   profile(doc, n)     n points on the cam surface (and pitch curve), mm
//   dxf(doc)            DXF R2000, millimetres: the cam as ONE closed spline
//                       (layer CAM), the pitch curve (PITCH, roller only), the
//                       bore with its keyway or flat (BORE), bolt holes
//                       (HOLES), the hub outline (HUB), the set-screw hole
//                       seen from above (SETSCREW) and a centre mark (CENTER)
//   points(doc, fmt)    the profile as "x y z" lines (SolidWorks: Curve
//                       Through XYZ Points) or CSV, in the drawing's length unit
//   stl(doc)            binary STL (mm) of the part as printed, with its
//                       mounting (model/mounting.js), ready for a slicer
//   step(doc)           export/step.js: a solid for CAD
// The profile is the cam at θ = 0 (as drawn in the Cam view at the start).
// =============================================================================

import earcut from '../../../../node_modules/earcut/src/earcut.js';
import { Dxf2000 } from './dxf2000.js';
import { prepare, evaluate } from '../model/program.js';
import { camPoint } from '../model/geometry.js';
import { unitsOf } from '../model/units.js';
import { SAMPLING } from '../config.js';
import { mounting, loopPoints } from '../model/mounting.js';

/** n points round the cam (not repeating the first): { surface, pitch }. */
export function profile(doc, n = SAMPLING.exportPointsPerTurn) {
  const prep = prepare(doc.program);
  const surface = [], pitch = [];
  for (let i = 0; i < n; i++) {
    const deg = (i * 360) / n;
    const g = camPoint(doc.follower, evaluate(prep, deg), (deg * Math.PI) / 180);
    surface.push(g.surface);
    if (g.pitch) pitch.push(g.pitch);
  }
  return { surface, pitch };
}

export function dxf(doc) {
  const { surface, pitch } = profile(doc);
  const m = mountOf(doc);
  const d = new Dxf2000({ units: 'mm' });
  d.layer('CAM', 1);
  if (pitch.length) d.layer('PITCH', 6);
  d.layer('BORE', 3); d.layer('CENTER', 8);
  d.closedSpline('CAM', surface);
  if (pitch.length) d.closedSpline('PITCH', pitch);
  for (const seg of m.loop) {
    if (seg.type === 'circle') d.circle('BORE', seg.c, seg.r);
    else if (seg.type === 'line') d.line('BORE', seg.a, seg.b);
    else d.arc('BORE', seg.c, seg.r, Math.min(seg.a0, seg.a1), Math.max(seg.a0, seg.a1)); // counter-clockwise from the smaller angle
  }
  if (m.bolts) { d.layer('HOLES', 5); for (const b of m.bolts.at) d.circle('HOLES', b, m.bolts.d / 2); }
  if (m.hub) { d.layer('HUB', 4); d.circle('HUB', { x: 0, y: 0 }, m.hub.r); }
  if (m.screw && !m.blocked) {
    // the set-screw hole seen from above: its axis and its two sides, bore to hub edge
    // (left out when the mounting does not fit: its sizes are not defined then)
    d.layer('SETSCREW', 2);
    const y0 = m.R, y1 = m.hub.r, w = m.screw.d / 2;
    d.line('SETSCREW', { x: 0, y: y0 }, { x: 0, y: y1 });
    d.line('SETSCREW', { x: -w, y: Math.sqrt(y0 * y0 - w * w) }, { x: -w, y: Math.sqrt(y1 * y1 - w * w) });
    d.line('SETSCREW', { x: w, y: Math.sqrt(y0 * y0 - w * w) }, { x: w, y: Math.sqrt(y1 * y1 - w * w) });
  }
  const c = Math.max((m.R || 0) * 0.6, 2);
  d.line('CENTER', { x: -c, y: 0 }, { x: c, y: 0 });
  d.line('CENTER', { x: 0, y: -c }, { x: 0, y: c });
  return d.toString();
}

/** The mounting of this design (model/mounting.js), against the cam's smallest radius. */
export function mountOf(doc) {
  const rMin = Math.min(...profile(doc).surface.map((p) => Math.hypot(p.x, p.y)));
  return mounting(doc.part, rMin);
}

/** Point list in the drawing's unit: 'txt' (x y z, tab separated) or 'csv'. */
export function points(doc, format = 'txt') {
  const U = unitsOf(doc);
  const { surface } = profile(doc);
  const f = (v) => (+U.L.show(v).toFixed(6)).toString();
  if (format === 'csv') return `x (${U.L.label}),y (${U.L.label}),z (${U.L.label})\n${surface.map((p) => `${f(p.x)},${f(p.y)},0`).join('\n')}\n`;
  return `${surface.map((p) => `${f(p.x)}\t${f(p.y)}\t0`).join('\r\n')}\r\n`;
}

const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
};

/**
 * Triangles of the cam as printed: [{ n: [x,y,z], v: [[x,y,z] ×3] }], closed
 * (watertight) with outward normals. The profile extruded to the thickness,
 * with the bore (keyway, flat) and bolt holes through it; for a hub, the hub
 * on top (z = thickness … + hub height) and the radial set-screw hole through
 * the hub wall on +y.
 */
export function camSolid(doc, n = SAMPLING.exportPointsPerTurn) {
  let outer = profile(doc, n).surface;
  if (area(outer) < 0) outer = outer.slice().reverse();            // counter-clockwise
  const rMin = Math.min(...outer.map((p) => Math.hypot(p.x, p.y)));
  const m = mounting(doc.part, rMin);
  const t = Math.max(1e-3, doc.part.thickness || 10);
  const roundN = Math.max(48, 2 * Math.round(n / 12));             // points round a full circle (even)
  const bore = m.loop.length ? loopPoints(m.loop, roundN) : null;
  const bolts = m.bolts ? m.bolts.at.map((c) => circlePoints(c, m.bolts.d / 2, Math.max(24, roundN / 2))) : [];
  const hub = m.hub && bore ? { pts: circlePoints({ x: 0, y: 0 }, m.hub.r, roundN), z: t + m.hub.h } : null;
  const top = hub ? hub.z : t;
  const mesh = new Mesh();
  const UP = [0, 0, 1], DOWN = [0, 0, -1];
  // flat faces
  mesh.region(outer, [bore, ...bolts].filter(Boolean), 0, DOWN);
  mesh.region(outer, [hub ? hub.pts : bore, ...bolts].filter(Boolean), t, UP);
  if (hub) mesh.region(hub.pts, [bore], top, UP);
  // walls: outward = away from the material
  const away = (p) => [p[0], p[1], 0], towards = (p) => [-p[0], -p[1], 0];
  mesh.wall(outer, 0, t, away);
  for (const b of bolts) mesh.wall(b, 0, t, (p) => [b.c.x - p[0], b.c.y - p[1], 0]);
  if (m.screw && hub) {
    // radial hole on +y through the hub wall, from the bore to the outside
    const hole = circlePoints({ x: 0, y: m.screw.z }, m.screw.d / 2, 24).map((q) => ({ x: q.x, z: q.y }));
    mesh.cylinderWall(m.R, bore, 0, top, hole, towards);
    mesh.cylinderWall(m.hub.r, hub.pts, t, top, hole, away);
    const at = (r, q) => [q.x, Math.sqrt(r * r - q.x * q.x), q.z];
    for (let j = 0; j < hole.length; j++) {
      const a = hole[j], b = hole[(j + 1) % hole.length];
      const toAxis = (p) => [-p[0], 0, m.screw.z - p[2]];
      mesh.tri(at(m.R, a), at(m.R, b), at(m.hub.r, b), toAxis);
      mesh.tri(at(m.R, a), at(m.hub.r, b), at(m.hub.r, a), toAxis);
    }
  } else {
    if (bore) mesh.wall(bore, 0, top, towards);
    if (hub) mesh.wall(hub.pts, t, top, away);
  }
  return mesh.tris;
}

/** n points round a circle, starting on +y (where the keyway and set screw are). */
function circlePoints(c, r, n) {
  const pts = Array.from({ length: n }, (_, i) => { const a = Math.PI / 2 + (2 * Math.PI * i) / n; return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }; });
  pts.c = c;
  return pts;
}

/** Triangles with outward normals: each is turned to face the hint direction given for its surface. */
class Mesh {
  constructor() { this.tris = []; }

  tri(a, b, c, hint) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
    const L = Math.hypot(nx, ny, nz);
    if (!(L > 0)) return; // a sliver with no area adds nothing
    const mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const hv = typeof hint === 'function' ? hint(mid) : hint;
    if (nx * hv[0] + ny * hv[1] + nz * hv[2] < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; }
    this.tris.push({ n: [nx / L, ny / L, nz / L], v: [a, b, c] });
  }

  /** A triangle as wound (a, b, c counter-clockwise seen from outside). */
  raw(a, b, c) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
    const L = Math.hypot(nx, ny, nz) || 1;
    this.tris.push({ n: [nx / L, ny / L, nz / L], v: [a, b, c] });
  }

  /** A flat face at height z: the outer polygon less the holes. */
  region(outer, holes, z, hint) {
    const all = [...outer, ...holes.flat()];
    const starts = []; let k = outer.length;
    for (const hl of holes) { starts.push(k); k += hl.length; }
    const tri = earcut(all.flatMap((p) => [p.x, p.y]), starts.length ? starts : null, 2);
    for (let i = 0; i < tri.length; i += 3) {
      const [a, b, c] = [all[tri[i]], all[tri[i + 1]], all[tri[i + 2]]];
      this.tri([a.x, a.y, z], [b.x, b.y, z], [c.x, c.y, z], hint);
    }
  }

  /** The upright wall along a closed polygon from z0 to z1. */
  wall(loop, z0, z1, hint) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      this.tri([a.x, a.y, z0], [b.x, b.y, z0], [b.x, b.y, z1], hint);
      this.tri([a.x, a.y, z0], [b.x, b.y, z1], [a.x, a.y, z1], hint);
    }
  }

  /**
   * The wall of a round polygon (radius r, its points `loop`) from z0 to z1
   * with a radial hole through it on +y; the hole outline `hole` is given as
   * { x, z }. Away from the hole the wall is the usual quads. The band of the
   * wall round the hole is unrolled (u = r × angle from +y), triangulated
   * round the hole and rolled back up, keeping the polygon's points on its
   * edges. Unrolled, those points lie on straight lines and the triangulation
   * would drop them, so the band's bottom edge is arched up and its top edge
   * down by a hair (inside the margin to the hole) for the triangulation only.
   */
  cylinderWall(r, loop, z0, z1, hole, hint) {
    const ang = (p) => { let a = Math.atan2(p.y, p.x) - Math.PI / 2; if (a <= -Math.PI + 1e-9) a += 2 * Math.PI; if (a > Math.PI + 1e-9) a -= 2 * Math.PI; return a; };
    const H = hole.map((q) => ({ u: -r * Math.asin(q.x / r), z: q.z, xyz: [q.x, Math.sqrt(r * r - q.x * q.x), q.z] }));
    const hu0 = Math.min(...H.map((q) => q.u)), hu1 = Math.max(...H.map((q) => q.u));
    const margin = Math.min(Math.min(...H.map((q) => q.z)) - z0, z1 - Math.max(...H.map((q) => q.z)));
    // the band: loop points from a little before the hole to a little after it
    const us = loop.map((p) => r * ang(p)), gap = 0.3 * (hu1 - hu0) / 2;
    const uL = Math.max(...us.filter((u) => u < hu0 - gap)), uR = Math.min(...us.filter((u) => u > hu1 + gap));
    const inBand = (u) => u >= uL - 1e-9 && u <= uR + 1e-9;
    const P = (p, z) => [p.x, p.y, z];
    for (let i = 0; i < loop.length; i++) {
      const j = (i + 1) % loop.length;
      if (inBand(us[i]) && inBand(us[j])) continue;
      const a = loop[i], b = loop[j];
      this.tri(P(a, z0), P(b, z0), P(b, z1), hint);
      this.tri(P(a, z0), P(b, z1), P(a, z1), hint);
    }
    const band = loop.map((p, i) => ({ u: us[i], p })).filter((q) => inBand(q.u)).sort((a, b) => a.u - b.u);
    const half = (uR - uL) / 2, mid = (uR + uL) / 2;
    const arch = (u) => 0.2 * margin * (1 - ((u - mid) / half) ** 2);  // 0 at the band's ends
    const ring = [                                                     // counter-clockwise in (u, z)
      ...band.map((q) => ({ u: q.u, z: z0 + arch(q.u), xyz: P(q.p, z0) })),
      ...band.slice().reverse().map((q) => ({ u: q.u, z: z1 - arch(q.u), xyz: P(q.p, z1) })),
    ];
    const all = [...ring, ...H];
    const tri = earcut(all.flatMap((q) => [q.u, q.z]), [ring.length], 2);
    if (tri.length / 3 !== all.length) throw new Error('set-screw wall: the triangulation lost points');
    // wind in the (u, z) plane: counter-clockwise there faces away from the axis
    const outward = hint([0, r, 0])[1] > 0;
    for (let i = 0; i < tri.length; i += 3) {
      const [A, B, C] = [all[tri[i]], all[tri[i + 1]], all[tri[i + 2]]];
      const ccw = (B.u - A.u) * (C.z - A.z) - (B.z - A.z) * (C.u - A.u) > 0;
      if (ccw === outward) this.raw(A.xyz, B.xyz, C.xyz); else this.raw(A.xyz, C.xyz, B.xyz);
    }
  }
}

/** Binary STL (little-endian), millimetres. */
export function stl(doc, name = 'CamLab cam') {
  const tris = camSolid(doc);
  const buf = new ArrayBuffer(84 + 50 * tris.length);
  const dv = new DataView(buf);
  // a binary STL header must not start with "solid" (readers take it for ASCII STL)
  const header = `CamLab: ${name}, mm`.replace(/[^\x20-\x7e]/g, '?').slice(0, 80);
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) {
    for (const x of t.n) { dv.setFloat32(o, x, true); o += 4; }
    for (const v of t.v) for (const x of v) { dv.setFloat32(o, x, true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}
