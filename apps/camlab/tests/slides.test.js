// =============================================================================
// CamLab against the Week 11-13 slides (Week 11-12 and Week 13)
//   Table 8-3        peak factors of the rise functions
//   Examples 8-1..5  double-dwell cam, 1 in rise and fall in 90°, ω = 2π rad/s
//   Examples 8-6..8  single-dwell cam, 1 in in 90° and back, ω = 15 rad/s
//   Example 15-1     eight-segment cam, Rp = 4 in: kinematics, pressure angle,
//                    spring and preload, natural frequencies
// The textbook works in inches and pounds; values are converted at the edges.
// SHOW=1 prints the numbers.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAWS, polyFromConditions } from '../src/model/laws.js';
import { prepare, sample, check, peaks, toTime } from '../src/model/program.js';
import { camShape } from '../src/model/geometry.js';
import { camForces } from '../src/model/dynamics.js';

const IN = 25.4, LBF = 4.4482216152605, BLOB = LBF / 0.0254; // mm, N, kg
const show = (...a) => { if (process.env.SHOW) console.log(...a); };
const near = (got, want, rel, msg) => assert.ok(Math.abs(got - want) <= rel * Math.abs(want), `${msg}: ${got} vs ${want}`);

/** Peak |value| of a law over x in [0, 1]. */
function lawPeaks(law) {
  let v = 0, a = 0, j = 0;
  for (let i = 0; i <= 40000; i++) { const r = law.at(i / 40000); v = Math.max(v, Math.abs(r.v)); a = Math.max(a, Math.abs(r.a)); j = Math.max(j, Math.abs(r.j)); }
  return { v, a, j };
}

/** Peaks in time units (in/s, in/s², in/s³) of a program at speed ω. */
function timePeaks(program, omega) {
  const sm = sample(prepare(program), 7200).map((x) => ({ ...toTime(x, omega), deg: x.deg }));
  const pk = peaks(sm);
  const amin = Math.min(...sm.map((x) => x.a)), amax = Math.max(...sm.map((x) => x.a));
  return { v: Math.abs(pk.v.value) / IN, a: Math.abs(pk.a.value) / IN, j: Math.abs(pk.j.value) / IN, amin: amin / IN, amax: amax / IN };
}

const doubleDwell = (law) => ({ segments: [
  { kind: 'dwell', beta: 90 }, { kind: 'rise', law, beta: 90, h: IN },
  { kind: 'dwell', beta: 90 }, { kind: 'fall', law, beta: 90, h: IN },
] });

test('Table 8-3: peak velocity, acceleration and jerk factors', () => {
  const table = { // Vmax·β/h, Amax·β²/h, Jmax·β³/h
    constAccel: [2.000, 4.000, null], shm: [1.571, 4.945, null], modTrap: [2.000, 4.888, 61],
    modSine: [1.760, 5.528, 69], poly345: [1.875, 5.777, 60], cycloidal: [2.000, 6.283, 40], poly4567: [2.188, 7.526, 52],
  };
  for (const [k, [V, A, Jx]] of Object.entries(table)) {
    const p = lawPeaks(LAWS[k]);
    show(k, p.v.toFixed(4), p.a.toFixed(4), p.j.toFixed(2));
    near(p.v, V, 0.002, `${k} Vmax`);
    near(p.a, A, 0.003, `${k} Amax`);
    if (Jx) near(p.j, Jx, 0.03, `${k} Jmax`); // the table rounds jerk to whole numbers
  }
  // trapezoidal acceleration with β/8 ramps: 2.000, 16/3, 128/3 (the table rounds to 5.3 and 44)
  const t = lawPeaks(LAWS.trapAccel);
  near(t.v, 2, 1e-4, 'trap V'); near(t.a, 16 / 3, 1e-4, 'trap A'); near(t.j, 128 / 3, 1e-3, 'trap J');
});

