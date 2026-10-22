// =============================================================================
// system.js — turn a LinkLab document into constraint equations
// -----------------------------------------------------------------------------
// METHOD (body coordinates)
// Each moving link i gets three unknowns  q_i = (x_i, y_i, φ_i):
//   (x_i, y_i)  position of the link's reference point (centroid of its joints
//               in the design pose), and
//   φ_i         rotation of the link away from its design pose.
// A point fixed on link i (local vector s' from the reference point) is at
//   P = r_i + A(φ_i)·s'                      A = rotation matrix
// Some pairs add an extra unknown (the direction ψ of the line of centres of
// two rolling circles), appended after the body coordinates.
//
// Constraint equations Φ(q, θ) = 0 — every planar pair LinkLab supports:
//   revolute (pin)        P_i − P_j = 0                               2 rows
//   pin to ground         P_i − G = 0                                 2 rows
//   pin-in-slot (slider)  n_R·(P − A_R) = 0   rail fixed or on link R   1 row
//   prismatic             φ_j − φ_i = 0 ;  n_i·(P_j − A_i) = 0          2 rows
//   roll, circle–circle   C_j − C_i − R e(ψ) = 0 ;  no-slip in φ, ψ     3 rows
//   roll, circle–line     n·(C − A) = σρ ;  u·(C − A) + σρ(φ_c − φ_L) = k  2 rows
//   roll-slide            contact rows only (no no-slip row)
//   actuator (held)       |P_a − P_b| − L = 0                         1 row
//   input (driver)        value(q) − θ = 0, where value is one of:     1 row
//                           motor:     relative angle of two links at a pin
//                           actuator:  length between its two joints
//                           slider / prismatic: position along the axis
// (θ is the input: an angle in radians for a motor, a length in mm otherwise.)
//
// Each constraint supplies its rows of Φ, of the Jacobian J = ∂Φ/∂q, and of
// γ for the acceleration equation J q̈ = γ (the part of Φ̈ without q̈, negated).
// Velocity: J q̇ = ν (zero except the input row). This works for any planar
// mechanism built from these pairs — not only the fourbar.
// =============================================================================

import { jointById, linkById, linksAtJoint, isFrameLink, angleReference } from '../model/document.js';

// ---- small helpers for points on bodies ---------------------------------------
// Body index -1 is the ground: its coordinates are always zero.

const angle = (q, i) => (i >= 0 ? q[3 * i + 2] : 0);
const omega = (qd, i) => (i >= 0 ? qd[3 * i + 2] : 0);

/** A(φ)s' — local vector s' rotated with body i. */
function rot(q, i, s) {
  const t = angle(q, i), c = Math.cos(t), sn = Math.sin(t);
  return { x: c * s.x - sn * s.y, y: sn * s.x + c * s.y };
}

/** B(φ)s' = ∂(A s')/∂φ — rotated by a further 90°. */
function drot(q, i, s) {
  const t = angle(q, i), c = Math.cos(t), sn = Math.sin(t);
  return { x: -sn * s.x - c * s.y, y: c * s.x - sn * s.y };
}

/** World position of local point s on body i (ground: s is already world). */
export function pointOnBody(q, i, s) {
  if (i < 0) return { x: s.x, y: s.y };
  const a = rot(q, i, s);
  return { x: q[3 * i] + a.x, y: q[3 * i + 1] + a.y };
}

/** Velocity of a local point (needs q̇). */
function pointVel(q, qd, i, s) {
  if (i < 0) return { x: 0, y: 0 };
  const b = drot(q, i, s), w = qd[3 * i + 2];
  return { x: qd[3 * i] + b.x * w, y: qd[3 * i + 1] + b.y * w };
}

/** Add c·∂P/∂q (for point s on body i) into a Jacobian row. */
function addPointJac(row, q, i, s, cx, cy) {
  if (i < 0) return;
  const b = drot(q, i, s);
  row[3 * i] += cx;
  row[3 * i + 1] += cy;
  row[3 * i + 2] += cx * b.x + cy * b.y;
}

// ---- constraint types -------------------------------------------------------------

/**
 * Revolute: local point si on body i coincides with sj on body j (j may be ground).
 * `gap` is a world offset P_i − P_j, normally zero; the tolerance study sets it
 * to model the play of a pin in a larger hole (it does not change J or γ).
 */
