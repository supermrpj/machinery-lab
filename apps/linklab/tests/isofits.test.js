// ISO 286 fits against published tables (limits in mm).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoFit, parseClass } from '../src/model/isofits.js';

const near = (got, want, msg) => assert.ok(Math.abs(got - want) < 1e-9, `${msg}: ${got} vs ${want}`);

test('H7/g6 Ø10: hole +0.015/0, shaft −0.005/−0.014, clearance 0.005 to 0.029', () => {
  const f = isoFit('H7', 'g6', 10);
  near(f.hole.es, 0.015, 'hole es'); near(f.hole.ei, 0, 'hole ei');
  near(f.shaft.es, -0.005, 'shaft es'); near(f.shaft.ei, -0.014, 'shaft ei');
  near(f.min, 0.005, 'min'); near(f.max, 0.029, 'max'); near(f.mean, 0.017, 'mean');
});

test('H7/f7 Ø25: 0.020 to 0.062; H11/c11 Ø50: 0.130 to 0.450; H8/f7 Ø100: 0.036 to 0.125', () => {
  let f = isoFit('H7', 'f7', 25); near(f.min, 0.020, 'f7 min'); near(f.max, 0.062, 'f7 max');
  f = isoFit('H11', 'c11', 50); near(f.min, 0.130, 'c11 min'); near(f.max, 0.450, 'c11 max');
  f = isoFit('H8', 'f7', 100); near(f.min, 0.036, 'H8/f7 min'); near(f.max, 0.125, 'H8/f7 max');
  // size steps: "up to and including": Ø10 is the 6–10 step, Ø10.5 the 10–18 step
  near(isoFit('H7', 'g6', 10.5).max, 0.035, 'Ø10.5 max'); // H7 +18, g6 −6/−17
  // h: zero upper deviation
  f = isoFit('H7', 'h6', 10); near(f.min, 0, 'h6 min'); near(f.max, 0.024, 'h6 max');
});

test('outside the tables: null', () => {
  assert.equal(isoFit('H7', 'p6', 10), null, 'interference fit not offered');
  assert.equal(isoFit('G7', 'h6', 10), null, 'only H holes');
  assert.equal(isoFit('H7', 'g6', 0), null); assert.equal(isoFit('H7', 'g6', 600), null);
  assert.equal(isoFit('H12', 'g6', 10), null, 'grade not in the table');
  assert.deepEqual(parseClass('h6'), { letter: 'h', grade: 6 }); assert.equal(parseClass('x'), null);
});
