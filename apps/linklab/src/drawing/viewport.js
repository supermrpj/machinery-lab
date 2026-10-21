// =============================================================================
// viewport.js — world (mm, y up) ↔ screen (CSS px, y down), pan and zoom
// =============================================================================

import { DRAWING } from '../config.js';

export class Viewport {
  constructor() {
    this.cx = 0;          // world point at the centre of the screen
    this.cy = 0;
    this.zoom = DRAWING.initialZoom; // screen px per mm
    this.width = 800;
    this.height = 600;
  }

  resize(w, h) { this.width = w; this.height = h; }

  toScreen(p) {
    return { x: (p.x - this.cx) * this.zoom + this.width / 2, y: this.height / 2 - (p.y - this.cy) * this.zoom };
  }

  toWorld(s) {
    return { x: (s.x - this.width / 2) / this.zoom + this.cx, y: (this.height / 2 - s.y) / this.zoom + this.cy };
  }

  /** Screen distance in px → world distance in mm. */
  px(n) { return n / this.zoom; }

  panBy(dxScreen, dyScreen) {
    this.cx -= dxScreen / this.zoom;
    this.cy += dyScreen / this.zoom;
  }

  /** Zoom by factor k keeping the world point under screen point s fixed. */
  zoomAt(s, k) {
    const before = this.toWorld(s);
    this.zoom = Math.min(DRAWING.maxZoom, Math.max(DRAWING.minZoom, this.zoom * k));
    const after = this.toWorld(s);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  /** Zoom and centre on a box; `bottomPx` keeps a strip at the bottom clear (the hint bar). */
  fit(box, marginPx = 60, bottomPx = 0) {
    const w = Math.max(box.x1 - box.x0, 1), h = Math.max(box.y1 - box.y0, 1);
    this.zoom = Math.min(DRAWING.maxZoom, Math.max(DRAWING.minZoom,
      Math.min((this.width - 2 * marginPx) / w, (this.height - 2 * marginPx - bottomPx) / h)));
    this.cx = (box.x0 + box.x1) / 2;
    this.cy = (box.y0 + box.y1) / 2 - bottomPx / 2 / this.zoom;
  }
}
