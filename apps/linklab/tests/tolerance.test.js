// =============================================================================
// Tolerance study (pin play and hole position error), against cases worked by hand:
//   a lone crank      pin play c moves every point of the crank by exactly c/2;
//                     hole errors of radius t (one in the crank, one in the frame)
//                     move the tip by at most 2t
//   perfect parts     no error → no deviation
//   a fourbar         the deviation grows in proportion to small errors, and the
//                     same seed gives the same result; no random build goes
//                     beyond the worst case (linear), checked independently by
//                     trying the worst signs of each error with the full solver
// SHOW=1 prints the numbers.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, addLink, setDriverSpec } from '../src/model/document.js';
import { Simulation } from '../src/model/simulation.js';
import { runTolerance, studyPoints, worstAtPose, cycleWorst, pointOn, magnification, analysePose, cycleStudy, targetOn, clearanceFn, pushForces } from '../src/model/tolerance.js';
import { analyseForces } from '../src/model/forces.js';
import { makeFourbar, makeSliderCrank } from './helpers.js';
import { buildSystem, pointOnBody } from '../src/kinematics/system.js';
import { solvePosition } from '../src/kinematics/solver.js';

const near = (got, want, tol, msg) => assert.ok(Math.abs(got - want) <= tol, `${msg}: ${got} vs ${want}`);
const show = (...a) => { if (process.env.SHOW) console.log(...a); };

function lonecrank() {
  const doc = createDocument();
  const O = addJoint(doc, 0, 0, { ground: true });
  const A = addJoint(doc, 50, 0, { trace: true });
  const L = addLink(doc, [O.id, A.id]);
  setDriverSpec(doc, { type: 'rotary', link: L.id, pivot: O.id, ref: null });
  const sim = new Simulation(); sim.reset(doc);
  return { doc, sim, A };
}

function fourbar() {
  const { doc, A, B } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: Math.PI / 3 });
  setDriverSpec(doc, { type: 'rotary', link: doc.links[0].id, pivot: doc.joints[0].id, ref: null });
  const sim = new Simulation(); sim.reset(doc);
  return { doc, sim, A, B };
}

test('lone crank: pin play moves the tip by exactly half the clearance', () => {
  const { sim } = lonecrank();
  const r = runTolerance(sim, { clearance: 0.3, holePosition: 0, builds: 20 });
  const p = r.points[0];
  near(p.maxDev, 0.15, 1e-6, 'largest deviation');
  near(p.rms, 0.15, 1e-6, 'RMS deviation');
  near(p.worstDev, 0.15, 1e-9, 'worst case');
  assert.equal(r.failedBuilds, 0);
  show('crank play', p.maxDev, p.rms);
});

test('lone crank: hole position errors move the tip by at most 2t', () => {
  const { sim } = lonecrank();
  const t = 0.1;
  const r = runTolerance(sim, { clearance: 0, holePosition: t, builds: 400 });
  const p = r.points[0];
  assert.ok(p.maxDev <= 2 * t + 1e-9, `at most 2t: ${p.maxDev}`);
  assert.ok(p.maxDev > 1.6 * t, `close to 2t with many builds: ${p.maxDev}`);
  near(p.worstDev, 2 * t, 1e-9, 'worst case 2t');
  show('crank holes', p.maxDev);
});

test('perfect parts: no deviation', () => {
  const { sim } = fourbar();
  const r = runTolerance(sim, { clearance: 0, holePosition: 0, builds: 5 });
  for (const p of r.points) near(p.maxDev, 0, 1e-9, 'deviation of ' + p.id);
});

test('fourbar: deviation grows in proportion to small errors; seeds repeat', () => {
  const { sim, B } = fourbar();
  const run = (k, seed = 7) => runTolerance(sim, { clearance: 0.1 * k, holePosition: 0.05 * k, builds: 40, seed, points: [B.id] }).points[0];
  const r1 = run(1), r2 = run(2), again = run(1);
  near(r2.maxDev / r1.maxDev, 2, 0.05, 'twice the error, twice the deviation');
  near(again.maxDev, r1.maxDev, 1e-12, 'same seed, same result');
  assert.ok(run(1, 8).maxDev !== r1.maxDev, 'another seed, another sample');
  // band: the ideal path lies inside it everywhere
  for (const s of r1.band) assert.ok(s.lo <= 1e-12 && s.hi >= -1e-12);
  // the random builds stay inside the worst case (small errors: nearly linear)
  assert.ok(r1.maxDev <= r1.worstDev * 1.01, `random ${r1.maxDev} ≤ worst ${r1.worstDev}`);
  for (const s of r1.band) assert.ok(Math.max(-s.lo, s.hi) <= s.worst * 1.01 + 1e-9);
  show('fourbar', r1.maxDev, r2.maxDev, r1.width);
});

