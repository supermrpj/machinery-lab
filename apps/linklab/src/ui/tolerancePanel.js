// =============================================================================
// tolerancePanel.js — the Tolerance panel (Advanced)
// -----------------------------------------------------------------------------
// Holes are a little larger than their pins, so a real mechanism has play.
// The panel answers, for the output (or a chosen point):
//   1. What is checked, and the pin clearance (presets; pins that differ)
//   2. How far it can be off here (the play), where the load puts it, the
//      largest play over the cycle, and the knocks (where pins cross their
//      holes because their force reverses)
//   3. Which pin to improve (each pin's share of the play)
//   4. On the drawing: the magnifier, or the play drawn exaggerated
//   5. More (optional): hole position error, random builds
// The sums are in model/tolerance.js (linear, so they follow every change);
// the load comes from the force analysis (Forces › Static or Dynamic).
// Settings are kept for the session in app.tolerance.
// =============================================================================

import { h } from '../../../../packages/ui-kit/src/dom.js';
import { fmt, fmtSig, parseNum } from '../../../../packages/ui-kit/src/format.js';
import {
  runTolerance, currentTolerance, toleranceSettings, chosenPoint, magnification, drawLimit,
  targetChoices, chosenTarget, clearanceSetting, studyFor, poseFor, targetOn,
} from '../model/tolerance.js';
import { TOLERANCE } from '../config.js';
import { isoFit, ISO_HOLES, ISO_SHAFTS, ISO_PAIRS } from '../model/isofits.js';
import { inputLabel } from './timeline.js';

const DEG = 180 / Math.PI;

