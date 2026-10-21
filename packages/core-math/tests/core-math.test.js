import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  circleCircle, lineLine, lineCircle, nearestOnLine, angleInSweep, convexHull,
  solve, rank, dampedLeastSquares, matVec, wrapPi, unwrapNear, rotate, dist,
} from '../src/index.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('circle–circle: two, one and no intersections', () => {
  const two = circleCircle({ x: 0, y: 0 }, 5, { x: 8, y: 0 }, 5);
  assert.equal(two.length, 2);
  for (const p of two) { close(dist(p, { x: 0, y: 0 }), 5); close(dist(p, { x: 8, y: 0 }), 5); }
  assert.equal(circleCircle({ x: 0, y: 0 }, 1, { x: 2, y: 0 }, 1).length, 1);
  assert.equal(circleCircle({ x: 0, y: 0 }, 1, { x: 3, y: 0 }, 1).length, 0);
  assert.equal(circleCircle({ x: 0, y: 0 }, 5, { x: 1, y: 0 }, 1).length, 0);
});

test('line–line and line–circle', () => {
  const r = lineLine({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 2 }, { x: 2, y: 0 });
  close(r.point.x, 1); close(r.point.y, 1);
  assert.equal(lineLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }), null);
  const lc = lineCircle({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 3);
  assert.equal(lc.length, 2);
  close(Math.abs(lc[0].point.x), 3);
  assert.equal(lineCircle({ x: -10, y: 5 }, { x: 10, y: 5 }, { x: 0, y: 0 }, 3).length, 0);
});

test('nearest point on segment is clamped', () => {
  const n = nearestOnLine({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 2, y: 0 }, true);
  close(n.point.x, 2); close(n.point.y, 0);
});

test('angle sweeps, wrapping and unwrapping', () => {
  assert.ok(angleInSweep(0.5, 0, 1));
  assert.ok(!angleInSweep(1.5, 0, 1));
  assert.ok(angleInSweep(-0.5, 0, -1));
  assert.ok(angleInSweep(0.1, 6.2, 0.5)); // sweep crosses 2π
  close(wrapPi(3 * Math.PI), Math.PI);
  close(unwrapNear(0.1, 2 * Math.PI - 0.1), 2 * Math.PI + 0.1);
  const v = rotate({ x: 1, y: 0 }, Math.PI / 2);
  close(v.x, 0); close(v.y, 1);
});

test('convex hull of a square with an inner point', () => {
  const h = convexHull([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0.5, y: 0.5 }]);
  assert.equal(h.length, 4);
});

test('linear solve, singular detection and rank', () => {
  const A = [[2, 1, -1], [-3, -1, 2], [-2, 1, 2]];
  const x = solve(A, [8, -11, -3]);
  close(x[0], 2); close(x[1], 3); close(x[2], -1);
  assert.equal(solve([[1, 2], [2, 4]], [1, 2]), null);
  assert.equal(rank([[1, 2], [2, 4]]), 1);
  assert.equal(rank(A), 3);
});

test('damped least squares: square, under- and over-determined', () => {
  const J = [[3, 1], [1, 2]], f = [1, -1];
  const dx = dampedLeastSquares(J, f, 1e-14);
  const r = matVec(J, dx);
  close(r[0], -1, 1e-9); close(r[1], 1, 1e-9);
  // under-determined: minimum-norm answer
  const u = dampedLeastSquares([[1, 1]], [-2], 1e-14);
  close(u[0], 1, 1e-9); close(u[1], 1, 1e-9);
  // over-determined: least-squares answer
  const o = dampedLeastSquares([[1], [1]], [-1, -3], 1e-14);
  close(o[0], 2, 1e-9);
});
