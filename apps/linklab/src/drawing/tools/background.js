// =============================================================================
// background.js — the background picture (screenshot or scanned drawing)
// -----------------------------------------------------------------------------
//   Picture tool   drag to move the picture; opacity/rotation in Properties
//   Set scale      click two points on the picture, then type their real
//                  distance — the picture is resized so drawings on top of it
//                  are true size
// A picture can also be pasted at any time with Ctrl+V.
// =============================================================================

import { THEME } from '../../config.js';

export const imageTool = {
  id: 'image', label: 'Background picture', shortcut: 'I', group: 'Background', icon: 'image', layer: 'background',
  dragging: false, last: null, moved: false,
  hint(app) {
    return app.doc.background
      ? 'Drag to move the picture. Set opacity and rotation in Properties. Use Set scale to make it true size.'
      : 'Paste a screenshot with Ctrl+V, or use “Load picture” in Properties.';
  },
  cursor: (app) => (app.doc.background ? 'move' : 'default'),
  down(app, ev) {
    if (!app.doc.background) return;
    this.dragging = true; this.last = ev.w; this.moved = false;
  },
  move(app, ev) {
    if (!this.dragging) return;
    if (!this.moved) { app.beginEdit('Move picture'); this.moved = true; }
    const bg = app.doc.background;
    bg.x += ev.w.x - this.last.x; bg.y += ev.w.y - this.last.y;
    this.last = ev.w;
    app.docChangedLive();
  },
  up(app) {
    if (this.moved) app.endEdit();
    this.dragging = false;
  },
};

export const scaleTool = {
  id: 'scale', label: 'Set scale', shortcut: 'R', group: 'Background', icon: 'scale', layer: 'background',
  a: null, b: null, current: null,
  activate() { this.a = null; this.b = null; },
  hint(app) {
    if (!app.doc.background) return 'Load or paste a picture first.';
    if (!this.a) return 'Click the first end of a known length on the picture (zoom in for accuracy).';
    if (!this.b) return 'Click the other end of the known length.';
    return `Type the real length in ${app.units.label} and press Enter.`;
  },
  down(app, ev) {
    if (!app.doc.background || this.b) return;
    if (!this.a) { this.a = ev.snap.p; return; }
    this.b = ev.snap.p;
    const measured = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y);
    if (measured < 1e-9) { this.a = this.b = null; return; }
    const at = app.view.toScreen(this.b);
    app.askNumber(at, `Real length (${app.units.label})`, app.units.num(measured), (realU) => {
      const real = app.units.mm(realU);
      if (real > 0) {
        const k = real / measured, A = this.a;
        app.edit('Set picture scale', (doc) => {
          const bg = doc.background;
          bg.mmPerPx *= k;
          bg.x = A.x + (bg.x - A.x) * k;
          bg.y = A.y + (bg.y - A.y) * k;
        });
        app.flash(`Picture scaled ×${k.toFixed(4)}. It is now true size.`);
      }
      this.a = this.b = null;
    }, () => { this.a = this.b = null; });
  },
  move(app, ev) { this.current = ev.snap.p; },
  cancel() { const had = !!this.a; this.a = this.b = null; return had; },
  drawOverlay(ctx, app) {
    if (!this.a) return;
    const a = app.view.toScreen(this.a), b = app.view.toScreen(this.b || this.current || this.a);
    ctx.strokeStyle = THEME.snap; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI); ctx.stroke(); }
  },
};
