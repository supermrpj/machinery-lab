// =============================================================================
// eraser.js — the Eraser tool for the construction drawing
// -----------------------------------------------------------------------------
// Click a point, line, arc, circle or dimension to delete it, or drag across
// several. One stroke is one undo step. Only the construction layer is
// erased; the mechanism is never touched. A line or circle that a roll joint
// rolls on is kept (delete the joint first).
// =============================================================================

import { pairUsesEntity } from '../../model/document.js';
import { distanceToEntity } from '../../model/construction.js';
import { THEME } from '../../config.js';

const RADIUS_PX = 8; // how close the eraser must pass

export const eraserTool = {
  id: 'eraser', label: 'Eraser', shortcut: 'Z', group: 'Draw', icon: 'eraser', layer: 'construction',
  erasing: false, last: null, at: null, removed: 0, kept: false,
  activate() { this.at = null; this.erasing = false; },
  hint: () => 'Click a drawing (point, line, arc, circle or dimension) to delete it, or drag across several. The mechanism is not erased.',
  cursor: () => 'none',

  /** Delete every construction entity within the eraser along the stroke from a to b (screen). */
  sweep(app, a, b) {
    const doc = app.doc;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
    const pts = [];
    for (let k = 0; k <= steps; k++) pts.push(app.view.toWorld({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps }));
    const tol = app.view.px(RADIUS_PX);
    const shown = app.currentConstruction(); // where they appear now (attached ones move)
    const gone = new Set();
    for (const e of shown) {
      if (!pts.some((p) => distanceToEntity(e, p) < tol)) continue;
      if (doc.pairs.some((p) => pairUsesEntity(p, e.id))) { this.kept = true; continue; }
      gone.add(e.id);
    }
    if (!gone.size) return;
    if (!this.removed) app.beginEdit('Erase'); // one undo step for the stroke
    doc.construction = doc.construction.filter((e) => !gone.has(e.id));
    this.removed += gone.size;
    app.docChangedLive();
  },

  down(app, ev) {
    this.erasing = true; this.removed = 0; this.kept = false;
    this.last = ev.s; this.at = ev.s;
    this.sweep(app, ev.s, ev.s);
  },
  move(app, ev) {
    this.at = ev.s;
    if (!this.erasing) return;
    this.sweep(app, this.last, ev.s);
    this.last = ev.s;
  },
  up(app) {
    if (!this.erasing) return;
    this.erasing = false;
    if (this.removed) app.endEdit();
    if (this.kept) app.flash('A line or circle used by a roll joint was kept. Delete the joint first.');
  },
  cancel() { return false; },
  drawOverlay(ctx) {
    if (!this.at) return;
    ctx.strokeStyle = THEME.preview; ctx.lineWidth = 1.5;
    ctx.fillStyle = this.erasing ? 'rgba(255, 82, 82, 0.25)' : 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath(); ctx.arc(this.at.x, this.at.y, RADIUS_PX, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  },
};