export function buildTolerance(app) {
  const sim = app.sim, doc = app.doc, U = app.units;
  const t = toleranceSettings(app);
  if (!sim.sys) return h('p', { class: 'note' }, 'Draw a mechanism to study its play here.');
  if (!sim.drivable) return h('p', { class: 'note' }, app.whyNotDrivable());
  const jname = (id) => `J${doc.joints.findIndex((j) => j.id === id) + 1}`;
  const nums = app.linkNumbers();
  const linkNo = (b) => (b < 0 ? 1 : nums.get(sim.sys.bodies[b].id));
  const lab = inputLabel(app);
  const showIn = (th) => `${lab.sym} = ${fmt(app.inputShown(th), sim.inputIsAngle ? 1 : 2)}${lab.unit === '°' ? '°' : ` ${lab.unit}`}`;
  const changed = () => { app.requestRender(); app.ui.refresh(app, 'selection'); };
  // small lengths (play, clearances): significant figures, so 0.2 mm reads in m and in inches too
  const len = (v) => `${fmtSig(U.len(v), 3)} ${U.label}`;
  const parts = [];

  parts.push(h('p', { class: 'note' },
    'Holes are a little larger than their pins, so a real mechanism has play. ',
    'This shows how far the output can be off, where the load puts it, where it knocks, and which pin to improve.'));

  // ---- 1. what is checked, and the clearance ----
  const target = chosenTarget(app);
  const outputName = () => {
    const tg = targetOn(sim.sys, doc, 'output');
    if (!tg) return 'Output';
    if (tg.kind === 'angle') return `Output (link ${nums.get(tg.link)} angle)`;
    const o = doc.output;
    if (o.kind === 'slider') return `Output (slider ${doc.sliders.findIndex((s) => s.id === o.slider) + 1})`;
    return `Output (${o.kind} of ${jname(o.joint)})`;
  };
  parts.push(h('div', { class: 'field' }, h('label', {}, 'Check'),
    h('select', { 'aria-label': 'What to check', onchange: (e) => { t.target = e.target.value; if (e.target.value !== 'output') t.point = e.target.value; changed(); } },
      targetChoices(app).map((id) => h('option', { value: id, selected: id === target },
        id === 'output' ? outputName() : `${jname(id)}${doc.joints.find((j) => j.id === id).trace ? ' (traced point)' : ''}`)))));

  // the clearance: a common part, an ISO fit (hole class, pin class, nominal
  // size → limits from ISO 286), or a number typed in
  const preset = !t.iso && TOLERANCE.presets.find((p) => Math.abs(p.c - t.clearance) < 1e-12);
  const applyIso = () => {
    const f = isoFit(t.iso.hole, t.iso.shaft, t.iso.d);
    if (f) t.clearance = t.iso.use === 'mean' ? f.mean : f.max;
    changed();
  };
  parts.push(h('div', { class: 'field' }, h('label', { title: 'Hole diameter minus pin diameter. The pin can move half of it each way from the centre of its hole.' }, 'Pin clearance (hole Ø − pin Ø)'),
    h('select', { 'aria-label': 'Typical clearances', onchange: (e) => {
      const v = e.target.value;
      if (v === 'iso') { t.iso = { ...TOLERANCE.isoDefault }; applyIso(); } else if (v === 'custom') { t.iso = null; changed(); } else { t.iso = null; t.clearance = +v; changed(); }
    } },
      h('option', { value: 'iso', selected: !!t.iso }, 'ISO fit: hole and pin classes, nominal size'),
      TOLERANCE.presets.map((p) => h('option', { value: p.c, selected: preset === p }, `${p.label}: ${p.c ? `${fmtSig(U.len(p.c), 3)} ${U.label}` : '0'}`)),
      h('option', { value: 'custom', selected: !t.iso && !preset }, 'Manual: type it below'))));
  if (t.iso) {
    const f = isoFit(t.iso.hole, t.iso.shaft, t.iso.d);
    const pair = ISO_PAIRS.find(([hole, shaft]) => hole === t.iso.hole && shaft === t.iso.shaft);
    const sel = (label, key, list) => h('select', { 'aria-label': label, onchange: (e) => { t.iso[key] = e.target.value; applyIso(); } },
      list.map((c) => h('option', { value: c, selected: c === t.iso[key] }, c)));
    parts.push(h('div', { class: 'field' }, h('label', {}, 'Hole / pin'), h('div', { class: 'pair' },
      sel('Hole class', 'hole', ISO_HOLES), sel('Pin class', 'shaft', ISO_SHAFTS))));
    parts.push(h('div', { class: 'field' }, h('label', {}, `Nominal Ø (${U.label})`),
      h('input', { type: 'number', step: 'any', min: 0, value: +U.len(t.iso.d).toPrecision(4), 'aria-label': `Nominal diameter in ${U.label}`,
        onchange: (e) => { const v = parseNum(e.target.value); if (v > 0) { t.iso.d = U.mm(v); applyIso(); } } })));
    parts.push(h('div', { class: 'field' }, h('label', {}, 'Use'),
      h('select', { 'aria-label': 'Which clearance to use', onchange: (e) => { t.iso.use = e.target.value; applyIso(); } },
        h('option', { value: 'max', selected: t.iso.use !== 'mean' }, 'Largest (worst case)'),
        h('option', { value: 'mean', selected: t.iso.use === 'mean' }, 'Mean'))));
    const lim = (x) => `${x >= 0 ? '+' : '−'}${fmtSig(U.len(Math.abs(x)), 3)}`;
    parts.push(h('p', { class: 'note' }, f
      ? [`${t.iso.hole}/${t.iso.shaft}${pair ? ` (${pair[2]})` : ''} at Ø${fmtSig(U.len(t.iso.d), 4)} ${U.label}: hole ${lim(f.hole.es)} / ${lim(f.hole.ei)}, pin ${lim(f.shaft.es)} / ${lim(f.shaft.ei)}. `,
        h('b', {}, `Clearance ${fmtSig(U.len(f.min), 3)} to ${fmtSig(U.len(f.max), 3)} ${U.label}`), ` (mean ${fmtSig(U.len(f.mean), 3)}). ISO 286, sizes up to 500 mm.`]
      : 'Not in the tables: sizes up to 500 mm, holes H6–H11, pins c, d, e, f, g, h in grades 5–11.'));
  }
  parts.push(h('div', { class: 'field' }, h('label', {}, `Clearance, every pin (${U.label})`),
    h('input', { type: 'number', step: 'any', min: 0, value: +U.len(t.clearance).toPrecision(4), 'aria-label': `Pin clearance in ${U.label}`, readOnly: !!t.iso, title: t.iso ? 'From the ISO fit above' : '',
      onchange: (e) => { const v = parseNum(e.target.value); if (v !== null && v >= 0) { t.iso = null; t.clearance = U.mm(v); changed(); } } })));

  // pins that differ (a bearing at the ground pivots, say)
  const pinList = [];
  for (const c of sim.sys.constraints) {
    if (!c.info || c.info.kind !== 'pin' || pinList.some((p) => p.joint === c.info.joint)) continue;
    pinList.push({ joint: c.info.joint, links: [c.info.i, c.info.j].map(linkNo).sort((a, b) => a - b).join('–') });
  }
  const differ = Object.keys(t.pins || {}).filter((id) => pinList.some((p) => p.joint === id));
  parts.push(h('details', { class: 'more', open: differ.length > 0 },
    h('summary', {}, differ.length ? `Pins that differ (${differ.length})` : 'Pins that differ'),
    h('p', { class: 'note' }, 'Give a pin its own clearance, e.g. a ball bearing at a ground pivot. Empty = the clearance above.'),
    h('table', { class: 'data' }, h('tbody', {}, pinList.map((p) => h('tr', {},
      h('td', {}, `${jname(p.joint)} (links ${p.links})`),
      h('td', {}, h('input', { type: 'number', step: 'any', min: 0, style: { width: '84px' }, placeholder: fmtSig(U.len(t.clearance), 3),
        value: Number.isFinite((t.pins || {})[p.joint]) ? +U.len(t.pins[p.joint]).toPrecision(4) : '', 'aria-label': `Clearance of ${jname(p.joint)} in ${U.label}`,
        onchange: (e) => {
          const v = e.target.value.trim() === '' ? null : parseNum(e.target.value);
          t.pins = { ...(t.pins || {}) };
          if (v === null || v < 0) delete t.pins[p.joint]; else t.pins[p.joint] = U.mm(v);
          changed();
        } })),
      h('td', {}, U.label)))))));

  // ---- 2. results ----
  const now = poseFor(app);
  const st = studyFor(app);
  if (!target || !now) {
    parts.push(h('p', { class: 'note' }, now === null && target ? 'At or very near a dead-centre position this estimate does not hold: no answer here. Move a little away from it.' : 'Nothing that moves to check.'));
    return h('div', {}, parts);
  }
  if (!(now.play > 0)) {
    parts.push(h('p', { class: 'note' }, 'Give a clearance to see its effect.'));
    return h('div', {}, parts);
  }
  const tg = now.target;
  const scalar = tg.kind !== 'point';
  const isAng = tg.kind === 'angle';
  // how a value of the target reads: degrees for an angle, the length unit otherwise
  const val = (x, signed = false) => {
    if (isAng) { const d = x * DEG, a = Math.abs(d); return `${signed ? (d >= 0 ? '+' : '−') : ''}${a.toFixed(a < 0.1 ? 3 : 2)}°`; }
    return `${signed ? (x >= 0 ? '+' : '−') : ''}${len(Math.abs(x))}`;
  };
  // an angle at the tip of the link: the length it moves there
  let lever = null;
  if (isAng) {
    const link = doc.links.find((l) => l.id === tg.link);
    const g = link.joints.find((id) => (doc.joints.find((j) => j.id === id) || {}).ground);
    if (g) {
      const tip = link.joints.filter((id) => id !== g).map((id) => ({ id, d: Math.hypot(sim.jointPos(id).x - sim.jointPos(g).x, sim.jointPos(id).y - sim.jointPos(g).y) }))
        .sort((a, b) => b.d - a.d)[0];
      if (tip) lever = tip;
    }
  }
  const forcesOn = !!app.forceSweep();
  const card = [];
  card.push(h('div', { class: 'tol-line' }, h('b', {}, `Play here: ±${val(now.play)}`),
    lever ? h('span', { class: 'note' }, ` (${len(now.play * lever.d)} at ${jname(lever.id)})`) : null));
  card.push(h('p', { class: 'note tol-sub' }, scalar
    ? 'The most it can be off at this position, with every pin at its worst side.'
    : 'The most the point can be off at this position, in any direction, with every pin at its worst side.'));
  if (now.pushed && now.loaded !== null) {
    const off = scalar ? val(now.loaded, true) : len(Math.hypot(now.loaded.x, now.loaded.y));
    const how = isAng ? (now.loaded >= 0 ? ' (counter-clockwise)' : ' (clockwise)') : '';
    card.push(h('div', { class: 'tol-line' }, h('b', {}, `Pushed by hand: ${off}${how}`)));
    card.push(h('p', { class: 'note tol-sub' }, t.drag === 'walls'
      ? 'Each pin sits against the side of its hole your push sends it to. It stays so until you move the input.'
      : 'Each pin sits where your hand puts it, inside its hole. It stays so until you move the input.'));
  } else if (forcesOn && now.loaded !== null) {
    const off = scalar ? val(now.loaded, true) : len(Math.hypot(now.loaded.x, now.loaded.y));
    const how = isAng ? (now.loaded >= 0 ? ' (counter-clockwise)' : ' (clockwise)') : '';
    card.push(h('div', { class: 'tol-line' }, h('b', {}, `Under the load: ${off}${how}`)));
    card.push(h('p', { class: 'note tol-sub' }, 'Where it actually is: the load pushes each pin against one side of its hole.'));
  } else {
    card.push(h('p', { class: 'note tol-sub' }, 'Choose Static or Dynamic in the Forces panel to see where the load puts it and where it knocks. Or drag a link on the drawing to push it by hand.'));
  }
  if (st && Number.isFinite(st.play[st.maxK])) {
    card.push(h('div', { class: 'tol-line' }, `Largest play: ±${val(st.play[st.maxK])} at ${showIn(st.samples[st.maxK].theta)} `,
      h('button', { class: 'btn small', onclick: () => { app.play(false); app.goToSample(st.maxK); } }, 'Go there')));
    if (st.maxAwayK >= 0) {
      card.push(h('p', { class: 'note tol-sub' }, 'That is next to a limit or dead-centre position, where the play grows. Away from those: ',
        h('b', {}, `±${val(st.play[st.maxAwayK])} at ${showIn(st.samples[st.maxAwayK].theta)}`), ' ',
        h('button', { class: 'btn small', onclick: () => { app.play(false); app.goToSample(st.maxAwayK); } }, 'Go there')));
    }
    const skipped = st.play.filter((v) => !Number.isFinite(v)).length;
    if (skipped) card.push(h('p', { class: 'note tol-sub' }, `${skipped} of ${st.play.length} positions, at or next to a dead centre, are left out: there the estimate does not hold.`));
  }
  if (forcesOn && st && st.loaded) {
    const knocks = st.knocks.slice().sort((a, b) => a.k - b.k);
    if (knocks.length) {
      card.push(h('div', { class: 'tol-line tol-knock' }, h('b', {}, knocks.length === 1 ? 'Knocks once a cycle' : `Knocks ${knocks.length} times a cycle`)));
      card.push(h('p', { class: 'note tol-sub' }, 'There the force at a pin passes zero and turns round: the pin crosses its hole and hits the far side, and the output jumps.'));
      for (const kn of knocks) {
        card.push(h('div', { class: 'tol-knock-row' },
          h('span', {}, `${showIn(kn.theta)}: jumps ${val(kn.jump)} (${kn.pins.map(jname).join(', ')})`),
          h('button', { class: 'btn small', onclick: () => { app.play(false); app.goToSample(kn.k); } }, 'Go')));
      }
    } else {
      card.push(h('div', { class: 'tol-line' }, h('b', {}, 'No knock')));
      card.push(h('p', { class: 'note tol-sub' }, 'The pin forces never turn round, so each pin stays against one side of its hole.'));
    }
  }
  parts.push(h('div', { class: 'tol-card' }, card));

  // ---- 3. which pin to improve ----
  const rows = now.parts.filter((p) => p.adds > 1e-15);
  const total = rows.reduce((s, p) => s + p.adds, 0);
  const where = (p) => (p.kind === 'pin' ? `${jname(p.joint)} (links ${[p.i, p.j].map(linkNo).sort((a, b) => a - b).join('–')})` : `hole ${jname(p.joint)} in link ${linkNo(p.i)}`);
  parts.push(h('div', { class: 'subhead' }, 'Which pin to improve'));
  const shares = rows.map((p) => p.adds / total);
  const sameC = rows.every((p) => p.kind !== 'pin' || Math.abs(p.r - rows.find((x) => x.kind === 'pin').r) < 1e-12);
  if (rows.length > 1 && sameC && Math.max(...shares) - Math.min(...shares) < 0.02) {
    parts.push(h('p', { class: 'note' }, `Every pin counts the same here (${fmt(100 / rows.length, 0)} % each): the pins form one closed loop with the same clearance, so a gap at any of them moves the output alike. `,
      'Making one pin better (a bearing, a reamed hole) takes off its share; set it under “Pins that differ” to see the result.'));
  } else {
    const top = Math.max(...shares);
    parts.push(h('div', { class: 'tol-bars' }, rows.slice().sort((a, b) => b.adds - a.adds).map((p) => h('div', { class: 'tol-bar' },
      h('span', {}, where(p)),
      h('i', { style: { width: `${(100 * p.adds) / total / top}%` } }),
      h('span', {}, `${fmt((100 * p.adds) / total, 0)} %`)))));
    parts.push(h('p', { class: 'note' }, 'A smaller clearance at the pins with the largest share helps most (a reamed hole, a bushing, a bearing).'));
  }
  if (forcesOn && st && st.knocks.length) {
    parts.push(h('p', { class: 'note' }, 'A knock goes only if the force at that pin never turns round: a spring that keeps the links loaded one way, a different speed, or different masses. Balancing moves the knocks but seldom removes them.'));
  }

  // ---- 4. on the drawing ----
  parts.push(h('div', { class: 'subhead' }, 'On the drawing'));
  parts.push(h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: t.lens, onchange: (e) => { t.lens = e.target.checked; app.requestRender(); } }),
    ' Magnifier at the checked point'));
  // the key: each swatch looks like the mark it explains
  const key = (sw, text) => h('div', { class: 'tol-key-row' }, h('span', { class: `tol-sw ${sw}` }), h('span', {}, text));
  if (t.lens) {
    parts.push(h('div', { class: 'tol-key', role: 'list', 'aria-label': 'Key to the magnifier' }, scalar ? [
      key('zone', 'Shaded: the play here, from −play to +play (every pin at its worst side)'),
      key('ticks', 'Ticks: where the load puts it over the cycle'),
      key('now', 'Orange marker: where it is now, as the dashed drawing has it (your push, else the load, else every pin at its worst side)'),
    ] : [
      key('zone', 'Shaded: where the point can be at this position. Each pin’s play moves it along a short line or a small oval; added together they give this shape'),
      key('cycle', 'Dotted outline: the same over the whole cycle'),
      key('ideal', 'Black dot: its ideal place'),
      key('path', 'Orange line: where the load puts it over the cycle (jumps dashed)'),
      key('now', 'Orange dot: where it is now, as the dashed drawing has it (your push, else the load, else every pin at its worst side)'),
    ]));
  }
  // the play on the drawing: always shown while this tab is open
  const k = magnification(t, app.view.zoom, drawLimit(app));
  parts.push(h('div', { class: 'field' }, h('label', {}, 'Play drawn'),
    h('select', { 'aria-label': 'How much larger the play is drawn', onchange: (e) => { t.scale = e.target.value === 'auto' ? 'auto' : +e.target.value; changed(); } },
      h('option', { value: 'auto', selected: t.scale === 'auto' }, `Auto (${k === 1 ? 'true size' : `${k}×`})`),
      TOLERANCE.magnify.map((m) => h('option', { value: m, selected: t.scale === m }, m === 1 ? 'True size' : `${m} × larger`)))));
  parts.push(h('div', { class: 'tol-key', role: 'list', 'aria-label': 'Key to the play on the drawing' },
    key('links', `Dashed links: the mechanism shifted by the play, drawn ${k === 1 ? 'at true size' : `${k}× larger`}`),
    key('hole', `Ring and dot: each hole and its pin, ${now.pushed ? 'where your push sends it' : forcesOn ? 'where the load puts it' : 'at its worst side'}`)));
  parts.push(h('p', { class: 'note' }, h('b', {}, 'Move it by hand: '),
    'drag a link on the drawing. The motor holds the input, so the links move only within their play; the dashed links show where each pin sits in its hole. It stays so until you move the input.'));
  parts.push(h('div', { class: 'field' }, h('label', {}, 'When you drag'),
    h('select', { 'aria-label': 'When you drag a link', onchange: (e) => { t.drag = e.target.value; changed(); } },
      h('option', { value: 'follow', selected: t.drag !== 'walls' }, 'Follow the mouse (smooth)'),
      h('option', { value: 'walls', selected: t.drag === 'walls' }, 'Push to the walls (extremes)'))));
  parts.push(h('p', { class: 'note' }, t.drag === 'walls'
    ? 'Every pin goes straight to the side of its hole the push loads it against: the extremes, as a firm push gives.'
    : 'The point you grab follows the mouse, drawn at the same size as the play, until the pins reach the sides of their holes.'));

  // ---- 5. more ----
  parts.push(h('details', { class: 'more', open: t.holePosition > 0 },
    h('summary', {}, 'Hole position error (optional)'),
    h('p', { class: 'note' }, 'Each hole may also be a little off its drawn place, anywhere within a circle of this radius. It adds to the play (it does not move with the load).'),
    h('div', { class: 'field' }, h('label', {}, `Radius (${U.label})`),
      h('input', { type: 'number', step: 'any', min: 0, value: +U.len(t.holePosition).toPrecision(4), 'aria-label': `Hole position error in ${U.label}`,
        onchange: (e) => { const v = parseNum(e.target.value); if (v !== null && v >= 0) { t.holePosition = U.mm(v); changed(); } } }))));

  const point = tg.kind === 'point' ? tg.id : chosenPoint(app);
  const cur = currentTolerance(app);
  const random = [];
  random.push(h('p', { class: 'note' },
    'The play has every pin at its worst side at once. With no load to decide, pins sit at random sides; ',
    `this tries many such builds of ${jname(point)} over the cycle (solved exactly) to show what is typical.`));
  random.push(h('div', { class: 'field' }, h('label', {}, 'Random builds'),
    h('input', { type: 'number', step: 1, min: 1, max: TOLERANCE.maxBuilds, value: t.builds, 'aria-label': 'Number of random builds',
      onchange: (e) => { const v = Math.round(parseNum(e.target.value)); if (v >= 1) t.builds = Math.min(TOLERANCE.maxBuilds, v); } })));
  random.push(h('div', { class: 'row-buttons' },
    h('button', { class: 'btn', onclick: () => {
      t.result = runTolerance(sim, { clearance: clearanceSetting(t), holePosition: t.holePosition, builds: t.builds, points: point ? [point] : undefined });
      t.version = app.version;
      changed();
    } }, cur ? 'Run again' : 'Run')));
  if (t.result && !cur) random.push(h('p', { class: 'note' }, 'The mechanism has changed since the last run: run again.'));
  const res = cur && cur.result.points.find((p) => p.id === point);
  if (res) {
    const r = cur.result;
    random.push(h('table', { class: 'data' }, h('tbody', {},
      h('tr', {}, h('td', {}, 'Builds × positions'), h('td', {}, `${r.builds} × ${r.poses}`)),
      h('tr', {}, h('td', {}, 'Largest deviation'), h('td', {}, len(res.maxDev))),
      h('tr', {}, h('td', {}, 'RMS (typical)'), h('td', {}, len(res.rms))),
      h('tr', {}, h('td', {}, 'Play (worst case), for comparison'), h('td', {}, len(res.worstDev))))));
    if (r.failedBuilds) random.push(h('p', { class: 'warn-note' }, `${r.failedBuilds} of ${r.builds} builds could not reach every position (usually near a limit position); those positions were left out for them.`));
  }
  parts.push(h('details', { class: 'more', open: !!cur }, h('summary', {}, 'Random builds (what is typical)'), random));
  parts.push(h('p', { class: 'note' }, 'Only pins are studied; sliders and gears are taken as exact. The sums are linear (good while the play is small next to the links).'));
  return h('div', {}, parts);
}
