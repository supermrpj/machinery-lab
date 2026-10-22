// =============================================================================
// views/construction.js — the graphical method, step by step (slide 13)
// -----------------------------------------------------------------------------
// "Wrap the required linear motion of the follower into a circular shape":
//   1  Displacement diagram, cut into N equal divisions of cam angle
//   2  Base and prime circles, and N stations (follower positions) drawn the
//      opposite way to the cam's rotation (we hold the cam still and move the
//      follower round it instead: inversion)
//   3  Transfer each displacement s onto its station: the roller centre sits
//      Rp + s from the centre (along the follower's line)
//   4  Draw the roller (or the flat face) at every station
//   5  Draw the cam profile touching every roller: a smooth curve tangent to
//      them. The exact profile is drawn too; more divisions bring the hand
//      construction closer to it.
// The displacement diagram is drawn to the same scale as the circles, so its
// heights could be taken off with dividers, as on paper.
// =============================================================================

import { h } from '../../../../../packages/ui-kit/src/dom.js';
import { fmt } from '../../../../../packages/ui-kit/src/format.js';
import { drawingCanvas, polyline, circle, label, rot } from './canvas.js';
import { evaluate } from '../../model/program.js';
import { camPoint } from '../../model/geometry.js';
import { THEME, CONSTRUCTION } from '../../config.js';

const STEPS = [
  { title: 'Displacement diagram', text: 'Plot the follower displacement s against cam angle θ, and cut the turn into equal divisions. Each division line gives one height s to transfer.' },
  { title: 'Circles and stations', text: 'Draw the base circle and the prime circle. Hold the cam still and move the follower round it instead: number the stations the opposite way to the cam’s rotation, one per division.' },
  { title: 'Transfer the displacements', text: 'On each station line, measure s outward from the prime circle. That point is where the roller centre is at that cam angle. Together they trace the pitch curve.' },
  { title: 'Draw the follower at each station', text: 'Draw the roller (radius Rf) round each centre, or for a flat face, the face line square to the station line at Rb + s.' },
  { title: 'Draw the cam profile', text: 'Draw a smooth curve that touches every roller (or face) without cutting into any. That is the cam.' },
];