test('points studied: traced joints, else every moving joint', () => {
  const { doc, A, B } = fourbar();
  assert.deepEqual(studyPoints(doc).sort(), [A.id, B.id].sort());
  doc.joints.find((j) => j.id === B.id).trace = true;
  assert.deepEqual(studyPoints(doc), [B.id]);
});

test('fourbar: the worst case is reached when every pin is pushed its worst way', () => {
  // independent check with the full nonlinear solver: at the worst input
  // position, push each pin's gap along ± its own worst direction (found by
  // trying both axes for each pin separately) and compare the point's move
  const { doc, sim, B } = fourbar();
  const c = 0.2;
  const r = runTolerance(sim, { clearance: c, holePosition: 0, builds: 1, points: [B.id] }).points[0];
  const smp = sim.getSweep().samples.filter((_, k, all) => k % Math.max(1, Math.ceil(all.length / 180)) === 0)[r.worstIndex];
  const sys = buildSystem(doc);
  const pins = sys.constraints.filter((x) => x.info.kind === 'pin');
  const iB = sys.bodies.findIndex((b) => b.local.has(B.id)), sB = sys.bodies[iB].local.get(B.id);
  const at = () => { const s = solvePosition(sys, smp.q, smp.theta); return pointOnBody(s.q, iB, sB); };
  const P0 = at();
  // linear response of the point to a small gap along x and y at each pin
  const h = 1e-6;
  const M = pins.map((p) => [{ x: h, y: 0 }, { x: 0, y: h }].map((g) => { p.gap = g; const P = at(); p.gap = { x: 0, y: 0 }; return { x: (P.x - P0.x) / h, y: (P.y - P0.y) / h }; }));
  // best direction d for the total, then each pin's gap set to its worst for d
  let best = 0, bestD = null;
  for (let a = 0; a < 360; a++) {
    const d = { x: Math.cos((a * Math.PI) / 360), y: Math.sin((a * Math.PI) / 360) };
    const v = M.reduce((s, [mx, my]) => s + (c / 2) * Math.hypot(mx.x * d.x + mx.y * d.y, my.x * d.x + my.y * d.y), 0);
    if (v > best) { best = v; bestD = d; }
  }
  pins.forEach((p, k) => {
    const [mx, my] = M[k], gx = mx.x * bestD.x + mx.y * bestD.y, gy = my.x * bestD.x + my.y * bestD.y, L = Math.hypot(gx, gy) || 1;
    p.gap = { x: (c / 2) * gx / L, y: (c / 2) * gy / L };
  });
  const P = at();
  near(Math.hypot(P.x - P0.x, P.y - P0.y), r.worstDev, 0.02 * r.worstDev, 'pushed to the worst case');
  show('fourbar worst', r.worstDev, Math.hypot(P.x - P0.x, P.y - P0.y));
});

test('worst case for the drawing: pins pushed the worst way, shares add up, pose matches', () => {
  const { doc, sim, B } = fourbar();
  const c = 0.2;
  const sys = buildSystem(doc);
  const w = pointOn(sys, B.id);
  const smp = sim.getSweep().samples[40];
  const r = worstAtPose(sys, smp.q, smp.theta, w, c, 0);
  // each pin touches its hole wall: |u| = c/2; the shares add up to the total
  for (const p of r.parts) near(Math.hypot(p.u.x, p.u.y), c / 2, 1e-12, 'pin against its wall');
  near(r.parts.reduce((s, p) => s + p.adds, 0), r.total, 1e-12, 'shares add up');
  // the point's move along d is the total
  near(r.dP.x * r.d.x + r.dP.y * r.d.y, r.total, 1e-9 * Math.max(1, r.total), 'move along d');
  // the full solver with those gaps puts the point (nearly) where dP says
  const pins = sys.constraints.filter((x) => x.info.kind === 'pin');
  for (const p of r.parts) pins.find((x) => x.info.joint === p.joint && x.info.i === p.i && x.info.j === p.j).gap = p.u;
  const s = solvePosition(sys, smp.q, smp.theta);
  const P = pointOnBody(s.q, w.i, w.s), P0 = pointOnBody(smp.q, w.i, w.s);
  near(Math.hypot(P.x - P0.x - r.dP.x, P.y - P0.y - r.dP.y), 0, 0.02 * r.total, 'linear move matches the solver');
  // and q + dq moves the point by dP (to first order)
  const Pq = pointOnBody(smp.q.map((v, k) => v + r.dq[k]), w.i, w.s);
  near(Math.hypot(Pq.x - P0.x - r.dP.x, Pq.y - P0.y - r.dP.y), 0, 1e-3 * r.total, 'dq moves the point by dP');
});

