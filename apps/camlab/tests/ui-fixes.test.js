// =============================================================================
// Fixes from a user-level review of the built app (the parts that can be
// checked without a browser): segments past 360°, sizes that make no cam,
// number formats, naming the added dwell, one row per angle in exported data,
// changed-since-loaded, the cam angle kept within 0…360°, and the lessons
// quoting the app's own limit and numbers.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepare, segmentName, sampleGrid, evaluate, toTime } from '../src/model/program.js';
import { createDocument, EXAMPLES } from '../src/model/document.js';
import { analyse, valuesAt } from '../src/model/analysis.js';
import { dataCsv, BOM } from '../src/ui/dialogs.js';
import { showNum } from '../src/ui/numbers.js';
import { RULES } from '../src/config.js';
import { App } from '../src/app.js';

const DEG = 180 / Math.PI;
const stubUI = () => ({ refresh() {}, flash() {}, selectedSegment: -1 });

test('a segment wholly past 360° is left out and said, with no error', () => {
  for (const beta of [180, 200, 270]) {
    const d = createDocument();
    d.program.segments[0].beta = beta;
    const r = analyse(d);
    assert.ok(r.prep.segments.length < d.program.segments.length, `β = ${beta}: the last segment is dropped`);
    const total = r.problems.find((p) => p.kind === 'total');
    assert.ok(total && total.over, 'an over-360° message');
    assert.match(total.text, /more than one turn/);
    assert.match(total.text, beta === 270 ? /including all of segments 3 and 4\.$/ : /including all of segment 4\.$/);
    // every prepared segment ends by 360°, and the samples cover exactly one turn
    assert.ok(r.prep.segments.every((sg) => sg.end <= 360 + 1e-9));
    assert.equal(r.samples[r.samples.length - 1].deg, 360);
  }
});

test('sizes that make no cam are size problems (ε ≥ Rp, Rf ≥ Rp, Rp = 0.5)', () => {
  const cases = [{ e: 80 }, { Rf: 100 }, { Rp: 0.5 }];
  for (const c of cases) {
    const d = createDocument();
    Object.assign(d.follower, c);
    const r = analyse(d);
    assert.ok(r.problems.some((p) => p.kind === 'size'), JSON.stringify(c));
  }
  assert.ok(!analyse(createDocument()).problems.some((p) => p.kind === 'size'), 'the new design is fine');
});

test('an open program says how far off it ends, in the design units, with a minus-free wording', () => {
  const d = createDocument();
  d.program.segments[3].h = 40; // the fall goes 15 mm too far
  let r = analyse(d);
  const lv = r.problems.find((p) => p.kind === 'level');
  assert.equal(lv.text, 'The follower ends 15 mm below where it started: the program does not close.');
  d.units = 'us';
  r = analyse(d);
  assert.match(r.problems.find((p) => p.kind === 'level').text, /^The follower ends 0\.5906 in below/);
  // a segment's own message uses the minus sign
  const prep = prepare({ segments: [{ kind: 'rise', law: 'cycloidal', beta: 180, h: -25 }, { kind: 'fall', law: 'cycloidal', beta: 180, h: 25 }] });
  assert.ok(prep.problems.some((p) => p.text.includes('(it is −25)')));
});

test('numbers: one rule — 4 significant figures, whole numbers below 10⁵, powers of ten above', () => {
  assert.equal(showNum(63165.47), '63165'); // lesson 1 quotes 63165 and 96000
  assert.equal(showNum(96000), '96000');
  assert.equal(showNum(814301), '814.3×10³');
  assert.equal(showNum(213183455), '213.2×10⁶');
  assert.equal(showNum(636638944), '636.6×10⁶');
  assert.equal(showNum(99999.9), '100.0×10³');
  assert.equal(showNum(-999999.9), '−1.000×10⁶');
  assert.equal(showNum(24), '24.00');
  assert.equal(showNum(7.62), '7.620'); // lesson 3
  assert.equal(showNum(50), '50.00');
  assert.equal(showNum(33.931), '33.93');
  // a reading with the scale of its quantity: below its last figure, round-off reads 0
  assert.equal(showNum(-6.156e-13, 2513), '0');
  assert.equal(showNum(-0.000024, 200), '0');
  assert.equal(showNum(0.4, 2513), '0');
  assert.equal(showNum(0.6, 2513), '0.6000');
  assert.equal(showNum(-0.5, 200), '−0.5000');
  assert.equal(showNum(4.888, 25), '4.888'); // as the cam's readout
  assert.equal(showNum(NaN), '—');
});

