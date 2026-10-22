// =============================================================================
// plotstack.js — plots stacked one above the other, all against cam angle θ
// -----------------------------------------------------------------------------
//   const st = plotStack(el, app, [{ key, title }])
//   st.set(key, { series, markers, empty, unit, at })   st.cursor()   st.destroy()
// at(θ): the reading at the exact cam angle (else the nearest plotted point).
// Each title bar reads out the first line's value at the cam angle and its
// largest and smallest values over the turn, so numbers can be read off
// without hovering.
// Click or drag on any plot to turn the cam to that angle. Each plot zooms
// with the wheel and opens large with its ⤢ button (plotting/linePlot.js).
// Drag the line between two plots to share the height differently
// (remembered on this computer; double-click the line to share it evenly).
// =============================================================================

import { h } from '../../../../../packages/ui-kit/src/dom.js';
import { LinePlot } from '../../../../../packages/plotting/src/linePlot.js';
import { safeStorage } from '../../../../../packages/ui-kit/src/files.js';
import { showNum, scaleOf } from '../numbers.js';
import { fmt } from '../../../../../packages/ui-kit/src/format.js';

const MIN_SHARE = 0.25; // smallest plot, as a share of an even split

const compact = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toPrecision(3)}M`;
  if (a >= 1e4) return `${+(v / 1e3).toPrecision(3)}k`;
  return String(+v.toPrecision(4));
};

export function plotStack(el, app, rows) {
  const stack = h('div', { class: 'plot-stack' });
  el.append(stack);
  const plots = new Map();
  // height shares of the rows, kept per set of plots
  const storeKey = `camlab.rows.${rows.map((r) => r.key).join('-')}`;
  let weights = rows.map(() => 1);
  try { const w = JSON.parse(safeStorage.get(storeKey)); if (Array.isArray(w) && w.length === rows.length && w.every((x) => x > 0)) weights = w; } catch { /* even split */ }
  const layout = () => { stack.style.gridTemplateRows = weights.map((w) => `minmax(0, ${w}fr)`).join(' '); };
  layout();
  rows.forEach((r, i) => {
    const title = h('span', {}, r.title);
    const sub = h('span', { class: 'sub' });
    const now = h('span', { class: 'now' });
    const range = h('span', { class: 'range' });
    const canvas = h('div', { class: 'plot-canvas' });
    const row = h('div', { class: 'plot-row' }, h('div', { class: 'plot-title' }, title, sub, h('span', { class: 'spacer' }), now, range), canvas);
    if (i < rows.length - 1) row.append(divider(i));
    stack.append(row);
    const plot = new LinePlot(canvas, {
      onScrub: (x) => { app.play(false); app.setTheta(x); }, formatY: compact,
      title: () => `${title.textContent} ${sub.textContent}`.trim(),
    });
    plots.set(r.key, { plot, title, sub, now, range, xs: [], main: null, unit: '', scale: 0 });
  });

  /** The line under row i: drag it to move height between row i and row i + 1. */
  function divider(i) {
    const el = h('div', { class: 'row-divider', title: 'Drag to resize the plots (double-click: even)', role: 'separator', 'aria-orientation': 'horizontal' });
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      const total = weights.reduce((a, b) => a + b, 0);
      const pxPer = stack.clientHeight / total;
      const startY = e.clientY, a = weights[i], b = weights[i + 1];
      const min = MIN_SHARE * (total / weights.length);
      const move = (ev) => {
        const d = (ev.clientY - startY) / pxPer;
        const na = Math.max(min, Math.min(a + b - min, a + d));
        weights[i] = na; weights[i + 1] = a + b - na;
        layout();
      };
      const up = () => {
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
        safeStorage.set(storeKey, JSON.stringify(weights.map((w) => +w.toFixed(3))));
      };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
    });
    el.addEventListener('dblclick', () => { weights = rows.map(() => 1); layout(); safeStorage.remove(storeKey); });
    return el;
  }
  return {
    stack,
    /** Data for one plot; x is the cam angle of every value (degrees). */
    set(key, { xs, series, markers = [], empty, unit = '', at = null }) {
      const p = plots.get(key);
      p.xs = xs;
      p.at = at;
      p.sub.textContent = unit ? `(${unit})` : '';
      p.unit = unit;
      p.main = series[0] || null;
      p.range.textContent = '';
      // the size of the line over the turn: a reading far below it is round-off and reads 0
      p.scale = p.main ? scaleOf(p.main.values.map((v) => ({ v })), 'v') : 0;
      const num = (v) => showNum(v); // as the tables
      if (p.main) {
        let hi = -1, lo = -1;
        p.main.values.forEach((v, i) => {
          if (!Number.isFinite(v)) return;
          if (hi < 0 || v > p.main.values[hi]) hi = i;
          if (lo < 0 || v < p.main.values[lo]) lo = i;
        });
        // infinite spikes (markers with impulse) are the largest and smallest values
        const up = markers.find((m) => m.impulse === 1 || m.impulse === 0), down = markers.find((m) => m.impulse === -1 || m.impulse === 0);
        const hiText = up ? `∞ at ${deg(xs[up.index])}` : hi >= 0 ? `${num(p.main.values[hi])} at ${deg(xs[hi])}` : '';
        const loText = down ? `−∞ at ${deg(xs[down.index])}` : lo >= 0 ? `${num(p.main.values[lo])} at ${deg(xs[lo])}` : '';
        // the full text, and a short one (no angles) for a narrow plot (styles.css picks one)
        const shortHi = up ? '∞' : hi >= 0 ? num(p.main.values[hi]) : '', shortLo = down ? '−∞' : lo >= 0 ? num(p.main.values[lo]) : '';
        if (hiText) {
          p.range.replaceChildren(h('span', { class: 'full' }, `max ${hiText}  min ${loText}`), h('span', { class: 'short' }, `max ${shortHi}  min ${shortLo}`));
          p.range.title = `max ${hiText}, min ${loText}`;
        }
      }
      // yKey: a range typed under Axes stays while the plot shows the same quantity
      p.plot.setData({ x: xs, xName: 'θ', xAngle: true, series, markers, empty, legend: series.length > 1, yKey: `${key}|${unit}` });
    },
    /** The row's title; "s  displacement": the word after the two spaces is left out on a narrow plot. */
    title(key, text, tip = '') {
      const t = plots.get(key).title, cut = text.indexOf('  ');
      if (cut > 0) t.replaceChildren(text.slice(0, cut), h('span', { class: 'word' }, text.slice(cut)));
      else t.textContent = text;
      t.title = tip;
    },
    /** Move every cursor to the current cam angle. */
    cursor() {
      for (const p of plots.values()) {
        p.plot.setCursor(app.theta);
        // at the exact angle when the row can say (the plotted points are 0.25° apart)
        const i = nearest(p.xs, app.theta);
        const v = !p.main ? NaN : p.at ? p.at(app.theta) : i >= 0 ? p.main.values[i] : NaN;
        const unit = !p.unit || !Number.isFinite(v) ? '' : p.unit === '°' ? '°' : ` ${p.unit}`;
        p.now.textContent = p.main ? `${p.main.name} = ${Number.isFinite(v) ? showNum(v, p.scale) : '—'}${unit}` : '';
      }
    },
    destroy() {
      for (const p of plots.values()) p.plot.destroy();
      stack.remove();
    },
  };
}

const deg = (x) => `${fmt(x, 1)}°`; // as the tables: 135.0°

/** Index of the point nearest the cam angle (degrees, round the turn). */
function nearest(xs, theta) {
  let bi = -1, bd = Infinity;
  for (let i = 0; i < xs.length; i++) { const d = Math.abs(xs[i] - theta) % 360; const dd = Math.min(d, 360 - d); if (dd < bd) { bd = dd; bi = i; } }
  return bi;
}

/** Indices where the segment changes (for boundary markers) in a sample list. */
export function boundaries(samples) {
  const out = [];
  for (let i = 1; i < samples.length; i++) if (samples[i].segment !== samples[i - 1].segment) out.push(i);
  return out;
}
