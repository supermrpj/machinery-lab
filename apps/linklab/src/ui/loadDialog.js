// =============================================================================
// loadDialog.js — the popup for an external force or torque
// -----------------------------------------------------------------------------
// Opened by double-clicking a force or torque on the drawing, from its
// right-click menu, or from the Loads table in the Forces panel. It shows the
// same editor as Properties; every change applies at once (Ctrl+Z undoes it).
// =============================================================================

import { h } from '../../../../packages/ui-kit/src/dom.js';
import { loadProps } from './properties.js';

export function openLoadDialog(app, loadId) {
  const find = () => (app.doc.loads || []).find((x) => x.id === loadId);
  const f = find();
  if (!f) return;
  app.select({ kind: 'load', id: loadId });
  const n = app.doc.loads.indexOf(f) + 1;

  const title = h('h2', {});
  const body = h('div', { class: 'dlg-body' });
  const d = h('dialog', { class: 'load-dlg', 'aria-label': 'Force or torque' },
    h('div', { class: 'dlg-head' }, title,
      h('button', { class: 'btn', onclick: () => d.close() }, 'Done')),
    body,
    h('div', { class: 'dlg-body row-buttons dlg-actions', style: { paddingTop: 0 } },
      h('button', { class: 'btn danger', onclick: () => { d.close(); app.select({ kind: 'load', id: loadId }); app.deleteSelection(); } }, 'Delete'),
      h('button', { class: 'btn primary', onclick: () => d.close() }, 'Done')));
  d.addEventListener('close', () => d.remove());

  function render() {
    const now = find();
    if (!now) { if (d.open) d.close(); return; }
    title.textContent = `${now.kind === 'torque' ? 'Torque' : 'Force'} ${n} on link ${app.linkNumbers().get(now.link)}`;
    body.replaceChildren(loadProps(app, loadId, {
      inDialog: true,
      // step aside while the point of action is picked on the drawing
      beforePick: () => d.close(),
      afterPick: () => openLoadDialog(app, loadId),
    }) || '');
  }
  // every change is applied straight away; show the new values after it
  const refresh = () => setTimeout(() => { if (d.isConnected) render(); }, 0);
  body.addEventListener('change', refresh);
  render();
  document.body.append(d);
  d.showModal();
}
