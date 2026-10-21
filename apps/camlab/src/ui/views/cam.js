// =============================================================================
// views/cam.js — the cam turning and the follower riding on it
// -----------------------------------------------------------------------------
// Fixed frame: cam centre at the origin, follower moving along +y. The cam is
// drawn turned by α = dir·θ. Shown: the cam (and how it mounts), base and prime
// circles, pitch curve, the follower (roller or flat face) on its spring, the
// common normal at the contact and the pressure angle φ. Parts of the profile
// where the follower cannot follow (undercut) are marked red; the segment
// picked in the program is drawn in its colour.
// =============================================================================

import { h } from '../../../../../packages/ui-kit/src/dom.js';
import { fmt, fmtSig } from '../../../../../packages/ui-kit/src/format.js';
import { drawingCanvas, polyline, circle, label, rot } from './canvas.js';
import { evaluate } from '../../model/program.js';
import { camPoint } from '../../model/geometry.js';
import { loopPoints } from '../../model/mounting.js';
import { THEME } from '../../config.js';

export function camView(el, app) {
  const info = h('div', { class: 'card' });
  const fitBtn = h('button', { class: 'btn small', onclick: () => c.fit() }, 'Fit');
  el.append(h('div', { class: 'view-bar' }, h('div', { class: 'card' }, info), fitBtn));
  const legend = h('div', { class: 'view-legend' });
  el.append(legend);

  const c = drawingCanvas(el, { draw, bounds, margin: 30 });

  function bounds() {
    const r = app.result(), f = app.doc.follower;
    const R = Math.max(...r.shape.surface.map((p) => Math.hypot(p.x, p.y)), ...(r.shape.pitch.length ? r.shape.pitch.map((p) => Math.hypot(p.x, p.y)) : [0]));
    const top = (f.type === 'flat' ? f.Rb : f.Rp) + r.sMax + (f.Rf || 0) + 0.8 * R;
    return { minX: -R * 1.06, maxX: R * 1.06, minY: -R * 1.06, maxY: top };
  }

  function draw(ctx, v) {
    const r = app.result(), doc = app.doc, f = doc.follower, U = app.units;
    const flat = f.type === 'flat';
    const dir = f.dir === -1 ? -1 : 1;
    const th = (app.theta * Math.PI) / 180, alpha = dir * th;
    const m = evaluate(r.prep, app.theta);
    const g = camPoint(f, m, th);
    const R = Math.max(...r.shape.surface.map((p) => Math.hypot(p.x, p.y)));
    const sel = app.ui.selectedSegment;

    // cam body
    const body = r.shape.surface.map((p) => rot(p, alpha));
    polyline(ctx, v, body, true);
    ctx.fillStyle = THEME.cam; ctx.fill();
    ctx.strokeStyle = THEME.camEdge; ctx.lineWidth = 2; ctx.stroke();
    // how it mounts: the bore (keyway, flat), bolt holes, hub outline, set screw; a mark at θ = 0
    const mt = r.mount, hole = (pts) => { polyline(ctx, v, pts.map((p) => rot(p, alpha)), true); ctx.fillStyle = THEME.paper; ctx.fill(); ctx.strokeStyle = THEME.camEdge; ctx.lineWidth = 1.5; ctx.stroke(); };
    if (mt.loop.length) hole(loopPoints(mt.loop));
    if (mt.bolts) for (const b of mt.bolts.at) { circle(ctx, v, rot(b, alpha), mt.bolts.d / 2); ctx.fillStyle = THEME.paper; ctx.fill(); ctx.strokeStyle = THEME.camEdge; ctx.lineWidth = 1.5; ctx.stroke(); }
    if (mt.hub) { ctx.setLineDash([4, 3]); circle(ctx, v, { x: 0, y: 0 }, mt.hub.r); ctx.strokeStyle = THEME.camEdge; ctx.lineWidth = 1.3; ctx.stroke(); ctx.setLineDash([]); }
    const markFrom = mt.R || R * 0.05, markTo = mt.hub ? mt.hub.r : markFrom + R * 0.12;
    if (mt.kind === 'plain' || mt.kind === 'flange' || mt.kind === 'setscrew') {
      const m0 = v.toScreen(rot({ x: 0, y: markFrom }, alpha)), m1 = v.toScreen(rot({ x: 0, y: markTo }, alpha));
      ctx.strokeStyle = THEME.camEdge; ctx.lineWidth = mt.screw ? Math.max(2, mt.screw.d * v.scale) : 3;
      ctx.beginPath(); ctx.moveTo(m0.x, m0.y); ctx.lineTo(m1.x, m1.y); ctx.stroke();
    }
    // the picked segment, in its colour
    if (sel >= 0) {
      const pts = r.samples.map((sm, i) => (sm.segment === sel ? rot(r.shape.surface[i], alpha) : null)).filter(Boolean);
      polyline(ctx, v, pts); ctx.strokeStyle = THEME.segment[sel % THEME.segment.length]; ctx.lineWidth = 5; ctx.stroke();
    }
    // undercut: the follower cannot follow these parts
    const bad = r.shape.rows.map((row, i) => (flat ? row.rhoCam <= 0 : row.rhoPitch > 0 && row.rhoPitch <= f.Rf) ? i : -1).filter((i) => i >= 0);
    if (bad.length) {
      ctx.fillStyle = THEME.warn;
      for (const i of bad) { const s = v.toScreen(rot(r.shape.surface[i], alpha)); ctx.fillRect(s.x - 2, s.y - 2, 4, 4); }
    }
    // base and prime circles, pitch curve
    ctx.setLineDash([6, 4]); ctx.lineWidth = 1.3;
    const Rb = flat ? f.Rb : f.Rp - f.Rf;
    circle(ctx, v, { x: 0, y: 0 }, Rb); ctx.strokeStyle = THEME.circles; ctx.stroke();
    if (!flat) { circle(ctx, v, { x: 0, y: 0 }, f.Rp); ctx.strokeStyle = THEME.circles; ctx.globalAlpha = 0.55; ctx.stroke(); ctx.globalAlpha = 1; }
    if (!flat && r.shape.pitch.length) { polyline(ctx, v, r.shape.pitch.map((p) => rot(p, alpha)), true); ctx.strokeStyle = THEME.pitch; ctx.stroke(); }
    if (f.e) { circle(ctx, v, { x: 0, y: 0 }, Math.abs(f.e)); ctx.strokeStyle = THEME.muted; ctx.stroke(); }
    ctx.setLineDash([]);
    // centre
    const o = v.toScreen({ x: 0, y: 0 });
    ctx.fillStyle = THEME.ink; ctx.beginPath(); ctx.arc(o.x, o.y, 3, 0, 2 * Math.PI); ctx.fill();
    // rotation arrow
    arrowArc(ctx, o, Math.min(R * 0.35, 60) * v.scale > 26 ? Math.min(R * 0.35, 60) * v.scale : 26, dir);

    // follower
    const top = (flat ? f.Rb : f.Rp) + r.sMax + (f.Rf || 0) + 0.75 * R;
    const stemX = f.e || 0;
    const foot = flat ? { x: stemX, y: Rb + m.s } : g.followerFixed;
    const guideY = (flat ? f.Rb : f.Rp) + r.sMax + (f.Rf || 0) + 0.18 * R;
    // spring from the follower collar up to the frame
    const collarY = foot.y + (flat ? 0 : f.Rf) + 0.12 * R;
    spring(ctx, v, stemX, collarY, top, 0.09 * R);
    // stem and guide
    const st0 = v.toScreen({ x: stemX, y: foot.y + (flat ? 0 : 0) }), st1 = v.toScreen({ x: stemX, y: top });
    ctx.strokeStyle = THEME.follower; ctx.lineWidth = Math.max(4, 0.05 * R * v.scale); ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(st0.x, st0.y); ctx.lineTo(st1.x, st1.y); ctx.stroke();
    const gw = 0.09 * R * v.scale, gy = v.toScreen({ x: stemX, y: guideY });
    ctx.fillStyle = '#D0D4DA'; ctx.strokeStyle = THEME.ink; ctx.lineWidth = 1.5;
    ctx.fillRect(gy.x - gw - 6, gy.y - 8, 6, 16); ctx.strokeRect(gy.x - gw - 6, gy.y - 8, 6, 16);
    ctx.fillRect(gy.x + gw, gy.y - 8, 6, 16); ctx.strokeRect(gy.x + gw, gy.y - 8, 6, 16);
    // collar
    const cl = v.toScreen({ x: stemX, y: collarY });
    ctx.fillStyle = THEME.follower; ctx.fillRect(cl.x - 0.1 * R * v.scale, cl.y - 3, 0.2 * R * v.scale, 6);
    // ground hatch at the top
    const tp = v.toScreen({ x: stemX, y: top });
    ctx.strokeStyle = THEME.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tp.x - 0.18 * R * v.scale, tp.y); ctx.lineTo(tp.x + 0.18 * R * v.scale, tp.y); ctx.stroke();
    ctx.lineWidth = 1;
    for (let k = -3; k <= 3; k++) { const x = tp.x + k * 0.05 * R * v.scale; ctx.beginPath(); ctx.moveTo(x, tp.y); ctx.lineTo(x + 6, tp.y - 6); ctx.stroke(); }

    if (flat) {
      const half = Math.max(Math.abs(r.shape.armMin - stemX), Math.abs(r.shape.armMax - stemX)) + 0.06 * R;
      const a = v.toScreen({ x: stemX - half, y: foot.y }), b = v.toScreen({ x: stemX + half, y: foot.y });
      ctx.strokeStyle = THEME.follower; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y - 3); ctx.lineTo(b.x, b.y - 3); ctx.stroke();
      // contact point and moment arm
      const cp = v.toScreen(g.contactFixed);
      ctx.fillStyle = THEME.normal; ctx.beginPath(); ctx.arc(cp.x, cp.y, 4, 0, 2 * Math.PI); ctx.fill();
      label(ctx, { x: cp.x, y: cp.y + 18 }, `contact ${fmtSig(U.L.show(g.contactFixed.x - stemX), 3)} ${U.L.label} from the axis`, THEME.normal);
    } else {
      // roller
      circle(ctx, v, g.followerFixed, f.Rf);
      ctx.fillStyle = THEME.roller; ctx.fill(); ctx.strokeStyle = THEME.ink; ctx.lineWidth = 2; ctx.stroke();
      const pc = v.toScreen(g.followerFixed);
      ctx.fillStyle = THEME.ink; ctx.beginPath(); ctx.arc(pc.x, pc.y, 2.5, 0, 2 * Math.PI); ctx.fill();
      // common normal through the roller centre, and the pressure angle to the follower axis
      const n = g.normalFixed, L = 0.55 * R;
      const n0 = v.toScreen({ x: g.followerFixed.x - n.x * (f.Rf + 0.25 * R), y: g.followerFixed.y - n.y * (f.Rf + 0.25 * R) });
      const n1 = v.toScreen({ x: g.followerFixed.x + n.x * L, y: g.followerFixed.y + n.y * L });
      ctx.strokeStyle = THEME.normal; ctx.lineWidth = 1.8; ctx.setLineDash([7, 4]);
      ctx.beginPath(); ctx.moveTo(n0.x, n0.y); ctx.lineTo(n1.x, n1.y); ctx.stroke(); ctx.setLineDash([]);
      const rr = Math.max(28, 0.3 * R * v.scale);
      const a0 = -Math.PI / 2, a1 = Math.atan2(-n.y, n.x);
      ctx.beginPath(); ctx.arc(pc.x, pc.y, rr, Math.min(a0, a1), Math.max(a0, a1)); ctx.stroke();
      label(ctx, { x: pc.x + rr + 8, y: pc.y - rr * 0.8 }, `φ = ${fmt((g.phi * 180) / Math.PI, 1)}°`, THEME.normal, 'left');
      const cp = v.toScreen(g.contactFixed);
      ctx.fillStyle = THEME.normal; ctx.beginPath(); ctx.arc(cp.x, cp.y, 3.5, 0, 2 * Math.PI); ctx.fill();
    }

    info.textContent = `θ = ${fmt(app.theta, 1)}°   s = ${fmtSig(U.L.show(m.s), 4)} ${U.L.label}` + (flat ? '' : `   φ = ${fmt((g.phi * 180) / Math.PI, 1)}°`)
      + `   ρ = ${Number.isFinite(g.rhoCam) ? fmtSig(U.L.show(g.rhoCam), 3) : '∞'} ${U.L.label}`;
    legend.replaceChildren(...[
      h('span', {}, h('span', { class: 'legend-line', style: { borderTopColor: THEME.circles, borderTopStyle: 'dashed' } }), flat ? 'base circle' : 'base and prime circles'),
      flat ? null : h('span', {}, h('span', { class: 'legend-line', style: { borderTopColor: THEME.pitch, borderTopStyle: 'dashed' } }), 'pitch curve (roller centre)'),
      flat ? null : h('span', {}, h('span', { class: 'legend-line', style: { borderTopColor: THEME.normal, borderTopStyle: 'dashed' } }), 'common normal, pressure angle φ'),
      bad.length ? h('span', {}, h('span', { class: 'legend-line', style: { borderTopColor: THEME.warn, borderTopWidth: '4px' } }), 'undercut') : null,
    ].filter(Boolean));
  }

  /** A coil spring between heights y0 and y1 at x (world), coil width w. */
  function spring(ctx, v, x, y0, y1, w) {
    const n = 9, pts = [{ x, y: y0 }];
    for (let k = 1; k < 2 * n; k++) pts.push({ x: x + (k % 2 ? w : -w), y: y0 + ((y1 - y0) * k) / (2 * n) });
    pts.push({ x, y: y1 });
    polyline(ctx, v, pts); ctx.strokeStyle = THEME.spring; ctx.lineWidth = 1.6; ctx.stroke();
  }

  /** Curved arrow round the centre showing which way the cam turns. */
  function arrowArc(ctx, o, r, dir) {
    const a0 = Math.PI * 0.95, a1 = Math.PI * 1.45; // lower left (screen angles)
    ctx.strokeStyle = THEME.ink; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(o.x, o.y, r, a0, a1); ctx.stroke();
    // counter-clockwise on screen (y down) runs towards smaller screen angles
    const end = dir > 0 ? a0 : a1;
    const tip = { x: o.x + r * Math.cos(end), y: o.y + r * Math.sin(end) };
    const tang = end + (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    ctx.fillStyle = THEME.ink; ctx.beginPath();
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
