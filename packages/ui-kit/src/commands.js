// =============================================================================
// commands.js — "Find a command": a search box over everything the app can do
// -----------------------------------------------------------------------------
// Each app lists its commands (apps/<app>/src/ui/commands.js):
//   { label: 'Ground pivot',        the name shown, as on the button
//     group: 'Mechanism tool',      where it belongs (shown small)
//     key:   'G',                   its keyboard shortcut, if it has one
//     words: 'fixed pin frame',     other words people may type for it
//     run:   () => …  }             what choosing it does
//
//   const search = commandSearch(() => commands);
//   search.open();                        the window: type, ↑ ↓, Enter
//   bindCommandKeys(search.open);         Ctrl+K anywhere, "/" when not typing
//
// With nothing typed the window lists every command, so it also works as a
// list of what the app can do. packages/ui-kit/tests/commands.test.js checks
// findCommands().
// =============================================================================

import { h, replaceChildren } from './dom.js';

// ---- CONFIG -------------------------------------------------------------------
const SCORE = { labelStart: 15, label: 10, key: 8, words: 4, group: 2, inside: 1 };
export const COMMAND_KEYS = 'Ctrl+K or /';
// -------------------------------------------------------------------------------

const wordsOf = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}+]+/u).filter(Boolean);
/** Does a word of `text` start with `w`? */
const starts = (text, w) => wordsOf(text).some((x) => x.startsWith(w));

/**
 * The commands that fit what was typed, best first. Every word typed must be
 * found in a command: in its label (counts most), its key, its other words
 * or its group. Nothing typed gives every command in its own order.
 */
export function findCommands(commands, query) {
  const typed = wordsOf(query);
  if (!typed.length) return [...commands];
  const whole = typed.join(' ');
  const found = [];
  commands.forEach((c, order) => {
    const label = c.label.toLowerCase();
    let score = label.startsWith(whole) ? SCORE.labelStart : 0;
    for (const w of typed) {
      let s = 0;
      if (starts(c.label, w)) s = SCORE.label;
      else if (c.key && c.key.toLowerCase() === w) s = SCORE.key;
      else if (starts(c.words, w)) s = SCORE.words;
      else if (starts(c.group, w)) s = SCORE.group;
      else if (`${label} ${String(c.words || '').toLowerCase()}`.includes(w)) s = SCORE.inside;
      if (!s) return;   // this word is nowhere in the command
      score += s;
    }
    found.push({ c, score, order });
  });
  return found.sort((a, b) => b.score - a.score || a.order - b.order).map((f) => f.c);
}

/** The search window. `getCommands()` is called each time it opens. */
export function commandSearch(getCommands) {
  let dlg = null;

  function open() {
    if (dlg || document.querySelector('dialog[open]')) return;   // one window at a time
    const commands = getCommands();
    let shown = [], at = 0;
    const input = h('input', {
      type: 'search', class: 'cmd-input', placeholder: 'Type what you want to do: slider, export, forces…',
      'aria-label': 'Find a command', autocomplete: 'off', spellcheck: false,
    });
    const list = h('ul', { class: 'cmd-list', role: 'listbox', 'aria-label': 'Commands' });
    const none = h('p', { class: 'cmd-none', hidden: true }, 'No command fits. Try another word.');
    dlg = h('dialog', { class: 'cmd-dlg', 'aria-label': 'Find a command' },
      input, list, none,
      h('p', { class: 'cmd-foot' }, h('kbd', {}, '↑'), ' ', h('kbd', {}, '↓'), ' move · ', h('kbd', {}, 'Enter'), ' choose · ', h('kbd', {}, 'Esc'), ' close'));

    const choose = (c) => { dlg.close(); c.run(); };   // close first: the command may open its own window
    const mark = () => [...list.children].forEach((li, i) => {
      li.setAttribute('aria-selected', i === at ? 'true' : 'false');
      if (i === at) li.scrollIntoView({ block: 'nearest' });
    });
    const fill = () => {
      shown = findCommands(commands, input.value);
      at = 0;
      replaceChildren(list, shown.map((c, i) => h('li', {
        role: 'option', class: 'cmd-item',
        onclick: () => choose(c), onpointermove: () => { if (at !== i) { at = i; mark(); } },
      }, h('span', { class: 'cmd-label' }, c.label), h('span', { class: 'cmd-group' }, c.group || ''), c.key ? h('kbd', {}, c.key) : null)));
      none.hidden = shown.length > 0;
      mark();
    };
    input.addEventListener('input', fill);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (shown.length) { at = (at + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length; mark(); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (shown[at]) choose(shown[at]);
      } else if (e.key === 'Escape') {
        e.preventDefault();   // a search box would first only clear its text
        dlg.close();
      }
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });   // a click outside the box
    dlg.addEventListener('close', () => { dlg.remove(); dlg = null; });
    document.body.append(dlg);
    dlg.showModal();
    fill();
    input.focus();
  }

  return { open };
}

/** Ctrl+K (or ⌘K) anywhere, and "/" when no box is being typed in, call `open`. */
export function bindCommandKeys(open) {
  window.addEventListener('keydown', (e) => {
    const t = e.target, tag = (t && t.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
    const ctrlK = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k';
    const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing;
    if (ctrlK || slash) { e.preventDefault(); open(); }
  });
}
