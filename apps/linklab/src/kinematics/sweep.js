// =============================================================================
// sweep.js — analyse the whole range of the input (for plots and paths)
// -----------------------------------------------------------------------------
// Motor input: the input is turned through one full turn. If a limit (toggle)
// position stops it, the sweep goes back the other way from the start to find
// the other limit, so the result covers the whole range it can really move.
// Linear input (actuator, slider, prismatic): the input runs between its stroke
// limits (or the limit positions, if those come first).
// =============================================================================

import { stepInput, analyzePose, solvePosition, lengthScale } from './solver.js';
import { poseResults } from './system.js';
import { coordScale, onePath, startTangent, inputRate, pathStep, poseDistance, extremeFraction, delta } from './path.js';
import { KINEMATICS, PATH } from '../config.js';

/**
 * A full turn of a motor input: add a sample exactly where the input passes
 * 0° (a whole number of turns), so plots "from 0°" start at 0° and end at
 * 360°. The steps follow the path of motion, so they seldom land on 0° by
 * themselves. `at(a, b, goal)` makes the sample at input `goal` between
 * samples a and b (or null if it cannot).
 */
function addZeroSamples(samples, at) {
  const TURN = 2 * Math.PI, eps = 1e-9;
  for (let i = samples.length - 2; i >= 0; i--) {
    const a = samples[i], b = samples[i + 1];
    const k = Math.ceil(a.theta / TURN - eps);
    const goal = k * TURN;
    if (Math.abs(a.theta - goal) < eps || !(goal < b.theta - eps)) continue; // already on 0°, or no 0° in between
    const z = at(a, b, goal);
    if (z) samples.splice(i + 1, 0, z);
  }
  return samples;
}

/**
 * Sweep by following the path of motion (see path.js). It passes through
 * toggle positions — the input turns back while the mechanism flips to its
 * other assembly — so a rocking input covers its whole circuit, and it marks
 * toggle and stationary positions.
 *
 * opts.output(results) → output value (angles in degrees, opts.outputAngle)
 * Returns null when the mechanism has no single path to follow here.
 * Result: { samples, fullTurn, closed, limits, specials, path: true }
 *   sample  { theta, q, t, s, qd, qdd, results, special? }
 *   special { index, kind: 'toggle' | 'stationary' | 'end', theta }
 */
