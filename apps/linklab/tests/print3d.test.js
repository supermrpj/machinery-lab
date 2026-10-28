// Export for 3-D printing (export/print3d.js): closed solids, sensible
// stacking, the snap-fit sizes, and the drawings this version refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFourbar, makeSliderCrank } from './helpers.js';
import { Simulation } from '../src/model/simulation.js';
import { deserialize } from '../src/model/fileio.js';
import { printParts, fitTestParts, printSettings, printProblems, PRINT } from '../src/export/print3d.js';
import { checkClosed } from '../../../packages/cad-export/src/mesh.js';

const simOf = (doc) => { const sim = new Simulation(); sim.reset(doc); return sim; };
const leg = () => deserialize(fs.readFileSync(new URL('../../../site/examples/walking-leg.linklab.json', import.meta.url), 'utf8'));
const crankRocker = () => {
  const { doc, O2 } = makeFourbar({ a: 20, b: 60, c: 45, d: 55, theta2: Math.PI / 3 });
  doc.driver = { type: 'rotary', link: doc.links[0].id, pivot: O2.id, ref: null };
  return doc;
};

function assertSolid(part) {
  const c = checkClosed(part.mesh);
  assert.ok(c.closed, `${part.name}: ${c.open} open and ${c.wrong} badly joined edges`);
  assert.ok(part.mesh.volume() > 0, `${part.name}: the faces point inward`);
  const b = part.mesh.bounds();
  assert.ok(Math.abs(b.min[2]) < 1e-9, `${part.name}: does not sit on the bed`);
}

for (const joint of ['snap', 'hole']) {
  for (const base of ['flat', 'stand']) {
    test(`crank-rocker, ${joint} joints, ${base} base: every part is one closed solid`, () => {
      const doc = crankRocker();
      const res = printParts(doc, simOf(doc), { ...printSettings(doc), joint, base });
      assert.ok(!res.problems, res.problems && res.problems.join(' '));
      const names = res.parts.map((p) => p.name);
      assert.ok(names.includes('Base'));
      assert.equal(names.includes('Stand_print_2'), base === 'stand');
      assert.equal(res.parts.filter((p) => p.layer > 0).length, 3);
      for (const p of res.parts) assertSolid(p);
      // links joined at a joint are never in the same layer
      for (const j of doc.joints.filter((x) => !x.ground)) {
        const [a, b] = doc.links.filter((l) => l.joints.includes(j.id));
        assert.notEqual(res.plan.layer.get(a.id), res.plan.layer.get(b.id));
      }
    });
  }
}

test('walking leg: crank and rocker under the coupler, knob on the crank pin, pen hole in the foot', () => {
  const doc = leg();
  const res = printParts(doc, simOf(doc), printSettings(doc));
  assert.ok(!res.problems, res.problems && res.problems.join(' '));
  const L = (id) => res.plan.layer.get(id);
  const crank = doc.driver.link;
  const coupler = doc.links.find((l) => l.joints.length === 3).id;
  const rocker = doc.links.find((l) => l.id !== crank && l.id !== coupler).id;
  assert.equal(L(coupler), 2);
  assert.equal(L(crank), 1);
  assert.equal(L(rocker), 1);
  assert.equal(res.plan.knob, 'pin');
  const knobPart = res.parts.find((p) => p.knob);
  assert.equal(knobPart.link, coupler);
  // the coupler is the knob's height taller than a plain link
  const h = knobPart.mesh.bounds().max[2];
  assert.ok(Math.abs(h - (printSettings(doc).thickness + PRINT.knob.height)) < 1e-9);
  for (const p of res.parts) assertSolid(p);
});

test('snap-fit sizes: the pin top stays below the top of the part above, the ridge catches', () => {
  const doc = leg();
  const s = printSettings(doc);
  const fit = fitTestParts(doc, s);
  const bar = fit.parts.find((p) => p.name === 'Test_pins');
  const top = bar.mesh.bounds().max[2];
  // part above: from t + layer gap to 2t + layer gap
  assert.ok(top < 2 * s.thickness + PRINT.layerGap, 'the pin sticks out of the part above');
  assert.ok(top > 2 * s.thickness + PRINT.layerGap - 0.5, 'the pin does not reach the recess');
  // the ridge is wider than the hole (it catches) and narrower than the recess (room to sit)
  for (const c of PRINT.fitTest) {
    const ridge = s.pin / 2 + PRINT.snap.lip, hole = (s.pin + c) / 2, recess = s.pin / 2 + PRINT.snap.lip + PRINT.snap.recess;
    assert.ok(ridge - hole >= 0.2 - 1e-9, `clearance ${c}: the ridge overlaps the hole by only ${ridge - hole} mm`);
    assert.ok(recess > ridge);
  }
});

test('fit test: four pieces and a bar of pins (snap), only the pieces for pins or rivets', () => {
  const doc = leg();
  const snap = fitTestParts(doc, { ...printSettings(doc), joint: 'snap' });
  assert.equal(snap.parts.length, 5);
  for (const p of snap.parts) assertSolid(p);
  const hole = fitTestParts(doc, { ...printSettings(doc), joint: 'hole' });
  assert.equal(hole.parts.length, 4);
  for (const p of hole.parts) assertSolid(p);
});

test('refused: sliders, links too narrow for the pins, links too thin for snap-fit', () => {
  const { doc } = makeSliderCrank({ a: 20, b: 60, c: 5, theta2: 1 });
  assert.ok(printProblems(doc).some((m) => /Sliders/.test(m)));
  const fb = crankRocker();
  fb.cad = { linkWidth: 8, pinDiameter: 6 };
  assert.ok(printProblems(fb).some((m) => /too narrow/.test(m)));
  fb.cad = { linkWidth: 12, pinDiameter: 6 };
  fb.dynamics = { ...fb.dynamics, thickness: 3 };
  assert.ok(printProblems(fb).some((m) => /thick/.test(m)));
  assert.equal(printProblems(fb, { ...printSettings(fb), joint: 'hole' }).length, 0);
});

test('binary STL: the header does not start with "solid", and the size matches the triangles', () => {
  const doc = crankRocker();
  const res = printParts(doc, simOf(doc), printSettings(doc));
  const bytes = res.parts[0].mesh.stl('solid test');
  assert.ok(!/^solid/i.test(String.fromCharCode(...bytes.slice(0, 5))));
  const n = new DataView(bytes.buffer).getUint32(80, true);
  assert.equal(bytes.length, 84 + 50 * n);
});
