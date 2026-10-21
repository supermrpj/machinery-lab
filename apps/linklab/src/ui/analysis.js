// =============================================================================
// analysis.js — the Kinematics panel (forces are in forcesPanel.js)
// -----------------------------------------------------------------------------
// Shows mobility (Gruebler), Grashof type, input motion, results at the current
// position, and — for a fourbar or slider-crank — Norton's closed-form method
// with the numbers substituted ("glass box"), checked against the solver.
// =============================================================================

import { h } from '../../../../packages/ui-kit/src/dom.js';
import { fmt, fmtSig, parseNum } from '../../../../packages/ui-kit/src/format.js';
import { wrapPi, wrap2Pi } from '../../../../packages/core-math/src/index.js';
import {
  fourbarPosition, fourbarVelocity, fourbarAcceleration, transmissionAngle, toggleAngles,
  sliderCrankPosition, sliderCrankVelocity, sliderCrankAcceleration,
} from '../kinematics/index.js';
import { linkColor } from '../drawing/render.js';
import { listInputs, listOutputs, readOutput, specKey } from '../model/outputs.js';
import { inputLabel } from './timeline.js';
import { unitsOf } from '../model/units.js';

// the drawing's length unit (lengths are stored in mm and converted for display)
let U = unitsOf(null);

const DEG = Math.PI / 180;
const deg = (r) => fmt(r / DEG, 2);
const degWrapped = (r) => fmt(wrapPi(r) / DEG, 2);
const sub = (t) => h('span', { class: 'sub' }, t);

/** UI state that should survive panel rebuilds. */
export const analysisState = { glassOpen: false };

export function buildAnalysis(app) {
  const sim = app.sim, doc = app.doc;
  U = unitsOf(doc);
  if (!sim.sys) {
    return h('p', { class: 'note' }, 'Draw a mechanism to see its analysis here.');
  }
  const parts = [];
  const g = sim.info.gruebler;

  // ---- input and output (what drives it, and what we watch) ----
  parts.push(...inputOutput(app));

  // ---- mobility ----
  parts.push(h('div', { class: 'subhead' }, 'Mobility (Gruebler / Kutzbach)'));
  parts.push(h('div', { class: 'formula' },
    `M = 3(L − 1) − 2J₁ − J₂ = 3(${g.L} − 1) − 2(${g.J1}) − ${g.J2} = `, h('b', {}, String(g.M))));
  const j1 = [`${g.pins} pin${g.pins === 1 ? '' : 's'}`, g.prismatic ? `${g.prismatic} sliding` : null, g.roll ? `${g.roll} rolling` : null].filter(Boolean).join(' + ');
  parts.push(h('div', { class: 'note' },
    `L = ${g.L} links (incl. ground${g.blocks ? ` and ${g.blocks} slider block${g.blocks > 1 ? 's' : ''}` : ''}). `
    + `J₁ = ${g.J1} full joints (${j1}). J₂ = ${g.J2} half joint${g.J2 === 1 ? '' : 's'}${g.J2 ? ' (roll + slip)' : ''}.`));
  const dof = sim.info.dof;
  const dofTag = dof === 1 ? h('span', { class: 'tag good' }, 'can be driven by one input')
    : dof === 0 ? h('span', { class: 'tag warn' }, 'structure: cannot move')
      : dof < 0 ? h('span', { class: 'tag warn' }, 'over-constrained')
        : h('span', { class: 'tag warn' }, `needs ${dof} inputs`);
  parts.push(h('div', { class: 'verdict' }, h('span', {}, `Actual DOF here: ${dof}`), dofTag));
  if (dof !== g.M) {
    parts.push(h('p', { class: 'note' }, 'The actual DOF differs from Gruebler’s count because of special geometry: for example parallel or redundant links, or pure rolling between wheels whose centres are already fixed (the contact is then redundant). Gruebler counts only links and joints, not their sizes. This is why gear teeth are usually modelled as a half joint.'));
  }
  if (!sim.assembled) parts.push(h('p', { class: 'note' }, h('b', {}, 'Cannot assemble: '), 'the link lengths do not close the loop in the drawn position.'));

  // ---- mechanism type ----
  const k = sim.info.kind;
  if (k.type === 'fourbar') parts.push(...fourbarType(k));
  if (k.type === 'slider-crank') parts.push(...sliderCrankType(k));

  // ---- results at this position ----
  if (sim.drivable) parts.push(...resultsAtPose(app));
  else if (sim.sys.driver || dof !== 1) parts.push(h('p', { class: 'note' }, app.whyNotDrivable()));

  // ---- Norton's method ----
  if (sim.drivable && (k.type === 'fourbar' || k.type === 'slider-crank')) parts.push(glassBox(app, k));
  return h('div', {}, parts);
}

