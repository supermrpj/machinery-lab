// =============================================================================
// Balancing, against worked examples from the course:
//   Example 12-1  single-plane balance of two masses
//   Example 12-2  two-plane balance of three masses
//   Fan example   two-plane balance from measured bearing forces
//   Example 2     exact force balance of a fourbar: the counterweights on the
//                 crank and rocker, then the shaking force over a whole turn
//                 (it must vanish), and the input torque before balancing.
// SHOW=1 prints the numbers.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, addLink, setDriverSpec } from '../src/model/document.js';
import { Simulation } from '../src/model/simulation.js';
import { analyseForces } from '../src/model/forces.js';
import { fourbarPosition } from '../src/kinematics/index.js';
import { rotorStatic, rotorDynamic, rotorFromBearings, rotorUnbalance, fourbarForceBalance, counterweightFor } from '../src/model/balance.js';

const near = (got, want, tol, msg) => assert.ok(Math.abs(got - want) <= tol, `${msg}: ${got} vs ${want}`);
const show = (...a) => { if (process.env.SHOW) console.log(...a); };

test('Example 12-1: single-plane balance', () => {
  const r = rotorStatic([{ m: 1.2, R: 1.135, angle: 113.4 }, { m: 1.8, R: 0.822, angle: 48.8 }]);
  near(r.mag, 2.402, 2e-3, 'mR (kg·m)');
  near(r.angle + 360, 259.6, 0.1, 'θb (deg)');
  near(r.mag / 0.806, 2.980, 3e-3, 'mb at Rb = 0.806 m');
  show('12-1', r.mag.toFixed(3), (r.angle + 360).toFixed(1));
});

test('Example 12-2: two-plane balance', () => {
  const r = rotorDynamic([
    { m: 1.2, R: 1.135, angle: 113.4, l: 0.854 },
    { m: 1.8, R: 0.822, angle: 48.8, l: 1.701 },
    { m: 2.4, R: 1.04, angle: 251.4, l: 2.396 },
  ], 3.097);
  near(r.B.mag, 0.904, 2e-3, 'mB RB'); near(r.B.angle, 75.27, 0.1, 'θB');
  near(r.A.mag, 0.880, 2e-3, 'mA RA'); near(r.A.angle, -81.25, 0.15, 'θA');
  show('12-2', r.A, r.B);
});

test('Fan example: two-plane balance from bearing forces', () => {
  const r = rotorFromBearings({ F1: 0.5, th1: 30, l1: 350, F2: 0.2, th2: 130, l2: 100, lB: 75, omega: 600 * 2 * Math.PI / 60, RA: 100, RB: 100 });
  near(r.B.x, 0.468, 2e-3, 'mR_Bx (kg·mm)'); near(r.B.y, 0.347, 2e-3, 'mR_By');
  near(r.B.mag, 0.583, 2e-3, 'mR_B'); near(r.B.angle, 36.55, 0.05, 'θB');
  near(r.A.x, -0.391, 2e-3, 'mR_Ax'); near(r.A.y, -0.245, 2e-3, 'mR_Ay');
  near(r.A.mag, 0.462, 2e-3, 'mR_A'); near(r.A.angle, -147.936, 0.05, 'θA');
  near(r.B.weight, 0.057, 1e-3, 'W_B (N)'); near(r.A.weight, 0.045, 1e-3, 'W_A (N)');
});

/** Course example: fourbar in metres (lengths stored in mm), masses and I_G from the slide. */
function example2() {
  const a = 1.0, b = 2.06, c = 2.33, d = 2.22, th2 = 60 / 57.29577951308232;
  const sol = fourbarPosition(a, b, c, d, th2).open;
  const M = 1000;
  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true }), O4 = addJoint(doc, d * M, 0, { ground: true });
  const A = addJoint(doc, a * M * Math.cos(th2), a * M * Math.sin(th2));
  const B = addJoint(doc, A.x + b * M * Math.cos(sol.theta3), A.y + b * M * Math.sin(sol.theta3));
  const L2 = addLink(doc, [O2.id, A.id]), L3 = addLink(doc, [A.id, B.id]), L4 = addLink(doc, [O4.id, B.id]);
  const Rpa = 3.06, d3 = -31 / 57.29577951308232;
  L2.mass = { m: 10.380, I: 0.867, local: { from: O2.id, to: A.id, x: 0.5 * a * M, y: 0 } };
  L3.mass = { m: 112.332, I: 51.05, local: { from: A.id, to: B.id, x: ((Rpa * Math.cos(d3) + b) / 3) * M, y: ((Rpa * Math.sin(d3)) / 3) * M } };
  L4.mass = { m: 24.185, I: 10.947, local: { from: O4.id, to: B.id, x: 0.5 * c * M, y: 0 } };
  setDriverSpec(doc, { type: 'rotary', link: L2.id, pivot: O2.id, ref: null });
  doc.motion.omega = 40; doc.motion.alpha = 0;
  doc.dynamics = { mode: 'dynamic', gravity: false, g: 9.81 };
  return { doc, L2, L4 };
}

