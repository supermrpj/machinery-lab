// =============================================================================
// plots.js — the plot drawer: three charts against the input
// -----------------------------------------------------------------------------
// The x-axis is the input: an angle (°) for a motor, a length (mm) for a
// linear input. One quantity per chart (one y-axis each). The cursor follows
// the mechanism; clicking or dragging on a chart moves the mechanism there.
// Each chart zooms with the wheel and opens large with its ⤢ button
// (plotting/linePlot.js). Drag the drawer's top edge to make it taller.
// =============================================================================

import { h, replaceChildren } from '../../../../packages/ui-kit/src/dom.js';
import { LinePlot } from '../../../../packages/plotting/src/linePlot.js';
import { downloadFile, safeStorage } from '../../../../packages/ui-kit/src/files.js';
import { transmissionAngle } from '../kinematics/index.js';
import { linkColor, traceColor } from '../drawing/render.js';
import { LINK_COLORS, THEME } from '../config.js';
import { readOutput } from '../model/outputs.js';
import { inputLabel } from './timeline.js';
import { forceLabels } from '../model/forces.js';
import { studyFor, chosenTarget, targetOn } from '../model/tolerance.js';
import { TOLERANCE } from '../config.js';

const DEG = 180 / Math.PI;

// CONFIG: plot drawer height (drag its top edge; remembered on this computer)
const DRAWER = { key: 'linklab.plotsHeight', min: 160, keepForDrawing: 220 };

// CONFIG: the 'without counterweights' curve in the Balancing plots
const WITHOUT_COLOR = '#8A919C';

// CONFIG: energy curves (Energy plot)
const ENERGY_COLORS = { ke: '#7A3E9D', pe: '#1E9E6A', total: '#1D2433' };

// CONFIG: presets — three quantities for one topic (Advanced ones are hidden in Basic)
const PRESETS = [
  { id: 'motion', name: 'Output motion', plots: ['out', 'outv', 'outa'] },
  { id: 'links', name: 'Link motion', plots: ['theta', 'omega', 'alpha'] },
  { id: 'transmission', name: 'Transmission', plots: ['out', 'ratio', 'mu'] },
  { id: 'point', name: 'Point path', plots: ['px', 'py', 'vel'] },
  { id: 'forces', name: 'Forces', plots: ['tin', 'fj', 'fsh'], advanced: true },
  { id: 'balancing', name: 'Balancing', plots: ['fsh', 'msh', 'tin'], advanced: true },
  { id: 'energy', name: 'Energy', plots: ['etot', 'tin', 'omega'], advanced: true },
  { id: 'bearings', name: 'Bearing loads', plots: ['fj', 'fpol', 'fang'], advanced: true },
  { id: 'tolerance', name: 'Tolerance', plots: ['tol', 'fj', 'fang'], advanced: true },
];

/** Quantities that can be plotted. `series(app, sweep)` returns [{name,color,values}]. */
const QUANTITIES = [
  { id: 'out', label: 'Output', series: outputSeries('value') },
  { id: 'outv', label: 'Output velocity', series: outputSeries('vel') },
  { id: 'outa', label: 'Output acceleration', series: outputSeries('acc') },
  { id: 'ratio', label: 'Velocity ratio (output / input)', series: outputSeries('ratio') },
  { id: 'theta', label: 'Link angles θ (°)', series: linkSeries((r) => r.theta * DEG, true) },
  { id: 'omega', label: 'Angular velocity ω (rad/s)', series: linkSeries((r) => r.omega) },
  { id: 'alpha', label: 'Angular acceleration α (rad/s²)', series: linkSeries((r) => r.alpha) },
  { id: 'vel', label: 'Point velocity |V| (mm/s)', series: pointSeries((r) => (r.vel ? Math.hypot(r.vel.x, r.vel.y) : NaN)) },
  { id: 'acc', label: 'Point acceleration |A| (mm/s²)', series: pointSeries((r) => (r.acc ? Math.hypot(r.acc.x, r.acc.y) : NaN)) },
  { id: 'px', label: 'Point position x (mm)', series: pointSeries((r) => r.pos.x) },
  { id: 'py', label: 'Point position y (mm)', series: pointSeries((r) => r.pos.y) },
  { id: 'sd', label: 'Slider position d (mm)', series: sliderSeries((r) => r.d) },
  { id: 'sv', label: 'Slider velocity (mm/s)', series: sliderSeries((r) => r.v) },
  { id: 'sa', label: 'Slider acceleration (mm/s²)', series: sliderSeries((r) => r.a) },
  { id: 'mu', label: 'Transmission angle μ (°)', series: muSeries },
  { id: 'tin', label: 'Input torque (N·m) or force (N)', force: true, series: forceSeries('input') },
  { id: 'fj', label: 'Joint forces |F| (N)', force: true, series: forceSeries('pins') },
  { id: 'fpol', label: 'Joint forces, polar diagram (N)', force: true, polar: true, directions: true, series: jointVectors },
  { id: 'fang', label: 'Joint force direction ∠F (°)', force: true, directions: true, series: jointAngles },
  { id: 'fsh', label: 'Shaking force |F| (N)', force: true, series: forceSeries('shake') },
  { id: 'msh', label: 'Shaking moment (N·m)', force: true, series: forceSeries('moment') },
  { id: 'ke', label: 'Kinetic energy (J)', force: true, series: forceSeries('ke') },
  { id: 'pe', label: 'Potential energy, gravity (J)', force: true, series: forceSeries('pe') },
  { id: 'etot', label: 'Energy: kinetic, potential, total (J)', force: true, series: forceSeries('energy') },
  { id: 'tol', label: 'Error from pin clearance (mm)', labelFor: toleranceLabel, advanced: true, series: toleranceSeries, knocks: true },
];

