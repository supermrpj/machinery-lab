// =============================================================================
// topbar.js — file actions, undo/redo, examples, units, tutorial, help
// =============================================================================

import { h, icon, replaceChildren } from '../../../../packages/ui-kit/src/dom.js';
import { ICONS } from './icons.js';
import { APP } from '../config.js';
import { EXAMPLES } from '../model/document.js';
import { UNIT_SYSTEMS } from '../model/units.js';
import { openExportDialog, openHelp, openAbout } from './dialogs.js';
import { modeSwitch } from '../../../../packages/ui-kit/src/mode.js';

/** A box that takes typed text (where the browser has its own undo). */
const isTextBox = (t) => !!t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(t.type)));

export function buildTopbar(el, app) {
  const btn = (ic, label, title, onclick, cls = 'tbtn') =>
    h('button', { class: cls, title, 'aria-label': title, onclick }, icon(ICONS[ic], 18), label ? h('span', { class: 'lbl' }, label) : null);

  const title = h('input', {
    class: 'doc-title', type: 'text', 'aria-label': 'Design name',
    onchange: (e) => app.edit('Rename', (d) => { d.meta.title = e.target.value.trim() || 'Untitled cam'; }),
  });
  const undo = btn('undo', '', 'Undo (Ctrl+Z)', () => app.undo());
  const redo = btn('redo', '', 'Redo (Ctrl+Y or Ctrl+Shift+Z)', () => app.redo());
  const examples = h('select', { class: 'tsel', 'aria-label': 'Open an example', onchange: (e) => {
    const id = e.target.value; e.target.value = '';
    if (id && confirmDiscard()) app.loadExample(id);
  } },
  h('option', { value: '' }, 'Examples…'),
  EXAMPLES.map((ex) => h('option', { value: ex.id }, ex.name)));
  const units = h('select', { class: 'tsel units', 'aria-label': 'Units', onchange: (e) => app.edit('Change units', (d) => { d.units = e.target.value; }) },
    Object.values(UNIT_SYSTEMS).map((u) => h('option', { value: u.key }, u.name)));
  const mode = modeSwitch(() => app.mode, (m) => app.setMode(m));

  replaceChildren(el,
    h('div', { class: 'brand' }, h('span', { class: 'brand-name' }, 'Cam', h('b', {}, 'Lab')), title),
    btn('file', 'New', 'New cam design', () => { if (confirmDiscard()) app.newDocument(); }),
    btn('open', 'Open', 'Open a saved design (Ctrl+O)', () => { if (confirmDiscard()) app.open(); }),
    btn('save', 'Save', 'Save the design (Ctrl+S)', () => app.save()),
    btn('saveAs', 'Save as', 'Save a copy under a new name (Ctrl+Shift+S)', () => app.save({ saveAs: true }), 'tbtn minor'),
    btn('export', 'Export', 'Export the cam with its mounting: STL for 3-D printing, STEP and DXF for CAD, data', () => openExportDialog(app)),
    h('span', { class: 'sep' }),
    undo, redo,
    h('span', { class: 'sep' }),
    examples, units,
    h('span', { class: 'spacer' }),
    btn('learn', 'Graphical method', 'Graphical method: draw this cam by hand, step by step (tutorial)', () => app.ui.openTutorial()),
    mode.el,
    btn('help', 'Help', 'How to use CamLab', () => openHelp(app)),
    h('button', { class: 'tbtn version', title: 'About CamLab and licence', onclick: () => openAbout() }, `v${APP.version}`),
  );

  // A box being typed in and not yet committed (no Enter, Tab or change yet)
  // keeps the browser's own text undo; once the value is committed, Ctrl+Z
  // undoes the design change even with the focus still in the box.
  const uncommitted = new WeakSet();
  document.addEventListener('input', (e) => { if (isTextBox(e.target)) uncommitted.add(e.target); }, true);
  document.addEventListener('change', (e) => uncommitted.delete(e.target), true);

  // keyboard: undo, redo, save, open, play
  window.addEventListener('keydown', (e) => {
    const typing = uncommitted.has(document.activeElement);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) app.redo(); else app.undo(); }
    else if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); app.redo(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); app.save({ saveAs: e.shiftKey }); }
    else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); if (confirmDiscard()) app.open(); }
    else if ((e.key === ' ' || e.key === 'Enter') && !mod && !document.querySelector('dialog[open]')) {
      // only when nothing that takes keys (a button, a box, a list) has the focus
      const a = document.activeElement;
      if (!a || a === document.body || a.tagName === 'CANVAS') { e.preventDefault(); app.play(); }
    }
  });

  let shownTitle = null; // the design name the box was last filled from

  function confirmDiscard() {
    // ask only when the design was changed since it was opened, made or saved
    return !app.dirty || window.confirm('Replace the current design? Unsaved changes will be lost (you can still undo).');
  }

  return {
    update() {
      // a name being typed stays; a name changed in the design (undo, redo, open) is shown even with the focus in the box
      const name = app.doc.meta.title || '';
      if (document.activeElement !== title || name !== shownTitle) title.value = name;
      shownTitle = name;
      undo.disabled = !app.undoStack.length;
      redo.disabled = !app.redoStack.length;
      units.value = app.doc.units || 'si';
      mode.update();
    },
  };
}
