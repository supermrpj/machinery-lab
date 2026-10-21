// =============================================================================
// Units: presets, round trips, and the Week 9 fourbar typed as on the slide in
// US units (inches, pounds, blobs). Values are stored in mm, N, kg; only what
// is shown and typed changes, so the answer reads T12 = 243.23 lb·in.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, addLink, setDriverSpec } from '../src/model/document.js';
import { unitsOf, presetOf, UNIT_PRESETS, FORCE_UNITS, TORQUE_UNITS, MASS_UNITS, INERTIA_UNITS } from '../src/model/units.js';
import { fourbarPosition } from '../src/kinematics/index.js';
import { Simulation } from '../src/model/simulation.js';
import { analyseForces } from '../src/model/forces.js';

const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

test('presets are recognised, and every unit converts both ways', () => {
  const doc = createDocument();
  assert.equal(presetOf(doc), 'si-mm');
  doc.units = { ...doc.units, ...UNIT_PRESETS['us-in'] };
  assert.equal(presetOf(doc), 'us-in');
  doc.units.force = 'kN';
  assert.equal(presetOf(doc), 'custom');
  for (const table of [FORCE_UNITS, TORQUE_UNITS, MASS_UNITS, INERTIA_UNITS]) {
    for (const key of Object.keys(table)) {
      const U = unitsOf({ units: { force: key, torque: key, mass: key, inertia: key } });
      for (const q of [U.F, U.T, U.M, U.I]) near(q.si(q.show(12.345)), 12.345, 1e-12, `${key}`);
    }
  }
  const us = unitsOf({ units: UNIT_PRESETS['us-in'] });
  near(us.F.show(4.4482216152605), 1, 1e-12, '1 lb');
  near(us.M.si(1), 175.1268, 1e-6, '1 blob in kg');
  near(us.I.si(1), 0.112984829, 1e-8, '1 lb·in·s² in kg·m²');
  near(us.T.show(0.112984829), 1, 1e-8, '1 lb·in');
});

test('Week 9 Example 2 typed in US units gives T12 = 243.23 lb·in', () => {
  const doc = createDocument();
  doc.units = { ...doc.units, ...UNIT_PRESETS['us-in'] };
  const U = unitsOf(doc);
  const th2 = Math.PI / 3, sol = fourbarPosition(5, 15, 10, 19, th2).open;
  const P = (x, y) => ({ x: U.mm(x), y: U.mm(y) });   // inches typed → stored mm
  const O2 = addJoint(doc, 0, 0, { ground: true }), O4 = addJoint(doc, U.mm(19), 0, { ground: true });
  const A = P(5 * Math.cos(th2), 5 * Math.sin(th2));
  const JA = addJoint(doc, A.x, A.y);
  const JB = addJoint(doc, A.x + U.mm(15 * Math.cos(sol.theta3)), A.y + U.mm(15 * Math.sin(sol.theta3)));
  const L2 = addLink(doc, [O2.id, JA.id]), L3 = addLink(doc, [JA.id, JB.id]), L4 = addLink(doc, [O4.id, JB.id]);
  const polar = (from, to, r, deg) => ({ from, to, x: U.mm(r * Math.cos(deg * Math.PI / 180)), y: U.mm(r * Math.sin(deg * Math.PI / 180)) });
  // typed as on the slide: blobs and lb·in·s²
  L2.mass = { m: U.M.si(0.004), I: U.I.si(0.4), local: polar(O2.id, JA.id, 3, 30) };
  L3.mass = { m: U.M.si(0.020), I: U.I.si(1.5), local: polar(JA.id, JB.id, 9, 45) };
  L4.mass = { m: U.M.si(0.015), I: U.I.si(0.8), local: polar(O4.id, JB.id, 5, 0) };
  const t3 = sol.theta3, g3 = { x: 9 * Math.cos(t3 + Math.PI / 4), y: 9 * Math.sin(t3 + Math.PI / 4) };
  const p = { x: 5 * Math.cos(th2) + g3.x + 3 * Math.cos(t3 + 100 * Math.PI / 180), y: 5 * Math.sin(th2) + g3.y + 3 * Math.sin(t3 + 100 * Math.PI / 180) };
  doc.loads = [
    { id: 'f', link: L3.id, kind: 'force', at: P(p.x, p.y), F: { x: U.F.si(80 * Math.cos(-Math.PI / 6)), y: U.F.si(80 * Math.sin(-Math.PI / 6)) }, follow: false, profile: { type: 'constant' } },
    { id: 't', link: L4.id, kind: 'torque', at: P(19, 0), T: U.T.si(120), follow: false, profile: { type: 'constant' } },
  ];
  setDriverSpec(doc, { type: 'rotary', link: L2.id, pivot: O2.id, ref: null });
  doc.motion.omega = 25; doc.motion.alpha = -40;
  doc.dynamics = { mode: 'dynamic', gravity: false, g: 9.81 };
  const s = new Simulation(); s.reset(doc);
  const r = analyseForces(s);
  near(U.T.show(r.input.torque), 243.23, 5e-4, 'T12 in lb·in');
});
