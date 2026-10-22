// =============================================================================
// Edge cases found by an independent check: short segments sampled finely,
// bad values from a file said (never changed in silence), and no DXF lines
// for a mounting that does not fit.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, sample, peaks } from '../src/model/program.js';
import { createDocument } from '../src/model/document.js';
import { analyse } from '../src/model/analysis.js';
import { dxf } from '../src/export/cam.js';
import { LAWS } from '../src/model/laws.js';

const prog = (segments) => ({ segments });

test('a 1° modified-sine rise shows its true peak acceleration factor (5.528)', () => {
  const h = 5, beta = 1, b = (beta * Math.PI) / 180;
  const prep = prepare(prog([{ kind: 'rise', law: 'modSine', beta, h }, { kind: 'fall', law: 'modSine', beta, h }, { kind: 'dwell', beta: 358 }]));
  const pk = peaks(sample(prep));
  const Ca = (Math.abs(pk.a.value) * b * b) / h;
  assert.ok(Math.abs(Ca - 5.528) < 0.01, `acceleration factor ${Ca}`);
  // the law's own peak, for reference
  let best = 0; for (let i = 0; i <= 20000; i++) best = Math.max(best, Math.abs(LAWS.modSine.at(i / 20000).a));
  assert.ok(Math.abs(Ca - best) / best < 0.002, `${Ca} vs ${best}`);
});

test('bad segment values are said: zero or non-numeric β, negative h, unknown law', () => {
  const prep = prepare(prog([
    { kind: 'rise', law: 'cycloidal', beta: 0, h: 10 }, { kind: 'fall', law: 'bogus', beta: 'abc', h: -10 },
    { kind: 'dwell', beta: 359.8 }]));
  const texts = prep.problems.filter((p) => p.kind === 'segment').map((p) => p.text);
  assert.ok(texts.some((t) => /Segment 1 is 0° long/.test(t)), texts.join(' | '));
  assert.ok(texts.some((t) => /Segment 2 is "abc" long/.test(t)), texts.join(' | '));
  assert.ok(texts.some((t) => /unknown motion law "bogus"/.test(t)));
  assert.ok(texts.some((t) => /Segment 2: the fall h must be a number above 0/.test(t)));
  assert.equal(prep.segments[1].law, 'cycloidal', 'the law used is the one shown');
  for (const smp of sample(prep)) for (const k of ['s', 'v', 'a', 'j']) assert.ok(Number.isFinite(smp[k]), `${k} finite`);
});

test('a good program has no segment problems', () => {
  const doc = createDocument();
  assert.equal(prepare(doc.program).problems.filter((p) => p.kind === 'segment').length, 0);
});

test('DXF: no set-screw lines when the mounting does not fit', () => {
  const doc = createDocument();
  doc.part = { ...doc.part, mount: 'setscrew', bore: 3, screw: 'M5' };
  const r = analyse(doc);
  assert.ok(r.mount.blocked, 'this mounting does not fit');
  const text = dxf(doc);
  const entities = text.split('ENTITIES')[1] || '';
  assert.ok(!/\nSETSCREW\n/.test(entities), 'no SETSCREW entities');
  assert.ok(!/NaN/.test(text), 'no NaN in the DXF');
});