/** Dash patterns that tell lines apart when they lie on top of each other. */
const DASHES = [[], [8, 4], [2, 3], [10, 3, 2, 3], [4, 4], [14, 4]];

/** Force results over the cycle (needs the Forces panel on). */
function forceSeries(what) {
  return (app, s) => {
    if (!app.forceSweep()) return [];
    const at = (smp) => app.forceOf(smp);
    const one = (name, color, fn) => [{ name, color, values: s.samples.map((smp) => { const r = at(smp); const v = r ? fn(r) : NaN; return Number.isFinite(v) ? v : NaN; }) }];
    const U = app.units; // forces, torques and energy in the chosen units
    // with counterweights in use, the same quantity without them (dashed, grey) to compare
    const wo = app.forceSweepWithout();
    const both = (name, color, fn) => {
      const main = one(wo ? `${name} with counterweights` : name, color, fn);
      if (!wo) return main;
      return [...main, { name: `${name} without`, color: WITHOUT_COLOR, dash: [6, 4],
        values: s.samples.map((smp) => { const r = wo.get(smp); const v = r ? fn(r) : NaN; return Number.isFinite(v) ? v : NaN; }) }];
    };
    const inputOf = (r) => (r.input ? (r.input.torque !== undefined ? U.T.show(r.input.torque) : U.F.show(r.input.force)) : NaN);
    if (what === 'input') return both(app.sim.inputIsAngle ? 'Torque' : 'Force', THEME.input, inputOf);
    if (what === 'shake') return both('|Fs|', THEME.output, (r) => U.F.show(Math.hypot(r.shaking.F.x, r.shaking.F.y)));
    if (what === 'moment') return both('Ms', THEME.output, (r) => U.T.show(r.shaking.M));
    if (what === 'ke') return one('KE', THEME.output, (r) => U.E.show(r.energy.KE));
    // potential energy is measured from its lowest point over the cycle (only its changes matter)
    const pe = s.samples.map((smp) => { const r = at(smp); return r ? r.energy.PE : NaN; });
    const peMin = Math.min(...pe.filter(Number.isFinite));
    const peOf = (k) => (Number.isFinite(pe[k]) ? pe[k] - peMin : NaN);
    if (what === 'pe') return [{ name: 'PE', color: ENERGY_COLORS.pe, values: s.samples.map((_, k) => U.E.show(peOf(k))) }];
    if (what === 'energy') {
      const ke = (k) => { const r = at(s.samples[k]); return r ? r.energy.KE : NaN; };
      return [
        { name: 'KE', color: ENERGY_COLORS.ke, values: s.samples.map((_, k) => U.E.show(ke(k))) },
        { name: 'PE', color: ENERGY_COLORS.pe, dash: [6, 4], values: s.samples.map((_, k) => U.E.show(peOf(k))) },
        { name: 'Total', color: ENERGY_COLORS.total, values: s.samples.map((_, k) => U.E.show(ke(k) + peOf(k))) },
      ];
    }
    // joint forces: on the selected link, or at the selected joint, else every pin
    // (each can be ticked off under the plot's menu)
    const first = s.samples.map(at).find(Boolean);
    if (!first) return [];
    const selJ = app.selectedJoint();
    const selL = app.selection && app.selection.kind === 'link' && app.sim.sys.bodyIndex.has(app.selection.id) ? app.sim.sys.bodyIndex.get(app.selection.id) : null;
    const L = forceLabels(app.doc, app.sim);
    const idx = first.pins.map((p, k) => k)
      .filter((k) => (selL !== null ? first.pins[k].i === selL || first.pins[k].j === selL : !selJ || first.pins[k].joint === selJ.id));
    return idx.map((k, n) => {
      const p = first.pins[k], nm = L.pin(p);
      // named as the force ON the selected link when a link is selected
      const name = selL !== null && p.j === selL ? L.F(nm.on, nm.from).text : nm.name.text;
      return { name: `${name} (${nm.joint})`, color: LINK_COLORS[(n + 1) % LINK_COLORS.length], dash: DASHES[n % DASHES.length],
        values: s.samples.map((smp) => { const r = at(smp); return r ? U.F.show(Math.hypot(r.pins[k].F.x, r.pins[k].F.y)) : NaN; }) };
    });
  };
}

/**
 * The joint forces as vectors over the cycle, for the polar diagram and the
 * direction plot: the same pins and names as 'Joint forces |F|' (on the
 * selected link, or at the selected joint, else every pin). opts.frame says
 * how directions are measured: 'frame' (fixed, 0° along +x), or a link id
 * (turning with that link, 0° along its line of centres): then the diagram
 * shows where on that link's hole the load sits.
 * Returns [{ name, color, dash, fx: [], fy: [] }] (shown force units).
 */
