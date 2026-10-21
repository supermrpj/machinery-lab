// =============================================================================
// The two worked examples of the Week 9 lecture (dynamic force analysis),
// built in LinkLab and solved by it, against the answers on the slides.
// The slides work in inches, pounds and blobs (lb·s²/in) with gravity left
// out; LinkLab works in mm, N and kg, so values are converted both ways.
//   Example 1  a single link in pure rotation        → F12, T12
//   Example 2  a fourbar with a load on the coupler  → F12, F32, F43, F14, T12
// Names follow the slides: F_ij is the force of link i on link j.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, addLink, setDriverSpec } from '../src/model/document.js';
import { Simulation } from '../src/model/simulation.js';
import { analyseForces } from '../src/model/forces.js';

const DEG = Math.PI / 180;
const IN = 25.4;                  // mm per inch
const LB = 4.4482216;             // N per pound-force
const BLOB = LB / (IN / 1000);    // kg per blob (lb·s²/in)
const LBIN2 = LB * IN / 1000;     // kg·m² per lb·in·s²  (also N·m per lb·in)

const at = (r, deg) => ({ x: r * Math.cos(deg * DEG), y: r * Math.sin(deg * DEG) });
const add = (p, q) => ({ x: p.x + q.x, y: p.y + q.y });
const mm = (p) => ({ x: p.x * IN, y: p.y * IN });

/** Within `rel` of the slide value (the slides round their inputs to 3–4 figures). */
function near(got, want, rel, msg) {
  if (process.env.SHOW) console.log(`${msg.padEnd(14)} ${got.toFixed(3).padStart(10)}   slide ${want}`);
  assert.ok(Math.abs(got - want) <= rel * Math.max(Math.abs(want), 1), `${msg}: LinkLab ${got.toFixed(3)} vs slide ${want}`);
}

function run(doc, omega, alpha) {
  doc.motion.omega = omega; doc.motion.alpha = alpha;
  doc.dynamics = { mode: 'dynamic', gravity: false, g: 9.81 };
  const s = new Simulation();
  s.reset(doc);
  return { s, r: analyseForces(s) };
}

/** Force of link `from` on link `on` at a pin, in lb (from = null for the ground). */
function F(r, s, jointId, from, on) {
  const bi = (id) => (id ? s.sys.bodyIndex.get(id) : -1);
  const p = r.pins.find((x) => x.joint === jointId && ((x.i === bi(on) && x.j === bi(from)) || (x.i === bi(from) && x.j === bi(on))));
  assert.ok(p, 'pin found');
  const sign = p.i === bi(on) ? 1 : -1; // results are the force on body i from body j
  return { x: (sign * p.F.x) / LB, y: (sign * p.F.y) / LB };
}

test('Example 1: single link in pure rotation (F12 and T12)', () => {
  // 10 in link at 30°, CG at 5 in, 4 lb, I_G = 0.08 lb·in·s², ω = 20, α = 15 rad/s²,
  // 40 lb at 0° at P (the far end). The slide rounds the mass to 0.01 blob.
  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true });
  const P = mm(at(10, 30));
  const Pj = addJoint(doc, P.x, P.y);
  const link = addLink(doc, [O2.id, Pj.id]);
  link.mass = { m: 0.01 * BLOB, cg: mm(at(5, 30)), I: 0.08 * LBIN2 };
  doc.loads = [{ id: 'f1', link: link.id, kind: 'force', at: P, F: { x: 40 * LB, y: 0 }, follow: false, profile: { type: 'constant' } }];
  setDriverSpec(doc, { type: 'rotary', link: link.id, pivot: O2.id, ref: null });
  const { s, r } = run(doc, 20, 15);
  assert.ok(r && r.unique);
  const F12 = F(r, s, O2.id, null, link.id);
  // the slide rounds a_G to 2001 in/s² at 208°; exactly it is 2001.4 at 207.85°,
  // so F12y is −9.35 lb rather than −9.39 (0.4 %)
  near(F12.x, -57.67, 5e-3, 'F12x (lb)');
  near(F12.y, -9.39, 5e-3, 'F12y (lb)');
  near(r.input.torque / LBIN2, 204.72, 5e-3, 'T12 (lb·in)');
  near(Math.hypot(F12.x, F12.y), 58.43, 5e-3, '|F12| (lb)');
  // and exactly, from the hand formulas with the unrounded acceleration
  const m = 0.01, rG = 5, th = 30 * DEG;
  const aG = { x: -rG * 20 * 20 * Math.cos(th) - rG * 15 * Math.sin(th), y: -rG * 20 * 20 * Math.sin(th) + rG * 15 * Math.cos(th) };
  const F12x = m * aG.x - 40, F12y = m * aG.y;
  const R12 = at(-5, 30), RP = at(5, 30);
  const T12 = 0.08 * 15 - (R12.x * F12y - R12.y * F12x) - (RP.x * 0 - RP.y * 40);
  near(F12.x, F12x, 1e-9, 'F12x exact'); near(F12.y, F12y, 1e-9, 'F12y exact');
  near(r.input.torque / LBIN2, T12, 1e-9, 'T12 exact');
});