test('over the cycle: the largest worst case agrees with the study, and is cached', () => {
  const { sim, B } = fourbar();
  const cyc = cycleWorst(sim, { clearance: 0.2, holePosition: 0, point: B.id });
  const study = runTolerance(sim, { clearance: 0.2, holePosition: 0, builds: 1, points: [B.id] }).points[0];
  // the study checks every few positions; the cycle checks them all (so it finds at least as much)
  assert.ok(cyc.total[cyc.maxK] >= study.worstDev - 1e-12);
  near(cyc.total[cyc.maxK], study.worstDev, 0.03 * study.worstDev, 'largest over the cycle');
  for (let k = 0; k < cyc.total.length; k++) assert.ok(cyc.half[k] <= cyc.total[k] + 1e-12, 'across the path ≤ any direction');
  assert.equal(cycleWorst(sim, { clearance: 0.2, holePosition: 0, point: B.id }), cyc, 'cached');
});

test('drawn size: automatic makes the play visible, a chosen size is kept', () => {
  assert.equal(magnification({ scale: 'auto', clearance: 0.2, holePosition: 0 }, 2.5), 50); // 0.1 mm × 2.5 px/mm × 50 = 12.5 px ≥ 6
  assert.equal(magnification({ scale: 'auto', clearance: 0.2, holePosition: 0 }, 30), 2);
  assert.equal(magnification({ scale: 20, clearance: 0.2, holePosition: 0 }, 2.5), 20);
});

// ---- under the load, the output angle, per-pin clearance and knocks -------------

/** A fourbar with masses; `mode` static or dynamic; loads as given. */
function loadedFourbar({ mode = 'static', gravity = false, loads = [], masses = null, omega = 10 } = {}) {
  const { doc, O2, O4, A, B } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: Math.PI / 3 });
  const [L2, L3, L4] = doc.links;
  const m = masses || [{ m: 0.1, I: 2e-5, x: 20 }, { m: 0.3, I: 4e-4, x: 60 }, { m: 0.2, I: 1.5e-4, x: 40 }];
  L2.mass = { m: m[0].m, I: m[0].I, local: { from: O2.id, to: A.id, x: m[0].x, y: 0 } };
  L3.mass = { m: m[1].m, I: m[1].I, local: { from: A.id, to: B.id, x: m[1].x, y: 0 } };
  L4.mass = { m: m[2].m, I: m[2].I, local: { from: O4.id, to: B.id, x: m[2].x, y: 0 } };
  setDriverSpec(doc, { type: 'rotary', link: L2.id, pivot: O2.id, ref: null });
  doc.output = { kind: 'angle', link: L4.id };
  doc.motion.omega = omega; doc.motion.alpha = 0;
  doc.dynamics = { mode, gravity, g: 9.81 };
  doc.loads = loads.map((ld, n) => ({ id: `ld${n}`, kind: 'force', follow: false, profile: { type: 'constant' }, ...ld, link: doc.links[ld.link].id }));
  const sim = new Simulation(); sim.reset(doc);
  return { doc, sim, O2, O4, A, B, L2, L3, L4 };
}

/** Put every pin's gap as given ({ joint → u }) and solve; the pose. */
function solveWithGaps(sys, smp, gaps) {
  for (const c of sys.constraints) if (c.info && c.info.kind === 'pin') c.gap = gaps.get(`${c.info.joint}|${c.info.i}|${c.info.j}`) || { x: 0, y: 0 };
  const r = solvePosition(sys, smp.q, smp.theta);
  for (const c of sys.constraints) if (c.info && c.info.kind === 'pin') c.gap = { x: 0, y: 0 };
  return r.q;
}