test('the dwell that pads a short program is named, not numbered', () => {
  const prep = prepare({ segments: [{ kind: 'rise', law: 'cycloidal', beta: 180, h: 10 }, { kind: 'fall', law: 'cycloidal', beta: 90, h: 10 }] });
  assert.equal(segmentName(prep, 1), 'segment 2');
  assert.equal(segmentName(prep, 2), 'the added dwell');
});

test('exported data: always 1441 rows at exactly 0, 0.25, … 360°, the right-hand value at a join', () => {
  const programs = [
    createDocument().program.segments,
    [{ kind: 'rise', law: 'cycloidal', beta: 33.3, h: 10 }, { kind: 'dwell', beta: 100.1 }, { kind: 'fall', law: 'cycloidal', beta: 66.6, h: 10 }, { kind: 'dwell', beta: 160 }],
    [{ kind: 'rise', law: 'cycloidal', beta: 2, h: 1 }, { kind: 'fall', law: 'cycloidal', beta: 2, h: 1 }, { kind: 'dwell', beta: 356 }],
    [{ kind: 'dwell', beta: 100 }, { kind: 'dwell', beta: 100 }], // padded to 360°
  ];
  for (const segments of programs) {
    const d = createDocument(); d.program.segments = segments;
    const app = { doc: d, result: () => analyse(d), units: { L: { label: 'mm', show: (v) => v }, V: { label: 'mm/s', show: (v) => v }, A: { label: 'mm/s²', show: (v) => v }, J: { label: 'mm/s³', show: (v) => v }, F: { label: 'N', show: (v) => v }, T: { label: 'N·m', show: (v) => v } } };
    const lines = dataCsv(app).trim().split('\n');
    assert.ok(!lines[0].startsWith(BOM), 'the mark is added on download only');
    const degs = lines.slice(1).map((l) => +l.split(',')[0]);
    assert.equal(degs.length, 1441);
    degs.forEach((x, i) => assert.equal(x, i * 0.25));
  }
  const g = sampleGrid(analyse(createDocument()).prep);
  assert.equal(g.find((x) => x.deg === 90).segment, 1, 'at 90° the rise (segment 2) that starts there');
  assert.equal(BOM, '\uFEFF');
});

test('replacing the design asks only when it was changed since it was opened or saved', () => {
  const app = new App(stubUI());
  assert.equal(app.dirty, false, 'a new design');
  app.loadExample(EXAMPLES[0].id);
  assert.equal(app.dirty, false, 'an example as opened');
  app.loadExample(EXAMPLES[1].id);
  assert.equal(app.dirty, false, 'another example right after');
  app.edit('Prime circle', (d) => { d.follower.Rp = 80; });
  assert.equal(app.dirty, true);
  app.undo();
  assert.equal(app.dirty, false, 'undone back to the example');
});

test('the cam angle is kept within 0…360°, and 360 stays 360 (end of the slider)', () => {
  const app = new App(stubUI());
  app.setTheta(450); assert.equal(app.theta, 90);
  app.setTheta(-30); assert.equal(app.theta, 330);
  app.setTheta(360); assert.equal(app.theta, 360);
  app.setTheta(0); assert.equal(app.theta, 0);
  app.setTheta(359.75 + 0.5); assert.ok(Math.abs(app.theta - 0.25) < 1e-9);
});

