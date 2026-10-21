// =============================================================================
// topbar.js — file actions, undo/redo, view toggles, help
// =============================================================================

import { h, icon, replaceChildren } from '../../../../packages/ui-kit/src/dom.js';
import { ICONS } from '../drawing/tools/icons.js';
import { APP } from '../config.js';
import { modeSwitch } from '../../../../packages/ui-kit/src/mode.js';

export function buildTopbar(el, app, dialogs) {
  const btn = (ic, label, title, onclick, opts = {}) =>
    h('button', { class: 'tbtn', title, 'aria-label': title, onclick, ...opts }, icon(ICONS[ic], 18), label ? h('span', { class: 'lbl' }, label) : null);

  const title = h('input', {
    class: 'doc-title', type: 'text', 'aria-label': 'Drawing name',
    onchange: (e) => { app.doc.meta.title = e.target.value.trim() || 'Untitled mechanism'; },
  });
  const undo = btn('undo', '', 'Undo (Ctrl+Z)', () => app.undo());
  const redo = btn('redo', '', 'Redo (Ctrl+Y)', () => app.redo());
  const grid = btn('grid', 'Grid', 'Show or hide the grid', () => { app.settings.grid = !app.settings.grid; app.requestRender(); update(); }, { class: 'tbtn minor' });
  const names = btn('tag', 'Names', 'Show or hide joint names (J1, J2, …), as used in the exported data', () => { app.settings.jointNames = !app.settings.jointNames; app.requestRender(); update(); }, { class: 'tbtn minor' });
  const plots = btn('plot', 'Plots', 'Show or hide the plots', () => app.ui.togglePlots());
  const mode = modeSwitch(() => app.mode, (m) => app.setMode(m));

  replaceChildren(el,
    h('div', { class: 'brand' }, h('span', { class: 'brand-name' }, 'Link', h('b', {}, 'Lab')), title),
    btn('file', 'New', 'New drawing', () => { if (confirmDiscard(app)) app.newDocument(); }),
    btn('open', 'Open', 'Open a saved drawing (Ctrl+O)', () => app.open()),
    btn('save', 'Save', 'Save the drawing (Ctrl+S). The first time, choose where to keep it.', () => app.save()),
    btn('saveAs', 'Save as', 'Save a copy under a new name or in another folder (Ctrl+Shift+S)', () => app.save({ saveAs: true }), { class: 'tbtn minor' }),
    btn('export', 'Export', 'Export for CAD (DXF), picture or data', () => dialogs.exportDialog(app)),
    h('span', { class: 'sep' }),
    undo, redo,
    btn('clear', 'Clear', 'Clear the sheet: everything, or only the construction, mechanism or picture', () => dialogs.clearDialog(app), { class: 'tbtn minor' }),
    h('span', { class: 'sep' }),
    grid,
    names,
    btn('fit', 'Fit', 'Fit the drawing in the window (F)', () => app.fitView(), { class: 'tbtn minor' }),
    plots,
    h('span', { class: 'spacer' }),
    mode.el,
    btn('help', 'Help', 'How to use LinkLab', () => dialogs.help(app)),
    h('button', { class: 'tbtn version', title: 'About LinkLab and licence', onclick: () => dialogs.about() }, `v${APP.version}`),
  );

  function update() {
    if (document.activeElement !== title) title.value = app.doc.meta.title || '';
    undo.disabled = !app.history.canUndo();
    redo.disabled = !app.history.canRedo();
    grid.classList.toggle('on', app.settings.grid);
    names.classList.toggle('on', app.settings.jointNames);
    plots.classList.toggle('on', app.ui.plotsOpen());
    mode.update();
  }
  return { update };
}

function confirmDiscard(app) {
  const d = app.doc;
  if (!d.joints.length && !d.construction.length && !d.bodies.length) return true;
  return window.confirm('Start a new drawing? Unsaved changes to this one will be lost (you can still undo).');
}