function jointForceVectors(app, s, opts = {}) {
  if (!app.forceSweep()) return [];
  const at = (smp) => app.forceOf(smp);
  const first = s.samples.map(at).find(Boolean);
  if (!first) return [];
  const U = app.units;
  const selJ = app.selectedJoint();
  const selL = app.selection && app.selection.kind === 'link' && app.sim.sys.bodyIndex.has(app.selection.id) ? app.sim.sys.bodyIndex.get(app.selection.id) : null;
  const L = forceLabels(app.doc, app.sim);
  const frame = opts.frame && opts.frame !== 'frame' && app.doc.links.some((l) => l.id === opts.frame) ? opts.frame : null;
  const turn = (smp, F) => {
    if (!frame) return F;
    const r = smp.results.links.get(frame);
    if (!r) return { x: NaN, y: NaN };
    const c = Math.cos(-r.theta), sn = Math.sin(-r.theta);
    return { x: c * F.x - sn * F.y, y: sn * F.x + c * F.y };
  };
  const idx = first.pins.map((p, k) => k)
    .filter((k) => (selL !== null ? first.pins[k].i === selL || first.pins[k].j === selL : !selJ || first.pins[k].joint === selJ.id));
  return idx.map((k, n) => {
    const p = first.pins[k], nm = L.pin(p);
    // named (and signed) as the force ON the selected link when a link is selected
    const onJ = selL !== null && p.j === selL;
    const name = onJ ? L.F(nm.on, nm.from).text : nm.name.text;
    const sgn = onJ ? -1 : 1;
    const fx = [], fy = [];
    for (const smp of s.samples) {
      const r = at(smp);
      if (!r) { fx.push(NaN); fy.push(NaN); continue; }
      const F = turn(smp, { x: sgn * r.pins[k].F.x, y: sgn * r.pins[k].F.y });
      fx.push(U.F.show(F.x)); fy.push(U.F.show(F.y));
    }
    return { name: `${name} (${nm.joint})`, color: LINK_COLORS[(n + 1) % LINK_COLORS.length], dash: DASHES[n % DASHES.length], fx, fy };
  });
}

/** Polar diagram: each joint force's vector over the cycle (px, py). */
function jointVectors(app, s, opts) {
  return jointForceVectors(app, s, opts).map((v) => ({ name: v.name, color: v.color, dash: v.dash, px: v.fx, py: v.fy, values: v.fx.map((x, i) => Math.hypot(x, v.fy[i])) }));
}

/** Direction of each joint force (°), continuous over the cycle (no jumps at ±180°). */
function jointAngles(app, s, opts) {
  return jointForceVectors(app, s, opts).map((v) => {
    let prev = null;
    const values = v.fx.map((x, i) => {
      const y = v.fy[i];
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) === 0) return NaN;
      let a = (Math.atan2(y, x) * 180) / Math.PI;
      if (prev === null) a = (a + 360) % 360;
      else { while (a - prev > 180) a -= 360; while (a - prev < -180) a += 360; }
      prev = a;
      return a;
    });
    return { name: v.name, color: v.color, dash: v.dash, values };
  });
}

/**
 * Tolerance: how far the checked output (or point) can be off because of the
 * pin clearance (Tolerance panel): the play either way (worst case, dashed)
 * and, with forces on, where the load actually puts it.
 */
function toleranceSeries(app, s) {
  const st = studyFor(app);
  if (!st || st.samples !== s.samples) return [];
  const U = app.units;
  const grey = '#8A919C', load = '#E8622C';
  if (st.kind === 'point') {
    const out = [{ name: 'Play (any direction)', color: grey, dash: [6, 4], values: st.play.map((v) => U.len(v)) }];
    if (st.loaded) out.push({ name: 'Under the load', color: load, values: st.loaded.map((p) => (p ? U.len(Math.hypot(p.x, p.y)) : NaN)) });
    return out;
  }
  const show = st.kind === 'angle' ? (v) => (v * 180) / Math.PI : (v) => U.len(v);
  const out = [
    { name: 'Play +', color: grey, dash: [6, 4], values: st.play.map((v) => show(v)) },
    { name: 'Play −', color: grey, dash: [6, 4], values: st.play.map((v) => -show(v)) },
  ];
  if (st.loaded) out.push({ name: 'Under the load', color: load, values: st.loaded.map((v) => show(v)) });
  return out;
}

/** The tolerance quantity's name: it says what is checked, in its unit. */
function toleranceLabel(app) {
  const tg = app.sim.sys ? targetOn(app.sim.sys, app.doc, chosenTarget(app)) : null;
  if (!tg) return 'Error from pin clearance (mm)';
  if (tg.kind === 'angle') return `Link ${app.linkNumbers().get(tg.link)} angle error, pin clearance (°)`;
  const jn = `J${app.doc.joints.findIndex((j) => j.id === tg.id) + 1}`;
  if (tg.kind === 'along') return 'Output error, pin clearance (mm)';
  return `${jn} error, pin clearance (mm)`;
}

/** Knocks (Tolerance) as sample indices of the sweep. */
function knockSamples(app) {
  const st = studyFor(app);
  return st ? st.knocks.map((kn) => kn.k) : [];
}

/**
 * Labels along a polar diagram: the input every 30° (or the Display's angle
 * step) for an angle; otherwise 6 points spread over the cycle.
 */
