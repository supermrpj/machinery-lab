// =============================================================================
// print3d.js — the mechanism as parts for a 3-D printer (STL)
// -----------------------------------------------------------------------------
// One STL per link and one for the base (the frame), ready for a slicer: each
// part lies flat as printed, needs no supports, and the parts fit together
// as drawn. The link outlines are the same as in the DXF export (cad.js):
// the convex hull of the joints, rounded by half the link width.
//
// Joints (settings.joint):
//   'snap'  a hollow pin with four slots and a ridge, printed on the lower
//           part, clicks into a hole with a recess in the part above. No
//           hardware. (The idea of a slotted pin with a ridge is old and
//           common; the sizes here come from the drawing's settings.)
//   'hole'  plain holes for pins, rivets or bolts of the pin diameter.
//   Every hole is the pin diameter plus the clearance (on the diameter).
//
// Base (settings.base):
//   'flat'  a plate that lies on the table; the links move above it. A pen
//           in a traced point draws on paper taped to the plate.
//   'stand' the same plate with a straight bottom edge, and a stand with a
//           slot that holds it upright.
//
// Stacking: the links sit in layers above the base. Links joined at a joint
// are in different layers; links in the same layer must not touch anywhere
// in the cycle; a pin that skips layers stands on a boss, which must not be
// in the way of links in the layers between; the pen must not hit the links
// below it, nor the knob (on the input crank, or on its crank pin) the links
// above it. The
// smallest stack that meets all this is found by trying every order (the
// whole cycle is checked once, then the orders are compared).
//
// Limits of this version: pin joints only (no sliders, gears, cams or linear
// actuators), at most two links at a joint, at most 7 moving links.
// Units: millimetres.
// =============================================================================

import { Mesh, signedArea } from '../../../../packages/cad-export/src/mesh.js';
import { makeZip } from '../../../../packages/cad-export/src/zip.js';
import { linkOutline } from '../../../../packages/cad-export/src/outline.js';
import { convexHull } from '../../../../packages/core-math/src/index.js';
import earcut from '../../../../node_modules/earcut/src/earcut.js';
import { jointById, linksAtJoint, isFrameLink, linkNumbers } from '../model/document.js';
import { dynamicsOf } from '../model/mass.js';
import { linkTransform, designCoordinates } from '../kinematics/index.js';
import { APP } from '../config.js';
import { fileName } from './cad.js';

// ---- CONFIG -----------------------------------------------------------------
export const PRINT_DEFAULTS = {
  joint: 'snap',      // 'snap' | 'hole'
  base: 'flat',       // 'flat' | 'stand'
  clearance: 0.3,     // hole Ø − pin Ø (mm); the fit test helps to choose it
};

export const PRINT = {
  segments: 72,         // points round a full circle (a multiple of 4)
  layerGap: 0.3,        // gap between parts stacked on each other (mm)
  baseThickness: 3,     // the base plate
  baseClear: 2,         // lowest link above the plate
  baseMargin: 4,        // the plate reaches this far beyond everything that moves over it
  margin: 1.0,          // kept between parts that pass each other in the cycle
  ringInset: 0.5,       // a joint's round features stay this far inside the link edge
  holeChamfer: 0.4,     // at the bottom of every hole (the first layer spreads)
  penHole: 3.3,         // a traced point: a hole for a pen refill
  penRadius: 2.5,       // room the pen needs as it passes over other links
  knob: { diameter: 7, height: 12, chamfer: 0.8, ring: 0.8 },
  snap: {
    bore: 0.5,          // inside Ø of the hollow pin, as a share of the pin Ø
    slots: 4,           // slots down the pin (four springy fingers)
    slotWidth: 1.2,     // at mid-wall
    lip: 0.45,          // the ridge stands out this far from the pin
    catchHeight: 0.25,  // the ridge's lower (catch) face: about 30° from flat
    band: 0.4,          // straight part of the ridge
    topInset: 0.25,     // pin top this much smaller than the pin (lead-in)
    axialPlay: 0.1,     // the ridge sits this far above the floor of the recess
    flushInset: 0.15,   // pin top this far below the top of the part above
    recess: 0.4,        // the recess is this much wider than the ridge
    pocketGap: 0.8,     // room round the pin's root, so the fingers are longer
    pocketDepth: 2.5,
    slotStart: 0.5,     // slots start this far above the bottom of the pocket
  },
  stand: { slot: 8, fit: 0.2, height: 12, depth: 45, length: 30 },   // print two
  fitTest: [0.2, 0.3, 0.4, 0.5],  // clearances of the four test pieces
  maxLinks: 7,
};
// -----------------------------------------------------------------------------

const TAU = 2 * Math.PI;

/** Settings for the export: the drawing's own, else the defaults. */
export function printSettings(doc) {
  const dyn = dynamicsOf(doc);
  const cad = doc.cad || {};
  const saved = doc.print || {};
  return {
    ...PRINT_DEFAULTS, ...saved,
    width: dyn.width || cad.linkWidth || 12,        // as the mass model (mass.js)
    thickness: dyn.thickness || 6,
    pin: cad.pinDiameter || 6,
  };
}

