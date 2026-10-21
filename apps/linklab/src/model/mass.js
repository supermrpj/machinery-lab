// =============================================================================
// mass.js — mass, centre of mass and moment of inertia of each link
// -----------------------------------------------------------------------------
// By default a link's mass properties come from its shape, made of one
// material at one thickness (doc.dynamics):
//   • a link with outlines (Outline tool) attached → the outlines' area
//   • a wheel → a disc of its radius
//   • a bar or plate → the shape a laser cutter would make: the convex hull
//     of circles of the link width around its joints (a stadium for a bar)
// A student can instead type the values (link.mass = { m, cg, I, local }),
// e.g. to match a textbook problem. The centre of mass is then given in the
// link's own frame, as in the textbook (LRCS):
//   local = { from, to, x, y }   origin at joint `from`, x′ along the line to
//                                joint `to` (the line of centres), y′ 90°
//                                counter-clockwise from it; x, y in mm
// so it stays put on the link when the link moves or its lengths change.
// (r ∠ θ in the interface is the same point in polar form.)
//
// Units: m in kg; cg in mm (design-pose world coordinates, like joints);
// I about the centre of mass in kg·m².
// =============================================================================

import { convexHull } from '../../../../packages/core-math/src/index.js';

// Densities in kg/m³. 3-D printing values are for solid plastic (100 % infill).
export const MATERIALS = {
  steel: { name: 'Steel', rho: 7850, group: 'Metals' },
  aluminium: { name: 'Aluminium', rho: 2700, group: 'Metals' },
  brass: { name: 'Brass', rho: 8500, group: 'Metals' },
  acrylic: { name: 'Acrylic (laser cut)', rho: 1190, group: 'Sheet' },
  plywood: { name: 'Plywood', rho: 600, group: 'Sheet' },
  pla: { name: 'PLA', rho: 1240, group: '3-D printing (solid)' },
  abs: { name: 'ABS', rho: 1040, group: '3-D printing (solid)' },
  petg: { name: 'PETG', rho: 1270, group: '3-D printing (solid)' },
  asa: { name: 'ASA', rho: 1070, group: '3-D printing (solid)' },
  pc: { name: 'Polycarbonate (PC)', rho: 1200, group: '3-D printing (solid)' },
  nylon: { name: 'Nylon (PA12)', rho: 1010, group: '3-D printing (solid)' },
};

/** Density of the links' material in kg/m³ ('custom' uses the typed value). */
export function densityOf(dyn) {
  if (dyn.material === 'custom') return dyn.rho > 0 ? dyn.rho : DYNAMICS_DEFAULTS.rho;
  return (MATERIALS[dyn.material] || MATERIALS.steel).rho;
}

/** The material's name for notes, e.g. "steel" or "material of 1100 kg/m³". */
export function materialName(dyn) {
  if (dyn.material === 'custom') return `material of ${densityOf(dyn)} kg/m³`;
  return (MATERIALS[dyn.material] || MATERIALS.steel).name.replace(/^(?![A-Z]{2})\w/, (c) => c.toLowerCase());
}

/** Defaults for the dynamics settings of a document. */
export const DYNAMICS_DEFAULTS = {
  mode: 'off',        // 'off' | 'static' | 'dynamic'
  gravity: true,
  g: 9.81,            // m/s², acting in −y
  material: 'steel',  // a key of MATERIALS, or 'custom'
  rho: 1000,          // kg/m³, used when material is 'custom'
  thickness: 6,       // mm
  width: null,        // mm; null = the CAD link width (12 mm)
};

export const dynamicsOf = (doc) => ({ ...DYNAMICS_DEFAULTS, ...((doc && doc.dynamics) || {}) });

