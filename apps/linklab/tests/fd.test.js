// =============================================================================
// Velocities and accelerations checked against numerical differentiation.
// For every example and a batch of random mechanisms, at several positions:
//   q̇ ≈ (q(θ+h) − q(θ−h)) / 2h · ω        q̈ ≈ (q(θ+h) − 2q + q(θ−h)) / h² · ω²
// (with α = 0). The motion is followed along the path, so this also checks
// that the path is smooth wherever the input drives the mechanism.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoDriver } from '../src/model/document.js';
import { Simulation } from '../src/model/simulation.js';
import { analyzePose, poseResults, moveInput, startTangent, inputRate } from '../src/kinematics/index.js';
import { EXAMPLES } from '../src/model/examples.js';
import { makeFourbar, makeSliderCrank } from './helpers.js';

const DEG = Math.PI / 180;

/** Pose at input θ0 + d, reached along the path from q (so the branch is kept). */
function poseAt(sim, q, theta, d) {
  let t = startTangent(sim.sys, q, sim.w);
  if (inputRate(sim.sys, q, t) * d < 0) t = t.map((v) => -v);
  const r = moveInput(sim.sys, q, t, theta + d, sim.w);
  assert.ok(!r.limit, 'step reached a limit');
  return r.q;
}

/** Compare joint velocities/accelerations with central differences at sweep samples. */
function checkMechanism(doc, name, every = 23) {
  autoDriver(doc);
  const sim = new Simulation();
  sim.reset(doc);
  if (!sim.drivable) return 0;
  const sw = sim.getSweep();
  const omega = 1;
  const scale = sim.size;
  let checked = 0;
  for (let k = 3; k < sw.samples.length - 3; k += every) {
    const smp = sw.samples[k];
    if (smp.special) continue;
    // keep away from toggles: the input rate must be clear of zero
    if (Math.abs(inputRate(sim.sys, smp.q, smp.t)) < 0.2 / scale) continue;
    const h = sim.inputIsAngle ? 2e-3 : 2e-3 * scale; // big enough that solver round-off does not swamp q̈
    // central differences with steps h and h/2, combined by Richardson
    // extrapolation (error of order h⁴ instead of h²)
    const at = (d) => poseResults(sim.sys, doc, poseAt(sim, smp.q, smp.theta, d));
    const R1m = at(-h), R1p = at(h), R2m = at(-h / 2), R2p = at(h / 2);
    const { qd, qdd } = analyzePose(sim.sys, smp.q, smp.theta, omega, 0);
    const R = poseResults(sim.sys, doc, smp.q, qd, qdd);
    for (const j of doc.joints) {
      const p0 = R.joints.get(j.id);
      const P = (Rr) => Rr.joints.get(j.id).pos;
      const v = (m, p, hh, k) => (P(p)[k] - P(m)[k]) / (2 * hh);
      const a2 = (m, p, hh, k) => (P(p)[k] - 2 * p0.pos[k] + P(m)[k]) / (hh * hh);
      const rich = (f, k) => (4 * f(R2m, R2p, h / 2, k) - f(R1m, R1p, h, k)) / 3;
      const vx = rich(v, 'x'), vy = rich(v, 'y'), ax = rich(a2, 'x'), ay = rich(a2, 'y');
      const vScale = Math.max(1, Math.hypot(vx, vy), scale * 0.05);
      const aScale = Math.max(1, Math.hypot(ax, ay), scale * 0.05);
      assert.ok(Math.hypot(p0.vel.x - vx, p0.vel.y - vy) < 1e-5 * vScale + 1e-6,
        `${name} ${j.id} velocity at ${smp.theta}: ${p0.vel.x},${p0.vel.y} vs ${vx},${vy}`);
      assert.ok(Math.hypot(p0.acc.x - ax, p0.acc.y - ay) < 2e-3 * aScale,
        `${name} ${j.id} acceleration at ${smp.theta}: ${p0.acc.x},${p0.acc.y} vs ${ax},${ay}`);
    }
    checked++;
  }
  return checked;
}

test('every example: velocities and accelerations agree with numerical derivatives', () => {
  for (const ex of EXAMPLES) {
    const n = checkMechanism(ex.make(), ex.name);
    assert.ok(n > 0, `${ex.name}: nothing checked`);
  }
});

/** Small deterministic random numbers. */
function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }

test('random fourbars (Grashof and not), open and crossed', () => {
  const r = rng(7);
  let done = 0;
  for (let k = 0; k < 40; k++) {
    const a = 20 + 80 * r(), b = 40 + 120 * r(), c = 30 + 100 * r(), d = 40 + 120 * r();
    const t2 = (360 * r()) * DEG;
    for (const assembly of ['open', 'crossed']) {
      let m;
      try { m = makeFourbar({ a, b, c, d, theta2: t2, theta1: r() * 2 - 1, assembly }); } catch { continue; }
      if (!m.sol || !Number.isFinite(m.sol.theta4)) continue;
      done += checkMechanism(m.doc, `fourbar ${a.toFixed(1)}/${b.toFixed(1)}/${c.toFixed(1)}/${d.toFixed(1)} ${assembly}`, 37) > 0 ? 1 : 0;
    }
  }
  assert.ok(done > 30, `only ${done} fourbars could be checked`);
});

test('random offset slider-cranks', () => {
  const r = rng(11);
  let done = 0;
  for (let k = 0; k < 25; k++) {
    const a = 20 + 50 * r(), b = 80 + 100 * r(), c = (r() - 0.5) * 40;
    let m;
    try { m = makeSliderCrank({ a, b, c, theta2: 360 * r() * DEG }); } catch { continue; }
    if (!m.sol || !Number.isFinite(m.sol.d)) continue;
    done += checkMechanism(m.doc, `slider-crank ${a.toFixed(1)}/${b.toFixed(1)}/${c.toFixed(1)}`, 31) > 0 ? 1 : 0;
  }
  assert.ok(done > 15, `only ${done} slider-cranks could be checked`);
});
