// =============================================================================
// render.js — draws the four layers on the canvas
// -----------------------------------------------------------------------------
// Order (bottom to top):
//   grid → background image → construction (pencil) → bodies (tinted shapes)
//   → mechanism (links, joints, ground, sliders) → coupler curves
//   → tool overlay (previews, compass, snap marker)
// =============================================================================

import { DRAWING, THEME, LINK_COLORS, TRACE_COLORS, TOLERANCE } from '../config.js';
import { gridSpacing } from '../model/units.js';
import { dynamicsOf, counterweightsOf, counterweightsOn } from '../model/mass.js';
import { forceName, subscript, bodyMasses } from '../model/forces.js';
import { totalCentreOfMass } from '../model/balance.js';
import { magnification, drawLimit, poseFor, studyFor } from '../model/tolerance.js';
import { pointOnBody } from '../kinematics/system.js';
import { jointById } from '../model/document.js';
import { convexHull } from '../../../../packages/core-math/src/index.js';
import { FONT, arrowColor, defaultDisplay } from './display.js';
import { fmtSig } from '../../../../packages/ui-kit/src/format.js';

/** Rail of a slider where it is now (it moves when carried by a link). */
export function railNow(app, s) {
  const t = s.on ? app.sim.transformFor(s.on) : null;
  return t ? { a: t.T(s.a), b: t.T(s.b) } : { a: s.a, b: s.b };
}

/** A local direction of body i turned to the current pose (world for the ground). */
function turnVec(q, i, v) {
  if (i < 0) return v;
  const t = q[3 * i + 2], c = Math.cos(t), s = Math.sin(t);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y };
}

/** A force or torque size for a label: 3 significant figures. */
/** A round length (1, 2 or 5 × 10ⁿ) no longer than v, for scale bars. */
function niceLength(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [5, 2, 1].map((m) => m * p).find((x) => x <= v) || p;
}

function fmtN(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return (a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toPrecision(2)).replace('-', '−');
}

/** Current contact point of a roll / roll-slide pair (world mm). */
export function contactPoint(sim, pr) {
  if (!sim.sys) return null;
  const q = sim.q;
  const P = (i, s) => {
    if (i < 0) return s;
    const c = Math.cos(q[3 * i + 2]), sn = Math.sin(q[3 * i + 2]);
    return { x: q[3 * i] + c * s.x - sn * s.y, y: q[3 * i + 1] + sn * s.x + c * s.y };
  };
  if (pr.shape === 'cc') {
    const Ci = P(pr.i, pr.ci), psi = q[pr.k];
    const sgn = pr.internal ? -1 : 1;
    return { x: Ci.x + sgn * pr.ri * Math.cos(psi), y: Ci.y + sgn * pr.ri * Math.sin(psi) };
  }
  const C = P(pr.c, pr.cL);
  const t = pr.l >= 0 ? q[3 * pr.l + 2] : 0;
  const n = { x: Math.cos(t) * pr.n.x - Math.sin(t) * pr.n.y, y: Math.sin(t) * pr.n.x + Math.cos(t) * pr.n.y };
  return { x: C.x - pr.side * pr.r * n.x, y: C.y - pr.side * pr.r * n.y };
}

/** Unit tangent at the contact (world, y up). */
function contactTangent(sim, pr) {
  const q = sim.q;
  if (pr.shape === 'cc') { const psi = q[pr.k]; return { x: -Math.sin(psi), y: Math.cos(psi) }; }
  const t = pr.l >= 0 ? q[3 * pr.l + 2] : 0;
  return { x: Math.cos(t) * pr.u.x - Math.sin(t) * pr.u.y, y: Math.sin(t) * pr.u.x + Math.cos(t) * pr.u.y };
}

/** A link's colour: the one picked for it in Properties, else automatic by its number. */
export function linkColor(numberMap, linkId) {
  const picked = numberMap.colors && numberMap.colors.get(linkId);
  return picked || autoLinkColor(numberMap, linkId);
}

/** The automatic colour of a link (by its number: 2, 3, 4, …). */
export function autoLinkColor(numberMap, linkId) {
  const n = numberMap.get(linkId) || 2;
  return LINK_COLORS[(n - 2) % LINK_COLORS.length];
}

/** A traced point's coupler-curve colour: the one picked, else the next in TRACE_COLORS. */
export function traceColor(doc, joint) {
  return joint.traceColor || autoTraceColor(doc, joint);
}

