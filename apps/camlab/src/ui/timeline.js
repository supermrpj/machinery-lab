// =============================================================================
// timeline.js — cam angle, play, speed, and the values at this angle
// =============================================================================

import { h, icon, replaceChildren } from '../../../../packages/ui-kit/src/dom.js';
import { fmt, fmtSig, parseNum } from '../../../../packages/ui-kit/src/format.js';
import { ICONS } from './icons.js';
import { ANIMATION } from '../config.js';
import { evaluate, toTime } from '../model/program.js';
import { camPoint } from '../model/geometry.js';

export function buildTimeline(el, app) {
  const play = h('button', { class: 'play', title: 'Play or pause (Space)', 'aria-label': 'Play', onclick: () => app.play() });
  const angle = h('input', { type: 'number', step: 'any', 'aria-label': 'Cam angle θ in degrees',
    onchange: (e) => { const v = parseNum(e.target.value); if (v !== null) app.setTheta(v); } });
  const slider = h('input', { type: 'range', min: 0, max: 360, step: 0.25, 'aria-label': 'Cam angle',
    oninput: (e) => { app.play(false); app.setTheta(+e.target.value); } });
  const speed = h('select', { 'aria-label': 'Animation speed', onchange: (e) => { app.speed = +e.target.value; } },
    ANIMATION.speeds.map((s) => h('option', { value: s, selected: s === 1 }, `${s}×`)));
  const readout = h('span', { class: 'readout' });
  replaceChildren(el, play,
    h('span', { class: 'angle' }, 'θ', angle, '°'),
    slider,
    h('span', { class: 'label' }, 'Speed'), speed,
    readout);

  /** Cam force and torque at this angle (dynamics.js: Fc = m·a + c·v + k·s + Fpl, Tc = Fc·ds/dθ). */
  function forces(m, t) {
    const dy = app.doc.dynamics, U = app.units, c = app.result().forces.c;
    const F = (dy.m * t.a) / 1000 + c * t.v + dy.k * m.s + dy.preload;
    const T = (F * m.v) / 1000;
    return `   Fc ${fmtSig(U.F.show(F), 4)} ${U.F.label}   Tc ${fmtSig(U.T.show(T), 4)} ${U.T.label}`;
  }

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
      // values at this angle
      const r = app.result(), U = app.units;
      const m = evaluate(r.prep, app.theta);
      const t = toTime(m, r.omega);
      const g = camPoint(app.doc.follower, m, (app.theta * Math.PI) / 180);
      readout.textContent = `s ${fmtSig(U.L.show(t.s), 4)} ${U.L.label}   v ${fmtSig(U.V.show(t.v), 4)} ${U.V.label}   a ${fmtSig(U.A.show(t.a), 4)} ${U.A.label}`
        + (app.doc.follower.type === 'flat' ? '' : `   φ ${fmt((g.phi * 180) / Math.PI, 1)}°`)
        + (app.mode === 'advanced' ? forces(m, t) : '');
      readout.title = readout.textContent;
    },
  };
}