export function constructionView(el, app) {
  let divisions = CONSTRUCTION.defaultDivisions;
  let step = 1; // the tutorial starts at step 1; Next builds the construction up

  const stepLabel = h('span', { style: { fontWeight: 700 } });
  const prev = h('button', { class: 'btn small', onclick: () => go(step - 1) }, '◀ Back');
  const next = h('button', { class: 'btn small primary', onclick: () => go(step + 1) }, 'Next ▶');
  const first = h('button', { class: 'btn small', onclick: () => go(1), title: 'Start the construction from step 1' }, 'Start over');
  const divSel = h('select', { 'aria-label': 'Number of divisions', onchange: (e) => { divisions = +e.target.value; c.render(); } },
    CONSTRUCTION.divisions.map((n) => h('option', { value: n, selected: n === divisions }, `${n} divisions (${fmt(360 / n, 1)}°)`)));
  const fitBtn = h('button', { class: 'btn small', onclick: () => c.fit() }, 'Fit');
  const bar = h('div', { class: 'view-bar' }, h('div', { class: 'card' }, first, prev, stepLabel, next), h('div', { class: 'card' }, divSel), fitBtn);
  el.append(bar);
  const text = h('div', { class: 'step-text' });
  const legend = h('div', { class: 'view-legend', style: { top: '58px', bottom: 'auto' } });
  el.append(text, legend);

  function go(k) { step = Math.max(1, Math.min(STEPS.length, k)); c.render(); }

  const c = drawingCanvas(el, { draw, bounds, margin: 50 });

  /** Layout: the circle construction round the origin, the diagram to its left. */
  function layout() {
    const r = app.result(), f = app.doc.follower;
    const R = Math.max(...r.shape.surface.map((p) => Math.hypot(p.x, p.y)), ...(r.shape.pitch.length ? r.shape.pitch.map((p) => Math.hypot(p.x, p.y) + (f.Rf || 0)) : [0]));
    const W = 2.2 * R, gap = 0.45 * R;
    const sSpan = Math.max(r.sMax - r.sMin, 1e-6);
    // heights drawn k times larger when the stroke is small next to the cam (k = 1, 2, 2.5, 5, 10, …)
    const want = (0.6 * R) / sSpan;
    let k = 1;
    for (const c of [1, 2, 2.5, 5, 10, 20, 25, 50, 100]) if (c <= want) k = c;
    return { R, W, gap, k, x0: -R - gap - W, x1: -R - gap, y0: -k * (r.sMin + r.sMax) / 2, sSpan };
  }

  function bounds() {
    const L = layout();
    return { minX: L.x0 - 0.1 * L.R, maxX: 1.2 * L.R, minY: -1.3 * L.R, maxY: 1.2 * L.R };
  }

  function draw(ctx, v) {
    const r = app.result(), doc = app.doc, f = doc.follower, U = app.units;
    const flat = f.type === 'flat';
    const dir = f.dir === -1 ? -1 : 1;
    const L = layout();
    const N = divisions;
    const stations = Array.from({ length: N }, (_, i) => {
      const deg = (i * 360) / N;
      const m = evaluate(r.prep, deg);
      return { i, deg, m, g: camPoint(f, m, (deg * Math.PI) / 180) };
    });
    const near = Math.round((app.theta / 360) * N) % N; // station nearest the current cam angle
    const Rb = flat ? f.Rb : f.Rp - f.Rf;
    const yOf = (s) => L.y0 + L.k * s; // diagram heights (× k when the stroke is small)
    const xOf = (deg) => L.x0 + (deg / 360) * L.W;

    stepLabel.textContent = `Step ${step} of ${STEPS.length}: ${STEPS[step - 1].title}`;
    prev.disabled = step <= 1; next.disabled = step >= STEPS.length;
    // sizes that cannot make a cam: no construction, only what to fix
    const noCam = r.problems.find((p) => p.kind === 'size') || (!r.valid && { text: 'The cam shape cannot be worked out with these sizes.' });
    if (noCam) { text.replaceChildren(h('b', {}, 'No cam can be drawn'), noCam.text); legend.hidden = true; return; }
    // what depends on the design is said here, in the box (it wraps), not on the drawing
    const more = step === 2 ? ` This cam turns ${dir > 0 ? 'counter-clockwise' : 'clockwise'}, so the stations go ${dir > 0 ? 'clockwise' : 'counter-clockwise'}.`
      : step === 5 ? ` The shaded profile is the exact cam, worked out by CamLab: a curve drawn by hand through the ${N} ${flat ? 'faces' : 'rollers'} should follow it closely, and more divisions bring it closer.` : '';
    text.replaceChildren(h('b', {}, `${step}. ${STEPS[step - 1].title}`), STEPS[step - 1].text + more);
    const key = (color, dash, name) => h('span', {}, h('span', { class: 'legend-line', style: { borderTopColor: color, borderTopStyle: dash ? 'dashed' : 'solid' } }), name);
    legend.hidden = step < 2;
    legend.style.top = `${bar.offsetTop + bar.offsetHeight + 6}px`; // below the bar, however many rows it wraps to
    legend.replaceChildren(...[
      key(THEME.circles, true, flat ? 'base circle Rb' : 'base circle Rb (inner), prime circle Rp'),
      key(THEME.construction, false, 'stations (follower positions)'),
      step >= 3 && !flat ? key(THEME.pitch, true, 'pitch curve (roller centres)') : null,
      step >= 5 ? key(THEME.camEdge, false, 'cam profile') : null,
    ].filter(Boolean));

    // ---- 1. displacement diagram ----
    ctx.lineWidth = 1;
    const a0 = v.toScreen({ x: L.x0, y: yOf(0) }), a1 = v.toScreen({ x: L.x1, y: yOf(0) });
    ctx.strokeStyle = THEME.ink; ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x + 10, a1.y); ctx.stroke();
    const top = v.toScreen({ x: L.x0, y: yOf(r.sMax) });
    ctx.beginPath(); ctx.moveTo(a0.x, a0.y + 4); ctx.lineTo(a0.x, top.y - 16); ctx.stroke();
    label(ctx, { x: a0.x - 4, y: top.y - 24 }, L.k === 1 ? `s (${U.L.label}), true size` : `s (${U.L.label}), drawn ×${L.k}`, THEME.ink, 'left');
    label(ctx, { x: a1.x + 14, y: a1.y }, 'θ', THEME.ink, 'left');
    // division lines with their heights
    for (const st of [...stations, { i: N, deg: 360, m: evaluate(r.prep, 360) }]) {
      const xb = v.toScreen({ x: xOf(st.deg), y: yOf(0) }), xt = v.toScreen({ x: xOf(st.deg), y: yOf(r.sMax) });
      ctx.strokeStyle = st.i % N === near ? THEME.normal : 'rgba(29,36,51,0.22)'; ctx.lineWidth = st.i % N === near ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(xb.x, xb.y); ctx.lineTo(xt.x, xt.y - 6); ctx.stroke();
      const hp = v.toScreen({ x: xOf(st.deg), y: yOf(st.m.s) });
      ctx.fillStyle = THEME.construction; ctx.beginPath(); ctx.arc(hp.x, hp.y, 3, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = THEME.muted; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(String(st.i), xb.x, xb.y + 5);
    }
    ctx.fillStyle = THEME.muted; ctx.textBaseline = 'top'; ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(`0° … 360° in ${N} divisions of ${fmt(360 / N, 1)}°`, (a0.x + a1.x) / 2, a0.y + 20);
    // the curve
    polyline(ctx, v, r.samples.map((sm) => ({ x: xOf(sm.deg), y: yOf(sm.s) })));
    ctx.strokeStyle = THEME.ink; ctx.lineWidth = 2; ctx.stroke();
    // where the cam is now
    const cx = v.toScreen({ x: xOf(app.theta), y: yOf(r.sMin) }), cy = v.toScreen({ x: xOf(app.theta), y: yOf(r.sMax) });
    ctx.strokeStyle = THEME.normal; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(cx.x, cx.y + 4); ctx.lineTo(cy.x, cy.y - 4); ctx.stroke(); ctx.setLineDash([]);
    if (step < 2) return;

    // ---- 2. circles and stations ----
    ctx.lineWidth = 1.3; ctx.setLineDash([6, 4]);
    circle(ctx, v, { x: 0, y: 0 }, Rb); ctx.strokeStyle = THEME.circles; ctx.stroke();
    if (!flat) { circle(ctx, v, { x: 0, y: 0 }, f.Rp); ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1; }
    if (f.e) { circle(ctx, v, { x: 0, y: 0 }, Math.abs(f.e)); ctx.strokeStyle = THEME.muted; ctx.stroke(); }
    ctx.setLineDash([]);
    const outer = L.R * 1.06;
    for (const st of stations) {
      // the follower's line at this station, in the cam's frame (turned back by α)
      const back = -dir * (st.deg * Math.PI) / 180;
      const p0 = rot({ x: f.e || 0, y: 0 }, back); // from the offset circle (the centre when ε = 0)
      const p1 = rot({ x: f.e || 0, y: outer }, back);
      const s0 = v.toScreen(p0), s1 = v.toScreen(p1);
      ctx.strokeStyle = st.i === near ? THEME.normal : THEME.construction; ctx.lineWidth = st.i === near ? 2 : 1; ctx.globalAlpha = st.i === near ? 1 : 0.55;
      ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke(); ctx.globalAlpha = 1;
      const lp = v.toScreen(rot({ x: f.e || 0, y: outer + 0.07 * L.R }, back));
      label(ctx, lp, `${st.i}′`, st.i === near ? THEME.normal : THEME.construction);
    }
    // the cam's rotation, and the stations going the other way
    turnArrow(ctx, v.toScreen({ x: 0, y: 0 }), Math.max(24, 0.22 * L.R * v.scale), dir, THEME.ink);
    if (step < 3) return;

    // ---- 3. transfer the displacements ----
    for (const st of stations) {
      const back = -dir * (st.deg * Math.PI) / 180;
      const P = flat ? rot({ x: f.e || 0, y: Rb + st.m.s }, back) : st.g.pitch;
      const base = flat ? rot({ x: f.e || 0, y: Rb }, back) : rot({ x: f.e || 0, y: Math.sqrt(Math.max(0, f.Rp ** 2 - (f.e || 0) ** 2)) }, back);
      const sb = v.toScreen(base), sp = v.toScreen(P);
      ctx.strokeStyle = THEME.construction; ctx.lineWidth = 3; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(sb.x, sb.y); ctx.lineTo(sp.x, sp.y); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = st.i === near ? THEME.normal : THEME.construction;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 3.5, 0, 2 * Math.PI); ctx.fill();
    }
    if (step < 4) {
      // join the centres point to point, as a student would with a French curve
      polyline(ctx, v, stations.map((st) => (flat ? rot({ x: f.e || 0, y: Rb + st.m.s }, -dir * (st.deg * Math.PI) / 180) : st.g.pitch)), true);
      ctx.strokeStyle = THEME.pitch; ctx.lineWidth = 1.3; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
      return;
    }

    // ---- 4. the follower at each station ----
    for (const st of stations) {
      const back = -dir * (st.deg * Math.PI) / 180;
      ctx.strokeStyle = st.i === near ? THEME.normal : THEME.follower; ctx.lineWidth = st.i === near ? 2 : 1.2;
      if (flat) {
        // the face spans every contact point (plus a little), square to the station line
        const pad = 0.05 * L.R;
        const pa = v.toScreen(rot({ x: r.shape.armMin - pad, y: Rb + st.m.s }, back)), pb = v.toScreen(rot({ x: r.shape.armMax + pad, y: Rb + st.m.s }, back));
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      } else {
        circle(ctx, v, st.g.pitch, f.Rf); ctx.stroke();
      }
    }
    if (!flat) { polyline(ctx, v, r.shape.pitch, true); ctx.strokeStyle = THEME.pitch; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]); }
    if (step < 5) return;

    // ---- 5. the cam profile ----
    polyline(ctx, v, r.shape.surface, true);
    ctx.fillStyle = 'rgba(244,199,161,0.45)'; ctx.fill();
    ctx.strokeStyle = THEME.camEdge; ctx.lineWidth = 2.4; ctx.stroke();
  }

  /** Arrow round the centre: the way the cam turns. */
  function turnArrow(ctx, o, r, dir, color) {
    const a0 = Math.PI * 1.1, a1 = Math.PI * 1.6;
    ctx.strokeStyle = color; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(o.x, o.y, r, a0, a1); ctx.stroke();
    const end = dir > 0 ? a0 : a1;
    const tip = { x: o.x + r * Math.cos(end), y: o.y + r * Math.sin(end) };
    const tang = end + (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(tip.x + 9 * Math.cos(tang), tip.y + 9 * Math.sin(tang));
    ctx.lineTo(tip.x + 5 * Math.cos(tang + 2.2), tip.y + 5 * Math.sin(tang + 2.2));
    ctx.lineTo(tip.x + 5 * Math.cos(tang - 2.2), tip.y + 5 * Math.sin(tang - 2.2));
    ctx.closePath(); ctx.fill();
  }

  return {
    update(what) {
      if (what === 'doc') c.fit();
      else c.render();
    },
  };
}
