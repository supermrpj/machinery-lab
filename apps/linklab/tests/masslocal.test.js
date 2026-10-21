// =============================================================================
// A typed centre of mass in the link's own frame (r ∠ θ from a joint, along
// the line of centres) stays on the link: it follows when the link's lengths
// change, and the frame can start at any of the link's joints.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, addLink } from '../src/model/document.js';
import { massProps, defaultFrame, linkFrame, toLocal, toWorld } from '../src/model/mass.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('local ↔ world round trip', () => {
  const F = linkFrame((id) => ({ a: { x: 10, y: 20 }, b: { x: 40, y: 60 } })[id], 'a', 'b');
  const p = { x: 31, y: -7 };
  const q = toWorld(F, toLocal(F, p));
  close(q.x, p.x, 'x'); close(q.y, p.y, 'y');
  // the point 50 along the line of centres is exactly joint b (length 50)
  const b = toWorld(F, { x: 50, y: 0 });
  close(b.x, 40, 'bx'); close(b.y, 60, 'by');
});

test('a centre of mass at r ∠ θ stays at r ∠ θ when the link is lengthened', () => {
  const doc = createDocument();
  const A = addJoint(doc, 0, 0, { ground: true }), B = addJoint(doc, 100, 0);
  const link = addLink(doc, [A.id, B.id]);
  assert.deepEqual(defaultFrame(doc, link), { from: A.id, to: B.id });
  link.mass = { m: 1, I: 0.01, local: { from: A.id, to: B.id, x: 30 * Math.cos(Math.PI / 4), y: 30 * Math.sin(Math.PI / 4) } };
  let g = massProps(doc, link).cg;
  close(g.x, 30 * Math.SQRT1_2, 'gx'); close(g.y, 30 * Math.SQRT1_2, 'gy');
  // turn and stretch the link: G keeps 30 at 45° from the new line of centres
  B.x = 0; B.y = 150;
  g = massProps(doc, link).cg;
  close(Math.hypot(g.x, g.y), 30, 'r');
  close(Math.atan2(g.y, g.x), Math.PI / 2 + Math.PI / 4, 'θ + 90°');
});