function polarMarks(xs, angle, step) {
  if (xs.length < 2) return [];
  if (!angle) {
    return [0, 1, 2, 3, 4, 5].map((n) => Math.round((n * (xs.length - 1)) / 6)).map((i) => ({ index: i, text: String(+(+xs[i]).toPrecision(3)) }));
  }
  const st = step > 0 ? step : 30, lo = Math.min(...xs), hi = Math.max(...xs), out = [];
  for (let a = Math.ceil(lo / st) * st; a < hi - 1e-9 || (a <= hi && a === lo); a += st) {
    let bi = 0, bd = Infinity;
    xs.forEach((x, i) => { const d = Math.abs(x - a); if (d < bd) { bd = d; bi = i; } });
    if (bd <= st / 4) out.push({ index: bi, text: `${((a % 360) + 360) % 360}°` });
  }
  return out;
}

/** Links other than a ground-motor input (whose angle is the x-axis). */
function plottedLinks(app) {
  const d = app.doc.driver;
  const skip = (d.type || 'rotary') === 'rotary' && !d.ref ? d.link : null;
  return app.doc.links.filter((l) => l.id !== skip);
}

/** The chosen output over the cycle (value, velocity, acceleration or ratio). */
function outputSeries(field) {
  return (app, s) => {
    const o = app.output();
    if (!o) return [];
    const w = app.doc.motion.omega;
    let prev = null;
    const values = s.samples.map((smp) => {
      const r = readOutput(app.doc, smp.results, o);
      if (!r) return NaN;
      const U = app.units;
      // lengths in the drawing's unit; a ratio keeps its meaning (output per input)
      if (field === 'ratio') return w ? (r.angle ? r.vel : U.len(r.vel)) / (app.sim.inputIsAngle ? w : U.len(w)) : NaN;
      let v = r[field];
      if (!r.angle && Number.isFinite(v)) v = U.len(v);
      if (field === 'value' && r.angle && prev !== null && Number.isFinite(v)) { while (v - prev > 180) v -= 360; while (v - prev < -180) v += 360; }
      if (field === 'value') prev = v;
      return v ?? NaN;
    });
    return [{ name: 'output', color: THEME.output, values }];
  };
}

function linkSeries(get, unwrap = false) {
  return (app, s) => {
    const nums = app.linkNumbers();
    return plottedLinks(app).map((l) => {
      let prev = null;
      const values = s.samples.map((smp) => {
        let v = get(smp.results.links.get(l.id));
        if (unwrap && prev !== null) { while (v - prev > 180) v -= 360; while (v - prev < -180) v += 360; }
        prev = v;
        return v;
      });
      return { name: `Link ${nums.get(l.id)}`, color: linkColor(nums, l.id), values };
    });
  };
}

/** Points to plot: selected joint, else traced points, else moving joints. */
function plottedPoints(app) {
  const sel = app.selectedJoint();
  if (sel) return [sel];
  const traced = app.doc.joints.filter((j) => j.trace);
  if (traced.length) return traced;
  return app.doc.joints.filter((j) => !j.ground).slice(0, 4);
}

function pointSeries(get) {
  return (app, s) => plottedPoints(app).map((j, i) => ({
    name: j.trace ? `P${app.doc.joints.filter((x) => x.trace).indexOf(j) + 1}` : `Joint ${app.doc.joints.indexOf(j) + 1}`,
    color: j.trace ? traceColor(app.doc, j) : LINK_COLORS[(i + 3) % LINK_COLORS.length], // a traced point matches its curve
    values: s.samples.map((smp) => app.units.len(get(smp.results.joints.get(j.id)))),
  }));
}

function sliderSeries(get) {
  return (app, s) => app.doc.sliders.map((sl, i) => ({
    name: `Slider ${i + 1}`, color: LINK_COLORS[(i + 2) % LINK_COLORS.length],
    values: s.samples.map((smp) => { const v = get(smp.results.sliders.get(sl.id)); return v === null || v === undefined ? NaN : app.units.len(v); }),
  }));
}

function muSeries(app, s) {
  const k = app.sim.info && app.sim.info.kind;
  if (!k || k.type !== 'fourbar') return [];
  return [{
    name: 'μ', color: LINK_COLORS[0],
    values: s.samples.map((smp) => {
      const P = (j) => smp.results.joints.get(j.id).pos;
      return transmissionAngle(Math.atan2(P(k.B).y - P(k.A).y, P(k.B).x - P(k.A).x), Math.atan2(P(k.B).y - P(k.O4).y, P(k.B).x - P(k.O4).x)) * DEG;
    }),
  }];
}

/** The strip along the drawer's top edge: drag to change its height, double-click for the default. */
function resizeHandle(el, app) {
  const clamp = (px) => Math.round(Math.max(DRAWER.min, Math.min(window.innerHeight - DRAWER.keepForDrawing, px)));
  const setH = (px) => { if (px) el.style.setProperty('--plots-h', `${clamp(px)}px`); else el.style.removeProperty('--plots-h'); };
  setH(+safeStorage.get(DRAWER.key) || 0);
  const grip = h('div', { class: 'plots-resize', title: 'Drag to make the plots taller or shorter (double-click: default)', role: 'separator', 'aria-orientation': 'horizontal' });
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    const startY = e.clientY, startH = el.getBoundingClientRect().height;
    const move = (ev) => { setH(startH - (ev.clientY - startY)); app.requestRender(); };
    const up = () => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up);
      safeStorage.set(DRAWER.key, String(Math.round(el.getBoundingClientRect().height)));
      app.requestRender();
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', () => { setH(0); safeStorage.remove(DRAWER.key); app.requestRender(); });
  return grip;
}