/** Area, centroid and polar second moment (about the centroid) of a polygon (mm). */
export function polygonProps(pts) {
  let A = 0, cx = 0, cy = 0, Ixx = 0, Iyy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const cr = p.x * q.y - q.x * p.y;
    A += cr;
    cx += (p.x + q.x) * cr; cy += (p.y + q.y) * cr;
    Ixx += (p.y * p.y + p.y * q.y + q.y * q.y) * cr;
    Iyy += (p.x * p.x + p.x * q.x + q.x * q.x) * cr;
  }
  A /= 2;
  if (Math.abs(A) < 1e-12) return { A: 0, c: pts[0] || { x: 0, y: 0 }, J: 0 };
  cx /= 6 * A; cy /= 6 * A;
  Ixx /= 12; Iyy /= 12;
  // about the origin (signed with the winding), then moved to the centroid
  const s = Math.sign(A);
  const J = s * (Ixx + Iyy) - Math.abs(A) * (cx * cx + cy * cy);
  return { A: Math.abs(A), c: { x: cx, y: cy }, J };
}

/** The outline a laser cutter would make for a bar or plate: hull of circles round the joints. */
export function linkShape(points, width) {
  const r = width / 2, pts = [];
  for (const p of points) for (let k = 0; k < 32; k++) {
    const a = (2 * Math.PI * k) / 32;
    pts.push({ x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a) });
  }
  return convexHull(pts);
}

// ---- the link's own frame (for the centre of mass) -----------------------------

/**
 * The frame a link's centre of mass is measured in: origin joint and the
 * joint the x′ axis points to. Default as in the textbook and the parameter
 * export: the motor pivot of the input link, else a ground pivot, else the
 * first joint; x′ towards the next joint. A wheel has no second joint: x′ is
 * along x as drawn.
 */
export function defaultFrame(doc, link) {
  const ground = (id) => { const j = doc.joints.find((x) => x.id === id); return j && j.ground; };
  const d = doc.driver || {};
  const from = (d.type === 'rotary' && d.link === link.id && link.joints.includes(d.pivot) && d.pivot)
    || link.joints.find(ground) || link.joints[0] || null;
  const to = link.joints.find((id) => id !== from) || null;
  return { from, to };
}

/**
 * Origin and unit x′ axis of the frame { from, to }, from joint positions
 * given by pos(id) (design pose: the document; or where they are now).
 */
export function linkFrame(pos, from, to) {
  const o = pos(from);
  if (!o) return null;
  const t = to ? pos(to) : null;
  const L = t ? Math.hypot(t.x - o.x, t.y - o.y) : 0;
  return { o, ex: L > 1e-9 ? { x: (t.x - o.x) / L, y: (t.y - o.y) / L } : { x: 1, y: 0 } };
}

/** World point (mm) → { x, y } in the frame (x′ along, y′ across). */
export function toLocal(F, p) {
  const dx = p.x - F.o.x, dy = p.y - F.o.y;
  return { x: dx * F.ex.x + dy * F.ex.y, y: -dx * F.ex.y + dy * F.ex.x };
}

/** { x, y } in the frame → world point (mm). */
export function toWorld(F, q) {
  return { x: F.o.x + q.x * F.ex.x - q.y * F.ex.y, y: F.o.y + q.x * F.ex.y + q.y * F.ex.x };
}

/** Design-pose position of a joint in the document. */
const docPos = (doc) => (id) => { const j = doc.joints.find((x) => x.id === id); return j ? { x: j.x, y: j.y } : null; };

/** A typed centre of mass in world mm (design pose), from its local definition if it has one. */
function typedCg(doc, link, o) {
  const L = o.local;
  if (L && link.joints.includes(L.from) && (!L.to || link.joints.includes(L.to)) && Number.isFinite(L.x) && Number.isFinite(L.y)) {
    const F = linkFrame(docPos(doc), L.from, L.to);
    if (F) return toWorld(F, L);
  }
  return o.cg && Number.isFinite(o.cg.x) && Number.isFinite(o.cg.y) ? { ...o.cg } : null;
}

// ---- counterweights (balancing) ------------------------------------------------------
//   link.counterweights = [{ id, from, to, x, y, m }]
// point masses fixed to the link, placed like a typed centre of mass: x, y in
// mm in the frame from joint `from` towards joint `to`; m in kg. They count
// while doc.balance.counterweights is not false (so before/after can be compared).

/** Are counterweights in use in this document? */
export const counterweightsOn = (doc) => !(doc && doc.balance && doc.balance.counterweights === false);

