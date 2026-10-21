// A full-turn sweep has a sample exactly at 0° of input, so plots "from 0°"
// start at 0° (the steps along the path of motion seldom land on it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, addLink, setDriverSpec } from '../src/model/document.js';
import { Simulation } from '../src/model/simulation.js';
import { fourbarPosition } from '../src/kinematics/index.js';

const DEG = Math.PI / 180;
const a = 50, b = 150, c = 100, d = 190; // crank-rocker (mm)

function build(th2deg) {
  const th2 = th2deg * DEG, sol = fourbarPosition(a, b, c, d, th2).open;
  const A = { x: a * Math.cos(th2), y: a * Math.sin(th2) };
  const B = { x: A.x + b * Math.cos(sol.theta3), y: A.y + b * Math.sin(sol.theta3) };
  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true }), O4 = addJoint(doc, d, 0, { ground: true });
  const JA = addJoint(doc, A.x, A.y), JB = addJoint(doc, B.x, B.y);
  const L2 = addLink(doc, [O2.id, JA.id]), L3 = addLink(doc, [JA.id, JB.id]); addLink(doc, [O4.id, JB.id]);
  setDriverSpec(doc, { type: 'rotary', link: L2.id, pivot: O2.id, ref: null });
  const s = new Simulation();
  s.reset(doc);
  return { s, L3 };
}

for (const start of [37.3, 0, 359.6, -12.25]) {
  test(`full turn drawn at ${start}°: one sample exactly at 0°, in the right pose`, () => {
    const { s, L3 } = build(start);
    const sw = s.getSweep();
    assert.ok(sw.fullTurn);
    const onZero = sw.samples.filter((x) => Math.abs(Math.sin(x.theta / 2)) < 1e-9);
    // the start and the end are the same pose when drawn at 0°; otherwise one sample in between
    assert.ok(onZero.length >= 1, 'no sample at 0°');
    const z = onZero[0];
    const expect = fourbarPosition(a, b, c, d, 0).open.theta3;
    const got = z.results.links.get(L3.id).theta;
    assert.ok(Math.abs(Math.atan2(Math.sin(got - expect), Math.cos(got - expect))) < 1e-8, `theta3 ${got} vs ${expect}`);
    // still in increasing order of input
    for (let i = 1; i < sw.samples.length; i++) assert.ok(sw.samples[i].theta >= sw.samples[i - 1].theta - 1e-12);
  });
}