export function autoTraceColor(doc, joint) {
  const k = Math.max(0, doc.joints.filter((j) => j.trace).indexOf(joint));
  return TRACE_COLORS[k % TRACE_COLORS.length];
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.images = new Map(); // data URL → HTMLImageElement
    this.ds = defaultDisplay(); // text and arrow size, arrow colours (app.display, set on each draw)
    this.placed = [];           // boxes of the labels drawn so far on this frame (see place)
    this.pending = [];          // value labels to draw on top of the arrows (see placeLabel)
  }

  /** A canvas font at `px` × the chosen text size. */
  font(px, weight = '') {
    return `${weight ? weight + ' ' : ''}${px * this.ds.text}px ${FONT}`;
  }

  /** Arrow colour by kind ('load', 'reaction', 'weight', 'torque'): the chosen one or THEME's. */
  col(kind) { return arrowColor(this.ds, kind); }

  /**
   * Find room for a box of w × hgt centred near p: move it up or down past the
   * boxes already placed on this frame (this.placed), then keep it there.
   * Link numbers, joint names, tags and value labels use it, so bigger text
   * (Sheet › Display) does not pile up.
   */
  place(p, w, hgt) {
    const free = (y) => !this.placed.some((b) => Math.abs(b.x - p.x) < (b.w + w) / 2 && Math.abs(b.y - y) < (b.h + hgt) / 2);
    // try the spot itself, then half a label lower, higher, a whole label lower, …
    let y = p.y;
    for (let i = 1; i <= 16 && !free(y); i++) y = p.y + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * hgt * 0.5;
    if (!free(y)) y = p.y; // no room nearby: keep the spot
    this.placed.push({ x: p.x, y, w, h: hgt });
    return { x: p.x, y };
  }

  /**
   * A value label placed clear of the others (see place). It is drawn later,
   * by drawLabels, so arrows drawn afterwards do not cover it.
   */
  placeLabel(p, text, color) {
    this.ctx.font = this.font(12);
    const k = this.ds.text;
    this.pending.push({ p: this.place(p, this.ctx.measureText(text).width + 8 * k, 18 * k), text, color });
  }

  /** Draw the labels waiting from placeLabel. */
  drawLabels() {
    for (const L of this.pending) this.label(L.p, L.text, L.color);
    this.pending = [];
  }

  /** Make the canvas match its on-screen size (sharp on high-DPI screens). */
  fit() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  draw(app) {
    const { w, h } = this.fit();
    const ctx = this.ctx, view = app.view;
    this.ds = app.display || this.ds;
    this.placed = []; this.pending = [];
    view.resize(w, h);
    ctx.fillStyle = THEME.paper;
    ctx.fillRect(0, 0, w, h);
    if (app.settings.grid) this.drawGrid(view, w, h, app.doc);
    const L = app.doc.layers;
    const layer = (name, fn) => {
      if (!L[name].visible) return;
      ctx.save();
      if (L[name].faded) ctx.globalAlpha = THEME.fadedAlpha;
      fn();
      ctx.restore();
    };
    layer('background', () => this.drawBackground(app));
    layer('construction', () => this.drawConstruction(app));
    layer('bodies', () => this.drawBodies(app));
    layer('mechanism', () => { this.drawTraces(app); this.drawMechanism(app); this.drawTolerancePins(app); this.drawToleranceLens(app); });
    if (app.tool && app.tool.drawOverlay) { ctx.save(); app.tool.drawOverlay(ctx, app); ctx.restore(); }
    this.drawSnapMarker(app);
  }

  // ---- grid -------------------------------------------------------------------
  drawGrid(view, w, h, doc) {
    const ctx = this.ctx;
    // spacing in the drawing's unit; automatic spacing adapts to the zoom
    const g = gridSpacing(doc);
    let minor = g.minor, major = g.major;
    const ratio = major / minor;
    if (!g.fixed) {
      while (minor * view.zoom < 8) { minor *= ratio; major *= ratio; }
      while (minor * view.zoom > 60 && minor > 0.01) { minor /= ratio; major /= ratio; }
    } else {
      // a fixed spacing too fine to see: draw only the major lines
      while (minor * view.zoom < 4) { minor = major; major *= ratio; }
    }
    this.gridMinor = minor; // snapping to the grid uses the lines drawn
    const tl = view.toWorld({ x: 0, y: 0 }), br = view.toWorld({ x: w, y: h });
    const lines = (step, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) {
        const sx = Math.round(view.toScreen({ x, y: 0 }).x) + 0.5;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
      }
      for (let y = Math.ceil(br.y / step) * step; y <= tl.y; y += step) {
        const sy = Math.round(view.toScreen({ x: 0, y }).y) + 0.5;
        ctx.moveTo(0, sy); ctx.lineTo(w, sy);
      }
      ctx.stroke();
    };
    lines(minor, THEME.gridMinor);
    lines(major, THEME.gridMajor);
    // world axes through the origin
    const o = view.toScreen({ x: 0, y: 0 });
    ctx.strokeStyle = THEME.axis;
    ctx.beginPath();
    ctx.moveTo(Math.round(o.x) + 0.5, 0); ctx.lineTo(Math.round(o.x) + 0.5, h);
    ctx.moveTo(0, Math.round(o.y) + 0.5); ctx.lineTo(w, Math.round(o.y) + 0.5);
    ctx.stroke();
  }

  // ---- background image -------------------------------------------------------
  drawBackground(app) {
    const bg = app.doc.background;
    if (!bg || !bg.image) return;
    let img = this.images.get(bg.image);
    if (!img) {
      img = new Image();
      img.onload = () => app.requestRender();
      img.src = bg.image;
      this.images.set(bg.image, img);
    }
    if (!img.complete || !img.naturalWidth) return;
    const ctx = this.ctx, s = app.view.toScreen({ x: bg.x, y: bg.y });
    ctx.save();
    ctx.globalAlpha *= bg.opacity;
    ctx.translate(s.x, s.y);
    ctx.rotate(-bg.rotation);
    const k = bg.mmPerPx * app.view.zoom;
    ctx.scale(k, k);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  // ---- construction layer -------------------------------------------------------
  drawConstruction(app) {
    const ctx = this.ctx, view = app.view;
    const selected = app.selection && app.selection.kind === 'construction' ? app.selection.id : null;
    for (const e of app.currentConstruction()) {
      const isSel = e.id === selected;
      ctx.strokeStyle = isSel ? THEME.select : THEME.graphite;
      ctx.fillStyle = isSel ? THEME.select : THEME.graphite;
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.setLineDash([]);
      switch (e.kind) {
        case 'point': this.cross(view.toScreen(e.p), 4); break;
        case 'segment': {
          const a = view.toScreen(e.a), b = view.toScreen(e.b);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          break;
        }
        case 'xline': {
          const a = view.toScreen(e.a), b = view.toScreen(e.b);
          const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
          const far = 1e4;
          ctx.strokeStyle = isSel ? THEME.select : THEME.graphiteLight;
          ctx.setLineDash([10, 4, 2, 4]);
          ctx.beginPath();
          ctx.moveTo(a.x - (dx / L) * far, a.y - (dy / L) * far);
          ctx.lineTo(a.x + (dx / L) * far, a.y + (dy / L) * far);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        case 'circle':
        case 'arc': {
          const c = view.toScreen(e.c), r = e.r * view.zoom;
          ctx.beginPath();
          if (e.kind === 'circle') ctx.arc(c.x, c.y, r, 0, 2 * Math.PI);
          else ctx.arc(c.x, c.y, r, -e.a0, -(e.a0 + e.sweep), e.sweep > 0);
          ctx.stroke();
          this.cross(c, 3, 0.6);
          break;
        }
        case 'dim': this.drawDimension(e, isSel, app); break;
        default: break;
      }
    }
  }

  cross(s, r, alpha = 1) {
    const ctx = this.ctx;
    ctx.save(); ctx.globalAlpha *= alpha;
    ctx.beginPath();
    ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y + r);
    ctx.moveTo(s.x - r, s.y + r); ctx.lineTo(s.x + r, s.y - r);
    ctx.stroke(); ctx.restore();
  }

  drawDimension(e, isSel, app) {
    const ctx = this.ctx, view = app.view;
    const a = view.toScreen(e.a), b = view.toScreen(e.b);
    const L = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
    const ang = (Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x) * 180) / Math.PI;
    ctx.strokeStyle = isSel ? THEME.select : THEME.ink;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    // arrow heads
    const dir = Math.atan2(b.y - a.y, b.x - a.x);
    for (const [p, d] of [[a, dir + Math.PI], [b, dir]]) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 8 * Math.cos(d - 0.3), p.y - 8 * Math.sin(d - 0.3));
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 8 * Math.cos(d + 0.3), p.y - 8 * Math.sin(d + 0.3));
      ctx.stroke();
    }
    const text = `${app.units.fmt(L)}  ∠${ang.toFixed(1)}°`.replace(/-/g, '−');
    this.label({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 10 }, text, isSel ? THEME.select : THEME.ink);
  }

  label(p, text, color = THEME.ink, bg = 'rgba(244,245,241,0.9)') {
    const ctx = this.ctx, k = this.ds.text;
    ctx.font = this.font(12);
    const w = ctx.measureText(text).width + 8 * k;
    ctx.fillStyle = bg;
    ctx.fillRect(p.x - w / 2, p.y - 9 * k, w, 18 * k);
    ctx.fillStyle = color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, p.x, p.y);
  }

  // ---- bodies (outlines attached to links) ------------------------------------------
  drawBodies(app) {
    const ctx = this.ctx, view = app.view, nums = app.linkNumbers();
    const selected = app.selection && app.selection.kind === 'body' ? app.selection.id : null;
    for (const b of app.currentBodies()) {
      if (b.pts.length < 2) continue;
      const color = b.attach ? linkColor(nums, b.attach) : THEME.graphite;
      ctx.beginPath();
      b.pts.forEach((p, i) => { const s = view.toScreen(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      if (b.closed) ctx.closePath();
      ctx.save();
      ctx.globalAlpha *= THEME.bodyAlpha;
      ctx.fillStyle = color;
      if (b.closed) ctx.fill();
      ctx.restore();
      ctx.strokeStyle = b.id === selected ? THEME.select : color;
      ctx.lineWidth = b.id === selected ? 2.5 : 1.5;
      ctx.stroke();
    }
  }

  // ---- coupler curves ---------------------------------------------------------------
  /**
   * Tolerance (Advanced), the play drawn larger (Tolerance › Play drawn), always
   * while the tab is open: each pin in its hole (a ring), and a dashed copy of
   * the mechanism with every pin where a push by hand sends it, else where the
   * load puts it, else (forces off) pushed the way that moves the checked
   * target most. Drawn k times larger.
   */
  /**
   * Where a joint of the drawn-larger copy sits: each point moved k times its
   * first-order displacement (as the magnifier has it); turning a link by
   * k·δφ instead would swing a short link along its arc and put the point on
   * the wrong side when k·δφ is large. Returns (bodyIndex, jointId) → world mm.
   */
  shiftedPoint(app, v) {
    const { k, now } = v;
    const sys = app.sim.sys, q = app.sim.q, doc = app.doc;
    const dq = now.dqLoaded || now.dqWorst;
    return (b, id) => {
      if (b < 0) return jointById(doc, id);
      const s = sys.bodies[b].local.get(id), P = pointOnBody(q, b, s);
      const c = Math.cos(q[3 * b + 2]), sn = Math.sin(q[3 * b + 2]), dphi = dq[3 * b + 2];
      return { x: P.x + k * (dq[3 * b] - dphi * (sn * s.x + c * s.y)), y: P.y + k * (dq[3 * b + 1] + dphi * (c * s.x - sn * s.y)) };
    };
  }

  drawTolerancePins(app) {
    const v = this.toleranceView(app);
    if (!v) return;   // always while the Tolerance tab is open (see toleranceView)
    const { t, k, now } = v;
    const sim = app.sim, sys = sim.sys, view = app.view, doc = app.doc, ctx = this.ctx;
    const on = this.shiftedPoint(app, v);
    const col = TOLERANCE.zoneColor;
    ctx.save();
    // the shifted mechanism: link centre lines, dashed
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.lineCap = 'round';
    for (const link of doc.links) {
      const b = sys.bodyIndex.get(link.id);
      if (b === undefined) continue;
      const pts = link.joints.filter((id) => sys.bodies[b].local.has(id)).map((id) => view.toScreen(on(b, id)));
      if (pts.length < 2) continue;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (pts.length > 2) ctx.closePath();
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // each pin in its hole: the hole on one link (ring), the pin on the other (dot)
    const rp = DRAWING.jointRadiusPx * 0.8;
    for (const p of now.parts) {
      if (p.kind !== 'pin') continue;
      const gap = p.r * view.zoom * k;
      const holeC = view.toScreen(p.j < 0 ? { x: jointById(doc, p.joint).x, y: jointById(doc, p.joint).y } : on(p.j, p.joint));
      const pinC = view.toScreen(on(p.i, p.joint));
      ctx.beginPath(); ctx.arc(holeC.x, holeC.y, rp + gap, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); ctx.arc(pinC.x, pinC.y, rp, 0, 2 * Math.PI);
      ctx.fillStyle = col; ctx.fill();
    }
    ctx.restore();
    const text = `${now.pushed ? 'Pins where your push puts them' : now.dqLoaded ? 'Pins where the load puts them' : 'Pins at their worst'} · drawn ${k}×`;
    const kt = this.ds.text;
    ctx.font = this.font(12);
    const tw = ctx.measureText(text).width + 8 * kt;
    this.label(this.place({ x: 12 * kt + tw / 2, y: 16 * kt }, tw, 18 * kt), text, col);
  }

  /**
   * Tolerance (Advanced), the magnifier: a round window beside the checked
   * point (or the tip of the checked link), magnified so the play can be seen.
   * A point: the zone it can be in now (worst case), its ideal place (centre),
   * where the load puts it over the cycle (line, jumps dashed) and now (dot).
   * An angle or a slider: a scale from −play to +play, where the load puts it
   * over the cycle (ticks) and now (marker).
   */
  drawToleranceLens(app) {
    const v = this.toleranceView(app);
    if (!v || !v.t.lens) return;
    const { now, st } = v;
    const sim = app.sim, view = app.view, doc = app.doc, ctx = this.ctx, U = app.units;
    const kt = Math.min(1.3, this.ds.text);
    const R = TOLERANCE.lens.radiusPx * kt;
    const tg = now.target;
    // where it sits on the drawing
    let anchorId = tg.id;
    if (tg.kind === 'angle') {
      const link = doc.links.find((l) => l.id === tg.link);
      const ground = link.joints.find((id) => (jointById(doc, id) || {}).ground);
      const others = link.joints.filter((id) => id !== ground);
      anchorId = others.length ? others.reduce((best, id) => {
        const p = sim.jointPos(id), g = ground ? sim.jointPos(ground) : sim.jointPos(link.joints[0]);
        const d = Math.hypot(p.x - g.x, p.y - g.y);
        return d > best.d ? { id, d } : best;
      }, { id: others[0], d: -1 }).id : link.joints[0];
    }
    const P = view.toScreen(sim.jointPos(anchorId));
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    if (P.x < 0 || P.y < 0 || P.x > W || P.y > H) return; // the point is off the screen
    // the window's place: the side clear of the links and of the drawn-larger
    // copy (kept while still clear)
    const segs = [];
    const shifted = this.shiftedPoint(app, v);
    for (const link of doc.links) {
      const b = sim.sys.bodyIndex.get(link.id);
      const pts = link.joints.map((id) => view.toScreen(sim.jointPos(id)));
      const pts2 = b === undefined ? [] : link.joints.filter((id) => sim.sys.bodies[b].local.has(id)).map((id) => view.toScreen(shifted(b, id)));
      for (const list of [pts, pts2]) {
        for (let i = 0; i + 1 < list.length; i++) segs.push([list[i], list[i + 1]]);
        if (list.length > 2) segs.push([list[list.length - 1], list[0]]);
      }
    }
    const dSeg = (c, a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / L2));
      return Math.hypot(a.x + u * dx - c.x, a.y + u * dy - c.y);
    };
    const gap = TOLERANCE.lens.gapPx * kt;
    // a place: a direction and a distance; fewer links under the window is
    // better, then nearer the point (and on the screen, with room for the labels)
    const score = (ang, far) => {
      const dist = R + gap * far;
      const c = { x: P.x + dist * Math.cos(ang), y: P.y - dist * Math.sin(ang) };
      let sc = 0;
      for (const [a, b] of segs) if (dSeg(c, a, b) < R + 10) sc += 10;
      if (c.x - R < 4 || c.x + R > W - 4 || c.y - R - 20 * kt < 4 || c.y + R + 20 * kt > H - 4) sc += 1000;
      return { c, sc: sc + far, dist };
    };
    let best = null;
    for (const far of [1, 2, 3.5]) {
      for (let a = 0; a < 16; a++) {
        const ang = (a * Math.PI) / 8 + Math.PI / 4, r = score(ang, far);
        if (!best || r.sc < best.sc) best = { ang, far, ...r };
      }
    }
    // keep the last place while it is as good (so the window does not jump about while playing)
    const prev = this._lens ? score(this._lens.ang, this._lens.far) : null;
    const pick = prev && prev.sc <= best.sc + 0.5 ? { ...this._lens, ...prev } : best;
    this._lens = { ang: pick.ang, far: pick.far };
    const C = pick.c, dist = pick.dist;

    ctx.save();
    // leader: a ring round the point and a line to the window
    ctx.strokeStyle = THEME.ink; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(P.x, P.y, 11 * kt, 0, 2 * Math.PI); ctx.stroke();
    const ux = (C.x - P.x) / dist, uy = (C.y - P.y) / dist;
    ctx.beginPath(); ctx.moveTo(P.x + ux * 11 * kt, P.y + uy * 11 * kt); ctx.lineTo(C.x - ux * R, C.y - uy * R); ctx.stroke();
    // the window
    ctx.beginPath(); ctx.arc(C.x, C.y, R, 0, 2 * Math.PI);
    ctx.fillStyle = '#FFFFFF'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = THEME.ink; ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.arc(C.x, C.y, R - 1.5, 0, 2 * Math.PI); ctx.clip();
    const jn = (id) => `J${doc.joints.findIndex((j) => j.id === id) + 1}`;
    let title = '', foot = '';
    const knocks = st && st.knocks ? st.knocks : [];
    const inputDeg = (k) => `${Math.round(app.inputShown(st.samples[k].theta))}${sim.inputIsAngle ? '°' : ''}`;
    if (tg.kind === 'point') {
      // mm → pixels: the zone (and the loaded line) fill the window
      const loadedPts = st && st.loaded ? st.loaded.filter((p) => p && Number.isFinite(p.x)) : [];
      const Rmm = Math.max(1e-9, ...now.zone.map((z) => Math.hypot(z.x, z.y)), ...loadedPts.map((p) => Math.hypot(p.x, p.y)),
        ...(st && st.hull ? st.hull.map((z) => Math.hypot(z.x, z.y)) : [])) * 1.08;
      const sc = (R - 14 * kt) / Rmm;
      const at = (p) => ({ x: C.x + p.x * sc, y: C.y - p.y * sc });
      // crosshair and the zone
      ctx.strokeStyle = '#C9CDD3'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(C.x - R, C.y); ctx.lineTo(C.x + R, C.y); ctx.moveTo(C.x, C.y - R); ctx.lineTo(C.x, C.y + R); ctx.stroke();
      // where it can be over the whole cycle (light), and here (shaded)
      if (st && st.hull) {
        ctx.beginPath(); st.hull.forEach((z, i) => { const q = at(z); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.closePath();
        ctx.strokeStyle = '#9AA1AA'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.beginPath(); now.zone.forEach((z, i) => { const q = at(z); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.closePath();
      ctx.globalAlpha = 0.14; ctx.fillStyle = TOLERANCE.zoneColor; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = TOLERANCE.zoneColor; ctx.lineWidth = 1.3; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
      // under the load over the cycle: a line, jumps dashed
      if (st && st.loaded) {
        const jumpAt = Rmm * 0.25;
        for (let k = 1; k < st.loaded.length; k++) {
          const a = st.loaded[k - 1], b = st.loaded[k];
          if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) continue;
          const jump = Math.hypot(b.x - a.x, b.y - a.y) > jumpAt;
          const A = at(a), B = at(b);
          ctx.strokeStyle = jump ? TOLERANCE.knockColor : TOLERANCE.loadColor; ctx.lineWidth = jump ? 1.3 : 2.4;
          ctx.setLineDash(jump ? [3, 3] : []);
          ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      // the ideal place, and where the point is now: as the dashed drawing has it
      // (your push, else the load, else every pin at its worst side)
      ctx.fillStyle = THEME.ink; ctx.beginPath(); ctx.arc(C.x, C.y, 3 * kt, 0, 2 * Math.PI); ctx.fill();
      const here = now.loaded || now.worst;
      if (here) {
        const q = at(here);
        ctx.beginPath(); ctx.arc(q.x, q.y, 5.5 * kt, 0, 2 * Math.PI);
        ctx.fillStyle = TOLERANCE.loadColor; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#FFFFFF'; ctx.stroke();
      }
      // scale bar
      const barMm = niceLength((R * 0.55) / sc), barPx = barMm * sc;
      ctx.strokeStyle = THEME.ink; ctx.lineWidth = 2;
      const by = C.y + R * 0.78;
      ctx.beginPath(); ctx.moveTo(C.x - barPx / 2, by); ctx.lineTo(C.x + barPx / 2, by); ctx.stroke();
      ctx.font = this.font(10); ctx.fillStyle = THEME.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${fmtSig(U.len(barMm), 3)} ${U.label}`, C.x, by - 2);
      const mag = sc / view.zoom;
      // a joint joins two links; the point is measured on the first one (see targetOn)
      const onLink = app.linkNumbers().get(sim.sys.bodies[tg.i].id);
      title = `${jn(tg.id)} on link ${onLink} · ${mag >= 10 ? Math.round(mag).toLocaleString() : mag.toPrecision(2)}× larger`;
      if (!now.loaded) foot = 'Dot: every pin at its worst side';
    } else {
      // a scale from −play to +play (the largest over the cycle, so it stays put)
      const isAng = tg.kind === 'angle';
      const show = (x) => (isAng ? `${(x * 180 / Math.PI).toFixed(Math.abs(x * 180 / Math.PI) < 0.1 ? 3 : 2)}°` : `${fmtSig(U.len(x), 3)} ${U.label}`);
      const big = Math.max(1e-12, ...(st ? st.play.filter(Number.isFinite) : [now.play]));
      const half = R - 22 * kt;
      const sx = (x) => C.x + (x / big) * half;
      const y0 = C.y + 4 * kt;
      // the play here (shaded) and the scale
      ctx.globalAlpha = 0.16; ctx.fillStyle = TOLERANCE.zoneColor;
      ctx.fillRect(sx(-now.play), y0 - 10 * kt, sx(now.play) - sx(-now.play), 20 * kt); ctx.globalAlpha = 1;
      ctx.strokeStyle = TOLERANCE.zoneColor; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2;
      ctx.strokeRect(sx(-now.play), y0 - 10 * kt, sx(now.play) - sx(-now.play), 20 * kt); ctx.setLineDash([]);
      ctx.strokeStyle = THEME.ink; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx(-big), y0); ctx.lineTo(sx(big), y0); ctx.stroke();
      for (const x of [-big, 0, big]) { ctx.beginPath(); ctx.moveTo(sx(x), y0 - 6 * kt); ctx.lineTo(sx(x), y0 + 6 * kt); ctx.stroke(); }
      ctx.font = this.font(10); ctx.fillStyle = THEME.ink; ctx.textBaseline = 'top';
      ctx.textAlign = 'center'; ctx.fillText('0', sx(0), y0 + 8 * kt);
      ctx.textAlign = 'left'; ctx.fillText(`−${show(big)}`, sx(-big) - 4 * kt, y0 + 8 * kt);
      ctx.textAlign = 'right'; ctx.fillText(`+${show(big)}`, sx(big) + 4 * kt, y0 + 8 * kt);
      // under the load over the cycle (ticks) and now (marker with its value)
      if (st && st.loaded) {
        ctx.strokeStyle = TOLERANCE.loadColor; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const x of st.loaded) if (Number.isFinite(x)) { ctx.moveTo(sx(x), y0 - 9 * kt); ctx.lineTo(sx(x), y0 + 9 * kt); }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      const here = now.loaded !== null && Number.isFinite(now.loaded) ? now.loaded : now.worst;
      if (Number.isFinite(here)) {
        const x = sx(here);
        ctx.fillStyle = TOLERANCE.loadColor; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y0 - 4 * kt); ctx.lineTo(x - 7 * kt, y0 - 18 * kt); ctx.lineTo(x + 7 * kt, y0 - 18 * kt); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.font = this.font(12, 'bold'); ctx.fillStyle = TOLERANCE.loadColor; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(`${now.loaded !== null && Number.isFinite(now.loaded) ? 'now' : 'worst'} ${here >= 0 ? '+' : '−'}${show(Math.abs(here))}`, C.x, y0 - 24 * kt);
        if (!(now.loaded !== null && Number.isFinite(now.loaded))) foot = 'Every pin at its worst side';
      }
      const nums = app.linkNumbers();
      if (isAng) title = `Link ${nums.get(tg.link)} angle`;
      else {
        const sl = doc.output && doc.output.kind === 'slider' ? doc.sliders.findIndex((x) => x.id === doc.output.slider) : -1;
        title = sl >= 0 ? `Slider ${sl + 1}` : `${jn(tg.id)} ${doc.output && doc.output.kind === 'y' ? 'y' : 'x'}`;
      }
    }
    if (!foot && knocks.length) foot = `knocks at ${knocks.slice().sort((a, b) => a.k - b.k).map((kn) => inputDeg(kn.k)).join(', ')}`;
    ctx.restore();
    // a line under the window: the knocks (or why there is no load)
    if (foot) {
      ctx.font = this.font(11, 'bold');
      const fw = ctx.measureText(foot).width + 10 * kt;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(C.x - fw / 2, C.y + R + 3 * kt, fw, 17 * kt);
      ctx.fillStyle = foot.startsWith('knocks') ? TOLERANCE.knockColor : THEME.ink;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(foot, C.x, C.y + R + 11.5 * kt);
    }
    // title above the window
    ctx.font = this.font(12, 'bold');
    const tw = ctx.measureText(title).width + 10 * kt;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(C.x - tw / 2, C.y - R - 20 * kt, tw, 17 * kt);
    ctx.fillStyle = THEME.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(title, C.x, C.y - R - 11.5 * kt);
    ctx.restore();
    this.placed.push({ x: C.x, y: C.y, w: 2 * R, h: 2 * R + 20 * kt });
  }

  /** What the tolerance drawing needs, or null when it is off. */
  toleranceView(app) {
    const t = app.tolerance;
    if (app.mode !== 'advanced' || !t || !app.sim.sys || !app.sim.drivable) return null;
    if (!app.ui || !app.ui.toleranceOpen || !app.ui.toleranceOpen()) return null;
    const now = poseFor(app);
    if (!now || !(now.play > 0)) return null;
    return { t, k: magnification(t, app.view.zoom, drawLimit(app)), now, st: studyFor(app) };
  }

  drawTraces(app) {
    const traced = app.doc.joints.filter((j) => j.trace);
    if (!traced.length) return;
    const s = app.sim.getSweep();
    if (!s) return;
    const ctx = this.ctx, view = app.view;
    ctx.lineWidth = 1.5; ctx.setLineDash([]);
    for (const j of traced) {
      ctx.strokeStyle = traceColor(app.doc, j);
      ctx.beginPath();
      s.samples.forEach((smp, i) => {
        const r = smp.results.joints.get(j.id);
        if (!r) return;
        const p = view.toScreen(r.pos);
        if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      });
      if (s.fullTurn || s.closed) ctx.closePath();
      ctx.stroke();
    }
  }

  // ---- mechanism -----------------------------------------------------------------------
  drawMechanism(app) {
    const ctx = this.ctx, view = app.view, doc = app.doc, sim = app.sim;
    const nums = app.linkNumbers();
    const W = DRAWING.linkWidthPx;
    const sel = app.selection || {};
    const pos = (id) => view.toScreen(sim.jointPos(id));

    // sliders: a fixed rail is hatched (ground); a rail on a link is a slot
    for (const s of doc.sliders) {
      const rail = railNow(app, s);
      const a = view.toScreen(rail.a), b = view.toScreen(rail.b);
      ctx.strokeStyle = sel.kind === 'slider' && sel.id === s.id ? THEME.select : THEME.ground;
      ctx.lineWidth = 1.5;
      if (s.on) {
        const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L * 5, ny = dx / L * 5;
        ctx.beginPath();
        ctx.moveTo(a.x + nx, a.y + ny); ctx.lineTo(b.x + nx, b.y + ny);
        ctx.moveTo(a.x - nx, a.y - ny); ctx.lineTo(b.x - nx, b.y - ny);
        ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        this.hatchAlong(a, b, W * 0.8);
      }
    }

    // prismatic pairs on the ground: a hatched guide along the axis
    for (const p of doc.pairs) {
      if (p.type !== 'prismatic' || p.guide) continue;
      const a = view.toScreen(p.a), b = view.toScreen(p.b);
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      const ext = 60 / Math.max(L, 1);
      const A = { x: a.x - dx * ext, y: a.y - dy * ext }, B = { x: b.x + dx * ext, y: b.y + dy * ext };
      ctx.strokeStyle = THEME.ground; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      ctx.setLineDash([]);
    }

    // wheels (discs): tinted disc with spokes so the rotation is visible
    for (const link of doc.links) {
      if (!link.disc) continue;
      const c = pos(link.joints[0]);
      const r = link.disc * view.zoom;
      const color = linkColor(nums, link.id);
      const isSel = sel.kind === 'link' && sel.id === link.id;
      const t = sim.transformFor(link.id);
      const phi = t ? t.dphi : 0;
      ctx.save();
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 2 * Math.PI);
      ctx.globalAlpha *= 0.22; ctx.fillStyle = color; ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 2 * Math.PI);
      ctx.strokeStyle = isSel ? THEME.select : color; ctx.lineWidth = isSel ? 4 : 3; ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = -phi - (k * 2 * Math.PI) / 3;
        ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + r * 0.92 * Math.cos(a), c.y + r * 0.92 * Math.sin(a));
      }
      ctx.stroke();
    }

    // links
    for (const link of doc.links) {
      if (link.joints.length < 2) continue;
      const pts = link.joints.map(pos);
      const color = linkColor(nums, link.id);
      const isSel = sel.kind === 'link' && sel.id === link.id;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const path = () => {
        ctx.beginPath();
        if (pts.length === 2) { ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); }
        else {
          const hull = convexHull(pts);
          hull.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.closePath();
        }
      };
      path();
      ctx.strokeStyle = isSel ? THEME.select : THEME.ink;
      ctx.lineWidth = W + 3;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = W;
      ctx.stroke();
      if (pts.length > 2) {
        // a plate: see-through fill so drawings underneath stay visible
        ctx.save(); ctx.globalAlpha *= 0.3; ctx.fillStyle = color; ctx.fill(); ctx.restore();
      }
      // centre lines between joints (show the true link lengths)
      ctx.strokeStyle = pts.length > 2 ? 'rgba(29,36,51,0.45)' : 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 1;
      ctx.setLineDash(pts.length > 2 ? [4, 3] : []);
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        for (let k = i + 1; k < pts.length; k++) { ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[k].x, pts[k].y); }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // slider blocks
    for (const s of doc.sliders) {
      const p = pos(s.joint);
      const rail = railNow(app, s);
      const ang = Math.atan2(-(rail.b.y - rail.a.y), rail.b.x - rail.a.x);
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(ang);
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = THEME.ink; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(-W * 1.3, -W * 0.8, W * 2.6, W * 1.6); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // prismatic pairs: a sleeve on the sliding link, aligned with the axis
    for (const pr of (sim.sys ? sim.sys.pairs : [])) {
      if (pr.type !== 'prismatic') continue;
      const src = doc.pairs.find((x) => x.id === pr.id);
      const t = sim.transformFor(src.slider);
      const c = view.toScreen(t ? t.T(src.a) : src.a);
      const tg = src.guide ? sim.transformFor(src.guide) : null;
      const ang = Math.atan2(-pr.u.y, pr.u.x) - (tg ? tg.dphi : 0);
      const isSel = sel.kind === 'pair' && sel.id === pr.id;
      ctx.save();
      ctx.translate(c.x, c.y); ctx.rotate(ang);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.strokeStyle = isSel ? THEME.select : THEME.ink; ctx.lineWidth = 1.75;
      ctx.beginPath(); ctx.rect(-W * 1.6, -W * 0.75, W * 3.2, W * 1.5); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-W * 2.4, 0); ctx.lineTo(W * 2.4, 0); ctx.setLineDash([3, 3]); ctx.stroke();
      ctx.restore();
    }

    // rolling surfaces drawn on the construction layer (a cam disc, a fixed
    // sun circle, a track) are shown as part of the mechanism
    const used = new Set();
    for (const pr of doc.pairs) if (pr.type !== 'prismatic') for (const r of [pr.a, pr.b]) if (r.kind === 'entity') used.add(r.id);
    for (const e of app.currentConstruction()) {
      if (!used.has(e.id)) continue;
      const color = e.attach ? linkColor(nums, e.attach) : THEME.ground;
      ctx.strokeStyle = color; ctx.lineWidth = 3;
      ctx.beginPath();
      if (e.kind === 'circle' || e.kind === 'arc') {
        const c = view.toScreen(e.c);
        if (e.kind === 'circle') ctx.arc(c.x, c.y, e.r * view.zoom, 0, 2 * Math.PI);
        else ctx.arc(c.x, c.y, e.r * view.zoom, -e.a0, -(e.a0 + e.sweep), e.sweep > 0);
        if (e.attach && e.kind === 'circle') { ctx.save(); ctx.globalAlpha *= 0.18; ctx.fillStyle = color; ctx.fill(); ctx.restore(); }
      } else {
        const a = view.toScreen(e.a), b = view.toScreen(e.b);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      if (!e.attach && e.kind !== 'circle' && e.kind !== 'arc') this.hatchAlong(view.toScreen(e.a), view.toScreen(e.b), 0);
    }

    // contact pairs: the rolling surfaces in ink, the contact point marked
    for (const pr of (sim.sys ? sim.sys.pairs : [])) {
      if (pr.type === 'prismatic') continue;
      const c = contactPoint(sim, pr);
      if (!c) continue;
      const p = view.toScreen(c);
      const isSel = sel.kind === 'pair' && sel.id === pr.id;
      ctx.strokeStyle = isSel ? THEME.select : THEME.ink; ctx.lineWidth = 1.75;
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
      if (pr.type === 'roll') { ctx.fillStyle = isSel ? THEME.select : THEME.ink; ctx.fill(); }
      else { ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }
      if (pr.type === 'rollslide') {
        // two short strokes along the tangent: "can slip"
        const tw = contactTangent(sim, pr);
        const ts = { x: tw.x, y: -tw.y };          // tangent on screen (y down)
        const ns = { x: -ts.y, y: ts.x };          // normal on screen
        ctx.beginPath();
        for (const o of [-1, 1]) {
          const cx = p.x + ns.x * 9 * o, cy = p.y + ns.y * 9 * o;
          ctx.moveTo(cx - ts.x * 7, cy - ts.y * 7);
          ctx.lineTo(cx + ts.x * 7, cy + ts.y * 7);
        }
        ctx.stroke();
      }
    }

    // ground pivots
    for (const j of doc.joints) if (j.ground) this.groundSymbol(pos(j.id));

    // joints
    for (const j of doc.joints) {
      const p = pos(j.id);
      const isSel = sel.kind === 'joint' && sel.id === j.id;
      ctx.beginPath();
      ctx.arc(p.x, p.y, DRAWING.jointRadiusPx, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.strokeStyle = isSel ? THEME.select : THEME.ink;
      ctx.lineWidth = isSel ? 3 : 1.75;
      ctx.stroke();
      if (j.trace) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 2 * Math.PI);
        ctx.fillStyle = traceColor(app.doc, j); ctx.fill();
      }
    }

    // linear actuators: a cylinder (barrel) and a rod that telescopes
    const drv = doc.driver || {};
    for (const u of doc.actuators || []) {
      const A = sim.jointPos(u.a), B = sim.jointPos(u.b);
      if (!A || !B) continue;
      const isSel = sel.kind === 'actuator' && sel.id === u.id;
      const isInput = drv.type === 'linear' && drv.actuator === u.id;
      this.actuator(view.toScreen(A), view.toScreen(B), u, view.zoom, isSel, isInput);
      for (const p of [A, B]) {
        const s = view.toScreen(p);
        ctx.beginPath(); ctx.arc(s.x, s.y, DRAWING.jointRadiusPx, 0, 2 * Math.PI);
        ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = THEME.ink; ctx.lineWidth = 1.75; ctx.stroke();
      }
    }

    // link numbers and joint names are drawn last (on top); keep their places
    // free so tags and value labels go elsewhere
    const kt = this.ds.text;
    const linkCentre = (link) => {
      const pts = link.joints.map(pos);
      return pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, y: s.y + p.y / pts.length }), { x: 0, y: 0 });
    };
    if (app.settings.linkNumbers) for (const link of doc.links) { const c = linkCentre(link); this.placed.push({ x: c.x, y: c.y, w: 20 * kt, h: 20 * kt }); }
    if (app.settings.jointNames) {
      ctx.font = this.font(11, 600);
      doc.joints.forEach((j, i) => {
        const p = pos(j.id), w = ctx.measureText(`J${i + 1}`).width;
        this.placed.push({ x: p.x + 8 + w / 2, y: p.y - 7 - 6 * kt, w, h: 13 * kt });
      });
    }

    // the input: a motor symbol, or a tag on the actuator / slider / prismatic joint
    if (sim.drivable) {
      const type = drv.type || 'rotary';
      if (type === 'rotary' && drv.pivot) this.motorSymbol(app, pos(drv.pivot), drv);
      else if (type === 'linear') {
        const u = doc.actuators.find((x) => x.id === drv.actuator);
        if (u) { const a = pos(u.a), b = pos(u.b); this.tag({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 18 }, 'input', THEME.input); }
      } else if (type === 'slider') {
        const s = doc.sliders.find((x) => x.id === drv.slider);
        if (s) { const p = pos(s.joint); this.tag({ x: p.x, y: p.y - 24 }, 'input', THEME.input); }
      } else if (type === 'prismatic') {
        const p = doc.pairs.find((x) => x.id === drv.pair);
        const t = p && sim.transformFor(p.slider);
        if (t) { const c = view.toScreen(t.T(p.a)); this.tag({ x: c.x, y: c.y - 24 }, 'input', THEME.input); }
      }
    }

    // the output
    const out = app.output && app.output();
    if (out && sim.drivable) {
      let at = null;
      if (out.kind === 'angle') {
        const l = doc.links.find((x) => x.id === out.link);
        if (l) { const pts = l.joints.map(pos); at = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, y: s.y + p.y / pts.length }), { x: 0, y: 0 }); at.y += 22; }
      } else if (out.kind === 'x' || out.kind === 'y') { const p = pos(out.joint); at = { x: p.x, y: p.y + 22 }; }
      else if (out.kind === 'slider') { const s = doc.sliders.find((x) => x.id === out.slider); if (s) { const p = pos(s.joint); at = { x: p.x, y: p.y + 26 }; } }
      else if (out.kind === 'stroke') { const u = doc.actuators.find((x) => x.id === out.actuator); if (u) { const a = pos(u.a), b = pos(u.b); at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 20 }; } }
      if (at) this.tag(at, 'output', THEME.output);
    }

    // at a toggle or stationary position: a dashed line through the links
    // that are in line, and a tag naming the position
    const sp = app.settings.specialPositions && sim.special;
    if (sp) this.specialIndicator(app, sp, pos);

    // external loads, and (with force analysis on) centres of mass and forces
    this.drawLoads(app);
    if (app.forcesOn()) this.drawForces(app);
    this.drawBalance(app);
    this.drawLabels();

    // link numbers (Norton numbering) — colour is never the only cue;
    // a locked link also shows a small padlock
    if (app.settings.linkNumbers) {
      for (const link of doc.links) {
        const c = linkCentre(link);
        this.badge(c, String(nums.get(link.id)), linkColor(nums, link.id));
        if (link.locked || doc.lockDesign) this.padlock({ x: c.x + 13 * this.ds.text, y: c.y - 9 * this.ds.text });
      }
    }

    // joint names (J1, J2, …) — the same names as in the exported data
    if (app.settings.jointNames) {
      const ctx = this.ctx;
      const k = this.ds.text;
      ctx.font = this.font(11, 600);
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.lineJoin = 'round';
      doc.joints.forEach((j, i) => {
        const p = pos(j.id);
        const text = `J${i + 1}`;
        ctx.lineWidth = 3.5 * k; ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.strokeText(text, p.x + 8, p.y - 7);
        ctx.fillStyle = THEME.ink;
        ctx.fillText(text, p.x + 8, p.y - 7);
      });
    }
  }

  /** A hydraulic cylinder from screen point a (barrel end) to b (rod end). */
  actuator(a, b, u, zoom, selected, isInput) {
    const ctx = this.ctx;
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const barrel = Math.max(20, Math.min(L * 0.62, u.min * zoom * 0.95));
    const W = DRAWING.linkWidthPx;
    ctx.save();
    ctx.translate(a.x, a.y); ctx.rotate(Math.atan2(uy, ux));
    // rod
    ctx.fillStyle = '#C7CDD5'; ctx.strokeStyle = THEME.ink; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.rect(barrel * 0.5, -W * 0.22, L - barrel * 0.5, W * 0.44); ctx.fill(); ctx.stroke();
    // barrel
    const g = ctx.createLinearGradient(0, -W * 0.6, 0, W * 0.6);
    g.addColorStop(0, '#E9EDF1'); g.addColorStop(0.5, isInput ? '#9FB8E6' : '#AEB6C1'); g.addColorStop(1, '#6F7A88');
    ctx.fillStyle = g;
    ctx.strokeStyle = selected ? THEME.select : THEME.ink; ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.beginPath(); ctx.roundRect(-W * 0.3, -W * 0.6, barrel + W * 0.3, W * 1.2, 3); ctx.fill(); ctx.stroke();
    // gland at the barrel mouth
    ctx.fillStyle = '#4E5562';
    ctx.fillRect(barrel - 3, -W * 0.6, 3, W * 1.2);
    ctx.restore();
  }

  /** Motor symbol at a pivot: a circled M with an arrow showing the turning direction. */
  motorSymbol(app, p, drv) {
    const ctx = this.ctx;
    const dir = (app.doc.motion.omega >= 0) !== !!app.doc.motion.reverse ? 1 : -1;
    const r = 24;
    ctx.strokeStyle = THEME.input; ctx.lineWidth = 2;
    const a0 = -app.sim.theta + 0.5, a1 = a0 + 1.6;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, a0, a1); ctx.stroke();
    const end = dir > 0 ? a0 : a1;
    const tip = { x: p.x + r * Math.cos(end), y: p.y + r * Math.sin(end) };
    const tang = end + (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - 8 * Math.cos(tang - 0.45), tip.y - 8 * Math.sin(tang - 0.45));
    ctx.lineTo(tip.x - 8 * Math.cos(tang + 0.45), tip.y - 8 * Math.sin(tang + 0.45));
    ctx.closePath(); ctx.fillStyle = THEME.input; ctx.fill();
    // the "M" disc sits below-left of the pivot, out of the way of the links
    const m = { x: p.x - 26, y: p.y + 26 };
    ctx.beginPath(); ctx.arc(m.x, m.y, 9 * this.ds.text, 0, 2 * Math.PI);
    ctx.fillStyle = THEME.input; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = this.font(10, 700);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('M', m.x, m.y + 0.5);
    void drv;
  }

  /**
   * Toggle (input at its limit) or stationary (output at rest) position: find
   * pairs of links that meet at a joint and lie in one straight line, draw a
   * dashed line through them, and label it.
   */
  specialIndicator(app, sp, pos) {
    const ctx = this.ctx, doc = app.doc;
    const color = sp.kind === 'toggle' ? THEME.input : THEME.output;
    const label = sp.kind === 'toggle' ? 'toggle' : 'stationary';
    const lines = [];
    const tol = Math.sin(1.2 * Math.PI / 180);
    for (const j of doc.joints) {
      const ls = doc.links.filter((l) => !l.disc && l.joints.includes(j.id));
      const J = pos(j.id);
      for (let a = 0; a < ls.length; a++) for (let b = a + 1; b < ls.length; b++) {
        for (const ja of ls[a].joints) for (const jb of ls[b].joints) {
          if (ja === j.id || jb === j.id || ja === jb) continue;
          const A = pos(ja), B = pos(jb);
          const ux = A.x - J.x, uy = A.y - J.y, vx = B.x - J.x, vy = B.y - J.y;
          const la = Math.hypot(ux, uy), lb = Math.hypot(vx, vy);
          if (la < 1 || lb < 1) continue;
          if (Math.abs(ux * vy - uy * vx) / (la * lb) < tol) lines.push([A, B, J]);
        }
      }
    }
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
    for (const [A, B] of lines) {
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, e = 18 / L;
      ctx.beginPath(); ctx.moveTo(A.x - dx * e, A.y - dy * e); ctx.lineTo(B.x + dx * e, B.y + dy * e); ctx.stroke();
    }
    ctx.restore();
    let at;
    if (lines.length) {
      // beside the line, a little off it, on its upper side
      const [A, B] = lines[0];
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
      let nx = -dy / L, ny = dx / L;
      if (ny > 0) { nx = -nx; ny = -ny; }
      at = { x: A.x + dx * 0.3 + nx * 26, y: A.y + dy * 0.3 + ny * 26 };
    }
    else {
      const pts = doc.joints.filter((j) => !j.ground).map((j) => pos(j.id));
      at = pts.length ? { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: Math.min(...pts.map((p) => p.y)) - 30 } : { x: 40, y: 40 };
    }
    this.tag(at, label, color);
  }

  // ---- forces --------------------------------------------------------------------

  /** An arrow from screen point p along screen vector v, with an optional label at its end. */
  arrow(p, v, color, { dashed = false, label = null, width = 2.5, head = 10 } = {}) {
    const ctx = this.ctx, L = Math.hypot(v.x, v.y);
    width *= this.ds.arrow; head *= this.ds.arrow;
    if (L < 1) return;
    const b = { x: p.x + v.x, y: p.y + v.y }, ang = Math.atan2(v.y, v.x);
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    if (dashed) ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(b.x - Math.cos(ang) * head * 0.6, b.y - Math.sin(ang) * head * 0.6); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(ang - 0.38), b.y - head * Math.sin(ang - 0.38));
    ctx.lineTo(b.x - head * Math.cos(ang + 0.38), b.y - head * Math.sin(ang + 0.38));
    ctx.closePath(); ctx.fill();
    ctx.restore();
    if (label) this.placeLabel({ x: b.x + Math.cos(ang) * 6 + (Math.cos(ang) >= 0 ? 4 : -4), y: b.y + Math.sin(ang) * 6 - 4 }, label, color);
  }

  /**
   * A curved arrow round screen point p: a torque (ccw > 0). The arc leaves
   * a gap centred at screen angle `gap` (radians, 0 = to the right).
   */
  torque(p, value, color, label, r = 20, gap = 0) {
    const ctx = this.ctx, ccw = value >= 0, k = this.ds.arrow;
    // screen y points down: counter-clockwise on paper is clockwise on screen
    const a0 = Math.PI * 0.15 - gap, a1 = Math.PI * 1.65 - gap;
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.2 * k;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, -a0, -a1, true); ctx.stroke();
    const end = ccw ? -a1 : -a0;
    const tip = { x: p.x + r * Math.cos(end), y: p.y + r * Math.sin(end) };
    const tang = end + (ccw ? -Math.PI / 2 : Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(tip.x + 8 * k * Math.cos(tang), tip.y + 8 * k * Math.sin(tang));
    ctx.lineTo(tip.x + 4 * k * Math.cos(tang + 2.2), tip.y + 4 * k * Math.sin(tang + 2.2));
    ctx.lineTo(tip.x + 4 * k * Math.cos(tang - 2.2), tip.y + 4 * k * Math.sin(tang - 2.2));
    ctx.closePath(); ctx.fill();
    ctx.restore();
    if (label) this.placeLabel({ x: p.x + r + 6, y: p.y - r - 2 }, label, color);
  }

  /** External forces and torques, each with its size. */
  drawLoads(app) {
    const sel = app.selection || {};
    const U = app.units; // sizes in the chosen force and torque units
    for (const f of app.doc.loads || []) {
      const g = app.loadGlyph(f);
      if (!g) continue;
      const isSel = sel.kind === 'load' && sel.id === f.id;
      const color = isSel ? THEME.select : this.col('load');
      const prof = f.profile && f.profile.type && f.profile.type !== 'constant' ? ' ~' : '';
      if (g.kind === 'torque') this.torque(g.p, f.T || 0, color, `${fmtN(U.T.show(Math.abs(f.T || 0)))} ${U.T.label}${prof}`, g.r);
      else {
        this.arrow(g.p, { x: g.tip.x - g.p.x, y: g.tip.y - g.p.y }, color, { label: `${fmtN(U.F.show(Math.hypot(f.F.x, f.F.y)))} ${U.F.label}${prof}`, width: isSel ? 3.5 : 2.8 });
        const ctx = this.ctx;
        ctx.beginPath(); ctx.arc(g.p.x, g.p.y, 3.5 * this.ds.arrow, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill();
      }
    }
  }

  /**
   * Balancing: counterweights on their links (a disc on a rod from the pivot,
   * dashed when switched off for comparison), and, when asked, the total
   * centre of mass of the mechanism with its path over the cycle.
   */
  drawBalance(app) {
    const ctx = this.ctx, view = app.view, sim = app.sim, doc = app.doc;
    const on = counterweightsOn(doc);
    for (const link of doc.links) {
      for (const c of counterweightsOf(doc, link)) {
        const t = sim.transformFor(link.id);
        const p = view.toScreen(t ? t.T(c.p) : c.p);
        const o = view.toScreen(sim.jointPos(c.cw.from));
        const r = Math.max(6, Math.min(26, 6 + 5 * Math.cbrt(c.m)));
        ctx.save();
        ctx.setLineDash(on ? [] : [4, 3]);
        ctx.strokeStyle = THEME.ink; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
        if (on) { ctx.fillStyle = THEME.counterweight; ctx.fill(); }
        ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
      }
    }
    if (!(doc.balance && doc.balance.showCM) || !sim.drivable) return;
    if (!sim._masses) sim._masses = bodyMasses(sim);
    const s = sim.getSweep();
    // the path over the cycle changes only with the sweep (or the masses), not every frame
    if (s && (!this._cmPath || this._cmPath.sweep !== s || this._cmPath.masses !== sim._masses)) {
      this._cmPath = { sweep: s, masses: sim._masses, path: s.samples.map((smp) => totalCentreOfMass(sim, sim._masses, smp.q)).filter(Boolean) };
    }
    const path = (s && this._cmPath && this._cmPath.path) || [];
    ctx.save();
    ctx.strokeStyle = THEME.output; ctx.lineWidth = 1.6; ctx.setLineDash([2, 3]);
    ctx.beginPath();
    path.forEach((g, i) => { const q = view.toScreen(g); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    ctx.stroke();
    ctx.setLineDash([]);
    const now = totalCentreOfMass(sim, sim._masses, sim.q);
    if (now) {
      const c = view.toScreen(now);
      ctx.beginPath(); ctx.arc(c.x, c.y, 9, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = THEME.output; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = THEME.output;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, 9, -Math.PI / 2, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, 9, Math.PI / 2, Math.PI); ctx.closePath(); ctx.fill();
      this.label({ x: c.x + 12, y: c.y - 14 }, 'G total', THEME.output);
    }
    ctx.restore();
  }

  /**
   * With force analysis on: centre-of-mass marks on every link, and either the
   * free-body diagram of the selected link, or the forces from the ground.
   */
  drawForces(app) {
    const U = app.units; // sizes in the chosen force and torque units
    const ctx = this.ctx, view = app.view, sim = app.sim;
    const r = app.forcesNow();
    if (!sim.sys) return;
    const masses = sim._masses || [];
    // centre-of-mass symbols (a quartered circle)
    sim.sys.bodies.forEach((b, i) => {
      const mp = masses[i];
      if (!mp) return;
      const t = sim.transformFor(b.id);
      const c = view.toScreen(t ? t.T(mp.props.cg) : mp.props.cg);
      ctx.save();
      ctx.beginPath(); ctx.arc(c.x, c.y, 6, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = THEME.ink; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.fillStyle = THEME.ink;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, 6, -Math.PI / 2, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, 6, Math.PI / 2, Math.PI); ctx.closePath(); ctx.fill();
      ctx.restore();
    });
    if (!r) return;
    const sel = app.selection || {};
    const at = (jointId) => view.toScreen(sim.jointPos(jointId));
    const arrows = []; // { p (screen), F (N, world), color, dashed, label }
    const torques = [];
    // linear actuators push along their line (+ pushes the two ends apart)
    const actForces = [];
    for (const a of sim.sys.actuators || []) {
      const push = a.isInput ? (r.input && r.input.force) : (r.actuators.find((x) => x.id === a.id) || {}).push;
      if (!Number.isFinite(push)) continue;
      const A = sim.jointPos(a.a), B = sim.jointPos(a.b);
      const L = Math.hypot(B.x - A.x, B.y - A.y) || 1, u = { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
      actForces.push({ end: a.ends[1].o, joint: a.b, F: { x: push * u.x, y: push * u.y } });
      actForces.push({ end: a.ends[0].o, joint: a.a, F: { x: -push * u.x, y: -push * u.y } });
    }
    // names in the textbook convention: F₃₂ is the force of link 3 on link 2
    const nums = app.linkNumbers();
    const num = (b) => (b < 0 ? 1 : nums.get(sim.sys.bodies[b].id));
    const Fname = (from, on) => forceName(num(from), num(on)).text;
    if (sel.kind === 'link' && sim.sys.bodyIndex.has(sel.id)) {
      // free-body diagram of the selected link
      const i = sim.sys.bodyIndex.get(sel.id);
      const n = subscript(num(i));
      for (const p of r.pins) {
        if (p.i === i) arrows.push({ p: at(p.joint), F: p.F, label: Fname(p.j, i) });
        else if (p.j === i) arrows.push({ p: at(p.joint), F: { x: -p.F.x, y: -p.F.y }, label: Fname(p.i, i) });
      }
      for (const s of r.sliders) {
        if (s.i === i) arrows.push({ p: at(s.joint), F: s.F, label: Fname(s.j, i) });
        else if (s.j === i) arrows.push({ p: at(s.joint), F: { x: -s.F.x, y: -s.F.y }, label: Fname(s.i, i) });
      }
      for (const a of actForces) if (a.end === i) arrows.push({ p: at(a.joint), F: a.F, label: 'F cylinder' });
      // prismatic pairs: normal force at the sliding axis, and the locking moment
      for (const pr of r.prismatic) {
        if (pr.i !== i && pr.j !== i) continue;
        const src = app.doc.pairs.find((x) => x.id === pr.id);
        const t = src && sim.transformFor(src.slider);
        if (!t) continue;
        const pt = view.toScreen(t.T(src.a)), sgn = pr.i === i ? 1 : -1;
        const other = pr.i === i ? pr.j : pr.i;
        arrows.push({ p: pt, F: { x: sgn * pr.F.x, y: sgn * pr.F.y }, label: Fname(other, i) });
        if (Math.abs(pr.M) > 1e-9) torques.push({ p: pt, T: sgn * pr.M, color: this.col('reaction'), label: `M${subscript(num(other))}${subscript(num(i))} = ${fmtN(U.T.show(Math.abs(pr.M)))} ${U.T.label}` });
      }
      // rolling contacts: the contact force at the contact point
      for (const c of r.contacts) {
        if (c.i !== i && c.j !== i) continue;
        const pr = sim.sys.pairs.find((x) => x.id === c.id);
        const cp = pr && contactPoint(sim, pr);
        if (!cp) continue;
        const sgn = c.i === i ? 1 : -1;
        arrows.push({ p: view.toScreen(cp), F: { x: sgn * c.F.x, y: sgn * c.F.y }, label: Fname(c.i === i ? c.j : c.i, i) });
      }
      // a slider or prismatic joint used as the input: the pushing force along its axis
      const dv = sim.sys.driver;
      if (dv && r.input && r.input.force !== undefined && (dv.slider || dv.pair)) {
        if (dv.slider) {
          const sl = sim.sys.sliders.find((x) => x.id === dv.slider);
          if (sl && sl.o === i) { const u = turnVec(sim.q, sl.r, sl.u); arrows.push({ p: at(sl.joint), F: { x: r.input.force * u.x, y: r.input.force * u.y }, label: 'F input' }); }
        } else {
          const pr = sim.sys.pairs.find((x) => x.id === dv.pair);
          const src = pr && app.doc.pairs.find((x) => x.id === pr.id);
          const t = src && sim.transformFor(src.slider);
          if (pr && t && (pr.sl === i || pr.g === i)) {
            const u = turnVec(sim.q, pr.g, pr.u), sgn = pr.sl === i ? 1 : -1;
            arrows.push({ p: view.toScreen(t.T(src.a)), F: { x: sgn * r.input.force * u.x, y: sgn * r.input.force * u.y }, label: 'F input' });
          }
        }
      }
      const mp = masses[i], m = r.motion[i];
      if (mp && m) {
        const dynS = dynamicsOf(app.doc);
        const g = dynS.gravity ? dynS.g : 0;
        const cg = view.toScreen(m.G);
        if (mp.m * g > 0) arrows.push({ p: cg, F: { x: 0, y: -mp.m * g }, color: this.col('weight'), label: `m${n}g` });
        if (Math.hypot(m.Fin.x, m.Fin.y) > 1e-9) arrows.push({ p: cg, F: m.Fin, color: this.col('weight'), dashed: true, label: `−m${n}a${n}` });
        if (Math.abs(m.Tin) > 1e-9) torques.push({ p: cg, T: m.Tin, color: this.col('weight'), label: `−I${n}α${n} = ${fmtN(U.T.show(Math.abs(m.Tin)))} ${U.T.label}` });
      }
      const d = sim.sys.driver;
      if (d && d.unit === 'rad' && r.input && (d.i === i || d.ref === i)) {
        // T₁₂: the motor torque of the frame (or the link it is mounted on) on the driven link
        const T = d.i === i ? r.input.torque : -r.input.torque;
        const name = d.i === i ? `T${subscript(num(d.ref))}${subscript(num(d.i))}` : `T${subscript(num(d.i))}${subscript(num(d.ref))}`;
        torques.push({ p: at(d.pivot), T, color: this.col('torque'), r: 42, label: `${name} = ${fmtN(U.T.show(Math.abs(T)))} ${U.T.label}` });
      }
    } else {
      // no link selected: what the ground does to the mechanism
      for (const p of r.pins) if (p.j === -1) arrows.push({ p: at(p.joint), F: p.F, label: Fname(-1, p.i) });
      for (const s of r.sliders) if (s.j === -1) arrows.push({ p: at(s.joint), F: s.F, label: Fname(-1, s.i) });
      // a cylinder on a fixed mount: the force it puts on the mechanism
      for (const a of actForces) if (a.end !== -1 && actForces.some((b) => b !== a && b.end === -1 && b.joint !== a.joint)) arrows.push({ p: at(a.joint), F: a.F, label: 'F cylinder' });
      const d = sim.sys.driver;
      if (d && d.unit === 'rad' && r.input) torques.push({ p: at(d.pivot), T: r.input.torque, color: this.col('torque'), r: 42, label: `T${subscript(num(d.ref))}${subscript(num(d.i))} = ${fmtN(U.T.show(Math.abs(r.input.torque)))} ${U.T.label}` });
    }
    // one scale for all arrows: the largest is 80 px long (× the chosen arrow size)
    const big = Math.max(1e-12, ...arrows.map((a) => Math.hypot(a.F.x, a.F.y)));
    const k = this.ds.arrow, kt = this.ds.text;
    const labels = [];
    for (const a of arrows) {
      const mag = Math.hypot(a.F.x, a.F.y);
      if (mag < big * 1e-4) continue;
      const len = Math.max(16 * k, (80 * k * mag) / big);
      const v = { x: (a.F.x / mag) * len, y: (-a.F.y / mag) * len };
      // the arrow ends at the point it acts on (a push into the joint)
      this.arrow({ x: a.p.x - v.x, y: a.p.y - v.y }, v, a.color || this.col('reaction'), { dashed: a.dashed, label: null, width: 2.2 });
      // its label beyond the tail, along the arrow
      const u = { x: v.x / len, y: v.y / len };
      labels.push({ p: { x: a.p.x - v.x - u.x * 14 * kt, y: a.p.y - v.y - u.y * 14 * kt }, text: `${a.label ? a.label + ' = ' : ''}${fmtN(U.F.show(mag))} ${U.F.label}`, color: a.color || this.col('reaction') });
    }
    for (const t of torques) {
      // the input torque goes on a wider circle than the motor symbol (r 24) so the two stay apart
      const tr = (t.r || 26) * k;
      // the input torque's gap sits where the motor's "M" disc is (below left)
      this.torque(t.p, t.T, t.color, null, tr, t.r ? Math.PI * 0.75 : 0);
      labels.push({ p: { x: t.p.x + tr + 8 * kt, y: t.p.y - tr - 4 * kt }, text: t.label, color: t.color });
    }
    // place the labels so they do not cover each other (or the loads' labels, tags and names)
    for (const L of labels) this.placeLabel(L.p, L.text, L.color);
  }

  /** A small rounded label ("input", "output"). */
  tag(p, text, color) {
    const ctx = this.ctx, k = this.ds.text;
    ctx.font = this.font(11, 600);
    const w = ctx.measureText(text).width + 12 * k;
    p = this.place(p, w, 18 * k);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(p.x - w / 2, p.y - 9 * k, w, 18 * k, 9 * k); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, p.x, p.y + 0.5);
  }

  /** Small padlock glyph (a locked link). */
  padlock(p) {
    const ctx = this.ctx;
    ctx.fillStyle = THEME.ink; ctx.strokeStyle = THEME.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y - 2, 3.2, Math.PI, 0); ctx.stroke();
    ctx.fillRect(p.x - 4.5, p.y - 2, 9, 7);
  }

  badge(p, text, color) {
    const ctx = this.ctx;
    ctx.beginPath(); ctx.arc(p.x, p.y, 9 * this.ds.text, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = THEME.ink;
    ctx.font = this.font(11, 600);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, p.x, p.y + 0.5);
  }

  groundSymbol(p) {
    const ctx = this.ctx, s = DRAWING.groundSizePx;
    ctx.strokeStyle = THEME.ground; ctx.fillStyle = '#ffffff'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - s * 0.6, p.y + s); ctx.lineTo(p.x + s * 0.6, p.y + s); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x - s, p.y + s); ctx.lineTo(p.x + s, p.y + s); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -s; x < s; x += 5) { ctx.moveTo(p.x + x + 5, p.y + s); ctx.lineTo(p.x + x, p.y + s + 6); }
    ctx.stroke();
  }

  hatchAlong(a, b, offset) {
    const ctx = this.ctx;
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, nx = uy, ny = -ux; // hatch below the rail
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let t = 0; t < L; t += 7) {
      const x = a.x + ux * t + nx * offset, y = a.y + uy * t + ny * offset;
      ctx.moveTo(x, y); ctx.lineTo(x + nx * 6 - ux * 5, y + ny * 6 - uy * 5);
    }
    ctx.moveTo(a.x + nx * offset, a.y + ny * offset); ctx.lineTo(b.x + nx * offset, b.y + ny * offset);
    ctx.stroke();
  }

  // ---- snap marker ---------------------------------------------------------------------
  drawSnapMarker(app) {
    const s = app.hoverSnap;
    if (!s || !s.kind) return;
    const ctx = this.ctx, p = app.view.toScreen(s.p);
    ctx.strokeStyle = THEME.snap; ctx.lineWidth = 1.5;
    ctx.beginPath();
    switch (s.kind) {
      case 'intersection': ctx.moveTo(p.x - 6, p.y - 6); ctx.lineTo(p.x + 6, p.y + 6); ctx.moveTo(p.x - 6, p.y + 6); ctx.lineTo(p.x + 6, p.y - 6); break;
      case 'center': ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI); ctx.moveTo(p.x - 3, p.y); ctx.lineTo(p.x + 3, p.y); break;
      case 'endpoint': case 'point': ctx.rect(p.x - 5, p.y - 5, 10, 10); break;
      case 'joint': ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI); break;
      case 'midpoint': ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x + 6, p.y + 5); ctx.lineTo(p.x - 6, p.y + 5); ctx.closePath(); break;
      case 'on': ctx.moveTo(p.x - 6, p.y); ctx.lineTo(p.x + 6, p.y); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x, p.y + 6); break;
      default: ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
    }
    ctx.stroke();
  }
}
