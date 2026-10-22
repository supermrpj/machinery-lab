// =============================================================================
// Checks for fixes found in a broad review of LinkLab
//   1. results do not depend on the size of the drawing (×0.01 … ×1000)
//   2. undo keeps the units, the lengths lock and the output (not undo steps)
//   3. layout DXF: actuator pins get holes, the cylinder is drawn
//   4. a contact that would have to pull is reported as such
//   5. second round: undo keeps speed, name and layers too; the actuator
//      stroke check; a typed input out of reach goes to the nearest one;
//      a frame link is listed once (parameters) and is the frame part (CAD);
//      a traced coupler point gets a hole; the CAD README
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES, exampleBoom, exampleCam, exampleFourbar } from '../src/model/examples.js';
import { Simulation } from '../src/model/simulation.js';
import { analyseForces } from '../src/model/forces.js';
import { makeLoad } from '../src/model/loads.js';
import { addJoint, addLink, removeLink, linkNumbers, strokeAllows, setDriverSpec } from '../src/model/document.js';
import { History, settingsText, settingsChanged, keepSettings } from '../src/model/history.js';
import { layoutDXF, partsZip } from '../src/export/cad.js';
import { mechanismParameters } from '../src/export/parameters.js';
import { deserialize } from '../src/model/fileio.js';
import { makeFourbar, makeSliderCrank } from './helpers.js';
import fs from 'node:fs';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

// ---- 1. size of the drawing ----------------------------------------------------

/** Scale every length of a document by k (in place). */
function scaleDoc(doc, k) {
  for (const j of doc.joints) { j.x *= k; j.y *= k; }
  for (const l of doc.links) if (l.disc) l.disc *= k;
  for (const c of doc.construction) {
    for (const key of ['p', 'a', 'b', 'c']) if (c[key]) { c[key].x *= k; c[key].y *= k; }
    if (c.r) c.r *= k;
  }
  for (const s of doc.sliders) { s.a.x *= k; s.a.y *= k; s.b.x *= k; s.b.y *= k; }
  for (const p of doc.pairs) if (p.a && p.a.x !== undefined) { p.a.x *= k; p.a.y *= k; p.b.x *= k; p.b.y *= k; }
  for (const u of doc.actuators) { u.min *= k; u.max *= k; }
  return doc;
}

/**
 * One example at size k: a speed ratio (dimensionless) and the static forces
 * for a 10 N load at the last link's last joint (no gravity). Forces in N do
 * not change with size; the input torque grows with k, so it is divided by k.
 */
function atSize(name, k) {
  const doc = scaleDoc(EXAMPLES.find((e) => e.name === name).make(), k);
  const last = doc.links[doc.links.length - 1];
  const j = doc.joints.find((x) => x.id === last.joints[last.joints.length - 1]);
  const load = makeLoad(doc, last.id, { x: j.x, y: j.y });
  load.F = { x: 3, y: -10 };
  doc.loads = [load];
  doc.dynamics = { mode: 'static', gravity: false, g: 9.81 };
  const s = new Simulation();
  s.reset(doc);
  assert.ok(s.qd, `${name} ×${k}: velocities found`);
  const omegaIn = s.results.links.get(doc.links[0].id).omega;
  // a link that turns gives ω ratio; a link that slides gives v / (ω·k)
  const out = s.results.links.get(last.id).omega;
  const v = s.results.joints.get(j.id).vel;
  const ratio = Math.abs(out) > 1e-9 ? out / omegaIn : Math.hypot(v.x, v.y) / (omegaIn * k);
  const f = analyseForces(s);
  assert.ok(f, `${name} ×${k}: forces found`);
  return {
    ratio,
    input: f.input.torque / k,
    pins: f.pins.map((p) => Math.hypot(p.F.x, p.F.y)),
    contacts: f.contacts.map((c) => c.size),
  };
}

for (const name of ['Rack and pinion', 'Gear pair', 'Planet on a fixed sun', 'Cam and flat follower', 'Fourbar (crank-rocker)']) {
  test(`${name}: the same speed ratio and forces at ×0.01, ×1, ×100 and ×1000`, () => {
    const ref = atSize(name, 1);
    for (const k of [0.01, 100, 1000]) {
      const r = atSize(name, k);
      close(r.ratio, ref.ratio, 1e-9, `×${k} speed ratio`);
      close(r.input, ref.input, 1e-6, `×${k} input torque / k`);
      ref.pins.forEach((F, i) => close(r.pins[i], F, 1e-6, `×${k} pin ${i}`));
      ref.contacts.forEach((F, i) => close(r.contacts[i], F, 1e-6, `×${k} contact ${i}`));
    }
  });
}

