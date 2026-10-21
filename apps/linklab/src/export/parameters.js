// =============================================================================
// parameters.js — link parameters for further analysis (acceleration, dynamics)
// -----------------------------------------------------------------------------
// Everything a student needs to carry on by hand, in Excel, MATLAB or Python:
//
//   joints       name (J1, J2 … as on the drawing), textbook label when the
//                mechanism is a textbook fourbar or slider-crank, position,
//                velocity and acceleration at the position shown
//   links        link number, the joints it carries, length, angle, ω, α
//   geometry     each joint in the link's own frame (origin at its first
//                joint, u along the line to its second joint, v 90° CCW) —
//                the numbers needed to place a centre of mass later
//   distances    every joint-to-joint distance on each link (plates have more
//                than one)
//   connections  how the links are joined: pins, sliders, prismatic, roll,
//                roll + slip and actuators
//   input        what drives it, its value, speed and acceleration
//
// mechanismParameters() builds one plain object; parametersCSV() and
// parametersJSON() write it out. The cycle-by-cycle data stays in the
// "Motion data" CSV (ui/plots.js), which uses the same joint names.
// =============================================================================

import { linkNumbers } from '../model/document.js';
import { listInputs, specKey } from '../model/outputs.js';
import { APP } from '../config.js';
import { unitsOf } from '../model/units.js';
import { massProps, dynamicsOf, densityOf } from '../model/mass.js';
import { analyseForces, forceLabels } from '../model/forces.js';

const DEG = 180 / Math.PI;

/** Joint names as shown on the drawing: J1, J2, … in drawing order. */
export function jointNames(doc) {
  const m = new Map();
  doc.joints.forEach((j, i) => m.set(j.id, `J${i + 1}`));
  return m;
}

/** Textbook labels (O2, A, B, O4) when the drawing is a fourbar or slider-crank. */
function textbookLabels(kind) {
  const m = new Map();
  if (!kind) return m;
  if (kind.type === 'fourbar') { m.set(kind.O2.id, 'O2'); m.set(kind.A.id, 'A'); m.set(kind.B.id, 'B'); m.set(kind.O4.id, 'O4'); }
  if (kind.type === 'slider-crank') { m.set(kind.O2.id, 'O2'); m.set(kind.A.id, 'A'); m.set(kind.B.id, 'B'); }
  return m;
}

const round = (v, digits = 6) => (v === null || v === undefined || !Number.isFinite(v) ? null : +v.toFixed(digits));
// the drawing's length unit (geometry is stored in mm); set at the start of each export
let U = unitsOf(null);
/** A length (or length rate) in the drawing's unit, rounded. */
const rl = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : round(U.len(v), 8));
const dist = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);

/**
 * Collect the parameters of the mechanism at the position shown.
 * `app` needs { doc, sim }.
 */
