// Tests for the document model, snapping, history, files and simulation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, removeJoint, linkNumbers, setDriver } from '../src/model/document.js';
import { addConstruction } from '../src/model/construction.js';
import { History } from '../src/model/history.js';
import { serialize, deserialize } from '../src/model/fileio.js';
import { Simulation } from '../src/model/simulation.js';
import { exampleFourbar } from '../src/model/examples.js';
import { buildSnapTargets, snapPoint } from '../src/drawing/snap.js';

test('snap: intersection of two circles is found exactly', () => {
  const doc = createDocument();
  const c1 = addConstruction(doc, 'circle', { c: { x: 0, y: 0 }, r: 50 });
  const c2 = addConstruction(doc, 'circle', { c: { x: 60, y: 0 }, r: 50 });
  const t = buildSnapTargets({ construction: [c1, c2], joints: [] });
  const s = snapPoint(t, { x: 30.5, y: 39.5 }, 0.5);
  assert.equal(s.kind, 'intersection');
  assert.ok(Math.abs(s.p.x - 30) < 1e-12 && Math.abs(s.p.y - 40) < 1e-12);
});

test('snap: a joint wins over a construction point at the same place', () => {
  const doc = createDocument();
  const p = addConstruction(doc, 'point', { p: { x: 10, y: 10 } });
  const t = buildSnapTargets({ construction: [p], joints: [{ id: 'j9', p: { x: 10, y: 10 } }] });
  const s = snapPoint(t, { x: 10.2, y: 9.9 }, 0.5);
  assert.equal(s.kind, 'joint');
  assert.equal(s.ref, 'j9');
});

test('snap: arcs only intersect within their sweep', () => {
  const doc = createDocument();
  const arc = addConstruction(doc, 'arc', { c: { x: 0, y: 0 }, r: 50, a0: 0, sweep: Math.PI / 4 });
  const line = addConstruction(doc, 'xline', { a: { x: -100, y: 0 }, b: { x: 100, y: 0 } });
  const pts = buildSnapTargets({ construction: [arc, line], joints: [] }).points.filter((p) => p.kind === 'intersection');
  assert.equal(pts.length, 1); // (50, 0) only; (−50, 0) is outside the arc
  assert.ok(Math.abs(pts[0].p.x - 50) < 1e-9);
});

test('history: undo and redo restore the document', () => {
  const doc = createDocument();
  const h = new History();
  h.push(doc, 'Add joint');
  addJoint(doc, 1, 2);
  const u = h.undo(doc);
  assert.equal(u.doc.joints.length, 0);
  const r = h.redo(u.doc);
  assert.equal(r.doc.joints.length, 1);
});

test('file: save and open round trip; foreign files are rejected', () => {
  const doc = exampleFourbar();
  const back = deserialize(serialize(doc));
  assert.equal(back.joints.length, doc.joints.length);
  assert.deepEqual(back.links.map((l) => l.joints), doc.links.map((l) => l.joints));
  assert.throws(() => deserialize('{"hello":1}'), /not a LinkLab/);
  assert.throws(() => deserialize('nonsense'), /not a LinkLab/);
});

test('removing a joint removes links that depend on it', () => {
  const doc = exampleFourbar();
  const A = doc.links[0].joints[1];
  removeJoint(doc, A);
  assert.equal(doc.links.length, 2); // crank gone; coupler keeps B and P
  const O4 = doc.joints.find((j) => j.ground && doc.links.some((l) => l.joints.includes(j.id)));
  const output = doc.links.find((l) => l.joints.includes(O4.id));
  assert.equal(doc.driver.link, output.id); // the output (pinned to ground) becomes the input
});

test('Norton numbering follows the input choice', () => {
  const doc = exampleFourbar();
  assert.equal(linkNumbers(doc).get(doc.links[0].id), 2);
  setDriver(doc, doc.links[2].id);
  assert.equal(linkNumbers(doc).get(doc.links[2].id), 2);
});

test('simulation: baking the moved pose keeps link lengths and moves attached items', () => {
  const doc = exampleFourbar();
  const coupler = doc.links[1];
  addConstruction(doc, 'point', { p: { x: 50, y: 80 } }, coupler.id);
  const sim = new Simulation();
  sim.reset(doc);
  const len = (d, l) => { const [a, b] = l.joints.map((id) => d.joints.find((j) => j.id === id)); return Math.hypot(a.x - b.x, a.y - b.y); };
  const before = doc.links.map((l) => len(doc, l));
  assert.ok(sim.advance(Math.PI / 3));
  const moved = sim.transformFor(coupler.id).T({ x: 50, y: 80 });
  sim.bakeInto(doc);
  doc.links.forEach((l, i) => assert.ok(Math.abs(len(doc, l) - before[i]) < 1e-9));
  const pt = doc.construction[0].p;
  assert.ok(Math.hypot(pt.x - moved.x, pt.y - moved.y) < 1e-9);
});
