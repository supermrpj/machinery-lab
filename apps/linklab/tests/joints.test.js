// =============================================================================
// Joint-type tests: prismatic, pin-in-slot on a moving link, rolling (gears,
// planetary, rack and pinion), rolling with slip (eccentric cam). Each result
// is checked against a known answer and against finite differences.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, addLink, addWheel, addPair, addSlider } from '../src/model/document.js';
import { addConstruction } from '../src/model/construction.js';
import {
  buildSystem, designCoordinates, solvePosition, stepInput, analyzePose, poseResults, numericDOF, gruebler,
} from '../src/kinematics/index.js';

const DEG = Math.PI / 180;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

/** Solve the drawn pose, then step to `deg` degrees past the design angle. */
function at(doc, deg, omega = 1, alpha = 0) {
  const sys = buildSystem(doc);
  const r0 = solvePosition(sys, designCoordinates(sys), sys.driver.thetaDesign);
  assert.ok(r0.ok, 'design pose does not assemble');
  const r = deg ? stepInput(sys, r0.q, sys.driver.thetaDesign, deg * DEG) : { ok: true, q: r0.q, theta: sys.driver.thetaDesign };
  assert.ok(r.ok, `could not reach +${deg}°`);
  const { qd, qdd } = analyzePose(sys, r.q, r.theta, omega, alpha);
  assert.ok(qd && qdd, 'velocity/acceleration not defined');
  return { sys, q: r.q, theta: r.theta, res: poseResults(sys, doc, r.q, qd, qdd), qd, qdd };
}

/** Finite-difference check of every link's ω and α (ω_in = 1, α_in = 0). */
function fdCheck(doc, deg) {
  const h = 1e-4;
  const m = at(doc, deg - h / DEG), p = at(doc, deg + h / DEG), c = at(doc, deg);
  for (const l of doc.links) {
    const tm = m.res.links.get(l.id).theta, tp = p.res.links.get(l.id).theta, tc = c.res.links.get(l.id).theta;
    const L = c.res.links.get(l.id);
    close(L.omega, (tp - tm) / (2 * h), 1e-5, `ω of ${l.id}`);
    close(L.alpha, (tp - 2 * tc + tm) / (h * h), 2e-3, `α of ${l.id}`);
  }
  for (const j of doc.joints) {
    const pm = m.res.joints.get(j.id).pos, pp = p.res.joints.get(j.id).pos, pc = c.res.joints.get(j.id).pos;
    const R = c.res.joints.get(j.id);
    close(R.vel.x, (pp.x - pm.x) / (2 * h), 1e-5, `Vx of ${j.id}`);
    close(R.vel.y, (pp.y - pm.y) / (2 * h), 1e-5, `Vy of ${j.id}`);
    close(R.acc.x, (pp.x - 2 * pc.x + pm.x) / (h * h), 2e-3, `Ax of ${j.id}`);
    close(R.acc.y, (pp.y - 2 * pc.y + pm.y) / (h * h), 2e-3, `Ay of ${j.id}`);
  }
}

// ---- builders ----------------------------------------------------------------------

function gearPair() {
  const doc = createDocument();
  const O1 = addJoint(doc, 0, 0, { ground: true }), O2 = addJoint(doc, 75, 0, { ground: true });
  const g1 = addWheel(doc, O1.id, 30), g2 = addWheel(doc, O2.id, 45);
  addPair(doc, { type: 'roll', a: { kind: 'disc', link: g1.id }, b: { kind: 'disc', link: g2.id } });
  return { doc, g1, g2 };
}

/** Planet on a carrier, rolling on a fixed circle (sun outside, or ring inside). */
function planetary({ fixedR, carrier, planetR }) {
  const doc = createDocument();
  const O = addJoint(doc, 0, 0, { ground: true });
  const P = addJoint(doc, carrier, 0);
  const arm = addLink(doc, [O.id, P.id]);
  const planet = addWheel(doc, P.id, planetR);
  const fixed = addConstruction(doc, 'circle', { c: { x: 0, y: 0 }, r: fixedR }, null);
  addPair(doc, { type: 'roll', a: { kind: 'disc', link: planet.id }, b: { kind: 'entity', id: fixed.id } });
  return { doc, arm, planet };
}