// -----------------------------------------------------------------------------
// Input and output selectors, input speed, and the output read-out
function inputOutput(app) {
  const sim = app.sim, doc = app.doc, m = doc.motion;
  const parts = [h('div', { class: 'subhead' }, 'Input and output')];

  // input
  const inputs = listInputs(doc);
  const curIn = specKey({ type: doc.driver.type || 'rotary', ...pick(doc.driver) });
  const inSel = h('select', {
    'aria-label': 'Input',
    onchange: (e) => { const c = inputs.find((x) => specKey(x.spec) === e.target.value); if (c) app.setInputSpec(c.spec); },
  }, inputs.length ? null : h('option', { value: '' }, 'No possible input yet'),
  inputs.map((c) => h('option', { value: specKey(c.spec), selected: specKey(c.spec) === curIn }, c.label)));
  parts.push(h('div', { class: 'field' }, h('label', {}, 'Input'), inSel));

  // input speed and acceleration (units follow the input)
  if (sim.sys.driver) {
    const angle = sim.inputIsAngle;
    const lab = inputLabel(app);
    const sp = h('input', {
      type: 'number', step: 'any', value: angle ? m.omega : +U.len(m.omega).toPrecision(6), 'aria-label': angle ? 'Input angular velocity in rad/s' : `Input speed in ${U.vel}`,
      onchange: (e) => { const v = parseNum(e.target.value); if (v !== null) { m.omega = angle ? v : U.mm(v); app.motionChanged(); } },
    });
    const ac = h('input', {
      type: 'number', step: 'any', value: angle ? m.alpha : +U.len(m.alpha).toPrecision(6), 'aria-label': angle ? 'Input angular acceleration in rad/s²' : `Input acceleration in ${U.acc}`,
      onchange: (e) => { const v = parseNum(e.target.value); if (v !== null) { m.alpha = angle ? v : U.mm(v); app.motionChanged(); } },
    });
    const vSym = angle ? (lab.sym === 'θ₂' ? 'ω₂' : 'ω') : 'ṡ';
    const aSym = angle ? (lab.sym === 'θ₂' ? 'α₂' : 'α') : 's̈';
    parts.push(h('div', { class: 'field' }, h('label', {}, `${vSym} (${angle ? 'rad/s' : U.vel})`),
      h('div', { class: 'pair', style: { gridTemplateColumns: '1fr auto' } }, sp, h('span', { class: 'unit' }, angle ? `${fmt((m.omega * 60) / (2 * Math.PI), 1)} rpm` : ''))));
    parts.push(h('div', { class: 'field' }, h('label', {}, `${aSym} (${angle ? 'rad/s²' : U.acc})`), ac));
    if (!angle && doc.driver.type === 'linear') {
      const u = doc.actuators.find((x) => x.id === doc.driver.actuator);
      if (u) {
        const lim = (key) => h('input', {
          type: 'number', step: 'any', value: +U.len(u[key]).toPrecision(6), 'aria-label': key === 'min' ? 'Shortest length' : 'Longest length',
          onchange: (e) => { const v = parseNum(e.target.value); if (v > 0) app.edit('Set actuator stroke', (d) => { d.actuators.find((x) => x.id === u.id)[key] = U.mm(v); }); },
        });
        parts.push(h('div', { class: 'field' }, h('label', {}, `Stroke (${U.label})`), h('div', { class: 'pair' }, lim('min'), lim('max'))));
      }
    }
  }

  // output
  const outputs = listOutputs(doc);
  const out = app.output();
  const curOut = specKey(out);
  const outSel = h('select', {
    'aria-label': 'Output',
    onchange: (e) => { const c = outputs.find((x) => specKey(x.spec) === e.target.value); if (c) app.setOutput(c.spec); },
  }, outputs.map((c) => h('option', { value: specKey(c.spec), selected: specKey(c.spec) === curOut }, c.label)));
  parts.push(h('div', { class: 'field' }, h('label', {}, 'Output'), outSel));

  // read-out at this position
  if (sim.drivable && out) {
    let r = readOutput(doc, sim.results, out);
    const lab = inputLabel(app);
    if (r && sim.special && sim.special.kind === 'toggle' && app.settings.specialPositions) {
      parts.push(h('div', { class: 'formula output-readout' },
        `${lab.sym} = ${fmt(app.inputShown(), 2)} ${lab.unit}   →   output = `, h('b', {}, r.angle ? `${fmt(r.value, 3)} °` : U.fmt(r.value, U.digits + 1)), h('br'),
        'Toggle position: the input cannot drive the mechanism here. At a constant input speed the velocities and accelerations become unbounded, so they are not shown.'));
    } else if (r) {
      // lengths are shown in the drawing's unit; a ratio of two lengths has no unit change
      const L = (v) => (r.angle || v === null || v === undefined ? v : U.len(v));
      r = { ...r, value: L(r.value), vel: L(r.vel), acc: L(r.acc) };
      const unit = r.angle ? '°' : U.label;
      const vUnit = r.angle ? 'rad/s' : U.vel, aUnit = r.angle ? 'rad/s²' : U.acc;
      const ratio = m.omega ? r.vel / (sim.inputIsAngle ? m.omega : U.len(m.omega)) : null;
      const inUnit = sim.inputIsAngle ? 'rad/s' : U.vel;
      parts.push(h('div', { class: 'formula output-readout' },
        `${lab.sym} = ${fmt(app.inputShown(), 2)} ${lab.unit}   →   output = `, h('b', {}, `${fmt(r.value, 3)} ${unit}`), h('br'),
        `velocity ${fmtSig(r.vel)} ${vUnit}   acceleration ${fmtSig(r.acc)} ${aUnit}`, h('br'),
        `velocity ratio (output / input) = `, h('b', {}, fmtSig(ratio)), sub(`  ${vUnit} per ${inUnit}`)));
    }
  }

  // toggle and stationary positions over the whole motion
  parts.push(h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: !!app.settings.specialPositions, onchange: (e) => app.setSpecialPositions(e.target.checked) }),
    ' Mark toggle and stationary positions (dragging rests at them)'));
  const s = app.settings.specialPositions && sim.drivable ? sim.getSweep() : null;
  if (s && s.specials) {
    const lab = inputLabel(app);
    const list = (kind) => s.specials.filter((sp) => sp.kind === kind)
      .map((sp) => `${fmt(app.inputShown(sp.theta), 2)}${lab.unit === '°' ? '°' : ' ' + lab.unit}`);
    const tog = list('toggle'), sta = list('stationary');
    parts.push(h('div', { class: 'formula' },
      h('b', {}, 'Toggle'), sub(' (input limit)'), `: ${tog.length ? `${lab.sym} = ${tog.join(', ')}` : 'none'}`, h('br'),
      h('b', {}, 'Stationary'), sub(' (output at rest)'), `: ${sta.length ? `${lab.sym} = ${sta.join(', ')}` : 'none'}`));
  }
  return parts;
}