function revolute(i, si, j, sj) {
  const c = {
    rows: 2,
    gap: { x: 0, y: 0 },
    eval(q, n) {
      const Pi = pointOnBody(q, i, si), Pj = pointOnBody(q, j, sj);
      const rx = new Array(n).fill(0), ry = new Array(n).fill(0);
      addPointJac(rx, q, i, si, 1, 0); addPointJac(ry, q, i, si, 0, 1);
      addPointJac(rx, q, j, sj, -1, 0); addPointJac(ry, q, j, sj, 0, -1);
      return { F: [Pi.x - Pj.x - c.gap.x, Pi.y - Pj.y - c.gap.y], J: [rx, ry] };
    },
    gamma(q, qd) {
      const wi = omega(qd, i), wj = omega(qd, j);
      const ai = rot(q, i, si), aj = rot(q, j, sj);
      const gi = i >= 0 ? wi * wi : 0, gj = j >= 0 ? wj * wj : 0;
      return [ai.x * gi - aj.x * gj, ai.y * gi - aj.y * gj];
    },
  };
  return c;
}

/**
 * Fixed: body i stays where it was drawn (x0, y0, no turn), 3 rows. Holds a
 * frame link: a link with two or more ground pivots is part of the ground.
 */
function fixed(i, x0, y0) {
  return {
    rows: 3,
    eval(q, n) {
      const J = [0, 1, 2].map((k) => { const row = new Array(n).fill(0); row[3 * i + k] = 1; return row; });
      return { F: [q[3 * i] - x0, q[3 * i + 1] - y0, q[3 * i + 2]], J };
    },
    gamma() { return [0, 0, 0]; },
  };
}

/**
 * Projection row  F = d·(P − A) − offset, where P is local point s on body o
 * and the line (through a', direction d') is carried by body r. Used for
 * pin-in-slot, prismatic and rolling-on-a-line.
 */
function projectionRow(o, s, r, aLocal, dLocal, offset = 0) {
  return {
    eval(q, n) {
      const P = pointOnBody(q, o, s), A = pointOnBody(q, r, aLocal), d = rot(q, r, dLocal);
      const row = new Array(n).fill(0);
      addPointJac(row, q, o, s, d.x, d.y);
      if (r >= 0) {
        const dd = drot(q, r, dLocal), da = drot(q, r, aLocal);
        row[3 * r] -= d.x; row[3 * r + 1] -= d.y;
        row[3 * r + 2] += dd.x * (P.x - A.x) + dd.y * (P.y - A.y) - (d.x * da.x + d.y * da.y);
      }
      return { F: d.x * (P.x - A.x) + d.y * (P.y - A.y) - offset, J: row };
    },
    // γ = −(Φ̈ without q̈), from Φ = d·(P − A):
    //   Φ̈ = d̈·(P−A) + 2 ḋ·(Ṗ−Ȧ) + d·(P̈−Ä)
    gamma(q, qd) {
      const P = pointOnBody(q, o, s), A = pointOnBody(q, r, aLocal), d = rot(q, r, dLocal);
      const wr = omega(qd, r), wo = omega(qd, o);
      const Pv = pointVel(q, qd, o, s), Av = pointVel(q, qd, r, aLocal);
      const dd = drot(q, r, dLocal);
      const ao = rot(q, o, s), ar = rot(q, r, aLocal);
      const dDot = { x: dd.x * wr, y: dd.y * wr };
      const ddotdot = { x: -d.x * wr * wr, y: -d.y * wr * wr };
      const Pacc = o >= 0 ? { x: -ao.x * wo * wo, y: -ao.y * wo * wo } : { x: 0, y: 0 };
      const Aacc = r >= 0 ? { x: -ar.x * wr * wr, y: -ar.y * wr * wr } : { x: 0, y: 0 };
      const phi2 = ddotdot.x * (P.x - A.x) + ddotdot.y * (P.y - A.y)
        + 2 * (dDot.x * (Pv.x - Av.x) + dDot.y * (Pv.y - Av.y))
        + d.x * (Pacc.x - Aacc.x) + d.y * (Pacc.y - Aacc.y);
      return -phi2;
    },
  };
}

/** Linear row  F = Σ c_k·q_k − k0  (relative rotations, no-slip). γ = 0. */
function linearRow(coeffs, k0 = 0) {
  return {
    eval(q, n) {
      const row = new Array(n).fill(0);
      let F = -k0;
      for (const [idx, c] of coeffs) { row[idx] += c; F += c * q[idx]; }
      return { F, J: row };
    },
    gamma() { return 0; },
  };
}

/**
 * Distance row  F = |P1 − P2| − L  (points s1 on body o1, s2 on body o2).
 * Used for linear actuators. γ from F̈ = (ḋ·ḋ + d·d̈)/|d| − (d·ḋ)²/|d|³.
 */
