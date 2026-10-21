// =============================================================================
// Kinematics tests: the general solver must agree with Norton's closed-form
// equations, and velocities/accelerations must agree with finite differences.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFourbar, makeSliderCrank } from './helpers.js';
import {
  buildSystem, designCoordinates, solvePosition, stepInput, analyzePose, poseResults,
  numericDOF, gruebler, classify, sweep,
  fourbarPosition, fourbarVelocity, fourbarAcceleration, transmissionAngle, grashof, toggleAngles,
  sliderCrankPosition, sliderCrankVelocity, sliderCrankAcceleration,
} from '../src/kinematics/index.js';
import { createDocument, addJoint, addLink, setDriver } from '../src/model/document.js';
import { wrapPi } from '../../../packages/core-math/src/index.js';

const DEG = Math.PI / 180;
const angClose = (a, b, tol, msg) => assert.ok(Math.abs(wrapPi(a - b)) < tol, `${msg}: ${a} vs ${b}`);
const relClose = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

/** Drive the general solver to local input angle th (θ1 = 0 cases). */
function solverAt(doc, th, assembly) {
  const sys = buildSystem(doc);
  let q = designCoordinates(sys);
  let theta = sys.driver.thetaDesign;
  // step from the design angle to the requested angle (keeps the branch)
  const r = stepInput(sys, q, theta, wrapPi(th - theta));
  assert.ok(r.ok, `could not reach θ2 = ${th / DEG}° (${assembly})`);
  return { sys, q: r.q, theta: r.theta };
}

const FOURBARS = [
  { name: 'crank-rocker', a: 40, b: 120, c: 80, d: 100 },
  { name: 'double-crank', a: 70, b: 90, c: 80, d: 30 },
  { name: 'tilted ground', a: 2, b: 7, c: 9, d: 6, theta1: 25 * DEG },
];

for (const fb of FOURBARS) {
  for (const assembly of ['open', 'crossed']) {
    test(`fourbar ${fb.name} (${assembly}): solver = closed form over a full turn`, () => {
      const { doc } = makeFourbar({ ...fb, theta2: 30 * DEG, assembly });
      const omega2 = 10, alpha2 = 5;
      const sys = buildSystem(doc);
      let q = designCoordinates(sys);
      let theta = sys.driver.thetaDesign;
      const t1 = fb.theta1 || 0;
      for (let k = 0; k < 36; k++) {
        const r = stepInput(sys, q, theta, 10 * DEG);
        assert.ok(r.ok, 'step failed');
        q = r.q; theta = r.theta;
        const th2 = theta - t1; // local input angle
        const cf = fourbarPosition(fb.a, fb.b, fb.c, fb.d, th2)[assembly];
        const { qd, qdd } = analyzePose(sys, q, theta, omega2, alpha2);
        const res = poseResults(sys, doc, q, qd, qdd);
        const L3 = res.links.get(doc.links[1].id), L4 = res.links.get(doc.links[2].id);
        // link 4's reference line runs O4 → B, which is Norton's θ4
        angClose(L3.theta - t1, cf.theta3, 1e-8, 'θ3');
        angClose(L4.theta - t1, cf.theta4, 1e-8, 'θ4');
        const v = fourbarVelocity(fb.a, fb.b, fb.c, th2, cf.theta3, cf.theta4, omega2);
        relClose(L3.omega, v.omega3, 1e-7, 'ω3');
        relClose(L4.omega, v.omega4, 1e-7, 'ω4');
        const acc = fourbarAcceleration(fb.a, fb.b, fb.c, th2, cf.theta3, cf.theta4, omega2, v.omega3, v.omega4, alpha2);
        relClose(L3.alpha, acc.alpha3, 1e-6, 'α3');
        relClose(L4.alpha, acc.alpha4, 1e-6, 'α4');
      }
    });
  }
}

