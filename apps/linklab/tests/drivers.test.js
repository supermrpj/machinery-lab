// =============================================================================
// Input (driver) tests: motor between two links, linear actuator, pushing a
// slider, pushing a prismatic joint, and an actuator held at fixed length.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, addLink, addWheel, addPair, addSlider, addActuator, setDriverSpec } from '../src/model/document.js';
import { buildSystem, designCoordinates, solvePosition, stepInput, analyzePose, poseResults, sweep, fourbarPosition, numericDOF } from '../src/kinematics/index.js';
import { makeFourbar, makeSliderCrank } from './helpers.js';
import { wrapPi } from '../../../packages/core-math/src/index.js';

const DEG = Math.PI / 180;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

function start(doc) {
  const sys = buildSystem(doc);
  assert.ok(sys.driver, 'no input');
  const r = solvePosition(sys, designCoordinates(sys), sys.driver.thetaDesign);
  assert.ok(r.ok, 'does not assemble');
  return { sys, q: r.q, th: sys.driver.thetaDesign };
}

/** Finite-difference check of all joint velocities/accelerations against the input. */
function fd(doc, du) {
  const { sys, q, th } = start(doc);
  const h = du * 1e-3;
  const m = stepInput(sys, q, th, -h), p = stepInput(sys, q, th, h);
  assert.ok(m.ok && p.ok);
  const { qd, qdd } = analyzePose(sys, q, th, 1, 0);
  const R = poseResults(sys, doc, q, qd, qdd), Rm = poseResults(sys, doc, m.q), Rp = poseResults(sys, doc, p.q);
  for (const j of doc.joints) {
    const a = Rm.joints.get(j.id).pos, b = Rp.joints.get(j.id).pos, c = R.joints.get(j.id).pos, r = R.joints.get(j.id);
    close(r.vel.x, (b.x - a.x) / (2 * h), 1e-5, `Vx ${j.id}`);
    close(r.vel.y, (b.y - a.y) / (2 * h), 1e-5, `Vy ${j.id}`);
    close(r.acc.x, (b.x - 2 * c.x + a.x) / (h * h), 3e-3, `Ax ${j.id}`);
    close(r.acc.y, (b.y - 2 * c.y + a.y) / (h * h), 3e-3, `Ay ${j.id}`);
  }
}

test('motor between two links: the input is their relative angle', () => {
  const { doc, A } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: 50 * DEG });
  const [crank, coupler] = doc.links;
  assert.ok(setDriverSpec(doc, { type: 'rotary', link: coupler.id, pivot: A.id, ref: crank.id }));
  const { sys, q, th } = start(doc);
  const r = stepInput(sys, q, th, -20 * DEG);
  assert.ok(r.ok);
  const res = poseResults(sys, doc, r.q);
  const rel = res.links.get(coupler.id).theta - res.links.get(crank.id).theta;
  // the coupler's line A→B against the crank's line A→O2 (both measured from A)
  const O2 = res.joints.get(doc.joints[0].id).pos, Ap = res.joints.get(A.id).pos;
  const crankLine = Math.atan2(O2.y - Ap.y, O2.x - Ap.x);
  const couplerLine = res.links.get(coupler.id).theta;
  close(((couplerLine - crankLine) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI), ((r.theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), 1e-9, 'relative angle');
  void rel;
  fd(doc, 1);
});

test('linear actuator turning a crank: crank tip lies on both circles', () => {
  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true }), G = addJoint(doc, -80, -30, { ground: true });
  const A = addJoint(doc, 40 * Math.cos(1), 40 * Math.sin(1));
  addLink(doc, [O2.id, A.id]);
  const u = addActuator(doc, G.id, A.id);
  assert.ok(setDriverSpec(doc, { type: 'linear', actuator: u.id }));
  const { sys, q, th } = start(doc);
  assert.equal(numericDOF(sys, q), 1);
  const r = stepInput(sys, q, th, -25); // retract the cylinder by 25 mm
  assert.ok(r.ok);
  const p = poseResults(sys, doc, r.q).joints.get(A.id).pos;
  close(Math.hypot(p.x, p.y), 40, 1e-9, 'crank length');
  close(Math.hypot(p.x + 80, p.y + 30), th - 25, 1e-9, 'actuator length');
  fd(doc, 1);
  const s = sweep(sys, doc, q, th, 1, 0);
  assert.ok(s.samples.length > 50);
  assert.ok(s.limits[1] <= u.max + 1e-9 && s.limits[0] >= u.min - 1e-9);
});

