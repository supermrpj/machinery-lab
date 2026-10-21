// =============================================================================
// Following the path of motion: toggle positions (input limits) and
// stationary positions (output limits) against closed-form results, passing
// through toggles without chatter, and resting at them when dragging.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoDriver, addJoint, addLink, addSlider, createDocument } from '../src/model/document.js';
import { buildSystem, designCoordinates, solvePosition, sweepPath, toggleAngles, pointOnBody } from '../src/kinematics/index.js';
import { Simulation } from '../src/model/simulation.js';
import { makeFourbar } from './helpers.js';

const DEG = Math.PI / 180;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

function sim(doc) {
  autoDriver(doc);
  const s = new Simulation();
  s.reset(doc);
  return s;
}

/** Largest movement of any joint between consecutive sweep samples (mm). */
function maxJump(sw, doc) {
  let m = 0;
  for (let i = 1; i < sw.samples.length; i++) {
    for (const j of doc.joints) {
      const a = sw.samples[i - 1].results.joints.get(j.id).pos, b = sw.samples[i].results.joints.get(j.id).pos;
      m = Math.max(m, Math.hypot(b.x - a.x, b.y - a.y));
    }
  }
  return m;
}

test('triple rocker: the sweep covers the whole circuit through both toggles', () => {
  const [a, b, c, d] = [80, 60, 70, 100];
  const { doc } = makeFourbar({ a, b, c, d, theta2: 80 * DEG });
  const s = sim(doc);
  assert.ok(s.path, 'one path to follow');
  const sw = s.getSweep();
  assert.ok(sw.closed && !sw.fullTurn, 'closed circuit, input does not turn fully');
  const toggles = sw.specials.filter((x) => x.kind === 'toggle').map((x) => x.theta).sort((p, q) => p - q);
  const t = toggleAngles(a, b, c, d);
  assert.equal(toggles.length, 2);
  close(toggles[1], Math.max(...Object.values(t).filter(Number.isFinite)), 1e-6, 'upper toggle');
  close(toggles[0], Math.min(...Object.values(t).filter(Number.isFinite)), 1e-6, 'lower toggle');
  // smooth: no joint jumps more than a few mm between samples
  assert.ok(maxJump(sw, doc) < 3, `jump ${maxJump(sw, doc)}`);
  // both assemblies are visited: at the same input angle B is found on both sides of the line O2–A
  const B = doc.joints[3].id, A = doc.joints[2].id;
  const sides = new Set(sw.samples.filter((x) => Math.abs(x.theta) < 2 * DEG).map((x) => {
    const pa = x.results.joints.get(A).pos, pb = x.results.joints.get(B).pos;
    return Math.sign(pa.x * pb.y - pa.y * pb.x);
  }));
  assert.equal(sides.size, 2, 'open and crossed assembly');
});

test('crank-rocker: stationary positions of the rocker match the closed form', () => {
  const [a, b, c, d] = [40, 120, 80, 100];
  const { doc } = makeFourbar({ a, b, c, d, theta2: 60 * DEG });
  const s = sim(doc);
  const sw = s.getSweep();
  assert.ok(sw.fullTurn, 'the crank turns fully');
  assert.equal(sw.specials.filter((x) => x.kind === 'toggle').length, 0);
  const rocker = doc.links[2].id;
  const got = sw.samples.filter((x) => x.special === 'stationary').map((x) => x.results.links.get(rocker).theta).sort((p, q) => Math.cos(q) - Math.cos(p));
  // rocker extremes: crank and coupler in line, |O2B| = b ± a
  const want = [b + a, b - a].map((r) => {
    const g = Math.acos((r * r + d * d - c * c) / (2 * r * d));
    return Math.atan2(r * Math.sin(g), r * Math.cos(g) - d);
  }).sort((p, q) => Math.cos(q) - Math.cos(p));
  assert.equal(got.length, 2);
  got.forEach((v, i) => { close(Math.cos(v), Math.cos(want[i]), 1e-7, 'cos θ4'); close(Math.sin(v), Math.sin(want[i]), 1e-7, 'sin θ4'); });
});