/** Sizes that follow from the settings (mm). */
function sizes(s) {
  const S = PRINT.snap;
  const r = s.pin / 2;
  const Rf = s.width / 2 - PRINT.ringInset;                  // edge of a joint's round features
  const rh = (s.pin + s.clearance) / 2;                      // hole radius
  const recessDepth = S.axialPlay + S.catchHeight + S.band + S.lip + S.topInset + S.flushInset;
  const recessR = r + S.lip + S.recess;
  return { r, Rf, rh, recessDepth, recessR, pocketR: r + S.pocketGap, bore: (S.bore * s.pin) / 2 };
}

// =============================================================================
// 1. Checks: what this version can print
// =============================================================================

/** Problems that stop the export (plain-language messages); empty when it can go ahead. */
export function printProblems(doc, s = printSettings(doc)) {
  return [...mechanismProblems(doc), ...sizeProblems(s)];
}

/** What in the drawing this version cannot print. */
function mechanismProblems(doc) {
  const out = [];
  const moving = doc.links.filter((l) => !isFrameLink(doc, l));
  if (!moving.length) out.push('There is no moving link to print.');
  if (doc.sliders.length) out.push('Sliders cannot be printed yet: this version prints pin joints only.');
  if ((doc.actuators || []).length) out.push('Linear actuators cannot be printed yet: this version prints pin joints only.');
  if ((doc.pairs || []).length) out.push('Gears and cams cannot be printed yet: this version prints pin joints only.');
  if (moving.length > PRINT.maxLinks) out.push(`This version prints at most ${PRINT.maxLinks} moving links.`);
  for (const j of doc.joints) {
    const n = moving.filter((l) => l.joints.includes(j.id)).length + (j.ground ? 1 : 0);
    if (n > 2) out.push(`Joint J${doc.joints.indexOf(j) + 1} joins ${n} parts; this version prints at most two at a joint.`);
  }
  return out;
}

/** Sizes that do not work together (link width, thickness, pin, clearance). */
function sizeProblems(s) {
  const out = [];
  const z = sizes(s);
  if (z.Rf - (s.joint === 'snap' ? z.recessR : z.rh + PRINT.holeChamfer) < 0.8) {
    out.push(`The links are too narrow for ${s.pin} mm pins: make the link width at least ${fmt(2 * ((s.joint === 'snap' ? z.recessR : z.rh + PRINT.holeChamfer) + 0.8 + PRINT.ringInset))} mm, or the pins thinner.`);
  }
  if (s.joint === 'snap') {
    if (s.thickness - z.recessDepth < 2.5) out.push(`Snap-fit joints need links at least ${fmt(z.recessDepth + 2.5)} mm thick (the thickness is set in Forces).`);
    if (s.thickness - PRINT.snap.pocketDepth < 1) out.push(`Snap-fit joints need links at least ${fmt(PRINT.snap.pocketDepth + 1)} mm thick.`);
    if (s.pin < 3) out.push('Snap-fit pins need a pin diameter of at least 3 mm.');
  }
  if (!(s.clearance >= 0) || s.clearance > s.pin / 2) out.push('The clearance must be between 0 and half the pin diameter.');
  return out;
}

const fmt = (v) => String(Math.round(v * 10) / 10);

/** Radius of a knob on top of a joint (it covers the recess); 0 when it does not fit. */
function pinKnobRadius(s) {
  const z = sizes(s);
  const rk = Math.min(Math.max(PRINT.knob.diameter / 2, z.recessR + 1), z.Rf - 0.4);
  return rk >= z.recessR + 0.6 ? rk : 0;
}

// =============================================================================
// 2. Geometry helpers
// =============================================================================

/** A closed polygon (counter-clockwise) from linkOutline's lines and arcs. */
export function outlinePolygon(points, R, seg = PRINT.segments) {
  const o = linkOutline(points, R);
  if (o.circle) return circle(o.circle.c, R, seg);
  const loop = [];
  o.lines.forEach((ln, i) => {
    loop.push(ln.a);
    const a = o.arcs[i];
    let sweep = a.end - a.start;
    while (sweep < 0) sweep += 360;
    const n = Math.max(1, Math.ceil(sweep / (360 / seg)));
    for (let k = 0; k < n; k++) {           // from the arc's start (= this line's end), not its end (= the next line's start)
      const t = ((a.start + (sweep * k) / n) * Math.PI) / 180;
      loop.push({ x: a.c.x + R * Math.cos(t), y: a.c.y + R * Math.sin(t) });
    }
  });
  // drop points that repeat (an arc of no angle between edges in line)
  return loop.filter((p, i) => { const q = loop[(i + 1) % loop.length]; return Math.hypot(q.x - p.x, q.y - p.y) > 1e-4; });
}

/** n points round a circle, counter-clockwise from +x. */
function circle(c, r, n = PRINT.segments) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ x: c.x + r * Math.cos((TAU * i) / n), y: c.y + r * Math.sin((TAU * i) / n) });
  return out;
}

/** Distance from point p to a closed polygon's edge (0 or less when inside a convex polygon). */
function distToConvex(p, poly) {
  let inside = true, best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    if (ex * (p.y - a.y) - ey * (p.x - a.x) < 0) inside = false;
    const L2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / L2));
    best = Math.min(best, Math.hypot(p.x - a.x - t * ex, p.y - a.y - t * ey));
  }
  return inside ? -best : best;
}

