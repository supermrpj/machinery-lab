// =============================================================================
// dynamics.js — joint forces and the input torque (inverse dynamics)
// -----------------------------------------------------------------------------
// METHOD (Lagrange multipliers on the same constraints as the kinematics)
// The motion is known from the kinematics (q, q̇, q̈). For every link the
// applied forces (gravity, loads) and the inertia (d'Alembert) forces
//   −m·a_G at the centre of mass,  −I_G·α  as a couple
// are collected as generalized forces G on its coordinates (x, y, φ). The
// constraint forces then follow from one linear system:
//   Φqᵀ λ = G            (Φq includes the input row)
// Each row's multiplier is the force that constraint carries:
//   pin        P_i − P_j = 0   →  force on link i from link j = −λ  (N)
//   input      value − θ = 0   →  motor torque on the driven link = −λ
// Static analysis is the same with q̇ = q̈ = 0. With redundant constraints
// (gears on fixed centres) the forces are not unique; the smallest set is
// returned and `indeterminate` is set.
//
// Units inside: lengths mm, forces N, moments N·mm. Masses kg, I kg·m².
// Results: forces in N, torques and moments in N·m.
// =============================================================================

import { solve, transpose } from '../../../../packages/core-math/src/index.js';
import { evaluate } from './system.js';

/** A(φ_i)·s — a local vector turned with body i (world vector for the ground). */
function turn(q, i, s) {
  if (i < 0) return { x: s.x, y: s.y };
  const t = q[3 * i + 2], c = Math.cos(t), sn = Math.sin(t);
  return { x: c * s.x - sn * s.y, y: sn * s.x + c * s.y };
}

const cross = (a, b) => a.x * b.y - a.y * b.x;

/** Solve Aλ = b where A (n×m) may be square, wide (redundant) or tall. */
function solveMultipliers(J, G) {
  const m = J.length, n = G.length;
  const A = transpose(J); // n × m
  if (m === n) { const x = solve(A, G, 1e-14); if (x) return { lambda: x, exact: true, unique: true }; }
  if (m > n) {
    // smallest λ:  λ = J (Jᵀ J)⁻¹ ... in our layout A = Jᵀ, so λ = Aᵀ (A Aᵀ)⁻¹ G
    const AAt = A.map((r) => A.map((c) => r.reduce((s, v, k) => s + v * c[k], 0)));
    for (let i = 0; i < n; i++) AAt[i][i] += 1e-12 * (1 + Math.abs(AAt[i][i]));
    const y = solve(AAt, G, 1e-18);
    if (y) return { lambda: J.map((row) => row.reduce((s, v, k) => s + v * y[k], 0)), exact: true, unique: false };
  }
  // tall (too few constraints to hold it): least squares; the residual is the unbalance
  const AtA = J.map((r) => J.map((c) => r.reduce((s, v, k) => s + v * c[k], 0)));
  for (let i = 0; i < m; i++) AtA[i][i] += 1e-12 * (1 + Math.abs(AtA[i][i]));
  const Atb = J.map((r) => r.reduce((s, v, k) => s + v * G[k], 0));
  const x = solve(AtA, Atb, 1e-18);
  return x ? { lambda: x, exact: false, unique: true } : null;
}

/**
 * Inverse dynamics at one pose.
 *   bodies[i] = { m, c: local centre of mass (mm), I }   (one per link)
 *   loads     = [{ i, s: local point (mm), F: {x,y} N world }  or  { i, T: N·m }]
 *   opts      = { dynamic, g (m/s², −y), pivot: {x,y} for moments }
 * q̇, q̈ are used only when opts.dynamic. Returns null if the forces cannot be
 * found (e.g. exactly at a toggle position, where they are unbounded).
 */
