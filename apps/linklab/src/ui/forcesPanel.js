// =============================================================================
// forcesPanel.js — the Forces panel (statics and dynamics), apart from the
// kinematics in the Kinematics panel
// -----------------------------------------------------------------------------
//   1. Analysis      Off / Static / Dynamic
//   2. Masses        gravity, material, size of the links, and each link's m, I
//   3. Loads         the forces and torques added with the Force tool (E)
//   4. At this position   input torque or force, then every joint force
//   5. On the frame  shaking force and moment, kinetic energy
// =============================================================================

import { h } from '../../../../packages/ui-kit/src/dom.js';
import { fmt, fmtSig, parseNum } from '../../../../packages/ui-kit/src/format.js';
import { wrapPi } from '../../../../packages/core-math/src/index.js';
import { linkColor } from '../drawing/render.js';
import { inputLabel } from './timeline.js';
import { unitsOf } from '../model/units.js';
import { MATERIALS, dynamicsOf, massProps, densityOf } from '../model/mass.js';
import { forceLabels } from '../model/forces.js';
import { openMassDialog } from './massDialog.js';
import { FORCES } from '../config.js';
import { isFrameLink } from '../model/document.js';

const fN = (v) => fmtSig(v, 4);
const angOf = (F) => (Math.hypot(F.x, F.y) > 1e-9 ? `∠${fmt((Math.atan2(F.y, F.x) * 180) / Math.PI, 1)}°` : '');
const sub = (t) => h('span', { class: 'sub' }, t);
const warn = (msg) => h('p', { class: 'note warn-note' }, msg);

const MODES = [
  { id: 'off', label: 'Off' },
  { id: 'static', label: 'Static', note: 'Held still at the position shown, against gravity and your loads.' },
  { id: 'dynamic', label: 'Dynamic', note: 'Moving at the input speed and acceleration: the inertia of every link is added.' },
];

export function buildForces(app) {
  const sim = app.sim, doc = app.doc, dyn = dynamicsOf(doc), U = app.units;
  if (!sim.sys) return h('p', { class: 'note' }, 'Draw a mechanism to analyse its forces here.');
  const parts = [];

  // ---- 1. which analysis ----
  parts.push(h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Force analysis' },
    MODES.map((m) => h('button', {
      class: `seg-btn${dyn.mode === m.id ? ' on' : ''}`, role: 'radio', 'aria-checked': String(dyn.mode === m.id),
      onclick: () => app.setDynamics({ mode: m.id }),
    }, m.label))));
  const mode = MODES.find((m) => m.id === dyn.mode);
  if (dyn.mode === 'off') {
    parts.push(h('p', { class: 'note' }, 'Find the joint forces and the input torque from gravity, the forces you add (Force tool, E) and, when moving, the inertia of the links.'));
    return h('div', {}, parts);
  }
  parts.push(h('p', { class: 'note' }, mode.note));

  // ---- 2. masses ----
  parts.push(...massesBlock(app, dyn));

  // ---- 3. loads ----
  parts.push(...loadsBlock(app));

  // ---- 4. results at this position ----
  if (!sim.drivable) { parts.push(h('p', { class: 'note' }, app.whyNotDrivable())); return h('div', {}, parts); }
  const r = app.forcesNow();
  parts.push(h('div', { class: 'subhead' }, 'At this position'));
  if (!r) {
    parts.push(warn(sim.special && sim.special.kind === 'toggle'
      ? 'At a toggle position the input cannot hold or drive the mechanism: the forces are unbounded here.'
      : 'The forces cannot be found at this position.'));
    return h('div', {}, parts);
  }
  for (const msg of r.problems || []) parts.push(warn(msg));
  // close to a toggle position: the numbers here are real but grow without limit
  if (dyn.mode === 'dynamic' && app.forceSweepMasked()) {
    const k = sim.nearestSampleIndex(), list = app.forceSweep() || [];
    if (k >= 0 && !list[k]) parts.push(warn('This is close to a toggle position: at a constant input speed the forces here grow without limit.'));
  }
  parts.push(...resultsBlock(app, r));

  // ---- 5. what the frame feels ----
  parts.push(h('div', { class: 'subhead' }, 'On the frame'));
  const F = r.shaking.F;
  const rows = r.mode === 'dynamic'
    ? [
      ['Shaking force', `${fN(U.F.show(Math.hypot(F.x, F.y)))} ${U.F.label} ${angOf(F)}`],
      ['Shaking moment', `${fN(U.T.show(r.shaking.M))} ${U.T.label}`, `about ${r.momentAbout}`],
      ['Force on the frame', `${fN(U.F.show(Math.hypot(r.frame.x, r.frame.y)))} ${U.F.label} ${angOf(r.frame)}`, 'with gravity and loads'],
      ['Kinetic energy', `${fmtSig(U.E.show(r.energy.KE), 4)} ${U.E.label}`],
    ]
    : [['Force on the frame', `${fN(U.F.show(Math.hypot(r.frame.x, r.frame.y)))} ${U.F.label} ${angOf(r.frame)}`]];
  parts.push(h('table', { class: 'data kv' }, h('tbody', {}, rows.map(([k, v, note]) =>
    h('tr', {}, h('td', {}, k, note ? sub(` ${note}`) : null), h('td', {}, v))))));

  parts.push(h('p', { class: 'note' }, h('b', {}, 'F₂₃'), ' is the force of link 2 on link 3 (link 1 is the ground); F₃₂ = −F₂₃. Angles are of the force on the second link. Select a link to see its free-body diagram on the drawing.'));
  return h('div', {}, parts);
}