test('Example 2: exact force balance of a fourbar', () => {
  const { doc, L2, L4 } = example2();
  const s = new Simulation(); s.reset(doc);
  const k = s.info.kind;
  assert.equal(k.type, 'fourbar');
  const bal = fourbarForceBalance(doc, k);
  // kg·mm → kg·m
  near(bal.crank.total.x / 1000, -27.2117, 2e-3, 'mb2x'); near(bal.crank.total.y / 1000, -28.6467, 2e-3, 'mb2y');
  near(bal.rocker.total.x / 1000, -198.3298, 2e-2, 'mb4x'); near(bal.rocker.total.y / 1000, 66.7469, 2e-2, 'mb4y');
  near(bal.crank.add.mag / 1000, 43.25, 1e-2, 'mR2'); near(bal.crank.add.angle, -138.520, 0.01, 'θb2');
  near(bal.rocker.add.mag / 1000, 236.14, 2e-2, 'mR4'); near(bal.rocker.add.angle, 163.581, 0.01, 'θb4');
  show('Example 2', bal.crank.add.mag / 1000, bal.crank.add.angle, bal.rocker.add.mag / 1000, bal.rocker.add.angle);

  // peak input torque before balancing. The slide quotes 464.9 kN·m from the
  // textbook's program, whose moments of inertia are not given; with the I_G
  // on the slide this is 434 kN·m (the force analysis itself is checked in
  // cycle.test.js), so only print it here.
  const sw = s.getSweep();
  let peakBefore = 0;
  for (const smp of sw.samples) { const r = analyseForces(s, smp); if (r) peakBefore = Math.max(peakBefore, Math.abs(r.input.torque)); }

  // add the counterweights (at a radius equal to each link's length) and check
  // that the shaking force vanishes over the whole turn
  L2.counterweights = [{ id: 'cw2', ...counterweightFor(bal.crank.add, bal.crank.from, bal.crank.to, bal.crank.length) }];
  L4.counterweights = [{ id: 'cw4', ...counterweightFor(bal.rocker.add, bal.rocker.from, bal.rocker.to, bal.rocker.length) }];
  const s2 = new Simulation(); s2.reset(doc);
  let worst = 0, peakAfter = 0, before = 0;
  for (const smp of s2.getSweep().samples) {
    const r = analyseForces(s2, smp);
    if (!r) continue;
    worst = Math.max(worst, Math.hypot(r.shaking.F.x, r.shaking.F.y));
    peakAfter = Math.max(peakAfter, Math.abs(r.input.torque));
  }
  for (const smp of sw.samples) { const r = analyseForces(s, smp); if (r) before = Math.max(before, Math.hypot(r.shaking.F.x, r.shaking.F.y)); }
  assert.ok(worst < 1e-6 * before, `shaking force after balancing ${worst} N (before ${before} N)`);
  show(`shaking force: before ${before.toFixed(0)} N, after ${worst.toExponential(1)} N; peak torque ${(peakBefore / 1000).toFixed(1)} → ${(peakAfter / 1000).toFixed(1)} kN·m`);
});

test('rotor examples: car wheel (one plane) and a statically balanced shaft (two planes)', () => {
  // car wheel: three heavy spots; the correction cancels Σ m·R
  const wheel = [{ m: 0.024, R: 300, angle: 30 }, { m: 0.006, R: 200, angle: 160 }, { m: 0.010, R: 190, angle: 255 }];
  const u = rotorUnbalance(wheel), c = rotorStatic(wheel);
  assert.ok(Math.abs(u.force.mag - 5.1028) < 1e-3 && Math.abs(u.force.angle - 25.23) < 0.01);
  assert.equal(u.moment, null, 'no distances, no moment');
  assert.ok(Math.abs(c.mag - u.force.mag) < 1e-12 && Math.abs((((c.angle - u.force.angle) % 360) + 360) % 360 - 180) < 1e-9);
  const w = (830 * 2 * Math.PI) / 60;
  assert.ok(Math.abs((u.force.mag / 1000) * w * w - 38.55) < 0.01, 'shaking force at 830 rpm (N)');
  // shaft: equal m·R 120° apart → Σ m·R = 0, but a couple; equal and opposite corrections
  const shaft = [{ m: 0.20, R: 60, angle: 0, l: 100 }, { m: 0.15, R: 80, angle: 120, l: 250 }, { m: 0.24, R: 50, angle: 240, l: 400 }];
  const v = rotorUnbalance(shaft), d = rotorDynamic(shaft, 500);
  assert.ok(v.force.mag < 1e-12);
  assert.ok(Math.abs(v.moment.mag - 3117.69) < 0.01 && Math.abs(((v.moment.angle + 360) % 360) - 210) < 1e-9);
  assert.ok(Math.abs(d.A.mag - 6.2354) < 1e-4 && Math.abs(d.B.mag - 6.2354) < 1e-4);
  assert.ok(Math.abs(((d.A.angle + 360) % 360) - 210) < 1e-9 && Math.abs(((d.B.angle + 360) % 360) - 30) < 1e-9);
});
