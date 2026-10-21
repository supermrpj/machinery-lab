// =============================================================================
// guide-demos.js — the short looping animations shown in the tool guides
// -----------------------------------------------------------------------------
// Each demo is a function demo(ctx, t) that draws one frame at time t
// (seconds, 0 ≤ t < period) on a 280 × 150 px canvas. A cursor moves, clicks
// show a ripple, and then the result moves — like a short screen recording,
// but drawn live so it stays sharp and needs no video files.
// =============================================================================

import { LINK_COLORS } from '../config.js';

export const DEMO_W = 280, DEMO_H = 150;
const INK = '#1D1D1F', GRAPHITE = '#5A606B', PAPER = '#F7F7F2', HL = '#2196F3';

// ---- small drawing helpers -------------------------------------------------------

const lerp = (a, b, u) => a + (b - a) * u;
const ease = (u) => (u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u));

/** Position along keyframes [[t, x, y], …] at time t (eased between keys). */
function path(t, keys) {
  if (t <= keys[0][0]) return { x: keys[0][1], y: keys[0][2] };
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, x0, y0] = keys[i - 1], [t1, x1, y1] = keys[i];
      const u = ease((t - t0) / (t1 - t0));
      return { x: lerp(x0, x1, u), y: lerp(y0, y1, u) };
    }
  }
  const k = keys[keys.length - 1];
  return { x: k[1], y: k[2] };
}

function cursor(ctx, p, pressed = false) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, 16); ctx.lineTo(4.2, 12.3); ctx.lineTo(7.2, 18.5);
  ctx.lineTo(9.6, 17.4); ctx.lineTo(6.7, 11.4); ctx.lineTo(12, 11.4); ctx.closePath();
  ctx.fillStyle = pressed ? HL : '#fff'; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.restore();
}

/** Click ripple that grows and fades over 0.5 s after time tc. */
function ripple(ctx, t, tc, p) {
  const age = t - tc;
  if (age < 0 || age > 0.5) return;
  ctx.save();
  ctx.globalAlpha = 1 - age / 0.5;
  ctx.strokeStyle = HL; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(p.x, p.y, 6 + age * 30, 0, 2 * Math.PI); ctx.stroke();
  ctx.restore();
}

/** Clicks at the given times; returns true while the button is held. */
function clicked(t, times) { return times.some((tc) => t >= tc - 0.08 && t <= tc + 0.12); }

function joint(ctx, p, ground = false) {
  if (ground) {
    ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 7, p.y + 12); ctx.lineTo(p.x + 7, p.y + 12); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x - 11, p.y + 12); ctx.lineTo(p.x + 11, p.y + 12); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();
}

function bar(ctx, a, b, color, w = 9) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = w + 3; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

function wheel(ctx, c, r, ang, color, highlight = false) {
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 2 * Math.PI);
  ctx.save(); ctx.globalAlpha = 0.25; ctx.fillStyle = color; ctx.fill(); ctx.restore();
  ctx.strokeStyle = highlight ? HL : color; ctx.lineWidth = highlight ? 4 : 3; ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let k = 0; k < 3; k++) { const a = ang + (k * 2 * Math.PI) / 3; ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + r * 0.9 * Math.cos(a), c.y + r * 0.9 * Math.sin(a)); }
  ctx.stroke();
}

function label(ctx, text, x = 10, y = 16) {
  ctx.font = '600 11px system-ui, "Segoe UI", sans-serif';
  ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function key(ctx, text, p, t, t0, t1) {
  if (t < t0 || t > t1) return;
  ctx.font = '700 11px system-ui, "Segoe UI", sans-serif';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = '#FFEB3B'; ctx.strokeStyle = INK; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(p.x, p.y, w, 20, 3); ctx.fill(); ctx.stroke();
  ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, p.x + 6, p.y + 10.5);
}

