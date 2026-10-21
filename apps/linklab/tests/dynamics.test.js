// =============================================================================
// Force analysis checks
//   1. statics of a crank under its own weight (hand calculation)
//   2. a crank spinning: centripetal pin force and I_O·α torque
//   3. fourbar against an independent Newton–Euler (9 × 9) solution
//   4. power balance  T·ω = dKE/dt − P_applied  for several mechanisms
//   5. load profiles: formulas and tables
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoDriver, createDocument, addJoint, addLink } from '../src/model/document.js';
import { Simulation } from '../src/model/simulation.js';
import { analyseForces } from '../src/model/forces.js';
import { massProps, polygonProps } from '../src/model/mass.js';
import { compileFormula, profileFactor, parseTable, makeLoad } from '../src/model/loads.js';
import { fourbarPosition, fourbarVelocity, fourbarAcceleration } from '../src/kinematics/index.js';
import { solve } from '../../../packages/core-math/src/index.js';
import { EXAMPLES } from '../src/model/examples.js';
import { makeFourbar, makeSliderCrank } from './helpers.js';

const DEG = Math.PI / 180, g = 9.81;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

function simOf(doc, mode, { omega = 10, alpha = 0, gravity = true } = {}) {
  autoDriver(doc);
  doc.motion.omega = omega; doc.motion.alpha = alpha;
  doc.dynamics = { mode, gravity, g };
  const s = new Simulation();
  s.reset(doc);
  return s;
}

/** A single crank of length L at angle th, with typed mass properties. */
function crank(L, th, m, I) {
  const doc = createDocument();
  const O = addJoint(doc, 0, 0, { ground: true });
  const A = addJoint(doc, L * Math.cos(th), L * Math.sin(th));
  const link = addLink(doc, [O.id, A.id]);
  link.mass = { m, cg: { x: (L / 2) * Math.cos(th), y: (L / 2) * Math.sin(th) }, I };
  return doc;
}

test('statics: a crank held against its own weight', () => {
  const L = 200, m = 2, th = 30 * DEG;
  const s = simOf(crank(L, th, m, 0.01), 'static');
  const r = analyseForces(s);
  // the motor holds m·g·(L/2)·cosθ (N·m, L in m)
  close(r.input.torque, m * g * (L / 2000) * Math.cos(th), 1e-9, 'holding torque');
  const pin = r.pins.find((p) => p.j === -1);
  close(pin.F.x, 0, 1e-9, 'ground pin x'); close(pin.F.y, m * g, 1e-9, 'ground pin y');
});

test('dynamics: a spinning crank needs centripetal force and I_O·α', () => {
  const L = 200, m = 2, I = 0.01, th = 50 * DEG, w = 12, al = 7;
  const s = simOf(crank(L, th, m, I), 'dynamic', { omega: w, alpha: al, gravity: false });
  const r = analyseForces(s);
  const rG = L / 2000; // m
  close(r.input.torque, (I + m * rG * rG) * al, 1e-9, 'torque = I_O α');
  // force from the ground on the crank = m a_G
  const aG = { x: -rG * al * Math.sin(th) - rG * w * w * Math.cos(th), y: rG * al * Math.cos(th) - rG * w * w * Math.sin(th) };
  const pin = r.pins.find((p) => p.j === -1);
  close(pin.F.x, m * aG.x, 1e-9, 'pin force x'); close(pin.F.y, m * aG.y, 1e-9, 'pin force y');
  close(r.shaking.F.x, -m * aG.x, 1e-9, 'shaking force');
});

