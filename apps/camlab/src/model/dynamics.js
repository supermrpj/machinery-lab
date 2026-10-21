// =============================================================================
// dynamics.js — force-closed cam and follower (Week 13 slides)
// -----------------------------------------------------------------------------
// One-degree-of-freedom lumped model: follower mass m on a spring k (preload
// Fpl = k·x0) with damping c = 2ζ√(km), driven at camshaft speed ω.
// Kinetostatic force the cam must supply along the follower axis:
//   Fc(θ) = m·ẍ + c·ẋ + k·(x + x0)          (15.8b)
// Where Fc < 0 the spring cannot hold the follower on the cam: follower jump.
// Camshaft torque from power in = power out (no friction):
//   Tc = Fc·ẋ / ω = Fc·ds/dθ                 (15.10)
// Natural frequencies: ωn = √(k/m), ωd = ωn·√(1 − ζ²).
//
// Units: mm, kg, N, s. Spring rate k in N/mm; c in N·s/mm.
// =============================================================================

/**
 * Inputs: { m (kg), k (N/mm), preload (N), zeta, omega (rad/s) }.
 * `samples` from program.js sample() (per-radian derivatives).
 * Returns { c, wn, wd, x0, rows: [{ deg, F, T }], Fmax, Fmin, FminAt, jump:
 * [ { from, to } ranges in degrees where F < 0 ], Tmax, Tmin }.
 */
export function camForces({ m, k, preload, zeta, omega }, samples) {
  const kSI = k * 1000;                       // N/m
  const cSI = 2 * zeta * Math.sqrt(kSI * m);  // N·s/m
  const c = cSI / 1000;                       // N·s/mm
  const x0 = k > 0 ? preload / k : 0;         // mm of spring compression at s = 0
  const rows = samples.map((sm) => {
    const vt = sm.v * omega, at = sm.a * omega * omega; // mm/s, mm/s²
    const F = (m * at) / 1000 + c * vt + k * sm.s + preload; // = k·(s + x0) with x0 = Fpl/k; works for k = 0 too
    return { deg: sm.deg, F, T: (F * sm.v) / 1000, s: sm.s, segment: sm.segment }; // T in N·m (ds/dθ in mm)
  });
  let Fmax = -Infinity, Fmin = Infinity, FminAt = 0, Tmax = -Infinity, Tmin = Infinity;
  for (const r of rows) {
    if (r.F > Fmax) Fmax = r.F;
    if (r.F < Fmin) { Fmin = r.F; FminAt = r.deg; }
    Tmax = Math.max(Tmax, r.T); Tmin = Math.min(Tmin, r.T);
  }
  // follower jump: angle ranges where the cam would have to pull
  const jump = [];
  let open = null;
  for (const r of rows) {
    if (r.F < 0 && open === null) open = r.deg;
    if (r.F >= 0 && open !== null) { jump.push({ from: open, to: r.deg }); open = null; }
  }
  if (open !== null) {
    // a range still open at 360° joins one that started at 0°
    if (jump.length && jump[0].from <= rows[0].deg + 1e-9) jump[0].from = open - 360;
    else jump.push({ from: open, to: rows[rows.length - 1].deg });
  }
  const wn = m > 0 ? Math.sqrt(kSI / m) : Infinity;
  return { c, x0, wn, wd: wn * Math.sqrt(Math.max(0, 1 - zeta * zeta)), rows, Fmax, Fmin, FminAt, jump, Tmax, Tmin };
}