/** Do two convex polygons (counter-clockwise) overlap? (separating axis test) */
function convexOverlap(P, Q) {
  for (const poly of [P, Q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const nx = b.y - a.y, ny = a.x - b.x;
      let pMin = Infinity, pMax = -Infinity, qMin = Infinity, qMax = -Infinity;
      for (const p of P) { const v = p.x * nx + p.y * ny; pMin = Math.min(pMin, v); pMax = Math.max(pMax, v); }
      for (const q of Q) { const v = q.x * nx + q.y * ny; qMin = Math.min(qMin, v); qMax = Math.max(qMax, v); }
      if (pMax < qMin || qMax < pMin) return false;
    }
  }
  return true;
}

// =============================================================================
// 3. The model: links, joints, poses
// =============================================================================

/** Joints with what meets there, the moving links, and poses over the cycle. */
function model(doc, sim, s) {
  const moving = doc.links.filter((l) => !isFrameLink(doc, l));
  const pos = (id) => { const j = jointById(doc, id); return { x: j.x, y: j.y }; };
  const pinJoints = [], groundJoints = [], pens = [];
  for (const j of doc.joints) {
    const at = moving.filter((l) => l.joints.includes(j.id));
    if (j.ground && at.length === 1) groundJoints.push({ joint: j, link: at[0] });
    else if (!j.ground && at.length === 2) pinJoints.push({ joint: j, a: at[0], b: at[1] });
    else if (!j.ground && at.length === 1 && j.trace) pens.push({ joint: j, link: at[0] });
  }
  // poses: the whole cycle when the mechanism can be driven, else the drawn pose
  const sw = sim && sim.drivable ? sim.getSweep() : null;
  const sys = sim && sim.sys;
  const qs = sw && sw.samples.length ? sw.samples.map((smp) => smp.q) : (sys ? [designCoordinates(sys)] : []);
  const transforms = qs.map((q) => new Map(moving.map((l) => [l.id, sys ? linkTransform(sys, q, l.id) : (p) => p])));
  const shapeOf = (l, R) => (l.disc ? circle(pos(l.joints[0]), l.disc + (R - s.width / 2), 48) : outlinePolygon(l.joints.map(pos), R, 48));
  // the knob, to turn the input crank by hand: half way along the crank when
  // nothing passes over it ('mid'), else on top of the crank pin ('pin'), on
  // whichever part is uppermost there
  let knob = null;
  const d = doc.driver || {};
  if ((d.type || 'rotary') === 'rotary' && d.link && d.pivot) {
    const crank = moving.find((l) => l.id === d.link);
    const other = crank && crank.joints.find((id) => id !== d.pivot);
    if (crank && other) {
      const P = pos(d.pivot), Q = pos(other), z = sizes(s), K = PRINT.knob;
      const mid = { x: (P.x + Q.x) / 2, y: (P.y + Q.y) / 2 };
      const midFits = Math.hypot(Q.x - P.x, Q.y - P.y) / 2 >= z.Rf + K.diameter / 2 + K.ring + 0.4;
      const pin = pinJoints.find((pj) => pj.joint.id === other && (pj.a === crank || pj.b === crank)) || null;
      knob = { link: crank, mid: midFits ? mid : null, pin, pinAt: Q };
    }
  }
  return { moving, pos, pinJoints, groundJoints, pens, qs, transforms, shapeOf, knob, cycle: !!sw };
}

// =============================================================================
// 4. Stacking: which layer each link is in
// =============================================================================

/**
 * Layers for the moving links: Map linkId → 1, 2, … (1 is nearest the base).
 * Returns { layer, knob (true when the knob fits), heads (conflicts of bolt
 * heads, 'hole' joints only), problems }.
 */