test('Examples 8-1 to 8-5: double-dwell cam, the fundamental law', () => {
  const w = 2 * Math.PI;
  // 8-1 straight lines: the velocity jumps (infinite acceleration)
  const c1 = check(prepare(doubleDwell('constVel')));
  assert.equal(c1.vOk, false);
  // 8-2 simple harmonic: velocity continuous, acceleration jumps (infinite jerk)
  const p2 = prepare(doubleDwell('shm'));
  const c2 = check(p2);
  assert.ok(c2.vOk && !c2.aOk);
  const t2 = timePeaks(doubleDwell('shm'), w);
  near(t2.v, 6.28, 0.002, '8-2 peak velocity');
  near(t2.a, 78.8, 0.005, '8-2 acceleration at the ends'); // slide: ±78.8 in/s²
  // 8-3 cycloidal: acceptable
  const c3 = check(prepare(doubleDwell('cycloidal')));
  assert.ok(c3.ok);
  const t3 = timePeaks(doubleDwell('cycloidal'), w);
  near(t3.a, 100.4, 0.003, '8-3 peak acceleration');
  near(t3.j, 2523, 0.003, '8-3 peak jerk');
  // 8-4 modified trapezoid and modified sine
  const t4 = timePeaks(doubleDwell('modTrap'), w);
  near(t4.a, 78.1, 0.003, '8-4 mod trap acceleration'); near(t4.j, 3925, 0.003, '8-4 mod trap jerk'); near(t4.v, 8, 0.002, '8-4 mod trap velocity');
  const t5 = timePeaks(doubleDwell('modSine'), w);
  near(t5.a, 88.3, 0.003, '8-4 mod sine acceleration'); near(t5.j, 4439, 0.003, '8-4 mod sine jerk'); near(t5.v, 7, 0.01, '8-4 mod sine velocity');
  assert.ok(check(prepare(doubleDwell('modTrap'))).ok && check(prepare(doubleDwell('modSine'))).ok);
  // 8-5 3-4-5 polynomial from its six boundary conditions
  const c = polyFromConditions([{ x: 0, d: 0, value: 0 }, { x: 0, d: 1, value: 0 }, { x: 0, d: 2, value: 0 }, { x: 1, d: 0, value: 1 }, { x: 1, d: 1, value: 0 }, { x: 1, d: 2, value: 0 }]);
  [0, 0, 0, 10, -15, 6].forEach((v, i) => assert.ok(Math.abs(c[i] - v) < 1e-9, `3-4-5 coefficient ${i}`));
  show('8-2', t2, '8-3', t3, '8-4', t4, t5);
});

test('Examples 8-6 to 8-8: single-dwell cam', () => {
  const w = 15;
  const single = (law) => ({ segments: [{ kind: 'rise', law, beta: 90, h: IN }, { kind: 'fall', law, beta: 90, h: IN }, { kind: 'dwell', beta: 180 }] });
  // 8-6 cycloidal rise and fall: 19.1 in/s, 573 in/s²
  const t6 = timePeaks(single('cycloidal'), w);
  near(t6.v, 19.1, 0.003, '8-6 velocity'); near(t6.a, 573, 0.002, '8-6 acceleration');
  // 8-7 double harmonic: 19.5 in/s, −900 in/s², 36 931 in/s³
  const t7 = timePeaks(single('doubleHarmonic'), w);
  near(t7.v, 19.5, 0.003, '8-7 velocity'); near(t7.amin, -900, 0.002, '8-7 acceleration'); near(t7.j, 36931, 0.002, '8-7 jerk');
  assert.ok(check(prepare(single('doubleHarmonic'))).ok, 'double harmonic is continuous for equal rise and fall');
  // 8-8 one polynomial over the 180° rise-fall: s = v = a = 0 at both ends, s = h at the middle
  const poly = { segments: [
    { kind: 'poly', beta: 180, conditions: [
      { at: 0, d: 0, value: 0 }, { at: 0, d: 1, value: 0 }, { at: 0, d: 2, value: 0 },
      { at: 0.5, d: 0, value: IN },
      { at: 1, d: 0, value: 0 }, { at: 1, d: 1, value: 0 }, { at: 1, d: 2, value: 0 }] },
    { kind: 'dwell', beta: 180 }] };
  const coef = polyFromConditions([{ x: 0, d: 0, value: 0 }, { x: 0, d: 1, value: 0 }, { x: 0, d: 2, value: 0 }, { x: 0.5, d: 0, value: 1 }, { x: 1, d: 0, value: 0 }, { x: 1, d: 1, value: 0 }, { x: 1, d: 2, value: 0 }]);
  [0, 0, 0, 64, -192, 192, -64].forEach((v, i) => assert.ok(Math.abs(coef[i] - v) < 1e-8, `3-4-5-6 coefficient ${i}: ${coef[i]}`));
  const t8 = timePeaks(poly, w);
  near(t8.amax, 438, 0.003, '8-8 positive acceleration'); near(t8.amin, -547, 0.003, '8-8 negative acceleration');
  assert.ok(check(prepare(poly)).ok);
  show('8-6', t6, '8-7', t7, '8-8', t8);
});