// -----------------------------------------------------------------------------
/** Gravity, material and size, and the mass of each link. */
function massesBlock(app, dyn) {
  const doc = app.doc, nums = app.linkNumbers(), U = app.units;
  const out = [h('div', { class: 'subhead with-guide' }, 'Masses',
    h('button', { class: 'hint-guide', title: 'How to set masses and centres of mass', onclick: () => app.ui.guides && app.ui.guides.open('masses') }, 'Guide'))];
  out.push(h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: dyn.gravity, onchange: (e) => app.setDynamics({ gravity: e.target.checked }) }),
    ` Gravity (${fmtSig(U.len(dyn.g * 1000), 4)} ${U.acc} downward, −y)`));
  // materials grouped as in MATERIALS, then a typed density
  const groups = [...new Set(Object.values(MATERIALS).map((m) => m.group))];
  out.push(h('div', { class: 'field short-label' }, h('label', {}, 'Material'), h('select', { 'aria-label': 'Material of the links', onchange: (e) => app.setDynamics({ material: e.target.value }) },
    groups.map((g) => h('optgroup', { label: g },
      Object.entries(MATERIALS).filter(([, m]) => m.group === g).map(([k, m]) => h('option', { value: k, selected: k === dyn.material }, `${m.name} — ${m.rho} kg/m³`)))),
    h('option', { value: 'custom', selected: dyn.material === 'custom' }, 'Custom density…'))));
  if (dyn.material === 'custom') {
    out.push(h('div', { class: 'field' }, h('label', {}, 'Density (kg/m³)'),
      h('input', { type: 'number', step: 'any', min: 0, value: densityOf(dyn), 'aria-label': 'Density of the links in kg/m³',
        onchange: (e) => { const v = parseNum(e.target.value); if (v > 0) app.setDynamics({ rho: v }); } })));
  }
  if (dyn.material === 'custom' || (MATERIALS[dyn.material] && MATERIALS[dyn.material].group.startsWith('3-D'))) {
    out.push(h('p', { class: 'note' }, 'For a 3-D printed part with less than full infill, use a custom density: about the solid density × the infill fraction, a little more for the walls. Or weigh the part and type its mass for the link.'));
  }
  // thickness and width are kept in mm, shown in the drawing's length unit
  const mmShown = (v) => +U.len(v).toPrecision(5);
  out.push(h('div', { class: 'field' }, h('label', {}, `Thickness × width (${U.label})`), h('div', { class: 'pair' },
    h('input', { type: 'number', step: 'any', min: 0, value: mmShown(dyn.thickness), 'aria-label': `Link thickness in ${U.label}`,
      onchange: (e) => { const v = parseNum(e.target.value); if (v > 0) app.setDynamics({ thickness: U.mm(v) }); } }),
    h('input', { type: 'number', step: 'any', min: 0, value: mmShown(dyn.width || (doc.cad && doc.cad.linkWidth) || 12), 'aria-label': `Link width in ${U.label}`,
      onchange: (e) => { const v = parseNum(e.target.value); if (v > 0) app.setDynamics({ width: U.mm(v) }); } }))));
  const rows = [...doc.links].filter((l) => !isFrameLink(doc, l)).sort((a, b) => nums.get(a.id) - nums.get(b.id)).map((l) => {
    const mp = massProps(doc, l);
    return h('tr', { class: 'clickable', title: 'Click to set the mass and centre of mass of this link', onclick: () => { app.select({ kind: 'link', id: l.id }); openMassDialog(app, l.id); } },
      h('td', {}, h('span', { class: 'swatch', style: { background: linkColor(nums, l.id) } }), ` ${nums.get(l.id)}`),
      h('td', {}, fmtSig(U.M.show(mp.m), 3)), h('td', {}, fmtSig(U.I.show(mp.I), 3)), h('td', {}, mp.auto ? 'shape' : h('b', {}, 'typed')));
  });
  out.push(h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Link'), h('th', {}, `m (${U.M.label})`), h('th', {}, `I_G (${U.I.label})`), h('th', {}, 'from'))),
    h('tbody', {}, rows)));
  return out;
}

