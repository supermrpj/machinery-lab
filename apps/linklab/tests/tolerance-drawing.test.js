// =============================================================================
// The play drawn larger: what the drawing and the magnifier show must agree
// with each other and with the full equations.
//   - the first-order displacement the drawing uses (drawTolerancePins)
//     equals the derivative of pointOnBody along dq
//   - the "worst" dot lies on the edge of the zone at every position
//   - the linear worst case agrees with a brute-force search over the pins
//     solved with the full equations, including on a triple rocker drawn
//     with its ground link and driven at a floating joint
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, addLink, setDriverSpec } from '../src/model/document.js';
import { Simulation } from '../src/model/simulation.js';
import { analysePose, targetOn, magnification } from '../src/model/tolerance.js';
import { buildSystem, pointOnBody } from '../src/kinematics/system.js';
import { solvePosition } from '../src/kinematics/solver.js';
import { TOLERANCE } from '../src/config.js';
import { makeFourbar } from './helpers.js';

const near = (got, want, tol, msg) => assert.ok(Math.abs(got - want) <= tol, `${msg}: ${got} vs ${want}`);

/** The displacement the drawing uses: k times the first-order move of local point s on body b. */
function firstOrder(q, dq, b, s) {
  const c = Math.cos(q[3 * b + 2]), sn = Math.sin(q[3 * b + 2]), dphi = dq[3 * b + 2];
  return { x: dq[3 * b] - dphi * (sn * s.x + c * s.y), y: dq[3 * b + 1] + dphi * (c * s.x - sn * s.y) };
}

/** Tang's triple rocker: ground link drawn, motor at O2 or at joint A. */
function tripleRocker(motorAt = 'O2') {
  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true }), O4 = addJoint(doc, 332, -55, { ground: true });
  const A = addJoint(doc, 119, 150), B = addJoint(doc, 284, 10);
  const L2 = addLink(doc, [O2.id, A.id]), L3 = addLink(doc, [A.id, B.id]), L4 = addLink(doc, [O4.id, B.id]);
  addLink(doc, [O2.id, O4.id]);
  if (motorAt === 'O2') setDriverSpec(doc, { type: 'rotary', link: L2.id, pivot: O2.id, ref: null });
  else setDriverSpec(doc, { type: 'rotary', link: L3.id, pivot: A.id, ref: L2.id });
  const sim = new Simulation(); sim.reset(doc);
  assert.ok(sim.drivable, 'drivable');
  return { doc, sim, O2, O4, A, B, L2, L3, L4 };
}

function crankRocker() {
  const { doc, B } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: Math.PI / 3 });
  setDriverSpec(doc, { type: 'rotary', link: doc.links[0].id, pivot: doc.joints[0].id, ref: null });
  const sim = new Simulation(); sim.reset(doc);
  return { doc, sim, B };
}

test('the drawing moves each point by the derivative of its position along dq', () => {
  const { sim } = tripleRocker();
  const q = sim.q, sys = sim.sys;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let trial = 0; trial < 20; trial++) {
    const dq = q.map(() => rnd());
    sys.bodies.forEach((body, b) => {
      for (const s of body.local.values()) {
        const lin = firstOrder(q, dq, b, s);
        const e = 1e-6;
        const P1 = pointOnBody(q.map((v, k) => v + e * dq[k]), b, s), P0 = pointOnBody(q.map((v, k) => v - e * dq[k]), b, s);
        near(lin.x, (P1.x - P0.x) / (2 * e), 1e-6, 'x'); near(lin.y, (P1.y - P0.y) / (2 * e), 1e-6, 'y');
      }
    });
  }
});

