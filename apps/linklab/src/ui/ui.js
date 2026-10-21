// =============================================================================
// ui.js — builds every panel and routes refresh requests to them
// -----------------------------------------------------------------------------
// The app calls ui.refresh(app, what) with what = 'doc' | 'selection' |
// 'tool' | 'pose' | 'live' | 'motion' | 'play' | 'hint'.
// Basic | Advanced (app.mode) changes go through ui.modeChanged().
// =============================================================================

import { h } from '../../../../packages/ui-kit/src/dom.js';
import { parseNum } from '../../../../packages/ui-kit/src/format.js';
import { buildTopbar } from './topbar.js';
import { buildToolbar } from './toolbar.js';
import { buildSidebar } from './sidebar.js';
import { buildPropsFloat } from './propsFloat.js';
import { buildTimeline } from './timeline.js';
import { buildPlots } from './plots.js';
import { dialogs } from './dialogs.js';
import { createGuides } from './guides.js';
import { EXAMPLES } from '../model/examples.js';
import { openQuickMenu, closeQuickMenu } from './quickmenu.js';
import { openLoadDialog } from './loadDialog.js';
import { MODE } from '../config.js';

const HINT_STORE = 'linklab.hintShort';
function hintShort() { try { return localStorage.getItem(HINT_STORE) === '1'; } catch { return false; } }
function setHintShort(on) { try { localStorage.setItem(HINT_STORE, on ? '1' : '0'); } catch { /* not kept */ } }

