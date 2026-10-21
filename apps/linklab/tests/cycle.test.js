// =============================================================================
// Dynamic force analysis checked over a whole crank turn, not just at one
// position: the Week 9 fourbar (Example 2 geometry, masses, the 80 lb force
// on the coupler and the 120 lb·in torque on the rocker), with and without
// gravity. At every position of the sweep, LinkLab's forces (Lagrange
// multipliers on the constraint equations) are compared with the textbook's
// 9 × 9 Newton–Euler matrix built from the closed-form kinematics. The
// largest force at each joint, its direction and the crank angle where it
// happens must also agree.  SHOW=1 prints the table.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, addLink, setDriverSpec } from '../src/model/document.js';
import { Simulation } from '../src/model/simulation.js';
import { analyseForces } from '../src/model/forces.js';
import { fourbarPosition, fourbarVelocity, fourbarAcceleration } from '../src/kinematics/index.js';
import { solve } from '../../../packages/core-math/src/index.js';

const DEG = Math.PI / 180;
const IN = 25.4, LB = 4.4482216, BLOB = LB / (IN / 1000), LBIN2 = LB * IN / 1000;
const at = (r, deg) => ({ x: r * Math.cos(deg * DEG), y: r * Math.sin(deg * DEG) });
const add = (p, q) => ({ x: p.x + q.x, y: p.y + q.y });
const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });
const rot = (p, t) => ({ x: p.x * Math.cos(t) - p.y * Math.sin(t), y: p.x * Math.sin(t) + p.y * Math.cos(t) });

// Example 2 (inches): crank 5, coupler 15, rocker 10, ground 19
const a = 5, b = 15, c = 10, d = 19;
const m = [0.004 * BLOB, 0.020 * BLOB, 0.015 * BLOB];   // kg
const I = [0.4 * LBIN2, 1.5 * LBIN2, 0.8 * LBIN2];       // kg·m²
const w2 = 25, al2 = -40;
// centres of mass in each link's frame (r ∠ θ from its first joint along the line of centres)
const G2l = at(3, 30), G3l = at(9, 45), G4l = at(5, 0), Pl = add(G3l, at(3, 45 + 100));
const Fp = at(80 * LB, 330);       // N, fixed direction
const T4 = 120 * LBIN2;            // N·m

function build(gravity) {
  const th2 = 60 * DEG, sol = fourbarPosition(a, b, c, d, th2).open;
  const A = at(a, 60), B = add(A, at(b, sol.theta3 / DEG));
  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true }), O4 = addJoint(doc, d * IN, 0, { ground: true });
  const JA = addJoint(doc, A.x * IN, A.y * IN), JB = addJoint(doc, B.x * IN, B.y * IN);
  const L2 = addLink(doc, [O2.id, JA.id]), L3 = addLink(doc, [JA.id, JB.id]), L4 = addLink(doc, [O4.id, JB.id]);
  const polar = (from, to, p) => ({ from, to, x: p.x * IN, y: p.y * IN });
  L2.mass = { m: m[0], I: I[0], local: polar(O2.id, JA.id, G2l) };
  L3.mass = { m: m[1], I: I[1], local: polar(JA.id, JB.id, G3l) };
  L4.mass = { m: m[2], I: I[2], local: polar(O4.id, JB.id, G4l) };
  const P = add(A, rot(Pl, sol.theta3));
  doc.loads = [
    { id: 'fP', link: L3.id, kind: 'force', at: { x: P.x * IN, y: P.y * IN }, F: Fp, follow: false, profile: { type: 'constant' } },
    { id: 'T4', link: L4.id, kind: 'torque', at: { x: d * IN, y: 0 }, T: T4, follow: false, profile: { type: 'constant' } },
  ];
  setDriverSpec(doc, { type: 'rotary', link: L2.id, pivot: O2.id, ref: null });
  doc.motion.omega = w2; doc.motion.alpha = al2;
  doc.dynamics = { mode: 'dynamic', gravity, g: 9.81 };
  const s = new Simulation();
  s.reset(doc);
  return { s, ids: { O2, O4, JA, JB, L2, L3, L4 } };
}