function distanceRow(o1, s1, o2, s2, L) {
  return {
    eval(q, n) {
      const P1 = pointOnBody(q, o1, s1), P2 = pointOnBody(q, o2, s2);
      const dx = P1.x - P2.x, dy = P1.y - P2.y, D = Math.hypot(dx, dy) || 1e-12;
      const ex = dx / D, ey = dy / D;
      const row = new Array(n).fill(0);
      addPointJac(row, q, o1, s1, ex, ey);
      addPointJac(row, q, o2, s2, -ex, -ey);
      return { F: D - L, J: row };
    },
    gamma(q, qd) {
      const P1 = pointOnBody(q, o1, s1), P2 = pointOnBody(q, o2, s2);
      const V1 = pointVel(q, qd, o1, s1), V2 = pointVel(q, qd, o2, s2);
      const d = { x: P1.x - P2.x, y: P1.y - P2.y }, v = { x: V1.x - V2.x, y: V1.y - V2.y };
      const D = Math.hypot(d.x, d.y) || 1e-12;
      const a1 = rot(q, o1, s1), a2 = rot(q, o2, s2);
      const w1 = omega(qd, o1), w2 = omega(qd, o2);
      const g1 = o1 >= 0 ? w1 * w1 : 0, g2 = o2 >= 0 ? w2 * w2 : 0;
      const acc = { x: -a1.x * g1 + a2.x * g2, y: -a1.y * g1 + a2.y * g2 }; // q̈-free part of d̈
      const dv = d.x * v.x + d.y * v.y;
      const phi2 = (v.x * v.x + v.y * v.y + d.x * acc.x + d.y * acc.y) / D - (dv * dv) / (D * D * D);
      return -phi2;
    },
  };
}

/** Bundle several single rows into one constraint. */
function combine(parts) {
  return {
    rows: parts.length,
    eval(q, n) {
      const F = [], J = [];
      for (const p of parts) { const r = p.eval(q, n); F.push(r.F); J.push(r.J); }
      return { F, J };
    },
    gamma(q, qd) { return parts.map((p) => p.gamma(q, qd)); },
  };
}

/**
 * Rolling contact between circle (centre ci, radius ρi) on body i and circle
 * (cj, ρj) on body j. Extra unknown ψ (index k) is the direction from the
 * first centre to the second.
 *   external:  C_j − C_i = (ρi+ρj) e(ψ);  ρi(φi−ψ) + ρj(φj−ψ) = const
 *   internal (i inside j):  C_j − C_i = (ρj−ρi) e(ψ);  ρj(φj−ψ) − ρi(φi−ψ) = const
 * `slip` = true leaves out the no-slip row (roll + slide).
 */
function circleCircle(i, ci, rhoI, j, cj, rhoJ, internal, k, psi0, slip) {
  const R = internal ? rhoJ - rhoI : rhoI + rhoJ;
  const contact = {
    eval(q, n) {
      const Ci = pointOnBody(q, i, ci), Cj = pointOnBody(q, j, cj);
      const psi = q[k], c = Math.cos(psi), s = Math.sin(psi);
      const rx = new Array(n).fill(0), ry = new Array(n).fill(0);
      addPointJac(rx, q, j, cj, 1, 0); addPointJac(ry, q, j, cj, 0, 1);
      addPointJac(rx, q, i, ci, -1, 0); addPointJac(ry, q, i, ci, 0, -1);
      rx[k] += R * s; ry[k] -= R * c;
      return { F: [Cj.x - Ci.x - R * c, Cj.y - Ci.y - R * s], J: [rx, ry] };
    },
    gamma(q, qd) {
      const psi = q[k], pd = qd[k];
      const wi = omega(qd, i), wj = omega(qd, j);
      const ai = rot(q, i, ci), aj = rot(q, j, cj);
      const gi = i >= 0 ? wi * wi : 0, gj = j >= 0 ? wj * wj : 0;
      // Φ̈ (q̈-free) = −A_j c_j ω_j² + A_i c_i ω_i² + R e(ψ) ψ̇²
      return [
        -(-aj.x * gj + ai.x * gi + R * Math.cos(psi) * pd * pd),
        -(-aj.y * gj + ai.y * gi + R * Math.sin(psi) * pd * pd),
      ];
    },
  };
  const parts = [{ rows: 2, ...contact }];
  if (!slip) {
    const co = [];
    if (internal) {
      if (j >= 0) co.push([3 * j + 2, rhoJ]);
      if (i >= 0) co.push([3 * i + 2, -rhoI]);
      co.push([k, -(rhoJ - rhoI)]);
      parts.push({ rows: 1, ...wrapSingle(linearRow(co, -(rhoJ - rhoI) * psi0)) });
    } else {
      if (i >= 0) co.push([3 * i + 2, rhoI]);
      if (j >= 0) co.push([3 * j + 2, rhoJ]);
      co.push([k, -(rhoI + rhoJ)]);
      parts.push({ rows: 1, ...wrapSingle(linearRow(co, -(rhoI + rhoJ) * psi0)) });
    }
  }
  return {
    rows: parts.reduce((s, p) => s + p.rows, 0),
    eval(q, n) {
      const F = [], J = [];
      for (const p of parts) { const r = p.eval(q, n); F.push(...r.F); J.push(...r.J); }
      return { F, J };
    },
    gamma(q, qd) { return parts.flatMap((p) => p.gamma(q, qd)); },
  };
}