test('the worst dot lies on the edge of the zone at every position, for every target', () => {
  for (const make of [() => crankRocker(), () => tripleRocker('O2'), () => tripleRocker('A')]) {
    const { doc, sim, B, A } = make();
    const sw = sim.getSweep();
    for (const id of [B.id, A ? A.id : null].filter(Boolean)) {
      const tg = targetOn(sim.sys, doc, id);
      let checked = 0;
      for (const smp of sw.samples) {
        const a = analysePose(sim.sys, smp.q, smp.theta, tg, 0.2, 0);
        if (!a) continue;   // next to a dead centre: no answer, by design
        checked++;
        const d = a.d, proj = (p) => p.x * d.x + p.y * d.y;
        const edge = Math.max(...a.zone.map(proj));
        near(proj(a.worst), a.play, 1e-9 * a.play, 'worst along d is the play');
        assert.ok(proj(a.worst) >= edge - 1e-9, 'the dot is the support point of the zone');
        // and the dot is the furthest the zone reaches in any direction (the
        // worst direction is searched in 2° steps and the outline drawn every
        // 5°, so the two can differ by a hundred-thousandth)
        const far = Math.max(...a.zone.map((z) => Math.hypot(z.x, z.y)));
        near(Math.hypot(a.worst.x, a.worst.y), far, 1e-3 * far, 'the dot is the far point of the zone');
        // the drawing's displacement of the point equals the dot
        const w = firstOrder(smp.q, a.dqWorst, tg.i, tg.s);
        near(w.x, a.worst.x, 1e-9, 'drawing x'); near(w.y, a.worst.y, 1e-9, 'drawing y');
      }
      assert.ok(checked > sw.samples.length / 2, `enough positions checked (${checked} of ${sw.samples.length})`);
    }
  }
});

test('brute force with the full equations: the linear worst case is right away from dead centres', () => {
  // every pin at one of 12 places on its clearance circle, all combinations
  // (12^4 = 20736 full solves per position): the furthest the point gets
  for (const make of [() => crankRocker(), () => tripleRocker('A')]) {
    const { doc, sim, B } = make();
    const c = 0.2;
    const sys = buildSystem(doc);
    const pins = sys.constraints.filter((x) => x.info.kind === 'pin' && !(sys.frame.has(x.info.i) || sys.frame.has(x.info.j)));
    assert.equal(pins.length, 4, 'four pins in the loop');
    const iB = sys.bodies.findIndex((b) => b.local.has(B.id)), sB = sys.bodies[iB].local.get(B.id);
    const tg = targetOn(sim.sys, doc, B.id);
    const sw = sim.getSweep();
    const n = 12;
    let tested = 0;
    for (let k = 0; k < sw.samples.length; k += Math.ceil(sw.samples.length / 6)) {
      const smp = sw.samples[k];
      const lin = analysePose(sim.sys, smp.q, smp.theta, tg, c, 0);
      if (!lin) continue;
      const P0 = pointOnBody(solvePosition(sys, smp.q, smp.theta).q, iB, sB);
      let far = 0;
      const idx = [0, 0, 0, 0];
      for (let count = 0; count < n ** 4; count++) {
        let t = count;
        for (let p = 0; p < 4; p++) { idx[p] = t % n; t = Math.floor(t / n); }
        pins.forEach((p, j) => { const ang = (2 * Math.PI * idx[j]) / n; p.gap = { x: (c / 2) * Math.cos(ang), y: (c / 2) * Math.sin(ang) }; });
        const s = solvePosition(sys, smp.q, smp.theta);
        if (!s.ok) continue;
        const P = pointOnBody(s.q, iB, sB);
        far = Math.max(far, Math.hypot(P.x - P0.x, P.y - P0.y));
      }
      pins.forEach((p) => { p.gap = { x: 0, y: 0 }; });
      // the brute force samples 12 directions per pin, so it can only fall a little short
      near(far, lin.play, 0.04 * lin.play, `position ${k}: brute force ${far} vs linear ${lin.play}`);
      tested++;
    }
    assert.ok(tested >= 3, `positions tested: ${tested}`);
  }
});

test('"Auto" stays in the listed sizes and in proportion; a chosen size is kept', () => {
  const t = { scale: 'auto', clearance: 0.2, holePosition: 0 };
  for (const zoom of [0.1, 1, 2.5, 10, 100]) {
    for (const limit of [null, { play: 0.01, size: 100 }, { play: 3, size: 200 }, { play: 50, size: 100 }, { play: 1e4, size: 1 }]) {
      const k = magnification(t, zoom, limit);
      assert.ok(TOLERANCE.magnify.includes(k), `listed: ${k}`);
      if (limit) assert.ok(k === 1 || k * limit.play <= TOLERANCE.autoMaxDrawn * limit.size + 1e-9, `in proportion: ${k} × ${limit.play} in ${limit.size}`);
    }
  }
  assert.equal(magnification({ ...t, scale: 500 }, 2.5, { play: 50, size: 100 }), 500);
});