// the centre of mass entered two ways: as world x, y, and as r ∠ θ in each link's
// own frame (from a joint, along the line of centres), as in the mass popup
for (const how of ['as x, y', 'as r ∠ θ in the link frame']) test(`Example 2: fourbar with a force on the coupler and a torque on the rocker (G ${how})`, () => {
  // crank 5 in at 60°, coupler 15, rocker 10, ground 19 (inches)
  const O2p = { x: 0, y: 0 }, O4p = { x: 19, y: 0 };
  const Ap = at(5, 60);
  // the coupler angle that closes the loop (the slide gives θ3 = 20.92°, θ4 = 104.41°)
  const dx = O4p.x - Ap.x, dy = O4p.y - Ap.y, e = Math.hypot(dx, dy);
  const th3 = Math.atan2(dy, dx) + Math.acos((15 * 15 + e * e - 10 * 10) / (2 * 15 * e));
  const Bp = add(Ap, at(15, th3 / DEG));
  near(th3 / DEG, 20.92, 1e-3, 'θ3 (deg)');

  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true });
  const O4 = addJoint(doc, O4p.x * IN, 0, { ground: true });
  const A = addJoint(doc, Ap.x * IN, Ap.y * IN);
  const B = addJoint(doc, Bp.x * IN, Bp.y * IN);
  const L2 = addLink(doc, [O2.id, A.id]);
  const L3 = addLink(doc, [A.id, B.id]);
  const L4 = addLink(doc, [O4.id, B.id]);
  // CG2: 3 in at +30° from the line of centres; CG3: 9 in at 45° from it;
  // CG4: 5 in along it. Masses as rounded on the slide.
  const G2 = at(3, 60 + 30), G3 = add(Ap, at(9, th3 / DEG + 45));
  const th4 = Math.atan2(Bp.y - O4p.y, Bp.x - O4p.x) / DEG;
  const G4 = add(O4p, at(5, th4));
  if (how === 'as x, y') {
    L2.mass = { m: 0.004 * BLOB, cg: mm(G2), I: 0.4 * LBIN2 };
    L3.mass = { m: 0.020 * BLOB, cg: mm(G3), I: 1.5 * LBIN2 };
    L4.mass = { m: 0.015 * BLOB, cg: mm(G4), I: 0.8 * LBIN2 };
  } else {
    const polar = (from, to, r, deg) => ({ from, to, x: r * IN * Math.cos(deg * DEG), y: r * IN * Math.sin(deg * DEG) });
    L2.mass = { m: 0.004 * BLOB, I: 0.4 * LBIN2, local: polar(O2.id, A.id, 3, 30) };
    L3.mass = { m: 0.020 * BLOB, I: 1.5 * LBIN2, local: polar(A.id, B.id, 9, 45) };
    L4.mass = { m: 0.015 * BLOB, I: 0.8 * LBIN2, local: polar(O4.id, B.id, 5, 0) };
  }
  // 80 lb at 330° at P (3 in at 100° from CG3 in the coupler's frame); 120 lb·in on link 4
  const P = add(G3, at(3, th3 / DEG + 100));
  const Fp = at(80 * LB, 330);
  doc.loads = [
    { id: 'f1', link: L3.id, kind: 'force', at: mm(P), F: Fp, follow: false, profile: { type: 'constant' } },
    { id: 'f2', link: L4.id, kind: 'torque', at: mm(G4), T: 120 * LBIN2, follow: false, profile: { type: 'constant' } },
  ];
  setDriverSpec(doc, { type: 'rotary', link: L2.id, pivot: O2.id, ref: null });
  const { s, r } = run(doc, 25, -40);
  assert.ok(r && r.unique);

  // kinematics on the slide
  const w = (id) => s.results.links.get(id);
  near(w(L3.id).omega, -5.87, 2e-3, 'ω3');
  near(w(L3.id).alpha, 120.9, 2e-3, 'α3');
  near(w(L4.id).omega, 7.93, 2e-3, 'ω4');
  near(w(L4.id).alpha, 276.29, 2e-3, 'α4');

  // forces on the slide (h)
  const F12 = F(r, s, O2.id, null, L2.id);
  const F32 = F(r, s, A.id, L3.id, L2.id);
  const F43 = F(r, s, B.id, L4.id, L3.id);
  const F14 = F(r, s, O4.id, null, L4.id);
  const tol = 5e-3; // the slide's accelerations and positions are rounded
  near(F12.x, -117.65, tol, 'F12x'); near(F12.y, -107.84, tol, 'F12y');
  near(F32.x, 118.13, tol, 'F32x'); near(F32.y, 100.34, tol, 'F32y');
  near(F43.x, -1.34, tol, 'F43x'); near(F43.y, 87.43, tol, 'F43y');
  near(F14.x, -20.23, tol, 'F14x'); near(F14.y, 77.71, tol, 'F14y');
  near(r.input.torque / LBIN2, 243.23, tol, 'T12 (lb·in)');
});