/** Fourbar: B from the open circuit for crank angle th. */
function fourbar(O2, a, b, c, d, th) {
  const A = { x: O2.x + a * Math.cos(th), y: O2.y - a * Math.sin(th) };
  const O4 = { x: O2.x + d, y: O2.y };
  const D = Math.hypot(O4.x - A.x, O4.y - A.y);
  const m = (b * b - c * c + D * D) / (2 * D);
  const hh = Math.sqrt(Math.max(b * b - m * m, 0));
  const ex = (O4.x - A.x) / D, ey = (O4.y - A.y) / D;
  const B = { x: A.x + m * ex + hh * ey, y: A.y + m * ey - hh * ex };
  return { A, B, O4 };
}

function begin(ctx) {
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, DEMO_W, DEMO_H);
  ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < DEMO_W; x += 20) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, DEMO_H); }
  for (let y = 0; y < DEMO_H; y += 20) { ctx.moveTo(0, y + 0.5); ctx.lineTo(DEMO_W, y + 0.5); }
  ctx.stroke();
}

// ---- the demos ----------------------------------------------------------------------

/** The centre-of-mass mark ◐ (a circle with two filled quarters). */
function cgMark(ctx, p, r = 5) {
  ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  ctx.fillStyle = INK;
  for (const a0 of [0, Math.PI]) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, r, a0, a0 + Math.PI / 2); ctx.closePath(); ctx.fill(); }
}

/** A small text field in the mock Properties panel. */
function field(ctx, x, y, w, text, active = false) {
  ctx.fillStyle = '#fff'; ctx.strokeStyle = active ? HL : INK; ctx.lineWidth = active ? 2 : 1.4;
  ctx.beginPath(); ctx.rect(x, y, w, 15); ctx.fill(); ctx.stroke();
  ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 3, y + 8);
}

