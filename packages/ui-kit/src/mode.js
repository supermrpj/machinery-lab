// =============================================================================
// mode.js — the Basic | Advanced switch shared by the apps
// -----------------------------------------------------------------------------
// Basic shows what a first lesson needs; Advanced adds the analysis panels.
// Every drawing and design tool works in both. The choice is remembered on
// this computer (localStorage), one key per app.
//
//   const mode = loadMode('camlab.mode');            'basic' | 'advanced'
//   saveMode('camlab.mode', 'advanced');
//   const sw = modeSwitch(() => app.mode, (m) => app.setMode(m));
//   topbar.append(sw.el);  …  sw.update();
// =============================================================================

import { h } from './dom.js';
import { safeStorage } from './files.js';

export const MODES = ['basic', 'advanced'];
const NAMES = { basic: 'Basic', advanced: 'Advanced' };
const TIPS = {
  basic: 'Basic: the main views only, for learning the method',
  advanced: 'Advanced: every analysis panel and view',
};

export function loadMode(key, fallback = 'basic') {
  const m = safeStorage.get(key);
  return MODES.includes(m) ? m : fallback;
}

export function saveMode(key, mode) { safeStorage.set(key, mode); }

/** Two joined buttons; `get()` gives the current mode, `set(mode)` changes it. */
export function modeSwitch(get, set) {
  const buttons = MODES.map((m) => h('button', {
    type: 'button', class: 'mode-btn', title: TIPS[m], 'aria-pressed': 'false',
    onclick: () => { if (get() !== m) set(m); },
  }, NAMES[m]));
  const el = h('div', { class: 'mode-switch', role: 'group', 'aria-label': 'Interface mode' }, buttons);
  const update = () => MODES.forEach((m, i) => {
    const on = get() === m;
    buttons[i].classList.toggle('on', on);
    buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  update();
  return { el, update };
}
