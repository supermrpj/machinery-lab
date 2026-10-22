// =============================================================================
// laws.js — rise functions for cam segments (normalised)
// -----------------------------------------------------------------------------
// Each law describes a RISE of 1 over a segment of length 1:
//   x = θ/β runs from 0 to 1, and law.at(x) returns { s, v, a, j } with
//   v = ds/dx, a = d²s/dx², j = d³s/dx³.
// A real segment of lift h over β radians scales them (program.js):
//   s = h·S,  ds/dθ = h/β·V,  d²s/dθ² = h/β²·A,  d³s/dθ³ = h/β³·J
// A fall is the rise run backwards: S_fall(x) = S(1 − x).
//
// The combined functions (modified trapezoid, modified sine, trapezoidal
// acceleration) are built from their acceleration shape, piece by piece, and
// integrated exactly (see piecewise() below), so no constants are copied.
// =============================================================================

const PI = Math.PI;

// ---- acceleration built from pieces: A(x) = c0 + c1·x + c2·sin(w·x + p) ----------

/**
 * Turn an acceleration shape into a rise law. `pieces` cover [0, 1] in order:
 * { from, to, c0, c1, c2, w, p }, all scaled by one constant C that is chosen
 * so that s(1) = 1. Velocity and displacement are integrated exactly from
 * s = v = 0 at x = 0.
 */
function piecewise(pieces) {
  // integrate one piece from x0 with starting v0, s0 (C = 1)
  const at = (pc, x, v0, s0) => {
    const { c0 = 0, c1 = 0, c2 = 0, w = 1, p = 0 } = pc;
    const u = x - pc.from, x0 = pc.from;
    const sin = (t) => Math.sin(w * t + p), cos = (t) => Math.cos(w * t + p);
    const a = c0 + c1 * x + c2 * sin(x);
    const j = c1 + c2 * w * cos(x);
    // ∫ a dx from x0
    const v = v0 + c0 * u + (c1 / 2) * (x * x - x0 * x0) + (c2 ? (-c2 / w) * (cos(x) - cos(x0)) : 0);
    // ∫∫ a dx dx from x0
    const s = s0 + v0 * u + (c0 / 2) * u * u
      + (c1 / 6) * (x * x * x - x0 * x0 * x0) - (c1 / 2) * x0 * x0 * u
      + (c2 ? (-c2 / w) * ((sin(x) - sin(x0)) / w - cos(x0) * u) : 0);
    return { s, v, a, j };
  };
  // starting values of each piece (C = 1)
  const starts = [];
  let v0 = 0, s0 = 0;
  for (const pc of pieces) {
    starts.push({ v0, s0 });
    const e = at(pc, pc.to, v0, s0);
    v0 = e.v; s0 = e.s;
  }
  const C = 1 / s0;
  return (x) => {
    let k = pieces.findIndex((pc) => x <= pc.to + 1e-15);
    if (k < 0) k = pieces.length - 1;
    const pc = pieces[k];
    const r = at(pc, x, starts[k].v0, starts[k].s0);
    return { s: C * r.s, v: C * r.v, a: C * r.a, j: C * r.j };
  };
}

// ---- the laws ------------------------------------------------------------------------

const poly = (c) => (x) => {
  // s = Σ c[n] xⁿ and its derivatives
  let s = 0, v = 0, a = 0, j = 0;
  for (let n = 0; n < c.length; n++) {
    if (!c[n]) continue;
    s += c[n] * x ** n;
    if (n >= 1) v += n * c[n] * x ** (n - 1);
    if (n >= 2) a += n * (n - 1) * c[n] * x ** (n - 2);
    if (n >= 3) j += n * (n - 1) * (n - 2) * c[n] * x ** (n - 3);
  }
  return { s, v, a, j };
};

/**
 * The rise laws. `note` says what each does at its ends (shown as a
 * tooltip on the law menu).
 */