test('velocity and acceleration agree with finite differences (coupler point)', () => {
  const { doc } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: 50 * DEG });
  // add a coupler point to link 3 (makes it a ternary plate)
  const P = addJoint(doc, 60, 90);
  doc.links[1].joints.push(P.id);
  const sys = buildSystem(doc);
  const omega = 3;
  const q0 = designCoordinates(sys);
  const th0 = sys.driver.thetaDesign;
  const h = 1e-4;
  const pose = (dth) => {
    const r = stepInput(sys, q0, th0, dth);
    return poseResults(sys, doc, r.q).joints.get(P.id).pos;
  };
  const pm = pose(-h), p0 = pose(0), pp = pose(h);
  const { qd, qdd } = analyzePose(sys, q0, th0, omega, 0);
  const res = poseResults(sys, doc, q0, qd, qdd).joints.get(P.id);
  // dP/dt = dP/dθ · ω ;  d²P/dt² = d²P/dθ² · ω² (constant ω)
  relClose(res.vel.x, ((pp.x - pm.x) / (2 * h)) * omega, 1e-5, 'Vx');
  relClose(res.vel.y, ((pp.y - pm.y) / (2 * h)) * omega, 1e-5, 'Vy');
  relClose(res.acc.x, ((pp.x - 2 * p0.x + pm.x) / (h * h)) * omega * omega, 1e-3, 'Ax');
  relClose(res.acc.y, ((pp.y - 2 * p0.y + pm.y) / (h * h)) * omega * omega, 1e-3, 'Ay');
});

for (const assembly of ['open', 'crossed']) {
  test(`offset slider-crank (${assembly}): solver = closed form`, () => {
    const a = 40, b = 120, c = 15, omega2 = 12, alpha2 = -3;
    const { doc } = makeSliderCrank({ a, b, c, theta2: 20 * DEG, assembly });
    const sys = buildSystem(doc);
    let q = designCoordinates(sys), theta = sys.driver.thetaDesign;
    for (let k = 0; k < 36; k++) {
      const r = stepInput(sys, q, theta, 10 * DEG);
      assert.ok(r.ok);
      q = r.q; theta = r.theta;
      const cf = sliderCrankPosition(a, b, c, theta)[assembly];
      const { qd, qdd } = analyzePose(sys, q, theta, omega2, alpha2);
      const res = poseResults(sys, doc, q, qd, qdd);
      const L3 = res.links.get(doc.links[1].id);
      const B = res.joints.get(doc.sliders[0].joint);
      angClose(L3.theta, cf.theta3 + Math.PI, 1e-8, 'θ3'); // drawn A→B, Norton uses B→A
      relClose(B.pos.x, cf.d, 1e-9, 'd');
      const v = sliderCrankVelocity(a, b, theta, cf.theta3, omega2);
      relClose(L3.omega, v.omega3, 1e-7, 'ω3');
      relClose(B.vel.x, v.vd, 1e-7, 'ḋ');
      const acc = sliderCrankAcceleration(a, b, theta, cf.theta3, omega2, v.omega3, alpha2);
      relClose(L3.alpha, acc.alpha3, 1e-6, 'α3');
      // d̈ passes through zero, so compare against the natural scale a·ω²
      assert.ok(Math.abs(B.acc.x - acc.ad) < 1e-8 * a * omega2 * omega2, `d̈: ${B.acc.x} vs ${acc.ad}`);
    }
  });
}

test('Gruebler count and numeric DOF', () => {
  const { doc } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: 30 * DEG });
  assert.equal(gruebler(doc).M, 1);
  const sys = buildSystem(doc);
  assert.equal(numericDOF(sys, designCoordinates(sys)), 1);

  const sc = makeSliderCrank({ a: 40, b: 120, c: 0, theta2: 30 * DEG }).doc;
  assert.equal(gruebler(sc).M, 1);

  // fivebar: two inputs needed
  const five = createDocument();
  const g1 = addJoint(five, 0, 0, { ground: true }), g2 = addJoint(five, 100, 0, { ground: true });
  const p1 = addJoint(five, 0, 40), p2 = addJoint(five, 50, 80), p3 = addJoint(five, 100, 40);
  addLink(five, [g1.id, p1.id]); addLink(five, [p1.id, p2.id]); addLink(five, [p2.id, p3.id]); addLink(five, [p3.id, g2.id]);
  assert.equal(gruebler(five).M, 2);
  const s5 = buildSystem(five);
  assert.equal(numericDOF(s5, designCoordinates(s5)), 2);

  // triangle of links pinned to ground: a structure (DOF 0)
  const tri = createDocument();
  const t1 = addJoint(tri, 0, 0, { ground: true }), t2 = addJoint(tri, 100, 0, { ground: true });
  const t3 = addJoint(tri, 50, 50);
  addLink(tri, [t1.id, t3.id]); addLink(tri, [t2.id, t3.id]);
  assert.equal(gruebler(tri).M, 0);
});