test('under its own weight, a lone crank sags by half the clearance', () => {
  // the pin is pushed up by the hole (holding the weight), so it sits at the bottom of it
  const doc = createDocument();
  const O = addJoint(doc, 0, 0, { ground: true });
  const A = addJoint(doc, 50, 0, { trace: true });
  const L = addLink(doc, [O.id, A.id]);
  L.mass = { m: 0.2, I: 1e-4, local: { from: O.id, to: A.id, x: 25, y: 0 } };
  setDriverSpec(doc, { type: 'rotary', link: L.id, pivot: O.id, ref: null });
  doc.dynamics = { mode: 'static', gravity: true, g: 9.81 };
  const sim = new Simulation(); sim.reset(doc);
  const tg = targetOn(sim.sys, doc, A.id);
  for (const k of [0, 30, 90]) {
    const smp = sim.getSweep().samples[k];
    const a = analysePose(sim.sys, smp.q, smp.theta, tg, 0.3, 0, analyseForces(sim, smp));
    near(a.loaded.x, 0, 1e-9, 'no sideways move');
    near(a.loaded.y, -0.15, 1e-9, 'down by c/2');
  }
});

test('one load: the point it acts on gives way along it by the worst case, and P·δ = Σ (c/2)|F|', () => {
  // virtual work: the load does work Σ (c/2)|F_s| as the pins take up their play
  const P = { x: 30, y: -50 };
  const { doc, sim, B } = loadedFourbar({ loads: [{ link: 1, at: null, F: P }] });
  doc.loads[0].at = { x: B.x, y: B.y }; sim.reset(doc);
  const tg = targetOn(sim.sys, doc, B.id);
  const c = 0.2, Pn = Math.hypot(P.x, P.y), e = { x: P.x / Pn, y: P.y / Pn };
  for (const k of [20, 90, 150]) {
    const smp = sim.getSweep().samples[k];
    const f = analyseForces(sim, smp);
    const a = analysePose(sim.sys, smp.q, smp.theta, tg, c, 0, f);
    const along = a.loaded.x * e.x + a.loaded.y * e.y;
    const work = f.pins.reduce((s, p) => s + (c / 2) * Math.hypot(p.F.x, p.F.y), 0);
    near(P.x * a.loaded.x + P.y * a.loaded.y, work, 1e-6 * work, 'P·δ = Σ (c/2)|F|');
    // the worst case along P (support of the zone) is the same
    const reach = Math.max(...a.zone.map((z) => z.x * e.x + z.y * e.y));
    assert.ok(along > 0, 'gives way along the load');
    near(along, reach, 0.01 * reach, 'the worst case along the load');
  }
});

test('under the load: the full solver with each pin pushed so agrees with the linear result', () => {
  const { doc, sim, B, L4 } = loadedFourbar({ mode: 'dynamic', gravity: true, omega: 15 });
  const sys = buildSystem(doc);
  const c = 0.05;
  for (const key of [B.id, 'output']) {
    const tg = targetOn(sim.sys, doc, key);
    for (const k of [10, 70, 130]) {
      const smp = sim.getSweep().samples[k];
      const f = analyseForces(sim, smp);
      const a = analysePose(sim.sys, smp.q, smp.theta, tg, c, 0, f);
      const gaps = new Map(f.pins.map((p) => { const L = Math.hypot(p.F.x, p.F.y); return [`${p.joint}|${p.i}|${p.j}`, { x: (-c / 2) * p.F.x / L, y: (-c / 2) * p.F.y / L }]; }));
      const q = solveWithGaps(sys, smp, gaps);
      if (tg.kind === 'point') {
        const P = pointOnBody(q, tg.i, tg.s), P0 = pointOnBody(smp.q, tg.i, tg.s);
        near(Math.hypot(P.x - P0.x - a.loaded.x, P.y - P0.y - a.loaded.y), 0, 0.01 * Math.hypot(a.loaded.x, a.loaded.y), 'point under load');
      } else {
        const i = sys.bodyIndex.get(L4.id);
        near(q[3 * i + 2] - smp.q[3 * i + 2], a.loaded, 0.01 * Math.abs(a.loaded) + 1e-9, 'output angle under load');
      }
    }
  }
});