export function buildPlots(el, app) {
  const DEFAULT_CHOICE = ['out', 'outv', 'outa'];
  const choice = [...DEFAULT_CHOICE];
  const plots = [];
  const title = h('span', { class: 'title' }, 'Plots against the input');
  // what runs along the x-axis
  let xMode = 'zero', anchor = 0;
  const restart = () => { anchor = Math.max(0, app.sim.nearestSampleIndex()); update(true); };
  const hereBtn = h('button', { class: 'btn', hidden: true, title: 'Start the plots at the position the mechanism is in now', onclick: restart }, 'Start here');
  const xSel = h('select', { 'aria-label': 'Plot x-axis', onchange: (e) => {
    xMode = e.target.value;
    hereBtn.hidden = xMode !== 'here';
    restart();
  } },
  h('option', { value: 'zero' }, 'Input from 0'),
  h('option', { value: 'here' }, 'Input from here'),
  h('option', { value: 'time' }, 'Time over one cycle'));
  // presets: three plots for one topic at once
  const presetSel = h('select', { 'aria-label': 'Plot preset', title: 'Three plots for one topic', onchange: (e) => {
    const p = PRESETS.find((x) => x.id === e.target.value);
    if (!p) return;
    p.plots.forEach((id, i) => { choice[i] = id; selects[i].value = id; });
    update(true);
  } },
  h('option', { value: '' }, 'Preset: custom'),
  PRESETS.map((p) => h('option', { value: p.id }, `Preset: ${p.name}`)));
  const head = h('div', { class: 'plots-head' },
    title, xSel, hereBtn, presetSel,
    h('span', { class: 'note' }, 'Click or drag on a plot to move the mechanism there.'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn', onclick: () => exportCSV(app) }, 'Export data (CSV)'),
    h('button', { class: 'btn', onclick: () => app.ui.togglePlots(false), 'aria-label': 'Close plots' }, 'Close'));
  const body = h('div', { class: 'plots-body' });
  replaceChildren(el, head, body, resizeHandle(el, app));

  const selects = [], chips = [], frameSels = [];
  const frames = ['frame', 'frame', 'frame']; // per plot: 'frame' or a link id (see jointForceVectors)
  // lines switched off in each plot (by quantity and line name)
  const hidden = [new Set(), new Set(), new Set()];
  for (let i = 0; i < 3; i++) {
    const sel = h('select', { 'aria-label': `Plot ${i + 1} quantity`, onchange: (e) => { choice[i] = e.target.value; update(true); } },
      QUANTITIES.map((q) => h('option', { value: q.id, selected: q.id === choice[i] }, q.label)));
    selects.push(sel);
    const area = h('div', { class: 'plot-canvas' });
    const pick = h('div', { class: 'plot-pick', hidden: true });
    chips.push(pick);
    // how directions are measured (joint force direction and polar diagram)
    const frameSel = h('select', { class: 'plot-frame', hidden: true, 'aria-label': `Plot ${i + 1}: directions measured`, onchange: (e) => { frames[i] = e.target.value; update(true); } });
    frameSels.push(frameSel);
    body.append(h('div', { class: 'plot-cell' }, sel, frameSel, pick, area));
    plots.push(new LinePlot(area, {
      onScrub: (x) => { app.play(false); app.setInput(x); },
      // clicking picks the nearest point of the curve (unambiguous when a
      // rocking input plots as a loop: each input value is reached twice)
      onPick: (k) => { app.play(false); if (order[k] !== undefined) app.goToSample(order[k]); },
      formatY: compact,
      textScale: () => app.display.text, // Sheet › Display › Text size
      angleStep: () => app.display.angleStep, // Sheet › Display › Angle axis ticks (0 = automatic)
      title: () => `${sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : ''} — ${title.textContent.replace('Plots against', 'against')}`,
    }));
  }

  let lastSweep = null, lastVersion = -1, lastSel = null, lastSpecial = null, lastExtra = '';
  let xs = [], order = [], where = new Map();
  // a quantity's name in the drawing's unit (some say what they show, e.g. the tolerance target)
  const qLabel = (q) => (q.labelFor ? unitLabel(q.labelFor(app), app.units) : unitLabel(q.label, app.units));
  function update(force = false) {
    if (el.hidden) return;
    const s = app.sim.getSweep();
    const selKey = app.selection ? app.selection.id : null;
    const showSpecial = !!app.settings.specialPositions;
    // other things the plots follow: the mode, and the Tolerance panel's settings
    const t = app.tolerance;
    const extra = `${app.mode}|${t ? `${t.clearance}|${JSON.stringify(t.pins || {})}|${t.holePosition}|${t.target}|${t.point}` : ''}`;
    if (force || s !== lastSweep || app.version !== lastVersion || selKey !== lastSel || showSpecial !== lastSpecial || extra !== lastExtra) {
      lastSweep = s; lastVersion = app.version; lastSel = selKey; lastSpecial = showSpecial; lastExtra = extra;
      const lab = inputLabel(app);
      xSel.options[0].textContent = s && s.fullTurn ? 'Input from 0°' : 'Input from its start';
      title.textContent = xMode === 'time' ? 'Plots against time t (s)' : `Plots against the ${lab.name} ${lab.sym} (${lab.unit})`;
      if (lastVersion !== app.version && xMode === 'here') anchor = Math.max(0, app.sim.nearestSampleIndex());
      // Basic mode: no force or tolerance quantities (they belong to Advanced)
      const basic = app.mode === 'basic';
      const advancedOnly = (id) => { const q = QUANTITIES.find((x) => x.id === id); return !!(q.force || q.advanced); };
      selects.forEach((sel, i) => {
        for (const op of sel.options) op.hidden = basic && advancedOnly(op.value);
        if (basic && advancedOnly(choice[i])) { choice[i] = DEFAULT_CHOICE[i]; sel.value = choice[i]; }
      });
      for (const op of presetSel.options) { const p = PRESETS.find((x) => x.id === op.value); op.hidden = basic && !!(p && p.advanced); }
      const match = PRESETS.find((p) => p.plots.every((id, i) => id === choice[i]) && !(basic && p.advanced));
      presetSel.value = match ? match.id : '';
      if (!s) {
        xs = [];
        for (const p of plots) p.setData({ empty: app.sim.sys ? app.whyNotDrivable() : 'Draw a mechanism to see plots.', series: [] });
      } else {
        const ordered = orderForPlot(s, app.sim.inputIsAngle, app.units.f, xMode, anchor, app.doc.motion.omega);
        // quantity names carry the drawing's unit
        selects.forEach((sel) => [...sel.options].forEach((op) => { const q = QUANTITIES.find((x) => x.id === op.value); op.textContent = qLabel(q); }));
        xs = ordered.xs; order = ordered.order;
        // the closing point repeats the first sample: the cursor stays at the start
        where = new Map();
        order.forEach((k, i) => { if (!where.has(k)) where.set(k, i); });
        const lab = inputLabel(app);
        // T = toggle position (input limit), S = stationary position (output limit)
        const markers = showSpecial && s.specials
          ? s.specials.filter((sp) => sp.kind !== 'end' && where.has(sp.index)).map((sp) => ({ index: where.get(sp.index), label: sp.kind === 'toggle' ? 'T' : 'S' }))
          : [];
        // clicks pick by x unless the curve doubles back (a rocking input's loop)
        const pickByX = xs.every((x, i) => i === 0 || x >= xs[i - 1]);
        const nums = app.linkNumbers();
        // knocks (Tolerance) marked K on the plots that show them
        const knockMarks = choice.some((id) => (QUANTITIES.find((x) => x.id === id) || {}).knocks)
          ? knockSamples(app).filter((k) => where.has(k)).map((k) => ({ index: where.get(k), label: 'K' })) : [];
        plots.forEach((p, i) => {
          const q = QUANTITIES.find((qq) => qq.id === choice[i]);
          // directions: fixed to the frame or turning with a link
          const fs = frameSels[i];
          fs.hidden = !q.directions;
          if (q.directions) {
            if (frames[i] !== 'frame' && !app.doc.links.some((l) => l.id === frames[i])) frames[i] = 'frame';
            fs.replaceChildren(h('option', { value: 'frame', selected: frames[i] === 'frame' }, 'Directions fixed to the frame'),
              ...app.doc.links.map((l) => h('option', { value: l.id, selected: frames[i] === l.id }, `Directions turning with link ${nums.get(l.id)}`)));
          }
          const raw = q.series(app, s, { frame: frames[i] });
          const series = q.polar
            ? raw.map((sr) => ({ ...sr, px: ordered.order.map((k) => sr.px[k]), py: ordered.order.map((k) => sr.py[k]), values: ordered.order.map((k) => sr.values[k]) }))
            : inPlotOrder(raw, s, ordered);
          // tick boxes to show only some of the lines
          const key = (sr) => `${q.id}|${sr.name}`;
          const box = chips[i];
          box.hidden = series.length < 2;
          box.replaceChildren(...(series.length < 2 ? [] : series.map((sr) => h('label', { class: 'plot-chip', title: 'Show or hide this line' },
            h('input', { type: 'checkbox', checked: !hidden[i].has(key(sr)), onchange: (e) => { if (e.target.checked) hidden[i].delete(key(sr)); else hidden[i].add(key(sr)); update(true); } }),
            h('span', { class: 'plot-chip-line', style: { borderTopColor: sr.color, borderTopStyle: sr.dash && sr.dash.length ? 'dashed' : 'solid' } }),
            sr.name))));
          const shown = series.filter((sr) => !hidden[i].has(key(sr)));
          const empty = q.force && !app.forceSweep() ? 'Choose Static or Dynamic in the Forces panel to plot forces.'
            : series.length && !shown.length ? 'All lines are hidden: tick one above.' : 'Nothing to plot for this mechanism.';
          // the tick boxes name the lines, so the plot needs no legend of its own
          // yKey: a range typed under Axes stays while the plot shows the same quantity in the same unit
          if (q.polar) {
            p.setData({ polar: true, x: xs, xName: xMode === 'time' ? 't' : lab.sym, series: shown, marks: polarMarks(xs, xMode !== 'time' && app.sim.inputIsAngle, app.display.angleStep),
              empty, legend: false, yKey: `${qLabel(q)}|${frames[i]}`,
              note: frames[i] === 'frame' ? '' : `turning with link ${nums.get(frames[i])}` });
            return;
          }
          p.setData({ x: xs, xName: xMode === 'time' ? 't' : lab.sym, xAngle: xMode !== 'time' && app.sim.inputIsAngle, yAngle: !!q.directions, series: shown, markers: q.knocks ? markers.concat(knockMarks) : markers, empty, pickByX, legend: series.length < 2, yKey: `${qLabel(q)}${q.directions ? `|${frames[i]}` : ''}` });
        });
      }
    }
    // cursor at the current input, mapped into the plotted range
    if (xs.length) {
      const k = app.sim.nearestSampleIndex();
      const at = where.has(k) ? where.get(k) : null;
      let c = at !== null ? xs[at] : app.inputDisplay();
      const lo = Math.min(...xs);
      if (at === null && s && s.fullTurn) { while (c < lo) c += 360; while (c > lo + 360) c -= 360; }
      for (const p of plots) p.setCursor(c, at);
    }
  }
  /** Redraw the plots after the text size changed. */
  const restyle = () => plots.forEach((p) => p.restyle());
  return { update, restyle };
}

/** A quantity's name with mm replaced by the drawing's unit (mm/s → m/s …). */
const unitLabel = (label, U) => label
  .replace(/\bmm\b/g, U.label)
  .replace(/\(N·m\)/g, `(${U.T.label})`).replace(/\(N\)/g, `(${U.F.label})`).replace(/\(J\)/g, `(${U.E.label})`);

/** Short tick labels: 12 500 → "12.5k", 3 200 000 → "3.2M". */
function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toPrecision(3)}M`;
  if (a >= 1e4) return `${+(v / 1e3).toPrecision(3)}k`;
  return String(+(+v).toPrecision(4));
}

/**
 * x values in plotting order, and the order of the sweep samples behind them.
 * A full-turn cycle is rearranged to run from 0° to 360° (or from here to
 * here + 360°); a rocking input runs between its two limit positions.
 * `wrapFrom`: plotted points from this one on were reached one cycle later
 * than the sweep's start, so a quantity that adds up over a cycle (an angle
 * that keeps turning) is shifted by its change over one cycle there.
 */
function orderForPlot(s, angle = true, lengthFactor = 1, mode = 'zero', anchor = 0, omega = 1) {
  const all = s.samples.map((_, i) => i);
  // time: how far the input has travelled along the cycle, at the input speed
  // (never doubles back, so a rocking input's two assemblies do not overlap)
  if (mode === 'time') {
    const w = Math.abs(omega) || 1;
    return { xs: s.samples.map((smp) => (smp.travel ?? 0) / w), order: all, wrapFrom: null };
  }
  if (!s.fullTurn) {
    // a closed circuit (rocking input) may start from the current position
    let order = all, wrapFrom = null;
    if (mode === 'here' && s.closed && anchor > 0 && anchor < all.length - 1) {
      const base = all.slice(0, -1);
      order = base.slice(anchor).concat(base.slice(0, anchor));
      order.push(order[0]);
      wrapFrom = base.length - anchor;
    }
    return { xs: order.map((i) => (angle ? s.samples[i].theta * DEG : s.samples[i].theta / lengthFactor)), order, wrapFrom };
  }
  const base = s.samples.slice(0, -1); // the last sample repeats the first, one turn later
  if (mode === 'here') {
    // a full turn starting at the current position: x runs from here to here + 360°
    const k = Math.min(Math.max(anchor, 0), base.length - 1);
    const order = base.map((_, i) => (k + i) % base.length);
    const start = ((base[k].theta * DEG) % 360 + 360) % 360;
    const xs = order.map((i) => start + (base[i].theta - base[k].theta + (i < k ? 2 * Math.PI : 0)) * DEG);
    order.push(order[0]);
    xs.push(start + 360);
    return { xs, order, wrapFrom: base.length - k };
  }
  // input angle within 0…360°; a sample on 0° (± rounding) counts as 0° exactly
  const w = base.map((smp) => { const a = ((smp.theta * DEG) % 360 + 360) % 360; return a < 1e-6 || a > 360 - 1e-6 ? 0 : a; });
  let m = 0;
  for (let i = 1; i < w.length; i++) if (w[i] < w[m]) m = i;
  const idx = base.map((_, i) => i);
  const order = idx.slice(m).concat(idx.slice(0, m));
  const xs = w.slice(m).concat(w.slice(0, m)); // increasing from the smallest angle
  // close the cycle so the plot spans a full 360°
  order.push(order[0]);
  xs.push(xs[0] + 360);
  return { xs, order, wrapFrom: base.length - m };
}

/**
 * A series computed along the sweep, put in plotting order. Values reached
 * one cycle later (from `wrapFrom` on) get the series' change over one cycle
 * added, so an angle that keeps turning stays continuous instead of dropping
 * back where the sweep started.
 */
function inPlotOrder(series, s, ordered) {
  const N = s.samples.length - 1;
  return series.map((sr) => {
    const v = sr.values;
    let D = 0;
    if (ordered.wrapFrom !== null && (s.fullTurn || s.closed) && Number.isFinite(v[0]) && Number.isFinite(v[N])) D = v[N] - v[0];
    return { ...sr, values: ordered.order.map((k, i) => v[k] + (ordered.wrapFrom !== null && i >= ordered.wrapFrom ? D : 0)) };
  });
}

export function exportCSV(app) {
  const s = app.sim.getSweep();
  if (!s) { app.flash(app.whyNotDrivable()); return; }
  const nums = app.linkNumbers();
  const angle = app.sim.inputIsAngle;
  // lengths in the drawing's unit (column names say which)
  const U = app.units, uk = U.label;
  const len = (v) => (v === null || v === undefined ? NaN : U.len(v));
  const cols = [angle ? 'input_deg' : `input_${uk}`];
  const getters = [(smp) => (angle ? smp.theta * DEG : len(smp.theta))];
  const o = app.output();
  if (o) {
    cols.push('output', 'output_velocity', 'output_acceleration', 'velocity_ratio');
    const ro = (smp) => readOutput(app.doc, smp.results, o) || {};
    const conv = (smp, k) => { const r = ro(smp); return r.angle ? r[k] : len(r[k]); };
    const w = app.doc.motion.omega;
    getters.push((smp) => conv(smp, 'value'), (smp) => conv(smp, 'vel'), (smp) => conv(smp, 'acc'),
      (smp) => (w ? conv(smp, 'vel') / (angle ? w : len(w)) : NaN));
  }
  for (const l of app.doc.links) {
    const n = nums.get(l.id);
    cols.push(`theta${n}_deg`, `omega${n}_rad_s`, `alpha${n}_rad_s2`);
    getters.push((smp) => smp.results.links.get(l.id).theta * DEG, (smp) => smp.results.links.get(l.id).omega, (smp) => smp.results.links.get(l.id).alpha);
  }
  app.doc.joints.forEach((j, i) => {
    if (j.ground) return;
    const tag = `J${i + 1}`;
    cols.push(`${tag}_x_${uk}`, `${tag}_y_${uk}`, `${tag}_Vx_${uk}_s`, `${tag}_Vy_${uk}_s`, `${tag}_Ax_${uk}_s2`, `${tag}_Ay_${uk}_s2`);
    const r = (smp) => smp.results.joints.get(j.id);
    getters.push((smp) => len(r(smp).pos.x), (smp) => len(r(smp).pos.y),
      (smp) => r(smp).vel && len(r(smp).vel.x), (smp) => r(smp).vel && len(r(smp).vel.y),
      (smp) => r(smp).acc && len(r(smp).acc.x), (smp) => r(smp).acc && len(r(smp).acc.y));
  });
  app.doc.sliders.forEach((sl, i) => {
    cols.push(`slider${i + 1}_d_${uk}`, `slider${i + 1}_v_${uk}_s`, `slider${i + 1}_a_${uk}_s2`);
    getters.push((smp) => len(smp.results.sliders.get(sl.id).d), (smp) => len(smp.results.sliders.get(sl.id).v), (smp) => len(smp.results.sliders.get(sl.id).a));
  });
  // forces over the cycle (when the Forces panel is on)
  if (app.forceSweep()) {
    const first = s.samples.map((smp) => app.forceOf(smp)).find(Boolean);
    if (first) {
      const F = (smp) => app.forceOf(smp);
      // forces in the chosen units; column names say which (· becomes _)
      const tag = (q) => q.label.replace(/·/g, '_');
      const fu = tag(U.F), tu = tag(U.T), eu = tag(U.E);
      cols.push(angle ? `input_torque_${tu}` : `input_force_${fu}`);
      getters.push((smp) => { const r = F(smp); return r && r.input ? (r.input.torque !== undefined ? U.T.show(r.input.torque) : U.F.show(r.input.force)) : NaN; });
      const L = forceLabels(app.doc, app.sim);
      first.pins.forEach((p, k) => {
        const nm = L.pin(p), name = `${nm.name.ascii}_${nm.joint}`;
        cols.push(`${name}_Fx_${fu}`, `${name}_Fy_${fu}`);
        getters.push((smp) => { const r = F(smp); return r ? U.F.show(r.pins[k].F.x) : NaN; }, (smp) => { const r = F(smp); return r ? U.F.show(r.pins[k].F.y) : NaN; });
      });
      cols.push(`shaking_Fx_${fu}`, `shaking_Fy_${fu}`, `shaking_M_${tu}`, `kinetic_energy_${eu}`);
      getters.push((smp) => { const r = F(smp); return r ? U.F.show(r.shaking.F.x) : NaN; }, (smp) => { const r = F(smp); return r ? U.F.show(r.shaking.F.y) : NaN; },
        (smp) => { const r = F(smp); return r ? U.T.show(r.shaking.M) : NaN; }, (smp) => { const r = F(smp); return r ? U.E.show(r.energy.KE) : NaN; });
    }
  }
  const lab = inputLabel(app);
  const vu = angle ? 'rad/s' : `${uk}/s`, au = angle ? 'rad/s^2' : `${uk}/s^2`;
  const sp = angle ? app.doc.motion.omega : len(app.doc.motion.omega), ac = angle ? app.doc.motion.alpha : len(app.doc.motion.alpha);
  const lines = [`# LinkLab export: ${app.doc.meta.title}; lengths in ${uk}; input = ${lab.name}; input speed = ${sp} ${vu}; input acceleration = ${ac} ${au}`, cols.join(',')];
  for (const smp of s.samples) lines.push(getters.map((g) => { const v = g(smp); return Number.isFinite(v) ? +v.toPrecision(10) : ''; }).join(','));
  const name = (app.doc.meta.title || 'mechanism').replace(/[^\w\- ]+/g, '').trim() || 'mechanism';
  downloadFile(`${name}-analysis.csv`, lines.join('\n'), 'text/csv');
  app.flash('Data exported (CSV) to your Downloads folder.');
}
