// =============================================================================
// Cam profile geometry: the profile really is what the follower touches.
//   Roller: every roller position touches the cam surface and never cuts it.
//   Flat face: every face position touches the surface, all of the cam on one side.
//   Radius of curvature: a circle gives its own radius; ρ = Rb + s + a (flat).
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, sample } from '../src/model/program.js';
import { camPoint, camShape } from '../src/model/geometry.js';

const prog = { segments: [
  { kind: 'rise', law: 'cycloidal', beta: 100, h: 20 }, { kind: 'dwell', beta: 60 },
  { kind: 'fall', law: 'poly345', beta: 120, h: 20 }, { kind: 'dwell', beta: 80 },
] };
const sm = sample(prepare(prog), 1440);

const rotBack = (p, t) => ({ x: p.x * Math.cos(-t) - p.y * Math.sin(-t), y: p.x * Math.sin(-t) + p.y * Math.cos(-t) });

for (const dir of [1, -1]) for (const e of [0, 8]) {
  test(`roller follower touches without cutting (dir ${dir}, ε ${e})`, () => {
    const f = { type: 'roller', Rp: 60, Rf: 10, e, dir };
    const shape = camShape(f, sm);
    // every roller centre (pitch point) is Rf from the surface point it makes, and no closer to any other
    for (let i = 0; i < shape.pitch.length; i += 7) {
      const P = shape.pitch[i];
      let dmin = Infinity;
      for (const q of shape.surface) dmin = Math.min(dmin, Math.hypot(q.x - P.x, q.y - P.y));
      assert.ok(dmin > 10 - 0.05 && dmin < 10 + 1e-6, `roller ${i}: nearest surface ${dmin}`);
    }
    // pressure angle from the actual normal (fixed frame) matches the formula
    for (let i = 0; i < sm.length; i += 50) {
      const g = camPoint(f, sm[i], sm[i].deg * Math.PI / 180);
      const fromNormal = -dir * Math.atan2(g.normalFixed.x, g.normalFixed.y);
      assert.ok(Math.abs(fromNormal - g.phi) < 1e-9, 'pressure angle from the normal');
    }
  });
}

test('flat-faced follower: each face position touches the cam, all of the cam below it', () => {
  for (const dir of [1, -1]) {
    const f = { type: 'flat', Rb: 50, e: 0, dir };
    const shape = camShape(f, sm);
    for (let i = 0; i < sm.length; i += 11) {
      const th = sm[i].deg * Math.PI / 180, level = 50 + sm[i].s;
      // every surface point, seen from the follower (fixed frame), is at or below the face
      let top = -Infinity;
      for (const q of shape.surface) {
        const p = rotBack(q, -dir * th); // cam frame → fixed frame at this angle
        top = Math.max(top, p.y);
      }
      assert.ok(Math.abs(top - level) < 0.02, `face at ${level}, highest cam point ${top}`);
    }
    // ρ = Rb + s + a
    const r = camPoint(f, { s: 3, v: 2, a: -7 }, 0.4);
    assert.ok(Math.abs(r.rhoCam - (50 + 3 - 7)) < 1e-12);
  }
});

test('a circle (constant s) has its own radius of curvature; undercut is flagged', () => {
  const g = camPoint({ type: 'roller', Rp: 30, Rf: 5, e: 0, dir: 1 }, { s: 4, v: 0, a: 0 }, 1);
  assert.ok(Math.abs(g.rhoPitch - 34) < 1e-9 && Math.abs(g.rhoCam - 29) < 1e-9);
  // a big roller on a small, fast-rising cam undercuts
  const sharp = sample(prepare({ segments: [{ kind: 'rise', law: 'cycloidal', beta: 40, h: 30 }, { kind: 'fall', law: 'cycloidal', beta: 40, h: 30 }, { kind: 'dwell', beta: 280 }] }), 1440);
  const shape = camShape({ type: 'roller', Rp: 25, Rf: 15, e: 0, dir: 1 }, sharp);
  assert.ok(shape.undercut, `ρ min of the pitch curve ${shape.rhoPitchMin}`);
  const flat = camShape({ type: 'flat', Rb: 25, e: 0, dir: 1 }, sharp);
  assert.ok(flat.undercut, `flat ρ min ${flat.rhoMin}`);
});