export function planLayers(doc, sim, s = printSettings(doc), M = model(doc, sim, s)) {
  const { moving, transforms, shapeOf } = M;
  const n = moving.length;
  const idx = new Map(moving.map((l, i) => [l.id, i]));
  const m = PRINT.margin, z = sizes(s);
  // outlines at every pose (grown by half the margin each, so they keep the margin apart)
  const grown = moving.map((l) => shapeOf(l, s.width / 2 + m / 2));
  const plain = moving.map((l) => shapeOf(l, s.width / 2));
  const at = (k, i, poly) => { const T = transforms[k].get(moving[i].id); return poly.map(T); };
  const posed = transforms.map((_, k) => moving.map((_, i) => ({ grown: at(k, i, grown[i]), plain: at(k, i, plain[i]) })));
  // same layer: do links i and j touch anywhere in the cycle?
  const clash = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    clash[i][j] = clash[j][i] = posed.some((P) => convexOverlap(P[i].grown, P[j].grown));
  }
  // round things that stand up or hang down at a point: which links pass over them?
  //   where(k) → the point at pose k; r → its radius
  const hits = (where, r, skip = []) => moving.map((l, i) => !skip.includes(l.id) && posed.some((P, k) => distToConvex(where(k), P[i].plain) < r));
  const fixed = (p) => () => p;
  const onLink = (l, p) => (k) => transforms[k].get(l.id)(p);
  const bossR = z.Rf + m;
  const ground = M.groundJoints.map((g) => ({ ...g, hit: hits(fixed(M.pos(g.joint.id)), bossR, [g.link.id]) }));
  const pins = M.pinJoints.map((p) => ({ ...p, hit: hits(onLink(p.a, M.pos(p.joint.id)), bossR, [p.a.id, p.b.id]),
    head: hits(onLink(p.a, M.pos(p.joint.id)), 0.9 * s.pin + m, [p.a.id, p.b.id]) }));
  const pens = M.pens.map((p) => ({ ...p, hit: hits(onLink(p.link, M.pos(p.joint.id)), PRINT.penRadius, [p.link.id]) }));
  const K = M.knob;
  const knobMid = K && K.mid && hits(onLink(K.link, K.mid), PRINT.knob.diameter / 2 + m, [K.link.id]);
  const knobPin = K && K.pin && hits(onLink(K.link, K.pinAt), pinKnobRadius(s) + m, [K.pin.a.id, K.pin.b.id]);

  // score an order; null when it does not work
  const score = (L, needKnob) => {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (L[i] === L[j] && clash[i][j]) return null;
    let bosses = 0, heads = 0;
    for (const g of ground) { const k = L[idx.get(g.link.id)]; for (let i = 0; i < n; i++) if (g.hit[i] && L[i] < k) return null; }
    for (const p of pins) {
      const ka = L[idx.get(p.a.id)], kb = L[idx.get(p.b.id)];
      if (ka === kb) return null;
      const lo = Math.min(ka, kb), hi = Math.max(ka, kb);
      bosses += hi - lo - 1;
      for (let i = 0; i < n; i++) {
        if (p.hit[i] && L[i] > lo && L[i] < hi) return null;
        if (s.joint === 'hole' && p.head[i] && (L[i] > hi || L[i] < lo)) heads++;
      }
    }
    for (const p of pens) { const k = L[idx.get(p.link.id)]; for (let i = 0; i < n; i++) if (p.hit[i] && L[i] < k) return null; }
    if (needKnob === 'mid') { const k = L[idx.get(K.link.id)]; for (let i = 0; i < n; i++) if (knobMid[i] && L[i] > k) return null; }
    if (needKnob === 'pin') {
      const k = Math.max(L[idx.get(K.pin.a.id)], L[idx.get(K.pin.b.id)]);
      for (let i = 0; i < n; i++) if (knobPin[i] && L[i] > k) return null;
    }
    return { top: Math.max(...L), bosses, heads };
  };
  const better = (a, b) => !b || a.top < b.top || (a.top === b.top && (a.heads < b.heads || (a.heads === b.heads && a.bosses < b.bosses)));
  const search = (needKnob) => {
    let best = null, bestL = null;
    const L = new Array(n).fill(1);
    const walk = (i) => {
      if (i === n) { const sc = score(L, needKnob); if (sc && better(sc, best)) { best = sc; bestL = L.slice(); } return; }
      for (let k = 1; k <= n; k++) { L[i] = k; walk(i + 1); }
    };
    walk(0);
    return bestL && { L: bestL, ...best };
  };
  let found = null, knobAt = null;
  if (knobMid) { found = search('mid'); if (found) knobAt = 'mid'; }
  // (with pins or rivets, a long bolt at the crank pin is the handle instead)
  if (!found && knobPin && s.joint === 'snap' && pinKnobRadius(s)) { found = search('pin'); if (found) knobAt = 'pin'; }
  if (!found) found = search(null);
  if (!found) return { layer: null, knob: null, problems: ['No stacking of the links keeps them clear of each other over the cycle (check that the links do not cross through a pen or a ground pivot).'] };
  const layer = new Map(moving.map((l, i) => [l.id, found.L[i]]));
  const notes = [];
  if (M.knob && !knobAt) notes.push('There is no room for a knob on the input crank (a link passes over it); turn the crank by hand.');
  if (found.heads) notes.push('Some pin or rivet heads may touch a link in the next layer: use flat heads, or check the turn before tightening.');
  if (!M.cycle) notes.push('The mechanism cannot be driven through a cycle, so the parts were checked at the drawn position only.');
  // the pen must not run over a boss on the base
  for (const p of M.pens) {
    const P = (k) => transforms[k].get(p.link.id)(M.pos(p.joint.id));
    for (const g of M.groundJoints) {
      const G = M.pos(g.joint.id);
      if (transforms.some((_, k) => Math.hypot(P(k).x - G.x, P(k).y - G.y) < z.Rf + PRINT.penRadius)) {
        notes.push(`The pen at J${doc.joints.indexOf(p.joint) + 1} passes over the pivot at J${doc.joints.indexOf(g.joint) + 1}: keep it short of the base there.`);
      }
    }
  }
  return { layer, knob: knobAt, notes, problems: [], top: found.top };
}

// =============================================================================
// 5. Parts
// =============================================================================

/**
 * A surface of revolution at centre c: profile = points { r, z } (r = 0 on the
 * axis; null marks a jump along the axis), walked with the material on its
 * right, from the part's bottom face to its top face. slots: { from, to }
 * profile indices (the fingers of a slotted pin) and the angular ranges cut away.
 */
