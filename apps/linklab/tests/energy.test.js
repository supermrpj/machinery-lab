// Energy over the cycle: at a constant crank speed with no applied loads, the
// motor's work goes into the links' kinetic and potential energy, so
//   T₁₂ = d(KE + PE)/dθ₂.
// Also: halving the speed quarters KE and leaves PE unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setDriverSpec } from '../src/model/document.js';
import { Simulation } from '../src/model/simulation.js';
import { analyseForces } from '../src/model/forces.js';
import { makeFourbar } from './helpers.js';

function build(omega) {
  const { doc, O2, O4, A, B } = makeFourbar({ a: 50, b: 200, c: 150, d: 220, theta2: Math.PI / 3 });
  const [L2, L3, L4] = doc.links;
  L2.mass = { m: 0.1, I: 3e-5, local: { from: O2.id, to: A.id, x: 25, y: 0 } };
  L3.mass = { m: 0.4, I: 1.5e-3, local: { from: A.id, to: B.id, x: 100, y: 0 } };
  L4.mass = { m: 4.0, I: 0.02, local: { from: O4.id, to: B.id, x: 120, y: 0 } };
  setDriverSpec(doc, { type: 'rotary', link: L2.id, pivot: O2.id, ref: null });
  doc.motion.omega = omega; doc.motion.alpha = 0;
  doc.dynamics = { mode: 'dynamic', gravity: true, g: 9.81 };
  const sim = new Simulation(); sim.reset(doc);
  return sim;
}

test('motor torque is the slope of the total energy (no applied loads)', () => {
  const sim = build(25.1);
  const s = sim.getSweep();
  const r = s.samples.map((smp) => analyseForces(sim, smp));
  const E = r.map((x) => x.energy.KE + x.energy.PE);
  let worst = 0, peak = 0;
  for (let k = 1; k < s.samples.length - 1; k++) {
    const dE = (E[k + 1] - E[k - 1]) / (s.samples[k + 1].theta - s.samples[k - 1].theta);
    worst = Math.max(worst, Math.abs(dE - r[k].input.torque));
    peak = Math.max(peak, Math.abs(r[k].input.torque));
  }
  // numerical slope over uneven steps of about 1°: within a few per cent
  assert.ok(worst < 0.03 * peak, `dE/dθ vs T12: ${worst} of ${peak}`);
  // exactly, as powers: T₁₂·ω = dKE/dt + dPE/dt (gravity's power is −dPE/dt)
  for (let k = 0; k < r.length; k++) {
    const P = r[k].input.torque * 25.1, dE = r[k].energy.dKE - r[k].energy.P_applied;
    assert.ok(Math.abs(P - dE) < 1e-6 * peak * 25.1, `power balance at ${k}: ${P} vs ${dE}`);
  }
});

test('half the speed: a quarter of the kinetic energy, the same potential energy', () => {
  const fast = build(25.1), slow = build(12.55);
  const sf = fast.getSweep(), ss = slow.getSweep();
  for (const k of [10, 60, 140]) {
    const a = analyseForces(fast, sf.samples[k]), b = analyseForces(slow, ss.samples[k]);
    assert.ok(Math.abs(sf.samples[k].theta - ss.samples[k].theta) < 1e-12, 'same positions');
    assert.ok(Math.abs(b.energy.KE / a.energy.KE - 0.25) < 1e-9, 'KE × 1/4');
    assert.ok(Math.abs(b.energy.PE - a.energy.PE) < 1e-12, 'PE unchanged');
  }
});