/** Label a constraint with what it is: { kind: 'pin' | 'slider' | …, ids }. */
function tag(c, info) { c.info = info; return c; }

/** Turn a single-row object into the multi-row shape. */
function wrapSingle(r) {
  return {
    eval(q, n) { const x = r.eval(q, n); return { F: [x.F], J: [x.J] }; },
    gamma(q, qd) { return [r.gamma(q, qd)]; },
  };
}

// ---- building the system from a document ------------------------------------------

/**
 * Build the constraint system for a document.
 * Returns bodies, constraints and helpers. The document is not modified.
 * opts.holeOffset(jointId, bodyIndex) → { x, y } | null moves the pin hole of
 * that joint on that body (ground: bodyIndex −1) — used by the tolerance study.
 */
export function buildSystem(doc, opts = {}) {
  // ---- bodies ----
  const bodies = doc.links.map((link, index) => {
    const pts = link.joints.map((id) => jointById(doc, id)).filter(Boolean);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const local = new Map();
    for (const p of pts) local.set(p.id, { x: p.x - cx, y: p.y - cy });
    // reference line for the link's angle θ (angleReference: from the ground
    // pivot when there is one, else first joint → second); a wheel (one
    // joint) is measured from +x
    const [fromId, toId] = angleReference(doc, link);
    const from = jointById(doc, fromId), to = toId && jointById(doc, toId);
    const theta0 = from && to ? Math.atan2(to.y - from.y, to.x - from.x) : 0;
    return { id: link.id, index, ref: { x: cx, y: cy }, local, theta0, jointIds: link.joints.slice(), disc: link.disc || 0 };
  });
  const bodyIndex = new Map(bodies.map((b, i) => [b.id, i]));
  // frame links (two or more ground pivots) cannot move: each is held where it
  // was drawn by one fixed constraint (below) and has no pins of its own, so
  // nothing is redundant and the pin play study, the pin forces and the
  // mobility count see it as part of the ground
  const frame = new Set(doc.links.filter((l) => isFrameLink(doc, l)).map((l) => bodyIndex.get(l.id)));
  const bodyOf = (linkId) => (linkId === null || linkId === undefined ? -1 : (bodyIndex.has(linkId) ? bodyIndex.get(linkId) : null));
  /** Design-pose world point → local vector on body i (world point for ground). */
  const toLocal = (i, p) => (i < 0 ? { x: p.x, y: p.y } : { x: p.x - bodies[i].ref.x, y: p.y - bodies[i].ref.y });

  /** Body coordinates of the drawn (design) position — no rotation. */
  const designQ = () => { const q = []; bodies.forEach((b) => q.push(b.ref.x, b.ref.y, 0)); return q; };
  /** A typical length of the mechanism, for default stroke ranges. */
  const reach = () => {
    let m = 0;
    for (const b of bodies) for (const v of b.local.values()) m = Math.max(m, 2 * Math.hypot(v.x, v.y));
    return m || 100;
  };
  const constraints = [];
  const counts = { pins: 0, sliders: 0, prismatic: 0, roll: 0, rollslide: 0 };
  let nExtra = 0;
  const extras = []; // initial values of extra coordinates
  const nb = bodies.length;
  const extraIndex = () => { const k = 3 * nb + nExtra; nExtra++; return k; };

  // ---- frame links ----
  for (const i of frame) constraints.push(tag(fixed(i, bodies[i].ref.x, bodies[i].ref.y), { kind: 'fixed', i }));

  // ---- revolute joints ----
  const pins = [];
  for (const joint of doc.joints) {
    const all = linksAtJoint(doc, joint.id).map((l) => bodyIndex.get(l.id));
    const members = all.filter((m) => !frame.has(m)), onFrame = all.length > members.length;
    if (members.length === 0) continue;
    // optional hole position error (tolerance study): only at real pins
    let G = { x: joint.x, y: joint.y };
    if (opts.holeOffset && members.length + (joint.ground || onFrame ? 1 : 0) >= 2) {
      for (const m of members) {
        const d = opts.holeOffset(joint.id, m), s = bodies[m].local.get(joint.id);
        if (d) bodies[m].local.set(joint.id, { x: s.x + d.x, y: s.y + d.y });
      }
      const d = joint.ground || onFrame ? opts.holeOffset(joint.id, -1) : null;
      if (d) G = { x: G.x + d.x, y: G.y + d.y };
    }
    const first = members[0];
    const sFirst = bodies[first].local.get(joint.id);
    for (let k = 1; k < members.length; k++) {
      constraints.push(tag(revolute(first, sFirst, members[k], bodies[members[k]].local.get(joint.id)), { kind: 'pin', joint: joint.id, i: first, j: members[k] }));
      pins.push({ joint: joint.id, i: first, j: members[k] });
    }
    // a joint on a frame link is as good as a ground pivot
    if (joint.ground || onFrame) {
      constraints.push(tag(revolute(first, sFirst, -1, G), { kind: 'pin', joint: joint.id, i: first, j: -1 }));
      pins.push({ joint: joint.id, i: first, j: -1 });
    }
  }
  counts.pins = pins.length;

  // ---- pin-in-slot sliders (rail fixed or on a link) ----
  const sliders = [];
  for (const s of doc.sliders) {
    const j = jointById(doc, s.joint);
    if (!j) continue;
    const members = linksAtJoint(doc, s.joint).map((l) => bodyIndex.get(l.id));
    let o;
    if (members.length) o = members[0];
    else if (j.ground) o = -1;
    else continue;
    const r = bodyOf(s.on ?? null);
    if (r === null || r === o) continue;
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, L = Math.hypot(dx, dy) || 1;
    const u = { x: dx / L, y: dy / L }, nrm = { x: -u.y, y: u.x };
    const sP = o >= 0 ? bodies[o].local.get(s.joint) : { x: j.x, y: j.y };
    const aL = toLocal(r, s.a);
    constraints.push(tag({ rows: 1, ...wrapSingle(projectionRow(o, sP, r, aL, nrm)) }, { kind: 'slider', id: s.id, joint: s.joint, i: o, j: r, n: nrm }));
    sliders.push({ joint: s.joint, id: s.id, o, r, sP, aL, u, n: nrm, a: { ...s.a } });
  }
  counts.sliders = sliders.length;

  // ---- other pairs ----
  const pairs = [];
  for (const p of doc.pairs || []) {
    if (p.type === 'prismatic') {
      const g = bodyOf(p.guide ?? null), sl = bodyOf(p.slider);
      if (g === null || sl === null || sl < 0 || g === sl) continue;
      const dx = p.b.x - p.a.x, dy = p.b.y - p.a.y, L = Math.hypot(dx, dy) || 1;
      const nrm = { x: -dy / L, y: dx / L };
      const sP = toLocal(sl, p.a); // the axis point, carried by the slider
      const rot0 = [[3 * sl + 2, 1]];
      if (g >= 0) rot0.push([3 * g + 2, -1]);
      // no relative rotation, and the axis point stays on the guide's axis
      // (the normal is a direction, so it is not shifted by the reference point)
      constraints.push(tag(combine([linearRow(rot0), projectionRow(sl, sP, g, toLocal(g, p.a), nrm)]), { kind: 'prismatic', id: p.id, i: sl, j: g, n: nrm }));
      pairs.push({ id: p.id, type: 'prismatic', g, sl, a: { ...p.a }, u: { x: dx / L, y: dy / L } });
      counts.prismatic++;
      continue;
    }
    // roll / rollslide: resolve the two contours
    const A = resolveContour(doc, p.a, bodyOf), B = resolveContour(doc, p.b, bodyOf);
    if (!A || !B) continue;
    const slip = p.type === 'rollslide';
    if (A.shape === 'line' && B.shape === 'line') continue;
    if (A.shape === 'circle' && B.shape === 'circle') {
      if (A.body === B.body) continue;
      const D = Math.hypot(B.c.x - A.c.x, B.c.y - A.c.y);
      // internal if the centres are closer to |ρa − ρb| than to ρa + ρb
      const internal = Math.abs(D - Math.abs(A.r - B.r)) < Math.abs(D - (A.r + B.r)) && Math.abs(A.r - B.r) > 1e-9;
      // the smaller circle goes first when internal
      const [I, Jc] = internal && A.r > B.r ? [B, A] : [A, B];
      const psi0 = Math.atan2(Jc.c.y - I.c.y, Jc.c.x - I.c.x);
      const k = extraIndex();
      extras.push(psi0);
      constraints.push(tag(circleCircle(I.body, toLocal(I.body, I.c), I.r, Jc.body, toLocal(Jc.body, Jc.c), Jc.r, internal, k, psi0, slip), { kind: p.type, id: p.id, shape: 'cc', i: I.body, j: Jc.body, k, internal }));
      pairs.push({ id: p.id, type: p.type, shape: 'cc', i: I.body, ci: toLocal(I.body, I.c), ri: I.r, j: Jc.body, cj: toLocal(Jc.body, Jc.c), rj: Jc.r, internal, k });
    } else {
      const C = A.shape === 'circle' ? A : B, Ln = A.shape === 'circle' ? B : A;
      if (C.body === Ln.body) continue;
      const dx = Ln.b.x - Ln.a.x, dy = Ln.b.y - Ln.a.y, L = Math.hypot(dx, dy) || 1;
      const u = { x: dx / L, y: dy / L }, nrm = { x: -u.y, y: u.x };
      const side = nrm.x * (C.c.x - Ln.a.x) + nrm.y * (C.c.y - Ln.a.y) >= 0 ? 1 : -1;
      const cL = toLocal(C.body, C.c), aL = toLocal(Ln.body, Ln.a);
      const rows = [projectionRow(C.body, cL, Ln.body, aL, nrm, side * C.r)];
      if (!slip) {
        // u·(C − A) + σρ(φc − φL) = value at the design pose
        const s0 = u.x * (C.c.x - Ln.a.x) + u.y * (C.c.y - Ln.a.y);
        const along = projectionRow(C.body, cL, Ln.body, aL, u, s0);
        const lin = [];
        if (C.body >= 0) lin.push([3 * C.body + 2, side * C.r]);
        if (Ln.body >= 0) lin.push([3 * Ln.body + 2, -side * C.r]);
        const linRow = linearRow(lin);
        rows.push({
          eval(q, n) { const a = along.eval(q, n), b = linRow.eval(q, n); return { F: a.F + b.F, J: a.J.map((v, x) => v + b.J[x]) }; },
          gamma(q, qd) { return along.gamma(q, qd); },
        });
      }
      constraints.push(tag(combine(rows), { kind: p.type, id: p.id, shape: 'cl', i: C.body, j: Ln.body, n: nrm, u, side }));
      pairs.push({ id: p.id, type: p.type, shape: 'cl', c: C.body, cL, r: C.r, l: Ln.body, aL, u, n: nrm, side });
    }
    counts[slip ? 'rollslide' : 'roll']++;
  }

  // ---- linear actuators that are not the input hold their length ----
  const dspec = doc.driver || {};
  const dtype = dspec.type || 'rotary';
  const actuators = [];
  for (const u of doc.actuators || []) {
    const ja = jointById(doc, u.a), jb = jointById(doc, u.b);
    if (!ja || !jb) continue;
    const ends = [ja, jb].map((j) => {
      const m = linksAtJoint(doc, j.id).map((l) => bodyIndex.get(l.id));
      if (m.length) return { o: m[0], s: bodies[m[0]].local.get(j.id) };
      return j.ground ? { o: -1, s: { x: j.x, y: j.y } } : null;
    });
    if (!ends[0] || !ends[1] || (ends[0].o === ends[1].o)) continue;
    const L0 = Math.hypot(jb.x - ja.x, jb.y - ja.y);
    const row = distanceRow(ends[0].o, ends[0].s, ends[1].o, ends[1].s, L0);
    const isInput = dtype === 'linear' && dspec.actuator === u.id;
    if (!isInput) constraints.push(tag({ rows: 1, ...wrapSingle(row) }, { kind: 'actuator', id: u.id }));
    actuators.push({ id: u.id, a: u.a, b: u.b, ends, L0, isInput });
  }

  // ---- input (driver) ----
  // value(q) − θ = 0. `thetaDesign` is the input value in the drawn position.
  let driver = null;
  const drv = (o) => (driver = { type: dtype, unit: dtype === 'rotary' ? 'rad' : 'mm', ...o });
  if (dtype === 'rotary' && dspec.link && bodyIndex.has(dspec.link)) {
    const d = bodies[bodyIndex.get(dspec.link)];
    const pivot = jointById(doc, dspec.pivot);
    const refBody = dspec.ref && bodyIndex.has(dspec.ref) ? bodyIndex.get(dspec.ref) : -1;
    // angle of a link's line from the pivot to its next joint
    const lineAngle = (b) => {
      const other = b.jointIds.find((id) => id !== dspec.pivot);
      const o = other ? jointById(doc, other) : null;
      return o ? Math.atan2(o.y - pivot.y, o.x - pivot.x) : 0;
    };
    const tipId = d.jointIds.find((id) => id !== dspec.pivot) || null;
    const thetaDesign = lineAngle(d) - (refBody >= 0 ? lineAngle(bodies[refBody]) : 0);
    const i = bodyIndex.get(d.id);
    const coeffs = [[3 * i + 2, 1]];
    if (refBody >= 0) coeffs.push([3 * refBody + 2, -1]);
    const lin = linearRow(coeffs, -thetaDesign);
    drv({ i, ref: refBody, pivot: pivot.id, tip: tipId, thetaDesign, row: lin,
      read: (q) => thetaDesign + q[3 * i + 2] - (refBody >= 0 ? q[3 * refBody + 2] : 0) });
  } else if (dtype === 'linear') {
    const a = actuators.find((x) => x.isInput);
    if (a) {
      const row = distanceRow(a.ends[0].o, a.ends[0].s, a.ends[1].o, a.ends[1].s, 0);
      const u = (doc.actuators || []).find((x) => x.id === a.id);
      drv({ actuator: a.id, thetaDesign: a.L0, row, range: [u.min, u.max],
        read: (q) => row.eval(q, sys.n).F });
    }
  } else if (dtype === 'slider') {
    const sl = sliders.find((x) => x.id === dspec.slider && x.r < 0);
    if (sl) {
      const row = projectionRow(sl.o, sl.sP, -1, sl.aL, sl.u);
      const P0 = pointOnBody(designQ(), sl.o, sl.sP);
      const v0 = sl.u.x * (P0.x - sl.a.x) + sl.u.y * (P0.y - sl.a.y);
      drv({ slider: sl.id, thetaDesign: v0, row, range: dspec.range || [v0 - 0.6 * reach(), v0 + 0.6 * reach()],
        read: (q) => row.eval(q, sys.n).F });
    }
  } else if (dtype === 'prismatic') {
    const pr = pairs.find((x) => x.id === dspec.pair && x.type === 'prismatic');
    if (pr) {
      const sP = toLocal(pr.sl, pr.a);
      const row = projectionRow(pr.sl, sP, pr.g, toLocal(pr.g, pr.a), pr.u);
      drv({ pair: pr.id, thetaDesign: 0, row, range: dspec.range || [-0.6 * reach(), 0.6 * reach()],
        read: (q) => row.eval(q, sys.n).F });
    }
  }

  const n = 3 * nb + nExtra;
  const sys = { bodies, bodyIndex, constraints, pins, sliders, pairs, actuators, counts, driver, n, nBodies: nb, extras, frame };
  return sys;
}

