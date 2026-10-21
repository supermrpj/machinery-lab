// =============================================================================
// balance.js — balancing: counterweights for linkages, and rotor balancing
// -----------------------------------------------------------------------------
// Linkages (shaking force = 0 when the total centre of mass stays still):
//   fourbarForceBalance(doc, kind)   exact force balance of a fourbar with
//                                    counterweights on the crank and rocker
//   selfBalance(doc, link, pivot)    put a ground-pivoted link's own centre of
//                                    mass on its pivot (a balanced crank)
//   totalCentreOfMass(sim, sample)   where the whole mechanism's mass centre is
// Rotors (shafts, fans, …), with masses m at radius R and angle θ:
//   rotorStatic(masses)              one correction mass (single plane)
//   rotorDynamic(masses, lB)         two correction planes A (z = 0) and B (z = lB)
//   rotorFromBearings(input)         two planes from measured bearing forces
//
// Mass-radius products mR are in kg·mm here (mass in kg, lengths in mm);
// angles in degrees, counter-clockwise. A vector { x, y } in a link's own
// frame has x along the line from `from` to `to` (as for typed centres of mass).
// =============================================================================

import { ownMassProps, massProps, linkFrame, toLocal } from './mass.js';
import { jointById, linkById } from './document.js';

const DEG = 180 / Math.PI;
const docPos = (doc) => (id) => { const j = jointById(doc, id); return j ? { x: j.x, y: j.y } : null; };
const polar = (v) => ({ ...v, mag: Math.hypot(v.x, v.y), angle: Math.atan2(v.y, v.x) * DEG });

/** A link's centre of mass times its mass, as a vector in the frame from → to (kg·mm). */
function mb(doc, link, from, to, own = true) {
  const mp = own ? ownMassProps(doc, link) : massProps(doc, link);
  const F = linkFrame(docPos(doc), from, to);
  const g = toLocal(F, mp.cg);
  return { x: mp.m * g.x, y: mp.m * g.y, m: mp.m };
}

/**
 * Exact force balance of a fourbar (Berkof–Lowen, as in the Week 10 slides):
 * the total centre of mass stays still when
 *   m2 b2 e^{jφ2} = m3 ( b3 (l2/l3) e^{jφ3} − l2 )
 *   m4 b4 e^{jφ4} = − m3 b3 (l4/l3) e^{jφ3}
 * with each link's centre of mass b e^{jφ} measured in its own frame: crank
 * from O2 towards A, coupler from A towards B, rocker from O4 towards B.
 * Returns for the crank and the rocker: the total m·b needed, the link's own
 * m·b, and the counterweight m·R to add (all in their own frames), plus the
 * frames used. The coupler is left as it is.
 */
export function fourbarForceBalance(doc, kind) {
  const L2 = linkById(doc, kind.links.input), L3 = linkById(doc, kind.links.coupler), L4 = linkById(doc, kind.links.output);
  const O2 = kind.O2.id, A = kind.A.id, B = kind.B.id, O4 = kind.O4.id;
  const l2 = kind.a, l3 = kind.b, l4 = kind.c;
  const c3 = mb(doc, L3, A, B, false); // the coupler with anything already on it
  const total2 = { x: c3.x * (l2 / l3) - c3.m * l2, y: c3.y * (l2 / l3) };
  const total4 = { x: -c3.x * (l4 / l3), y: -c3.y * (l4 / l3) };
  const own2 = mb(doc, L2, O2, A), own4 = mb(doc, L4, O4, B);
  const add = (t, o) => polar({ x: t.x - o.x, y: t.y - o.y });
  return {
    crank: { link: L2.id, from: O2, to: A, length: l2, total: polar(total2), own: polar(own2), add: add(total2, own2) },
    rocker: { link: L4.id, from: O4, to: B, length: l4, total: polar(total4), own: polar(own4), add: add(total4, own4) },
  };
}

/**
 * Counterweight m·R that moves a link's own centre of mass onto its pivot
 * (frame from the pivot towards the link's next joint).
 */
export function selfBalance(doc, link, pivotId) {
  const to = link.joints.find((id) => id !== pivotId) || null;
  const own = mb(doc, link, pivotId, to);
  return { link: link.id, from: pivotId, to, own: polar(own), add: polar({ x: -own.x, y: -own.y }) };
}

/**
 * A counterweight that supplies m·R (vector, kg·mm, in the frame from → to)
 * at radius r (mm): { from, to, x, y, m }.
 */
export function counterweightFor(addition, from, to, r) {
  const mag = Math.hypot(addition.x, addition.y);
  if (!(mag > 0) || !(r > 0)) return null;
  return { from, to, x: (addition.x / mag) * r, y: (addition.y / mag) * r, m: mag / r };
}