test('fourbar: matches an independent Newton–Euler solution', () => {
  const a = 40, b = 120, c = 80, d = 100, th2 = 60 * DEG, w2 = 10, al2 = 5;
  const { doc, O2, O4, A, B } = makeFourbar({ a, b, c, d, theta2: th2 });
  const ms = [1.2, 3.5, 2.1], Is = [0.002, 0.03, 0.012];
  const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const G = [mid(O2, A), { x: (A.x + B.x) / 2 + 10, y: (A.y + B.y) / 2 + 15 }, mid(O4, B)]; // coupler CG off its line
  doc.links.forEach((l, k) => { l.mass = { m: ms[k], cg: G[k], I: Is[k] }; });
  // an external force on the coupler
  doc.loads = [{ ...makeLoad(doc, doc.links[1].id, { x: B.x - 20, y: B.y + 5 }), F: { x: 30, y: -50 } }];
  const s = simOf(doc, 'dynamic', { omega: w2, alpha: al2 });
  const r = analyseForces(s);
  assert.ok(r && r.balanced && r.unique);

  // ---- independent solution (SI units) ----
  const sol = fourbarPosition(a, b, c, d, th2).open;
  const { omega3: w3, omega4: w4 } = fourbarVelocity(a, b, c, th2, sol.theta3, sol.theta4, w2);
  const { alpha3: al3, alpha4: al4 } = fourbarAcceleration(a, b, c, th2, sol.theta3, sol.theta4, w2, w3, w4, al2);
  const P = (p) => ({ x: p.x / 1000, y: p.y / 1000 });
  const o2 = P(O2), pa = P(A), pb = P(B), o4 = P(O4), g2 = P(G[0]), g3 = P(G[1]), g4 = P(G[2]);
  const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });
  const acc = (base, aBase, r, al, w) => ({ x: aBase.x - al * r.y - w * w * r.x, y: aBase.y + al * r.x - w * w * r.y });
  const aA = acc(o2, { x: 0, y: 0 }, sub(pa, o2), al2, w2);
  const aG2 = acc(o2, { x: 0, y: 0 }, sub(g2, o2), al2, w2);
  const aG3 = acc(pa, aA, sub(g3, pa), al3, w3);
  const aG4 = acc(o4, { x: 0, y: 0 }, sub(g4, o4), al4, w4);
  const Fe = { x: 30, y: -50 }, Pe = P({ x: B.x - 20, y: B.y + 5 });
  // unknowns: F12x F12y F32x F32y F43x F43y F14x F14y T12
  const R12 = sub(o2, g2), R32 = sub(pa, g2), R23 = sub(pa, g3), R43 = sub(pb, g3), Re = sub(Pe, g3), R34 = sub(pb, g4), R14 = sub(o4, g4);
  const M = [
    [1, 0, 1, 0, 0, 0, 0, 0, 0],
    [0, 1, 0, 1, 0, 0, 0, 0, 0],
    [-R12.y, R12.x, -R32.y, R32.x, 0, 0, 0, 0, 1],
    [0, 0, -1, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, -1, 0, 1, 0, 0, 0],
    [0, 0, R23.y, -R23.x, -R43.y, R43.x, 0, 0, 0],
    [0, 0, 0, 0, -1, 0, 1, 0, 0],
    [0, 0, 0, 0, 0, -1, 0, 1, 0],
    [0, 0, 0, 0, R34.y, -R34.x, -R14.y, R14.x, 0],
  ];
  const rhs = [
    ms[0] * aG2.x, ms[0] * aG2.y + ms[0] * g, Is[0] * al2,
    ms[1] * aG3.x - Fe.x, ms[1] * aG3.y + ms[1] * g - Fe.y, Is[1] * al3 - (Re.x * Fe.y - Re.y * Fe.x),
    ms[2] * aG4.x, ms[2] * aG4.y + ms[2] * g, Is[2] * al4,
  ];
  const x = solve(M, rhs);
  const [F12, F32, F43, F14] = [[x[0], x[1]], [x[2], x[3]], [x[4], x[5]], [x[6], x[7]]].map(([fx, fy]) => ({ x: fx, y: fy }));
  close(r.input.torque, x[8], 1e-7, 'T12');
  // our pins report the force on link i from link j
  const L2 = 0, L3 = 1, L4 = 2;
  const pinAt = (joint, on) => {
    const p = r.pins.find((pp) => pp.joint === joint.id && (pp.i === on || pp.j === on));
    return p.i === on ? p.F : { x: -p.F.x, y: -p.F.y };
  };
  const chk = (got, want, name) => { close(got.x, want.x, 1e-7, `${name}.x`); close(got.y, want.y, 1e-7, `${name}.y`); };
  chk(pinAt(O2, L2), F12, 'F12');
  chk(pinAt(A, L2), F32, 'F32');
  chk(pinAt(B, L3), F43, 'F43');
  chk(pinAt(O4, L4), F14, 'F14');
  // the frame carries the ground pin forces (reversed)
  close(r.frame.x, -(F12.x + F14.x), 1e-7, 'force on frame x');
  close(r.frame.y, -(F12.y + F14.y), 1e-7, 'force on frame y');
});