/** Example 15-1: the eight-segment cam. */
function example15() {
  return { segments: [
    { kind: 'rise', law: 'modSine', beta: 50, h: IN }, { kind: 'dwell', beta: 40 },
    { kind: 'fall', law: 'cycloidal', beta: 50, h: IN }, { kind: 'dwell', beta: 40 },
    { kind: 'rise', law: 'poly345', beta: 50, h: IN }, { kind: 'dwell', beta: 40 },
    { kind: 'fall', law: 'poly4567', beta: 50, h: IN }, { kind: 'dwell', beta: 40 },
  ] };
}

test('Example 15-1: kinematics, pressure angle, radius of curvature', () => {
  const prog = example15();
  const prep = prepare(prog);
  assert.equal(prep.problems.length, 0);
  assert.ok(check(prep).ok);
  const t = timePeaks(prog, 18.85);
  near(t.a, 3504, 0.002, 'peak acceleration (in/s²)');
  const sm = sample(prep, 7200);
  const shape = camShape({ type: 'roller', Rp: 4 * IN, Rf: 0, e: 0, dir: 1 }, sm);
  const phiMax = Math.max(Math.abs(shape.phiMax), Math.abs(shape.phiMin)) * 180 / Math.PI;
  near(phiMax, 29.2, 0.005, 'largest pressure angle (deg)');
  show('15-1 peak a', t.a.toFixed(1), 'in/s², φmax', phiMax.toFixed(2), '°, ρmin pitch', (shape.rhoPitchMin / IN).toFixed(3), 'in');
  near(shape.rhoPitchMin / IN, 1.7, 0.03, 'smallest radius of curvature (in)');
});

test('Example 15-1: spring, preload, damping and natural frequencies', () => {
  const sm = sample(prepare(example15()), 7200);
  const m = 0.0738 * BLOB, omega = 18.85, zeta = 0.15;
  // first try: k = 150 lb/in, Fpl = 75 lb: the force goes negative (follower jump)
  const a = camForces({ m, k: 150 * LBF / IN, preload: 75 * LBF, zeta, omega }, sm);
  near(a.c / (LBF / IN), 0.998, 0.003, 'damping coefficient (lb·s/in)');
  assert.ok(a.Fmin < 0 && a.jump.length === 2, `follower jump in two places: ${JSON.stringify(a.jump)}`);
  // second try: k = 200 lb/in, Fpl = 150 lb: positive everywhere
  const b = camForces({ m, k: 200 * LBF / IN, preload: 150 * LBF, zeta, omega }, sm);
  near(b.c / (LBF / IN), 1.153, 0.003, 'damping coefficient (lb·s/in)');
  near(b.Fmax / LBF, 400.4, 0.003, 'largest force (lb)');
  near(b.Fmin / LBF, 36.9, 0.01, 'smallest force (lb)');
  assert.equal(b.jump.length, 0);
  near(b.wn, 52.06, 0.001, 'ωn (rad/s)');
  // ωd from the slide's own equation 15.3c, ωd = √(k/m − (c/2m)²), is 51.47 rad/s.
  // The example prints 51.98, which is √(k/m − c/2m): the square is missing there.
  near(b.wd, Math.sqrt(b.wn ** 2 - (b.c * 1000 / (2 * m)) ** 2), 1e-9, 'ωd = √(k/m − (c/2m)²)');
  near(b.wd, 51.47, 0.001, 'ωd (rad/s), corrected');
  show('15-1 k=150', (a.Fmin / LBF).toFixed(1), a.jump, '| k=200', (b.Fmax / LBF).toFixed(1), (b.Fmin / LBF).toFixed(1), b.wn.toFixed(2), b.wd.toFixed(2));
});
