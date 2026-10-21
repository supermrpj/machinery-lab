// =============================================================================
// path.js — follow the mechanism along its path of motion
// -----------------------------------------------------------------------------
// A mechanism with one degree of freedom can only move along one curve in its
// configuration space q. Stepping the INPUT angle (solver.js stepInput) works
// until the input reaches a limit: there a small change of input moves the
// links a lot, the input can go no further, and the motion continues only by
// turning the input back while the mechanism flips to its other assembly
// (open ↔ crossed). Stepping the input cannot pass that point — it stalls and
// chatters.
//
// METHOD: pseudo-arclength continuation. We step along the curve itself:
//   predictor  q* = q + h·t             t = unit tangent (null space of Φq)
//   corrector  Φ(q) = 0  and  tᵀW(q − q*) = 0   (Newton, damped)
// The arc length s is measured in scaled coordinates (angles × a length scale
// L, so a turn of a link counts like the movement of a point L away). Steps
// are rejected and halved when the corrector struggles or the tangent turns
// sharply, so the motion never jumps to another branch.
//
// Along the path we watch two things:
//   input θ      when dθ/ds changes sign → TOGGLE position (input limit)
//   output       when its rate changes sign → STATIONARY position (output limit)
// =============================================================================

import { dampedLeastSquares, rank, solve, transpose, normInf, wrapPi } from '../../../../packages/core-math/src/index.js';
import { evaluate, poseResults } from './system.js';
import { lengthScale, solvePosition } from './solver.js';
import { PATH } from '../config.js';

// ---- metric --------------------------------------------------------------------------

/** Scale of each coordinate: 1 for x, y (mm); L for angles (rad → mm). */
export function coordScale(sys) {
  const L = lengthScale(sys);
  const w = new Array(sys.n).fill(L);
  for (let i = 0; i < sys.bodies.length; i++) { w[3 * i] = 1; w[3 * i + 1] = 1; }
  return w;
}

/** Indices of coordinates that are angles (compared modulo 2π). */
function angleMask(sys) {
  const m = new Array(sys.n).fill(true);
  for (let i = 0; i < sys.bodies.length; i++) { m[3 * i] = false; m[3 * i + 1] = false; }
  return m;
}

const dotW = (a, b, w) => a.reduce((s, v, k) => s + v * b[k] * w[k] * w[k], 0);
const normW = (a, w) => Math.sqrt(Math.max(dotW(a, a, w), 0));

/** Distance between two poses, angles taken modulo 2π (in scaled units). */
export function poseDistance(sys, a, b, w = coordScale(sys)) {
  const ang = angleMask(sys);
  let s = 0;
  for (let k = 0; k < a.length; k++) {
    const d = ang[k] ? wrapPi(a[k] - b[k]) : a[k] - b[k];
    s += (d * w[k]) ** 2;
  }
  return Math.sqrt(s);
}

// ---- the curve ---------------------------------------------------------------------------

/** Constraint Jacobian without the input row. */
const jacobian = (sys, q) => evaluate(sys, q, 0, false).J;

/** Does the mechanism have exactly one degree of freedom here (a path to follow)? */
export function onePath(sys, q) {
  if (!sys || sys.n === 0) return false;
  const J = jacobian(sys, q);
  return sys.n - (J.length ? rank(J, 1e-9) : 0) === 1;
}

/** Least-squares solve for a tall or square system (normal equations). */
function lsq(A, b) {
  const m = A.length, n = A[0].length;
  if (m === n) return solve(A, b, 1e-15);
  const At = transpose(A);
  const AtA = At.map((r) => At.map((c) => r.reduce((s, x, k) => s + x * c[k], 0)));
  const Atb = At.map((r) => r.reduce((s, x, k) => s + x * b[k], 0));
  return solve(AtA, Atb, 1e-15);
}