function revolve(mesh, c, profile, N, slots = null) {
  // i is taken round the circle (i = N is point 0), so shared points match exactly
  const pt = (p, i) => { i %= N; return p.r === 0 ? [c.x, c.y, p.z] : [c.x + p.r * Math.cos((TAU * i) / N), c.y + p.r * Math.sin((TAU * i) / N), p.z]; };
  const cut = (i) => slots && slots.ranges.some(([a, b]) => (i - a + N) % N < b - a);
  for (let s = 0; s + 1 < profile.length; s++) {
    const p = profile[s], q = profile[s + 1];
    if (!p || !q) continue;
    const nr = -(q.z - p.z), nz = q.r - p.r;   // outward (left of the walk)
    const finger = slots && s >= slots.from && s < slots.to;
    for (let i = 0; i < N; i++) {
      if (finger && cut(i)) continue;
      const fm = (TAU * (i + 0.5)) / N, hint = [nr * Math.cos(fm), nr * Math.sin(fm), nz];
      const A = pt(p, i), B = pt(p, i + 1), C = pt(q, i + 1), D = pt(q, i);
      if (p.r === 0) mesh.tri(A, C, D, hint);
      else if (q.r === 0) mesh.tri(A, B, C, hint);
      else mesh.quad(A, B, C, D, hint);
    }
  }
  if (!slots) return;
  // the floor of each slot, and the two sides of the fingers beside it
  const lo = profile[slots.from], hi = profile[slots.to];          // (bore, z) and (pin, z): the slot's floor
  const section = profile.slice(slots.from, slots.to + 1);          // the finger's cross-section, closed by the floor
  const tri = earcut(section.flatMap((p) => [p.r, p.z]), null, 2);
  for (const [a, b] of slots.ranges) {
    for (let i = a; i < b; i++) mesh.quad(pt(lo, i), pt(lo, i + 1), pt(hi, i + 1), pt(hi, i), [0, 0, 1]);
    for (const [k, sgn] of [[a, 1], [b, -1]]) {
      const f = (TAU * k) / N, hint = [-sgn * Math.sin(f), sgn * Math.cos(f), 0];
      for (let t = 0; t < tri.length; t += 3) mesh.tri(pt(section[tri[t]], k), pt(section[tri[t + 1]], k), pt(section[tri[t + 2]], k), hint);
    }
  }
}

/** The slots of a snap pin: angular index ranges [from, to) round the circle. */
function slotRanges(N, rMid) {
  const S = PRINT.snap;
  const w = Math.max(2, Math.round(S.slotWidth / rMid / (TAU / N)));
  const out = [];
  for (let k = 0; k < S.slots; k++) {
    const c = Math.round((k * N) / S.slots + N / (2 * S.slots));
    out.push([c - Math.floor(w / 2), c - Math.floor(w / 2) + w]);
  }
  return out.map(([a, b]) => (a < 0 ? [a + N, b + N] : [a, b]));
}

/**
 * Round features at a joint (profiles from z = 0 to the part's thickness t,
 * with the ring at radius Rf where they meet the flat faces).
 *   kind 'upper'  the hole of the part on top (with the recess for a snap pin)
 *        'lower'  the pin (snap) or hole (pins and rivets) of the part below,
 *                 on a boss of height H when it skips layers
 *        'hole'   a plain hole of radius rh
 *        'knob'   a round knob to turn the crank by
 */
function feature(kind, s, t, opt = {}) {
  const z = sizes(s), S = PRINT.snap, ch = PRINT.holeChamfer, Rf = opt.Rf || z.Rf;
  const P = (r, zz) => ({ r, z: zz });
  if (kind === 'hole' || (kind === 'upper' && s.joint === 'hole') || (kind === 'lower' && s.joint === 'hole' && !opt.H)) {
    const rh = opt.rh || z.rh;
    return { Rf, profile: [P(Rf, 0), P(rh + ch, 0), P(rh, ch), P(rh, t), P(Rf, t)] };
  }
  if (kind === 'upper') {
    const zc = t - z.recessDepth;
    return { Rf, profile: [P(Rf, 0), P(z.rh + ch, 0), P(z.rh, ch), P(z.rh, zc), P(z.recessR, zc), P(z.recessR, t), P(Rf, t)] };
  }
  if (kind === 'upperKnob') {                     // the hole and recess of the part on top, closed by a knob
    const zc = t - z.recessDepth, K = PRINT.knob, rk = pinKnobRadius(s), top = t + K.height;
    return { Rf, profile: [P(Rf, 0), P(z.rh + ch, 0), P(z.rh, ch), P(z.rh, zc), P(z.recessR, zc), P(z.recessR, t), P(0, t), null,
      P(0, top), P(rk - K.chamfer, top), P(rk, top - K.chamfer), P(rk, t), P(Rf, t)] };
  }
  if (kind === 'knob') {
    const K = PRINT.knob, rk = K.diameter / 2, top = t + K.height;
    return { Rf: rk + K.ring, profile: [P(rk + K.ring, 0), P(0, 0), null, P(0, top), P(rk - K.chamfer, top), P(rk, top - K.chamfer), P(rk, t), P(rk + K.ring, t)] };
  }
  // 'lower'
  const H = opt.H || 0, zb = t + H;               // top of the part (or of its boss) at the joint
  if (s.joint === 'hole') {
    return { Rf, profile: [P(Rf, 0), P(z.rh + ch, 0), P(z.rh, ch), P(z.rh, zb), P(Rf, zb), P(Rf, t)] };
  }
  const upperT = opt.upperT || t;
  const zf = zb + PRINT.layerGap + upperT - z.recessDepth;     // floor of the recess in the part above
  const z1 = zf + S.axialPlay, z2 = z1 + S.catchHeight, z3 = z2 + S.band, zt = z3 + S.lip + S.topInset;
  const zp = zb - S.pocketDepth, zs = zp + S.slotStart;
  const r = z.r, rb = z.bore, rl = r + S.lip;
  const profile = [P(Rf, 0), P(0, 0), null,
    P(0, zp), P(rb, zp), P(rb, zs), P(rb, zt), P(r - S.topInset, zt), P(rl, z3), P(rl, z2), P(r, z1), P(r, zs),
    P(r, zp), P(z.pocketR, zp), P(z.pocketR, zb), P(Rf, zb)];
  if (H > 0) profile.push(P(Rf, t));
  const from = 5, to = 11;                         // (rb, zs) … (r, zs)
  return { Rf, profile, slots: { from, to, ranges: slotRanges(PRINT.segments, (r + rb) / 2) } };
}

