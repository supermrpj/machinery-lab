// Export for 3-D printing (export/print3d.js): closed solids, sensible
// stacking, the clip-pin and snap-pin sizes, and the drawings this version refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFourbar, makeSliderCrank } from './helpers.js';
import { Simulation } from '../src/model/simulation.js';
import { deserialize } from '../src/model/fileio.js';
import { printParts, fitTestParts, printSettings, printProblems, chooseStack, pinMesh, pinFit, bedFit, clipPinMesh, clipMesh, clipFit, clipOutline, clipTravel, layerZ, boltSet, groundBolt, fastener, printZip, PRINT } from '../src/export/print3d.js';
import { fourbarForceBalance, counterweightFor } from '../src/model/balance.js';
import { classify, linkTransform } from '../src/kinematics/index.js';
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

for (const joint of ['bolt', 'clip', 'pins']) {
  for (const base of ['flat', 'stand']) {
    test(`crank-rocker, ${joint} joints, ${base} base: every part is one closed solid`, () => {
      const doc = crankRocker();
      const res = printParts(doc, simOf(doc), { ...printSettings(doc), joint, base });
      assert.ok(!res.problems, res.problems && res.problems.join(' '));
      const names = res.parts.map((p) => p.name);
      assert.ok(names.includes('Base'));
      assert.equal(names.includes('Stand_print_2'), base === 'stand');
      assert.equal(names.includes('Pins'), joint !== 'bolt');
      assert.equal(names.includes('Clips'), joint === 'clip');
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

test('walking leg: crank and rocker under the coupler, pen hole in the foot; snap pins: knob on the crank pin', () => {
  const doc = leg();
  const res = printParts(doc, simOf(doc), { ...printSettings(doc), joint: 'pins' });
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

test('walking leg, clip pins: the crank pin is long, its top is the handle; no part is taller than a link', () => {
  const doc = leg();
  const s = { ...printSettings(doc), joint: 'clip' };
  const res = printParts(doc, simOf(doc), s);
  assert.ok(!res.problems, res.problems && res.problems.join(' '));
  for (const p of res.parts) assertSolid(p);
  assert.equal(res.plan.knob, 'pin');
  for (const p of res.parts.filter((x) => x.layer > 0)) assert.ok(Math.abs(p.mesh.bounds().max[2] - s.thickness) < 1e-9, `${p.name} is not flat`);
  const handle = res.pins.filter((p) => p.handle);
  assert.equal(handle.length, 1);
  // its top stands the knob's height above the top of the part above (u = 0 is cs1 + c/2 above the bottom face)
  const h = handle[0], r = s.pinDrawn / 2, rh = (s.pinDrawn + s.clearance) / 2;
  const cs1 = PRINT.pins.headTop + PRINT.pins.nubRoom + (r + PRINT.pins.head + s.clearance / 2 + 0.1 - rh);
  const top = layerZ(s, res.plan, h.upper) + s.thickness;
  assert.ok(Math.abs(h.bottom + cs1 + s.clearance / 2 + h.uEnd - (top + PRINT.knob.height)) < 1e-9);
  assert.ok(Math.abs(clipPinMesh({ ...s, pin: s.pinDrawn }, h).mesh.bounds().max[0] - h.uEnd) < 1e-9);
});

test('clip pins: the groove is where the clip lies, the tip stays below the top face, the clip clicks on and fits its pocket', () => {
  const doc = leg();
  const s = printSettings(doc);
  const res = printParts(doc, simOf(doc), s);
  const C = PRINT.clip, r = s.pin / 2;
  const u0 = (p) => p.bottom + (PRINT.pins.headTop + PRINT.pins.nubRoom) + (r + PRINT.pins.head + s.clearance / 2 + 0.1 - (s.pin + s.clearance) / 2) + s.clearance / 2;
  for (const p of res.pins) {
    const top = p.bottom + p.grip, floor = top - (C.thickness + C.play + C.tip + C.flushInset);
    const at = (u) => u0(p) + u;                             // height of a point of the pin
    assert.ok(at(p.ug0) < floor && at(p.ug1) >= floor + C.thickness + 0.1, 'the clip does not fit in the groove at the pocket floor');
    if (!p.handle) assert.ok(at(p.uEnd) < top - 0.1 && at(p.uEnd) > top - 0.5, 'the tip is not just below the top face');
    // the head's end is inside the bottom face (flush)
    assert.ok(at(-(PRINT.pins.head + PRINT.pins.headTop)) > p.bottom);
  }
  // the clip: round inside, a mouth narrower than the groove, inside its pocket and the link
  const poly = clipOutline(s, 96), R = poly.map((q) => Math.hypot(q.x, q.y));
  const rg = Math.min(...clipPinMesh(s, clipFit(s, 12.3)).mesh.tris.flatMap((t) => t.v).filter((v) => v[0] > 8 && v[0] < 9).map((v) => Math.hypot(v[1], v[2])));
  assert.ok(Math.min(...R) > rg, 'the clip is tighter than the groove');
  const mouth = Math.min(...poly.filter((q) => q.x < 0 && Math.abs(q.y) < r).map((q) => Math.abs(q.y)));
  assert.ok(rg - mouth >= C.grip - 1e-9, 'the mouth does not grip the groove');
  assert.ok(Math.max(...R) + C.pocketGap <= s.width / 2 - C.wall);
  // laid in the far end of its pocket, the clip clears the pin's tip
  const d = clipTravel(s);
  for (let i = 0; i < poly.length; i++) assert.ok(Math.hypot(poly[i].x + d, poly[i].y) > r);
  // a clip is flat and as thick as set
  const b = clipMesh(s).bounds();
  assert.ok(Math.abs(b.max[2] - C.thickness) < 1e-9 && Math.abs(b.min[2]) < 1e-9);
});

test('snap pins: the ridge catches, the fingers bend gently, the tip stays below the top of the part above', () => {
  const doc = leg();
  const s = { ...printSettings(doc), joint: 'pins' };
  const N = PRINT.snapPin, r = s.pin / 2;
  const ridge = r + N.lip, hole = (s.pin + s.clearance) / 2, recess = r + N.lip + N.recess;
  assert.ok(ridge - hole >= 0.2 - 1e-9, `the ridge overlaps the hole by only ${ridge - hole} mm`);
  for (const c of PRINT.fitTest) assert.ok(ridge > (s.pin + c) / 2, `clearance ${c}: the ridge does not catch`);
  assert.ok(recess > ridge);
  // each finger is a cantilever from the slot's end to the ridge: strain 3·δ·c/L² at the chosen clearance
  const grip = 2 * s.thickness + PRINT.layerGap, fit = pinFit(s, grip);
  const c2 = (r - N.slotWidth / 2) / 2, Lf = fit.uc - fit.us, strain = (3 * (ridge - hole) * c2) / (Lf * Lf);
  assert.ok(strain < 0.02, `the fingers bend ${(100 * strain).toFixed(1)} %`);
  // the tip is inside the part with the recess
  const m = pinMesh(s, fit.uc, fit.us).mesh.bounds();
  const tip = m.max[0];
  const recessDepth = N.axialPlay + N.catchHeight + N.band + N.lip + N.topInset + N.flushInset;
  assert.ok(tip < fit.uc + recessDepth);
});

test('fit test: four pieces, a bar with matching holes, pins (and clips); only the pieces for bolts', () => {
  const doc = leg();
  const clip = fitTestParts(doc, { ...printSettings(doc), joint: 'clip' });
  assert.deepEqual(clip.parts.map((p) => p.name).slice(4), ['Test_bar', 'Test_pins', 'Test_clips']);
  const pins = fitTestParts(doc, { ...printSettings(doc), joint: 'pins' });
  assert.deepEqual(pins.parts.map((p) => p.name).slice(4), ['Test_bar', 'Test_pins']);
  const bolt = fitTestParts(doc, { ...printSettings(doc), joint: 'bolt' });
  assert.equal(bolt.parts.length, 4);
  for (const p of [...clip.parts, ...pins.parts, ...bolt.parts]) assertSolid(p);
});

test('settings: bolts by default; the old pins on the links get clip pins, the old plain holes get bolts', () => {
  const doc = leg();
  doc.print = { joint: 'snap', clearance: 0.25 };
  assert.equal(printSettings(doc).joint, 'clip');
  assert.equal(printSettings(doc).clearance, 0.25);
  doc.print = { joint: 'pins' };
  assert.equal(printSettings(doc).joint, 'pins');
  assert.equal(printSettings(doc).pin, 6);                   // printed pins: the drawing's pin diameter
  doc.print = { joint: 'hole' };
  assert.equal(printSettings(doc).joint, 'bolt');
  doc.print = {};
  const s = printSettings(doc);
  assert.equal(s.joint, 'bolt');
  // the leg's pins are 6 mm, but M6 and M5 countersinks do not fit its 12 mm links: M4
  assert.equal(s.bolt, 'M4');
  assert.equal(s.pin, 4);
  doc.print = { bolt: 'M3' };
  assert.equal(printSettings(doc).pin, 3);
});

test('refused: sliders, links too narrow for the pins, links too thin for snap-fit', () => {
  const { doc } = makeSliderCrank({ a: 20, b: 60, c: 5, theta2: 1 });
  assert.ok(printProblems(doc).some((m) => /Sliders/.test(m)));
  const fb = crankRocker();
  fb.cad = { linkWidth: 8, pinDiameter: 6 };
  assert.ok(printProblems(fb).some((m) => /too narrow/.test(m)));
  fb.cad = { linkWidth: 12, pinDiameter: 6 };
  fb.dynamics = { ...fb.dynamics, thickness: 3 };
  assert.ok(printProblems(fb, { ...printSettings(fb), joint: 'clip' }).some((m) => /Clip pins need links at least/.test(m)));
  assert.ok(printProblems(fb, { ...printSettings(fb), joint: 'pins' }).some((m) => /Snap pins need links at least/.test(m)));
  assert.ok(printProblems(fb, { ...printSettings(fb), bolt: 'M4' }).some((m) => /countersunk bolts need links at least/.test(m)));
  fb.dynamics = { ...fb.dynamics, thickness: 6 };
  assert.ok(printProblems(fb, { ...printSettings(fb), bolt: 'M6' }).some((m) => /too narrow for M6/.test(m)));
  assert.equal(printProblems(fb, { ...printSettings(fb), bolt: 'M4' }).length, 0);
});

test('binary STL: the header does not start with "solid", and the size matches the triangles', () => {
  const doc = crankRocker();
  const res = printParts(doc, simOf(doc), printSettings(doc));
  const bytes = res.parts[0].mesh.stl('solid test');
  assert.ok(!/^solid/i.test(String.fromCharCode(...bytes.slice(0, 5))));
  const n = new DataView(bytes.buffer).getUint32(80, true);
  assert.equal(bytes.length, 84 + 50 * n);
});

/** The walking leg in PLA, balanced in the Balancing tab (counterweights at R mm). */
function balancedLeg(R = 20) {
  const doc = leg();
  doc.dynamics = { ...doc.dynamics, material: 'pla', thickness: 6 };
  const bal = fourbarForceBalance(doc, classify(doc));
  for (const b of [bal.crank, bal.rocker]) {
    const l = doc.links.find((x) => x.id === b.link);
    l.counterweights = [{ id: `cw-${l.id}`, ...counterweightFor(b.add, b.from, b.to, R) }];
  }
  return doc;
}

for (const joint of ['clip', 'pins']) {
  test(`${joint === 'clip' ? 'clip' : 'snap'} pins: one per joint on a closed sheet, shortest first, spares of each length`, () => {
    const doc = leg();
    const s = { ...printSettings(doc), joint };
    const res = printParts(doc, simOf(doc), s);
    assert.ok(!res.problems, res.problems && res.problems.join(' '));
    for (const p of res.parts) assertSolid(p);
    assert.equal(res.pins.length, 4);                       // O2, O4, A, B
    const kinds = new Set(res.pins.map((p) => `${p.grip.toFixed(2)}|${!!p.handle}`));
    assert.equal(res.batch.length, res.pins.length + PRINT.pins.spares * kinds.size);
    assert.equal(res.batch.filter((p) => p.spare).length, PRINT.pins.spares * kinds.size);
    for (let i = 1; i < res.batch.length; i++) assert.ok(res.batch[i].grip >= res.batch[i - 1].grip - 1e-9);
    assert.equal(res.clips, joint === 'clip' ? res.pins.length + PRINT.clip.spares : 0);
    // links have no pins of their own: as thick as the link, except a knob
    for (const p of res.parts.filter((x) => x.layer > 0 && !x.knob)) assert.ok(Math.abs(p.mesh.bounds().max[2] - s.thickness) < 1e-9);
    // a pin lies flat on the bed: as high as its flats are apart
    const pin = joint === 'clip' ? clipPinMesh(s, res.pins[0]).mesh : pinMesh(s, res.pins[0].uc, res.pins[0].us).mesh;
    const b = pin.bounds(), flat = joint === 'clip' ? PRINT.clip.flat : PRINT.snapPin.flat;
    assert.ok(Math.abs(b.max[2] - b.min[2] - 2 * flat * s.pin / 2) < 1e-6);
    // snap pins: the crank pin goes in from below (the knob covers its top); clip pins all go in from below
    assert.equal(res.pins.filter((p) => p.up).length, joint === 'clip' ? 4 : 1);
  });
}

test('counterweights: arms and stacks keep the printed leg\'s centre of mass still', () => {
  for (const joint of ['bolt', 'clip', 'pins']) {
    // (the steel bolts at the moving joints need more counterweight: 25 mm out)
    const doc = balancedLeg(joint === 'bolt' ? 25 : 20);
    const sim = simOf(doc);
    const s = { ...printSettings(doc), joint, pin: undefined };
    const res = printParts(doc, sim, { ...s, counterweights: true });
    assert.ok(!res.problems, res.problems && res.problems.join(' '));
    for (const p of res.parts) assertSolid(p);
    assert.equal(res.stacks.length, 2);
    // independent sum: printed parts (solid PLA), the stacks as sized, separate pins (and clips) at their joints
    const rho = 1240e-6, pos = (id) => doc.joints.find((j) => j.id === id);
    const bodies = [];
    for (const p of res.parts.filter((x) => x.link)) {
      const [cx, cy] = p.mesh.centroid();
      bodies.push({ link: p.link, g: rho * p.mesh.volume(), p: p.Tinv({ x: cx, y: cy }) });
    }
    for (const st of res.stacks) bodies.push({ link: st.link, g: st.grams, p: st.at });
    const sp = res.settings;
    for (const pin of res.pins.filter((x) => !x.joint.ground)) {
      const v = joint === 'clip' ? clipPinMesh(sp, pin).mesh.volume() + clipMesh(sp).volume() : pinMesh(sp, pin.uc, pin.us).mesh.volume();
      bodies.push({ link: doc.links.find((l) => l.joints.includes(pin.joint.id)).id, g: rho * v, p: pos(pin.joint.id) });
    }
    // bolts, washers and nuts at the moving joints, in steel
    for (const b of res.bolts.filter((x) => !x.down)) {
      bodies.push({ link: doc.links.find((l) => l.joints.includes(b.joint.id)).id, g: b.grams, p: pos(b.joint.id) });
    }
    const travel = (list) => {
      let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
      for (const smp of sim.getSweep().samples) {
        let M = 0, X = 0, Y = 0;
        for (const b of list) { const w = linkTransform(sim.sys, smp.q, b.link)(b.p); M += b.g; X += b.g * w.x; Y += b.g * w.y; }
        lo = [Math.min(lo[0], X / M), Math.min(lo[1], Y / M)]; hi = [Math.max(hi[0], X / M), Math.max(hi[1], Y / M)];
      }
      return Math.hypot(hi[0] - lo[0], hi[1] - lo[1]);
    };
    assert.ok(travel(bodies) < 0.05, `${joint}: the centre of mass still moves ${travel(bodies)} mm`);
    // and the hardware is within half a washer of the mass asked for
    for (const st of res.stacks) assert.ok(Math.abs(st.stack.grams - st.grams) <= st.stack.bolt.washer.g / 2 + 1e-9);
  }
});

test('counterweights need the printing material in Forces, and a stack that exists', () => {
  const doc = balancedLeg();
  doc.dynamics.material = 'steel';
  assert.ok(printProblems(doc, { ...printSettings(doc), counterweights: true }).some((m) => /plastic you print/.test(m)));
  assert.equal(printProblems(doc, { ...printSettings(doc), counterweights: false }).length, 0);
  const st = chooseStack(30, 6);
  assert.ok(st && Math.abs(st.grams - 30) <= st.bolt.washer.g / 2);
  assert.equal(chooseStack(0.5, 6), null);                 // lighter than the smallest bolt and nut
});

test('base: a frame round the ground pivots, not a plate under the whole motion', () => {
  const doc = leg();
  const s = printSettings(doc);
  const res = printParts(doc, simOf(doc), s);
  const base = res.parts.find((p) => p.name === 'Base');
  assertSolid(base);
  const b = base.mesh.bounds();
  // the two ground pivots are about 85 mm apart: the frame is that plus a boss and a margin each end
  const g = doc.joints.filter((j) => j.ground), span = Math.hypot(g[0].x - g[1].x, g[0].y - g[1].y);
  const Rb = s.width / 2 - PRINT.ringInset + PRINT.frame.margin;
  assert.ok(Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) <= span + 2 * Rb + 1e-6);
  assert.ok(Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1]) < 0.8 * span);
  assert.ok(bedFit(base.mesh, s).fits);
  // standing up, it still has a straight edge below everything that moves
  const st = printParts(doc, simOf(doc), { ...s, base: 'stand' });
  for (const p of st.parts) assertSolid(p);
});

test('print bed: a part too large is named with its size; a long pin bar is cut into bars', () => {
  const { doc, O2 } = makeFourbar({ a: 60, b: 180, c: 135, d: 165, theta2: Math.PI / 3 });
  doc.driver = { type: 'rotary', link: doc.links[0].id, pivot: O2.id, ref: null };
  const s = { ...printSettings(doc), joint: 'clip' };
  const big = printParts(doc, simOf(doc), s);
  assert.ok(!big.problems, big.problems && big.problems.join(' '));
  assert.ok(!big.plan.notes.some((n) => /does not fit/.test(n)), big.plan.notes.join(' '));   // fits 256 x 256
  for (const p of big.parts) assert.ok(bedFit(p.mesh, s).fits, p.name);
  // on a 150 mm bed the 192 mm coupler still fits, laid corner to corner; the base (192 x 27) does not
  const small = printParts(doc, simOf(doc), { ...s, bedX: 150, bedY: 150 });
  const notes = small.plan.notes.filter((n) => /does not fit the 150 × 150 mm print bed/.test(n));
  assert.deepEqual(notes.map((n) => n.split(':')[0]), ['Base is 192.0 × 27.0 mm'.replace('.0', '').replace('.0', '')]);
  const smaller = printParts(doc, simOf(doc), { ...s, bedX: 120, bedY: 120 });
  assert.ok(smaller.plan.notes.some((n) => /^Link3 is 192 × 12 mm/.test(n)), smaller.plan.notes.join(' '));
  assert.equal(small.pinBars, 1);
  const tiny = printParts(doc, simOf(doc), { ...s, bedX: 60, bedY: 60 });
  assert.ok(tiny.pinBars > 1);
  const pins = tiny.parts.find((p) => p.name === 'Pins');
  assertSolid(pins);
  const b = pins.mesh.bounds();                             // each bar is no longer than the bed (they lie side by side)
  assert.ok(b.max[1] - b.min[1] <= 60 - 2 * PRINT.bedEdge);
});

test('bolts: countersunk up from underneath with a nut on top; at a ground pivot down from the top into a nut under the base', () => {
  const doc = leg();
  const sim = simOf(doc);
  const s = printSettings(doc);                             // bolts, M4
  const res = printParts(doc, sim, s);
  assert.ok(!res.problems, res.problems && res.problems.join(' '));
  for (const p of res.parts) assertSolid(p);
  assert.ok(!res.parts.some((p) => p.name === 'Pins' || p.name === 'Clips'));
  assert.equal(res.bolts.length, 4);                        // O2, O4, A, B
  const F = fastener('M4'), t = s.thickness;
  for (const b of res.bolts) {
    assert.ok(PRINT.boltLengths.includes(b.length));
    if (b.down) {
      // ground pivot: the end stays inside the base, past the nut, and the nut's pocket leaves a roof
      assert.ok(b.end >= PRINT.nutTrap.end - 1e-9);
      assert.ok(Math.abs(b.ceiling - (b.end + PRINT.boltPast + F.nut.m)) < 1e-9);
      assert.ok(layerZ(s, res.plan, b.upper) - PRINT.layerGap - b.ceiling >= PRINT.nutTrap.roof - 1e-9);
    } else {
      // between links: long enough for both faces, the washer, the nut and 1 mm past it
      assert.ok(b.length >= b.grip - PRINT.boltSink + F.washer.h + F.nut.m + PRINT.boltPast - 1e-9);
      assert.ok(b.grams > 1 && b.grams < 10);
    }
  }
  // nothing stands under the parts: every link and the base is flat underneath (its lowest point on the bed),
  // and no link passes over a nut: the coupler, the only link above, passes over the ground pivot of the crank
  assert.ok(!res.plan.notes.some((n) => /passes over a nut/.test(n)));
  // the base is no thicker than the links' lowest layer
  const base = res.parts.find((p) => p.name === 'Base');
  assert.ok(base.mesh.bounds().max[2] <= layerZ(s, res.plan, 1) + 1e-9);
  // the README lists the bolts by length, the washers and the nuts
  const z = printZip({ doc, sim });
  assert.match(z.summary, /4 M4 bolts/);
});

test('bolts: a link that would pass over a nut is put two layers up (bosses lift it clear)', () => {
  const doc = crankRocker();
  const s = printSettings(doc);
  const res = printParts(doc, simOf(doc), s);
  assert.ok(!res.problems, res.problems && res.problems.join(' '));
  for (const p of res.parts) assertSolid(p);
  for (const b of res.bolts.filter((x) => !x.down)) {
    const set = boltSet(s, b.grip);
    assert.ok(Math.abs(set.above - (b.length - (b.grip - PRINT.boltSink))) < 1e-9);
  }
  assert.ok(groundBolt(s, 5) === null);                    // too thin a stack for even the shortest bolt
});