/** Geometry of one side of a contact pair, in design-pose world coordinates. */
export function resolveContour(doc, ref, bodyOf) {
  if (!ref) return null;
  if (ref.kind === 'disc') {
    const l = linkById(doc, ref.link);
    if (!l || !l.disc) return null;
    const j = jointById(doc, l.joints[0]);
    const body = bodyOf(l.id);
    return body === null ? null : { shape: 'circle', body, c: { x: j.x, y: j.y }, r: l.disc };
  }
  if (ref.kind === 'linkline') {
    const l = linkById(doc, ref.link);
    if (!l || l.joints.length < 2) return null;
    const a = jointById(doc, l.joints[0]), b = jointById(doc, l.joints[1]);
    const body = bodyOf(l.id);
    return body === null ? null : { shape: 'line', body, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
  }
  if (ref.kind === 'entity') {
    const e = doc.construction.find((x) => x.id === ref.id);
    if (!e) return null;
    const body = bodyOf(e.attach ?? null);
    if (body === null) return null;
    if (e.kind === 'circle' || e.kind === 'arc') return { shape: 'circle', body, c: { ...e.c }, r: e.r };
    if (e.kind === 'segment' || e.kind === 'xline') return { shape: 'line', body, a: { ...e.a }, b: { ...e.b } };
  }
  return null;
}

/** Design-pose coordinates: links at their reference points, zero rotation. */
export function designCoordinates(sys) {
  const q = new Array(sys.n).fill(0);
  sys.bodies.forEach((b, i) => { q[3 * i] = b.ref.x; q[3 * i + 1] = b.ref.y; q[3 * i + 2] = 0; });
  sys.extras.forEach((v, k) => { q[3 * sys.nBodies + k] = v; });
  return q;
}

// ---- equations ----------------------------------------------------------------------

/**
 * Evaluate Φ and J at coordinates q and input angle θ.
 * `withDriver = false` leaves out the input equation (used to count degrees
 * of freedom and for free dragging).
 */
export function evaluate(sys, q, theta, withDriver = true) {
  const F = [], J = [];
  for (const c of sys.constraints) {
    const r = c.eval(q, sys.n);
    F.push(...r.F); J.push(...r.J);
  }
  if (withDriver && sys.driver) {
    const r = sys.driver.row.eval(q, sys.n);
    J.push(r.J);
    F.push(r.F - theta); // every input row measures the input value itself
  }
  return { F, J };
}

/** Right-hand side γ of J q̈ = γ. The input row is α_input. */
export function gamma(sys, q, qd, alphaIn = 0) {
  const g = [];
  for (const c of sys.constraints) g.push(...c.gamma(q, qd));
  if (sys.driver) g.push(sys.driver.row.gamma(q, qd) + alphaIn);
  return g;
}

/** Velocity right-hand side ν: zero except the input row (= ω_input). */
export function nu(sys, omegaIn) {
  const rows = sys.constraints.reduce((s, c) => s + c.rows, 0);
  const v = new Array(rows).fill(0);
  if (sys.driver) v.push(omegaIn);
  return v;
}

// ---- results for one pose ------------------------------------------------------

/**
 * Positions, velocities and accelerations of every joint and link for a
 * solved pose. qd and qdd may be null (position only).
 */
export function poseResults(sys, doc, q, qd = null, qdd = null) {
  const joints = new Map();
  const links = new Map();
  sys.bodies.forEach((b, i) => {
    const phi = q[3 * i + 2];
    const w = qd ? qd[3 * i + 2] : null;
    const al = qdd ? qdd[3 * i + 2] : null;
    links.set(b.id, { theta: b.theta0 + phi, omega: w, alpha: al, x: q[3 * i], y: q[3 * i + 1], phi });
    for (const [jid, s] of b.local) {
      if (joints.has(jid)) continue;
      const P = pointOnBody(q, i, s);
      const r = { pos: P, vel: null, acc: null };
      if (qd) r.vel = pointVel(q, qd, i, s);
      if (qd && qdd) {
        const B = drot(q, i, s), A = rot(q, i, s);
        r.acc = { x: qdd[3 * i] + B.x * al - A.x * w * w, y: qdd[3 * i + 1] + B.y * al - A.y * w * w };
      }
      joints.set(jid, r);
    }
  });
  // ground pivots that carry no link
  for (const j of doc.joints) {
    if (!joints.has(j.id)) joints.set(j.id, { pos: { x: j.x, y: j.y }, vel: { x: 0, y: 0 }, acc: { x: 0, y: 0 } });
  }
  // slider displacement along its rail (relative to the rail)
  const sliders = new Map();
  for (const s of sys.sliders) {
    const r = joints.get(s.joint);
    const u = rot(q, s.r, s.u), A = pointOnBody(q, s.r, s.aL);
    const d = (r.pos.x - A.x) * u.x + (r.pos.y - A.y) * u.y;
    let v = null, a = null;
    if (qd && r.vel) {
      const Av = pointVel(q, qd, s.r, s.aL);
      v = (r.vel.x - Av.x) * u.x + (r.vel.y - Av.y) * u.y;
      if (s.r >= 0) v = null; // relative speed along a moving rail is shown only for fixed rails
    }
    if (qdd && r.acc && s.r < 0) a = r.acc.x * u.x + r.acc.y * u.y;
    sliders.set(s.id, { d, v, a, joint: s.joint, moving: s.r >= 0 });
  }
  return { joints, links, sliders };
}

/**
 * Rigid transform of link `linkId` from the design pose to coordinates q.
 * Returns a function mapping a design-pose world point to its current
 * position (used to move attached drawings and bodies).
 */
export function linkTransform(sys, q, linkId) {
  const i = sys.bodyIndex.get(linkId);
  if (i === undefined) return (p) => p;
  const b = sys.bodies[i];
  const c = Math.cos(q[3 * i + 2]), s = Math.sin(q[3 * i + 2]);
  const tx = q[3 * i], ty = q[3 * i + 1];
  return (p) => {
    const dx = p.x - b.ref.x, dy = p.y - b.ref.y;
    return { x: tx + c * dx - s * dy, y: ty + s * dx + c * dy };
  };
}
