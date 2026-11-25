// =============================================================================
// Editing with fixed lengths (model/reshape.js). Reported: a locked link
// changed length when its neighbour's length was typed, and separate links
// with fixed lengths could not be assembled by dragging. The rule tested here:
// no edit changes a fixed length; free links stretch; ground pivots stay.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, addLink, jointById } from '../src/model/document.js';
import { dragJoint, setLinkLength, joinKeepingLengths, fixedDistances } from '../src/model/reshape.js';

const TOL = 1e-6; // mm
const len = (doc, link) => { const [a, b] = link.joints.map((id) => jointById(doc, id)); return Math.hypot(b.x - a.x, b.y - a.y); };
const at = (doc, j) => { const p = jointById(doc, j.id); return [p.x, p.y]; };
const near = (x, y, msg) => assert.ok(Math.abs(x - y) < TOL, `${msg}: ${x} is not ${y}`);

/** Ground pivot, link A to a middle joint, link B on to a free end. */
function chain({ lockA = false, lockB = false } = {}) {
  const doc = createDocument();
  const j1 = addJoint(doc, 0, 0, { ground: true }), j2 = addJoint(doc, 60, 0), j3 = addJoint(doc, 60, 80);
  const A = addLink(doc, [j1.id, j2.id]), B = addLink(doc, [j2.id, j3.id]);
  A.locked = lockA; B.locked = lockB;
  return { doc, j1, j2, j3, A, B };
}

test('typing a length leaves a fixed neighbour at its length (the reported case)', () => {
  const { doc, A, B, j1 } = chain({ lockB: true });
  assert.equal(setLinkLength(doc, A.id, 100).ok, true);
  near(len(doc, A), 100, 'A'); near(len(doc, B), 80, 'fixed B');
  assert.deepEqual(at(doc, j1), [0, 0], 'the ground pivot stays');
});

test('typing a length lets a free neighbour stretch and keeps the far joint where it was', () => {
  const { doc, A, B, j3 } = chain();
  assert.equal(setLinkLength(doc, A.id, 100).ok, true);
  near(len(doc, A), 100, 'A');
  assert.deepEqual(at(doc, j3), [60, 80], 'the far end of the free neighbour does not move');
  assert.ok(Math.abs(len(doc, B) - 80) > 1, 'the free neighbour stretched');
});

test('a length that cannot fit is refused and nothing changes', () => {
  // two ground pivots 100 apart, both links fixed at 60: the first cannot become 200
  const doc = createDocument();
  const a = addJoint(doc, 0, 0, { ground: true }), b = addJoint(doc, 50, 33.166), c = addJoint(doc, 100, 0, { ground: true });
  const P = addLink(doc, [a.id, b.id]), Q = addLink(doc, [b.id, c.id]); Q.locked = true;
  const before = JSON.stringify(doc.joints), q0 = len(doc, Q);
  const r = setLinkLength(doc, P.id, 200);
  assert.equal(r.ok, false); assert.match(r.why, /does not fit/);
  assert.equal(JSON.stringify(doc.joints), before);
  // but 80 fits: the shared joint moves along the fixed link's circle
  assert.equal(setLinkLength(doc, P.id, 80).ok, true);
  near(len(doc, P), 80, 'P'); near(len(doc, Q), q0, 'fixed Q');
});

test('dragging a joint shared by a fixed and a free link: the fixed one keeps its length, the free one stretches', () => {
  const { doc, A, B, j1, j2, j3 } = chain({ lockB: true });
  const r = dragJoint(doc, j2.id, { x: 90, y: 20 });
  assert.equal(r.reached, true);
  assert.deepEqual(at(doc, j2), [90, 20]);
  near(len(doc, B), 80, 'fixed B');
  assert.ok(Math.abs(len(doc, A) - 60) > 1, 'free A stretched');
  assert.deepEqual(at(doc, j1), [0, 0]);
  assert.notDeepEqual(at(doc, j3), [60, 80], 'the fixed link followed');
});

test('a joint on a fixed link from a ground pivot stays on its circle', () => {
  const { doc, A, j2 } = chain({ lockA: true });
  const r = dragJoint(doc, j2.id, { x: 200, y: 200 });      // far beyond its reach
  assert.equal(r.reached, false);
  near(len(doc, A), 60, 'fixed A');
  const p = jointById(doc, j2.id);
  near(Math.atan2(p.y, p.x), Math.PI / 4, 'it points at the cursor');
});

test('with nothing fixed a drag moves only that joint (as before)', () => {
  const { doc, j1, j2, j3 } = chain();
  dragJoint(doc, j2.id, { x: 10, y: 10 });
  assert.deepEqual([at(doc, j1), at(doc, j2), at(doc, j3)], [[0, 0], [10, 10], [60, 80]]);
});