test('power balance T·ω = dKE/dt − P_applied over the cycle, for many mechanisms', () => {
  const docs = [
    makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: 1 }).doc,
    makeFourbar({ a: 80, b: 60, c: 70, d: 100, theta2: 80 * DEG }).doc, // triple rocker
    makeSliderCrank({ a: 40, b: 130, c: 12, theta2: 2 }).doc,
    ...EXAMPLES.map((e) => e.make()),
  ];
  for (const doc of docs) {
    // a load on the last link, varying over the cycle
    const link = doc.links[doc.links.length - 1];
    const j = doc.joints.find((jj) => jj.id === link.joints[link.joints.length - 1]);
    doc.loads = [{ ...makeLoad(doc, link.id, { x: j.x + 3, y: j.y - 4 }), F: { x: 12, y: -25 }, profile: { type: 'formula', expr: '1 + 0.5*sin(theta)' } }];
    const s = simOf(doc, 'dynamic', { omega: doc.driver.type === 'linear' ? 20 : 8, alpha: 2 });
    if (!s.drivable) continue;
    const sw = s.getSweep();
    let checked = 0;
    for (let k = 0; k < sw.samples.length; k += 17) {
      const smp = sw.samples[k];
      if (smp.special === 'toggle' || !smp.qd) continue;
      const r = analyseForces(s, smp);
      if (!r) continue;
      const rate = s.sys.driver.unit === 'rad' ? doc.motion.omega : doc.motion.omega / 1000; // rad/s or m/s
      const Pin = (r.input.torque ?? r.input.force) * rate;
      close(Pin, r.energy.dKE - r.energy.P_applied, 1e-6, `power balance (${doc.meta.title}) at ${smp.theta}`);
      checked++;
    }
    assert.ok(checked > 3, `${doc.meta.title}: only ${checked} checked`);
  }
});

