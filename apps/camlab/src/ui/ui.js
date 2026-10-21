// =============================================================================
// ui.js — builds the CamLab screen and routes refresh requests
// -----------------------------------------------------------------------------
//   top bar        file actions, examples, units, tutorial, help
//   inputs (left)  motion program, follower and size, speed, spring, part
//   stage (centre) the cam turning beside a set of plots, with one cursor:
//                  Motion (s v a j), Size (φ, ρ), Forces (Fc, Tc), Motion and
//                  force (s, a, Fc). The bar above picks the set, shows the
//                  cam, the plots or both, and copies or saves the numbers.
//                  The graphical method opens over the stage as a tutorial.
//   results (right) checks and numbers; can be hidden
//   timeline       cam angle, play, speed, values at this angle
// app.ui.refresh(what): 'doc' (the design changed), 'angle' (the cam turned),
// 'plots' (another plot set or layout), 'play' (started or stopped),
// 'mode' (Basic/Advanced). Basic hides the plot sets, inputs and results
// listed in config.js MODE.
// =============================================================================

import { h, replaceChildren } from '../../../../packages/ui-kit/src/dom.js';
import { downloadFile, safeStorage } from '../../../../packages/ui-kit/src/files.js';
import { buildTopbar } from './topbar.js';
import { buildInputs } from './inputs.js';
import { buildResults } from './results.js';
import { buildTimeline } from './timeline.js';
import { constructionView } from './views/construction.js';
import { camView } from './views/cam.js';
import { plotPane } from './views/plotset.js';
import { PLOTS } from '../config.js';