/**
 * Unit tangent of the path at q, pointing the same way as `ref` (a previous
 * tangent). Solves [Φq ; refᵀW²] t = [0 ; 1] in scaled coordinates.
 */
export function tangent(sys, q, ref, w = coordScale(sys)) {
  const J = jacobian(sys, q);
  // scaled columns: J' = J·W⁻¹,  t' = W·t
  const A = J.map((row) => row.map((v, k) => v / w[k]));
  A.push(ref.map((v, k) => v * w[k]));
  const b = new Array(A.length).fill(0); b[b.length - 1] = 1;
  const ts = lsq(A, b);
  if (!ts) return null;
  const t = ts.map((v, k) => v / w[k]);
  const n = normW(t, w);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  return t.map((v) => v / n);
}

/**
 * A starting tangent: the direction in which the input increases, or (with
 * no input, or exactly at an input limit) any direction along the path.
 */
export function startTangent(sys, q, w = coordScale(sys)) {
  const J = jacobian(sys, q);
  const n = sys.n;
  // try the input direction first: [Φq ; ∇θ] t = [0 ; 1]
  if (sys.driver) {
    const g = sys.driver.row.eval(q, n).J;
    const A = J.concat([g]);
    const b = new Array(A.length).fill(0); b[b.length - 1] = 1;
    const t = A.length >= n ? lsq(A, b) : null;
    if (t && t.every(Number.isFinite)) {
      const res = normInf(J.map((r) => r.reduce((s, v, k) => s + v * t[k], 0)));
      const nn = normW(t, w);
      if (nn > 0 && res < 1e-6 * nn * Math.max(...w)) return t.map((v) => v / nn);
    }
  }
  // otherwise: the null vector of Φq by inverse iteration on (J'ᵀJ' + εI)
  const A = J.map((row) => row.map((v, k) => v / w[k]));
  const At = transpose(A.length ? A : [new Array(n).fill(0)]);
  const M = At.map((r) => At.map((c) => r.reduce((s, x, k) => s + x * c[k], 0)));
  for (let i = 0; i < n; i++) M[i][i] += 1e-10;
  let v = new Array(n).fill(0).map((_, k) => 1 + 0.1 * k);
  for (let it = 0; it < 30; it++) {
    const nv = solve(M, v, 1e-30);
    if (!nv) break;
    const m = Math.sqrt(nv.reduce((s, x) => s + x * x, 0));
    v = nv.map((x) => x / m);
  }
  const t = v.map((x, k) => x / w[k]);
  const nn = normW(t, w);
  return nn > 0 ? t.map((x) => x / nn) : null;
}

/** Rate of change of the input along the path, dθ/ds (θ per scaled mm). */
export function inputRate(sys, q, t) {
  if (!sys.driver) return 0;
  const g = sys.driver.row.eval(q, sys.n).J;
  return g.reduce((s, v, k) => s + v * t[k], 0);
}

/**
 * One predictor–corrector step of arc length h along tangent t.
 * Returns { ok, q, t } — the new pose and its tangent (same orientation).
 */
export function pathStep(sys, q, t, h, w = coordScale(sys)) {
  const scale = lengthScale(sys);
  const tol = 1e-10 * scale;
  const pred = q.map((v, k) => v + h * t[k]);
  let x = pred.slice();
  let mu = 1e-12 * scale * scale;
  let res = Infinity;
  for (let it = 0; it < PATH.maxCorrectorIterations; it++) {
    const { F, J } = evaluate(sys, x, 0, false);
    // the step must stay in the plane through the predictor, normal to t
    const arc = t.reduce((s, v, k) => s + v * w[k] * w[k] * (x[k] - pred[k]), 0);
    const Fa = F.concat([arc]);
    const Ja = J.concat([t.map((v, k) => v * w[k] * w[k])]);
    res = normInf(F);
    const done = res < tol && Math.abs(arc) < tol;
    const dx = dampedLeastSquares(Ja, Fa, mu);
    if (!dx || !dx.every(Number.isFinite)) { if (done) break; return { ok: false }; }
    x = x.map((v, k) => v + dx[k]);
    // converged: that was one more (polishing) step, which also settles rows
    // measured in radians to round-off
    if (done) break;
  }
  res = normInf(evaluate(sys, x, 0, false).F);
  if (!(res < tol * 100)) return { ok: false };
  // the corrector should only nudge the prediction (else we jumped somewhere)
  const moved = normW(x.map((v, k) => v - pred[k]), w);
  if (moved > PATH.maxCorrection * Math.abs(h) + tol) return { ok: false };
  const t2 = tangent(sys, x, t, w);
  if (!t2) return { ok: false };
  // the path must not turn sharply within one step
  if (dotW(t2, t, w) < PATH.minTangentCos) return { ok: false };
  return { ok: true, q: x, t: t2 };
}