export const DEMOS = {
  masses: {
    period: 7.5,
    draw(ctx, t) {
      begin(ctx);
      const A = { x: 24, y: 118 }, B = { x: 132, y: 66 };
      const selected = t > 0.9, typed = t > 2.3;
      // G: on the line of centres from the shape, then turned to θ = 35° by typing
      const ux = (B.x - A.x), uy = (B.y - A.y), L = Math.hypot(ux, uy), r = L * 0.5;
      const u = typed ? ease((t - 3.4) / 1.2) : 0;
      const thDeg = Math.round(35 * u), th = (thDeg * Math.PI) / 180;
      const a0 = Math.atan2(uy, ux); // canvas angle of the line of centres (y down)
      const G = { x: A.x + r * Math.cos(a0 - th), y: A.y + r * Math.sin(a0 - th) };
      if (selected) { ctx.save(); ctx.globalAlpha = 0.35; bar(ctx, A, B, HL, 16); ctx.restore(); }
      bar(ctx, A, B, LINK_COLORS[1]);
      joint(ctx, A, true); joint(ctx, B);
      if (u > 0) { // r from the joint, and θ from the line of centres
        ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = GRAPHITE; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(G.x, G.y); ctx.stroke();
        ctx.setLineDash([]); ctx.beginPath(); ctx.arc(A.x, A.y, 26, a0 - th, a0); ctx.stroke(); ctx.restore();
        ctx.font = '600 10px system-ui, "Segoe UI", sans-serif'; ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('θ', A.x + 31 * Math.cos(a0 - th / 2), A.y + 31 * Math.sin(a0 - th / 2));
      }
      cgMark(ctx, G);

      // mock Properties panel
      if (selected) {
        const X = 150, Y = 26;
        ctx.fillStyle = INK; ctx.fillRect(X + 3, Y + 3, 124, 118);
        ctx.fillStyle = '#FFFDF2'; ctx.strokeStyle = INK; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.rect(X, Y, 124, 118); ctx.fill(); ctx.stroke();
        ctx.font = '700 10.5px system-ui, "Segoe UI", sans-serif'; ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('Mass of link 3', X + 7, Y + 12);
        // the tick box
        ctx.fillStyle = typed ? HL : '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.rect(X + 7, Y + 23, 10, 10); ctx.fill(); ctx.stroke();
        if (typed) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X + 9, Y + 28); ctx.lineTo(X + 11.5, Y + 31); ctx.lineTo(X + 15.5, Y + 25); ctx.stroke(); }
        ctx.font = '10px system-ui, "Segoe UI", sans-serif'; ctx.fillStyle = INK;
        ctx.fillText('Typed values', X + 21, Y + 28.5);
        if (!typed) {
          ctx.fillStyle = GRAPHITE; ctx.fillText('m = 0.21 kg (from shape)', X + 7, Y + 50);
        } else {
          const lab = (text, y) => { ctx.font = '10px system-ui, "Segoe UI", sans-serif'; ctx.fillStyle = INK; ctx.fillText(text, X + 7, y + 8); };
          lab('m (kg)', Y + 42); field(ctx, X + 52, Y + 42, 64, '0.35', t > 2.6 && t < 3.0);
          lab('G: r, θ', Y + 62); field(ctx, X + 52, Y + 62, 30, '60'); field(ctx, X + 86, Y + 62, 30, `${thDeg}°`, t > 3.0 && t < 4.6);
          lab('I_G', Y + 82); field(ctx, X + 52, Y + 82, 64, '0.0021');
          ctx.font = '9.5px system-ui, "Segoe UI", sans-serif'; ctx.fillStyle = GRAPHITE;
          ctx.fillText('r, θ from J1 along the link', X + 7, Y + 106);
        }
      }
      const p = path(t, [[0, 120, 140], [0.85, 80, 92], [1.9, 162, 54], [2.3, 162, 54], [2.55, 215, 76], [3.0, 250, 96], [4.6, 250, 96], [5.4, 260, 145]]);
      ripple(ctx, t, 0.9, { x: 80, y: 92 }); ripple(ctx, t, 2.3, { x: 162, y: 54 }); ripple(ctx, t, 2.6, { x: 215, y: 76 }); ripple(ctx, t, 3.05, { x: 250, y: 96 });
      cursor(ctx, p, clicked(t, [0.9, 2.3, 2.6, 3.05]));
      label(ctx, t < 1.9 ? 'Open the link’s mass' : t < 2.6 ? 'Choose “Typed values”' : t < 4.8 ? 'Type m, G as r ∠ θ, and I_G' : 'G sits at r ∠ θ on the link');
    },
  },

  roll: {
    period: 5.5,
    draw(ctx, t) {
      begin(ctx);
      const c1 = { x: 95, y: 82 }, r1 = 38, c2 = { x: 95 + 38 + 26, y: 82 }, r2 = 26;
      const run = Math.max(0, t - 1.9);
      const a1 = -run * 1.6, a2 = run * 1.6 * (r1 / r2);
      wheel(ctx, c1, r1, a1, LINK_COLORS[0], t > 0.9 && t < 1.9);
      wheel(ctx, c2, r2, a2, LINK_COLORS[1], t > 1.7 && t < 1.9);
      joint(ctx, c1, true); joint(ctx, c2, true);
      if (t > 1.7) { ctx.beginPath(); ctx.arc(c1.x + r1, c1.y, 4.5, 0, 2 * Math.PI); ctx.fillStyle = INK; ctx.fill(); }
      const p = path(t, [[0, 240, 140], [0.8, 70, 60], [1.6, 165, 70], [2.4, 240, 135]]);
      ripple(ctx, t, 0.85, { x: 70, y: 60 }); ripple(ctx, t, 1.65, { x: 165, y: 70 });
      cursor(ctx, p, clicked(t, [0.85, 1.65]));
      label(ctx, t < 1.9 ? 'Click one wheel, then the other' : 'They turn together, no slipping');
    },
  },

  rollslide: {
    period: 6,
    draw(ctx, t) {
      begin(ctx);
      const O = { x: 120, y: 100 }, e = 12, R = 30;
      const run = Math.max(0, t - 1.9);
      const th = run * 1.8;
      const C = { x: O.x + e * Math.cos(th), y: O.y - e * Math.sin(th) };
      const yf = C.y - R; // flat follower touches the top of the disc
      // guide
      ctx.strokeStyle = GRAPHITE; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(O.x, 10); ctx.lineTo(O.x, 140); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(C.x, C.y, R, 0, 2 * Math.PI);
      ctx.save(); ctx.globalAlpha = 0.25; ctx.fillStyle = LINK_COLORS[0]; ctx.fill(); ctx.restore();
      ctx.strokeStyle = t > 0.9 && t < 1.9 ? HL : LINK_COLORS[0]; ctx.lineWidth = 3; ctx.stroke();
      bar(ctx, O, C, LINK_COLORS[0], 6);
      joint(ctx, O, true);
      bar(ctx, { x: O.x - 55, y: yf }, { x: O.x + 55, y: yf }, t > 1.7 && t < 1.9 ? HL : LINK_COLORS[1], 7);
      bar(ctx, { x: O.x, y: yf }, { x: O.x, y: yf - 30 }, LINK_COLORS[1], 7);
      if (t > 1.7) {
        const P = { x: C.x, y: yf };
        ctx.beginPath(); ctx.arc(P.x, P.y, 4.5, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(P.x - 8, P.y - 8); ctx.lineTo(P.x + 8, P.y - 8); ctx.moveTo(P.x - 8, P.y + 8); ctx.lineTo(P.x + 8, P.y + 8); ctx.stroke();
      }
      const p = path(t, [[0, 260, 140], [0.8, 100, 125], [1.6, 160, yf], [2.4, 260, 135]]);
      ripple(ctx, t, 0.85, { x: 100, y: 125 }); ripple(ctx, t, 1.65, { x: 160, y: yf });
      cursor(ctx, p, clicked(t, [0.85, 1.65]));
      label(ctx, t < 1.9 ? 'Click the cam, then the follower face' : 'Contact is kept, but it slips');
    },
  },

  prismatic: {
    period: 6,
    draw(ctx, t) {
      begin(ctx);
      const run = Math.max(0, t - 2.6);
      const s = 35 + 25 * Math.sin(run * 2);
      const y = 80;
      // cylinder (guide) and rod (slider)
      const barrelA = { x: 40, y }, barrelB = { x: 150, y };
      ctx.fillStyle = '#AEB6C1'; ctx.strokeStyle = t > 1.7 && t < 2.6 ? HL : INK; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(barrelA.x, y - 13, barrelB.x - barrelA.x, 26, 3); ctx.fill(); ctx.stroke();
      const rodEnd = { x: 150 + s + 40, y };
      ctx.fillStyle = '#C7CDD5'; ctx.strokeStyle = t > 0.9 && t < 2.6 ? HL : INK;
      ctx.beginPath(); ctx.rect(110 + s, y - 5, rodEnd.x - (110 + s), 10); ctx.fill(); ctx.stroke();
      joint(ctx, barrelA, true); joint(ctx, rodEnd);
      const p = path(t, [[0, 260, 140], [0.8, 220, y], [1.6, 90, y + 5], [2.6, 250, 130]]);
      ripple(ctx, t, 0.85, { x: 220, y }); ripple(ctx, t, 1.65, { x: 90, y: y + 5 });
      key(ctx, 'Enter', { x: 190, y: 110 }, t, 1.9, 2.6);
      cursor(ctx, p, clicked(t, [0.85, 1.65]));
      label(ctx, t < 2.6 ? 'Click the sliding link, then its guide' : 'It slides along the axis, no turning');
    },
  },

  slider: {
    period: 6,
    draw(ctx, t) {
      begin(ctx);
      const O = { x: 60, y: 95 }, a = 28, b = 90;
      const run = Math.max(0, t - 2.0);
      const th = 1.0 + run * 2.2;
      const A = { x: O.x + a * Math.cos(th), y: O.y - a * Math.sin(th) };
      const Bx = A.x + Math.sqrt(b * b - (A.y - O.y) ** 2);
      const B = { x: Bx, y: O.y };
      ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(40, O.y + 9); ctx.lineTo(260, O.y + 9); ctx.stroke();
      bar(ctx, O, A, LINK_COLORS[0]); bar(ctx, A, B, LINK_COLORS[1]);
      if (t > 1.7) { ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.rect(B.x - 15, B.y - 9, 30, 18); ctx.fill(); ctx.stroke(); }
      joint(ctx, O, true); joint(ctx, A); joint(ctx, B);
      const p = path(t, [[0, 260, 140], [0.8, B.x, B.y], [1.6, 225, O.y + 9], [2.4, 260, 135]]);
      ripple(ctx, t, 0.85, { x: 141, y: O.y }); ripple(ctx, t, 1.65, { x: 225, y: O.y + 9 });
      cursor(ctx, p, clicked(t, [0.85, 1.65]));
      label(ctx, t < 2 ? 'Click the joint, then the line it slides on' : 'The joint now slides along the line');
    },
  },

  wheel: {
    period: 5,
    draw(ctx, t) {
      begin(ctx);
      const c = { x: 130, y: 80 };
      const r = t < 0.9 ? 0 : t < 1.7 ? 40 * ease((t - 0.9) / 0.8) : 40;
      if (r > 0) wheel(ctx, c, r, -(Math.max(0, t - 1.9)) * 1.5, LINK_COLORS[0]);
      joint(ctx, c, true);
      const p = path(t, [[0, 250, 140], [0.8, c.x, c.y], [1.7, c.x + 40, c.y], [2.5, 250, 135]]);
      ripple(ctx, t, 0.85, c); ripple(ctx, t, 1.75, { x: c.x + 40, y: c.y });
      cursor(ctx, p, clicked(t, [0.85, 1.75]));
      label(ctx, t < 1.8 ? 'Click the centre, then click the radius' : 'A wheel, ready to roll on things');
    },
  },

  actuator: {
    period: 6.5,
    draw(ctx, t) {
      begin(ctx);
      const O = { x: 50, y: 110 }, G = { x: 100, y: 128 };
      const run = Math.max(0, t - 1.9);
      const ang = 0.35 + 0.35 * (0.5 - 0.5 * Math.cos(run * 1.6));
      const B = { x: O.x + 80 * Math.cos(ang), y: O.y - 80 * Math.sin(ang) };
      const T = { x: O.x + 180 * Math.cos(ang), y: O.y - 180 * Math.sin(ang) };
      bar(ctx, O, T, LINK_COLORS[0]);
      if (t > 1.7) {
        const dx = B.x - G.x, dy = B.y - G.y, L = Math.hypot(dx, dy);
        ctx.save(); ctx.translate(G.x, G.y); ctx.rotate(Math.atan2(dy, dx));
        ctx.fillStyle = '#C7CDD5'; ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.rect(20, -3, L - 20, 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#9FB8E6'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.roundRect(-4, -7, 40, 14, 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      joint(ctx, O, true); joint(ctx, G, true); joint(ctx, B);
      const p = path(t, [[0, 260, 140], [0.8, G.x, G.y], [1.6, B.x, B.y], [2.4, 260, 135]]);
      ripple(ctx, t, 0.85, G); ripple(ctx, t, 1.65, { x: 127, y: 82 });
      cursor(ctx, p, clicked(t, [0.85, 1.65]));
      label(ctx, t < 1.9 ? 'Click the mount, then the joint to push' : 'The cylinder is the input: it lifts the boom');
    },
  },

  link: {
    period: 7,
    draw(ctx, t) {
      begin(ctx);
      const O2 = { x: 70, y: 112 };
      const run = Math.max(0, t - 3.6);
      const fb = fourbar(O2, 26, 92, 62, 112, 1.1 + run * 2.2);
      const clicks = [0.7, 1.4, 2.1, 2.9];
      const pts = [O2, fb.A, fb.B, fb.O4];
      const shown = clicks.filter((c) => t > c).length;
      for (let i = 1; i < shown; i++) bar(ctx, pts[i - 1], pts[i], LINK_COLORS[(i - 1) % 3]);
      joint(ctx, O2, true); joint(ctx, fb.O4, true);
      for (let i = 1; i < Math.min(shown, 3); i++) joint(ctx, pts[i]);
      const p = path(t, [[0, 260, 140], [0.7, O2.x, O2.y], [1.4, pts[1].x, pts[1].y], [2.1, pts[2].x, pts[2].y], [2.9, pts[3].x, pts[3].y], [3.6, 260, 135]]);
      clicks.forEach((c, i) => ripple(ctx, t, c + 0.05, pts[i]));
      cursor(ctx, p, clicked(t, clicks.map((c) => c + 0.05)));
      label(ctx, t < 3.6 ? 'Click pivot, joint, joint, pivot' : 'A fourbar — press Enter to run');
    },
  },

  compass: {
    period: 6.5,
    draw(ctx, t) {
      begin(ctx);
      const N = { x: 110, y: 95 };
      const spread = t < 1.0 ? 20 : t < 2.0 ? lerp(20, 50, ease(t - 1.0)) : 50;
      const sweep = t < 2.6 ? 0 : Math.min(2.4, (t - 2.6) * 1.4);
      const a = -0.2 - sweep;
      const P = { x: N.x + spread * Math.cos(a), y: N.y + spread * Math.sin(a) };
      if (sweep > 0) { ctx.strokeStyle = GRAPHITE; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(N.x, N.y, spread, -0.2, a, true); ctx.stroke(); }
      // the instrument: two legs from a hinge above the midpoint
      const mid = { x: (N.x + P.x) / 2, y: (N.y + P.y) / 2 };
      const H = { x: mid.x, y: mid.y - 55 };
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#8C94A0'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(H.x, H.y); ctx.lineTo(N.x, N.y); ctx.stroke();
      ctx.strokeStyle = '#B9C0CA'; ctx.beginPath(); ctx.moveTo(H.x, H.y); ctx.lineTo(P.x, P.y); ctx.stroke();
      ctx.strokeStyle = '#E3B341'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(lerp(H.x, P.x, 0.75), lerp(H.y, P.y, 0.75)); ctx.lineTo(P.x, P.y); ctx.stroke();
      ctx.fillStyle = '#4A515C'; ctx.beginPath(); ctx.arc(H.x, H.y, 7, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = t > 2.6 ? HL : '#5A6170'; ctx.fillRect(H.x - 5, H.y - 22, 10, 14);
      const p = path(t, [[0, 250, 140], [0.9, P.x, P.y], [2.0, N.x + 50 * Math.cos(-0.2), N.y + 50 * Math.sin(-0.2)], [2.5, H.x, H.y - 16], [6, H.x, H.y - 16]]);
      cursor(ctx, t > 2.5 ? { x: H.x + 2, y: H.y - 16 } : p, (t > 1.0 && t < 2.0) || t > 2.6);
      label(ctx, t < 1 ? 'Drag the pencil tip to open the compass' : t < 2.6 ? 'Set the radius (it snaps to points)' : 'Turn the grip on top to draw the arc');
    },
  },

  protractor: {
    period: 6,
    draw(ctx, t) {
      begin(ctx);
      const C = { x: 140, y: 118 }, R = 85;
      const base = t < 1.4 ? 0 : -Math.min(0.35, (t - 1.4) * 0.5);
      ctx.save(); ctx.translate(C.x, C.y); ctx.rotate(base);
      ctx.fillStyle = 'rgba(33,150,243,0.18)'; ctx.strokeStyle = '#225682'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, R, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1;
      for (let d = 0; d <= 180; d += 10) { const a = -d * Math.PI / 180; ctx.beginPath(); ctx.moveTo(R * Math.cos(a), R * Math.sin(a)); ctx.lineTo(R * 0.88 * Math.cos(a), R * 0.88 * Math.sin(a)); ctx.stroke(); }
      ctx.fillStyle = '#5B7894'; ctx.beginPath(); ctx.arc(R + 12, 0, 6, 0, 2 * Math.PI); ctx.fill();
      ctx.restore();
      const reading = t > 2.6 ? 60 : null;
      if (reading !== null) {
        const a = base - reading * Math.PI / 180;
        ctx.strokeStyle = HL; ctx.setLineDash([5, 3]); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(C.x, C.y); ctx.lineTo(C.x + 110 * Math.cos(a), C.y + 110 * Math.sin(a)); ctx.stroke(); ctx.setLineDash([]);
        if (t > 3.6) { ctx.strokeStyle = GRAPHITE; ctx.beginPath(); ctx.moveTo(C.x - 120 * Math.cos(a), C.y - 120 * Math.sin(a)); ctx.lineTo(C.x + 140 * Math.cos(a), C.y + 140 * Math.sin(a)); ctx.stroke(); }
      }
      const grip = { x: C.x + (R + 12) * Math.cos(base), y: C.y + (R + 12) * Math.sin(base) };
      const p = path(t, [[0, 260, 140], [0.8, C.x + R + 12, C.y], [1.4, C.x + R + 12, C.y], [2.1, grip.x, grip.y], [2.8, C.x + 40, C.y - 70], [6, C.x + 40, C.y - 70]]);
      ripple(ctx, t, 3.55, { x: C.x + 40, y: C.y - 70 });
      cursor(ctx, p, (t > 1.4 && t < 2.1) || clicked(t, [3.55]));
      label(ctx, t < 2.6 ? 'Turn the grip to align the baseline' : t < 3.6 ? 'Hover to read the angle: 60.0°' : 'Click: a line at exactly that angle');
    },
  },

  drive: {
    period: 5,
    draw(ctx, t) {
      begin(ctx);
      const O2 = { x: 70, y: 112 };
      const th = 1.1 + Math.sin(t * 1.2) * 1.0;
      const fb = fourbar(O2, 26, 92, 62, 112, th);
      bar(ctx, O2, fb.A, LINK_COLORS[0]); bar(ctx, fb.A, fb.B, LINK_COLORS[1]); bar(ctx, fb.O4, fb.B, LINK_COLORS[2]);
      joint(ctx, O2, true); joint(ctx, fb.O4, true); joint(ctx, fb.A); joint(ctx, fb.B);
      const g = { x: (fb.A.x + fb.B.x) / 2, y: (fb.A.y + fb.B.y) / 2 };
      cursor(ctx, g, true);
      label(ctx, 'Drag any link: it moves like the real one');
    },
  },

  coupler: {
    period: 6,
    draw(ctx, t) {
      begin(ctx);
      const O2 = { x: 70, y: 112 };
      const run = Math.max(0, t - 1.4);
      const cp = (th) => { const f = fourbar(O2, 26, 92, 62, 112, th); return { f, P: { x: (f.A.x + f.B.x) / 2 + 0.3 * (f.B.y - f.A.y), y: (f.A.y + f.B.y) / 2 - 0.3 * (f.B.x - f.A.x) } }; };
      const now = cp(1.1 + run * 2.2);
      if (t > 1.4) {
        ctx.strokeStyle = '#0F6F7C'; ctx.lineWidth = 1.5; ctx.beginPath();
        for (let k = 0; k <= 60; k++) { const q = cp(1.1 + (k / 60) * run * 2.2).P; if (k) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }
        ctx.stroke();
      }
      const f = now.f;
      bar(ctx, O2, f.A, LINK_COLORS[0]); bar(ctx, f.A, f.B, LINK_COLORS[1]); bar(ctx, f.O4, f.B, LINK_COLORS[2]);
      if (t > 0.9) { bar(ctx, f.A, now.P, LINK_COLORS[1], 6); bar(ctx, f.B, now.P, LINK_COLORS[1], 6); joint(ctx, now.P); }
      joint(ctx, O2, true); joint(ctx, f.O4, true); joint(ctx, f.A); joint(ctx, f.B);
      const p = path(t, [[0, 260, 140], [0.85, now.P.x, now.P.y], [1.6, 260, 135]]);
      ripple(ctx, t, 0.9, now.P);
      cursor(ctx, p, clicked(t, [0.9]));
      label(ctx, t < 1.4 ? 'Click on a link to add a point' : 'Its path (coupler curve) is traced');
    },
  },
};