/**
 * A flat part of thickness t with outline `outline` (counter-clockwise, part
 * coordinates) and round features [{ c, f }] (f from feature()).
 */
function buildPart(outline, t, features) {
  const N = PRINT.segments, mesh = new Mesh();
  const rings = features.map(({ c, f }) => circle(c, f.Rf, N));
  const loop = signedArea(outline) > 0 ? outline : outline.slice().reverse();
  mesh.face(loop, rings, 0, false);
  mesh.face(loop, rings, t, true);
  mesh.wall(loop, 0, t, true);
  for (const { c, f } of features) revolve(mesh, c, f.profile, N, f.slots);
  return mesh;
}

/** Check that the round features of a part do not run into each other. */
function spacingProblem(features, name) {
  for (let i = 0; i < features.length; i++) for (let j = i + 1; j < features.length; j++) {
    const a = features[i], b = features[j];
    if (Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) < a.f.Rf + b.f.Rf + 0.4) return `${name}: two joints are too close together for this link width and pin size.`;
  }
  return null;
}

/** The z of the bottom of layer k (1, 2, …) above the bottom of the base. */
const layerZ = (s, k) => PRINT.baseThickness + PRINT.baseClear + (k - 1) * (s.thickness + PRINT.layerGap);

/**
 * All the parts: [{ name, mesh, note }], or { problems } when the drawing
 * cannot be printed with these settings.
 */
