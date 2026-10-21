// =============================================================================
// toolbar.js — the vertical tool strip (grouped: Draw, Mechanism, Background)
// =============================================================================

import { h, icon, replaceChildren } from '../../../../packages/ui-kit/src/dom.js';
import { ICONS } from '../drawing/tools/icons.js';

export function buildToolbar(el, app) {
  const buttons = new Map();
  const items = [];
  let group = null;
  for (const t of app.tools) {
    if (group !== null && t.group !== group) items.push(h('div', { class: 'tool-group-gap', role: 'separator' }));
    group = t.group;
    const b = h('button', {
      class: t.advanced ? 'tool advanced-only' : 'tool', title: `${t.label} (${t.shortcut})`, 'aria-label': `${t.label}, key ${t.shortcut}`,
      onclick: () => app.setTool(t.id),
    }, icon(ICONS[t.icon], 22), h('span', { class: 'key' }, t.shortcut));
    buttons.set(t.id, b);
    items.push(b);
  }
  replaceChildren(el, items);
  return {
    update() {
      for (const [id, b] of buttons) {
        b.classList.toggle('active', app.tool.id === id);
        b.setAttribute('aria-pressed', app.tool.id === id ? 'true' : 'false');
      }
    },
  };
}
