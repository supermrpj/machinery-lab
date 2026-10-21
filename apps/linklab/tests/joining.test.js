// =============================================================================
// Joining links: two joints drawn on one spot must be joinable into one pin,
// and a joint can be pinned to a link that passes over it. The case is the
// one reported: a coupler end drawn on the middle of the rocker as a separate
// point, which left the mechanism with 3 degrees of freedom.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, addLink, mergeJoints, attachJoint, coincidentJoints, autoDriver } from '../src/model/document.js';
import { Simulation } from '../src/model/simulation.js';

/** Crank, coupler, and a rocker whose middle point sits where the coupler ends (not joined). */
function reported() {
  const doc = createDocument();
  const O2 = addJoint(doc, -41.357, 30.934, { ground: true });
  const A = addJoint(doc, -62.407, 29.092);
  const B = addJoint(doc, 100, 43.30127);          // coupler end
  const O4 = addJoint(doc, 125, 0, { ground: true });
  const C = addJoint(doc, 85, 69.28203);           // rocker tip
  const P = addJoint(doc, 100, 43.30127, { trace: true }); // point on the rocker, same spot as B
  addLink(doc, [O2.id, A.id]);
  addLink(doc, [A.id, B.id]);
  const rocker = addLink(doc, [O4.id, C.id, P.id]);
  autoDriver(doc);
  return { doc, B, P, rocker };
}

const simOf = (doc) => { const s = new Simulation(); s.reset(doc); return s; };

test('the reported drawing is loose, and the coincident joints are found', () => {
  const { doc, B, P } = reported();
  assert.equal(simOf(doc).info.dof, 3);
  assert.deepEqual(coincidentJoints(doc), [[B.id, P.id]]);
});

test('joining the two joints makes a drivable fourbar with a ternary rocker', () => {
  const { doc, B, P, rocker } = reported();
  assert.ok(mergeJoints(doc, B.id, P.id));
  assert.ok(!doc.joints.some((j) => j.id === P.id));
  assert.ok(doc.joints.find((j) => j.id === B.id).trace, 'the trace setting is kept');
  assert.ok(doc.links.find((l) => l.id === rocker.id).joints.includes(B.id));
  const s = simOf(doc);
  assert.equal(s.info.dof, 1);
  assert.ok(s.drivable);
  assert.equal(s.info.kind.type, 'fourbar');
});

test('pinning a joint to a link that passes over it also closes the loop', () => {
  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true });
  const A = addJoint(doc, 0, 40);
  const O4 = addJoint(doc, 100, 0, { ground: true });
  const C = addJoint(doc, 100, 120);
  const B = addJoint(doc, 100, 60);  // on the rocker's centre line, not on the rocker
  addLink(doc, [O2.id, A.id]);
  addLink(doc, [A.id, B.id]);
  const rocker = addLink(doc, [O4.id, C.id]);
  autoDriver(doc);
  assert.notEqual(simOf(doc).info.dof, 1);
  assert.ok(attachJoint(doc, B.id, rocker.id));
  assert.equal(simOf(doc).info.dof, 1);
  assert.ok(!attachJoint(doc, B.id, rocker.id), 'not twice');
});

test('two joints of the same link cannot be joined', () => {
  const doc = createDocument();
  const a = addJoint(doc, 0, 0, { ground: true }), b = addJoint(doc, 50, 0);
  addLink(doc, [a.id, b.id]);
  assert.ok(!mergeJoints(doc, a.id, b.id));
  assert.equal(doc.joints.length, 2);
});
