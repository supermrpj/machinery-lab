// =============================================================================
// linePlot.js — a small canvas line chart with a synced cursor
// -----------------------------------------------------------------------------
// One y-axis per chart (stack several charts rather than mixing units).
// Features: legend, crosshair with value read-out on hover, a cursor line that
// follows the mechanism's input angle, and click/drag to scrub.
//
//   const p = new LinePlot(containerElement, { onScrub: (x) => … });
//   p.setData({ x: [...], xLabel, yLabel, series: [{ name, color, values }],
//               markers: [{ index, label }] });
//   A marker with impulse: 1 | -1 | 0 is an infinite spike there (a Dirac
//   impulse): drawn as an arrow from the first line's value there to the top
//   (1), the bottom (−1) or both (0) of the plot, in marker.color, labelled.
//   p.setCursor(x, index);   index (optional) picks the point when x repeats
//
// A curve may double back (x is not always increasing — e.g. a rocking input
// over its whole circuit). With opts.onPick(index) a click picks the nearest
// plotted point instead of an x value, which is unambiguous on such curves.
//
// Looking closer:
//   mouse wheel        zoom the x-axis about the pointer (y fits what is shown)
//   Shift + wheel      move along a zoomed x-axis (a sideways swipe does too)
//   double-click       back to the whole range
//   ⤢ button           open the plot large in a window (Esc closes it); it keeps
//                      the same data and cursor and can be zoomed on its own.
//                      opts.expandable = false leaves the button out;
//                      opts.title() names the large window.
//   axes button        type the range of either axis and the spacing of its
//                      ticks (empty = automatic). The y range and spacing are
//                      kept until the plotted quantity changes (data.yKey,
//                      else data.yLabel, else the line names).
//                      double-click puts both axes back to automatic.
//
// An angle on the x-axis (data.xAngle, degrees) gets ticks every 15, 30, 45,
// 60, 90 … degrees (ANGLE_STEPS), or every opts.angleStep() degrees when the
// app sets one; an angle on the y-axis (data.yAngle) gets the same steps; other
// axes get "nice" ticks (1, 2, 2.5, 5 × 10ⁿ).
//
// Polar diagram (data.polar): each line is a vector over the cycle, given as
// px, py (e.g. a bearing load: the tip of the force arrow traced round its
// pin). Distance from the centre = size, direction = direction (0° to the
// right, counter-clockwise). data.marks [{ index, text }] label points along
// the first line (the input angle); the cursor draws the vector at the current
// position. Clicks pick the nearest point (opts.onPick). The axes button sets
// the radius and the ring spacing.
//
// Text size: opts.textScale (a number, or a function returning one) multiplies
// every text on the plot; call restyle() after it changes.
// =============================================================================

const STYLE = {
  fontPx: 11,
  family: 'system-ui, "Segoe UI", sans-serif',
  text: '#2b3140',
  muted: '#6b7280',
  grid: 'rgba(30, 40, 60, 0.08)',
  axis: 'rgba(30, 40, 60, 0.35)',
  cursor: '#1D2433',
  pad: { l: 52, r: 12, t: 22, b: 26 },
  yTickPx: 28,   // at least this far apart (× text size)
  xTickPx: 70,
  lineH: 15,     // read-out line height (× text size)
};

// CONFIG: tick spacing of an angle axis (degrees), the smallest that leaves
// at least ANGLE_TICK_PX between labels is used
const ANGLE_STEPS = [1, 2, 5, 10, 15, 30, 45, 60, 90, 180, 360];
const ANGLE_TICK_PX = 40;
const MAX_TICKS = 200; // a spacing typed by hand that would give more ticks is ignored

// CONFIG: zoom
const ZOOM = {
  wheelStep: 0.0015,   // zoom per wheel pixel (exp(step · deltaY))
  minFraction: 1 / 200, // closest zoom, as a fraction of the whole x range
};