export function mechanismParameters(app) {
  const { doc, sim } = app;
  U = unitsOf(doc);
  const nums = linkNumbers(doc);
  const names = jointNames(doc);
  const info = sim.info || {};
  const labels = textbookLabels(info.kind);
  const R = sim.results;
  const moving = !!(R && sim.drivable);
  const pos = (id) => sim.jointPos(id);
  const jr = (id) => (R ? R.joints.get(id) : null);
  const linkName = (id) => (id ? nums.get(id) : 1);

  // ---- input ----
  const drv = doc.driver || {};
  const isAngle = sim.sys ? !!sim.inputIsAngle : (drv.type || 'rotary') === 'rotary';
  const inputs = listInputs(doc);
  const chosen = inputs.find((x) => specKey(x.spec) === specKey(drv));
  const sign = doc.motion.reverse ? -1 : 1;
  const input = {
    description: chosen ? chosen.label : 'none',
    type: drv.type || 'rotary',
    link: drv.type === 'rotary' || !drv.type ? (drv.link ? nums.get(drv.link) : null) : null,
    joint: drv.pivot ? names.get(drv.pivot) : null,
    value: sim.sys && Number.isFinite(sim.theta) ? (isAngle ? round(sim.theta * DEG) : rl(sim.theta)) : null,
    value_unit: isAngle ? 'deg' : U.label,
    speed: isAngle ? round(doc.motion.omega * sign) : rl(doc.motion.omega * sign),
    speed_unit: isAngle ? 'rad/s' : `${U.label}/s`,
    acceleration: isAngle ? round(doc.motion.alpha) : rl(doc.motion.alpha),
    acceleration_unit: isAngle ? 'rad/s^2' : `${U.label}/s^2`,
  };

  // ---- joints ----
  const joints = doc.joints.map((j) => {
    const p = pos(j.id), r = jr(j.id);
    const on = doc.links.filter((l) => l.joints.includes(j.id)).map((l) => nums.get(l.id));
    if (j.ground) on.unshift(1);
    return {
      name: names.get(j.id),
      label: labels.get(j.id) || null,
      ground: !!j.ground,
      traced: !!j.trace,
      x: rl(p.x), y: rl(p.y),
      vx: moving && r && r.vel ? rl(r.vel.x) : null, vy: moving && r && r.vel ? rl(r.vel.y) : null,
      ax: moving && r && r.acc ? rl(r.acc.x) : null, ay: moving && r && r.acc ? rl(r.acc.y) : null,
      links: on.sort((a, b) => a - b),
    };
  });

  // ---- links ----
  const groundJoints = doc.joints.filter((j) => j.ground).map((j) => j.id);
  const linkRows = [];
  const frameOf = (jointIds, preferred) => {
    // origin: the motor pivot for the input, else a ground pivot, else the first joint
    const from = (preferred && jointIds.includes(preferred) && preferred)
      || jointIds.find((id) => groundJoints.includes(id)) || jointIds[0];
    const to = jointIds.find((id) => id !== from);
    return { from, to };
  };
  const geometry = (jointIds, from, to) => {
    const O = pos(from), T = pos(to);
    const th = Math.atan2(T.y - O.y, T.x - O.x);
    const c = Math.cos(th), s = Math.sin(th);
    return {
      angle: th,
      points: jointIds.map((id) => {
        const P = pos(id), dx = P.x - O.x, dy = P.y - O.y;
        return { joint: names.get(id), u: rl(dx * c + dy * s), v: rl(-dx * s + dy * c) };
      }),
    };
  };
  const distances = (jointIds) => {
    const out = [];
    for (let i = 0; i < jointIds.length; i++) for (let k = i + 1; k < jointIds.length; k++) {
      out.push({ from: names.get(jointIds[i]), to: names.get(jointIds[k]), length: rl(dist(pos(jointIds[i]), pos(jointIds[k]))) });
    }
    return out;
  };

  // link 1: the ground (frame)
  if (groundJoints.length) {
    const row = { number: 1, kind: 'ground', joints: groundJoints.map((id) => names.get(id)), length: null, from: null, to: null, angle: null, omega: 0, alpha: 0, radius: null, points: [], distances: distances(groundJoints) };
    if (groundJoints.length >= 2) {
      const { from, to } = frameOf(groundJoints, drv.pivot);
      const g = geometry(groundJoints, from, to);
      Object.assign(row, { from: names.get(from), to: names.get(to), angle: round(g.angle * DEG), points: g.points });
      if (groundJoints.length === 2) row.length = row.distances[0].length;
    }
    linkRows.push(row);
  }
  const ordered = [...doc.links].sort((a, b) => nums.get(a.id) - nums.get(b.id));
  for (const l of ordered) {
    const r = R ? R.links.get(l.id) : null;
    const row = {
      number: nums.get(l.id),
      kind: l.disc ? 'wheel' : l.joints.length > 2 ? 'plate' : 'bar',
      joints: l.joints.map((id) => names.get(id)),
      length: null, from: null, to: null, angle: null,
      omega: moving && r ? round(r.omega) : null,
      alpha: moving && r ? round(r.alpha) : null,
      radius: l.disc ? rl(l.disc) : null,
      points: [], distances: distances(l.joints),
      locked: !!l.locked,
    };
    {
      const mp = massProps(doc, l);
      row.mass = { m: round(U.M.show(mp.m), 9), I: round(U.I.show(mp.I), 12), source: mp.auto ? mp.from : 'typed', cg: null };
      row._cg = mp.cg; // placed in the link frame below
    }
    if (l.disc) {
      row.from = names.get(l.joints[0]);
      row.angle = r ? round(r.phi * DEG) : 0; // a wheel's turn from the drawn position
      row.points = [{ joint: names.get(l.joints[0]), u: 0, v: 0 }];
    } else if (l.joints.length >= 2) {
      const { from, to } = frameOf(l.joints, drv.type === 'rotary' && drv.link === l.id ? drv.pivot : null);
      const g = geometry(l.joints, from, to);
      Object.assign(row, { from: names.get(from), to: names.get(to), angle: round(g.angle * DEG), points: g.points });
      if (l.joints.length === 2) row.length = row.distances[0].length;
    }
    // centre of mass in the link's own frame (same u, v as the geometry table)
    if (row._cg) {
      const fromJ = row.from ? doc.joints[Number(row.from.slice(1)) - 1] : null;
      const toJ = row.to ? doc.joints[Number(row.to.slice(1)) - 1] : null;
      if (fromJ) {
        // design-pose frame of the link → current pose: use the joints' current positions
        const t = sim.transformFor(l.id);
        const G = t ? t.T(row._cg) : row._cg;
        const O = pos(fromJ.id), T = toJ ? pos(toJ.id) : { x: O.x + 1, y: O.y };
        const th = Math.atan2(T.y - O.y, T.x - O.x), c = Math.cos(th), sn = Math.sin(th);
        const dx = G.x - O.x, dy = G.y - O.y;
        row.mass.cg = { u: rl(dx * c + dy * sn), v: rl(-dx * sn + dy * c) };
      }
      delete row._cg;
    }
    linkRows.push(row);
  }

  // ---- connections ----
  const connections = [];
  for (const j of doc.joints) {
    const on = joints.find((x) => x.name === names.get(j.id)).links;
    if (on.length >= 2) {
      connections.push({ type: 'pin', joints: [names.get(j.id)], links: on, note: on.length > 2 ? `${on.length - 1} pin joints (multiple joint)` : '' });
    }
  }
  const axisNow = (a, b, linkId) => {
    const t = linkId ? sim.transformFor(linkId) : null;
    const A = t ? t.T(a) : a, B = t ? t.T(b) : b;
    return round(Math.atan2(B.y - A.y, B.x - A.x) * DEG);
  };
  doc.sliders.forEach((s, i) => {
    const r = R ? R.sliders.get(s.id) : null;
    const rail = s.on ? linkName(s.on) : 1;
    const carrier = doc.links.filter((l) => l.joints.includes(s.joint)).map((l) => nums.get(l.id));
    connections.push({
      type: s.on ? 'pin in slot' : 'slider', name: `slider ${i + 1}`, joints: [names.get(s.joint)],
      links: [rail, ...carrier], axis_angle: axisNow(s.a, s.b, s.on),
      position: r ? rl(r.d) : null, velocity: moving && r ? rl(r.v) : null, acceleration: moving && r ? rl(r.a) : null,
      note: s.on ? `slot along link ${rail}` : 'fixed rail; position measured from the rail start',
    });
  });
  const contour = (ref) => {
    if (!ref) return '?';
    if (ref.kind === 'disc') return `wheel ${linkName(ref.link)} (r = ${U.fmt(doc.links.find((l) => l.id === ref.link)?.disc)})`;
    if (ref.kind === 'linkline') return `centre line of link ${linkName(ref.link)}`;
    const e = doc.construction.find((c) => c.id === ref.id);
    if (!e) return '?';
    const owner = e.attach ? `on link ${linkName(e.attach)}` : 'on the ground';
    return e.kind === 'circle' || e.kind === 'arc' ? `circle ${owner} (r = ${U.fmt(e.r)})` : `line ${owner}`;
  };
  const refLink = (ref) => {
    if (!ref) return 1;
    if (ref.kind === 'disc' || ref.kind === 'linkline') return linkName(ref.link);
    const e = doc.construction.find((c) => c.id === ref.id);
    return e && e.attach ? linkName(e.attach) : 1;
  };
  for (const p of doc.pairs || []) {
    if (p.type === 'prismatic') {
      connections.push({ type: 'prismatic', joints: [], links: [linkName(p.guide), linkName(p.slider)], axis_angle: axisNow(p.a, p.b, p.guide),
        note: `link ${linkName(p.slider)} slides along ${p.guide ? `link ${linkName(p.guide)}` : 'the ground'} without turning relative to it` });
    } else {
      connections.push({ type: p.type === 'roll' ? 'roll (no slip)' : 'roll + slip (half joint)', joints: [], links: [refLink(p.a), refLink(p.b)],
        note: `${contour(p.a)} on ${contour(p.b)}` });
    }
  }
  (doc.actuators || []).forEach((u, i) => {
    const a = pos(u.a), b = pos(u.b);
    const ra = jr(u.a), rb = jr(u.b);
    const L = dist(a, b);
    let rate = null;
    if (moving && ra && rb && ra.vel && rb.vel) rate = ((b.x - a.x) * (rb.vel.x - ra.vel.x) + (b.y - a.y) * (rb.vel.y - ra.vel.y)) / (L || 1);
    const isInput = drv.type === 'linear' && drv.actuator === u.id;
    connections.push({ type: 'linear actuator', name: `actuator ${i + 1}`, joints: [names.get(u.a), names.get(u.b)], links: [],
      length: rl(L), min: rl(u.min), max: rl(u.max), velocity: rl(rate),
      note: isInput ? 'the input' : 'holds its length (acts as a link)' });
  });

  // ---- mechanism summary ----
  const g = info.gruebler || {};
  let type = 'general linkage';
  if (info.kind && info.kind.type === 'fourbar') type = `fourbar: ${info.kind.grashof ? info.kind.grashof.type : ''}`.replace(/: $/, '');
  if (info.kind && info.kind.type === 'slider-crank') type = 'slider-crank';

  // ---- forces at this pose (Forces panel) ----
  const dyn = dynamicsOf(doc);
  let forces = null;
  const fr = dyn.mode !== 'off' ? analyseForces(sim) : null;
  if (fr) {
    const FL = forceLabels(doc, sim);
    forces = {
      mode: dyn.mode, gravity: dyn.gravity ? dyn.g : 0,
      input: fr.input ? (fr.input.torque !== undefined ? { torque: round(U.T.show(fr.input.torque)) } : { force: round(U.F.show(fr.input.force)) }) : null,
      pins: fr.pins.map((p) => { const nm = FL.pin(p); return { name: nm.name.ascii, joint: nm.joint, on_link: nm.on, from_link: nm.from, Fx: round(U.F.show(p.F.x)), Fy: round(U.F.show(p.F.y)) }; }),
      sliders: fr.sliders.map((x) => ({ slider: FL.slider(x).name, normal: round(U.F.show(x.N)) })),
      shaking_force: { x: round(U.F.show(fr.shaking.F.x)), y: round(U.F.show(fr.shaking.F.y)) },
      shaking_moment: round(U.T.show(fr.shaking.M)),
      kinetic_energy: round(U.E.show(fr.energy.KE)),
      unique: fr.unique,
    };
  }

  return {
    format: 'linklab-parameters',
    version: 1,
    title: doc.meta.title,
    software: `LinkLab ${APP.version}`,
    exported: new Date().toISOString(),
    units: { length: U.label, angle: 'deg (counter-clockwise from +x)', velocity: `${U.label}/s`, acceleration: `${U.label}/s^2`, angular_velocity: 'rad/s (CCW +)', angular_acceleration: 'rad/s^2 (CCW +)',
      force: U.F.label, torque: U.T.label, mass: U.M.label, moment_of_inertia: U.I.label, energy: U.E.label },
    conventions: 'x to the right, y up. A link angle is the direction from its "from" joint to its "to" joint. In the geometry table u runs from "from" towards "to" and v is 90 degrees counter-clockwise from u. Values are at the position shown when exported.',
    mechanism: { type, links_L: g.L ?? null, full_joints_J1: g.J1 ?? null, half_joints_J2: g.J2 ?? null, gruebler_M: g.M ?? null, dof: info.dof ?? null, drivable: !!sim.drivable },
    input,
    joints,
    links: linkRows,
    connections,
    dynamics: { material: dyn.material, density_kg_m3: densityOf(dyn), thickness_mm: dyn.thickness, gravity_m_s2: dyn.gravity ? dyn.g : 0 },
    loads: (doc.loads || []).map((f) => ({ link: nums.get(f.link), kind: f.kind, at: { x: rl(f.at.x), y: rl(f.at.y) }, F: f.F ? { x: round(U.F.show(f.F.x)), y: round(U.F.show(f.F.y)) } : null, T: f.T !== undefined ? round(U.T.show(f.T)) : null, follows_link: !!f.follow, profile: f.profile || { type: 'constant' } })),
    forces,
    note: moving ? '' : 'Velocities and accelerations are blank: the mechanism needs exactly one degree of freedom and an input to compute them.',
  };
}