test('stepping the input stops exactly at the toggle, then animation passes through it', () => {
  const [a, b, c, d] = [80, 60, 70, 100];
  const { doc } = makeFourbar({ a, b, c, d, theta2: 80 * DEG });
  const s = sim(doc);
  const lim = Math.max(...Object.values(toggleAngles(a, b, c, d)).filter(Number.isFinite));
  let ok = true;
  for (let i = 0; i < 30 && ok; i++) ok = s.advance(1 * DEG);
  assert.equal(ok, false, 'a limit stops the input');
  close(s.theta, lim, 1e-6, 'stopped at the toggle (within 0.0001°)');
  assert.equal(s.special && s.special.kind, 'toggle');
  // animation: frames keep moving, the input turns back by itself
  const thetas = [];
  for (let i = 0; i < 400; i++) { assert.ok(s.run(1 * DEG)); thetas.push(s.theta); }
  const min = Math.min(...thetas), max = Math.max(...thetas);
  assert.ok(max <= lim + 1e-9 && min < -lim + 2 * DEG, `covers the range: ${min / DEG}..${max / DEG}`);
  for (let i = 1; i < thetas.length; i++) assert.ok(Math.abs(thetas[i] - thetas[i - 1]) <= 1.01 * DEG, 'never jumps');
});

test('slider driving a slider-crank passes its dead centres', () => {
  const doc = createDocument();
  const O = addJoint(doc, 0, 0, { ground: true });
  const A = addJoint(doc, 40 * Math.cos(1), 40 * Math.sin(1));
  const B = addJoint(doc, A.x + Math.sqrt(120 ** 2 - A.y ** 2), 0);
  addLink(doc, [O.id, A.id]); addLink(doc, [A.id, B.id]);
  const sl = addSlider(doc, B.id, { x: -200, y: 0 }, { x: 300, y: 0 });
  doc.driver = { type: 'slider', slider: sl.id };
  const s = sim(doc);
  const sw = s.getSweep();
  assert.ok(sw.closed);
  const dead = sw.specials.filter((x) => x.kind === 'toggle').map((x) => x.theta).sort((p, q) => p - q);
  close(dead[0], 200 + 80, 1e-6, 'inner dead centre');
  close(dead[1], 200 + 160, 1e-6, 'outer dead centre');
  // animation turns the crank right round
  const crank = doc.links[0].id;
  let turned = 0, prev = s.results.links.get(crank).theta;
  for (let i = 0; i < 600; i++) {
    s.run(1);
    const th = s.results.links.get(crank).theta;
    let dd = th - prev; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI;
    turned += dd; prev = th;
  }
  assert.ok(Math.abs(turned) > 2 * Math.PI, `crank turned ${turned / DEG}°`);
});

test('dragging rests at a stationary position, then lets go when pulled further', () => {
  const { doc } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: 60 * DEG });
  const s = sim(doc);
  // drag the crank tip A round its pivot, in small steps
  const i = s.sys.bodyIndex.get(doc.links[0].id);
  const local = s.sys.bodies[i].local.get(doc.joints[2].id);
  const seen = [];
  for (let k = 1; k <= 400; k++) {
    const ang = 60 * DEG + k * 1 * DEG;
    s.dragTo(i, local, { x: 40 * Math.cos(ang), y: 40 * Math.sin(ang) }, { stopAtSpecial: true, release: 6 });
    if (s.hold) seen.push(k);
  }
  assert.ok(seen.length > 0, 'it rested somewhere');
  // after resting it carried on: the crank went (nearly) all the way round
  const P = pointOnBody(s.q, i, local);
  const end = 60 * DEG + 400 * DEG;
  assert.ok(Math.hypot(P.x - 40 * Math.cos(end), P.y - 40 * Math.sin(end)) < 2, 'follows the cursor again');
});