/** The fields of a driver spec that identify it (for matching the list). */
function pick(d) {
  const o = {};
  for (const k of ['link', 'pivot', 'ref', 'actuator', 'slider', 'pair']) if (d[k] !== undefined && d[k] !== null) o[k] = d[k];
  return o;
}

// -----------------------------------------------------------------------------
function fourbarType(k) {
  const G = k.grashof;
  const rel = G.condition === 'grashof' ? '<' : G.condition === 'special' ? '=' : '>';
  return [
    h('div', { class: 'subhead' }, 'Fourbar linkage'),
    h('div', { class: 'formula' },
      `a = ${U.num(k.a)}, b = ${U.num(k.b)}, c = ${U.num(k.c)}, d = ${U.num(k.d)} ${U.label}`, h('br'),
      `S + L = ${fmt(G.lhs, 2)} ${rel} P + Q = ${fmt(G.rhs, 2)}`),
    h('div', { class: 'verdict' }, h('span', { class: `tag ${G.condition === 'grashof' ? 'good' : G.condition === 'special' ? 'info' : 'warn'}` }, G.condition === 'grashof' ? 'Grashof' : G.condition === 'special' ? 'Special case' : 'Non-Grashof'), h('span', {}, G.type)),
  ];
}

function sliderCrankType(k) {
  const full = k.b >= k.a + Math.abs(k.c) - 1e-9;
  return [
    h('div', { class: 'subhead' }, 'Offset slider-crank'),
    h('div', { class: 'formula' }, `crank a = ${U.num(k.a, U.digits + 1)}  rod b = ${U.num(k.b, U.digits + 1)}  offset c = ${U.num(k.c, U.digits + 1)} ${U.label}`),
    h('div', { class: 'verdict' }, full ? h('span', { class: 'tag good' }, 'crank turns fully') : h('span', { class: 'tag warn' }, 'crank cannot turn fully'),
      h('span', {}, full ? `b ≥ a + |c|` : 'b < a + |c|')),
  ];
}

