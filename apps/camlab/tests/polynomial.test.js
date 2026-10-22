// =============================================================================
// Polynomial segments: boundary conditions with any value (v, a, j per radian
// of cam), the conditions behind a 3-4-5 or 4-5-6-7 rise or fall, and the
// linear system shown under "Show the calculation".
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, polyConditions } from '../src/model/program.js';
import { polyFromConditions, polyMatrix } from '../src/model/laws.js';

const close = (a, b, tol = 1e-9, what = '') => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`);

test('a rise and a fall with a polynomial law: their conditions give back their coefficients', () => {
  const prep = prepare({ segments: [
    { kind: 'rise', law: 'poly345', beta: 90, h: 20 }, { kind: 'dwell', beta: 90 },
    { kind: 'fall', law: 'poly4567', beta: 120, h: 20 }, { kind: 'dwell', beta: 60 }] });
  for (const k of [0, 2]) {
    const ps = prep.segments[k];
    const conds = polyConditions(ps);
    assert.equal(conds.length, ps.poly.length, `segment ${k + 1}: one condition per coefficient`);
    const b = (ps.beta * Math.PI) / 180;
    const c = polyFromConditions(conds.map((q) => ({ x: q.at, d: q.d, value: q.value * b ** q.d })));
    c.forEach((v, i) => close(v, ps.poly[i], 1e-9, `segment ${k + 1} C${i}`));
  }
  // a cycloidal rise has no polynomial, so no conditions
  assert.equal(polyConditions(prepare({ segments: [{ kind: 'rise', law: 'cycloidal', beta: 180, h: 10 }, { kind: 'fall', law: 'cycloidal', beta: 180, h: 10 }] }).segments[0]), null);
});

test('a polynomial meets velocity, acceleration and jerk conditions that are not zero (per radian of cam)', () => {
  const v1 = 12, a0 = -30, j1 = 400;   // mm/rad, mm/rad², mm/rad³
  const prep = prepare({ segments: [
    { kind: 'poly', beta: 100, conditions: [
      { at: 0, d: 0, value: 0 }, { at: 0, d: 1, value: 0 }, { at: 0, d: 2, value: a0 },
      { at: 1, d: 0, value: 15 }, { at: 1, d: 1, value: v1 }, { at: 1, d: 3, value: j1 }, { at: 0.4, d: 0, value: 4 }] },
    { kind: 'dwell', beta: 260 }] });
  const ps = prep.segments[0];
  assert.ok(ps.poly, 'solved');
  close(ps.f(0).a, a0, 1e-9, 'a at the start');
  close(ps.f(1).s, 15, 1e-9, 's at the end');
  close(ps.f(1).v, v1, 1e-9, 'v at the end');
  close(ps.f(1).j, j1, 1e-9, 'j at the end');
  close(ps.f(0.4).s, 4, 1e-9, 's at 40 %');
});

test('the system shown under "Show the calculation" is the one solved', () => {
  const conds = [{ x: 0, d: 0, value: 0 }, { x: 0, d: 1, value: 0 }, { x: 1, d: 0, value: 1 }, { x: 1, d: 2, value: 0 }];
  const { A, b } = polyMatrix(conds);
  assert.deepEqual(A, [[1, 0, 0, 0], [0, 1, 0, 0], [1, 1, 1, 1], [0, 0, 2, 6]]);
  assert.deepEqual(b, [0, 0, 1, 0]);
  const c = polyFromConditions(conds);
  A.forEach((row, i) => close(row.reduce((acc, v, k) => acc + v * c[k], 0), b[i], 1e-12, `row ${i}`));
});