test('mass properties from the shape', () => {
  // a 100 × 12 mm bar with round ends, 6 mm steel
  const doc = createDocument();
  const A = addJoint(doc, 0, 0), B = addJoint(doc, 100, 0);
  const l = addLink(doc, [A.id, B.id]);
  const mp = massProps(doc, l);
  const area = 100 * 12 + Math.PI * 36;
  close(mp.area, area, 2e-3, 'area (stadium)');
  close(mp.m, 7850 * area * 6e-9, 2e-3, 'mass');
  close(mp.cg.x, 50, 1e-9, 'centre x'); close(mp.cg.y, 0, 1e-9, 'centre y');
  // a square polygon: J = a⁴/6
  const sq = polygonProps([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
  close(sq.A, 100, 1e-12, 'square area'); close(sq.J, 10 ** 4 / 6, 1e-9, 'square J');
});

test('load profiles: formulas and tables', () => {
  const f = compileFormula('2*sin(theta) + step(theta - 90) * pulse(t, 0, 1) + max(1, s)^2');
  close(f({ theta: 90, t: 0.5, s: 0 }), 2 + 1 + 1, 1e-12, 'formula');
  assert.throws(() => compileFormula('2 +'), /ends too early/);
  assert.throws(() => compileFormula('foo(1)'), /Unknown function/);
  assert.throws(() => compileFormula('alert'), /Unknown name/);
  const rows = parseTable('angle\tfactor\n0\t0\n90\t1\n180 0');
  assert.deepEqual(rows, [[0, 0], [90, 1], [180, 0]]);
  close(profileFactor({ type: 'table', table: rows }, { x: 45 }), 0.5, 1e-12, 'table');
  close(profileFactor({ type: 'table', table: rows }, { x: 400 }), 0, 1e-12, 'table end');
});

// ---- regressions from the independent review ---------------------------------------------

test('gear contact force: torque / pitch radius (not √2 too big)', () => {
  const doc = EXAMPLES.find((e) => /Gear pair/.test(e.name)).make();
  const big = doc.links.reduce((a, b) => ((b.disc || 0) > (a.disc || 0) ? b : a));
  doc.loads = [{ ...makeLoad(doc, big.id, { x: 0, y: 0 }, 'torque'), T: 1 }];
  const s = simOf(doc, 'static', { gravity: false });
  const r = analyseForces(s);
  const c = r.contacts[0];
  close(c.size, 1 / (big.disc / 1000), 1e-6, 'contact force = T / r');
  close(Math.abs(c.T), c.size, 1e-6, 'all of it tangential for pitch circles');
});

test('dynamic forces are not reported at a toggle (unbounded), and maxima stay finite', () => {
  const { doc } = makeFourbar({ a: 80, b: 60, c: 70, d: 100, theta2: 80 * DEG });
  const s = simOf(doc, 'dynamic', { omega: 8 });
  const sw = s.getSweep();
  let reported = 0;
  for (const smp of sw.samples) {
    const r = analyseForces(s, smp);
    if (smp.special === 'toggle') assert.equal(r, null, 'toggle sample');
    if (r) { reported++; assert.ok(Math.abs(r.input.torque) < 1e6, `torque ${r.input.torque} at ${smp.theta}`); }
  }
  assert.ok(reported > sw.samples.length / 2);
});

test('formulas accept only their own names, with the right number of arguments', () => {
  for (const bad of ['valueOf(1)', 'hasOwnProperty(1)', 'toString', 'constructor', '__proto__', '__lookupGetter__(1)']) {
    assert.throws(() => compileFormula(bad), /Unknown/, bad);
  }
  assert.throws(() => compileFormula('pulse(1)'), /takes 3/);
  assert.throws(() => compileFormula('sin(1, 2)'), /takes 1/);
  close(compileFormula('-2^2')({}), -4, 1e-12, 'unary minus binds looser than ^');
  assert.deepEqual(parseTable('0;1,5\n90\t2,25'), [[0, 1.5], [90, 2.25]]);
});

test('load profiles repeat every turn and time runs forward when reversed', () => {
  const { doc } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: 60 * DEG });
  doc.loads = [{ ...makeLoad(doc, doc.links[1].id, { x: 50, y: 60 }), F: { x: 0, y: -100 }, profile: { type: 'table', table: [[0, 0], [180, 1], [360, 0]] } }];
  const s = simOf(doc, 'static', { gravity: false });
  s.getSweep();
  const T0 = analyseForces(s).input.torque;
  s.advance(2 * Math.PI); // one full turn later: the same pose, the same load
  close(analyseForces(s).input.torque, T0, 1e-9, 'same torque one turn later');
  // time: a pulse in the first 0.3 s of the cycle is on for about the same share both ways
  doc.loads[0].profile = { type: 'formula', expr: 'pulse(t, 0, 0.3)' };
  const count = (reverse) => {
    doc.motion.reverse = reverse;
    const sim = simOf(doc, 'static', { omega: 8, gravity: false });
    const sw = sim.getSweep();
    return sw.samples.filter((smp) => { const r = analyseForces(sim, smp); return r && Math.abs(r.input.torque) > 1e-9; }).length;
  };
  const fwd = count(false), back = count(true);
  assert.ok(fwd > 50 && back > 50 && Math.abs(fwd - back) < 0.1 * fwd, `forward ${fwd}, reversed ${back}`);
});