export function inverseDynamics(sys, q, qd, qdd, theta, bodies, loads, opts = {}) {
  const n = sys.n, G = new Array(n).fill(0);
  const dyn = !!opts.dynamic && qd && qdd;
  const g = opts.g || 0;
  const O = opts.pivot || { x: 0, y: 0 };
  /** Generalized force of a point force F (N) at local point s of body i. */
  const addForce = (i, s, F) => {
    const a = turn(q, i, s);
    G[3 * i] += F.x; G[3 * i + 1] += F.y; G[3 * i + 2] += cross(a, F);
  };
  const motion = [];
  let Fs = { x: 0, y: 0 }, Ms = 0, KE = 0, PE = 0, dKE = 0, P_applied = 0, Fapplied = { x: 0, y: 0 };
  sys.bodies.forEach((b, i) => {
    const mp = bodies[i] || { m: 0, c: { x: 0, y: 0 }, I: 0 };
    const rc = turn(q, i, mp.c);
    const G0 = { x: q[3 * i] + rc.x, y: q[3 * i + 1] + rc.y }; // centre of mass (mm)
    let aG = { x: 0, y: 0 }, vG = { x: 0, y: 0 }, w = 0, al = 0;
    if (dyn) {
      w = qd[3 * i + 2]; al = qdd[3 * i + 2];
      // a_G = r̈ + α k×(A c) − ω² (A c)
      aG = { x: qdd[3 * i] - al * rc.y - w * w * rc.x, y: qdd[3 * i + 1] + al * rc.x - w * w * rc.y };
      vG = { x: qd[3 * i] - w * rc.y, y: qd[3 * i + 1] + w * rc.x };
    }
    const Fin = { x: (-mp.m * aG.x) / 1000, y: (-mp.m * aG.y) / 1000 };   // N (a in mm/s²)
    const Tin = -mp.I * al * 1000;                                          // N·mm
    const Fg = { x: 0, y: -mp.m * g };                                      // N
    addForce(i, mp.c, { x: Fin.x + Fg.x, y: Fin.y + Fg.y });
    G[3 * i + 2] += Tin;
    // shaking force and moment (inertia only), and energy for checks
    Fs = { x: Fs.x + Fin.x, y: Fs.y + Fin.y };
    Ms += (cross({ x: G0.x - O.x, y: G0.y - O.y }, Fin) + Tin) / 1000;     // N·m
    KE += 0.5 * mp.m * ((vG.x * vG.x + vG.y * vG.y) / 1e6) + 0.5 * mp.I * w * w;
    PE += (mp.m * g * G0.y) / 1000;                                         // J, gravity, zero at y = 0
    dKE += (mp.m * (aG.x * vG.x + aG.y * vG.y)) / 1e6 + mp.I * al * w;     // W
    P_applied += (Fg.y * vG.y) / 1000;                                       // W
    Fapplied = { x: Fapplied.x + Fg.x, y: Fapplied.y + Fg.y };
    motion.push({ G: G0, aG, vG, Fin, Tin: Tin / 1000 });
  });
  for (const L of loads) {
    if (L.T !== undefined) {
      G[3 * L.i + 2] += L.T * 1000;
      if (dyn) P_applied += L.T * qd[3 * L.i + 2];
    } else {
      addForce(L.i, L.s, L.F);
      Fapplied = { x: Fapplied.x + L.F.x, y: Fapplied.y + L.F.y };
      if (dyn) {
        const a = turn(q, L.i, L.s), w = qd[3 * L.i + 2];
        const v = { x: qd[3 * L.i] - w * a.y, y: qd[3 * L.i + 1] + w * a.x };
        P_applied += (L.F.x * v.x + L.F.y * v.y) / 1000;
      }
    }
  }

  const { J } = evaluate(sys, q, theta, true);
  const sol = solveMultipliers(J, G);
  if (!sol || !sol.lambda.every(Number.isFinite)) return null;
  const lam = sol.lambda;
  // how well the forces balance the links (non-zero: not enough constraints)
  const resid = transpose(J).map((r, k) => r.reduce((s, v, j) => s + v * lam[j], 0) - G[k]);
  const unbalance = Math.max(...resid.map(Math.abs), 0);
  const scaleG = Math.max(1e-9, ...G.map(Math.abs));
  if (Math.max(...lam.map(Math.abs)) > 1e9 * scaleG) return null; // a toggle: unbounded

  // ---- read the multipliers as forces ----
  const out = { pins: [], sliders: [], prismatic: [], contacts: [], actuators: [], input: null };
  let r = 0;
  for (const c of sys.constraints) {
    const L = lam.slice(r, r + c.rows);
    r += c.rows;
    const info = c.info || {};
    if (info.kind === 'pin') {
      // force on link i from link j (or from the ground when j = −1)
      out.pins.push({ joint: info.joint, i: info.i, j: info.j, F: { x: -L[0], y: -L[1] } });
    } else if (info.kind === 'slider') {
      const nW = turn(q, info.j, info.n);
      out.sliders.push({ id: info.id, joint: info.joint, i: info.i, j: info.j, N: -L[0], F: { x: -L[0] * nW.x, y: -L[0] * nW.y } });
    } else if (info.kind === 'prismatic') {
      const nW = turn(q, info.j, info.n);
      out.prismatic.push({ id: info.id, i: info.i, j: info.j, M: -L[0] / 1000, N: -L[1], F: { x: -L[1] * nW.x, y: -L[1] * nW.y } });
    } else if (info.kind === 'roll' || info.kind === 'rollslide') {
      // F = the contact force on body i (world, N), acting at the contact point
      let F, N, T;
      if (info.shape === 'cc') {
        // rows 1–2: C_j − C_i − R·e(ψ) = 0  →  force on i = +λ (row 3, no slip,
        // only couples the rotations); e points from i's centre towards j's
        const psi = q[info.k], e = { x: Math.cos(psi), y: Math.sin(psi) };
        F = { x: L[0], y: L[1] };
        N = -(F.x * e.x + F.y * e.y);          // + pushes the two bodies apart
        T = F.x * -e.y + F.y * e.x;
      } else {
        // row 1 normal to the line, row 2 (no slip) along it: force on the circle
        const nW = turn(q, info.j, info.n), uW = turn(q, info.j, info.u);
        const t2 = L.length > 1 ? L[1] : 0;
        F = { x: -L[0] * nW.x - t2 * uW.x, y: -L[0] * nW.y - t2 * uW.y };
        N = -L[0]; T = -t2;
      }
      out.contacts.push({ id: info.id, type: info.kind, shape: info.shape, i: info.i, j: info.j, F, N, T, size: Math.hypot(F.x, F.y) });
    } else if (info.kind === 'actuator') {
      out.actuators.push({ id: info.id, push: -L[0] });
    }
  }
  if (sys.driver) {
    const ld = lam[lam.length - 1];
    out.input = sys.driver.unit === 'rad' ? { torque: -ld / 1000 } : { force: -ld };
  }
  out.shaking = { F: Fs, M: Ms };                       // N, N·m (about opts.pivot)
  out.frame = { x: Fapplied.x + Fs.x, y: Fapplied.y + Fs.y }; // total force on the frame, N
  out.energy = { KE, PE, dKE, P_applied };              // J, J, W, W
  out.motion = motion;
  out.unique = sol.unique;
  out.balanced = unbalance <= 1e-6 * scaleG + 1e-9;
  out.unbalance = unbalance;
  return out;
}