/** The textbook solution at crank angle th2 (SI): F12, F32, F43, F14, T12. */
function textbook(th2, theta3hint, gravity) {
  const sols = fourbarPosition(a, b, c, d, th2);
  const near = (t) => Math.abs(Math.atan2(Math.sin(t - theta3hint), Math.cos(t - theta3hint)));
  const sol = near(sols.open.theta3) < near(sols.crossed.theta3) ? sols.open : sols.crossed;
  const { theta3: t3, theta4: t4 } = sol;
  const { omega3: w3, omega4: w4 } = fourbarVelocity(a, b, c, th2, t3, t4, w2);
  const { alpha3: al3, alpha4: al4 } = fourbarAcceleration(a, b, c, th2, t3, t4, w2, w3, w4, al2);
  const M = 0.0254;   // m per inch
  const O2 = { x: 0, y: 0 }, O4 = { x: d * M, y: 0 };
  const A = { x: a * M * Math.cos(th2), y: a * M * Math.sin(th2) };
  const B = add(A, { x: b * M * Math.cos(t3), y: b * M * Math.sin(t3) });
  const sc = (p) => ({ x: p.x * M, y: p.y * M });
  const G2 = rot(sc(G2l), th2), G3 = add(A, rot(sc(G3l), t3)), G4 = add(O4, rot(sc(G4l), t4)), Pp = add(A, rot(sc(Pl), t3));
  const acc = (aBase, r, al, w) => ({ x: aBase.x - al * r.y - w * w * r.x, y: aBase.y + al * r.x - w * w * r.y });
  const aA = acc({ x: 0, y: 0 }, A, al2, w2);
  const aG2 = acc({ x: 0, y: 0 }, G2, al2, w2), aG3 = acc(aA, sub(G3, A), al3, w3), aG4 = acc({ x: 0, y: 0 }, sub(G4, O4), al4, w4);
  const g = gravity ? 9.81 : 0;
  const R12 = sub(O2, G2), R32 = sub(A, G2), R23 = sub(A, G3), R43 = sub(B, G3), RP = sub(Pp, G3), R34 = sub(B, G4), R14 = sub(O4, G4);
  // unknowns F12x F12y F32x F32y F43x F43y F14x F14y T12 (as on the slide)
  const Mx = [
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
    m[0] * aG2.x, m[0] * (aG2.y + g), I[0] * al2,
    m[1] * aG3.x - Fp.x, m[1] * (aG3.y + g) - Fp.y, I[1] * al3 - (RP.x * Fp.y - RP.y * Fp.x),
    m[2] * aG4.x, m[2] * (aG4.y + g), I[2] * al4 - T4,
  ];
  const x = solve(Mx, rhs);
  const v = (i) => ({ x: x[i], y: x[i + 1] });
  return { F12: v(0), F32: v(2), F43: v(4), F14: v(6), T12: x[8] };
}

for (const gravity of [false, true]) {
  test(`fourbar dynamics over a whole turn match the textbook matrix (${gravity ? 'with' : 'without'} gravity)`, () => {
    const { s, ids } = build(gravity);
    assert.ok(s.drivable);
    const sw = s.getSweep();
    assert.ok(sw.fullTurn);
    const bi = (id) => s.sys.bodyIndex.get(id);
    const force = (r, joint, from, on) => {   // force of link `from` on link `on` (null = ground)
      const f = from ? bi(from) : -1, o = bi(on);
      const p = r.pins.find((q) => q.joint === joint && ((q.i === o && q.j === f) || (q.i === f && q.j === o)));
      return p.i === o ? p.F : { x: -p.F.x, y: -p.F.y };
    };
    const names = ['F12', 'F32', 'F43', 'F14'];
    const ours = (r) => ({
      F12: force(r, ids.O2.id, null, ids.L2.id), F32: force(r, ids.JA.id, ids.L3.id, ids.L2.id),
      F43: force(r, ids.JB.id, ids.L4.id, ids.L3.id), F14: force(r, ids.O4.id, null, ids.L4.id), T12: r.input.torque,
    });
    let worst = 0, n = 0;
    const peak = { ours: {}, book: {} };
    for (const smp of sw.samples) {
      const r = analyseForces(s, smp);
      if (!r) continue;
      const th2 = smp.theta, t3 = smp.results.links.get(ids.L3.id).theta;
      const L = ours(r), T = textbook(th2, t3, gravity);
      for (const k of names) {
        worst = Math.max(worst, Math.hypot(L[k].x - T[k].x, L[k].y - T[k].y) / Math.max(1, Math.hypot(T[k].x, T[k].y)));
        for (const [who, F] of [['ours', L[k]], ['book', T[k]]]) {
          const mag = Math.hypot(F.x, F.y);
          if (!peak[who][k] || mag > peak[who][k].mag) peak[who][k] = { mag, ang: Math.atan2(F.y, F.x) / DEG, th: (((th2 / DEG) % 360) + 360) % 360 };
        }
      }
      worst = Math.max(worst, Math.abs(L.T12 - T.T12) / Math.max(1, Math.abs(T.T12)));
      n++;
    }
    assert.ok(n > 200, `positions checked: ${n}`);
    assert.ok(worst < 1e-6, `largest relative difference over the turn: ${worst}`);
    for (const k of names) {
      const o = peak.ours[k], t = peak.book[k];
      assert.ok(Math.abs(o.mag - t.mag) < 1e-6 * t.mag && Math.abs(o.th - t.th) < 1e-9, `${k} peak`);
    }
    if (process.env.SHOW) {
      console.log(`\n${gravity ? 'with' : 'without'} gravity — ${n} positions, largest difference ${worst.toExponential(1)}`);
      for (const k of names) { const o = peak.ours[k]; console.log(`  ${k}: max ${(o.mag / LB).toFixed(2)} lb (${o.mag.toFixed(1)} N) ∠ ${o.ang.toFixed(1)}° at θ2 = ${o.th.toFixed(1)}°`); }
    }
  });
}