export const LAWS = {
  constVel: {
    name: 'Constant velocity (straight line)', short: 'Const. velocity',
    at: (x) => ({ s: x, v: 1, a: 0, j: 0 }),
    note: 'The velocity jumps at both ends: infinite acceleration. Not acceptable.',
  },
  constAccel: {
    name: 'Constant acceleration (parabolic)', short: 'Const. accel.',
    at: (x) => (x <= 0.5 ? { s: 2 * x * x, v: 4 * x, a: 4, j: 0 } : { s: 1 - 2 * (1 - x) ** 2, v: 4 * (1 - x), a: -4, j: 0 }),
    note: 'The acceleration jumps at the ends and the middle: infinite jerk.',
  },
  shm: {
    name: 'Simple harmonic', short: 'Simple harmonic',
    at: (x) => ({ s: (1 - Math.cos(PI * x)) / 2, v: (PI / 2) * Math.sin(PI * x), a: (PI * PI / 2) * Math.cos(PI * x), j: -(PI ** 3 / 2) * Math.sin(PI * x) }),
    note: 'The acceleration is not zero at the ends, so it jumps next to a dwell: infinite jerk.',
  },
  cycloidal: {
    name: 'Cycloidal', short: 'Cycloidal',
    at: (x) => ({ s: x - Math.sin(2 * PI * x) / (2 * PI), v: 1 - Math.cos(2 * PI * x), a: 2 * PI * Math.sin(2 * PI * x), j: 4 * PI * PI * Math.cos(2 * PI * x) }),
    note: 'Continuous acceleration; the jerk is finite but jumps at the ends.',
  },
  poly345: {
    name: '3-4-5 polynomial', short: '3-4-5 poly',
    coef: [0, 0, 0, 10, -15, 6], // s = 10x³ − 15x⁴ + 6x⁵
    at: poly([0, 0, 0, 10, -15, 6]),
    note: 's, v and a are zero at both ends. A good compromise.',
  },
  poly4567: {
    name: '4-5-6-7 polynomial', short: '4-5-6-7 poly',
    coef: [0, 0, 0, 0, 35, -84, 70, -20], // s = 35x⁴ − 84x⁵ + 70x⁶ − 20x⁷
    at: poly([0, 0, 0, 0, 35, -84, 70, -20]),
    note: 'Jerk is also zero at both ends: smooth jerk, but higher acceleration.',
  },
  modTrap: {
    name: 'Modified trapezoid', short: 'Mod. trapezoid',
    // sine quarter-waves joined by constant acceleration (period β/2 for the sine parts)
    at: piecewise([
      { from: 0, to: 1 / 8, c2: 1, w: 4 * PI, p: 0 },
      { from: 1 / 8, to: 3 / 8, c0: 1 },
      { from: 3 / 8, to: 5 / 8, c2: 1, w: 4 * PI, p: -PI },
      { from: 5 / 8, to: 7 / 8, c0: -1 },
      { from: 7 / 8, to: 1, c2: -1, w: 4 * PI, p: -3 * PI },
    ]),
    note: 'Low peak acceleration with finite jerk. Popular for double-dwell cams.',
  },
  modSine: {
    name: 'Modified sine', short: 'Mod. sine',
    // quarter-waves of period β/2 at the ends, a sine of period 3β/2 in between
    at: piecewise([
      { from: 0, to: 1 / 8, c2: 1, w: 4 * PI, p: 0 },
      { from: 1 / 8, to: 7 / 8, c2: 1, w: (4 * PI) / 3, p: PI / 2 - (4 * PI) / 3 / 8 },
      { from: 7 / 8, to: 1, c2: -1, w: -4 * PI, p: 4 * PI },
    ]),
    note: 'Low peak velocity (less kinetic energy) with a smooth acceleration.',
  },
  trapAccel: {
    name: 'Trapezoidal acceleration', short: 'Trap. accel.',
    // straight ramps of β/8 between constant accelerations
    at: piecewise([
      { from: 0, to: 1 / 8, c1: 8 },
      { from: 1 / 8, to: 3 / 8, c0: 1 },
      { from: 3 / 8, to: 5 / 8, c0: 4, c1: -8 },
      { from: 5 / 8, to: 7 / 8, c0: -1 },
      { from: 7 / 8, to: 1, c0: -8, c1: 8 },
    ]),
    note: 'Finite but large, piecewise-constant jerk: tends to make vibration.',
  },
  doubleHarmonic: {
    name: 'Double harmonic', short: 'Double harmonic',
    at: (x) => ({
      s: 0.5 * ((1 - Math.cos(PI * x)) - 0.25 * (1 - Math.cos(2 * PI * x))),
      v: 0.5 * (PI * Math.sin(PI * x) - 0.5 * PI * Math.sin(2 * PI * x)),
      a: 0.5 * (PI * PI * Math.cos(PI * x) - PI * PI * Math.cos(2 * PI * x)),
      j: 0.5 * (-(PI ** 3) * Math.sin(PI * x) + 2 * PI ** 3 * Math.sin(2 * PI * x)),
    }),
    note: 'For a single-dwell cam: the acceleration does not return to zero at the top. Only for equal rise and fall times.',
  },
};

/** Order the laws appear in menus (the slides' path from novice to senior). */
export const LAW_ORDER = ['constVel', 'constAccel', 'shm', 'cycloidal', 'poly345', 'poly4567', 'modTrap', 'modSine', 'trapAccel', 'doubleHarmonic'];

/**
 * Polynomial through given boundary conditions on [0, 1]:
 * conditions [{ x, d, value }] with d = 0 (s), 1 (ds/dx), 2, 3. The degree is
 * one less than the number of conditions. Returns coefficients c[0..n].
 */
export function polyFromConditions(conditions) {
  const { A, b } = polyMatrix(conditions);
  return solveSmall(A, b);
}

/**
 * The linear system A·c = b behind polyFromConditions: one row per condition,
 * row = dᵈ/dxᵈ of [1, x, x², …, xⁿ] at that condition's x (shown in CamLab's
 * "Show the calculation").
 */
export function polyMatrix(conditions) {
  const n = conditions.length;
  const A = conditions.map(({ x, d }) => Array.from({ length: n }, (_, k) => {
    if (k < d) return 0;
    let f = 1;
    for (let i = 0; i < d; i++) f *= k - i;
    return f * x ** (k - d);
  }));
  const b = conditions.map((c) => c.value);
  return { A, b };
}

/** Polynomial law from coefficients (normalised x). */
export const polyAt = poly;

/**
 * Coefficients of p(1 − x) from those of p(x): a fall is a rise run
 * backwards, so its polynomial in x is the rise's with x → 1 − x.
 */
export function reversePoly(c) {
  const out = new Array(c.length).fill(0);
  for (let k = 0; k < c.length; k++) {
    // (1 − x)^k = Σ C(k, m) (−x)^m
    let binom = 1;
    for (let m = 0; m <= k; m++) {
      out[m] += c[k] * binom * (m % 2 ? -1 : 1);
      binom = (binom * (k - m)) / (m + 1);
    }
  }
  return out;
}

/** Gaussian elimination with partial pivoting (small systems). Null if singular. */
function solveSmall(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