test('output angle: the worst case is reached with every pin pushed its worst way; one loop, equal shares', () => {
  const { doc, sim, L4 } = loadedFourbar();
  const sys = buildSystem(doc);
  const tg = targetOn(sim.sys, doc, 'output');
  assert.equal(tg.kind, 'angle');
  const smp = sim.getSweep().samples[50];
  const a = analysePose(sim.sys, smp.q, smp.theta, tg, 0.04, 0);
  // the pose change dqWorst, put through the full solver as gaps, turns link 4 by the play
  const pins = sys.constraints.filter((x) => x.info.kind === 'pin');
  const i4 = sys.bodyIndex.get(L4.id);
  // gaps from dqWorst: recover each source's u from the linear model (push + way)
  const h = 1e-7, base = solveWithGaps(sys, smp, new Map())[3 * i4 + 2];
  const gaps = new Map();
  for (const p of pins) {
    const key = `${p.info.joint}|${p.info.i}|${p.info.j}`;
    const g = [{ x: h, y: 0 }, { x: 0, y: h }].map((u) => (solveWithGaps(sys, smp, new Map([[key, u]]))[3 * i4 + 2] - base) / h);
    const L = Math.hypot(g[0], g[1]);
    gaps.set(key, { x: 0.02 * g[0] / L, y: 0.02 * g[1] / L });
  }
  near(solveWithGaps(sys, smp, gaps)[3 * i4 + 2] - base, a.play, 0.01 * a.play, 'worst output angle');
  // a fourbar is one loop: with equal clearances every pin adds the same to the angle
  const adds = a.parts.map((p) => p.adds);
  for (const v of adds) near(v, a.play / 4, 1e-9 * a.play, 'equal share');
  // a pin with half the clearance adds half as much
  const half = analysePose(sim.sys, smp.q, smp.theta, tg, { value: 0.04, pins: { [a.parts[0].joint]: 0.02 } }, 0);
  near(half.parts.find((p) => p.joint === a.parts[0].joint).adds, a.play / 8, 1e-9 * a.play, 'half the clearance, half the share');
  assert.equal(clearanceFn({ value: 0.3, pins: { j9: 0.01 } })('j9'), 0.01);
  assert.equal(clearanceFn({ value: 0.3, pins: { j9: 0.01 } })('j1'), 0.3);
});

test('knocks: where the rocker stops speeding up, its pins cross their holes', () => {
  // light crank and coupler, rocker balanced on its pivot, no gravity: the only
  // force in the chain is the rocker's I·α, which reverses where α₄ = 0
  const { doc, sim, L4 } = loadedFourbar({ mode: 'dynamic', masses: [{ m: 1e-6, I: 1e-12, x: 20 }, { m: 1e-6, I: 1e-12, x: 60 }, { m: 0.5, I: 2e-3, x: 0 }], omega: 20 });
  const st = cycleStudy(sim, { clearance: 0.2, holePosition: 0, target: 'output', forceOf: (smp) => analyseForces(sim, smp) });
  const i4 = sim.sys.bodyIndex.get(L4.id);
  const s = sim.getSweep().samples;
  const zeros = [];
  for (let k = 1; k < s.length; k++) if (Math.sign(s[k].qdd[3 * i4 + 2]) !== Math.sign(s[k - 1].qdd[3 * i4 + 2])) zeros.push(s[k].theta);
  show('knocks', st.knocks.map((k) => [(k.theta * 180) / Math.PI, k.jump, k.pins.length]), 'alpha zeros', zeros.map((z) => (z * 180) / Math.PI));
  assert.ok(zeros.length >= 2);
  assert.equal(st.knocks.length, zeros.length, 'one knock per reversal');
  for (const kn of st.knocks) {
    const d = Math.min(...zeros.map((z) => Math.abs(Math.atan2(Math.sin(z - kn.theta), Math.cos(z - kn.theta)))));
    assert.ok(d < (2 * Math.PI) / 180, `knock at α₄ = 0 (off by ${(d * 180) / Math.PI}°)`);
    assert.equal(kn.pins.length, 4, 'every pin in the loop at once');
    // the output goes from one side of its play to the other
    near(kn.jump, 2 * st.play[kn.k], 0.15 * st.play[kn.k], 'jumps across its play');
  }
  // between knocks the output sits at one edge of its play (the load picks the worst side)
  const mid = Math.round((st.knocks[0].k + st.knocks[1].k) / 2);
  near(Math.abs(st.loaded[mid]), st.play[mid], 1e-6 * st.play[mid], 'at the edge of its play');
});

