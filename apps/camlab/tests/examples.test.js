// =============================================================================
// The built-in examples (Examples menu) give the numbers printed on the slides.
// This runs each example the way the app does (analyse(doc)), so it checks
// what students see, not only the model functions. SHOW=1 prints a table.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../src/model/document.js';
import { analyse } from '../src/model/analysis.js';

const IN = 25.4, LBF = 4.4482216152605;
const rows = [];

/** Compare one number with the slide's; rel is the allowed relative error (the slide rounds). */
function same(example, what, got, slide, rel) {
  rows.push({ example, what, slide, camlab: +got.toPrecision(5), diff: `${((100 * (got - slide)) / Math.abs(slide)).toFixed(2)} %` });
  assert.ok(Math.abs(got - slide) <= rel * Math.abs(slide), `${example} ${what}: CamLab ${got}, slide ${slide}`);
}

const run = (id) => analyse(EXAMPLES.find((e) => e.id === id).make());
const peak = (r, k) => Math.abs(r.peaks[k].value) / IN; // in/s, in/s², in/s³
const aMin = (r) => Math.min(...r.time.map((x) => x.a)) / IN;
const aMax = (r) => Math.max(...r.time.map((x) => x.a)) / IN;

test('Examples 8-1 to 8-5 (double dwell, ω = 2π rad/s)', () => {
  const e1 = run('novice');
  assert.equal(e1.law.vOk, false, '8-1: the velocity jumps');
  const e2 = run('apprentice');
  assert.ok(e2.law.vOk && !e2.law.aOk, '8-2: velocity continuous, acceleration jumps');
  same('8-2 SHM', 'peak velocity (in/s)', peak(e2, 'v'), 6.28, 0.002);
  same('8-2 SHM', 'acceleration at the ends (in/s²)', peak(e2, 'a'), 78.8, 0.005);
  const e3 = run('junior');
  assert.ok(e3.law.ok, '8-3: law met');
  same('8-3 cycloidal', 'peak velocity (in/s)', peak(e3, 'v'), 8, 0.002);
  same('8-3 cycloidal', 'peak acceleration (in/s²)', peak(e3, 'a'), 100.4, 0.003);
  same('8-3 cycloidal', 'peak jerk (in/s³)', peak(e3, 'j'), 2523, 0.003);
  const t = run('modtrap');
  same('8-4 mod. trapezoid', 'peak velocity (in/s)', peak(t, 'v'), 8, 0.002);
  same('8-4 mod. trapezoid', 'peak acceleration (in/s²)', peak(t, 'a'), 78.1, 0.003);
  same('8-4 mod. trapezoid', 'peak jerk (in/s³)', peak(t, 'j'), 3925, 0.003);
  const s = run('modsine');
  same('8-4 mod. sine', 'peak velocity (in/s)', peak(s, 'v'), 7, 0.01);
  same('8-4 mod. sine', 'peak acceleration (in/s²)', peak(s, 'a'), 88.3, 0.003);
  same('8-4 mod. sine', 'peak jerk (in/s³)', peak(s, 'j'), 4439, 0.003);
  assert.ok(run('poly345').law.ok, '8-5: law met');
});

test('Examples 8-6 to 8-8 (single dwell, ω = 15 rad/s)', () => {
  const c = run('single-cyc');
  same('8-6 cycloidal', 'peak velocity (in/s)', peak(c, 'v'), 19.1, 0.003);
  same('8-6 cycloidal', 'peak acceleration (in/s²)', peak(c, 'a'), 573, 0.002);
  const d = run('single-dh');
  same('8-7 double harmonic', 'peak velocity (in/s)', peak(d, 'v'), 19.5, 0.003);
  same('8-7 double harmonic', 'peak negative acceleration (in/s²)', aMin(d), -900, 0.002);
  same('8-7 double harmonic', 'peak jerk (in/s³)', peak(d, 'j'), 36931, 0.002);
  const p = run('single-poly');
  same('8-8 3-4-5-6 poly', 'peak positive acceleration (in/s²)', aMax(p), 438, 0.003);
  same('8-8 3-4-5-6 poly', 'peak negative acceleration (in/s²)', aMin(p), -547, 0.003);
  assert.ok(p.law.ok);
});

