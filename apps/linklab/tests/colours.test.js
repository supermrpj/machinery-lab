// Link and coupler-curve colours: automatic by default, a picked colour sticks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, addLink, linkNumbers, mergeJoints } from '../src/model/document.js';
import { linkColor, autoLinkColor, traceColor } from '../src/drawing/render.js';
import { LINK_COLORS, TRACE_COLORS } from '../src/config.js';

test('links: automatic by number, picked colour wins', () => {
  const doc = createDocument();
  const a = addJoint(doc, 0, 0), b = addJoint(doc, 50, 0), c = addJoint(doc, 50, 50);
  const L1 = addLink(doc, [a.id, b.id]), L2 = addLink(doc, [b.id, c.id]);
  let nums = linkNumbers(doc);
  assert.equal(linkColor(nums, L1.id), LINK_COLORS[0]);
  assert.equal(linkColor(nums, L2.id), LINK_COLORS[1]);
  L2.color = '#123456';
  nums = linkNumbers(doc);
  assert.equal(linkColor(nums, L2.id), '#123456');
  assert.equal(autoLinkColor(nums, L2.id), LINK_COLORS[1]);
});

test('traced points: each its own colour, picked colour wins and survives a merge', () => {
  const doc = createDocument();
  const p = addJoint(doc, 0, 0, { trace: true }), q = addJoint(doc, 10, 0, { trace: true });
  assert.equal(traceColor(doc, p), TRACE_COLORS[0]);
  assert.equal(traceColor(doc, q), TRACE_COLORS[1]);
  q.traceColor = '#abcdef';
  assert.equal(traceColor(doc, q), '#abcdef');
  const r = addJoint(doc, 10, 0);
  mergeJoints(doc, r.id, q.id);
  assert.equal(r.traceColor, '#abcdef');
});
