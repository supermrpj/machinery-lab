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
  // On a phone the card starts folded to its title bar, so it does not cover
  // the drawing (a drag on a joint selects it, and the card would hide the
  // linkage under the finger); + opens it. On a wider screen only the
  // getting-started card (empty sheet, nothing selected) folds.
  // The fold button and the folding are styled for phones only (styles.css).
  const phone = () => typeof innerWidth === 'number' && innerWidth <= 720;
  let folded = phone();
  const fold = h('button', { class: 'props-fold', onclick: () => { folded = !folded; syncFold(); } });
  const card = h('section', { class: 'props-float', 'aria-label': 'Properties', hidden: true },
    h('header', {}, h('span', {}, 'Properties'), fold, close), body);
  function syncFold() {
    const start = !app.selection && app.tool.id === 'select'; // the getting-started card
    const foldable = start || phone();
    const f = folded && foldable;
    card.classList.toggle('folded', f);
    fold.hidden = !foldable;
    fold.textContent = f ? '+' : '−';
    fold.title = f ? (start ? 'Show getting started' : 'Show properties') : 'Fold to the title bar';
    fold.setAttribute('aria-label', fold.title);
    fold.setAttribute('aria-expanded', String(!f));
  }
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
        syncFold();
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