// styles for the enlarge button and window, added to the page once
const CSS = `
.lp-expand { position: absolute; top: 3px; right: 4px; width: 22px; height: 22px; padding: 0; display: grid; place-items: center;
  border: 2px solid var(--ink, #1d1d1f); border-radius: 4px; background: rgba(255,255,255,0.9); color: var(--ink, #1d1d1f);
  cursor: pointer; opacity: 0.55; z-index: 1; }
.lp-expand:hover, .lp-expand:focus-visible { opacity: 1; box-shadow: 2px 2px 0 var(--ink, #1d1d1f); }
.lp-expand svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
dialog.lp-window { width: min(1200px, 94vw); height: min(760px, 88vh); max-width: none; max-height: none; padding: 0;
  border: 3px solid var(--ink, #1d1d1f); border-radius: 8px; box-shadow: 6px 6px 0 var(--ink, #1d1d1f); background: #fff; overflow: hidden; }
dialog.lp-window[open] { display: grid; grid-template-rows: auto minmax(0, 1fr); }
dialog.lp-window::backdrop { background: rgba(20, 22, 28, 0.45); }
.lp-head { display: flex; align-items: center; gap: 12px; padding: 8px 10px 8px 14px; border-bottom: 2px solid var(--ink, #1d1d1f); font: 13px system-ui, "Segoe UI", sans-serif; }
.lp-head b { font-size: 14px; }
.lp-head .lp-tip { color: #6b7280; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lp-head button { font: 700 13px system-ui, "Segoe UI", sans-serif; height: 30px; padding: 0 12px; border: 2px solid var(--ink, #1d1d1f); border-radius: 4px; background: #fff; cursor: pointer; }
.lp-head button:hover { box-shadow: 2px 2px 0 var(--ink, #1d1d1f); }
.lp-body { position: relative; min-height: 0; }
.lp-body canvas { position: absolute; inset: 0; cursor: col-resize; }
.lp-expand.lp-axes-btn { right: 30px; }
dialog.lp-axes { width: min(440px, 94vw); padding: 0; border: 3px solid var(--ink, #1d1d1f); border-radius: 8px;
  box-shadow: 6px 6px 0 var(--ink, #1d1d1f); background: #fff; font: 13px system-ui, "Segoe UI", sans-serif; color: var(--ink, #1d1d1f); }
dialog.lp-axes::backdrop { background: rgba(20, 22, 28, 0.35); }
.lp-axes form { padding: 14px 16px 16px; display: grid; gap: 10px; }
.lp-axes h3 { margin: 0; font-size: 15px; }
.lp-axes .lp-row { display: grid; grid-template-columns: 1fr 80px 80px 80px; gap: 8px; align-items: center; }
.lp-axes .lp-row.lp-cols { color: #6b7280; font-size: 12px; }
.lp-axes input { width: 100%; height: 30px; padding: 0 6px; border: 2px solid var(--ink, #1d1d1f); border-radius: 4px; font: inherit; }
.lp-axes .lp-note { margin: 0; color: #6b7280; font-size: 12px; }
.lp-axes .lp-err { margin: 0; color: #b42318; font-size: 12px; }
.lp-axes .lp-buttons { display: flex; gap: 8px; justify-content: flex-end; }
.lp-axes button { font: 700 13px system-ui, "Segoe UI", sans-serif; height: 30px; padding: 0 12px; border: 2px solid var(--ink, #1d1d1f);
  border-radius: 4px; background: #fff; cursor: pointer; }
.lp-axes button.lp-primary { background: var(--yellow, #ffe11a); }
.lp-axes button:hover { box-shadow: 2px 2px 0 var(--ink, #1d1d1f); }
`;
function addStyles() {
  if (typeof document === 'undefined' || document.getElementById('lineplot-styles')) return;
  const st = document.createElement('style');
  st.id = 'lineplot-styles'; st.textContent = CSS;
  document.head.appendChild(st);
}
const EXPAND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>';
const AXES_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3v16h16M5 7h3M5 11h3M5 15h3M9 19v-3M13 19v-3M17 19v-3"/></svg>';

/** A number typed in a box: a number, null when empty, NaN when not a number. */
function readBox(input) {
  const t = input.value.trim().replace(',', '.').replace('−', '-');
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

/** "Nice" tick values covering [lo, hi] (about n ticks). */
export function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) { const c = lo || 0; lo = c - 1; hi = c + 1; }
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

/** Ticks at every multiple of `step` within [lo, hi]. */
export function stepTicks(lo, hi, step) {
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12));
  return out;
}

/** Angle ticks (degrees): the smallest step of ANGLE_STEPS at least minStep wide. */
export function angleTicks(lo, hi, minStep) {
  const step = ANGLE_STEPS.find((s) => s >= minStep) || ANGLE_STEPS[ANGLE_STEPS.length - 1];
  return stepTicks(lo, hi, step);
}

export class LinePlot {
  constructor(container, opts = {}) {
    this.container = container;
    this.onScrub = opts.onScrub || null;
    this.onPick = opts.onPick || null;
    this.cursorIndex = null;
    this.formatY = opts.formatY || ((v) => String(+v.toPrecision(4)));
    this.opts = opts;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'lineplot';
    container.appendChild(this.canvas);
    this.data = null;
    this.cursorX = null;
    this.hoverX = null;
    this.xView = null; // [lo, hi] when zoomed in, else the whole range
    this.xStep = null; // tick spacing typed under Axes (null = automatic)
    this.yStep = null;
    this.yRange = null; // { lo, hi } typed by hand (either may be null = automatic), else automatic
    this._yKey = null;  // the quantity the y range belongs to
    this._twin = null; // the large copy while it is open
    this._buttons = 0; // corner buttons (the legend keeps clear of them)
    if (opts.expandable !== false) {
      addStyles();
      this.expandBtn = this._cornerButton('lp-expand', EXPAND_ICON, 'Open this plot large (Esc closes it)', 'Enlarge plot', () => this.expand());
      this.axesBtn = this._cornerButton('lp-expand lp-axes-btn', AXES_ICON, 'Set the range of the axes', 'Axes', () => this.openAxes());
    }
    this._bind();
    this._ro = new ResizeObserver(() => { this._baseDirty = true; this.draw(); });
    this._ro.observe(container);
  }

  _cornerButton(cls, svg, title, label, onclick) {
    const b = document.createElement('button');
    b.className = cls; b.type = 'button'; b.title = title;
    b.setAttribute('aria-label', label);
    b.innerHTML = svg;
    b.addEventListener('click', onclick);
    this.container.appendChild(b);
    this._buttons++;
    return b;
  }

  /** The text size (opts.textScale). */
  _k() {
    const t = this.opts.textScale;
    const k = typeof t === 'function' ? t() : t;
    return Number.isFinite(k) && k > 0 ? k : 1;
  }
  _font(px = STYLE.fontPx, weight = '') { return `${weight ? weight + ' ' : ''}${px * this._k()}px ${STYLE.family}`; }

  /** Redraw after the text size changed. */
  restyle() {
    this._baseDirty = true; this.draw();
    if (this._twin) this._twin.restyle();
  }