test('a fixed plate with three joints keeps all three sides', () => {
  const doc = createDocument();
  const a = addJoint(doc, 0, 0), b = addJoint(doc, 40, 0), c = addJoint(doc, 10, 30), d = addJoint(doc, 90, 10);
  const plate = addLink(doc, [a.id, b.id, c.id]); plate.locked = true;
  addLink(doc, [b.id, d.id]);                                 // a free link on one corner
  const sides = fixedDistances(doc).map((s) => s.len);
  dragJoint(doc, b.id, { x: 55, y: 25 });
  fixedDistances(doc).forEach((s, i) => near(s.len, sides[i], `side ${i}`));
  assert.deepEqual(at(doc, d), [90, 10], 'the far end of the free link stays');
});

test('a fixed coupler with a point on its centre line follows a dragged pin (three joints in a line)', () => {
  // the first lesson's four-bar: the coupler carries a traced point half way along it
  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true }), O4 = addJoint(doc, 100, 0, { ground: true });
  const A = addJoint(doc, 20, 34.641), B = addJoint(doc, 133.881, 72.471), M = addJoint(doc, 76.9405, 53.556);
  const crank = addLink(doc, [O2.id, A.id]), coupler = addLink(doc, [A.id, B.id, M.id]); addLink(doc, [O4.id, B.id]);
  coupler.locked = true;
  const sides = fixedDistances(doc).map((s) => s.len);
  const r = dragJoint(doc, A.id, { x: 35, y: 45 });
  assert.equal(r.reached, true);
  assert.deepEqual(at(doc, A), [35, 45]);
  fixedDistances(doc).forEach((s, i) => near(s.len, sides[i], `coupler side ${i}`));
  assert.ok(Math.abs(len(doc, crank) - 40) > 1, 'the free crank changed length');
});

test('joining two fixed parts keeps both lengths, also when dropped a little off the pin', () => {
  const doc = createDocument();
  const a = addJoint(doc, 0, 0), b = addJoint(doc, 50, 0), c = addJoint(doc, 50.8, 0.6), d = addJoint(doc, 110.5, 6);
  const P = addLink(doc, [a.id, b.id]), Q = addLink(doc, [c.id, d.id]); P.locked = true; Q.locked = true;
  const lq = len(doc, Q);
  assert.equal(joinKeepingLengths(doc, b.id, c.id).ok, true);
  assert.equal(doc.joints.length, 3);
  near(len(doc, P), 50, 'P'); near(len(doc, Q), lq, 'Q');
  assert.deepEqual(at(doc, b), [50, 0], 'the pin stays where it was');
});

test('closing a loop of fixed links from two ground pivots keeps every length', () => {
  // crank 40 and coupler 120 from one pivot; rocker 80 from the other; the ends are 2 mm apart
  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true }), A = addJoint(doc, 20, 34.641), O4 = addJoint(doc, 100, 0, { ground: true });
  const B = addJoint(doc, 133.881, 72.471);                   // where the loop closes
  const th = Math.atan2(72.471 - 34.641, 133.881 - 20) + 0.0167;
  const E = addJoint(doc, 20 + 120 * Math.cos(th), 34.641 + 120 * Math.sin(th));   // coupler end, a little off B
  const crank = addLink(doc, [O2.id, A.id]), coupler = addLink(doc, [A.id, E.id]), rocker = addLink(doc, [O4.id, B.id]);
  for (const l of [crank, coupler, rocker]) l.locked = true;
  const L = [crank, coupler, rocker].map((l) => len(doc, l));
  assert.equal(joinKeepingLengths(doc, B.id, E.id).ok, true);
  [crank, coupler, rocker].forEach((l, i) => near(len(doc, l), L[i], `link ${i}`));
  assert.deepEqual([at(doc, O2), at(doc, O4)], [[0, 0], [100, 0]]);
});

test('parts that cannot meet are not joined and the drawing is unchanged', () => {
  const doc = createDocument();
  const a = addJoint(doc, 0, 0, { ground: true }), b = addJoint(doc, 30, 0), c = addJoint(doc, 200, 0, { ground: true }), d = addJoint(doc, 170, 0);
  const P = addLink(doc, [a.id, b.id]), Q = addLink(doc, [c.id, d.id]); P.locked = true; Q.locked = true;
  const before = JSON.stringify(doc.joints);
  const r = joinKeepingLengths(doc, b.id, d.id);
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(doc.joints), before);
  assert.equal(doc.joints.length, 4);
});

test('the global lock fixes every link', () => {
  const { doc, A, B, j2 } = chain();
  doc.lockDesign = true;
  dragJoint(doc, j2.id, { x: 0, y: 60 });
  near(len(doc, A), 60, 'A'); near(len(doc, B), 80, 'B');
});