test('Cam ×100: the follower follows the cam as exactly as at ×1, with the same number of samples', () => {
  const run = (k) => {
    const doc = scaleDoc(EXAMPLES.find((e) => e.name === 'Cam and flat follower').make(), k);
    const s = new Simulation();
    s.reset(doc);
    const sw = s.getSweep();
    let err = 0;
    for (const smp of sw.samples) {
      // eccentric cam: e = 15, follower face at 40 when the cam is at 0
      const y = smp.results.joints.get(doc.links[1].joints[0]).pos.y;
      err = Math.max(err, Math.abs(y - k * (40 + 15 * Math.sin(smp.theta))));
    }
    return { n: sw.samples.length, err };
  };
  const one = run(1), big = run(100);
  assert.equal(big.n, one.n, 'samples');
  assert.ok(big.err < 1e-9 * 100 * 30, `follower error ${big.err} mm over a 3 m stroke`);
});

// ---- 2. undo and the settings that are not undo steps ----------------------------

/** One undoable change, as the app makes it (beginEdit … endEdit). */
function edit(history, doc, label, fn) {
  const before = settingsText(doc);
  const step = history.push(doc, label);
  fn(doc);
  step.changed = settingsChanged(before, doc);
}
const undo = (history, doc) => { const r = history.undo(doc); return keepSettings(doc, r.doc, r.changed); };
const redo = (history, doc) => { const r = history.redo(doc); return keepSettings(doc, r.doc, r.changed); };

test('Undo undoes the last drawing change only: units, lengths lock and output stay', () => {
  const history = new History();
  let doc = exampleFourbar();
  const joints = doc.joints.length;
  edit(history, doc, 'Add ground pivot', (d) => addJoint(d, -60, -60, { ground: true }));
  // chosen with a click: no undo step
  doc.units = { length: 'in', force: 'lbf', torque: 'lbin', mass: 'blob', inertia: 'lbins2' };
  doc.lockDesign = true;
  doc.output = { kind: 'x', joint: doc.joints[2].id };
  doc = undo(history, doc);
  assert.equal(doc.joints.length, joints, 'the pivot is gone');
  assert.equal(doc.units.length, 'in');
  assert.equal(doc.lockDesign, true);
  assert.deepEqual(doc.output, { kind: 'x', joint: doc.joints[2].id });
  doc = redo(history, doc);
  assert.equal(doc.joints.length, joints + 1, 'the pivot is back');
  assert.equal(doc.units.length, 'in'); assert.equal(doc.lockDesign, true); assert.equal(doc.output.kind, 'x');
});

test('Undo brings back an output that the undone change reset, and drops one on a removed joint', () => {
  const history = new History();
  let doc = exampleFourbar();
  const rocker = doc.links[2];
  doc.output = { kind: 'angle', link: rocker.id };
  edit(history, doc, 'Delete link', (d) => { removeLink(d, rocker.id); d.output = null; });
  doc = undo(history, doc);
  assert.deepEqual(doc.output, { kind: 'angle', link: rocker.id }, 'the delete set it, so the undo restores it');
  // an output chosen on a joint the undo removes cannot be kept
  edit(history, doc, 'Add joint', (d) => addJoint(d, 300, 300));
  const added = doc.joints[doc.joints.length - 1];
  doc.output = { kind: 'y', joint: added.id };
  doc = undo(history, doc);
  assert.deepEqual(doc.output, { kind: 'angle', link: rocker.id });
});

// ---- 3. layout DXF -----------------------------------------------------------------

/** Entities per layer in a DXF text: { 'CIRCLE@PIN_HOLES': 2, … }. */
function dxfEntities(text) {
  const lines = text.split(/\r?\n/).map((x) => x.trim()), count = {};
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i] !== '0' || !/^(LINE|CIRCLE|ARC|LWPOLYLINE|POLYLINE|TEXT|POINT)$/.test(lines[i + 1])) continue;
    let layer = '';
    for (let k = i + 2; k < i + 20 && k < lines.length - 1; k++) if (lines[k] === '8') { layer = lines[k + 1]; break; }
    const key = `${lines[i + 1]}@${layer}`;
    count[key] = (count[key] || 0) + 1;
  }
  return count;
}