export function createUI(elements) {
  const els = elements;
  let parts = null;
  let app = null;
  let toastTimer = null;
  let lastHintKey = null;
  // while a joint is dragged the plots are redrawn at most every PLOT_DRAG_MS,
  // always ending with the latest state
  const PLOT_DRAG_MS = 100;
  let plotTimer = null, lastPlots = 0;
  const plotsWhileDragging = () => {
    clearTimeout(plotTimer);
    const wait = PLOT_DRAG_MS - (performance.now() - lastPlots);
    const run = () => { parts.plots.update(false); lastPlots = performance.now(); };
    if (wait <= 0) run(); else plotTimer = setTimeout(run, wait);
  };

  const ui = {
    attach(theApp) {
      app = theApp;
      parts = {
        topbar: buildTopbar(els.topbar, app, dialogs),
        toolbar: buildToolbar(els.toolbar, app),
        sidebar: buildSidebar(els.sidebar, app),
        timeline: buildTimeline(els.timeline, app),
        plots: buildPlots(els.plots, app),
        props: buildPropsFloat(els.stage, app),
      };
      ui.guides = createGuides(els.stage, app);
      document.body.classList.toggle('mode-basic', app.mode === 'basic');
      ui.refresh(app, 'doc');
    },

    /** Plots follow Sheet › Display › Text size. */
    restylePlots() { if (parts) parts.plots.restyle(); },

    refresh(a, what) {
      if (!parts) return;
      if (what !== 'hint') { parts.sidebar.update(what); parts.props.update(what); }
      if (['doc', 'tool', 'selection', 'play'].includes(what)) { parts.topbar.update(); parts.toolbar.update(); }
      parts.timeline.update();
      if (what === 'live') plotsWhileDragging();
      else if (what !== 'hint' && what !== 'tool') { clearTimeout(plotTimer); parts.plots.update(what === 'motion'); lastPlots = performance.now(); }
      ui.renderHint();
    },

    /**
     * The hint card. Rebuilt only when its text changes, so its buttons stay
     * clickable while the mechanism plays (refresh runs every frame then).
     */
    renderHint() {
      const short = hintShort(); // the hint can be shrunk to the tool's name (remembered in this browser)
      const text = app._pick ? null : app.tool.hint(app);
      const key = app._pick ? `pick|${app._pick.prompt}` : `${app.tool.id}|${short}|${text instanceof Node ? text.textContent : text}`;
      if (key === lastHintKey) return;
      lastHintKey = key;
      els.hint.innerHTML = '';
      if (app._pick) { els.hint.append(h('b', {}, 'Pick a point: '), app._pick.prompt); return; }
      els.hint.append(h('b', {}, app.tool.label + (short ? '' : ': ')));
      if (!short) els.hint.append(text);
      if (ui.guides && ui.guides.has(app.tool.id)) {
        els.hint.append(h('button', { class: 'hint-guide', title: `Show how to use ${app.tool.label}`, onclick: () => ui.guides.open(app.tool.id) }, 'Guide'));
      }
      els.hint.append(h('button', {
        class: 'hint-toggle', title: short ? 'Show the hint' : 'Shrink the hint', 'aria-label': short ? 'Show the hint' : 'Shrink the hint',
        onclick: () => { setHintShort(!short); ui.refresh(app, 'hint'); },
      }, short ? '+' : '−'));
    },

    /** Open a side-panel tab: 'kinematics', 'forces', 'balance' or 'sheet' (Advanced tabs switch to Advanced). */
    showPanel(id) {
      if (app.mode === 'basic' && MODE.advancedTabs.includes(id)) app.setMode('advanced');
      parts.sidebar.show(id);
    },

    /** Is the Tolerance tab open (the drawing then shows its magnifier)? */
    toleranceOpen: () => parts.sidebar && parts.sidebar.openTab() === 'tolerance',

    /** Basic or Advanced was chosen: show or hide the analysis panels. */
    modeChanged() {
      document.body.classList.toggle('mode-basic', app.mode === 'basic');
      parts.sidebar.update('mode');
      parts.props.update('selection');
      parts.topbar.update();
      parts.plots.update(true);
      ui.flash(app.mode === 'basic' ? 'Basic: drawing and kinematics. Force analysis is in Advanced.' : 'Advanced: forces, balancing and link masses are shown.');
    },

    /** The tool changed: show its guide the first time. */
    toolActivated(tool) { if (ui.guides) ui.guides.toolActivated(tool); },

    pointer(p, kind) {
      const u = app.units;
      els.coords.textContent = `x ${u.num(p.x)}  y ${u.num(p.y)} ${u.label}${kind ? '  · ' + kind : ''}`.replace(/-/g, '−');
    },

    flash(msg, isError = false) {
      els.toast.textContent = msg;
      els.toast.classList.toggle('error', isError);
      els.toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => els.toast.classList.remove('show'), isError ? 5000 : 2800);
    },

    /** Small inline number prompt placed on the drawing. */
    askNumber(at, label, initial, onOk, onCancel) {
      const input = h('input', { type: 'number', step: 'any', value: initial, 'aria-label': label });
      const done = (ok) => {
        box.remove();
        if (ok) { const v = parseNum(input.value); if (v !== null) onOk(v); else if (onCancel) onCancel(); }
        else if (onCancel) onCancel();
        app.requestRender(); ui.refresh(app, 'hint');
      };
      const box = h('div', { class: 'ask', style: { left: `${Math.min(at.x + 12, els.stage.clientWidth - 260)}px`, top: `${Math.max(at.y - 18, 8)}px` } },
        h('label', {}, label), input,
        h('button', { class: 'btn primary', onclick: () => done(true) }, 'OK'),
        h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
        e.stopPropagation();
      });
      els.stage.append(box);
      input.focus(); input.select();
    },

    /** The right-click menu for a selection, at a point on the drawing. */
    quickMenu(at, sel, items = null) { openQuickMenu(els.stage, app, at, sel, items); },
    closeQuickMenu,

    /** The popup editor of an external force or torque. */
    openLoad(id) { openLoadDialog(app, id); },

    plotsOpen: () => !els.plots.hidden,

    togglePlots(open = els.plots.hidden) {
      els.plots.hidden = !open;
      app.requestRender();
      ui.refresh(app, 'motion');
      parts.topbar.update();
    },

    loadExample(index = 0) {
      const ex = EXAMPLES[index];
      app.setDoc(ex.make());
      ui.togglePlots(true);
      requestAnimationFrame(() => app.fitView()); // after the plot drawer has opened
      app.flash(`Example: ${ex.name}. Press Enter to run it.`);
    },
  };
  return ui;
}
