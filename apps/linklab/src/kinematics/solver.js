// =============================================================================
// solver.js — position, velocity and acceleration analysis
// -----------------------------------------------------------------------------
// Position:      Newton–Raphson with light damping (Levenberg–Marquardt),
//                started from the previous pose so the mechanism stays on the
//                same assembly branch (open/crossed) as it moves.
// Velocity:      J q̇ = ν          (linear)
// Acceleration:  J q̈ = γ          (linear)
// =============================================================================

import { dampedLeastSquares, solve, rank, normInf, transpose } from '../../../../packages/core-math/src/index.js';
import { evaluate, gamma, nu, designCoordinates } from './system.js';
import { KINEMATICS } from '../config.js';

/**
 * Characteristic length of the mechanism, used to scale tolerances: the
 * farthest joint (or wheel rim) from a link's reference point. No fixed
 * floor, so a tiny drawing is treated just like a large one.
 */
export function lengthScale(sys) {
  let L = 0;
  for (const [i, b] of sys.bodies.entries()) {
    if (sys.frame && sys.frame.has(i)) continue;   // a frame link is the ground: it must not change the scale
    L = Math.max(L, b.disc || 0);
    for (const s of b.local.values()) L = Math.max(L, Math.hypot(s.x, s.y));
  }
  return L > 0 ? L : 1;
}

/** Scale of each coordinate: 1 for x, y (mm); L for angles (rad → mm). */
export function coordScale(sys) {
  const L = lengthScale(sys);
  const w = new Array(sys.n).fill(L);
  for (let i = 0; i < sys.bodies.length; i++) { w[3 * i] = 1; w[3 * i + 1] = 1; }
  return w;
}

/**
 * Row weights that put every constraint row in mm, whatever the size of the
 * drawing: each row is divided by its largest entry once the angle columns
 * count as lengths (÷ w). A row in radians (a rotation lock, a motor input)
 * then weighs about L, a row in mm about 1. Without this, a large drawing
 * mixes entries of 1 and of L² in one matrix and its small pivots are taken
 * for zero (velocities and forces go missing), and a row in radians is
 * compared with a tolerance in mm (positions lose accuracy).
 */
export function rowWeights(J, w) {
  return J.map((row) => {
    let big = 0;
    for (let k = 0; k < row.length; k++) big = Math.max(big, Math.abs(row[k] / w[k]));
    return big > 0 ? 1 / big : 1;
  });
}

/** J with its rows weighted (rowWeights) and its columns in lengths: R·J·W⁻¹. */
export function balanced(J, w, rw = rowWeights(J, w)) {
  return J.map((row, i) => row.map((v, k) => (v * rw[i]) / w[k]));
}

/**
 * Solve the position equations Φ(q, θ) = 0 starting from q0.
 * Returns { q, ok, residual, iterations }.
 */
export function solvePosition(sys, q0, theta, opts = {}) {
  const withDriver = opts.withDriver !== false;
  const extra = opts.extra || null; // optional soft target rows (dragging)
  const scale = lengthScale(sys);
  const tol = KINEMATICS.positionTolerance * scale;
  let q = q0.slice();
  let mu = 1e-10 * scale * scale;
  let res = Infinity;

  // the constraint rows, each in mm (see rowWeights; fixed for this solve so
  // residuals stay comparable). The drag rows (extra) keep their own weight.
  const hardRows = (qq) => evaluate(sys, qq, theta, withDriver);
  let rw = null;
  const weigh = ({ F, J }) => {
    if (!rw) rw = rowWeights(J, coordScale(sys));
    return { F: F.map((v, i) => v * rw[i]), J: J.map((row, i) => row.map((v) => v * rw[i])) };
  };
  const residual = (qq) => {
    const { F, J } = weigh(hardRows(qq));
    if (extra) { const e = extra(qq); F.push(...e.F); J.push(...e.J); }
    return { F, J };
  };

  let { F, J } = residual(q);
  res = normInf(F);
  let it = 0;
  for (; it < KINEMATICS.maxIterations; it++) {
    if (res < tol && !extra) break;
    const dx = dampedLeastSquares(J, F, mu);
    if (!dx) return { q, ok: false, residual: res, iterations: it };
    const qn = q.map((v, k) => v + dx[k]);
    const next = residual(qn);
    const rn = normInf(next.F);
    if (rn < res || rn < tol) {
      q = qn; F = next.F; J = next.J;
      const stepSize = normInf(dx);
      res = rn;
      mu = Math.max(mu / 10, 1e-14 * scale * scale);
      if (extra && stepSize < tol) break;
    } else {
      mu *= 10;
      if (mu > 1e6 * scale * scale) break;
    }
  }
  // Polish: one or two more Newton steps make sure every row is converged to
  // round-off (quadratic convergence makes this cheap).
  if (!extra && res < tol && J.length) {
    for (let k = 0; k < 2; k++) {
      const dx = dampedLeastSquares(J, F, 1e-14 * scale * scale);
      if (!dx) break;
      const qn = q.map((v, i) => v + dx[i]);
      const next = residual(qn);
      const rn = normInf(next.F);
      if (!(rn <= res)) break;
      q = qn; F = next.F; J = next.J; res = rn;
    }
  }
  // When dragging, only the hard constraints must be satisfied.
  const hard = normInf(weigh(hardRows(q)).F);
  return { q, ok: hard < tol * 10, residual: hard, iterations: it };
}

