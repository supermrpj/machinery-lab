// =============================================================================
// basic.js — simple drafting tools: point, line, construction line, measure
// -----------------------------------------------------------------------------
// Every tool receives pointer events with these fields:
//   ev.s     screen point (px)        ev.w     world point (mm, not snapped)
//   ev.snap  { p, kind, ref }  — the snapped world point (use ev.snap.p)
//   ev.shift, ev.alt, ev.button
// =============================================================================

import { addConstruction } from '../../model/construction.js';
import { THEME } from '../../config.js';

/** Shift key: constrain a direction to multiples of 15°. */
export function constrainAngle(from, to, on) {
  if (!on) return to;
  const dx = to.x - from.x, dy = to.y - from.y;
  const L = Math.hypot(dx, dy);
  const step = Math.PI / 12;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + L * Math.cos(a), y: from.y + L * Math.sin(a) };
}

export const pointTool = {
  id: 'point', label: 'Point', shortcut: 'P', group: 'Draw', icon: 'point', layer: 'construction',
  hint: () => 'Click to place a point. It snaps to intersections, ends and centres.',
  down(app, ev) {
    app.edit('Add point', (doc) => addConstruction(doc, 'point', { p: ev.snap.p }));
  },
};

/** Two-click tool factory for segment, construction line and dimension. */
function twoPointTool(spec) {
  return {
    ...spec,
    first: null,
    current: null,
    activate() { this.first = null; this.current = null; },
    hint(app) { return this.first ? spec.hint2 : spec.hint1; },
    down(app, ev) {
      if (!this.first) { this.first = ev.snap.p; this.current = ev.snap.p; return; }
      const b = constrainAngle(this.first, ev.snap.p, ev.shift);
      if (Math.hypot(b.x - this.first.x, b.y - this.first.y) < app.view.px(2)) return;
      const a = this.first;
      app.edit(spec.undoLabel, (doc) => addConstruction(doc, spec.kind, { a, b }));
      this.first = spec.chain ? b : null;
    },
    move(app, ev) { this.current = this.first ? constrainAngle(this.first, ev.snap.p, ev.shift) : null; },
    cancel() { const had = !!this.first; this.first = null; return had; },
    drawOverlay(ctx, app) {
      if (!this.first || !this.current) return;
      const a = app.view.toScreen(this.first), b = app.view.toScreen(this.current);
      ctx.strokeStyle = THEME.preview; ctx.lineWidth = 1;
      ctx.setLineDash(spec.kind === 'xline' ? [8, 4, 2, 4] : []);
      if (spec.kind === 'xline') {
        const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, far = 1e4;
        ctx.beginPath(); ctx.moveTo(a.x - dx / L * far, a.y - dy / L * far); ctx.lineTo(a.x + dx / L * far, a.y + dy / L * far); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.setLineDash([]);
      const L = Math.hypot(this.current.x - this.first.x, this.current.y - this.first.y);
      const ang = Math.atan2(this.current.y - this.first.y, this.current.x - this.first.x) * 180 / Math.PI;
      app.renderer.label({ x: b.x + 14, y: b.y - 16 }, `${app.units.fmt(L)}  ∠${ang.toFixed(1)}°`.replace(/-/g, '−'), THEME.preview);
    },
  };
}

export const segmentTool = twoPointTool({
  id: 'segment', label: 'Line', shortcut: 'L', group: 'Draw', icon: 'segment', layer: 'construction', kind: 'segment',
  undoLabel: 'Draw line', chain: false,
  hint1: 'Click the start of the line.',
  hint2: 'Click the end of the line. Hold Shift for 15° steps. Esc cancels.',
});

export const xlineTool = twoPointTool({
  id: 'xline', label: 'Construction line', shortcut: 'X', group: 'Draw', icon: 'xline', layer: 'construction', kind: 'xline',
  undoLabel: 'Draw construction line', chain: false,
  hint1: 'Click a point the endless construction line passes through.',
  hint2: 'Click a second point to set its direction. Hold Shift for 15° steps.',
});

export const measureTool = twoPointTool({
  id: 'measure', label: 'Measure', shortcut: 'M', group: 'Draw', icon: 'measure', layer: 'construction', kind: 'dim',
  undoLabel: 'Add dimension', chain: false,
  hint1: 'Click the first point to measure from.',
  hint2: 'Click the second point. The distance and angle stay on the drawing.',
});