export function sweepPath(sys, doc, q0, theta0, omega, alpha = 0, opts = {}) {
  if (!sys.driver || !onePath(sys, q0)) return null;
  const w = coordScale(sys), L = lengthScale(sys);
  // opts.draft: a quicker, coarser sweep while the design is being dragged
  const hMax = PATH.maxStep * L * (opts.draft ? PATH.dragStepFactor : 1), hMin = PATH.minStep * L;
  const linear = sys.driver.unit === 'mm';
  const range = linear ? sys.driver.range : null;
  const stepDeg = opts.stepDeg || KINEMATICS.sweepStepDeg;
  const dTheta = linear ? ((range[1] - range[0]) * stepDeg) / 360 : (stepDeg * Math.PI) / 180;
  const read = (q) => sys.driver.read(q);
  let t0 = startTangent(sys, q0, w);
  if (!t0) return null;
  if (inputRate(sys, q0, t0) < 0) t0 = t0.map((v) => -v);

  const sample = (q, t, s) => {
    const th = read(q);
    const { qd, qdd } = analyzePose(sys, q, th, omega, alpha);
    return { theta: th, q, t, s, qd, qdd, results: poseResults(sys, doc, q, qd, qdd) };
  };

  /** March along the path from the start in direction dir (±1). */
  const march = (dir) => {
    const out = [];
    let q = q0, t = t0.map((v) => dir * v), s = 0, closed = false, turned = false, why = null;
    let h = hMax;
    for (let k = 0; k < PATH.maxSamples; k++) {
      const rate = Math.abs(inputRate(sys, q, t));
      h = Math.min(hMax, Math.max(hMin, dTheta / Math.max(rate, 1e-12)));
      let r = pathStep(sys, q, t, h, w);
      while (!r.ok && h > hMin) { h /= 2; r = pathStep(sys, q, t, h, w); }
      if (!r.ok) { why = 'stuck'; break; }
      // a hard end of the input's travel (actuator stroke, end of a rail)
      if (range) {
        const th0 = read(q), th1 = read(r.q);
        const bound = th1 > range[1] ? range[1] : th1 < range[0] ? range[0] : null;
        if (bound !== null) {
          const f = (bound - th0) / (th1 - th0 || 1);
          const near = pathStep(sys, q, t, h * Math.max(0, Math.min(1, f)), w);
          const exact = solvePosition(sys, near.ok ? near.q : q, bound);
          if (exact.ok) out.push({ ...sample(exact.q, near.ok ? near.t : t, s + h * f), special: 'end' });
          why = 'end';
          break;
        }
      }
      // a motor input that has made one whole turn: enough for the plots (gears
      // and racks need many turns to come back to the very same pose)
      if (!linear && dir > 0 && read(r.q) - theta0 >= 2 * Math.PI) {
        const th0 = read(q), th1 = read(r.q), goal = theta0 + 2 * Math.PI;
        const f = (goal - th0) / (th1 - th0 || 1);
        const near = pathStep(sys, q, t, h * Math.max(0, Math.min(1, f)), w);
        const exact = solvePosition(sys, near.ok ? near.q : r.q, goal);
        const qe = exact.ok ? exact.q : r.q;
        out.push(sample(qe, near.ok ? near.t : r.t, s + h * f));
        turned = true;
        // the same pose as the start (a crank): the circuit is closed too
        closed = poseDistance(sys, qe, q0, w) < 1e-6 * L;
        break;
      }
      s += h; q = r.q; t = r.t;
      // back at the start: the circuit is closed
      if (dir > 0 && s > 6 * hMax && poseDistance(sys, q, q0, w) < Math.max(1.5 * h, 1e-6 * L)) {
        // land exactly on the start pose (angles one or more turns on)
        const isAngle = (k) => k >= 3 * sys.bodies.length || k % 3 === 2;
        const qc = q0.map((v, k) => (isAngle(k) ? v + 2 * Math.PI * Math.round((q[k] - v) / (2 * Math.PI)) : v));
        out.push(sample(qc, t0, s));
        closed = true;
        break;
      }
      out.push(sample(q, t, s));
    }
    return { out, closed, turned, why };
  };

  const start = sample(q0, t0, 0);
  const fwd = march(1);
  let samples;
  if (fwd.closed || fwd.turned) samples = [start, ...fwd.out];
  else {
    const back = march(-1);
    // backward samples run the other way: flip their tangents and arc lengths
    const b = back.out.reverse().map((smp) => ({ ...smp, t: smp.t.map((v) => -v), s: -smp.s }));
    samples = [...b, start, ...fwd.out];
  }
  const closed = fwd.closed;
  const thetas = samples.map((x) => x.theta);
  const monotonic = thetas.every((v, i) => i === 0 || v >= thetas[i - 1] - 1e-12);
  const fullTurn = !linear && (closed || fwd.turned) && monotonic && Math.abs(thetas[thetas.length - 1] - thetas[0] - 2 * Math.PI) < 1e-6;
  if (fullTurn) {
    addZeroSamples(samples, (a, b, goal) => {
      const span = b.s - a.s, f = (goal - a.theta) / (b.theta - a.theta);
      const near = pathStep(sys, a.q, a.t, span * f, w);
      const exact = solvePosition(sys, near.ok ? near.q : a.q, goal);
      return exact.ok ? sample(exact.q, near.ok ? near.t : a.t, a.s + span * f) : null;
    });
    thetas.splice(0, thetas.length, ...samples.map((x) => x.theta));
  }

  // ---- toggle and stationary positions ----
  const specials = [];
  const refine = (i, val, kind) => {
    if (opts.draft) return; // while dragging: the sample itself is close enough; exact on release
    // extreme between samples i−1 and i+1: search along the path from i−1
    const a = samples[i - 1], c = samples[i + 1];
    const span = c.s - a.s;
    if (!(span > 0)) return;
    const f = extremeFraction(sys, a.q, a.t, span, val, kind, w);
    const r = pathStep(sys, a.q, a.t, span * f, w);
    if (r.ok) samples[i] = sample(r.q, r.t, a.s + span * f);
  };
  const scan = (valOf, angle, kind) => {
    for (let i = 1; i < samples.length - 1; i++) {
      const d1 = delta(valOf(samples[i - 1]), valOf(samples[i]), angle);
      const d2 = delta(valOf(samples[i]), valOf(samples[i + 1]), angle);
      if (d1 * d2 < 0 && Math.abs(d1) + Math.abs(d2) > 0) {
        if (kind === 'toggle') refine(i, (q) => read(q), d1 > 0 ? 'max' : 'min');
        else refine(i, (q) => opts.output(poseResults(sys, doc, q)), d1 > 0 ? 'max' : 'min');
        samples[i].special = kind;
      }
    }
  };
  scan((x) => x.theta, false, 'toggle');
  if (opts.output) scan((x) => opts.output(x.results), !!opts.outputAngle, 'stationary');
  samples.forEach((x, i) => { if (x.special) specials.push({ index: i, kind: x.special, theta: x.theta }); });

  const lo = Math.min(...thetas), hi = Math.max(...thetas);
  return { samples, fullTurn, closed, limits: fullTurn ? [] : [lo, hi], specials, path: true };
}