test('Example 15-1 (four dwells, Rp = 4 in, k = 200 lb/in, Fpl = 150 lb)', () => {
  const r = run('ex15-1');
  assert.equal(r.problems.length, 0);
  same('15-1', 'peak acceleration (in/s²)', peak(r, 'a'), 3504, 0.002);
  same('15-1', 'largest pressure angle (°)', Math.max(r.shape.phiMax, -r.shape.phiMin) * 180 / Math.PI, 29.2, 0.005);
  same('15-1', 'smallest radius of curvature (in)', r.shape.rhoPitchMin / IN, 1.7, 0.03);
  same('15-1', 'damping c (lb·s/in)', r.forces.c / (LBF / IN), 1.153, 0.003);
  same('15-1', 'largest cam force (lb)', r.forces.Fmax / LBF, 400.4, 0.003);
  same('15-1', 'smallest cam force (lb)', r.forces.Fmin / LBF, 36.9, 0.01);
  assert.equal(r.forces.jump.length, 0, 'no follower jump');
  same('15-1', 'ωn (rad/s)', r.forces.wn, 52.06, 0.001);
  // the slide prints ωd = 51.98; its own equation 15.3c gives 51.47 (see slides.test.js)
  same('15-1', 'ωd (rad/s), slide prints 51.98', r.forces.wd, 51.47, 0.001);
  if (process.env.SHOW) console.table(rows);
});

test('polynomial coefficients are reported for polynomial segments (Ex 8-5, 8-8, 15-1)', () => {
  const coefs = (id) => run(id).prep.segments.filter((sg) => sg.poly).map((sg) => sg.poly.map((v) => +(v / IN).toFixed(9)));
  // Ex 8-8: s = h(64x³ − 192x⁴ + 192x⁵ − 64x⁶) (slide)
  assert.deepEqual(coefs('single-poly'), [[0, 0, 0, 64, -192, 192, -64]]);
  // Ex 8-5: 3-4-5 rise s = h(10x³ − 15x⁴ + 6x⁵); the fall is it run backwards from the top
  assert.deepEqual(coefs('poly345'), [[0, 0, 0, 10, -15, 6], [1, 0, 0, -10, 15, -6]]);
  // Ex 15-1: 3-4-5 rise and 4-5-6-7 fall (the other two segments are not polynomials)
  assert.deepEqual(coefs('ex15-1'), [[0, 0, 0, 10, -15, 6], [1, 0, 0, 0, -35, 84, -70, 20]]);
  // the coefficients give the same s as the program, anywhere in the segment
  for (const id of ['single-poly', 'poly345', 'ex15-1']) {
    for (const sg of run(id).prep.segments.filter((x) => x.poly)) {
      for (const x of [0, 0.13, 0.5, 0.77, 1]) {
        const s = sg.poly.reduce((acc, c, k) => acc + c * x ** k, 0);
        assert.ok(Math.abs(s - sg.f(x).s) < 1e-9, `${id} at x = ${x}`);
      }
    }
  }
});

test('Ex 8-1 (straight lines): infinite cam force and torque where v jumps, with their signs', () => {
  const r = analyse(EXAMPLES.find((e) => e.id === 'novice').make());
  // v steps up at 90° and 0° (+∞ force: impact), down at 180° and 270° (−∞: the follower leaves the cam)
  assert.deepEqual(r.forces.spikes.map((x) => [x.at, x.F]), [[90, 1], [180, -1], [270, -1], [0, 1]]);
  // torque: the way the kinetic energy jumps (v² up at 90° and 270°, down at 180° and 0°)
  assert.deepEqual(r.forces.spikes.map((x) => x.T), [1, -1, 1, -1]);
  // a law with continuous velocity has none
  assert.equal(analyse(EXAMPLES.find((e) => e.id === 'junior').make()).forces.spikes.length, 0);
});
