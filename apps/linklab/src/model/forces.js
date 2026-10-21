// =============================================================================
// forces.js — static and dynamic force analysis of the drawing
// -----------------------------------------------------------------------------
// Prepares each link's mass properties and the external loads for the
// inverse-dynamics solver (kinematics/dynamics.js), runs it at a pose or over
// the whole cycle, and labels the results with joint names and link numbers.
//
//   analyseForces(sim, pose?)   → results at the current pose (or a sweep sample)
//   forceLabels(doc, sim)       → names for pins, sliders, … in the results
//
// Mode (doc.dynamics.mode):
//   'static'   the mechanism held still at this position: gravity and loads
//   'dynamic'  moving at the input speed and acceleration: also inertia
// =============================================================================

import { inverseDynamics } from '../kinematics/dynamics.js';
import { massProps, dynamicsOf } from './mass.js';
import { profileFactor } from './loads.js';
import { linkNumbers } from './document.js';
import { inputRate } from '../kinematics/path.js';

const DEG = 180 / Math.PI;

/** Mass properties per body, in body-local coordinates (cached per document version). */
export function bodyMasses(sim, opts = {}) {
  const sys = sim.sys, doc = sim.doc;
  return sys.bodies.map((b) => {
    const link = doc.links.find((l) => l.id === b.id);
    const mp = massProps(doc, link, opts); // opts.own: without counterweights
    return { m: mp.m, c: { x: mp.cg.x - b.ref.x, y: mp.cg.y - b.ref.y }, I: mp.I, props: mp };
  });
}

/**
 * What load profiles see at a pose:
 *   x, theta   input in degrees (a crank's angle wrapped into 0…360°), or
 *   x, s       input in mm for a linear input
 *   t          time since the start of the cycle, in the direction of motion,
 *              at the input speed (it repeats every cycle)
 * `travel` is how far the input has moved along the cycle at this pose.
 */
function profileVars(sim, theta, travel) {
  const sys = sim.sys, m = sim.doc.motion, sw = sim.sweepCache;
  const angle = !sys.driver || sys.driver.unit === 'rad';
  let x = angle ? theta * DEG : theta;
  if (angle && sw && sw.fullTurn) x = ((x % 360) + 360) % 360;
  const speed = Math.abs(m.omega);
  let t = 0;
  if (speed && sw && Number.isFinite(travel) && sw.travel > 0) {
    // moving backwards along the sweep when the motor runs the other way
    const forward = (m.omega >= 0) !== !!m.reverse;
    t = (forward ? travel : sw.travel - travel) / speed;
  }
  return { x, theta: angle ? x : 0, s: angle ? 0 : x, t };
}

/** Loads at a pose, in body terms for the solver (forces in world axes, N). */
export function bodyLoads(sim, q, theta, travel = NaN, problems = null) {
  const sys = sim.sys, doc = sim.doc, vars = profileVars(sim, theta, travel);
  const out = [];
  const nums = problems ? linkNumbers(doc) : null;
  for (const L of doc.loads || []) {
    const i = sys.bodyIndex.get(L.link);
    if (i === undefined) continue;
    const f = profileFactor(L.profile, vars);
    if (!Number.isFinite(f)) {
      // a formula that gives no number here: say so rather than drop it quietly
      if (problems) problems.push(`The ${L.kind === 'torque' ? 'torque' : 'force'} on link ${nums.get(L.link)}: its formula gives no number here, so it is left out.`);
      continue;
    }
    const b = sys.bodies[i];
    if (L.kind === 'torque') { out.push({ i, T: (L.T || 0) * f, id: L.id }); continue; }
    let F = { x: (L.F?.x || 0) * f, y: (L.F?.y || 0) * f };
    if (L.follow) {
      // turns with the link
      const p = q[3 * i + 2], c = Math.cos(p), s = Math.sin(p);
      F = { x: c * F.x - s * F.y, y: s * F.x + c * F.y };
    }
    out.push({ i, s: { x: L.at.x - b.ref.x, y: L.at.y - b.ref.y }, F, id: L.id });
  }
  return out;
}