// -----------------------------------------------------------------------------
function resultsAtPose(app) {
  const sim = app.sim, doc = app.doc, nums = app.linkNumbers();
  const R = sim.results;
  const lab = inputLabel(app);
  const at = sim.inputIsAngle ? `${degWrapped(sim.theta)}°` : U.fmt(sim.theta);
  const parts = [h('div', { class: 'subhead' }, `At ${lab.sym} = ${at}`)];
  const rows = doc.links.map((l) => {
    const r = R.links.get(l.id);
    return h('tr', {},
      h('td', {}, h('span', { class: 'swatch', style: { background: linkColor(nums, l.id), marginRight: '6px' } }), `Link ${nums.get(l.id)}`),
      h('td', {}, degWrapped(r.theta)),
      h('td', {}, fmtSig(r.omega)),
      h('td', {}, fmtSig(r.alpha)));
  });
  parts.push(h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'θ (°)'), h('th', {}, 'ω (rad/s)'), h('th', {}, 'α (rad/s²)'))),
    h('tbody', {}, rows)));

  if (doc.sliders.length) {
    parts.push(h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Slider'), h('th', {}, `d (${U.label})`), h('th', {}, `v (${U.vel})`), h('th', {}, `a (${U.acc})`))),
      h('tbody', {}, doc.sliders.map((s, i) => {
        const r = R.sliders.get(s.id);
        return h('tr', {}, h('td', {}, `Slider ${i + 1}`), h('td', {}, U.num(r.d, U.digits + 1)), h('td', {}, fmtSig(r.v === null ? null : U.len(r.v))), h('td', {}, fmtSig(r.a === null ? null : U.len(r.a))));
      }))));
  }

  // joints of interest: the selected one, or traced points
  const sel = app.selectedJoint();
  const pts = sel ? [sel] : doc.joints.filter((j) => j.trace);
  if (pts.length) {
    parts.push(h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, sel ? 'Selected joint' : 'Traced point'), h('th', {}, `x, y (${U.label})`), h('th', {}, `|V| (${U.vel})`), h('th', {}, `|A| (${U.acc})`))),
      h('tbody', {}, pts.map((j, i) => {
        const r = R.joints.get(j.id);
        const V = r.vel ? U.len(Math.hypot(r.vel.x, r.vel.y)) : null, A = r.acc ? U.len(Math.hypot(r.acc.x, r.acc.y)) : null;
        const va = r.vel ? Math.atan2(r.vel.y, r.vel.x) : null, aa = r.acc ? Math.atan2(r.acc.y, r.acc.x) : null;
        return h('tr', {}, h('td', {}, sel ? (j.ground ? 'pivot' : 'joint') : `P${i + 1}`),
          h('td', {}, `${U.num(r.pos.x)}, ${U.num(r.pos.y)}`),
          h('td', { title: va !== null ? `direction ${deg(va)}°` : '' }, `${fmtSig(V)} ∠${va !== null ? deg(va) : '—'}°`),
          h('td', { title: aa !== null ? `direction ${deg(aa)}°` : '' }, `${fmtSig(A)} ∠${aa !== null ? deg(aa) : '—'}°`));
      }))));
  }

  // transmission angle for the fourbar
  const k = sim.info.kind;
  if (k.type === 'fourbar') {
    const P = (j) => R.joints.get(j.id).pos;
    const th3 = Math.atan2(P(k.B).y - P(k.A).y, P(k.B).x - P(k.A).x);
    const th4 = Math.atan2(P(k.B).y - P(k.O4).y, P(k.B).x - P(k.O4).x);
    const mu = transmissionAngle(th3, th4);
    const s = sim.getSweep();
    let mn = Infinity, mx = -Infinity;
    if (s) for (const smp of s.samples) {
      const pp = (j) => smp.results.joints.get(j.id).pos;
      const m = transmissionAngle(Math.atan2(pp(k.B).y - pp(k.A).y, pp(k.B).x - pp(k.A).x), Math.atan2(pp(k.B).y - pp(k.O4).y, pp(k.B).x - pp(k.O4).x));
      mn = Math.min(mn, m); mx = Math.max(mx, m);
    }
    parts.push(h('div', { class: 'subhead' }, 'Transmission angle μ'));
    parts.push(h('div', { class: 'formula' }, `μ = ${deg(mu)}°   `, sub(`over the motion: ${deg(mn)}° to ${deg(mx)}°`)));
    parts.push(h('div', { class: 'verdict' }, mn >= 40 * DEG
      ? h('span', { class: 'tag good' }, 'μ ≥ 40° throughout') : h('span', { class: 'tag warn' }, `μ drops to ${deg(mn)}°`),
    h('span', { class: 'note' }, 'A common guideline is to keep μ above about 40°.')));
  }
  if (sim.limitHit) parts.push(h('p', { class: 'note' }, h('b', {}, 'Toggle position: '), 'the input cannot move further this way. Press ▶ to carry on through it: the input turns back while the mechanism flips to its other assembly.'));
  return parts;
}