/** The forces and torques added to links. */
function loadsBlock(app) {
  const doc = app.doc, nums = app.linkNumbers(), U = app.units;
  const loads = doc.loads || [];
  const out = [h('div', { class: 'subhead' }, 'Loads')];
  if (!loads.length) {
    out.push(h('p', { class: 'note' }, 'No forces or torques added. ',
      h('button', { class: 'btn small', onclick: () => app.setTool('load') }, 'Add with the Force tool (E)')));
    return out;
  }
  const profile = { constant: 'constant', table: 'table', formula: 'formula' };
  out.push(h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Load'), h('th', {}, 'size'), h('th', {}, 'varies'))),
    h('tbody', {}, loads.map((f, k) => h('tr', { class: 'clickable', title: 'Click to edit this load', onclick: () => app.ui.openLoad(f.id) },
      h('td', {}, `${f.kind === 'torque' ? 'Torque' : 'Force'} ${k + 1}`, sub(` on link ${nums.get(f.link)}`)),
      h('td', {}, f.kind === 'torque' ? `${fN(U.T.show(f.T))} ${U.T.label}` : `${fN(U.F.show(Math.hypot(f.F.x, f.F.y)))} ${U.F.label} ${angOf(f.F)}${f.follow ? ' ↻' : ''}`),
      h('td', {}, profile[(f.profile && f.profile.type) || 'constant']))))));
  out.push(h('div', { class: 'row-buttons' }, h('button', { class: 'btn small', onclick: () => app.setTool('load') }, 'Add another (E)')));
  return out;
}

/** Typical spacing of the cycle's positions, in the input's unit (for the note). */
function stepOf(s, app) {
  if (!s || s.samples.length < 2) return '';
  // how far the input travels over the cycle (a rocking input goes there and back)
  const n = s.samples.length, t0 = s.samples[0].travel, t1 = s.samples[n - 1].travel;
  const span = Number.isFinite(t0) && Number.isFinite(t1) ? Math.abs(t1 - t0) : Math.abs(s.samples[n - 1].theta - s.samples[0].theta);
  const step = span / (n - 1);
  return app.sim.inputIsAngle ? `${fmt(step / (Math.PI / 180), 1)}°` : `${fmt(app.units.len(step), 2)} ${app.units.label}`;
}

