// =============================================================================
// sidebar.js — the side panel: one tab at a time
// -----------------------------------------------------------------------------
//   Kinematics   input, output, positions, mobility (analysis.js)
//   Forces       statics and dynamics (forcesPanel.js)
//   Balancing    counterweights and the rotor calculator (balancePanel.js)
//   Tolerance    pin play and hole position error: path band (tolerancePanel.js)
//   Sheet        layers, units and grid, display sizes and colours (here)
// The tabs sit on a narrow rail at the right edge. Clicking the open tab (or
// the arrow in its header) hides the panel and gives the drawing the room;
// clicking any tab brings it back. Only the open tab is built and kept up to
// date. The tab and whether the panel is hidden are remembered in this browser.
// Basic mode hides the tabs in config.js MODE.advancedTabs.
// Properties floats on the drawing instead (propsFloat.js).
// =============================================================================

import { h, icon, replaceChildren } from '../../../../packages/ui-kit/src/dom.js';
import { ICONS } from '../drawing/tools/icons.js';
import { buildAnalysis } from './analysis.js';
import { buildForces } from './forcesPanel.js';
import { buildBalance } from './balancePanel.js';
import { buildTolerance } from './tolerancePanel.js';
import { dynamicsOf, counterweightsOn } from '../model/mass.js';
import { MODE, DISPLAY, THEME } from '../config.js';
import { isDefaultDisplay } from '../drawing/display.js';
import { LENGTH_UNITS, FORCE_UNITS, TORQUE_UNITS, MASS_UNITS, INERTIA_UNITS, UNIT_PRESETS, presetOf, unitsOf, gridLabel } from '../model/units.js';

const LAYER_NAMES = { mechanism: 'Mechanism', bodies: 'Outlines', construction: 'Construction', background: 'Background picture' };

// how often the open tab is rebuilt while things move (rebuilding costs layout time)
const PLAY_REBUILD_MS = 250;  // while the mechanism plays
const LIVE_PAUSE_MS = 150;    // while a joint is dragged: after the cursor pauses this long

const TABS = [
  { id: 'kinematics', label: 'Kinematics', title: 'Kinematics', icon: 'tabKinematics' },
  { id: 'forces', label: 'Forces', title: 'Forces', icon: 'force' },
  { id: 'balance', label: 'Balancing', title: 'Balancing', icon: 'tabBalance' },
  { id: 'tolerance', label: 'Tolerance', title: 'Tolerance', icon: 'tabTolerance' },
  { id: 'sheet', label: 'Sheet', title: 'Layers, units, grid and display', icon: 'tabSheet' },
];

// ---- remembered between visits (browser storage may be unavailable) ----
const STORE = 'linklab.side';
function loadState() {
  // on a phone the panel starts hidden, so the drawing has the room
  const phone = typeof innerWidth === 'number' && innerWidth <= 720;
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!v) return { tab: 'kinematics', hidden: phone };
    return { tab: TABS.some((t) => t.id === v.tab) ? v.tab : 'kinematics', hidden: !!v.hidden };
  } catch { return { tab: 'kinematics', hidden: phone }; }
}
function saveState(st) {
  try { localStorage.setItem(STORE, JSON.stringify(st)); } catch { /* not kept */ }
}

