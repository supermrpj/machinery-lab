// =============================================================================
// The position in the file. Reported: a mechanism moved away from where it was
// drawn, then saved, opened where it was drawn. The file now also carries the
// current pose, and opening it puts the mechanism back there. The drawn
// position stays in the file as before (Home returns to it).
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, addLink, autoDriver } from '../src/model/document.js';
import { Simulation } from '../src/model/simulation.js';
import { serialize, deserialize } from '../src/model/fileio.js';

const TOL = 1e-7; // mm

/** A crank-rocker (40, 120, 80, 100 mm), or with `swap` a triple rocker (100, 60, 80, 150 mm). */
function fourbar(swap = false) {
  const [a, b, c, d] = swap ? [100, 60, 80, 150] : [40, 120, 80, 100];
  // joint B from the two circles about A and O4 (upper intersection)
  const th = Math.PI / 3, A = { x: a * Math.cos(th), y: a * Math.sin(th) };
  const dx = d - A.x, dy = -A.y, L = Math.hypot(dx, dy), k = (b * b - c * c + L * L) / (2 * L), h = Math.sqrt(b * b - k * k);
  const B = { x: A.x + (k * dx - h * dy) / L, y: A.y + (k * dy + h * dx) / L };
  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true }), O4 = addJoint(doc, d, 0, { ground: true });
  const JA = addJoint(doc, A.x, A.y), JB = addJoint(doc, B.x, B.y);
  addLink(doc, [O2.id, JA.id]); addLink(doc, [JA.id, JB.id]); addLink(doc, [O4.id, JB.id]);
  autoDriver(doc);
  return doc;
}

/** What the app does: Save, then Open in a new window. Returns the second simulation and whether the pose was taken. */
function saveAndOpen(doc, sim) {
  const opened = deserialize(serialize(doc, sim.poseForFile()));
  const pose = opened.pose; delete opened.pose;      // as App.setDoc does
  const sim2 = new Simulation(); sim2.reset(opened);
  const restored = pose ? sim2.restorePose(pose) : false;
  return { opened, sim2, restored, hadPose: !!pose };
}

const samePose = (doc, s1, s2) => {
  for (const j of doc.joints) {
    const p = s1.jointPos(j.id), q = s2.jointPos(j.id);
    assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < TOL, `joint ${j.id}: ${p.x},${p.y} saved, ${q.x},${q.y} opened`);
  }
};

test('a moved four-bar opens in the position it was saved in; the drawn position is unchanged', () => {
  const doc = fourbar(), sim = new Simulation(); sim.reset(doc);
  const drawn = doc.joints.map((j) => [j.x, j.y]);
  sim.goTo(150 * Math.PI / 180);
  assert.ok(sim.moved);
  const { opened, sim2, restored } = saveAndOpen(doc, sim);
  assert.equal(restored, true);
  samePose(doc, sim, sim2);
  assert.ok(Math.abs(sim2.theta - sim.theta) < 1e-9, 'the input value is the saved one');
  assert.deepEqual(opened.joints.map((j) => [j.x, j.y]), drawn, 'the file still holds the drawn position');
  assert.equal(opened.pose, undefined);
});

test('several turns of the crank are kept', () => {
  const doc = fourbar(), sim = new Simulation(); sim.reset(doc);
  for (let k = 0; k < 50; k++) sim.advance(0.2);     // more than one full turn
  assert.ok(sim.theta > 2 * Math.PI);
  const { sim2, restored } = saveAndOpen(doc, sim);
  assert.equal(restored, true);
  assert.ok(Math.abs(sim2.theta - sim.theta) < 1e-9);
  samePose(doc, sim, sim2);
});

test('a mechanism that has not moved saves no pose (the file is as before)', () => {
  const doc = fourbar(), sim = new Simulation(); sim.reset(doc);
  assert.equal(sim.poseForFile(), null);
  assert.equal('pose' in JSON.parse(serialize(doc, sim.poseForFile())), false);
});

test('the other assembly of a triple rocker comes back, not the drawn one', () => {
  const doc = fourbar(true), sim = new Simulation(); sim.reset(doc);
  // through a toggle and back along the other branch: same input angle, other assembly
  const start = sim.theta;
  for (let k = 0; k < 400 && !(sim.limitHit); k++) sim.run(0.02);
  for (let k = 0; k < 4000; k++) { sim.run(-0.01); if (Math.abs(sim.theta - start) < 0.02 && sim.moved) break; }
  // really the other assembly: the input is back at its drawn angle, the coupler pin is somewhere else
  const B = doc.joints[3], now = sim.jointPos(B.id);
  assert.ok(Math.abs(sim.theta - start) < 0.02, 'back at the drawn input angle');
  assert.ok(Math.hypot(now.x - B.x, now.y - B.y) > 10, 'on the other assembly');
  const { sim2, restored } = saveAndOpen(doc, sim);
  assert.equal(restored, true);
  samePose(doc, sim, sim2);
});

test('loose pieces (no input) stay where they were dragged', () => {
  const doc = createDocument();
  const a = addJoint(doc, 0, 0), b = addJoint(doc, 50, 0), c = addJoint(doc, 80, 40), d = addJoint(doc, 140, 40);
  addLink(doc, [a.id, b.id]); const Q = addLink(doc, [c.id, d.id]);
  const sim = new Simulation(); sim.reset(doc);
  const i = sim.sys.bodyIndex.get(Q.id);
  sim.dragTo(i, sim.sys.bodies[i].local.get(c.id), { x: 50, y: 0 });
  assert.ok(sim.moved);
  const { sim2, restored } = saveAndOpen(doc, sim);
  assert.equal(restored, true);
  samePose(doc, sim, sim2);
  const p = sim2.jointPos(c.id), q = sim2.jointPos(d.id);
  assert.ok(Math.abs(Math.hypot(q.x - p.x, q.y - p.y) - 60) < TOL, 'the dragged link keeps its length');
});

test('a pose that does not fit the drawing is refused and the file opens as drawn', () => {
  const doc = fourbar(), sim = new Simulation(); sim.reset(doc);
  sim.goTo(2);
  const data = JSON.parse(serialize(doc, sim.poseForFile()));
  data.joints[2].x += 15;                            // the drawing changed by hand; the pose is the old one
  const opened = deserialize(JSON.stringify(data));
  const pose = opened.pose; delete opened.pose;
  const sim2 = new Simulation(); sim2.reset(opened);
  assert.equal(sim2.restorePose(pose), false);
  assert.equal(sim2.moved, false);
  for (const bad of [null, {}, { links: {} }, { links: { nope: [0, 0, 0] } }, { theta: 1, links: Object.fromEntries(opened.links.map((l) => [l.id, [0, 'x', 0]])) }]) {
    assert.equal(sim2.restorePose(bad), false);
  }
});

test('a file saved before this change (no pose) opens as drawn', () => {
  const doc = fourbar(), sim = new Simulation(); sim.reset(doc);
  const { sim2, hadPose } = saveAndOpen(doc, sim);
  assert.equal(hadPose, false);
  assert.equal(sim2.moved, false);
});

test('a stale pose inside the document is never written back', () => {
  const doc = fourbar();
  doc.pose = { theta: 1, links: {} };                 // e.g. a document passed along without App.setDoc
  assert.equal('pose' in JSON.parse(serialize(doc, null)), false);
});