export function createUI(els) {
  let app = null, parts = null, toastTimer = null;
  let cam = null, plots = null, tutorial = null;
  let share = PLOTS.camShare;
  try { const v = +JSON.parse(safeStorage.get(PLOTS.storeKey) || '{}').share; if (v >= PLOTS.minShare && v <= 1 - PLOTS.minShare) share = v; } catch { /* default */ }

  // ---- the stage: cam | divider | plots --------------------------------------------
  const camEl = h('div', { class: 'pane cam-pane' });
  const plotEl = h('div', { class: 'pane plot-pane' });
  const split = h('div', { class: 'split', role: 'separator', 'aria-orientation': 'vertical', title: 'Drag to share the width (double-click: back to the start)' });

  const layoutSeg = h('div', { class: 'seg three bar-seg' });
  const setSel = h('select', { class: 'bar-sel', 'aria-label': 'Plots beside the cam', onchange: (e) => app.setPlots(e.target.value) });
  const radSeg = h('div', { class: 'seg bar-seg' },
    h('button', { class: 'seg-btn', title: 'v, a, j in time at the camshaft speed ω', onclick: () => { plots.setPerRad(false); markRad(); } }, 'at ω'),
    h('button', { class: 'seg-btn', title: 'v, a, j per radian of cam turn (ds/dθ, …)', onclick: () => { plots.setPerRad(true); markRad(); } }, 'per rad'));
  const markRad = () => { radSeg.children[0].classList.toggle('on', !plots.perRad); radSeg.children[1].classList.toggle('on', plots.perRad); };

  function remember() {
    safeStorage.set(PLOTS.storeKey, JSON.stringify({ share: +share.toFixed(3), layout: app.layout, plots: app.plots }));
  }

  function placePanes() {
    const L = app.layout;
    camEl.hidden = L === 'plots';
    plotEl.hidden = L === 'cam';
    split.hidden = L !== 'both';
    camEl.style.flex = L === 'both' ? `0 0 ${(share * 100).toFixed(2)}%` : '';
    for (const b of layoutSeg.children) b.classList.toggle('on', b.dataset.id === L);
  }

  function showPlots() {
    for (const o of setSel.options) o.hidden = !app.shows('plots', o.value);
    setSel.value = app.plots;
    plots.show(app.plots);
    radSeg.hidden = !plots.hasMotion() || app.layout === 'cam';
    markRad();
    placePanes();
    remember();
  }

  split.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { split.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    const box = els.view.getBoundingClientRect();
    const move = (ev) => {
      share = Math.max(PLOTS.minShare, Math.min(1 - PLOTS.minShare, (ev.clientX - box.left) / box.width));
      placePanes();
    };
    const up = () => { split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); remember(); cam.update('doc'); };
    split.addEventListener('pointermove', move); split.addEventListener('pointerup', up);
  });
  split.addEventListener('dblclick', () => { share = PLOTS.camShare; placePanes(); remember(); cam.update('doc'); });

  /** The numbers behind the plots shown, as text: comma- or tab-separated. */
  function plotText(sep) {
    const t = plots.table();
    const cell = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? String(+v.toPrecision(8)) : '') : String(v));
    return [t.head.map(cell).join(sep), ...t.rows.map((r) => r.map(cell).join(sep))].join('\n') + '\n';
  }
  async function copyPlots() {
    try { const text = plotText('\t'); await navigator.clipboard.writeText(text); ui.flash(`Copied ${text.trim().split('\n').length - 1} rows (θ every 0.25°). Paste into a spreadsheet.`); }
    catch { ui.flash('The browser did not allow copying. Use CSV instead.', true); }
  }
  function savePlots() {
    const set = PLOTS.sets.find((x) => x.id === app.plots);
    const name = (app.doc.meta.title || 'cam').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'cam';
    downloadFile(`${name} ${set.id}.csv`, plotText(','), 'text/csv');
  }

  // ---- the graphical method, over the stage ------------------------------------------
  function openTutorial() {
    if (tutorial) return;
    const body = h('div', { class: 'tutorial-body' });
    const el = h('div', { class: 'tutorial', role: 'dialog', 'aria-label': 'Graphical method' },
      h('div', { class: 'tutorial-head' },
        h('b', {}, 'Tutorial: the graphical method'),
        h('span', { class: 'note' }, 'Drawn for the design on the left. Change it there and the construction follows.'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: closeTutorial }, 'Close')),
      body);
    els.stage.append(el);
    tutorial = { el, api: constructionView(body, app) };
    tutorial.api.update('doc');
  }
  function closeTutorial() { if (!tutorial) return; tutorial.el.remove(); tutorial = null; }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tutorial && !document.querySelector('dialog[open]')) closeTutorial(); });

  const ui = {
    attach(theApp) {
      app = theApp;
      try { const st = JSON.parse(safeStorage.get(PLOTS.storeKey) || '{}'); if (PLOTS.layouts.some((x) => x.id === st.layout)) app.layout = st.layout; if (PLOTS.sets.some((x) => x.id === st.plots)) app.plots = st.plots; } catch { /* defaults */ }
      if (!app.shows('plots', app.plots)) app.plots = PLOTS.sets[0].id;
      replaceChildren(layoutSeg, PLOTS.layouts.map((x) => h('button', { class: 'seg-btn', 'data-id': x.id, onclick: () => app.setLayout(x.id) }, x.name)));
      replaceChildren(setSel, PLOTS.sets.map((x) => h('option', { value: x.id }, x.name)));
      replaceChildren(els.stagebar,
        layoutSeg,
        setSel,
        radSeg,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn small', title: 'Copy the numbers of these plots (paste into Excel or Google Sheets)', onclick: copyPlots }, 'Copy'),
        h('button', { class: 'btn small', title: 'Save the numbers of these plots as a CSV file', onclick: savePlots }, 'CSV'));
      replaceChildren(els.view, camEl, split, plotEl);
      cam = camView(camEl, app);
      plots = plotPane(plotEl, app);
      parts = {
        topbar: buildTopbar(els.topbar, app),
        inputs: buildInputs(els.inputs, app),
        results: buildResults(els.results, app),
        timeline: buildTimeline(els.timeline, app),
      };
      document.body.classList.toggle('mode-basic', app.mode === 'basic');
      showPlots();
      ui.refresh('doc');
    },

    refresh(what) {
      if (!parts) return;
      if (what === 'plots') { showPlots(); cam.update('doc'); return; }
      if (what === 'mode') {
        document.body.classList.toggle('mode-basic', app.mode === 'basic');
        showPlots();
        parts.topbar.update(); parts.inputs.update(); parts.results.update(); parts.timeline.update('doc');
        return;
      }
      if (what === 'doc') {
        parts.topbar.update();
        parts.inputs.update();
        parts.results.update();
      }
      parts.timeline.update(what);
      cam.update(what);
      plots.update(what);
      if (tutorial) tutorial.api.update(what);
    },

    openTutorial,
    closeTutorial,

    flash(msg, isError = false) {
      els.toast.textContent = msg;
      els.toast.classList.toggle('error', isError);
      els.toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => els.toast.classList.remove('show'), isError ? 5000 : 2800);
    },

    /** Which segment is picked in the program (highlighted on the cam and plots), or -1. */
    selectedSegment: -1,
    selectSegment(i) {
      ui.selectedSegment = i;
      parts.inputs.update();
      cam.update('angle');
      plots.update('doc');
    },
  };
  return ui;
}