export function printParts(doc, sim, s = printSettings(doc)) {
  const problems = printProblems(doc, s);
  if (problems.length) return { problems };
  const M = model(doc, sim, s);
  const plan = planLayers(doc, sim, s, M);
  if (!plan.layer) return { problems: plan.problems };
  const nums = linkNumbers(doc);
  const t = s.thickness, gap = PRINT.layerGap, z = sizes(s);
  const parts = [];
  const errors = [];
  const L = (l) => plan.layer.get(l.id);

  // ---- links: part coordinates with the first joint at the origin and the x-axis along the link ----
  for (const link of M.moving) {
    const P = link.joints.map(M.pos);
    const O = P[0];
    const ang = P.length >= 2 ? Math.atan2(P[1].y - O.y, P[1].x - O.x) : 0;
    const c = Math.cos(-ang), sn = Math.sin(-ang);
    const T = (p) => ({ x: c * (p.x - O.x) - sn * (p.y - O.y), y: sn * (p.x - O.x) + c * (p.y - O.y) });
    const outline = (link.disc ? circle(O, link.disc) : outlinePolygon(P, s.width / 2)).map(T);
    const feats = [];
    let knobHere = false;
    for (const pj of M.pinJoints) {
      if (pj.a !== link && pj.b !== link) continue;
      const other = pj.a === link ? pj.b : pj.a;
      const at = T(M.pos(pj.joint.id));
      if (L(link) < L(other)) feats.push({ c: at, f: feature('lower', s, t, { H: (L(other) - L(link) - 1) * (t + gap), upperT: t }) });
      else feats.push({ c: at, f: feature(plan.knob === 'pin' && M.knob.pin === pj ? 'upperKnob' : 'upper', s, t) });
      if (plan.knob === 'pin' && M.knob.pin === pj && L(link) > L(other)) knobHere = true;
    }
    for (const g of M.groundJoints) if (g.link === link) feats.push({ c: T(M.pos(g.joint.id)), f: feature('upper', s, t) });
    for (const p of M.pens) if (p.link === link) feats.push({ c: T(M.pos(p.joint.id)), f: feature('hole', s, t, { rh: PRINT.penHole / 2, Rf: PRINT.penHole / 2 + PRINT.holeChamfer + 1.2 }) });
    if (plan.knob === 'mid' && M.knob.link === link) {
      const kf = { c: T(M.knob.mid), f: feature('knob', s, t) };
      if (!spacingProblem([...feats, kf], 'knob')) { feats.push(kf); knobHere = true; } else plan.notes.push('The input crank is too short for a knob between its joints; turn the crank by hand.');
    }
    const name = `${link.disc ? 'Wheel' : 'Link'}${nums.get(link.id)}`;
    const sp = spacingProblem(feats, name);
    if (sp) { errors.push(sp); continue; }
    parts.push({ name, mesh: buildPart(outline, t, feats), layer: L(link), knob: knobHere, link: link.id });
  }

  // ---- the base: everything that moves over it, plus a margin ----
  const pts = [];
  M.transforms.forEach((Tk) => M.moving.forEach((l) => { for (const p of M.shapeOf(l, s.width / 2)) pts.push(Tk.get(l.id)(p)); }));
  for (const g of M.groundJoints) pts.push(...circle(M.pos(g.joint.id), z.Rf + 1, 24));
  for (const fl of doc.links.filter((l) => isFrameLink(doc, l))) pts.push(...outlinePolygon(fl.joints.map(M.pos), s.width / 2, 24));
  let hullPts = convexHull(pts);
  if (s.base === 'stand') {
    // a straight bottom edge for the stand's slot, below everything (gravity is −y)
    const minY = Math.min(...hullPts.map((p) => p.y)), minX = Math.min(...hullPts.map((p) => p.x)), maxX = Math.max(...hullPts.map((p) => p.x));
    const yb = minY - PRINT.stand.slot - PRINT.margin;
    hullPts = convexHull([...hullPts, { x: minX, y: yb }, { x: maxX, y: yb }]);
  }
  const grounds = doc.joints.filter((j) => j.ground);
  const origin = grounds.length ? M.pos(grounds[0].id) : { x: 0, y: 0 };
  const TG = (p) => ({ x: p.x - origin.x, y: p.y - origin.y });
  const baseOutline = outlinePolygon(hullPts, PRINT.baseMargin).map(TG);
  const tb = PRINT.baseThickness;
  const baseFeats = M.groundJoints.map((g) => ({ c: TG(M.pos(g.joint.id)), f: feature('lower', s, tb, { H: layerZ(s, L(g.link)) - gap - tb, upperT: t }) }));
  const bsp = spacingProblem(baseFeats, 'Base');
  if (bsp) errors.push(bsp);
  else parts.push({ name: 'Base', mesh: buildPart(baseOutline, tb, baseFeats), layer: 0 });

  // ---- the stand: a block with a slot the base stands in ----
  if (s.base === 'stand') {
    const St = PRINT.stand, w = tb + St.fit, len = St.length;
    const half = St.depth / 2, mesh = new Mesh();
    // cross-section (y across the stand, z up) with the slot from the top, extruded along x
    const sec = [{ x: -half, y: 0 }, { x: half, y: 0 }, { x: half, y: St.height }, { x: w / 2, y: St.height }, { x: w / 2, y: St.height - St.slot },
      { x: -w / 2, y: St.height - St.slot }, { x: -w / 2, y: St.height }, { x: -half, y: St.height }];
    const idx = earcut(sec.flatMap((p) => [p.x, p.y]), null, 2);
    const at = (p, x) => [x, p.x, p.y];
    for (const [x, sgn] of [[0, -1], [len, 1]]) for (let i = 0; i < idx.length; i += 3) mesh.tri(at(sec[idx[i]], x), at(sec[idx[i + 1]], x), at(sec[idx[i + 2]], x), [sgn, 0, 0]);
    const ccw = signedArea(sec) > 0;
    for (let i = 0; i < sec.length; i++) {
      const a = sec[i], b = sec[(i + 1) % sec.length];
      const ny = ccw ? b.y - a.y : a.y - b.y, nz = ccw ? a.x - b.x : b.x - a.x;
      mesh.quad(at(a, 0), at(b, 0), at(b, len), at(a, len), [0, ny, nz]);
    }
    parts.push({ name: 'Stand_print_2', mesh, layer: -1 });
  }
  if (errors.length) return { problems: errors };
  return { parts, plan, settings: s };
}

// =============================================================================
// 6. Fit test: four test pieces with different clearances
// =============================================================================

/** Parts to print first, to find the clearance that suits a printer. */
export function fitTestParts(doc, s = printSettings(doc)) {
  const problems = sizeProblems(s);
  if (problems.length) return { problems };
  const t = s.thickness, w = s.width, parts = [];
  const pitch = 1.5 * w + 4, len = w + 3.5 * 4;
  PRINT.fitTest.forEach((c, k) => {
    const sc = { ...s, clearance: c };
    const feats = [{ c: { x: 0, y: 0 }, f: feature('upper', sc, t) }];
    // k + 1 small holes along the piece tell the pieces apart
    for (let i = 0; i <= k; i++) feats.push({ c: { x: w * 0.8 + 3.5 * i, y: 0 }, f: feature('hole', sc, t, { rh: 0.9, Rf: 1.6 }) });
    parts.push({ name: `Test${k + 1}_clearance_${c.toFixed(1)}`, mesh: buildPart(outlinePolygon([{ x: 0, y: 0 }, { x: len, y: 0 }], w / 2), t, feats), clearance: c });
  });
  if (s.joint === 'snap') {
    const pinsAt = PRINT.fitTest.map((_, k) => ({ x: k * pitch, y: 0 }));
    const feats = pinsAt.map((c) => ({ c, f: feature('lower', s, t, { upperT: t }) }));
    parts.push({ name: 'Test_pins', mesh: buildPart(outlinePolygon(pinsAt, w / 2), t, feats) });
  }
  return { parts, settings: s };
}

// =============================================================================
// 7. The download
// =============================================================================

const PRINT_TIPS = [
  'PRINT SETTINGS',
  '  PLA or PETG, 0.4 mm nozzle, 0.2 mm layers, 3 walls, 20 % infill, no supports.',
  '  Print every part as it lies in its file (flat face down, pins and knob up).',
  '  The holes have a small chamfer at the bottom, so no "elephant foot"',
  '  compensation is needed.',
];

