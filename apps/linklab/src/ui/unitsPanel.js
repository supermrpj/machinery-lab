// =============================================================================
// unitsPanel.js — units and grid: the Units menu in the top bar, and its window
// -----------------------------------------------------------------------------
//   Units menu (top bar, Basic and Advanced): the unit systems (SI mm, SI m,
//                US in, US ft), and "Units and grid…" for the rest
//   window       the unit system, each unit on its own (length, force,
//                torque, mass, moment of inertia), grid spacing, snap to grid
// Units change only what is shown and typed; what is stored never changes
// (model/units.js). They are saved with the drawing.
// =============================================================================

import { h, replaceChildren } from '../../../../packages/ui-kit/src/dom.js';
import { LENGTH_UNITS, FORCE_UNITS, TORQUE_UNITS, MASS_UNITS, INERTIA_UNITS, UNIT_PRESETS, presetOf, unitsOf, gridLabel } from '../model/units.js';

const MORE = 'more';   // the menu entry that opens the window

/** Change to a unit system, keeping the grid spacing only if the length unit stays. */
function applyPreset(app, key) {
  const p = UNIT_PRESETS[key];
  if (!p) return;
  const U = unitsOf(app.doc);
  const grid = (app.doc.units && app.doc.units.grid) || 0;
  app.setUnits({ length: p.length, force: p.force, torque: p.torque, mass: p.mass, inertia: p.inertia, grid: p.length === U.key ? grid : 0 });
}

/** The Units menu for the top bar: { el, update }. */
export function unitsMenu(app) {
  const el = h('select', {
    class: 'tsel', 'aria-label': 'Units', title: 'Units shown and typed (saved with the drawing). Units and grid… sets each unit and the grid.',
    onchange: (e) => {
      const v = e.target.value;
      if (v === MORE) { update(); openUnits(app); } else applyPreset(app, v);
    },
  });
  function update() {
    const preset = presetOf(app.doc);
    replaceChildren(el,
      Object.entries(UNIT_PRESETS).map(([k, p]) => h('option', { value: k, selected: k === preset, title: p.name }, p.short)),
      preset === 'custom' ? h('option', { value: 'custom', selected: true, disabled: true }, 'Custom') : null,
      h('option', { value: MORE }, 'Units and grid…'));
  }
  update();
  return { el, update };
}

/** The window with every unit, the grid spacing and snapping. */
export function openUnits(app) {
  const body = h('div', { class: 'dlg-body units-body' });
  const d = h('dialog', { 'aria-label': 'Units and grid' },
    h('div', { class: 'dlg-head' }, h('h2', {}, 'Units and grid'), h('button', { class: 'btn', onclick: () => d.close() }, 'Close')),
    body);
  d.addEventListener('close', () => d.remove());

  // change, then show the new lists at once
  const set = (changes) => { app.setUnits(changes); render(); };

  function render() {
    const U = unitsOf(app.doc);
    const grid = (app.doc.units && app.doc.units.grid) || 0;
    const preset = presetOf(app.doc);
    const presetSel = h('select', { 'aria-label': 'Unit system', onchange: (e) => { applyPreset(app, e.target.value); render(); } },
      Object.entries(UNIT_PRESETS).map(([k, p]) => h('option', { value: k, selected: k === preset }, p.name)),
      h('option', { value: 'custom', selected: preset === 'custom', disabled: true }, 'Custom (chosen one by one below)'));
    const pick = (label, table, key, current) => h('div', { class: 'field' }, h('label', {}, label),
      h('select', { 'aria-label': `${label} unit`, onchange: (e) => set({ [key]: e.target.value }) },
        Object.values(table).map((u) => h('option', { value: u.key, selected: u.key === current }, u.name))));
    const unitSel = h('select', { 'aria-label': 'Length unit', onchange: (e) => set({ length: e.target.value, grid: 0 }) },
      Object.values(LENGTH_UNITS).map((u) => h('option', { value: u.key, selected: u.key === U.key }, u.name)));
    const gridSel = h('select', { 'aria-label': 'Grid spacing', onchange: (e) => set({ grid: +e.target.value }) },
      h('option', { value: 0, selected: !grid }, 'Automatic (follows the zoom)'),
      U.grids.map((g) => h('option', { value: g, selected: Math.abs(g - grid) < 1e-12 }, gridLabel(U, g))));
    replaceChildren(body,
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
  render();
  document.body.append(d);
  d.showModal();
  return d;
}