// -----------------------------------------------------------------------------
// Norton's closed-form method with live numbers
function glassBox(app, k) {
  const sim = app.sim, m = app.doc.motion;
  const omega2 = m.omega, alpha2 = m.alpha;
  const box = h('details', { class: 'glass', open: analysisState.glassOpen, ontoggle: (e) => { analysisState.glassOpen = e.target.open; } },
    h('summary', {}, 'Show the closed-form method at this position'));
  const R = sim.results;

  if (k.type === 'fourbar') {
    const th2 = wrapPi(sim.theta - k.theta1);
    const cf = fourbarPosition(k.a, k.b, k.c, k.d, th2);
    if (!cf) { box.append(h('p', { class: 'note' }, 'Cannot assemble at this angle.')); return box; }
    // which assembly matches the solver?
    const P = (j) => R.joints.get(j.id).pos;
    const th4s = Math.atan2(P(k.B).y - P(k.O4).y, P(k.B).x - P(k.O4).x) - k.theta1;
    const asm = Math.abs(wrapPi(cf.open.theta4 - th4s)) < Math.abs(wrapPi(cf.crossed.theta4 - th4s)) ? 'open' : 'crossed';
    const s = cf[asm];
    const v = fourbarVelocity(k.a, k.b, k.c, th2, s.theta3, s.theta4, omega2);
    const a = fourbarAcceleration(k.a, k.b, k.c, th2, s.theta3, s.theta4, omega2, v.omega3, v.omega4, alpha2);
    const L3 = R.links.get(k.links.coupler), L4 = R.links.get(k.links.output);
    // solver angles of Norton's vectors (A→B, O4→B) in the local frame
    const th3s = Math.atan2(P(k.B).y - P(k.A).y, P(k.B).x - P(k.A).x) - k.theta1;
    const ok = Math.abs(wrapPi(s.theta3 - th3s)) < 1e-6 && Math.abs(wrapPi(s.theta4 - th4s)) < 1e-6
      && Math.abs(v.omega3 - L3.omega) < 1e-6 * (1 + Math.abs(v.omega3)) && Math.abs(v.omega4 - L4.omega) < 1e-6 * (1 + Math.abs(v.omega4));
    const K = cf.K;
    box.append(
      h('p', { class: 'note' }, `Local frame: x along the ground link O₂O₄ (θ₁ = ${deg(k.theta1)}°). θ₂ = ${deg(th2)}°, ${asm} circuit.`),
      h('div', { class: 'formula' },
        h('b', {}, 'Position (vector-loop method)'), h('br'),
        `K₁ = d/a = ${fmt(K.K1, 4)}   K₂ = d/c = ${fmt(K.K2, 4)}`, h('br'),
        `K₃ = (a² − b² + c² + d²)/2ac = ${fmt(K.K3, 4)}`, h('br'),
        `A = ${fmt(cf.A, 4)}   B = ${fmt(cf.B, 4)}   C = ${fmt(cf.C, 4)}`, h('br'),
        `θ₄ = 2 atan[(−B ${asm === 'open' ? '−' : '+'} √(B² − 4AC)) / 2A] = `, h('b', {}, `${deg(wrap2Pi(s.theta4))}°`), h('br'),
        `K₄ = d/b = ${fmt(K.K4, 4)}   K₅ = (c² − d² − a² − b²)/2ab = ${fmt(K.K5, 4)}`, h('br'),
        `D = ${fmt(cf.D, 4)}   E = ${fmt(cf.E, 4)}   F = ${fmt(cf.F, 4)}`, h('br'),
        `θ₃ = 2 atan[(−E ${asm === 'open' ? '−' : '+'} √(E² − 4DF)) / 2D] = `, h('b', {}, `${deg(wrap2Pi(s.theta3))}°`)),
      h('div', { class: 'formula' },
        h('b', {}, 'Velocity'), h('br'),
        `ω₃ = (aω₂/b)·sin(θ₄ − θ₂)/sin(θ₃ − θ₄) = `, h('b', {}, fmtSig(v.omega3)), ' rad/s', h('br'),
        `ω₄ = (aω₂/c)·sin(θ₂ − θ₃)/sin(θ₄ − θ₃) = `, h('b', {}, fmtSig(v.omega4)), ' rad/s'),
      h('div', { class: 'formula' },
        h('b', {}, 'Acceleration'), h('br'),
        `α₃ = (CD − AF)/(AE − BD) = `, h('b', {}, fmtSig(a.alpha3)), ' rad/s²', h('br'),
        `α₄ = (CE − BF)/(AE − BD) = `, h('b', {}, fmtSig(a.alpha4)), ' rad/s²'),
      h('div', { class: 'verdict' }, ok ? h('span', { class: 'tag good' }, 'matches the solver') : h('span', { class: 'tag warn' }, 'does not match'),
        h('span', { class: 'note' }, 'Closed-form result compared with LinkLab’s general solver.')),
    );
    const tg = toggleAngles(k.a, k.b, k.c, k.d);
    if (!k.grashof.inputFullTurn && tg.length) {
      box.append(h('p', { class: 'note' }, `Toggle positions of the input (local): ${tg.map((t) => deg(t) + '°').join(', ')}`));
    }
  } else {
    const th2 = wrapPi(sim.theta - k.theta1);
    const cf = sliderCrankPosition(k.a, k.b, k.c, th2);
    if (!cf) { box.append(h('p', { class: 'note' }, 'Cannot assemble at this angle.')); return box; }
    const P = (j) => R.joints.get(j.id).pos;
    const th3s = Math.atan2(P(k.A).y - P(k.B).y, P(k.A).x - P(k.B).x) - k.theta1; // Norton: B → A
    const asm = Math.abs(wrapPi(cf.open.theta3 - th3s)) < Math.abs(wrapPi(cf.crossed.theta3 - th3s)) ? 'open' : 'crossed';
    const s = cf[asm];
    const v = sliderCrankVelocity(k.a, k.b, th2, s.theta3, omega2);
    const acc = sliderCrankAcceleration(k.a, k.b, th2, s.theta3, omega2, v.omega3, alpha2);
    const sl = R.sliders.get(app.doc.sliders[0].id);
    const ok = Math.abs(wrapPi(s.theta3 - th3s)) < 1e-6 && Math.abs(v.omega3 - R.links.get(k.links.coupler).omega) < 1e-6 * (1 + Math.abs(v.omega3));
    box.append(
      h('p', { class: 'note' }, `Local frame: x along the slider axis (θ₁ = ${deg(k.theta1)}°). θ₂ = ${deg(th2)}°, ${asm} circuit. Link 3 angle measured from B to A.`),
      h('div', { class: 'formula' },
        h('b', {}, 'Position (vector-loop method)'), h('br'),
        `θ₃ = ${asm === 'open' ? 'asin[(a sinθ₂ − c)/b]' : 'asin[−(a sinθ₂ − c)/b] + π'} = `, h('b', {}, `${deg(wrap2Pi(s.theta3))}°`), h('br'),
        `d = a cosθ₂ − b cosθ₃ = `, h('b', {}, U.num(s.d, U.digits + 1)), ` ${U.label}`),
      h('div', { class: 'formula' },
        h('b', {}, 'Velocity'), h('br'),
        `ω₃ = aω₂ cosθ₂ / (b cosθ₃) = `, h('b', {}, fmtSig(v.omega3)), ' rad/s', h('br'),
        `ḋ = −aω₂ sinθ₂ + bω₃ sinθ₃ = `, h('b', {}, fmtSig(U.len(v.vd))), ` ${U.vel}`),
      h('div', { class: 'formula' },
        h('b', {}, 'Acceleration'), h('br'),
        `α₃ = `, h('b', {}, fmtSig(acc.alpha3)), ' rad/s²', h('br'),
        `d̈ = `, h('b', {}, fmtSig(U.len(acc.ad))), ` ${U.acc}`),
      h('div', { class: 'verdict' }, ok ? h('span', { class: 'tag good' }, 'matches the solver') : h('span', { class: 'tag warn' }, 'does not match'),
        h('span', { class: 'note' }, `Solver: slider position along its rail ${U.fmt(sl.d, U.digits + 1)} (measured from the rail's start).`)),
    );
  }
  return box;
}