function rackAndPinion() {
  const doc = createDocument();
  const O = addJoint(doc, 0, 0, { ground: true });
  const pinion = addWheel(doc, O.id, 20);
  const R1 = addJoint(doc, -60, 20), R2 = addJoint(doc, 60, 20);
  const rack = addLink(doc, [R1.id, R2.id]);
  addPair(doc, { type: 'prismatic', guide: null, slider: rack.id, a: { x: -60, y: 20 }, b: { x: 60, y: 20 } });
  addPair(doc, { type: 'roll', a: { kind: 'disc', link: pinion.id }, b: { kind: 'linkline', link: rack.id } });
  return { doc, pinion, rack, R1 };
}

function eccentricCam() {
  // cam: pivot O, disc centre C at eccentricity e; flat-faced follower slides vertically
  const e = 10, r = 30;
  const doc = createDocument();
  const O = addJoint(doc, 0, 0, { ground: true });
  const C = addJoint(doc, e, 0);
  const cam = addLink(doc, [O.id, C.id]);
  const disc = addConstruction(doc, 'circle', { c: { x: e, y: 0 }, r }, cam.id);
  const F1 = addJoint(doc, -30, r), F2 = addJoint(doc, 30, r);
  const follower = addLink(doc, [F1.id, F2.id]);
  addPair(doc, { type: 'prismatic', guide: null, slider: follower.id, a: { x: 0, y: r }, b: { x: 0, y: r + 50 } });
  addPair(doc, { type: 'rollslide', a: { kind: 'entity', id: disc.id }, b: { kind: 'linkline', link: follower.id } });
  return { doc, e, r, follower, F1 };
}

function invertedSliderCrank() {
  // crank O2A; link 3 passes through a swivelling block pinned at ground O4
  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true });
  const O4 = addJoint(doc, 100, 0, { ground: true });
  const A = addJoint(doc, 40 * Math.cos(1), 40 * Math.sin(1));
  const dx = 100 - A.x, dy = -A.y, L = Math.hypot(dx, dy);
  const E = addJoint(doc, A.x + (dx / L) * 160, A.y + (dy / L) * 160);
  addLink(doc, [O2.id, A.id]);
  const l3 = addLink(doc, [A.id, E.id]);
  addSlider(doc, O4.id, { x: A.x, y: A.y }, { x: E.x, y: E.y }, l3.id);
  return { doc, O4, A, E, l3 };
}

// ---- tests ---------------------------------------------------------------------------

test('gear pair (pure rolling): ω ratio = −r1/r2; Gruebler 0 but real DOF 1', () => {
  const { doc, g1, g2 } = gearPair();
  const g = gruebler(doc);
  assert.equal(g.M, 0);   // L = 3, J1 = 2 pins + 1 roll
  const sys = buildSystem(doc);
  assert.equal(numericDOF(sys, designCoordinates(sys)), 1); // the contact row is redundant
  const s = at(doc, 70, 6);
  close(s.res.links.get(g2.id).omega, -6 * 30 / 45, 1e-9, 'ω gear 2');
  close(s.res.links.get(g2.id).phi, -70 * DEG * 30 / 45, 1e-9, 'turned angle');
  close(s.res.links.get(g1.id).omega, 6, 1e-12, 'ω gear 1');
});

test('planet rolling on a fixed sun: ω_planet = ω_arm (1 + R_sun/r_planet), through a full turn', () => {
  const { doc, arm, planet } = planetary({ fixedR: 40, carrier: 60, planetR: 20 });
  const s = at(doc, 350, 2);  // nearly a full turn: the contact angle must stay continuous
  close(s.res.links.get(planet.id).omega, 2 * (1 + 40 / 20), 1e-9, 'ω planet');
  close(s.res.links.get(planet.id).phi, 350 * DEG * 3, 1e-8, 'planet turned');
  close(s.res.links.get(arm.id).omega, 2, 1e-12, 'ω arm');
  fdCheck(doc, 125);
});