/** Input effort and the joint-force table at this position. */
function resultsBlock(app, r) {
  const sim = app.sim, doc = app.doc, U = unitsOf(doc);
  const L = forceLabels(doc, sim);
  const list = app.forceSweep() || [];
  const peak = (fn) => { let m = 0, at = null; list.forEach((x, k) => { if (!x) return; const v = Math.abs(fn(x)); if (Number.isFinite(v) && v > m) { m = v; at = k; } }); return { m, at }; };
  const s = sim.getSweep();
  const atInput = (k) => (k === null || !s ? '' : `${fmt(app.inputShown(s.samples[k].theta), 1)}${sim.inputIsAngle ? '°' : ' ' + U.label}`);
  const lab = inputLabel(app);
  const out = [];

  // what the input must supply
  if (r.input) {
    const isT = r.input.torque !== undefined;
    const Q = isT ? U.T : U.F;
    const v = Q.show(isT ? r.input.torque : r.input.force);
    const unit = Q.label;
    const pk = peak((x) => (x.input ? Q.show(isT ? x.input.torque : x.input.force) : NaN));
    out.push(h('div', { class: 'formula output-readout effort' },
      h('div', {}, `${lab.sym} = ${fmt(app.inputShown(), 2)} ${lab.unit}`),
      h('div', { class: 'big' }, `${isT ? 'T₁₂' : 'F input'} = `, h('b', {}, `${fN(v)} ${unit}`), sub(isT ? '  counter-clockwise +' : '  + pushes')),
      h('div', {}, `largest over the cycle: ${fN(pk.m)} ${unit} at ${lab.sym} = ${atInput(pk.at)}`)));
  }

  // every joint force: its name, and how to read it from a result (vector F
  // when it has a direction, else just a size)
  const forces = [];
  r.pins.forEach((p, k) => {
    const nm = L.pin(p);
    forces.push({ name: nm.name.text, note: ` ${nm.joint}`, get: (x) => { const F = x.pins[k].F; return { mag: Math.hypot(F.x, F.y), F }; } });
  });
  r.sliders.forEach((sl, k) => {
    const nm = L.slider(sl);
    forces.push({ name: nm.F.text, note: ` ${nm.name}, normal`, get: (x) => ({ mag: Math.abs(x.sliders[k].N), F: x.sliders[k].F }) });
  });
  r.prismatic.forEach((pr, k) => {
    forces.push({ name: L.F(L.linkOf(pr.j), L.linkOf(pr.i)).text, note: ' prismatic', get: (x) => ({ mag: Math.abs(x.prismatic[k].N), F: x.prismatic[k].F || null, M: x.prismatic[k].M }) });
  });
  r.contacts.forEach((c, k) => {
    forces.push({ name: L.F(L.linkOf(c.j), L.linkOf(c.i)).text, note: c.type === 'roll' ? ' rolling' : ' roll + slip', get: (x) => ({ mag: x.contacts[k].size, F: x.contacts[k].F || null }) });
  });
  r.actuators.forEach((u, k) => {
    const n = (doc.actuators || []).findIndex((v) => v.id === u.id) + 1;
    forces.push({ name: `actuator ${n}`, note: '', get: (x) => ({ mag: Math.abs(x.actuators[k].push), F: null, push: x.actuators[k].push }) });
  });

  // now, at this position
  out.push(h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Joint force'), h('th', {}, `|F| (${U.F.label})`), h('th', {}, 'angle'))),
    h('tbody', {}, forces.map((f) => {
      const v = f.get(r);
      const dir = v.F ? angOf(v.F) : v.M !== undefined ? `M ${fN(U.T.show(v.M))}` : v.push !== undefined ? (v.push >= 0 ? 'pushes' : 'pulls') : '';
      return h('tr', {}, h('td', {}, h('b', {}, f.name), sub(f.note)), h('td', {}, fN(U.F.show(v.mag))), h('td', {}, dir));
    }))));

  // the largest of each over the cycle: size, direction then, and where
  if (list.some(Boolean)) {
    const peaks = forces.map((f) => {
      let best = null;
      list.forEach((x, k) => { if (!x) return; const v = f.get(x); if (Number.isFinite(v.mag) && (!best || v.mag > best.mag)) best = { ...v, k }; });
      return best && { f, ...best };
    }).filter(Boolean);
    const top = peaks.reduce((m, p) => (!m || p.mag > m.mag ? p : m), null);
    out.push(h('div', { class: 'subhead' }, 'Largest over the cycle'));
    out.push(h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Joint force'), h('th', {}, `max |F| (${U.F.label})`), h('th', {}, 'angle'), h('th', {}, `at ${lab.sym}`))),
      h('tbody', {}, peaks.map((p) => h('tr', {
        class: `clickable${p === top ? ' peak-top' : ''}`, title: 'Click to move the mechanism to this position',
        onclick: () => { app.play(false); app.goToSample(p.k); },
      },
      h('td', {}, h('b', {}, p.f.name), sub(p.f.note)), h('td', {}, fN(U.F.show(p.mag))),
      h('td', {}, p.F ? angOf(p.F) : p.push !== undefined ? (p.push >= 0 ? 'pushes' : 'pulls') : ''),
      h('td', {}, atInput(p.k)))))));
    const masked = app.forceSweepMasked();
    if (masked) {
      out.push(h('p', { class: 'note warn-note' }, `Near the toggle positions the forces grow without limit at a constant input speed, so positions within ${sim.inputIsAngle ? `${FORCES.toggleWindowDeg}°` : `${FORCES.toggleWindowStroke * 100}% of the travel`} of one are left out of these values and of the force plots.`));
    }
    if (top) {
      out.push(h('p', { class: 'note' }, h('b', {}, `Largest joint force: ${top.f.name}${top.f.note} = ${fN(U.F.show(top.mag))} ${U.F.label}`),
        top.F ? ` at ${angOf(top.F)}` : '', `, when ${lab.sym} = ${atInput(top.k)}. Click a row to go there. `,
        `Found at the positions of the cycle (about every ${stepOf(s, app)}); the true peak may lie slightly between them.`));
    }
  }
  if (!r.unique) out.push(h('p', { class: 'note' }, h('b', {}, 'Statically indeterminate: '), 'some constraints are redundant (e.g. gears on fixed centres), so the force split between them is not unique; the smallest set is shown. The input torque is still exact.'));
  if (!r.balanced) out.push(warn('Not balanced: the input cannot hold the loads at this position.'));
  return out;
}