  setData(data) {
    // a new x range (other quantity on the axis): forget the zoom; the same
    // range with other data (an edited design) keeps it
    const r6 = (v) => +(+v).toPrecision(6);
    const range = (d) => (d && d.x && d.x.length ? `${r6(d.x[0])}|${r6(d.x[d.x.length - 1])}|${d.xName || ''}` : '');
    if (range(data) !== range(this.data)) { this.xView = null; this.xStep = null; }
    // another quantity on the y-axis: back to an automatic y range
    const yKey = data ? data.yKey ?? data.yLabel ?? (data.series || []).map((s) => s.name).join('|') : null;
    if (yKey !== this._yKey) { this.yRange = null; this.yStep = null; this._yKey = yKey; }
    this.data = data; this._baseDirty = true; this.draw();
    if (this._twin) this._twin.setData(data);
  }
  setCursor(x, index = null) {
    this.cursorX = x; this.cursorIndex = index; this.draw();
    if (this._twin) this._twin.setCursor(x, index);
  }
  destroy() {
    if (this._twin) this._twin._window.close();
    this._ro.disconnect(); this.canvas.remove();
    if (this.expandBtn) this.expandBtn.remove();
    if (this.axesBtn) this.axesBtn.remove();
  }

  /** Whole x range of the data. */
  _fullX() {
    const xs = this.data && this.data.x;
    if (!xs || xs.length < 2) return null;
    let lo = Infinity, hi = -Infinity;
    for (const x of xs) { if (x < lo) lo = x; if (x > hi) hi = x; }
    return hi > lo ? [lo, hi] : null;
  }

  /** Zoom to [lo, hi] on the x-axis (kept inside the data); null shows everything. */
  setXView(view) {
    const full = this._fullX();
    if (!view || !full) { this.xView = null; } else {
      const span = full[1] - full[0], min = span * ZOOM.minFraction;
      let [lo, hi] = view;
      if (hi - lo < min) { const c = (lo + hi) / 2; lo = c - min / 2; hi = c + min / 2; }
      if (hi - lo >= span) { this.xView = null; } else {
        if (lo < full[0]) { hi += full[0] - lo; lo = full[0]; }
        if (hi > full[1]) { lo -= hi - full[1]; hi = full[1]; }
        this.xView = [lo, hi];
      }
    }
    this._baseDirty = true; this.draw();
  }

  /** Open the plot large in a window. Esc or the Close button closes it. */
  expand() {
    if (this._twin || typeof document === 'undefined') return;
    addStyles();
    const win = document.createElement('dialog');
    win.className = 'lp-window';
    const head = document.createElement('div');
    head.className = 'lp-head';
    const title = document.createElement('b');
    title.textContent = (this.opts.title && this.opts.title()) || (this.data && this.data.yLabel) || 'Plot';
    const tip = document.createElement('span');
    tip.className = 'lp-tip';
    tip.textContent = this.data && this.data.polar
      ? 'Point at a curve to read it · click: move there · double-click: automatic axes · Esc: close'
      : 'Wheel: zoom · Shift + wheel: move along · double-click: automatic axes · Esc: close';
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = 'Close';
    close.addEventListener('click', () => win.close());
    const axes = document.createElement('button');
    axes.type = 'button'; axes.textContent = 'Axes…'; axes.title = 'Set the range of the axes';
    head.append(title, tip, axes, close);
    const body = document.createElement('div');
    body.className = 'lp-body';
    win.append(head, body);
    document.body.appendChild(win);
    const twin = new LinePlot(body, { ...this.opts, expandable: false });
    twin._window = win;
    this._twin = twin;
    win.addEventListener('close', () => { twin.destroy(); win.remove(); this._twin = null; if (this.expandBtn) this.expandBtn.focus(); });
    win.showModal();
    axes.addEventListener('click', () => twin.openAxes());
    twin.xView = this.xView;
    twin.setData(this.data);
    twin.xView = this.xView; twin.yRange = this.yRange ? { ...this.yRange } : null; twin._baseDirty = true;
    twin.setCursor(this.cursorX, this.cursorIndex);
    close.focus();
  }