/** The README in the zip. */
function readme(doc, res) {
  const s = res.settings;
  const lines = [doc.meta.title || 'Mechanism', `Exported from ${APP.name} ${APP.version} for 3-D printing. All dimensions in millimetres.`, ''];
  lines.push('SETTINGS',
    `  Links ${s.width} mm wide and ${s.thickness} mm thick, as in the mass model (Forces).`,
    s.joint === 'snap'
      ? `  Snap-fit joints: ${s.pin} mm printed pins in ${fmt3(s.pin + s.clearance)} mm holes (clearance ${s.clearance} mm).`
      : `  Holes of ${fmt3(s.pin + s.clearance)} mm for ${s.pin} mm pins, rivets or bolts (clearance ${s.clearance} mm).`,
    `  Base: ${s.base === 'stand' ? 'a plate that stands upright in the stand' : 'a plate that lies flat on the table'}.`, '');
  lines.push(...PRINT_TIPS, '');
  const links = res.parts.filter((p) => p.layer > 0).sort((a, b) => a.layer - b.layer);
  lines.push('ASSEMBLY',
    `  1. ${s.base === 'stand' ? 'Print the stand twice. Stand the base in their slots, one near each end, the side with the pins to the front.' : 'Lay the base on the table, pins up.'}`);
  const pen = doc.joints.some((j) => j.trace);
  let step = 2;
  for (const k of [...new Set(links.map((p) => p.layer))]) {
    const here = links.filter((p) => p.layer === k), names = here.map((p) => p.name).join(' and ');
    lines.push(`  ${step++}. Layer ${k}: ${names}. ${s.joint === 'snap' ? `Press ${here.length > 1 ? 'each one' : 'it'} straight down over its pins until it clicks.` : 'Put the pins or rivets through the holes.'}`);
  }
  if (pen) lines.push(`  ${step++}. To trace the path: tape paper to the base, put a pen refill (about 3 mm) in the hole at the traced point, and push it through until it just touches the paper.`);
  const knobText = res.plan.knob === 'pin' ? ' by the knob over the crank pin' : res.plan.knob === 'mid' ? ' by its knob' : '';
  lines.push(`  ${step}. Turn the crank${knobText} once by hand: everything should turn freely.`, '');
  if (s.joint === 'snap') lines.push('  To take a joint apart, pull the parts firmly apart; the ridge lets go.', '');
  lines.push('LAYERS (from the base up)');
  for (const p of links) lines.push(`  ${p.name}: layer ${p.layer}${p.knob ? ' (with the knob)' : ''}`);
  lines.push('');
  if (res.plan.notes.length) { lines.push('NOTES'); for (const n of res.plan.notes) lines.push(`  ${n}`); lines.push(''); }
  lines.push('If a joint is too tight or too loose, print the fit test (Export > Fit test),',
    'pick the piece that clicks in and turns freely, and enter its clearance.');
  return lines.join('\r\n');
}

const fmt3 = (v) => String(Math.round(v * 100) / 100);

/** The zip for the mechanism: { name, bytes, summary } or { problems }. */
export function printZip(app, s = printSettings(app.doc)) {
  const res = printParts(app.doc, app.sim, s);
  if (res.problems) return res;
  const base = fileName(app.doc.meta.title);
  const files = res.parts.map((p) => ({ name: `${p.name}.stl`, data: p.mesh.stl(`${APP.name} ${p.name}`) }));
  files.push({ name: 'README.txt', data: readme(app.doc, res) });
  const n = res.parts.filter((p) => p.layer > 0).length;
  const summary = `${n} link${n === 1 ? '' : 's'} in ${res.plan.top} layer${res.plan.top === 1 ? '' : 's'}, the base${s.base === 'stand' ? ' and the stand' : ''}`;
  return { name: `${base}-3d-print.zip`, bytes: makeZip(files), summary, notes: res.plan.notes };
}

/** The zip for the fit test. */
export function fitTestZip(app, s = printSettings(app.doc)) {
  const res = fitTestParts(app.doc, s);
  if (res.problems) return res;
  const files = res.parts.map((p) => ({ name: `${p.name}.stl`, data: p.mesh.stl(`${APP.name} ${p.name}`) }));
  const lines = ['Fit test', `Exported from ${APP.name} ${APP.version}. All dimensions in millimetres.`, '',
    `Four test pieces with ${s.pin} mm holes and clearances ${PRINT.fitTest.join(', ')} mm; the number of small holes`,
    'along a piece is its number (1 to 4).',
    s.joint === 'snap'
      ? 'Press each piece onto a pin of Test_pins. Choose the loosest piece that still clicks in and holds,\r\nand turns freely without wobbling. Enter its clearance in Export > For 3-D printing.'
      : 'Push your pin, rivet or bolt through each piece. Choose the one that turns freely without\r\nwobbling, and enter its clearance in Export > For 3-D printing.',
    '', ...PRINT_TIPS];
  files.push({ name: 'README.txt', data: lines.join('\r\n') });
  return { name: `fit-test-${s.joint === 'snap' ? 'snap' : 'holes'}-${s.pin}mm.zip`, bytes: makeZip(files) };
}