// ---- walking ----------------------------------------------------------------------------

/**
 * Walk along the path for arc length `dist` (≥ 0) in the direction of t,
 * with adaptive steps. `stop(prev, next)` may return a fraction 0…1 of the
 * last step at which to stop (a limit was crossed), or null to carry on.
 * Returns { q, t, travelled, stopped, why }.
 */
export function walk(sys, q, t, dist, { w = coordScale(sys), hMax = PATH.maxStep * lengthScale(sys), stop = null } = {}) {
  const hMin = PATH.minStep * lengthScale(sys);
  let cur = q, tan = t, done = 0, h = Math.min(hMax, dist);
  let guard = 0;
  while (done < dist - 1e-12 && guard++ < 10000) {
    h = Math.min(h, dist - done, hMax);
    const r = pathStep(sys, cur, tan, h, w);
    if (!r.ok) {
      h /= 2;
      if (h < hMin) return { q: cur, t: tan, travelled: done, stopped: true, why: 'stuck' };
      continue;
    }
    if (stop) {
      const f = stop({ q: cur, t: tan }, { q: r.q, t: r.t }, h);
      if (f !== null && f !== undefined) {
        // go back to the crossing point
        const back = f > 0 ? pathStep(sys, cur, tan, h * f, w) : { ok: true, q: cur, t: tan };
        const end = back.ok ? back : { q: cur, t: tan };
        return { q: end.q, t: end.t, travelled: done + h * Math.max(f, 0), stopped: true, why: 'limit' };
      }
    }
    cur = r.q; tan = r.t; done += h;
    h = Math.min(h * 1.6, hMax);
  }
  return { q: cur, t: tan, travelled: done, stopped: false, why: null };
}

/**
 * Find where a quantity g(q) along one step reaches its extreme (or a value),
 * by golden-section search on the step fraction. `val(q)` returns a number;
 * `kind` is 'max' or 'min'. Returns the fraction 0…1.
 */
export function extremeFraction(sys, q, t, h, val, kind, w = coordScale(sys)) {
  const at = (f) => {
    if (f <= 0) return val(q);
    const r = pathStep(sys, q, t, h * f, w);
    return r.ok ? val(r.q) : NaN;
  };
  const sign = kind === 'max' ? 1 : -1;
  let a = 0, b = 1;
  const g = 0.6180339887;
  let c = b - g * (b - a), d = a + g * (b - a);
  let fc = sign * at(c), fd = sign * at(d);
  for (let i = 0; i < 40 && b - a > 1e-6; i++) {
    if (!(fc < fd)) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = sign * at(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = sign * at(d); }
  }
  return (a + b) / 2;
}

// ---- moving the input along the path ---------------------------------------------

/**
 * Move along the path until the input reaches `target`. `t` must point the
 * way the input should change. If the input turns back first, the mechanism
 * has met a TOGGLE position: it stops exactly there and `limit` is true.
 * Returns { q, t, theta, limit }.
 */