/**
 * Solve a linear system that should have a unique answer (square or tall).
 * With w (coordScale) the system is first balanced (see rowWeights), so the
 * answer does not depend on the size of the drawing: the pivot test is
 * relative, and a tall system (redundant constraints) goes through the
 * normal equations, which square the spread of the entries.
 */
export function solveDetermined(J, rhs, w = null) {
  const m = J.length, n = m ? J[0].length : 0;
  if (n === 0) return [];
  if (m < n) return null;
  if (w) {
    const rw = rowWeights(J, w);
    const y = solveDetermined(balanced(J, w, rw), rhs.map((v, i) => v * rw[i]));
    return y && y.map((v, k) => v / w[k]);
  }
  if (m === n) return solve(J, rhs);
  // tall: least squares through the normal equations (consistent system)
  const Jt = transpose(J);
  const JtJ = Jt.map((r) => Jt.map((c) => r.reduce((s, a, k) => s + a * c[k], 0)));
  const Jtb = Jt.map((r) => r.reduce((s, a, k) => s + a * rhs[k], 0));
  return solve(JtJ, Jtb);
}

/** Velocities q̇ for input speed ω (rad/s). Null if not uniquely defined. */
export function solveVelocity(sys, q, theta, omegaIn) {
  const { J } = evaluate(sys, q, theta, true);
  return solveDetermined(J, nu(sys, omegaIn), coordScale(sys));
}

/** Accelerations q̈ for input speed ω and input angular acceleration α. */
export function solveAcceleration(sys, q, qd, theta, alphaIn = 0) {
  const { J } = evaluate(sys, q, theta, true);
  return solveDetermined(J, gamma(sys, q, qd, alphaIn), coordScale(sys));
}

/**
 * Degrees of freedom found from the Jacobian (without the input):
 *   DOF = (number of coordinates) − rank(J).
 * This is the "true" mobility at the current pose. It can differ from
 * Gruebler's count when geometry is special (e.g. a parallelogram with a
 * redundant link) — a nice discussion point for students.
 */
export function numericDOF(sys, q) {
  if (sys.n === 0) return 0;
  const { J } = evaluate(sys, q, 0, false);
  if (J.length === 0) return sys.n;
  return sys.n - rank(balanced(J, coordScale(sys)), 1e-9);
}

/**
 * Advance the mechanism from (q, θ) to θ + dθ, keeping the same branch.
 * Uses a velocity predictor and step halving. If the step cannot be taken
 * the mechanism has reached a limit (toggle) position.
 * Returns { ok, q, theta }.
 */
export function stepInput(sys, q, theta, dTheta) {
  let remaining = dTheta;
  let cur = q.slice(), th = theta;
  let h = dTheta;
  const minStep = Math.abs(dTheta) / 2 ** KINEMATICS.maxStepHalvings;
  const scale = lengthScale(sys);
  while (Math.abs(remaining) > 1e-15) {
    if (Math.abs(h) > Math.abs(remaining)) h = remaining;
    const qd = solveVelocity(sys, cur, th, 1); // dq/dθ
    const guess = qd ? cur.map((v, k) => v + qd[k] * h) : cur.slice();
    const r = solvePosition(sys, guess, th + h);
    // reject solutions that jump to the other assembly branch
    let jump = 0;
    if (r.ok) for (let k = 0; k < cur.length; k++) jump = Math.max(jump, Math.abs(r.q[k] - guess[k]));
    // a motor step of h radians moves points up to ~h·scale; an actuator step
    // of h mm moves them a few h (the guess already follows the motion)
    const perUnit = sys.driver && sys.driver.unit === 'mm' ? 3 : scale;
    const jumpLimit = KINEMATICS.branchJumpFactor * Math.max(Math.abs(h) * perUnit, 1e-6 * scale);
    if (r.ok && jump < jumpLimit) {
      cur = r.q; th += h; remaining -= h;
      h *= 2;
    } else {
      h /= 2;
      if (Math.abs(h) < minStep) return { ok: false, q: cur, theta: th };
    }
  }
  return { ok: true, q: cur, theta: th };
}

/**
 * Full analysis of one pose: positions, velocities and accelerations.
 * Returns { q, qd, qdd } (qd, qdd null when not defined).
 */
export function analyzePose(sys, q, theta, omegaIn, alphaIn = 0) {
  const qd = solveVelocity(sys, q, theta, omegaIn);
  const qdd = qd ? solveAcceleration(sys, q, qd, theta, alphaIn) : null;
  return { q, qd, qdd };
}

export { designCoordinates };