/** The counterweights of a link where they are in the design pose: [{ m, p, cw }]. */
export function counterweightsOf(doc, link) {
  const out = [];
  for (const cw of link.counterweights || []) {
    if (!(cw.m > 0) || !link.joints.includes(cw.from)) continue;
    const F = linkFrame(docPos(doc), cw.from, cw.to && link.joints.includes(cw.to) ? cw.to : null);
    if (F) out.push({ m: cw.m, p: toWorld(F, cw), cw });
  }
  return out;
}

/**
 * Mass properties of a link with its counterweights (when they are in use):
 * the link's own properties (ownMassProps) plus point masses, combined about
 * the new centre of mass. opts.own = true leaves the counterweights out.
 * Returns { m, cg, I, auto, area, from, own, cwMass }.
 */
export function massProps(doc, link, opts = {}) {
  const own = ownMassProps(doc, link);
  const cws = opts.own || !counterweightsOn(doc) ? [] : counterweightsOf(doc, link);
  if (!cws.length) return { ...own, own, cwMass: 0 };
  const m = own.m + cws.reduce((a, c) => a + c.m, 0);
  const cg = {
    x: (own.m * own.cg.x + cws.reduce((a, c) => a + c.m * c.p.x, 0)) / m,
    y: (own.m * own.cg.y + cws.reduce((a, c) => a + c.m * c.p.y, 0)) / m,
  };
  const d2 = (p) => ((p.x - cg.x) ** 2 + (p.y - cg.y) ** 2) * 1e-6; // mm² → m²
  const I = own.I + own.m * d2(own.cg) + cws.reduce((a, c) => a + c.m * d2(c.p), 0);
  return { ...own, m, cg, I, own, cwMass: m - own.m };
}

/**
 * Mass properties of a link's own body (no counterweights). Returns { m, cg: {x, y}, I, auto, area } with
 * cg in design-pose world mm, m in kg, I in kg·m² about the centre of mass.
 */
export function ownMassProps(doc, link) {
  const dyn = dynamicsOf(doc);
  const rho = densityOf(dyn);
  const t = dyn.thickness;
  const width = dyn.width || (doc.cad && doc.cad.linkWidth) || 12;
  let props;
  const outlines = (doc.bodies || []).filter((b) => b.attach === link.id && b.pts && b.pts.length >= 3);
  const joints = link.joints.map((id) => doc.joints.find((j) => j.id === id)).filter(Boolean);
  if (outlines.length) {
    // several outlines: add them up (they are taken not to overlap)
    let A = 0, Sx = 0, Sy = 0, Jo = 0;
    const parts = outlines.map((b) => polygonProps(b.pts));
    for (const p of parts) { A += p.A; Sx += p.A * p.c.x; Sy += p.A * p.c.y; }
    const c = A ? { x: Sx / A, y: Sy / A } : { x: 0, y: 0 };
    for (const p of parts) Jo += p.J + p.A * ((p.c.x - c.x) ** 2 + (p.c.y - c.y) ** 2);
    props = { A, c, J: Jo, from: 'outline' };
  } else if (link.disc && joints[0]) {
    const r = link.disc, A = Math.PI * r * r;
    props = { A, c: { x: joints[0].x, y: joints[0].y }, J: (A * r * r) / 2, from: 'wheel' };
  } else if (joints.length) {
    const p = polygonProps(linkShape(joints, width));
    props = { ...p, from: joints.length > 2 ? 'plate' : 'bar' };
  } else {
    props = { A: 0, c: { x: 0, y: 0 }, J: 0, from: 'none' };
  }
  // mm² × mm × kg/m³ → kg;  mm⁴ × mm × kg/m³ → kg·m²
  const auto = { m: rho * props.A * t * 1e-9, cg: props.c, I: rho * props.J * t * 1e-15, auto: true, area: props.A, from: props.from };
  const o = link.mass;
  if (!o) return auto;
  return {
    m: Number.isFinite(o.m) ? o.m : auto.m,
    cg: typedCg(doc, link, o) || auto.cg,
    I: Number.isFinite(o.I) ? o.I : auto.I,
    auto: false,
    area: auto.area,
    from: 'typed',
  };
}
