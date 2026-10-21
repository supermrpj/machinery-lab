// =============================================================================
// A fourbar drawn with its ground link ("link 1" of the textbook figure, drawn
// as a link between the two ground pivots), and one driven at a floating joint:
// the frame link is held still by the ground, the drawing is still a fourbar,
// the pin play is the same, and the exact force balance still applies.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addLink, setDriverSpec, isFrameLink, movingLinks } from '../src/model/document.js';
import { Simulation } from '../src/model/simulation.js';
import { fourbarLoop, classify } from '../src/kinematics/classify.js';
import { buildSystem } from '../src/kinematics/system.js';
import { cycleStudy, pointOn, worstAtPose } from '../src/model/tolerance.js';
import { fourbarForceBalance, counterweightFor, totalCentreOfMass } from '../src/model/balance.js';
import { analyseForces, bodyMasses } from '../src/model/forces.js';
import { makeFourbar } from './helpers.js';

const near = (got, want, tol, msg) => assert.ok(Math.abs(got - want) <= tol, `${msg}: ${got} vs ${want}`);

/** The lesson-1 crank-rocker, with or without its ground link drawn, driven at O2 or at joint A. */
function fourbar({ groundLink = false, motorAt = 'O2' } = {}) {
  const { doc, O2, O4, A, B } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: Math.PI / 3 });
  const [L2, L3, L4] = doc.links;
  const L1 = groundLink ? addLink(doc, [O2.id, O4.id]) : null;
  if (motorAt === 'O2') setDriverSpec(doc, { type: 'rotary', link: L2.id, pivot: O2.id, ref: null });
  else setDriverSpec(doc, { type: 'rotary', link: L3.id, pivot: A.id, ref: L2.id }); // motor at A, turning the coupler against the crank
  doc.motion.omega = 10; doc.motion.alpha = 0;
  doc.dynamics = { mode: 'dynamic', gravity: false, g: 9.81 };
  const sim = new Simulation(); sim.reset(doc);
  return { doc, sim, O2, O4, A, B, L1, L2, L3, L4 };
}

test('a link between two ground pivots is a frame link: pinned to the ground, not to the cranks', () => {
  const { doc, sim, L1, O2, O4 } = fourbar({ groundLink: true });
  assert.ok(isFrameLink(doc, L1));
  assert.equal(movingLinks(doc).length, 3);
  const sys = buildSystem(doc);
  const i1 = sys.bodyIndex.get(L1.id);
  assert.ok(sys.frame.has(i1), 'recorded as frame');
  const mine = sys.pins.filter((p) => p.i === i1 || p.j === i1);
  assert.deepEqual(mine.map((p) => [p.joint, p.j]).sort(), [[O2.id, -1], [O4.id, -1]].sort(), 'its pins go to the ground');
  assert.ok(sim.drivable && sim.info.dof === 1, 'still one degree of freedom');
  // it does not move over the cycle
  for (const smp of sim.getSweep().samples) {
    near(smp.q[3 * i1 + 2], 0, 1e-9, 'frame link angle');
  }
});

test('the drawing is still a fourbar, with the same pin play', () => {
  const plain = fourbar(), drawn = fourbar({ groundLink: true });
  assert.equal(drawn.sim.info.kind.type, 'fourbar');
  assert.equal(classify(drawn.doc).links.coupler, drawn.L3.id);
  // play at the drawn pose, in the same direction: identical
  const c = 0.2;
  const w0 = pointOn(plain.sim.sys, plain.B.id), w1 = pointOn(drawn.sim.sys, drawn.B.id);
  const q0 = plain.sim.q, q1 = drawn.sim.q;
  const r0 = worstAtPose(plain.sim.sys, q0, plain.sim.theta, w0, c, 0);
  const r1 = worstAtPose(drawn.sim.sys, q1, drawn.sim.theta, w1, c, 0);
  near(r1.total, r0.total, 1e-9 * r0.total, 'worst case');
  assert.equal(r1.parts.length, r0.parts.length, 'the frame link adds no pins to the study');
  // and over the cycle: the largest play is found at the same input angle
  const s0 = cycleStudy(plain.sim, { clearance: c, holePosition: 0, target: plain.B.id });
  const s1 = cycleStudy(drawn.sim, { clearance: c, holePosition: 0, target: drawn.B.id });
  assert.ok(s0 && s1 && Number.isFinite(s1.play[s1.maxK]), 'an answer, not a dead centre');
  near(s1.samples[s1.maxK].theta, s0.samples[s0.maxK].theta, 0.02, 'largest play at the same angle');
  near(s1.play[s1.maxK], s0.play[s0.maxK], 0.03 * s0.play[s0.maxK], 'largest play');
});

test('driven at a floating joint: not a textbook fourbar for the closed forms, but the same loop for balancing', () => {
  const { doc, sim, L2, L3, L4, O2, O4 } = fourbar({ groundLink: true, motorAt: 'A' });
  assert.equal(sim.info.kind.type, 'general');
  const loop = fourbarLoop(doc, L2.id);
  assert.ok(loop && loop.type === 'fourbar');
  assert.deepEqual(loop.links, { input: L2.id, coupler: L3.id, output: L4.id });
  assert.equal(loop.O2.id, O2.id); assert.equal(loop.O4.id, O4.id);
  // starting from the other crank just swaps the names
  const other = fourbarLoop(doc, L4.id);
  assert.deepEqual(other.links, { input: L4.id, coupler: L3.id, output: L2.id });
});

test('exact force balance holds with the ground link drawn and the motor at a floating joint', () => {
  for (const motorAt of ['O2', 'A']) {
    const { doc, sim, L2, L4 } = fourbar({ groundLink: true, motorAt });
    const loop = fourbarLoop(doc, L2.id);
    const bal = fourbarForceBalance(doc, loop);
    const before = Math.max(...sim.getSweep().samples.map((smp) => { const r = analyseForces(sim, smp); return r ? Math.hypot(r.shaking.F.x, r.shaking.F.y) : 0; }));
    L2.counterweights = [{ id: 'cw2', ...counterweightFor(bal.crank.add, bal.crank.from, bal.crank.to, bal.crank.length) }];
    L4.counterweights = [{ id: 'cw4', ...counterweightFor(bal.rocker.add, bal.rocker.from, bal.rocker.to, bal.rocker.length) }];
    const s2 = new Simulation(); s2.reset(doc);
    const masses = bodyMasses(s2);
    let after = 0, cm0 = null, moved = 0;
    for (const smp of s2.getSweep().samples) {
      const r = analyseForces(s2, smp);
      if (r) after = Math.max(after, Math.hypot(r.shaking.F.x, r.shaking.F.y));
      const cm = totalCentreOfMass(s2, masses, smp.q);
      if (!cm0) cm0 = cm; else moved = Math.max(moved, Math.hypot(cm.x - cm0.x, cm.y - cm0.y));
    }
    assert.ok(before > 0, `motor at ${motorAt}: unbalanced before`);
    assert.ok(after < 1e-6 * before, `motor at ${motorAt}: shaking force after ${after} N (before ${before} N)`);
    assert.ok(moved < 1e-6, `motor at ${motorAt}: the moving centre of mass stays still (${moved} mm)`);
  }
});