test('Layout DXF of the boom: the cylinder\'s pins have holes and the cylinder is drawn', () => {
  const doc = exampleBoom();
  const sim = new Simulation();
  sim.reset(doc);
  const app = { doc, sim, linkNumbers: () => linkNumbers(doc), currentBodies: () => doc.bodies, currentConstruction: () => doc.construction };
  const n = dxfEntities(layoutDXF(app));
  // the boom's pivot, the cylinder's pin on the boom and the traced tip (the ground end is on GROUND)
  assert.equal(n['CIRCLE@PIN_HOLES'], 3);
  assert.equal(n['CIRCLE@GROUND'], 2);
  // body and rod
  assert.ok((n['POLYLINE@ACTUATORS'] || 0) + (n['LWPOLYLINE@ACTUATORS'] || 0) === 2, JSON.stringify(n));
});

// ---- 4. contacts can only push ---------------------------------------------------

test('Cam and follower: the contact pushes under the follower\'s weight and would pull when it is lifted', () => {
  const push = (Fy) => {
    const doc = exampleCam();
    const load = makeLoad(doc, doc.links[1].id, { x: 0, y: 110 });
    load.F = { x: 0, y: Fy };
    doc.loads = [load];
    doc.dynamics = { mode: 'static', gravity: false, g: 9.81 };
    const s = new Simulation();
    s.reset(doc);
    return analyseForces(s).contacts[0].push;
  };
  close(push(-10), 10, 1e-9, 'pressed down');
  close(push(10), -10, 1e-9, 'lifted');
});

// ---- 5. second round ------------------------------------------------------------

test('Undo also keeps the input speed, the drawing\'s name and the layers', () => {
  const history = new History();
  let doc = exampleFourbar();
  const links = doc.links.length;
  edit(history, doc, 'Add link', (d) => addLink(d, [d.joints[2].id, d.joints[3].id]));
  doc.motion = { ...doc.motion, omega: 25, alpha: 3, reverse: true };
  doc.meta.title = 'My linkage';
  doc.layers.construction.visible = false;
  doc = undo(history, doc);
  assert.equal(doc.links.length, links, 'the link is gone');
  assert.deepEqual([doc.motion.omega, doc.motion.alpha, doc.motion.reverse], [25, 3, true]);
  assert.equal(doc.meta.title, 'My linkage');
  assert.equal(doc.layers.construction.visible, false);
});

test('Actuator stroke: the shortest must stay below the longest', () => {
  const u = exampleBoom().actuators[0];
  assert.equal(strokeAllows(u, 'min', u.max + 30), false);
  assert.equal(strokeAllows(u, 'min', u.max), false);
  assert.equal(strokeAllows(u, 'max', u.min - 1), false);
  assert.equal(strokeAllows(u, 'min', -5), false);
  assert.equal(strokeAllows(u, 'min', u.min + 1), true);
  assert.equal(strokeAllows(u, 'max', u.max + 50), true);
});

/** A simulation of doc, with its whole-cycle sweep. */
function simOf(doc) { const s = new Simulation(); s.reset(doc); s.getSweep(); return s; }