/**
 * Total centre of mass of the moving links at a sweep sample (or the current
 * pose), in world mm, and the total moving mass. Uses the solver's bodies and
 * the masses it uses (counterweights included when on).
 */
export function totalCentreOfMass(sim, masses, q) {
  const sys = sim.sys;
  let M = 0, X = 0, Y = 0;
  sys.bodies.forEach((b, i) => {
    const mp = masses[i];
    if (!mp || !(mp.m > 0)) return;
    const x = q[3 * i], y = q[3 * i + 1], p = q[3 * i + 2], c = Math.cos(p), s = Math.sin(p);
    M += mp.m;
    X += mp.m * (x + c * mp.c.x - s * mp.c.y);
    Y += mp.m * (y + s * mp.c.x + c * mp.c.y);
  });
  return M > 0 ? { x: X / M, y: Y / M, m: M } : null;
}

// ---- rotors -----------------------------------------------------------------------

const vec = (mR, deg) => ({ x: mR * Math.cos(deg / DEG), y: mR * Math.sin(deg / DEG) });

/**
 * The unbalance of masses on a shaft before any correction:
 *   force   Σ m R          (it turns with the shaft; × ω² gives the shaking force)
 *   moment  Σ m R l        about plane A (× ω² gives the shaking moment); only
 *                          when every mass has its distance l
 * masses: [{ m, R, angle, l? }] in any consistent units.
 * Returns { force: { x, y, mag, angle }, moment: { … } | null }.
 */
export function rotorUnbalance(masses) {
  let fx = 0, fy = 0, mx = 0, my = 0, all = true;
  for (const k of masses) {
    const v = vec(k.m * k.R, k.angle);
    fx += v.x; fy += v.y;
    if (Number.isFinite(k.l)) { mx += v.x * k.l; my += v.y * k.l; } else all = false;
  }
  return { force: polar({ x: fx, y: fy }), moment: all ? polar({ x: mx, y: my }) : null };
}

/**
 * Single-plane (static) balance: the m·R that cancels Σ m R.
 * masses: [{ m, R, angle }] (any consistent units). Returns { x, y, mag, angle }.
 */
export function rotorStatic(masses) {
  let x = 0, y = 0;
  for (const k of masses) { const v = vec(k.m * k.R, k.angle); x -= v.x; y -= v.y; }
  return polar({ x, y });
}

/**
 * Two-plane (dynamic) balance with correction planes A at z = 0 and B at
 * z = lB: Σ forces = 0 and Σ moments about A = 0.
 * masses: [{ m, R, angle, l }] with l the distance from plane A.
 * Returns { A: { x, y, mag, angle }, B: { … } } (m·R in each plane).
 */
export function rotorDynamic(masses, lB) {
  let bx = 0, by = 0, fx = 0, fy = 0;
  for (const k of masses) {
    const v = vec(k.m * k.R, k.angle);
    bx -= v.x * k.l; by -= v.y * k.l;
    fx -= v.x; fy -= v.y;
  }
  const B = { x: bx / lB, y: by / lB };
  const A = { x: fx - B.x, y: fy - B.y };
  return { A: polar(A), B: polar(B) };
}

/**
 * Two-plane balance from bearing forces measured on a balancing machine (as
 * in the fan example): forces F1, F2 (N) at phase angles θ1, θ2 (degrees) and
 * distances l1, l2 from plane A; planes A and B lB apart; speed ω (rad/s);
 * correction radii RA, RB. Distances in any one unit u: m·R comes out in
 * kg·u, weights in N (g in m/s²).
 *   m·R_B = (F1 l1 + F2 l2) / (lB ω²)      m·R_A = (F1 + F2)/ω² − m·R_B
 * (component by component), as on the slide.
 */
export function rotorFromBearings({ F1, th1, l1, F2, th2, l2, lB, omega, RA, RB, g = 9.81, unitPerMetre = 1000 }) {
  const f1 = vec(F1, th1), f2 = vec(F2, th2), w2 = omega * omega;
  // N / (rad/s)² = kg·m: convert to kg·(distance unit) with unitPerMetre
  const k = unitPerMetre;
  const B = { x: ((f1.x * l1 + f2.x * l2) / (lB * w2)) * k, y: ((f1.y * l1 + f2.y * l2) / (lB * w2)) * k };
  const A = { x: ((f1.x + f2.x) / w2) * k - B.x, y: ((f1.y + f2.y) / w2) * k - B.y };
  const out = { A: polar(A), B: polar(B) };
  if (RA > 0) out.A.weight = (out.A.mag / RA) * g;
  if (RB > 0) out.B.weight = (out.B.mag / RB) * g;
  return out;
}
