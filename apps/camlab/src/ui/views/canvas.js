// =============================================================================
// canvas.js — a drawing canvas with pan and zoom, y up, in mm
// -----------------------------------------------------------------------------
//   const c = drawingCanvas(container, { draw(ctx, v), bounds() })
//   c.render()   redraw on the next frame       c.fit()   fit bounds() in view
// v.toScreen({x, y}) and v.px(n) (n screen pixels in mm) for the draw callback.
// Drag pans, the wheel (or a pinch) zooms, double-click fits. Until the user
// pans or zooms, the drawing is fitted again whenever the canvas changes size.
// =============================================================================

import { h } from '../../../../../packages/ui-kit/src/dom.js';

export function drawingCanvas(container, { draw, bounds, margin = 40 }) {
  const cv = h('canvas', { class: 'drawing' });
  container.append(cv);
  const view = { scale: 1, cx: 0, cy: 0, w: 1, h: 1, fitted: false, moved: false };
  view.toScreen = (p) => ({ x: view.w / 2 + (p.x - view.cx) * view.scale, y: view.h / 2 - (p.y - view.cy) * view.scale });
  view.toWorld = (s) => ({ x: view.cx + (s.x - view.w / 2) / view.scale, y: view.cy - (s.y - view.h / 2) / view.scale });
  view.px = (n) => n / view.scale;

  let queued = false;
  function render() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      view.w = W; view.h = H;
      if (!view.fitted) fitNow();
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      draw(ctx, view);
    });
  }

  function fitNow() {
    const b = bounds();
    if (!b || !(b.maxX > b.minX)) return;
    const W = view.w, H = view.h;
    view.scale = Math.min((W - 2 * margin) / (b.maxX - b.minX), (H - 2 * margin) / (b.maxY - b.minY));
    view.cx = (b.minX + b.maxX) / 2; view.cy = (b.minY + b.maxY) / 2;
    view.fitted = true;
  }

  // ---- pan and zoom ----
  let drag = null;
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy }; try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 2) view.moved = true;
    view.cx = drag.cx - (e.clientX - drag.x) / view.scale;
    view.cy = drag.cy + (e.clientY - drag.y) / view.scale;
    render();
  });
  cv.addEventListener('pointerup', () => { drag = null; });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const s = { x: e.clientX - r.left, y: e.clientY - r.top };
    const before = view.toWorld(s);
    view.moved = true;
    view.scale *= Math.exp(-e.deltaY * 0.0015);
    const after = view.toWorld(s);
    view.cx += before.x - after.x; view.cy += before.y - after.y;
    render();
  }, { passive: false });
  cv.addEventListener('dblclick', () => { view.fitted = false; view.moved = false; render(); });
  new ResizeObserver(() => { if (!view.moved) view.fitted = false; render(); }).observe(cv);

  return {
    canvas: cv, view, render,
    fit() { view.fitted = false; view.moved = false; render(); },
  };
}

/** Draw a polyline of world points. */
export function polyline(ctx, v, pts, close = false) {
  if (!pts.length) return;
  ctx.beginPath();
  pts.forEach((p, i) => { const s = v.toScreen(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
  if (close) ctx.closePath();
}

/** Circle of world radius r at world point c. */
export function circle(ctx, v, c, r) {
  const s = v.toScreen(c);
  ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(0, r * v.scale), 0, 2 * Math.PI);
}

/** A small label with a white backing, at screen point s. */
export function label(ctx, s, text, color = '#1D2433', align = 'center') {
  ctx.font = '600 12px system-ui, "Segoe UI", sans-serif';
  const w = ctx.measureText(text).width + 8;
  const x = align === 'left' ? s.x : align === 'right' ? s.x - w : s.x - w / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(x, s.y - 9, w, 18);
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(text, x + 4, s.y + 0.5);
}

/** Rotate a world point about the origin by t (radians). */
export const rot = (p, t) => ({ x: p.x * Math.cos(t) - p.y * Math.sin(t), y: p.x * Math.sin(t) + p.y * Math.cos(t) });