test('A typed input out of reach goes to the nearest one: actuator stroke, slider rail, rocker limits', () => {
  // the boom's cylinder: 30 and 200 mm are outside its stroke
  const boom = exampleBoom(), u = boom.actuators[0];
  const sb = simOf(boom);
  sb.goTo(30); assert.ok(Math.abs(sb.theta - u.min) < 1e-6, `s = ${sb.theta}, shortest ${u.min}`);
  sb.goTo(200); assert.ok(Math.abs(sb.theta - u.max) < 1e-6, `s = ${sb.theta}, longest ${u.max}`);
  assert.ok(Number.isFinite(sb.results.links.get(boom.links[0].id).omega));
  // a slider-crank pushed at its slider: no further than the ends of its travel
  const { doc: sc } = makeSliderCrank({ a: 40, b: 120, c: 0, theta2: 1 });
  assert.ok(setDriverSpec(sc, { type: 'slider', slider: sc.sliders[0].id }));
  const ss = simOf(sc), [lo, hi] = ss.getSweep().limits;
  ss.goTo(hi + 500); assert.ok(Math.abs(ss.theta - hi) < 1e-6, `slider at ${ss.theta}, limit ${hi}`);
  ss.goTo(lo - 500); assert.ok(Math.abs(ss.theta - lo) < 1e-6, `slider at ${ss.theta}, limit ${lo}`);
  // a crank-rocker driven at its rocker: the rocker cannot reach every angle
  const { doc: fr } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: Math.PI / 3 });
  const rocker = fr.links[2];
  assert.ok(setDriverSpec(fr, { type: 'rotary', link: rocker.id, pivot: rocker.joints[0], ref: null }));
  const sr = simOf(fr), sw = sr.getSweep();
  assert.equal(sw.fullTurn, false);
  const [a0, a1] = sw.limits;
  sr.goTo(a1 + 1); assert.ok(Math.abs(sr.theta - a1) < 1e-6, `rocker at ${sr.theta}, limit ${a1}`);
  // an angle a whole turn away is the same position, not out of reach
  const mid = (a0 + a1) / 2;
  assert.ok(Math.abs(sr.reachable(mid + 2 * Math.PI) - mid) < 1e-9);
});

/** The lesson drawing with its ground link drawn as a link between the pivots. */
function lessonFourbar({ groundLink = false } = {}) {
  const doc = deserialize(fs.readFileSync(new URL('../../../docs/tutorial/files/fourbar.linklab.json', import.meta.url), 'utf8'));
  if (groundLink) addLink(doc, doc.joints.filter((j) => j.ground).map((j) => j.id));
  const sim = simOf(doc);
  return { doc, sim, app: { doc, sim, linkNumbers: () => linkNumbers(doc), currentBodies: () => doc.bodies, currentConstruction: () => doc.construction } };
}

/** The files in a stored (uncompressed) zip, by name: their text. */
function zipFiles(bytes) {
  const out = {}, b = Buffer.from(bytes);
  for (let i = 0; i + 30 < b.length;) {
    if (b.readUInt32LE(i) !== 0x04034b50) break;
    const size = b.readUInt32LE(i + 18), nl = b.readUInt16LE(i + 26), xl = b.readUInt16LE(i + 28);
    const name = b.toString('latin1', i + 30, i + 30 + nl), start = i + 30 + nl + xl;
    out[name] = b.toString('latin1', start, start + size);
    i = start + size;
  }
  return out;
}

test('A frame link (ground drawn as a link) is listed once in the parameters and is the frame part in the CAD zip', () => {
  const { app } = lessonFourbar({ groundLink: true });
  const P = mechanismParameters(app);
  const numbers = P.links.map((l) => l.number);
  assert.deepEqual(numbers, [...new Set(numbers)], `link numbers ${numbers}`);
  assert.equal(P.links[0].kind, 'ground (drawn as a link)');
  const files = zipFiles(partsZip(app).bytes);
  assert.ok(!('Link1.dxf' in files), Object.keys(files).join(', '));
  assert.ok(dxfEntities(files['Frame.dxf'])['LINE@LINKS'] >= 2, 'the frame link outline is in Frame.dxf');
  assert.equal(dxfEntities(files['Frame.dxf'])['CIRCLE@PIN_HOLES'], 2, 'one hole per ground pivot');
});

test('CAD parts: the traced coupler point has a hole; the README names joints J1… and shows no -0.000', () => {
  const { app } = lessonFourbar();
  const files = zipFiles(partsZip(app).bytes);
  assert.equal(dxfEntities(files['Link3.dxf'])['CIRCLE@PIN_HOLES'], 3);
  const readme = files['README.txt'];
  assert.ok(/J3: local/.test(readme) && /length J3-J4: 120\.000 mm/.test(readme), readme);
  assert.ok(!/-0\.000/.test(readme), 'no negative zero');
  assert.ok(/coupler point \(traced\)/.test(readme));
  // the boom: its actuator and stroke are in the README
  const doc = exampleBoom(), sim = simOf(doc);
  const boom = zipFiles(partsZip({ doc, sim, linkNumbers: () => linkNumbers(doc), currentBodies: () => doc.bodies, currentConstruction: () => doc.construction }).bytes)['README.txt'];
  assert.ok(/Linear actuator 1/.test(boom) && /stroke: shortest 62\.430 mm, longest 115\.940 mm/.test(boom), boom);
});