// ---- writers --------------------------------------------------------------------------

const cell = (v) => {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) v = v.join(' ');
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (...cells) => cells.map(cell).join(',');

/** One CSV file with labelled tables, separated by blank lines (opens in Excel). */
export function parametersCSV(P) {
  const L = [];
  L.push(line('LinkLab link parameters'));
  L.push(line('Title', P.title));
  L.push(line('Exported', P.exported, P.software));
  const u = P.units.length;
  L.push(line('Units', `lengths ${u}; angles deg CCW from +x; velocities ${u}/s and rad/s; accelerations ${u}/s^2 and rad/s^2`));
  L.push(line('Conventions', P.conventions));
  L.push(line('Mechanism', P.mechanism.type, 'L', P.mechanism.links_L, 'J1', P.mechanism.full_joints_J1, 'J2', P.mechanism.half_joints_J2, 'M (Gruebler)', P.mechanism.gruebler_M, 'DOF', P.mechanism.dof));
  const I = P.input;
  L.push(line('Input', I.description, 'value', I.value, I.value_unit, 'speed', I.speed, I.speed_unit, 'acceleration', I.acceleration, I.acceleration_unit));
  if (P.note) L.push(line('Note', P.note));

  L.push('', line('JOINTS (position, velocity and acceleration at the position shown)'));
  L.push(line('joint', 'label', 'ground', 'traced', `x_${u}`, `y_${u}`, `Vx_${u}_s`, `Vy_${u}_s`, `Ax_${u}_s2`, `Ay_${u}_s2`, 'on_links'));
  for (const j of P.joints) L.push(line(j.name, j.label, j.ground ? 'yes' : 'no', j.traced ? 'yes' : 'no', j.x, j.y, j.vx, j.vy, j.ax, j.ay, j.links));

  L.push('', line('LINKS (link 1 is the ground)'));
  L.push(line('link', 'type', 'joints', `length_${u}`, 'from', 'to', 'angle_deg', 'omega_rad_s', 'alpha_rad_s2', `radius_${u}`));
  for (const l of P.links) L.push(line(l.number, l.kind, l.joints, l.length, l.from, l.to, l.angle, l.omega, l.alpha, l.radius));

  L.push('', line('MASS PROPERTIES (centre of mass in the link\'s own frame; I about the centre of mass)'));
  const tag = (t) => t.replace(/·/g, '_').replace(/²/g, '2');
  L.push(line('link', `mass_${tag(P.units.mass)}`, `cg_u_${u}`, `cg_v_${u}`, `I_${tag(P.units.moment_of_inertia)}`, 'from'));
  for (const l of P.links) if (l.mass) L.push(line(l.number, l.mass.m, l.mass.cg && l.mass.cg.u, l.mass.cg && l.mass.cg.v, l.mass.I, l.mass.source));

  L.push('', line('LINK GEOMETRY (each joint in its link\'s own frame: origin at "from", u towards "to", v 90 deg CCW from u)'));
  L.push(line('link', 'joint', `u_${u}`, `v_${u}`));
  for (const l of P.links) for (const p of l.points) L.push(line(l.number, p.joint, p.u, p.v));

  L.push('', line('DISTANCES (every pair of joints on the same link)'));
  L.push(line('link', 'from', 'to', `length_${u}`));
  for (const l of P.links) for (const d of l.distances) L.push(line(l.number, d.from, d.to, d.length));

  L.push('', line('CONNECTIONS (how the links are joined)'));
  L.push(line('type', 'name', 'joints', 'links', 'axis_angle_deg', `position_${u}`, `velocity_${u}_s`, `acceleration_${u}_s2`, `length_${u}`, `min_${u}`, `max_${u}`, 'note'));
  for (const c of P.connections) L.push(line(c.type, c.name, c.joints, c.links, c.axis_angle, c.position, c.velocity, c.acceleration, c.length, c.min, c.max, c.note));

  if (P.forces) {
    const f = P.forces;
    L.push('', line(`FORCES AT THIS POSITION (${f.mode}; gravity ${f.gravity} m/s^2)`));
    const fu = P.units.force, tu = P.units.torque;
    if (f.input) L.push(line(f.input.torque !== undefined ? `input torque ${tu}` : `input force ${fu}`, f.input.torque ?? f.input.force));
    L.push(line('force (F_ij = of link i on link j)', 'joint', 'on_link', 'from_link', `Fx_${tag(fu)}`, `Fy_${tag(fu)}`));
    for (const p of f.pins) L.push(line(p.name, p.joint, p.on_link, p.from_link, p.Fx, p.Fy));
    for (const s of f.sliders) L.push(line(s.slider, `normal force ${fu}`, s.normal));
    L.push(line(`shaking force ${fu}`, f.shaking_force.x, f.shaking_force.y, `shaking moment ${tu}`, f.shaking_moment, `kinetic energy ${P.units.energy}`, f.kinetic_energy));
  }
  return L.join('\r\n') + '\r\n';
}

/** The same data as JSON (for MATLAB jsondecode, Python json.load, …). */
export const parametersJSON = (P) => JSON.stringify(P, null, 2);
