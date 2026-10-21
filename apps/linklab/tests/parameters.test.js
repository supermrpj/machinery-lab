// =============================================================================
// Link parameter export: lengths, angles, ω, α and joint accelerations must
// match Norton's closed-form fourbar solution; the CSV must hold every table;
// clearing the sheet must leave a valid, empty document.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoDriver, addPair, addWheel, addJoint, clearDocument, createDocument } from '../src/model/document.js';
import { addConstruction } from '../src/model/construction.js';
import { Simulation } from '../src/model/simulation.js';
import { fourbarVelocity, fourbarAcceleration } from '../src/kinematics/fourbar.js';
import { mechanismParameters, parametersCSV, parametersJSON } from '../src/export/parameters.js';
import { exampleBoom, exampleRackPinion } from '../src/model/examples.js';
import { makeFourbar, makeSliderCrank } from './helpers.js';

const DEG = Math.PI / 180;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

function appFor(doc, omega = 10, alpha = 0) {
  autoDriver(doc);
  doc.motion.omega = omega; doc.motion.alpha = alpha;
  const sim = new Simulation();
  sim.reset(doc);
  return { doc, sim, version: 'test' };
}

test('fourbar: lengths, angles, ω, α and joint accelerations match Norton', () => {
  const a = 40, b = 120, c = 80, d = 100, th2 = 60 * DEG, w2 = 10, al2 = 5;
  const { doc, O2, O4, A, B, sol } = makeFourbar({ a, b, c, d, theta2: th2 });
  const app = appFor(doc, w2, al2);
  assert.ok(app.sim.drivable);
  const P = mechanismParameters(app);

  // joints carry the textbook labels
  const byNorton = Object.fromEntries(P.joints.filter((j) => j.label).map((j) => [j.label, j]));
  assert.deepEqual(Object.keys(byNorton).sort(), ['A', 'B', 'O2', 'O4']);
  close(byNorton.A.x, a * Math.cos(th2), 1e-6, 'A.x');

  // links: ground, 2, 3, 4 with the right lengths
  const L = Object.fromEntries(P.links.map((l) => [l.number, l]));
  close(L[1].length, d, 1e-6, 'd'); close(L[2].length, a, 1e-6, 'a');
  close(L[3].length, b, 1e-6, 'b'); close(L[4].length, c, 1e-6, 'c');

  // angles measured from the ground pivot (input from O2, rocker from O4)
  assert.equal(L[2].from, byNorton.O2.name);
  assert.equal(L[4].from, byNorton.O4.name);
  close(L[2].angle, 60, 1e-6, 'θ2');
  close(Math.cos(L[4].angle * DEG), Math.cos(sol.theta4), 1e-6, 'cos θ4'); close(Math.sin(L[4].angle * DEG), Math.sin(sol.theta4), 1e-6, 'sin θ4');
  const th3 = (L[3].from === byNorton.A.name ? L[3].angle : L[3].angle - 180) * DEG;

  // velocity and acceleration against the closed form
  const { omega3, omega4 } = fourbarVelocity(a, b, c, th2, sol.theta3, sol.theta4, w2);
  const { alpha3, alpha4 } = fourbarAcceleration(a, b, c, th2, sol.theta3, sol.theta4, w2, omega3, omega4, al2);
  close(Math.cos(th3), Math.cos(sol.theta3), 1e-6, 'cos θ3'); close(Math.sin(th3), Math.sin(sol.theta3), 1e-6, 'sin θ3');
  close(L[2].omega, w2, 1e-9, 'ω2'); close(L[2].alpha, al2, 1e-9, 'α2');
  close(L[3].omega, omega3, 1e-5, 'ω3'); close(L[4].omega, omega4, 1e-5, 'ω4');
  close(L[3].alpha, alpha3, 1e-4, 'α3'); close(L[4].alpha, alpha4, 1e-4, 'α4');

  // acceleration of A: tangential + normal (Norton 7.4)
  const Aax = -a * al2 * Math.sin(th2) - a * w2 * w2 * Math.cos(th2);
  const Aay = a * al2 * Math.cos(th2) - a * w2 * w2 * Math.sin(th2);
  close(byNorton.A.ax, Aax, 1e-5, 'A ax'); close(byNorton.A.ay, Aay, 1e-5, 'A ay');
  // acceleration of B from the rocker
  const Bax = -c * alpha4 * Math.sin(sol.theta4) - c * omega4 * omega4 * Math.cos(sol.theta4);
  close(byNorton.B.ax, Bax, 1e-4, 'B ax');

  // geometry in the link frame: the far joint lies on +u at the link length
  const far = L[3].points.find((p) => p.joint === L[3].to);
  close(far.u, b, 1e-6, 'u'); close(far.v, 0, 1e-6, 'v');

  // connections: four pins
  assert.equal(P.connections.filter((x) => x.type === 'pin').length, 4);
  assert.equal(P.mechanism.gruebler_M, 1);
  assert.equal(P.input.value_unit, 'deg');
  close(P.input.value, 60, 1e-6, 'input value');
});

