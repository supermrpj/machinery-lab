// Plot axis ticks: always at least two labels to read a scale from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceTicks, angleTicks, stepTicks } from '../src/linePlot.js';

test('nice ticks cover the range in round steps', () => {
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(0.3, 25, 3), [10, 20]);
  assert.deepEqual(niceTicks(-1.2, 1.2, 4), [-1, 0, 1]);
});

test('angle ticks: 30/45/60/90 as the width allows; spacing by hand', () => {
  assert.deepEqual(angleTicks(0, 360, 80), [0, 90, 180, 270, 360]);
  assert.deepEqual(angleTicks(0, 360, 50), [0, 60, 120, 180, 240, 300, 360]);
  assert.deepEqual(angleTicks(0, 360, 40), [0, 45, 90, 135, 180, 225, 270, 315, 360]);
  assert.deepEqual(angleTicks(0, 360, 20), [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360]);
  assert.deepEqual(angleTicks(37.4, 397.4, 80), [90, 180, 270, 360]); // from here: on whole multiples
  assert.deepEqual(stepTicks(-1.2, 2.5, 0.5), [-1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5]);
});