/**
 * @returns {{ samples: Array, fullTurn: boolean, limits: number[] }}
 * Each sample: { theta, q, qd, qdd, results } sorted by input value.
 */
export function sweep(sys, doc, q0, theta0, omega, alpha = 0, stepDeg = KINEMATICS.sweepStepDeg) {
  const linear = sys.driver && sys.driver.unit === 'mm';
  const range = linear ? sys.driver.range : null;
  const nSteps = Math.round(360 / stepDeg);
  const h = linear ? (range[1] - range[0]) / nSteps : (stepDeg * Math.PI) / 180;
  const sample = (q, th) => {
    const { qd, qdd } = analyzePose(sys, q, th, omega, alpha);
    return { theta: th, q, qd, qdd, results: poseResults(sys, doc, q, qd, qdd) };
  };

  /** March from the start towards `end` (or one turn) in steps of `dir·h`. */
  const march = (dir, end) => {
    const out = [];
    let q = q0, th = theta0, stopped = false;
    for (let k = 0; k < 4 * nSteps; k++) {
      let step = dir * h;
      if (end !== undefined) {
        const left = end - th;
        if (dir * left <= 1e-12) break;
        if (Math.abs(step) > Math.abs(left)) step = left;
      } else if (k >= nSteps) break;
      const r = stepInput(sys, q, th, step);
      if (!r.ok) { stopped = true; if (r.theta !== th) out.push(sample(r.q, r.theta)); break; }
      q = r.q; th = r.theta;
      out.push(sample(q, th));
    }
    return { out, stopped };
  };

  const start = sample(q0, theta0);
  if (!linear) {
    const fwd = march(1);
    if (!fwd.stopped) {
      const samples = addZeroSamples([start, ...fwd.out], (a, b, goal) => {
        const exact = solvePosition(sys, a.q, goal);
        return exact.ok ? sample(exact.q, goal) : null;
      });
      return { samples, fullTurn: true, limits: [] };
    }
    const back = march(-1);
    const all = [...back.out.reverse(), start, ...fwd.out];
    return { samples: all, fullTurn: false, limits: [all[0].theta, all[all.length - 1].theta] };
  }
  const fwd = march(1, Math.max(range[1], theta0));
  const back = march(-1, Math.min(range[0], theta0));
  const all = [...back.out.reverse(), start, ...fwd.out];
  return { samples: all, fullTurn: false, limits: [all[0].theta, all[all.length - 1].theta] };
}