test('parallelogram with redundant link: Gruebler says 0, real DOF is 1', () => {
  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true }), O4 = addJoint(doc, 100, 0, { ground: true });
  const O6 = addJoint(doc, 50, 0, { ground: true });
  const A = addJoint(doc, 0, 60), B = addJoint(doc, 100, 60), C = addJoint(doc, 50, 60);
  addLink(doc, [O2.id, A.id]);
  addLink(doc, [A.id, C.id, B.id]);
  addLink(doc, [O4.id, B.id]);
  addLink(doc, [O6.id, C.id]);
  assert.equal(gruebler(doc).M, 0);
  const sys = buildSystem(doc);
  assert.equal(numericDOF(sys, designCoordinates(sys)), 1);
  // and it still moves
  const r = stepInput(sys, designCoordinates(sys), sys.driver.thetaDesign, -30 * DEG);
  assert.ok(r.ok);
});

test('non-Grashof input stops at its toggle positions', () => {
  const a = 100, b = 60, c = 70, d = 80; // S+L = 160 > P+Q = 150
  assert.equal(grashof({ a, b, c, d }).condition, 'non-grashof');
  const { doc } = makeFourbar({ a, b, c, d, theta2: 90 * DEG });
  const sys = buildSystem(doc);
  const s = sweep(sys, doc, designCoordinates(sys), sys.driver.thetaDesign, 1, 0, 2);
  assert.equal(s.fullTurn, false);
  const toggles = toggleAngles(a, b, c, d).map(wrapPi);
  for (const lim of s.limits) {
    const nearest = Math.min(...toggles.map((t) => Math.abs(wrapPi(lim - t))));
    assert.ok(nearest < 0.5 * DEG, `limit ${lim / DEG}° not near a toggle angle`);
  }
});

test('Grashof classification', () => {
  assert.match(grashof({ a: 40, b: 120, c: 80, d: 100 }).type, /crank-rocker/);
  assert.match(grashof({ a: 70, b: 90, c: 80, d: 30 }).type, /double-crank/);
  assert.match(grashof({ a: 80, b: 30, c: 90, d: 100 }).type, /double-rocker/);
  assert.equal(grashof({ a: 40, b: 100, c: 40, d: 100 }).condition, 'special');
});

test('transmission angle folds into 0–90°', () => {
  assert.ok(Math.abs(transmissionAngle(10 * DEG, 100 * DEG) - 90 * DEG) < 1e-12);
  assert.ok(Math.abs(transmissionAngle(0, 150 * DEG) - 30 * DEG) < 1e-12);
});

test('classify recognises fourbar and slider-crank', () => {
  const fb = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: 30 * DEG, theta1: 10 * DEG }).doc;
  const k = classify(fb);
  assert.equal(k.type, 'fourbar');
  relClose(k.a, 40, 1e-9, 'a'); relClose(k.b, 120, 1e-9, 'b'); relClose(k.c, 80, 1e-9, 'c'); relClose(k.d, 100, 1e-9, 'd');
  relClose(k.theta1, 10 * DEG, 1e-9, 'θ1');
  const sc = classify(makeSliderCrank({ a: 40, b: 120, c: 15, theta2: 30 * DEG }).doc);
  assert.equal(sc.type, 'slider-crank');
  relClose(sc.c, 15, 1e-9, 'offset');
});

test('changing the input link renumbers and still solves', () => {
  const { doc } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: 30 * DEG });
  assert.ok(setDriver(doc, doc.links[2].id));
  const sys = buildSystem(doc);
  const r = solvePosition(sys, designCoordinates(sys), sys.driver.thetaDesign);
  assert.ok(r.ok);
  const s = sweep(sys, doc, r.q, sys.driver.thetaDesign, 1, 0, 2);
  assert.equal(s.fullTurn, false); // the rocker cannot turn fully
});