test('no load reversal, no knock: a crank held against its weight', () => {
  const { sim } = loadedFourbar({ mode: 'static', gravity: true, masses: [{ m: 0.1, I: 2e-5, x: 20 }, { m: 0.3, I: 4e-4, x: 60 }, { m: 0.2, I: 1.5e-4, x: 40 }] });
  const st = cycleStudy(sim, { clearance: 0.2, holePosition: 0, target: 'output', forceOf: (smp) => analyseForces(sim, smp) });
  for (let k = 0; k < st.play.length; k++) if (Number.isFinite(st.play[k]) && Number.isFinite(st.loaded[k])) assert.ok(Math.abs(st.loaded[k]) <= st.play[k] * (1 + 1e-9), 'within its play');
  show('static knocks', st.knocks.map((k) => (k.theta * 180) / Math.PI));
});

test('slider output: its play along the rail is the point zone measured along the rail', () => {
  const { doc, B } = makeSliderCrank({ a: 40, b: 120, c: 10, theta2: Math.PI / 3 });
  setDriverSpec(doc, { type: 'rotary', link: doc.links[0].id, pivot: doc.joints[0].id, ref: null });
  doc.output = { kind: 'slider', slider: doc.sliders[0].id };
  const sim = new Simulation(); sim.reset(doc);
  const along = targetOn(sim.sys, doc, 'output'), pt = targetOn(sim.sys, doc, B.id);
  assert.equal(along.kind, 'along');
  for (const k of [15, 60, 120]) {
    const smp = sim.getSweep().samples[k];
    const a = analysePose(sim.sys, smp.q, smp.theta, along, 0.2, 0), p = analysePose(sim.sys, smp.q, smp.theta, pt, 0.2, 0);
    const reach = Math.max(...p.zone.map((z) => z.x * along.e.x + z.y * along.e.y));
    near(a.play, reach, 0.01 * reach, 'along the rail');
  }
  const st = cycleStudy(sim, { clearance: 0.2, holePosition: 0, target: 'output' });
  assert.ok(st.play.every((v) => !Number.isFinite(v) || v > 0), 'play over the cycle');
});

test('pushing by hand: the point moves the way it is pushed, never beyond its play', () => {
  const { sim, B } = fourbar();
  const tg = targetOn(sim.sys, sim.doc, B.id);
  const i = tg.i, s = tg.s;
  for (let a = 0; a < 360; a += 30) {
    const d = { x: Math.cos((a * Math.PI) / 180), y: Math.sin((a * Math.PI) / 180) };
    const f = pushForces(sim, { i, s, F: { x: 5 * d.x, y: 5 * d.y } });
    const p = analysePose(sim.sys, sim.q, sim.theta, tg, 0.2, 0, f);
    const along = p.loaded.x * d.x + p.loaded.y * d.y;
    assert.ok(along > 0, `push at ${a}°: moves the way it is pushed (${along})`);
    // play is searched over 90 directions, so it can be a hair (≈ 0.002%) low
    assert.ok(Math.hypot(p.loaded.x, p.loaded.y) <= p.play * (1 + 1e-3), `push at ${a}°: within its play (${Math.hypot(p.loaded.x, p.loaded.y)} vs ${p.play})`);
  }
});

test('next to a dead centre the worst case is left out, not blown up', () => {
  // driven by the rocker: the input stops at two limit positions
  const { doc, B } = makeFourbar({ a: 233, b: 484, c: 147, d: 426, theta2: (102 * Math.PI) / 180 });
  setDriverSpec(doc, { type: 'rotary', link: doc.links[0].id, pivot: doc.joints[0].id, ref: null });
  const sim = new Simulation(); sim.reset(doc);
  assert.equal(sim.getSweep().fullTurn, false);
  const st = cycleStudy(sim, { clearance: 0.2, holePosition: 0, target: B.id });
  const finite = st.play.filter(Number.isFinite);
  assert.ok(finite.length < st.play.length, 'some positions are left out');
  assert.ok(finite.length > 0.9 * st.play.length, 'only those next to the limits');
  assert.ok(Math.max(...finite) < 20, `largest play stays physical: ${Math.max(...finite)} mm`);
});
