// =============================================================================
// propsFloat.js — the Properties card, floating at the top right of the drawing
// -----------------------------------------------------------------------------
// It appears when something is selected (or a tool has settings, or the sheet
// is empty: then it shows how to start) and hides when nothing is. × clears
// the selection. The contents come from properties.js.
// =============================================================================

import { h, replaceChildren } from '../../../../packages/ui-kit/src/dom.js';
import { buildProperties, hasProperties } from './properties.js';

export function buildPropsFloat(stage, app) {
  const body = h('div', { class: 'props-body' });
  let dismissed = false; // the getting-started card was closed
  const close = h('button', {
    class: 'props-x', title: 'Close (Esc)', 'aria-label': 'Close properties',
    onclick: () => {
      if (app.selection) app.select(null);
      else if (app.tool.id !== 'select') app.setTool('select');
      else { dismissed = true; card.hidden = true; } // the getting-started card on an empty sheet
    },
  }, '×');
  const card = h('section', { class: 'props-float', 'aria-label': 'Properties', hidden: true },
    h('header', {}, h('span', {}, 'Properties'), close), body);
  // clicks and drags on the card must not reach the drawing underneath
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  card.addEventListener('wheel', (e) => e.stopPropagation());
  stage.append(card);

  // do not rebuild under the student's fingers while a field is being typed in
  const editing = () => card.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);

  /**
   * Top right, unless that would cover the point just clicked (the selected
   * item would vanish under the card, and a double-click would land on it):
   * then top left.
   */
  function place() {
    const p = app.lastPointer;
    card.classList.remove('left');
    if (!p) return;
    const covers = p.x > stage.clientWidth - card.offsetWidth - 24 && p.y < card.offsetHeight + 24;
    card.classList.toggle('left', covers);
  }

  return {
    update(what) {
      if (what === 'doc' || what === 'selection' || what === 'tool') {
        const show = hasProperties(app) && !(dismissed && !app.selection && app.tool.id === 'select');
        card.hidden = !show;
        if (show && !editing()) replaceChildren(body, buildProperties(app));
        if (show && what !== 'doc') place();
        return;
      }
      // a joint's position changes as the mechanism moves
      if ((what === 'pose' || what === 'live') && !card.hidden && app.selection && app.selection.kind === 'joint' && !editing()) {
        replaceChildren(body, buildProperties(app));
      }
    },
  };
}
