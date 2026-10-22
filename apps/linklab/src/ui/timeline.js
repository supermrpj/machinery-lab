// =============================================================================
// timeline.js — play / step / input value / speed / lock lengths
// -----------------------------------------------------------------------------
// The input is an angle (degrees) for a motor, or a length (mm) for a linear
// actuator, slider or prismatic joint. The labels follow the input.
// =============================================================================

import { h, icon, replaceChildren } from '../../../../packages/ui-kit/src/dom.js';
import { parseNum } from '../../../../packages/ui-kit/src/format.js';
import { ICONS } from '../drawing/tools/icons.js';
import { ANIMATION } from '../config.js';

/** Symbol and unit of the current input, e.g. { sym: 'θ₂', unit: '°' }. */
export function inputLabel(app) {
  const d = app.doc.driver || {};
  if (!app.sim.inputIsAngle) return { sym: 's', unit: app.units.label, name: 'input stroke' };
  if (d.ref) return { sym: 'θ', unit: '°', name: 'motor angle (between the two links)' };
  return { sym: 'θ₂', unit: '°', name: 'input angle' };
}

export function buildTimeline(el, app) {
  const play = h('button', { class: 'play', title: 'Play / pause (Enter)', 'aria-label': 'Play or pause', onclick: () => app.play() });
  const back = h('button', { class: 'ibtn', title: 'Step back (←, Shift for 10×)', 'aria-label': 'Step back', onclick: () => app.stepInput(-1) }, icon(ICONS.stepBack, 18));
  const fwd = h('button', { class: 'ibtn', title: 'Step forward (→, Shift for 10×)', 'aria-label': 'Step forward', onclick: () => app.stepInput(1) }, icon(ICONS.stepFwd, 18));
  const home = h('button', { class: 'ibtn', title: 'Back to the drawn position', 'aria-label': 'Back to the drawn position', onclick: () => app.resetPose() }, icon(ICONS.home, 18));
  const range = h('input', {
    type: 'range', min: -180, max: 180, step: 'any', 'aria-label': 'Input',
    // read the value first: stopping the animation redraws the timeline, which resets the slider
    oninput: (e) => { const v = +e.target.value; app.play(false); app.setInput(v, true); },
  });
  const value = h('input', {
    type: 'number', step: 'any', 'aria-label': 'Input value',
    // a value out of reach moves to the nearest one: show where it went
    onchange: (e) => {
      const v = parseNum(e.target.value);
      if (v !== null) { app.play(false); app.setInput(v); }
      if (app.sim.drivable) e.target.value = app.inputShown().toFixed(app.sim.inputIsAngle ? 2 : app.units.digits);
    },
  });
  const sym = h('span', { class: 'label' });
  const unit = h('span', {});
  const speed = h('select', { 'aria-label': 'Animation speed', onchange: (e) => { app.speed = +e.target.value; } },
    ANIMATION.speeds.map((s) => h('option', { value: s, selected: s === 1 }, `${s}×`)));
  const limit = h('span', { class: 'chip', hidden: true }, 'Limit position');
  const lock = h('button', { class: 'lockbtn', 'aria-pressed': 'false', onclick: () => app.setLock(!app.doc.lockDesign) });
  replaceChildren(el,
    play, back, fwd, home,
    sym, h('div', { class: 'angle' }, value, unit),
    range,
    limit,
    lock,
    h('span', { class: 'label' }, 'Speed'), speed,
  );

  let lastPlay = '', lastLock = null;
  return {
    update() {
      const can = app.sim.drivable;
      play.disabled = !can;
      back.disabled = fwd.disabled = range.disabled = value.disabled = !can;
      const p = app.playing ? ICONS.pause : ICONS.play;
      if (p !== lastPlay) { replaceChildren(play, icon(p, 18)); lastPlay = p; }
      const lab = inputLabel(app);
      sym.textContent = lab.sym;
      unit.textContent = lab.unit;
      const s = can ? app.sim.getSweep() : null;
      const angle = app.sim.inputIsAngle;
      if (s && !s.fullTurn) {
        range.min = app.inputDisplay(s.limits[0]).toFixed(3);
        range.max = app.inputDisplay(s.limits[1]).toFixed(3);
      } else { range.min = 0; range.max = 360; }
      const shown = app.inputShown();
      range.value = shown;
      if (document.activeElement !== value) value.value = can ? shown.toFixed(angle ? 2 : app.units.digits) : '';
      // at a toggle (input limit) or stationary (output limit) position?
      const sp = app.settings.specialPositions ? app.sim.special : null;
      const text = sp ? (sp.kind === 'toggle' ? 'Toggle position' : 'Stationary position') : app.sim.limitHit ? 'Limit position' : '';
      if (limit.textContent !== text) limit.textContent = text;
      limit.title = sp && sp.kind === 'toggle' ? 'The input is at its limit: it turns back while the mechanism flips to its other assembly.'
        : sp ? 'The output is momentarily at rest: it reaches its extreme and turns back.' : 'The input cannot move further this way.';
      limit.classList.toggle('stationary', !!sp && sp.kind === 'stationary');
      limit.hidden = !text;
      const locked = !!app.doc.lockDesign;
      if (locked !== lastLock) {
        replaceChildren(lock, icon(locked ? ICONS.lock : ICONS.unlock, 16), locked ? 'Lengths locked' : 'Lengths free');
        lock.classList.toggle('on', locked);
        lock.setAttribute('aria-pressed', String(locked));
        lock.title = locked
          ? 'Lengths are locked: dragging a joint moves the mechanism. Click to allow editing.'
          : 'Dragging a joint changes the design. Click to lock all lengths.';
        lastLock = locked;
      }
    },
  };
}