export function buildSidebar(el, app) {
  const st = loadState();

  // ---- the panel and the rail ----
  const title = h('h2', { class: 'side-title' });
  const body = h('div', { class: 'panel-body side-body', role: 'tabpanel', id: 'side-body' });
  const panel = h('div', { class: 'side-panel' },
    h('div', { class: 'side-head' }, title,
      h('button', { class: 'ibtn on', title: 'Hide the panel', 'aria-label': 'Hide the panel', onclick: () => setHidden(true) }, icon(ICONS.chevronRight, 18))),
    body);
  const tabButtons = new Map();
  const rail = h('div', { class: 'side-rail', role: 'tablist', 'aria-label': 'Panels', 'aria-orientation': 'vertical' },
    TABS.map((t) => {
      const b = h('button', {
        class: 'side-tab', role: 'tab', 'aria-controls': 'side-body', title: t.title,
        onclick: () => (t.id === st.tab && !st.hidden ? setHidden(true) : show(t.id)),
      }, icon(ICONS[t.icon], 20), h('span', { class: 'side-tab-label' }, t.label), h('span', { class: 'side-dot', hidden: true }));
      tabButtons.set(t.id, b);
      return b;
    }));
  replaceChildren(el, panel, rail);

  // the Sheet tab: Layers, Units and grid, then Display
  const layersBox = h('div', {}), sheetBox = h('div', {}), displayBox = h('div', {});

  /** Units shown everywhere (what is stored never changes), grid spacing, snap to grid. */
  // change units, then show the new lists at once (the select keeps focus, so the usual refresh skips this part)
  const setUnitsHere = (changes) => { app.setUnits(changes); renderSheet(); };

  function renderSheet() {
    const U = unitsOf(app.doc);
    const grid = (app.doc.units && app.doc.units.grid) || 0;
    const preset = presetOf(app.doc);
    const presetSel = h('select', { 'aria-label': 'Unit system', onchange: (e) => {
      const p = UNIT_PRESETS[e.target.value];
      if (p) setUnitsHere({ length: p.length, force: p.force, torque: p.torque, mass: p.mass, inertia: p.inertia, grid: p.length === U.key ? grid : 0 });
    } },
    Object.entries(UNIT_PRESETS).map(([k, p]) => h('option', { value: k, selected: k === preset }, p.name)),
    h('option', { value: 'custom', selected: preset === 'custom', disabled: true }, 'Custom (chosen one by one below)'));
    const pick = (label, table, key, current) => h('div', { class: 'field' }, h('label', {}, label),
      h('select', { 'aria-label': `${label} unit`, onchange: (e) => setUnitsHere({ [key]: e.target.value }) },
        Object.values(table).map((u) => h('option', { value: u.key, selected: u.key === current }, u.name))));
    const unitSel = h('select', { 'aria-label': 'Length unit', onchange: (e) => setUnitsHere({ length: e.target.value, grid: 0 }) },
      Object.values(LENGTH_UNITS).map((u) => h('option', { value: u.key, selected: u.key === U.key }, u.name)));
    const gridSel = h('select', { 'aria-label': 'Grid spacing', onchange: (e) => setUnitsHere({ grid: +e.target.value }) },
      h('option', { value: 0, selected: !grid }, 'Automatic (follows the zoom)'),
      U.grids.map((g) => h('option', { value: g, selected: Math.abs(g - grid) < 1e-12 }, gridLabel(U, g))));
    replaceChildren(sheetBox,
      h('div', { class: 'field' }, h('label', {}, 'Unit system'), presetSel),
      h('div', { class: 'field' }, h('label', {}, 'Length'), unitSel),
      pick('Force', FORCE_UNITS, 'force', U.F.key),
      pick('Torque', TORQUE_UNITS, 'torque', U.T.key),
      pick('Mass', MASS_UNITS, 'mass', U.M.key),
      pick('Moment of inertia', INERTIA_UNITS, 'inertia', U.I.key),
      h('div', { class: 'field' }, h('label', {}, 'Grid spacing'), gridSel),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!app.settings.snapGrid, onchange: (e) => { app.settings.snapGrid = e.target.checked; app._cache = {}; } }),
        ' Snap to grid lines'),
      h('p', { class: 'note' }, 'Units change what is shown and typed, the plots and the data exports (column names say which unit). Values are kept exactly, so switching back and forth changes nothing. DXF files for CAD are always in mm.'));
  }

  /** Text and arrow size, arrow colours: kept in this browser, not in the drawing (config.js DISPLAY). */
  function renderDisplay() {
    const d = app.display;
    const pct = (v) => `${Math.round(v * 100)} %`;
    const sizeSel = (label, key, list) => h('div', { class: 'field' }, h('label', {}, label),
      h('select', { 'aria-label': label, onchange: (e) => { app.setDisplay({ [key]: +e.target.value }); renderDisplay(); } },
        list.map((v) => h('option', { value: v, selected: v === d[key] }, pct(v) + (v === 1 ? ' (normal)' : '')))));
    const kinds = Object.keys(DISPLAY.colors).filter((k) => app.mode === 'advanced' || DISPLAY.basicColors.includes(k));
    const colorRow = (k) => h('div', { class: 'field color-field' },
      h('label', { for: `display-color-${k}` }, DISPLAY.colors[k]),
      h('input', { type: 'color', id: `display-color-${k}`, value: d.colors[k] || THEME[k],
        oninput: (e) => app.setDisplay({ colors: { [k]: e.target.value } }),
        onchange: () => renderDisplay() }),
      h('button', { class: 'ibtn', title: 'Default colour', 'aria-label': `Default colour: ${DISPLAY.colors[k]}`, hidden: !d.colors[k],
        onclick: () => { app.setDisplay({ colors: { [k]: '' } }); renderDisplay(); } }, '↺'));
    replaceChildren(displayBox,
      sizeSel('Text size', 'text', DISPLAY.textSizes),
      sizeSel('Arrow size', 'arrow', DISPLAY.arrowSizes),
      h('div', { class: 'field' }, h('label', {}, 'Angle axis ticks'),
        h('select', { 'aria-label': 'Angle axis ticks on the plots', onchange: (e) => { app.setDisplay({ angleStep: +e.target.value }); renderDisplay(); } },
          DISPLAY.angleSteps.map((v) => h('option', { value: v, selected: v === (d.angleStep || 0) }, v ? `every ${v}°` : 'Automatic (15°, 30°, 45°, 60°, 90°)')))),
      kinds.map(colorRow),
      h('div', { class: 'row-buttons' },
        h('button', { class: 'btn', disabled: isDefaultDisplay(d), onclick: () => { app.resetDisplay(); renderDisplay(); } }, 'Back to normal')),
      h('p', { class: 'note' }, 'Text size and angle ticks apply to the plots. Bigger text and arrows help on a projector (try 150 %). These settings stay on this computer; drawings and files do not change.'));
  }

  function renderLayers() {
    const L = app.doc.layers;
    const rows = Object.keys(LAYER_NAMES).map((name) => {
      const st = L[name];
      const toggle = (key, label) => h('button', {
        class: `ibtn ${st[key] ? 'on' : ''}`, title: label, 'aria-label': `${label}: ${LAYER_NAMES[name]}`, 'aria-pressed': String(!!st[key]),
        onclick: () => { st[key] = !st[key]; app._cache = {}; app.requestRender(); renderLayers(); },
      }, icon(key === 'visible' ? (st.visible ? ICONS.eye : ICONS.eyeOff) : key === 'locked' ? (st.locked ? ICONS.lock : ICONS.unlock) : ICONS.fade, 16));
      return h('div', { class: 'layer-row' },
        h('span', { class: `name ${st.visible ? '' : 'off'}` }, LAYER_NAMES[name]),
        toggle('visible', 'Show'), toggle('locked', 'Lock'), toggle('faded', 'Fade'));
    });
    replaceChildren(layersBox, rows);
  }

  const editing = () => el.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName);
  let lastBuild = 0, liveTimer = null;

  /** Build the open tab. */
  function render() {
    if (st.hidden) return;
    if (st.tab === 'kinematics') replaceChildren(body, buildAnalysis(app));
    else if (st.tab === 'forces') replaceChildren(body, buildForces(app));
    else if (st.tab === 'balance') replaceChildren(body, buildBalance(app));
    else if (st.tab === 'tolerance') replaceChildren(body, buildTolerance(app));
    else {
      renderLayers();
      if (!editing()) { renderSheet(); renderDisplay(); }
      if (!body.contains(layersBox)) {
        replaceChildren(body, h('div', { class: 'subhead' }, 'Layers'), layersBox, h('div', { class: 'subhead' }, 'Units and grid'), sheetBox,
          h('div', { class: 'subhead' }, 'Display'), displayBox);
      }
    }
  }

  /** Tabs: which is open; dots on Forces and Balancing when they are switched on. */
  function updateRail() {
    el.classList.toggle('collapsed', st.hidden);
    const t = TABS.find((x) => x.id === st.tab);
    title.textContent = t.title;
    for (const [id, b] of tabButtons) {
      const on = id === st.tab && !st.hidden;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    for (const [id, b] of tabButtons) b.hidden = app.mode === 'basic' && MODE.advancedTabs.includes(id);
    const doc = app.doc;
    const dots = {
      forces: dynamicsOf(doc).mode !== 'off',
      balance: counterweightsOn(doc) && doc.links.some((l) => (l.counterweights || []).length),
    };
    for (const [id, b] of tabButtons) {
      const dot = b.querySelector('.side-dot');
      dot.hidden = !dots[id];
      b.title = TABS.find((x) => x.id === id).title + (id === 'forces' && dots.forces ? ' (on)' : id === 'balance' && dots.balance ? ' (counterweights in use)' : '');
    }
  }

  function show(id) {
    if (app.mode === 'basic' && MODE.advancedTabs.includes(id)) id = 'kinematics';
    st.tab = id; st.hidden = false;
    saveState(st);
    body.scrollTop = 0;
    updateRail();
    render();
    app.requestRender(); // the drawing shows some tabs' extras (the Tolerance magnifier)
  }

  function setHidden(hidden) {
    st.hidden = hidden;
    saveState(st);
    updateRail();
    if (!hidden) render();
    app.requestRender();
  }

  if (app.mode === 'basic' && MODE.advancedTabs.includes(st.tab)) st.tab = 'kinematics';
  updateRail();

  return {
    /** Open a tab from elsewhere (e.g. a link in a note). */
    show,
    /** The tab open now, or null when the panel is hidden. */
    openTab: () => (st.hidden ? null : st.tab),
    update(what) {
      if (what === 'mode') {
        // a tab that Basic hides falls back to Kinematics (not remembered, so Advanced brings it back)
        if (app.mode === 'basic' && MODE.advancedTabs.includes(st.tab)) st.tab = 'kinematics';
        updateRail(); render();
        return;
      }
      if (what === 'doc' || what === 'selection' || what === 'tool') {
        clearTimeout(liveTimer);
        updateRail();
        // Balancing runs the force analysis over the cycle twice: only when the mechanism changes
        if (st.tab !== 'balance' || what === 'doc') render();
        return;
      }
      if (what === 'pose' || what === 'live' || what === 'motion' || what === 'play') {
        if (st.hidden || st.tab === 'sheet') return;
        if (st.tab === 'balance' && what !== 'motion') return;
        // dragging the design: rebuild once the drag pauses (and again when it ends, 'doc')
        if (what === 'live') {
          clearTimeout(liveTimer);
          liveTimer = setTimeout(() => { if (!editing()) render(); }, LIVE_PAUSE_MS);
          return;
        }
        // playing: a few times a second is as fast as numbers can be read
        const now = performance.now();
        if (what === 'pose' && app.playing && now - lastBuild < PLAY_REBUILD_MS) return;
        lastBuild = now;
        if (!editing()) render();
      }
    },
  };
}