  /**
   * Type the range of the axes. An empty box is automatic. x is limited to
   * the plotted data (like zooming); y can be any range.
   */
  openAxes() {
    if (typeof document === 'undefined' || !this.data || !this._g) return;
    addStyles();
    const g = this._g, d = this.data;
    const full = this._fullX() || [g.x0, g.x1];
    const fmt = (v) => String(+(+v).toPrecision(6));
    const box = (value, placeholder, label) => {
      const i = document.createElement('input');
      i.type = 'text'; i.inputMode = 'decimal'; i.value = value === null || value === undefined ? '' : fmt(value);
      i.placeholder = fmt(placeholder); i.setAttribute('aria-label', label);
      return i;
    };
    const xLo = box(this.xView ? this.xView[0] : null, full[0], 'x-axis from');
    const xHi = box(this.xView ? this.xView[1] : null, full[1], 'x-axis to');
    const yLo = box(this.yRange ? this.yRange.lo : null, g.y0, 'y-axis from');
    const yHi = box(this.yRange ? this.yRange.hi : null, g.y1, 'y-axis to');
    const xSt = box(this.xStep, g.xTickStep, 'x-axis tick spacing');
    const ySt = box(this.yStep, g.yTickStep, 'y-axis tick spacing');
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
    const row = (label, a, b, c) => { const r = el('div', 'lp-row'); r.append(el('span', '', label), a, b, c); return r; };
    const cols = el('div', 'lp-row lp-cols'); cols.append(el('span'), el('span', '', 'From'), el('span', '', 'To'), el('span', '', 'Ticks every'));
    const err = el('p', 'lp-err'); err.hidden = true;
    const auto = el('button', '', 'Automatic'); auto.type = 'button';
    const cancel = el('button', '', 'Cancel'); cancel.type = 'button';
    const apply = el('button', 'lp-primary', 'Apply'); apply.type = 'submit';
    const buttons = el('div', 'lp-buttons'); buttons.append(auto, cancel, apply);
    const form = document.createElement('form');
    form.append(el('h3', '', d.polar ? 'Polar diagram' : 'Axes'), cols,
      d.polar ? null : row(`x-axis${d.xName ? ` (${d.xName})` : ''}`, xLo, xHi, xSt),
      d.polar ? row('Radius', (yLo.disabled = true, yLo.value = '0', yLo), yHi, ySt) : row('y-axis', yLo, yHi, ySt),
      el('p', 'lp-note', `Leave a box empty for automatic${d.xAngle ? ' (angles: every 15°, 30°, 45°, 60° or 90°, as the plot allows)' : ''}. The x-axis stays within the plotted range. Double-click a plot to go back to automatic.`),
      err, buttons);
    const win = el('dialog', 'lp-axes');
    win.append(form);
    document.body.appendChild(win);
    win.addEventListener('close', () => win.remove());
    cancel.addEventListener('click', () => win.close());
    auto.addEventListener('click', () => { this.yRange = null; this.xStep = null; this.yStep = null; this.setXView(null); win.close(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const [a, b, c, f, xs, ys] = [xLo, xHi, yLo, yHi, xSt, ySt].map(readBox);
      const bad = (lo, hi) => Number.isNaN(lo) || Number.isNaN(hi) || (lo !== null && hi !== null && !(hi > lo));
      if (bad(a, b) || bad(c, f)) { err.textContent = 'Type numbers, with "To" larger than "From".'; err.hidden = false; return; }
      if ([xs, ys].some((v) => Number.isNaN(v) || (v !== null && !(v > 0)))) { err.textContent = 'Tick spacing: a number larger than 0, or empty.'; err.hidden = false; return; }
      this.yRange = d.polar ? (f === null ? null : { lo: 0, hi: f }) : c === null && f === null ? null : { lo: c, hi: f };
      this.xStep = xs; this.yStep = ys;
      this.setXView(a === null && b === null ? null : [a ?? full[0], b ?? full[1]]);
      win.close();
    });
    win.showModal();
    xLo.focus();
  }

  _bind() {
    const toX = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return this._invX ? this._invX(e.clientX - r.left) : null;
    };
    const pick = (e) => {
      const r = this.canvas.getBoundingClientRect();
      if (this.onPick && this._nearest) {
        // x always increasing: the point at that x; a curve that doubles back
        // (a loop): the point of the curve nearest the click
        const byX = this.data && this.data.pickByX && !this.data.polar;
        const i = byX ? this._nearestX(e.clientX - r.left) : this._nearest(e.clientX - r.left, e.clientY - r.top);
        if (i !== null) this.onPick(i);
        return;
      }
      const x = toX(e);
      if (this.onScrub && x !== null) this.onScrub(x);
    };
    let dragging = false;
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.hoverPt = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.hoverX = toX(e);
      if (dragging) pick(e);
      this.draw();
    });
    this.canvas.addEventListener('pointerleave', () => { this.hoverX = null; this.hoverPt = null; this.draw(); });
    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      pick(e);
    });
    this.canvas.addEventListener('pointerup', () => { dragging = false; });
    // zoom and move along the x-axis
    this.canvas.addEventListener('wheel', (e) => {
      const full = this._fullX();
      if (!full || !this._g || this._g.polar) return; // a polar diagram does not zoom along x
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const [lo, hi] = this.xView || full;
      const { P, pw } = this._g;
      const shiftPan = e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX);
      const dx = shiftPan ? e.deltaY : e.deltaX;
      if (Math.abs(dx) > Math.abs(shiftPan ? 0 : e.deltaY)) {
        // sideways: move the window
        const shift = ((dx * unit) / pw) * (hi - lo);
        this.setXView([lo + shift, hi + shift]);
        return;
      }
      const r = this.canvas.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left - P.l) / pw));
      const at = lo + f * (hi - lo);
      const k = Math.exp(ZOOM.wheelStep * e.deltaY * unit);
      this.setXView([at - (at - lo) * k, at + (hi - at) * k]);
    }, { passive: false });
    this.canvas.addEventListener('dblclick', () => { this.yRange = null; this.xStep = null; this.yStep = null; this.setXView(null); });
  }

  /** Paint everything that only changes with the data or the size: axes, curves, markers. */
  _paintBase(W, H, dpr) {
    const cv = this._base || (this._base = document.createElement('canvas'));
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const k = this._k();
    ctx.font = this._font();
    const d = this.data;
    if (!d || !d.x || d.x.length < 2 || !d.series.length) {
      ctx.fillStyle = STYLE.muted;
      ctx.fillText(d && d.empty ? d.empty : 'No data', 12, 20 * k);
      this._invX = null;
      this._g = null;
      return;
    }
    if (d.polar) { this._paintPolar(ctx, W, H, k, d); return; }
    const P = { ...STYLE.pad, t: STYLE.pad.t * k, b: STYLE.pad.b * k };
    const xs = d.x;
    const full = this._fullX() || [Math.min(...xs), Math.max(...xs)];
    const [x0, x1] = this.xView || full;
    const inView = (i) => xs[i] >= x0 && xs[i] <= x1;
    // Robust y-range: near a toggle position velocities shoot towards
    // infinity, which would flatten the rest of the curve. Use the 2–98 %
    // range (plus margin) when the extremes are far outside it.
    const all = [];
    for (const s of d.series) s.values.forEach((v, i) => { if (Number.isFinite(v) && inView(i)) all.push(v); });
    let y0 = -1, y1 = 1, clipped = false;
    if (all.length) {
      all.sort((a, b) => a - b);
      const q = (f) => all[Math.min(all.length - 1, Math.max(0, Math.round(f * (all.length - 1))))];
      const lo = q(0.02), hi = q(0.98), span = Math.max(hi - lo, 1e-12);
      y0 = all[0]; y1 = all[all.length - 1];
      const flat = y1 - y0 < 1e-8 * Math.max(1, Math.abs(y0), Math.abs(y1));
      if (!flat && y0 < lo - 1.5 * span) { y0 = lo - 0.25 * span; clipped = true; }
      if (!flat && y1 > hi + 1.5 * span) { y1 = hi + 0.25 * span; clipped = true; }
    }
    // a flat line (constant, or only rounding noise): show it level, not as noise
    if (y1 - y0 < 1e-8 * Math.max(1, Math.abs(y0), Math.abs(y1))) {
      const c = (y0 + y1) / 2, half = Math.max(1, Math.abs(c) * 0.1);
      y0 = c - half; y1 = c + half;
    }
    // a y range typed by hand (Axes): exactly that, ticks inside it
    const fixed = this.yRange;
    if (fixed) {
      if (fixed.lo !== null) y0 = fixed.lo;
      if (fixed.hi !== null) y1 = fixed.hi;
      if (!(y1 > y0)) { if (fixed.lo !== null) y1 = y0 + 1; else y0 = y1 - 1; }
      clipped = false;
    }
    const phEst = H - P.t - P.b;
    let yt = niceTicks(y0, y1, Math.max(2, Math.floor(phEst / (STYLE.yTickPx * k))));
    if (yt.length < 2) yt = niceTicks(y0, y1, 4); // always two labels to read a scale from
    if (d.yAngle && !(this.yStep > 0)) {
      // an angle on the y-axis: 15°, 30°, 45°, 90° … steps, as the height allows
      const step = ANGLE_STEPS.find((st) => st >= ((y1 - y0) * STYLE.yTickPx * k) / Math.max(phEst, 1)) || 360;
      const lo = fixed && fixed.lo !== null ? y0 : Math.floor(y0 / step + 1e-9) * step;
      const hi = fixed && fixed.hi !== null ? y1 : Math.ceil(y1 / step - 1e-9) * step;
      yt = stepTicks(lo, hi, step);
    }
    if (this.yStep > 0 && (y1 - y0) / this.yStep <= MAX_TICKS) {
      // spacing typed by hand: ticks at its multiples (the range grows to whole ticks unless fixed)
      const lo = fixed && fixed.lo !== null ? y0 : Math.floor(y0 / this.yStep + 1e-9) * this.yStep;
      const hi = fixed && fixed.hi !== null ? y1 : Math.ceil(y1 / this.yStep - 1e-9) * this.yStep;
      yt = stepTicks(lo, hi, this.yStep);
    }
    if (fixed) yt = yt.filter((t) => t >= y0 - 1e-9 * (y1 - y0) && t <= y1 + 1e-9 * (y1 - y0));
    else { y0 = Math.min(y0, yt[0]); y1 = Math.max(y1, yt[yt.length - 1]); }
    // make room for the widest tick label
    const labelW = Math.max(...yt.map((t) => ctx.measureText(this.formatY(t)).width));
    P.l = Math.max(P.l, Math.ceil(labelW) + 12);
    const pw = W - P.l - P.r, ph = H - P.t - P.b;
    const sx = (x) => P.l + ((x - x0) / (x1 - x0 || 1)) * pw;
    const sy = (y) => P.t + (1 - (y - y0) / (y1 - y0)) * ph;
    this._invX = (px) => Math.max(x0, Math.min(x1, x0 + ((px - P.l) / pw) * (x1 - x0)));
    // plotted point nearest a screen x (for curves whose x always increases)
    this._nearestX = (px) => {
      const x = x0 + ((px - P.l) / pw) * (x1 - x0);
      let bi = 0, bd = Infinity;
      for (let i = 0; i < xs.length; i++) { const dd = Math.abs(xs[i] - x); if (dd < bd) { bd = dd; bi = i; } }
      return bi;
    };
    // nearest plotted point to a screen position (for clicks on curves that double back)
    this._nearest = (px, py) => {
      let bi = null, bd = Infinity;
      for (const s of d.series) {
        for (let i = 0; i < xs.length; i++) {
          const v = s.values[i];
          if (!Number.isFinite(v) || !inView(i)) continue;
          const dd = (sx(xs[i]) - px) ** 2 + (sy(Math.max(y0, Math.min(y1, v))) - py) ** 2;
          if (dd < bd) { bd = dd; bi = i; }
        }
      }
      return bi;
    };

    // grid + y labels
    ctx.lineWidth = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const t of yt) {
      const y = Math.round(sy(t)) + 0.5;
      ctx.strokeStyle = t === 0 ? STYLE.axis : STYLE.grid;
      ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(P.l + pw, y); ctx.stroke();
      ctx.fillStyle = STYLE.muted;
      ctx.fillText(this.formatY(t).replace('-', '−'), P.l - 6, y);
    }
    // x labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    let xt;
    if (this.xStep > 0 && (x1 - x0) / this.xStep <= MAX_TICKS) xt = stepTicks(x0, x1, this.xStep);
    else if (d.xAngle) {
      // angles: 15°, 30°, 45°, 60°, 90° … (or the app's choice), as the width allows
      const chosen = typeof this.opts.angleStep === 'function' ? this.opts.angleStep() : this.opts.angleStep;
      const minStep = ((x1 - x0) * ANGLE_TICK_PX * k) / Math.max(pw, 1);
      xt = chosen > 0 && (x1 - x0) / chosen <= MAX_TICKS ? stepTicks(x0, x1, chosen) : angleTicks(x0, x1, minStep);
    } else xt = niceTicks(x0, x1, Math.max(2, Math.floor(pw / (STYLE.xTickPx * k))));
    // enough decimals for the tick spacing (0.01 m steps need two)
    const xStep = xt.length > 1 ? xt[1] - xt[0] : 1;
    const xDec = Math.max(0, Math.min(6, Math.ceil(-Math.log10(xStep) + 1e-9)));
    for (const t of xt) {
      const x = Math.round(sx(t)) + 0.5;
      ctx.strokeStyle = STYLE.grid;
      ctx.beginPath(); ctx.moveTo(x, P.t); ctx.lineTo(x, P.t + ph); ctx.stroke();
      ctx.fillStyle = STYLE.muted;
      ctx.fillText(String(+t.toFixed(xDec)).replace('-', '−'), x, P.t + ph + 5 * k);
    }
    const notes = [this.xView || this.yRange ? 'Axes set: double-click for automatic' : '', clipped ? 'Off-scale near limits' : ''].filter(Boolean);
    if (notes.length) {
      // kept clear of the corner buttons (cut short on a narrow plot)
      ctx.save();
      ctx.beginPath(); ctx.rect(P.l, 0, Math.max(0, W - P.l - 26 * this._buttons - 6), P.t); ctx.clip();
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = STYLE.muted;
      ctx.fillText(notes.join(' · '), P.l, 5);
      ctx.restore();
    }
    // optional title (left out when the page already names the chart)
    if (d.yLabel) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = STYLE.text;
      ctx.fillText(d.yLabel, P.l, 5);
    }

    // legend (top right)
    if (d.series.length > 1 && d.legend !== false) {
      let lx = P.l + pw - 26 * this._buttons; // clear of the corner buttons
      ctx.textBaseline = 'top';
      for (let i = d.series.length - 1; i >= 0; i--) {
        const s = d.series[i];
        const w = ctx.measureText(s.name).width;
        ctx.fillStyle = STYLE.text; ctx.textAlign = 'right';
        ctx.fillText(s.name, lx, 5);
        lx -= w + 6;
        ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.setLineDash(s.dash || []);
        ctx.beginPath(); ctx.moveTo(lx - 18, 5 + 6 * k); ctx.lineTo(lx, 5 + 6 * k); ctx.stroke();
        ctx.setLineDash([]);
        lx -= 26;
      }
    }

    // series (2 px lines; gaps where values are missing)
    ctx.save();
    ctx.beginPath(); ctx.rect(P.l, P.t - 2, pw, ph + 4); ctx.clip();
    ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const s of d.series) {
      ctx.strokeStyle = s.color;
      ctx.setLineDash(s.dash || []); // a dash pattern tells lines apart where they overlap
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < xs.length; i++) {
        const v = s.values[i];
        if (!Number.isFinite(v)) { pen = false; continue; }
        const X = sx(xs[i]), Y = sy(v);
        if (pen) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
        pen = true;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // toggle / stationary positions: one dotted line each, labelled at the top
    const seen = [];
    for (const m of d.markers || []) {
      const i = m.index;
      if (i < 0 || i >= xs.length || !inView(i)) continue;
      const X = Math.round(sx(xs[i])) + 0.5;
      if (seen.some((v) => Math.abs(v - X) < 3)) continue;
      seen.push(X);
      if (m.impulse !== undefined) {
        const v = d.series.length ? d.series[0].values[i] : 0;
        this._impulse(ctx, X, m, P, ph, sy(Number.isFinite(v) ? v : 0), k);
        continue;
      }
      ctx.strokeStyle = STYLE.muted; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(X, P.t + 12 * k); ctx.lineTo(X, P.t + ph); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = STYLE.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.font = this._font(10, 'bold');
      ctx.fillText(m.label, X, P.t + 1);
      ctx.font = this._font();
    }
    // what the top layer (cursor, hover) needs
    this._g = { P, pw, ph, sx, sy, xs, x0, x1, y0, y1, d,
      xTickStep: xt.length > 1 ? xt[1] - xt[0] : x1 - x0, yTickStep: yt.length > 1 ? yt[1] - yt[0] : y1 - y0 };
  }

  /** An infinite spike at screen x = X: arrow(s) from screen height `from` to the plot's edge, with its label. */
  _impulse(ctx, X, m, P, ph, from, k) {
    const color = m.color || '#C0392B';
    const y0 = Math.min(P.t + ph, Math.max(P.t, from));
    const ends = m.impulse > 0 ? [P.t + 2] : m.impulse < 0 ? [P.t + ph - 2] : [P.t + 2, P.t + ph - 2];
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.5 * k; ctx.lineCap = 'butt';
    for (const yEnd of ends) {
      const dir = yEnd < y0 ? -1 : 1, head = 7 * k;
      ctx.beginPath(); ctx.moveTo(X, y0); ctx.lineTo(X, yEnd - dir * head); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X, yEnd); ctx.lineTo(X - 4.5 * k, yEnd - dir * head); ctx.lineTo(X + 4.5 * k, yEnd - dir * head); ctx.closePath(); ctx.fill();
      ctx.font = this._font(11, 'bold'); ctx.textAlign = 'left'; ctx.textBaseline = dir < 0 ? 'top' : 'bottom';
      ctx.fillText(m.label, X + 5 * k, yEnd);
    }
    ctx.font = this._font(); ctx.lineCap = 'round';
  }

  /** Polar diagram: rings, spokes, the curves and their angle marks (see the header). */
  _paintPolar(ctx, W, H, k, d) {
    const top = STYLE.pad.t * k, pad = 10 * k;
    const shown = d.series.filter((sr) => sr.px && sr.px.length);
    let R = 0;
    for (const sr of shown) sr.px.forEach((x, i) => { const r = Math.hypot(x, sr.py[i]); if (Number.isFinite(r) && r > R) R = r; });
    if (!(R > 0)) R = 1;
    const fixed = this.yRange && this.yRange.hi > 0;
    let rings = this.yStep > 0 && R / this.yStep <= MAX_TICKS ? stepTicks(0, fixed ? this.yRange.hi : R, this.yStep) : niceTicks(0, fixed ? this.yRange.hi : R, 4);
    rings = rings.filter((v) => v > 0);
    const Rmax = fixed ? this.yRange.hi : Math.max(R, rings[rings.length - 1] || R);
    const cx = W / 2, cy = top + (H - top) / 2;
    const rad = Math.max(10, Math.min(W / 2 - pad - 18 * k, (H - top) / 2 - pad - 6 * k));
    const sc = rad / Rmax;
    const sx = (x) => cx + x * sc, sy = (y) => cy - y * sc;
    // spokes every 30°, the axes darker, and their angles
    ctx.lineWidth = 1;
    for (let a = 0; a < 360; a += 30) {
      const t = (a * Math.PI) / 180;
      ctx.strokeStyle = a % 90 === 0 ? STYLE.axis : STYLE.grid;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + rad * Math.cos(t), cy - rad * Math.sin(t)); ctx.stroke();
    }
    ctx.fillStyle = STYLE.muted; ctx.textBaseline = 'middle';
    ctx.textAlign = 'left'; ctx.fillText('0°', cx + rad + 4, cy);
    ctx.textAlign = 'right'; ctx.fillText('180°', cx - rad - 4, cy);
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('90°', cx, cy - rad - 2);
    ctx.textBaseline = 'top'; ctx.fillText('270°', cx, cy + rad + 2);
    // rings with their sizes (along 45°)
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    for (const v of rings) {
      if (v > Rmax * (1 + 1e-9)) continue;
      ctx.strokeStyle = STYLE.grid;
      ctx.beginPath(); ctx.arc(cx, cy, v * sc, 0, 2 * Math.PI); ctx.stroke();
      ctx.fillStyle = STYLE.muted;
      ctx.fillText(this.formatY(v), cx + v * sc * 0.707 + 2, cy - v * sc * 0.707 - 1);
    }
    // the curves (clipped to the outer ring when the radius is fixed)
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, rad + 1, 0, 2 * Math.PI); ctx.clip();
    ctx.lineWidth = 2; ctx.lineJoin = 'round';
    for (const sr of shown) {
      ctx.strokeStyle = sr.color; ctx.setLineDash(sr.dash || []);
      ctx.beginPath();
      let pen = false;
      sr.px.forEach((x, i) => {
        const y = sr.py[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; return; }
        if (pen) ctx.lineTo(sx(x), sy(y)); else ctx.moveTo(sx(x), sy(y));
        pen = true;
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
    // angle marks along the first line, set off outwards
    const first = shown[0];
    if (first) {
      ctx.font = this._font(10, 'bold'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const placed = []; // labels already written: one that would overlap is left out (its dot stays)
      for (const m of d.marks || []) {
        const x = first.px[m.index], y = first.py[m.index];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const X = sx(x), Y = sy(y), r = Math.hypot(X - cx, Y - cy) || 1;
        ctx.fillStyle = first.color; ctx.beginPath(); ctx.arc(X, Y, 2.5, 0, 2 * Math.PI); ctx.fill();
        const tx = X + ((X - cx) / r) * 11 * k, ty = Y + ((Y - cy) / r) * 9 * k;
        const w = ctx.measureText(m.text).width + 4, hgt = 12 * k;
        if (placed.some((b) => Math.abs(b.x - tx) < (b.w + w) / 2 && Math.abs(b.y - ty) < hgt)) continue;
        placed.push({ x: tx, y: ty, w });
        ctx.fillStyle = STYLE.text;
        ctx.fillText(m.text, tx, ty);
      }
      ctx.font = this._font();
    }
    ctx.fillStyle = STYLE.cursor; ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, 2 * Math.PI); ctx.fill();
    const notes = [this.yRange || this.yStep ? 'Axes set: double-click for automatic' : '', d.note || ''].filter(Boolean);
    if (notes.length) {
      ctx.save();
      ctx.beginPath(); ctx.rect(4, 0, Math.max(0, W - 26 * this._buttons - 10), top); ctx.clip();
      ctx.fillStyle = STYLE.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(notes.join(' · '), 6, 5);
      ctx.restore();
    }
    this._invX = null;
    // the point of any line nearest a screen position (clicks and hover)
    this._nearest = (px, py) => {
      let bi = null, bd = Infinity;
      for (const sr of shown) sr.px.forEach((x, i) => {
        const y = sr.py[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const dd = (sx(x) - px) ** 2 + (sy(y) - py) ** 2;
        if (dd < bd) { bd = dd; bi = i; }
      });
      return bi;
    };
    this._g = { polar: true, cx, cy, sc, sx, sy, d, shown, xs: d.x, rad };
  }

  /** Polar diagram, top layer: the vector at the cursor, and the read-out where the pointer is. */
  _drawPolarTop(ctx, W, k, lh) {
    const { cx, cy, sx, sy, d, shown, xs } = this._g;
    const deg = (x, y) => ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360;
    const at = (i) => shown.map((sr) => ({ sr, x: sr.px[i], y: sr.py[i] })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    let ci = this.cursorIndex;
    if ((ci === null || ci < 0 || ci >= xs.length) && this.cursorX !== null) {
      let bd = Infinity;
      xs.forEach((x, i) => { const dd = Math.abs(x - this.cursorX); if (dd < bd) { bd = dd; ci = i; } });
    }
    if (ci !== null && ci >= 0 && ci < xs.length) {
      for (const p of at(ci)) {
        const X = sx(p.x), Y = sy(p.y), L = Math.hypot(X - cx, Y - cy);
        const a = Math.atan2(Y - cy, X - cx), hd = 11 * k;
        // the arrow, with a white edge so it stands out from its own curve
        const arrow = () => {
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(X - (L > hd ? hd * 0.7 * Math.cos(a) : 0), Y - (L > hd ? hd * 0.7 * Math.sin(a) : 0)); ctx.stroke();
          if (L > hd) {
            ctx.beginPath(); ctx.moveTo(X, Y);
            ctx.lineTo(X - hd * Math.cos(a - 0.38), Y - hd * Math.sin(a - 0.38));
            ctx.lineTo(X - hd * Math.cos(a + 0.38), Y - hd * Math.sin(a + 0.38)); ctx.closePath(); ctx.fill(); ctx.stroke();
          }
        };
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 6; arrow();
        ctx.strokeStyle = p.sr.color; ctx.fillStyle = p.sr.color; ctx.lineWidth = 3; arrow();
      }
    }
    if (this.hoverPt && this._nearest) {
      const i = this._nearest(this.hoverPt.x, this.hoverPt.y);
      if (i === null) return;
      const pts = at(i);
      for (const p of pts) { ctx.strokeStyle = p.sr.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 4.5, 0, 2 * Math.PI); ctx.stroke(); }
      const lines = [`${d.xName || 'x'} = ${+(+xs[i]).toPrecision(5)}`]
        .concat(pts.map((p) => `${p.sr.name}: ${this.formatY(Math.hypot(p.x, p.y))} ∠${deg(p.x, p.y).toFixed(0)}°`));
      const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16, th = lines.length * lh + 8;
      let tx = this.hoverPt.x + 12, ty = this.hoverPt.y + 12;
      if (tx + tw > W - 4) tx = this.hoverPt.x - 12 - tw;
      if (ty + th > this.container.clientHeight - 4) ty = this.hoverPt.y - 12 - th;
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.strokeStyle = 'rgba(30,40,60,0.2)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, 4); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      lines.forEach((l, n) => {
        if (n > 0) { ctx.fillStyle = pts[n - 1].sr.color; ctx.fillRect(tx + 6, ty + 4 + n * lh + (lh - 6) / 2, 6, 6); }
        ctx.fillStyle = n === 0 ? STYLE.muted : STYLE.text;
        ctx.fillText(l.replace(/-(?=\d)/g, '−'), tx + (n > 0 ? 16 : 8), ty + 4 + n * lh);
      });
    }
  }

  /**
   * Draw the chart: the background (axes, curves, markers) is painted once
   * per data or size change and kept; each call only adds the cursor and the
   * hover read-out on top. The cursor moves every frame while the mechanism
   * runs, so this keeps playback light.
   */
  draw() {
    const cv = this.canvas, dpr = window.devicePixelRatio || 1;
    const W = this.container.clientWidth, H = this.container.clientHeight;
    if (W === 0 || H === 0) return;
    const sizeChanged = cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr);
    if (sizeChanged) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
    }
    if (sizeChanged || this._baseDirty !== false || !this._base) {
      this._paintBase(W, H, dpr);
      this._baseDirty = false;
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(this._base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = this._k(), lh = STYLE.lineH * k;
    ctx.font = this._font();
    const g = this._g;
    if (!g) return;
    if (g.polar) { this._drawPolarTop(ctx, W, k, lh); return; }
    const { P, ph, sx, sy, xs, x0, x1, d } = g;

    // cursor (current input angle) and hover crosshair
    const nearestIndex = (x) => {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < xs.length; i++) { const dd = Math.abs(xs[i] - x); if (dd < bd) { bd = dd; bi = i; } }
      return bi;
    };
    const vline = (x, color, dash) => {
      const X = Math.round(sx(x)) + 0.5;
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(X, P.t); ctx.lineTo(X, P.t + ph); ctx.stroke();
      ctx.setLineDash([]);
    };
    if (this.cursorX !== null && this.cursorX >= x0 && this.cursorX <= x1) {
      vline(this.cursorX, STYLE.cursor, []);
      const i = this.cursorIndex !== null && this.cursorIndex >= 0 && this.cursorIndex < xs.length ? this.cursorIndex : nearestIndex(this.cursorX);
      for (const s of d.series) {
        const v = s.values[i];
        if (!Number.isFinite(v)) continue;
        ctx.fillStyle = '#fff'; ctx.strokeStyle = s.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx(xs[i]), sy(v), 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      }
    }
    if (this.hoverX !== null) {
      vline(this.hoverX, STYLE.axis, [3, 3]);
      const i = nearestIndex(this.hoverX);
      const lines = [`${d.xName || 'x'} = ${(+xs[i].toPrecision(5))}`]
        .concat(d.series.map((s) => `${s.name}: ${Number.isFinite(s.values[i]) ? this.formatY(s.values[i]) : '—'}`));
      const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
      const th = lines.length * lh + 8;
      let tx = sx(xs[i]) + 10;
      if (tx + tw > W - 4) tx = sx(xs[i]) - 10 - tw;
      const ty = P.t + 4;
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.strokeStyle = 'rgba(30,40,60,0.2)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, 4); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      lines.forEach((l, n) => {
        if (n > 0) { ctx.fillStyle = d.series[n - 1].color; ctx.fillRect(tx + 6, ty + 4 + n * lh + (lh - 6) / 2, 6, 6); }
        ctx.fillStyle = n === 0 ? STYLE.muted : STYLE.text;
        ctx.fillText(l.replace(/-(?=\d)/g, '−'), tx + (n > 0 ? 16 : 8), ty + 4 + n * lh);
      });
    }
  }
}