test('planet rolling inside a fixed ring: ω_planet = ω_arm (1 − R_ring/r_planet)', () => {
  const { doc, planet } = planetary({ fixedR: 60, carrier: 40, planetR: 20 });
  const s = at(doc, 200, 1);
  close(s.res.links.get(planet.id).omega, 1 - 60 / 20, 1e-9, 'ω planet');
  fdCheck(doc, 33);
});

test('rack and pinion: rack speed = −r ω; numeric DOF 1', () => {
  const { doc, rack, R1 } = rackAndPinion();
  const sys = buildSystem(doc);
  assert.equal(numericDOF(sys, designCoordinates(sys)), 1);
  const s = at(doc, 45, 3);
  close(s.res.joints.get(R1.id).vel.x, -20 * 3, 1e-9, 'rack velocity');
  close(s.res.joints.get(R1.id).pos.x, -60 - 20 * 45 * DEG, 1e-9, 'rack moved');
  close(s.res.links.get(rack.id).omega, 0, 1e-12, 'rack does not rotate');
  fdCheck(doc, 10);
});

test('eccentric cam with flat follower (roll + slip): y = r + e sinθ, harmonic motion', () => {
  const { doc, e, r, F1 } = eccentricCam();
  const g = gruebler(doc);
  assert.equal(g.J2, 1);
  assert.equal(g.M, 1);
  for (const deg of [20, 75, 160, 250, 330]) {
    const s = at(doc, deg, 4, 0);
    const th = s.theta;
    const J = s.res.joints.get(F1.id);
    close(J.pos.y, r + e * Math.sin(th), 1e-9, `follower y at ${deg}°`);
    close(J.vel.y, e * 4 * Math.cos(th), 1e-8, `follower velocity at ${deg}°`);
    close(J.acc.y, -e * 16 * Math.sin(th), 1e-7, `follower acceleration at ${deg}°`);
  }
  fdCheck(doc, 47);
});

test('inverted slider-crank: ground pin stays on the moving link; derivatives consistent', () => {
  const { doc, O4, A, E, l3 } = invertedSliderCrank();
  assert.equal(gruebler(doc).M, 1);
  for (const deg of [30, 90, 180, 300]) {
    const s = at(doc, deg);
    const a = s.res.joints.get(A.id).pos, e = s.res.joints.get(E.id).pos;
    const dist = Math.abs((e.x - a.x) * (0 - a.y) - (e.y - a.y) * (100 - a.x)) / Math.hypot(e.x - a.x, e.y - a.y);
    assert.ok(dist < 1e-9, `O4 is ${dist} mm off link 3 at ${deg}°`);
  }
  fdCheck(doc, 140);
  void O4; void l3;
});

test('wheel rolling on the ground, carried by a slider-crank: ω_wheel = −v/r', () => {
  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true });
  const A = addJoint(doc, 30, 30);
  const W = addJoint(doc, 140, 20);
  addLink(doc, [O2.id, A.id]);
  addLink(doc, [A.id, W.id]);
  addSlider(doc, W.id, { x: -100, y: 20 }, { x: 300, y: 20 });
  const wheel = addWheel(doc, W.id, 20);
  const floor = addConstruction(doc, 'xline', { a: { x: -100, y: 0 }, b: { x: 300, y: 0 } }, null);
  addPair(doc, { type: 'roll', a: { kind: 'disc', link: wheel.id }, b: { kind: 'entity', id: floor.id } });
  const s = at(doc, 60, 5);
  const v = s.res.joints.get(W.id).vel.x;
  close(s.res.links.get(wheel.id).omega, -v / 20, 1e-9, 'ω wheel');
  fdCheck(doc, 100);
});