test('pushing the slider of a slider-crank (engine): crank follows the closed form', () => {
  const { doc, A } = makeSliderCrank({ a: 40, b: 120, c: 0, theta2: 60 * DEG });
  assert.ok(setDriverSpec(doc, { type: 'slider', slider: doc.sliders[0].id }));
  const { sys, q, th } = start(doc);
  const r = stepInput(sys, q, th, -15);
  assert.ok(r.ok);
  const res = poseResults(sys, doc, r.q);
  const a = res.joints.get(A.id).pos;
  const t2 = Math.atan2(a.y, a.x);
  const B = res.joints.get(doc.sliders[0].joint).pos;
  // this assembly has the slider on the left of the crank pivot
  close(B.x, 40 * Math.cos(t2) - Math.sqrt(120 * 120 - (40 * Math.sin(t2)) ** 2), 1e-9, 'slider position');
  fd(doc, 1);
});

test('pushing a rack (prismatic input) turns the pinion at ω = −v/r', () => {
  const doc = createDocument();
  const O = addJoint(doc, 0, 0, { ground: true });
  const pinion = addWheel(doc, O.id, 20);
  const R1 = addJoint(doc, -60, 20), R2 = addJoint(doc, 60, 20);
  const rack = addLink(doc, [R1.id, R2.id]);
  const pr = addPair(doc, { type: 'prismatic', guide: null, slider: rack.id, a: { x: -60, y: 20 }, b: { x: 60, y: 20 } });
  addPair(doc, { type: 'roll', a: { kind: 'disc', link: pinion.id }, b: { kind: 'linkline', link: rack.id } });
  assert.ok(setDriverSpec(doc, { type: 'prismatic', pair: pr.id }));
  const { sys, q, th } = start(doc);
  const r = stepInput(sys, q, th, 15);
  assert.ok(r.ok);
  const { qd } = analyzePose(sys, r.q, r.theta, 7, 0);
  const res = poseResults(sys, doc, r.q, qd);
  close(res.links.get(pinion.id).omega, -7 / 20, 1e-9, 'ω pinion');
  close(res.links.get(pinion.id).phi, -15 / 20, 1e-9, 'pinion turned');
});

test('an actuator that is not the input holds its length like a link', () => {
  // fourbar whose coupler is a (held) actuator
  const { doc, A, B } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: 30 * DEG });
  doc.links.splice(1, 1); // remove the coupler link
  addActuator(doc, A.id, B.id);
  const { sys, q, th } = start(doc);
  for (const step of [40, 80, 120]) {
    const r = stepInput(sys, q, th, step * DEG);
    assert.ok(r.ok);
    const res = poseResults(sys, doc, r.q);
    const a = res.joints.get(A.id).pos, b = res.joints.get(B.id).pos;
    close(Math.hypot(b.x - a.x, b.y - a.y), 120, 1e-9, 'held length');
    const cf = fourbarPosition(40, 120, 80, 100, r.theta).open;
    const th4 = Math.atan2(b.y, b.x - 100);
    assert.ok(Math.abs(wrapPi(th4 - cf.theta4)) < 1e-8, `θ4 ${th4} vs closed form ${cf.theta4}`);
  }
});

test('Gruebler counts an input actuator as cylinder + rod, a held one as a link', async () => {
  const { gruebler } = await import('../src/kinematics/index.js');
  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true }), G = addJoint(doc, -80, -30, { ground: true });
  const A = addJoint(doc, 30, 20);
  addLink(doc, [O2.id, A.id]);
  const u = addActuator(doc, G.id, A.id);
  assert.equal(gruebler(doc).M, 0);       // held: a crank with a fixed strut cannot move
  setDriverSpec(doc, { type: 'linear', actuator: u.id });
  assert.equal(gruebler(doc).M, 1);       // as the input it adds its stroke
});