test('lesson 2 quotes the app’s pressure-angle limit and numbers', () => {
  const text = fs.readFileSync(new URL('../../../docs/tutorial/camlab-2-sizing.md', import.meta.url), 'utf8');
  const lim = RULES.pressureAngleMaxDeg;
  assert.ok(text.includes(`±${lim}°`), `the lesson names ±${lim}°`);
  assert.ok(!/\b30°/.test(text), 'no other limit');
  const phi = (Rp, law = 'cycloidal') => {
    const d = createDocument();
    d.follower.Rp = Rp; d.program.segments[1].law = law; d.program.segments[3].law = law;
    const r = analyse(d);
    const sizeOk = r.shape.phiMax * DEG <= lim && -r.shape.phiMin * DEG <= lim && !r.shape.undercut;
    return { text: `${(r.shape.phiMax * DEG).toFixed(2)}°`, sizeOk, rhoMin: r.shape.rhoMin.toFixed(2) };
  };
  const p75 = phi(75), p50 = phi(50), p30 = phi(30), shm = phi(30, 'shm');
  for (const [p, rho] of [[p75, true], [p50, true], [p30, true]]) {
    assert.ok(text.includes(p.text), p.text);
    if (rho) assert.ok(text.includes(`${p.rhoMin} mm`), p.rhoMin);
  }
  assert.ok(p75.sizeOk && p50.sizeOk && !p30.sizeOk, 'fine, fine, needs attention');
  assert.ok(text.includes(shm.text) && shm.sizeOk, `simple harmonic at Rp 30: ${shm.text}, within the limit`);
  assert.match(text, /Pressure angle and curvature fine/);
});

test('an unknown segment kind is said and taken as a dwell; an unknown law is taken as cycloidal', () => {
  const prep = prepare({ segments: [{ kind: 'spin', beta: 90, h: 10 }, { kind: 'rise', law: 'bogus', beta: 90, h: 10 }, { kind: 'dwell', beta: 90 }, { kind: 'fall', law: 'cycloidal', beta: 90, h: 10 }] });
  const texts = prep.problems.filter((p) => p.kind === 'segment').map((p) => p.text);
  assert.ok(texts.includes('Segment 1: unknown kind "spin". It is taken as a dwell.'), texts.join(' | '));
  assert.equal(prep.segments[0].kind, 'dwell');
  assert.equal(prep.segments[0].s1, 0, 'no lift');
  assert.equal(prep.segments[1].law, 'cycloidal');
});

test('the readings at the cursor are exact at θ (not the nearest plotted point)', () => {
  const d = createDocument(), r = analyse(d);
  const x = valuesAt(d, r, 154.77);
  const want = toTime(evaluate(r.prep, 154.77), r.omega);
  assert.equal(x.t.v, want.v);
  assert.equal(showNum(x.t.v, 200), '118.9');
  // the cam force at θ is the plots' formula: equal to the plotted value at a plotted angle
  const i = r.samples.findIndex((sm) => sm.deg === 120);
  assert.ok(Math.abs(valuesAt(d, r, 120).F - r.forces.rows[i].F) < 1e-9);
});

test('lesson 3 says where the smallest cam force is, as the app shows it', () => {
  const text = fs.readFileSync(new URL('../../../docs/tutorial/camlab-3-dynamics.md', import.meta.url), 'utf8');
  const at = (rpm) => { const d = createDocument(); d.motion.omega = (rpm * 2 * Math.PI) / 60; return analyse(d).forces; };
  const f600 = at(600), f900 = at(900);
  assert.ok(text.includes(`${showNum(f600.Fmin)} N, at\n${f600.FminAt}°`) || text.includes(`${showNum(f600.Fmin)} N, at ${f600.FminAt}°`), `600 rpm: ${showNum(f600.Fmin)} at ${f600.FminAt}`);
  assert.ok(f600.FminAt > 270, 'on the fall');
  assert.ok(text.includes(`${showNum(f900.Fmin)} N (at ${f900.FminAt}°`), `900 rpm: ${showNum(f900.Fmin)} at ${f900.FminAt}`);
  // the rise's smallest force, near its top
  const rise = f600.rows.filter((x) => x.deg > 90 && x.deg < 180).reduce((a, b) => (b.F < a.F ? b : a));
  assert.ok(text.includes(`(${rise.deg}°)`) && text.includes(`${showNum(rise.F)} N`), `rise: ${showNum(rise.F)} at ${rise.deg}`);
  assert.ok(text.includes('0.01200 N·s/mm'));
});
