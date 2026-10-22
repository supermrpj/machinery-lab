// =============================================================================
// timeline.js — cam angle, play, speed, and the values at this angle
// -----------------------------------------------------------------------------
// The values sit in a box whose width is set from the cells shown and their
// units, not from the numbers, so the slider keeps one width while the cam
// turns (a long number moves its neighbours inside the box, nothing outside). v and a follow the plots' "per rad"
// switch while motion plots are shown.
// =============================================================================

import { h, icon, replaceChildren } from '../../../../packages/ui-kit/src/dom.js';
import { fmt, parseNum } from '../../../../packages/ui-kit/src/format.js';
import { ICONS } from './icons.js';
import { ANIMATION } from '../config.js';
import { valuesAt } from '../model/analysis.js';
import { showNum, scaleOf } from './numbers.js';

// ---- CONFIG -------------------------------------------------------------------
const VALUE_CH = 8;   // room for one value, in characters (−0.001234 is 9: it borrows from the gap)
const GAP_PX = 12;    // between the cells (styles.css .readout gap)
// -------------------------------------------------------------------------------

export function buildTimeline(el, app) {
  const play = h('button', { class: 'play', title: 'Play or pause (Space)', 'aria-label': 'Play', onclick: () => app.play() });
  const angle = h('input', { type: 'number', step: 'any', 'aria-label': 'Cam angle θ in degrees',
    // the box shows the angle the cam is at (450 → 90, −30 → 330)
    onchange: (e) => { const v = parseNum(e.target.value); if (v !== null) app.setTheta(v); angle.value = +app.theta.toFixed(2); } });
  const slider = h('input', { type: 'range', min: 0, max: 360, step: 0.25, 'aria-label': 'Cam angle',
    // read the value first: stopping the animation redraws the timeline, which resets the slider
    oninput: (e) => { const v = +e.target.value; app.play(false); app.setTheta(v); } });
  const speed = h('select', { 'aria-label': 'Animation speed', onchange: (e) => { app.speed = +e.target.value; } },
    ANIMATION.speeds.map((s) => h('option', { value: s, selected: s === 1 }, `${s}×`)));

  // one cell per value: name, value (fixed width), unit
  const cells = {};
  const cell = (key, name, cls = '') => {
    const val = h('span', { class: `ro-val ${cls}` }), unit = h('span', { class: 'ro-unit' });
    cells[key] = { el: h('span', { class: 'ro' }, h('span', { class: 'ro-name' }, name), ' ', val, unit), val, unit };
    return cells[key].el;
  };
  const readout = h('span', { class: 'readout' },
    cell('s', 's'), cell('v', 'v'), cell('a', 'a'), cell('phi', 'φ', 'short'), cell('F', 'Fc'), cell('T', 'Tc'));
  replaceChildren(el, play,
    h('span', { class: 'angle' }, 'θ', angle, '°'),
    slider,
    h('span', { class: 'label' }, 'Speed'), speed,
    readout);

  // the size of each quantity over the turn, for showing round-off as 0 (worked out once per design)
  let scales = null, scalesOf = null;
  function scalesFor(r) {
    if (scalesOf !== r) {
      scalesOf = r;
      scales = { s: Math.max(Math.abs(r.sMin), Math.abs(r.sMax)), v: scaleOf(r.time, 'v'), a: scaleOf(r.time, 'a'),
        vRad: scaleOf(r.samples, 'v'), aRad: scaleOf(r.samples, 'a'), F: scaleOf(r.forces.rows, 'F'), T: scaleOf(r.forces.rows, 'T') };
    }
    return scales;
  }

  const put = (key, text, unit) => { cells[key].val.textContent = text; cells[key].unit.textContent = unit === '°' ? unit : ` ${unit}`; };

  // Swap the play/pause icon only when the state changes. Replacing it on every
  // animation frame swallowed clicks: the press landed on the old icon and the
  // release on the new one, so the browser never fired a click.
  let shown = null;

  return {
    update() {
      if (shown !== app.playing) {
        shown = app.playing;
        play.replaceChildren(icon(shown ? ICONS.pause : ICONS.play, 20));
        play.setAttribute('aria-label', shown ? 'Pause' : 'Play');
      }
      if (document.activeElement !== angle) angle.value = +app.theta.toFixed(2);
      slider.value = app.theta;
      // values at this angle: in time at ω, or per radian when the plots show that
      const r = app.result(), U = app.units, sc = scalesFor(r);
      const { m, t, g, F, T } = valuesAt(app.doc, r, app.theta); // exact at θ, as the plot titles and the cam
      const perRad = app.ui.motionPerRad ? app.ui.motionPerRad() : false;
      put('s', showNum(U.L.show(t.s), U.L.show(sc.s)), U.L.label);
      if (perRad) {
        put('v', showNum(U.L.show(m.v), U.L.show(sc.vRad)), `${U.L.label}/rad`);
        put('a', showNum(U.L.show(m.a), U.L.show(sc.aRad)), `${U.L.label}/rad²`);
      } else {
        put('v', showNum(U.V.show(t.v), U.V.show(sc.v)), U.V.label);
        put('a', showNum(U.A.show(t.a), U.A.show(sc.a)), U.A.label);
      }
      // no pressure angle for a flat face, or for sizes that make no cam
      cells.phi.el.hidden = app.doc.follower.type === 'flat' || r.problems.some((p) => p.kind === 'size');
      put('phi', fmt((g.phi * 180) / Math.PI, 2), '°');
      // Advanced: cam force and torque here
      const adv = app.mode === 'advanced';
      cells.F.el.hidden = !adv; cells.T.el.hidden = !adv;
      if (adv) {
        put('F', showNum(U.F.show(F), U.F.show(sc.F)), U.F.label);
        put('T', showNum(U.T.show(T), U.T.show(sc.T)), U.T.label);
      }
      // the box's width: from the cells shown and their names and units only
      const shownCells = Object.values(cells).filter((x) => !x.el.hidden);
      const ch = shownCells.reduce((n, x) => n + x.el.firstChild.textContent.length + 1 + VALUE_CH + x.unit.textContent.length, 0);
      readout.style.width = `calc(${ch}ch + ${(shownCells.length - 1) * GAP_PX}px)`;
      readout.title = Object.values(cells).filter((x) => !x.el.hidden).map((x) => x.el.textContent.replace(/\s+/g, ' ')).join('   ');
    },
  };
}