test('CSV holds every table; JSON round-trips', () => {
  const { doc } = makeSliderCrank({ a: 40, b: 120, c: 10, theta2: 30 * DEG });
  const P = mechanismParameters(appFor(doc));
  const csv = parametersCSV(P);
  for (const h of ['JOINTS', 'LINKS', 'LINK GEOMETRY', 'DISTANCES', 'CONNECTIONS']) assert.ok(csv.includes(h), h);
  assert.ok(/\r\nslider,slider 1,J\d,/.test(csv), 'slider row');
  const slider = P.connections.find((x) => x.type === 'slider');
  assert.ok(Number.isFinite(slider.velocity) && Number.isFinite(slider.acceleration));
  assert.deepEqual(JSON.parse(parametersJSON(P)).links.length, P.links.length);
});

test('plates, wheels, actuators and an undrivable drawing', () => {
  // the boom: an actuator input
  const P = mechanismParameters(appFor(exampleBoom()));
  const act = P.connections.find((x) => x.type === 'linear actuator');
  assert.ok(act && act.note === 'the input' && act.length > act.min && act.length < act.max);
  assert.equal(P.input.value_unit, 'mm');
  // rack and pinion: a wheel and a roll joint
  const R = mechanismParameters(appFor(exampleRackPinion()));
  assert.ok(R.links.some((l) => l.kind === 'wheel' && l.radius > 0));
  assert.ok(R.connections.some((x) => x.type.startsWith('roll')));
  // a single free link: positions, but no velocities
  const doc = createDocument();
  addJoint(doc, 0, 0); addJoint(doc, 10, 0);
  doc.links.push({ id: 'L9', joints: [doc.joints[0].id, doc.joints[1].id] });
  const F = mechanismParameters(appFor(doc));
  assert.equal(F.joints[0].vx, null);
  assert.ok(F.note.length > 0);
  close(F.links[0].length, 10, 1e-9, 'length');
});

test('clearing the sheet', () => {
  const { doc } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: 1 });
  const coupler = doc.links[1].id;
  addConstruction(doc, 'segment', { a: { x: 0, y: 0 }, b: { x: 50, y: 0 } });
  const circ = addConstruction(doc, 'circle', { c: { x: 0, y: 0 }, r: 20 }, coupler);
  // a wheel rolling on a construction circle keeps that circle when construction is cleared
  const W = addJoint(doc, 0, 40, { ground: true });
  const wheel = addWheel(doc, W.id, 20);
  addPair(doc, { type: 'roll', a: { kind: 'disc', link: wheel.id }, b: { kind: 'entity', id: circ.id } });
  doc.background = { image: 'data:', x: 0, y: 0, mmPerPx: 1, rotation: 0, opacity: 0.5 };

  const c1 = structuredClone(doc);
  assert.equal(clearDocument(c1, 'construction').kept, 1);
  assert.equal(c1.construction.length, 1);
  assert.equal(c1.links.length, doc.links.length);

  const c2 = structuredClone(doc);
  clearDocument(c2, 'mechanism');
  assert.equal(c2.joints.length + c2.links.length + c2.pairs.length, 0);
  assert.equal(c2.construction.length, 2);
  assert.ok(c2.construction.every((e) => e.attach === null));
  assert.ok(c2.background);

  const c3 = structuredClone(doc);
  clearDocument(c3, 'all');
  assert.equal(c3.joints.length + c3.construction.length, 0);
  assert.equal(c3.background, null);
  assert.equal(c3.meta.title, doc.meta.title);
  const sim = new Simulation(); sim.reset(c3); // an empty sheet is still a valid document
});