/**
 * Force analysis at the current pose of the simulation, or at a given pose
 * { q, qd, qdd, theta } (a sweep sample). Returns null if off, not possible
 * here, or unbounded (exactly at a toggle position).
 */
export function analyseForces(sim, pose = null, modeOverride = null) {
  if (!sim.sys || !sim.drivable) return null;
  const dyn = dynamicsOf(sim.doc);
  const mode = modeOverride || dyn.mode;
  if (mode === 'off') return null;
  const q = pose ? pose.q : sim.q, theta = pose ? pose.theta : sim.theta;
  const qd = pose ? pose.qd : sim.qd, qdd = pose ? pose.qdd : sim.qdd;
  if (mode === 'dynamic' && (!qd || !qdd)) return null; // velocities unknown here
  // at (or extremely near) a toggle position the input cannot drive or hold
  // the mechanism: the forces are unbounded, so none are reported
  if (pose && pose.special === 'toggle') return null;
  const t = pose ? pose.t : sim.tan;
  if (t && sim.sys.driver && Math.abs(inputRate(sim.sys, q, t)) * sim.size < 1e-3) return null;
  if (!sim._masses) sim._masses = bodyMasses(sim);
  // moments about the motor's ground pivot, or about the origin
  const drv = sim.sys.driver;
  const groundMotor = drv && drv.unit === 'rad' && drv.ref < 0 && drv.pivot;
  const pj = groundMotor ? sim.doc.joints.find((j) => j.id === drv.pivot && j.ground) : null;
  const pivot = pj ? { x: pj.x, y: pj.y } : { x: 0, y: 0 };
  const travel = pose ? pose.travel : (() => { const k = sim.nearestSampleIndex(); return k >= 0 ? sim.sweepCache.samples[k].travel : NaN; })();
  const problems = [];
  const r = inverseDynamics(sim.sys, q, qd, qdd, theta, sim._masses, bodyLoads(sim, q, theta, travel, problems), {
    dynamic: mode === 'dynamic', g: dyn.gravity ? dyn.g : 0, pivot,
  });
  if (r) { r.mode = mode; r.momentAbout = pj ? 'the motor pivot' : 'the origin'; r.problems = problems; }
  return r;
}

/** Subscript digits: 12 → "₁₂". */
const SUB = '₀₁₂₃₄₅₆₇₈₉';
export const subscript = (n) => String(n).replace(/\d/g, (d) => SUB[+d]);

/**
 * Force names in the textbook convention: F_ij is the force of link i ON
 * link j (link 1 = ground), so F_ji = −F_ij. With a link number above 9 the
 * two are separated by a comma (F₃,₁₂).
 *   text  "F₂₃"        ascii  "F23" (for CSV column names)
 */
export function forceName(from, on) {
  const sep = from > 9 || on > 9;
  return { text: `F${subscript(from)}${sep ? ',' : ''}${subscript(on)}`, ascii: `F${from}${sep ? '_' : ''}${on}` };
}

/** Readable names for the results: joint names, link numbers and F_ij names. */
export function forceLabels(doc, sim) {
  const nums = linkNumbers(doc);
  const linkOf = (i) => (i < 0 ? 1 : nums.get(sim.sys.bodies[i].id));
  const jname = (id) => `J${doc.joints.findIndex((j) => j.id === id) + 1}`;
  return {
    linkOf,
    // a pin result is the force on body i from body j
    pin: (p) => {
      const on = linkOf(p.i), from = linkOf(p.j);
      return { joint: jname(p.joint), on, from, name: forceName(from, on) };
    },
    slider: (s) => {
      const on = linkOf(s.i), from = linkOf(s.j);
      return { name: `slider ${doc.sliders.findIndex((x) => x.id === s.id) + 1}`, joint: jname(s.joint), on, from, F: forceName(from, on) };
    },
    /** Name of the force of link `from` on link `on` (numbers). */
    F: (from, on) => forceName(from, on),
    jname,
  };
}