export function moveInput(sys, q, t, target, w = coordScale(sys)) {
  const L = lengthScale(sys), hMax = PATH.maxStep * L, hMin = PATH.minStep * L;
  const read = (x) => sys.driver.read(x);
  let cur = q, tan = t, th = read(q);
  const sgn = Math.sign(target - th);
  if (!sgn) return { q, t, theta: th, limit: false };
  for (let k = 0; k < PATH.maxSamples; k++) {
    const left = target - th;
    if (left * sgn <= 1e-12 * (1 + Math.abs(target))) return { q: cur, t: tan, theta: th, limit: false };
    const rate = inputRate(sys, cur, tan);
    let h = Math.min(hMax, Math.max(hMin, Math.abs(left) / Math.max(Math.abs(rate), 1e-12)));
    let r = pathStep(sys, cur, tan, h, w);
    while (!r.ok && h > hMin) { h /= 2; r = pathStep(sys, cur, tan, h, w); }
    if (!r.ok) return { q: cur, t: tan, theta: th, limit: true };
    const th1 = read(r.q);
    if ((th1 - th) * sgn <= 0) {
      // the input turned back within this step: stop at its extreme (the toggle)
      const f = extremeFraction(sys, cur, tan, h, read, sgn > 0 ? 'max' : 'min', w);
      const e = f > 1e-9 ? pathStep(sys, cur, tan, h * f, w) : { ok: false };
      const end = e.ok ? e : { q: cur, t: tan };
      return { q: end.q, t: end.t, theta: read(end.q), limit: true };
    }
    if ((th1 - target) * sgn >= 0) {
      // passed the target within this step: land on it exactly
      const f = (target - th) / (th1 - th);
      const near = pathStep(sys, cur, tan, h * f, w);
      const base = near.ok ? near : { q: cur, t: tan };
      const ex = solvePosition(sys, base.q, target);
      if (ex.ok && poseDistance(sys, ex.q, base.q, w) < 0.5 * h + 1e-9 * L) {
        return { q: ex.q, t: tangent(sys, ex.q, base.t, w) || base.t, theta: target, limit: false };
      }
      return { q: base.q, t: base.t, theta: read(base.q), limit: false };
    }
    cur = r.q; tan = r.t; th = th1;
  }
  return { q: cur, t: tan, theta: th, limit: true };
}

/**
 * Animation: move along the path in the direction of t so that the input
 * changes by about |dInput|, but never further than maxArc (so a toggle,
 * where the input hardly moves, is still crossed at a visible pace). Stops at
 * the ends of `range` (a linear input's stroke) and reports `reversed`.
 * Returns { q, t, theta, reversed }.
 */
export function travel(sys, q, t, dInput, maxArc, range = null, w = coordScale(sys)) {
  const rate = Math.abs(inputRate(sys, q, t));
  const dist = Math.min(Math.abs(dInput) / Math.max(rate, 1e-12), maxArc);
  const read = (x) => sys.driver.read(x);
  const stop = range ? (a, b) => {
    const t0 = read(a.q), t1 = read(b.q);
    const bound = t1 > range[1] ? range[1] : t1 < range[0] ? range[0] : null;
    return bound === null ? null : Math.max(0, Math.min(1, (bound - t0) / (t1 - t0 || 1)));
  } : null;
  const r = walk(sys, q, t, dist, { w, stop });
  const reversed = r.stopped && r.why === 'limit';
  return { q: r.q, t: reversed ? r.t.map((v) => -v) : r.t, theta: read(r.q), reversed, stuck: r.stopped && r.why === 'stuck' };
}

/** Output value at pose q for an output-reading function on pose results. */
export function outputReader(sys, doc, read) {
  if (!read) return null;
  return (q) => {
    const v = read(poseResults(sys, doc, q));
    return v === null || v === undefined ? NaN : v;
  };
}

/** Change of a value between two poses; angles (`angle: true`) wrap at ±180°. */
export const delta = (a, b, angle) => (angle ? ((b - a + 540) % 360) - 180 : b - a);
