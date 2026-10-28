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
//   'pins'  separate snap pins, printed lying down on a break-off sheet
//           (Pins.stl): a countersunk head at one end, two springy fingers
//           with a ridge at the other. The pin goes through both parts; the
//           head sits in a countersink, the ridge clicks into a recess.
//           Printed lying down, the layers run along the pin: stronger.
//   'hole'  plain holes for pins, rivets or bolts of the pin diameter.
//   Every hole is the pin diameter plus the clearance (on the diameter).
//
// Base (settings.base):
//   'flat'  a plate that lies on the table; the links move above it. A pen
//           in a traced point draws on paper taped to the plate.
//   'stand' the same plate with a straight bottom edge, and a stand with a
//           slot that holds it upright.
//
// Counterweights (settings.counterweights, from the Balancing tab): the link
// gets an arm with a round pad, and a steel stack is bolted to the pad: a
// countersunk bolt, large washers and a nut. The printed arm's own mass is
// counted: the stack is sized so the link with its arm and stack has the
// first moment (m·b) the balance needs. For a fourbar the need is worked out
// again from the printed coupler (with its holes, pins and knob).
//
// Stacking: the links sit in layers above the base. Links joined at a joint
// are in different layers; links in the same layer must not touch anywhere
// in the cycle; a pin that skips layers stands on a boss, which must not be
// in the way of links in the layers between; the pen must not hit the links
// below it, nor the knob (on the input crank, or on its crank pin) the links
// above it; a counterweight stack stands above its link, or hangs below it
// (the links are then lifted off the base to make room). The smallest stack
// that meets all this is found by trying every order (the whole cycle is
// checked once, then the orders are compared).
//
// Limits of this version: pin joints only (no sliders, gears, cams or linear
// actuators), at most two links at a joint, at most 7 moving links.
// Units: millimetres; masses in grams unless said.
// =============================================================================

import { Mesh, signedArea } from '../../../../packages/cad-export/src/mesh.js';
import { makeZip } from '../../../../packages/cad-export/src/zip.js';
import { linkOutline } from '../../../../packages/cad-export/src/outline.js';
import { convexHull } from '../../../../packages/core-math/src/index.js';
import earcut from '../../../../node_modules/earcut/src/earcut.js';
import { jointById, isFrameLink, linkNumbers } from '../model/document.js';
import { dynamicsOf, densityOf, MATERIALS, massProps, counterweightsOf, counterweightsOn, linkFrame, toLocal, toWorld } from '../model/mass.js';
import { linkTransform, designCoordinates, classify } from '../kinematics/index.js';
import { APP } from '../config.js';
import { fileName } from './cad.js';

// ---- CONFIG -----------------------------------------------------------------
export const PRINT_DEFAULTS = {
  joint: 'snap',          // 'snap' (pins printed on the links) | 'pins' (separate snap pins) | 'hole'
  base: 'flat',           // 'flat' | 'stand'
  clearance: 0.3,         // hole Ø − pin Ø (mm); the fit test helps to choose it
  counterweights: false,  // print the counterweights from Balancing (arm + bolted steel stack)
};

export const PRINT = {
  segments: 72,         // points round a full circle (a multiple of 4)
  layerGap: 0.3,        // gap between parts stacked on each other (mm)
  baseThickness: 3,     // the base plate
  baseClear: 2,         // lowest link above the plate (more when a counterweight hangs below)
  baseMargin: 4,        // the plate reaches this far beyond everything that moves over it
  margin: 1.0,          // kept between parts that pass each other in the cycle
  ringInset: 0.5,       // a joint's round features stay this far inside the link edge
  holeChamfer: 0.4,     // at the bottom of every hole (the first layer spreads)
  penHole: 3.3,         // a traced point: a hole for a pen refill
  penRadius: 2.5,       // room the pen needs as it passes over other links
  knob: { diameter: 7, height: 12, chamfer: 0.8, ring: 0.8 },
  snap: {               // the ridge and recess (both kinds of snap pin)
    bore: 0.5,          // inside Ø of the hollow pin, as a share of the pin Ø
    slots: 4,           // slots down the pin (four springy fingers)
    slotWidth: 1.2,     // at mid-wall
    lip: 0.45,          // the ridge stands out this far from the pin
    catchHeight: 0.25,  // the ridge's catch face: about 30° from flat
    band: 0.4,          // straight part of the ridge
    topInset: 0.25,     // pin tip this much smaller than the pin (lead-in)
    axialPlay: 0.1,     // the ridge sits this far past the floor of the recess
    flushInset: 0.15,   // pin tip this far inside the outer face of the part
    recess: 0.4,        // the recess is this much wider than the ridge
    pocketGap: 0.8,     // room round the pin's root, so the fingers are longer
    pocketDepth: 2.5,
    slotStart: 0.5,     // slots start this far above the bottom of the pocket
  },
  pins: {               // separate snap pins, printed lying down
    flat: 0.75,         // flat top and bottom at ± this share of the pin radius
    slotWidth: 1.0,     // one slot across the pin, upright as printed (the fingers bend in the bed's plane)
    head: 1.2,          // the countersunk head stands out this far (45°)
    headTop: 0.6,       // straight part of the head
    nubRoom: 0.4,       // the head sits this far below the surface (room for the break-off nub)
    slotLength: 1.4,    // slot length, as a share of the link thickness
    arc: 10,            // points on each rounded side
    gate: { w: 1.0, h: 1.0, z: 0.3, length: 1.5 },   // the thin tab that holds a pin to the bar
    bar: { w: 3, h: 2, end: 2 },                      // the bar along the heads
    gap: 2.5,           // between pins on the sheet
  },
  weights: {
    pad: 0.5,           // the pad is this much wider than the washers
    maxStack: 4,        // a stack stands out at most this many link thicknesses
    thread: 1.0,        // bolt end past the nut
    // steel hardware (approximate masses in g): ISO 10642 countersunk bolt (length
    // includes the head), ISO 4032 nut, ISO 7093 large washer
    bolts: [
      { size: 'M4', d: 4, dk: 9.0, k: 2.5, head: 0.68, perMm: 0.075, nut: { m: 3.2, g: 0.75 }, washer: { od: 12, h: 1.0, g: 0.77 } },
      { size: 'M5', d: 5, dk: 11.2, k: 3.1, head: 1.32, perMm: 0.12, nut: { m: 4.7, g: 1.32 }, washer: { od: 15, h: 1.2, g: 1.46 } },
      { size: 'M6', d: 6, dk: 13.4, k: 3.7, head: 2.25, perMm: 0.173, nut: { m: 5.2, g: 2.38 }, washer: { od: 18, h: 1.6, g: 2.79 } },
      { size: 'M8', d: 8, dk: 17.9, k: 5.0, head: 5.37, perMm: 0.32, nut: { m: 6.8, g: 5.13 }, washer: { od: 24, h: 2.0, g: 6.23 } },
    ],
    lengths: [8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60],
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

/** Does the drawing have counterweights (from Balancing) that can be printed? */
export function hasCounterweights(doc) {
  return counterweightsOn(doc) && doc.links.some((l) => counterweightsOf(doc, l).length);
}

/** Sizes that follow from the settings (mm). */
function sizes(s) {
  const S = PRINT.snap, Pn = PRINT.pins;
  const r = s.pin / 2;
  const Rf = s.width / 2 - PRINT.ringInset;                  // edge of a joint's round features
  const rh = (s.pin + s.clearance) / 2;                      // hole radius
  const recessDepth = S.axialPlay + S.catchHeight + S.band + S.lip + S.topInset + S.flushInset;
  const recessR = r + S.lip + S.recess;
  // separate pins: head radius, countersink radius and depths (to its straight part, and to its cone's bottom)
  const Rh = r + Pn.head, Rc = Rh + s.clearance / 2 + 0.1;
  const cs2 = Pn.headTop + Pn.nubRoom, cs1 = cs2 + (Rc - rh);
  return { r, Rf, rh, recessDepth, recessR, pocketR: r + S.pocketGap, bore: (S.bore * s.pin) / 2, Rh, Rc, cs1, cs2, flat: Pn.flat * r };
}

// =============================================================================
// 1. Checks: what this version can print
// =============================================================================

/** Problems that stop the export (plain-language messages); empty when it can go ahead. */
export function printProblems(doc, s = printSettings(doc)) {
  const out = [...mechanismProblems(doc), ...sizeProblems(s)];
  if (s.counterweights && hasCounterweights(doc)) {
    const mat = MATERIALS[dynamicsOf(doc).material];
    if (!mat || mat.group !== '3-D printing (solid)') {
      out.push('The counterweights are sized for the material in Forces: set it to the plastic you print (PLA, PETG, …) and balance again before exporting.');
    }
  }
  return out;
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
  const widest = s.joint === 'snap' ? z.recessR : s.joint === 'pins' ? Math.max(z.recessR, z.Rc) : z.rh + PRINT.holeChamfer;
  if (z.Rf - widest < 0.8) {
    out.push(`The links are too narrow for ${s.pin} mm pins: make the link width at least ${fmt(2 * (widest + 0.8 + PRINT.ringInset))} mm, or the pins thinner.`);
  }
  if (s.joint === 'snap') {
    if (s.thickness - z.recessDepth < 2.5) out.push(`Snap-fit joints need links at least ${fmt(z.recessDepth + 2.5)} mm thick (the thickness is set in Forces).`);
    if (s.thickness - PRINT.snap.pocketDepth < 1) out.push(`Snap-fit joints need links at least ${fmt(PRINT.snap.pocketDepth + 1)} mm thick.`);
  }
  if (s.joint === 'pins' && s.thickness - Math.max(z.cs1, z.recessDepth) < 2.5) {
    out.push(`Separate snap pins need links at least ${fmt(Math.max(z.cs1, z.recessDepth) + 2.5)} mm thick (the thickness is set in Forces).`);
  }
  if (s.joint !== 'hole' && s.pin < 3) out.push('Snap pins need a pin diameter of at least 3 mm.');
  if (!(s.clearance >= 0) || s.clearance > s.pin / 2) out.push('The clearance must be between 0 and half the pin diameter.');
  return out;
}

const fmt = (v) => String(Math.round(v * 10) / 10);
const fmt3 = (v) => String(Math.round(v * 100) / 100);

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
  return dedupe(loop);
}

/** Drop points that repeat (an arc of no angle between edges in line). */
const dedupe = (loop) => loop.filter((p, i) => { const q = loop[(i + 1) % loop.length]; return Math.hypot(q.x - p.x, q.y - p.y) > 1e-4; });

/** The convex hull of circles [{ c, r }] as a polygon (counter-clockwise). */
function circlesHull(circles, seg = PRINT.segments) {
  return dedupe(convexHull(circles.flatMap(({ c, r }) => circle(c, r, seg))));
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
  // counterweights: one stack per link (several on a link are added together)
  const weights = new Map();
  if (s.counterweights && counterweightsOn(doc)) {
    for (const l of moving) {
      const list = counterweightsOf(doc, l);
      if (!list.length) continue;
      const { from, to } = list[0].cw;
      const F = linkFrame(pos, from, to && l.joints.includes(to) ? to : null);
      const mR = list.reduce((a, c) => { const q = toLocal(F, c.p); return { x: a.x + c.m * q.x, y: a.y + c.m * q.y }; }, { x: 0, y: 0 });
      const radius = Math.max(...list.map((c) => Math.hypot(toLocal(F, c.p).x, toLocal(F, c.p).y)));
      weights.set(l.id, { link: l, F, from, to, radius, m: list.reduce((a, c) => a + c.m, 0), mR });
    }
  }
  const pad = (l) => weights.get(l.id) && weights.get(l.id).pad;     // { c, r } once sized (section 6)
  const shapeOf = (l, R) => {
    if (l.disc) return circle(pos(l.joints[0]), l.disc + (R - s.width / 2), 48);
    const p = pad(l);
    if (p) return circlesHull([...l.joints.map((id) => ({ c: pos(id), r: R })), { c: p.c, r: p.r + (R - s.width / 2) }], 48);
    return outlinePolygon(l.joints.map(pos), R, 48);
  };
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
      const midFits = !weights.has(crank.id) && Math.hypot(Q.x - P.x, Q.y - P.y) / 2 >= z.Rf + K.diameter / 2 + K.ring + 0.4;
      const pin = pinJoints.find((pj) => pj.joint.id === other && (pj.a === crank || pj.b === crank)) || null;
      knob = { link: crank, mid: midFits ? mid : null, pin, pinAt: Q };
    }
  }
  return { moving, pos, pinJoints, groundJoints, pens, qs, transforms, shapeOf, knob, weights, cycle: !!sw };
}

// =============================================================================
// 4. Stacking: which layer each link is in
// =============================================================================

/**
 * Layers for the moving links: Map linkId → 1, 2, … (1 is nearest the base).
 * Returns { layer, knob ('mid' | 'pin' | null), stacks (Map linkId → 'up' |
 * 'down'), baseClear, notes, problems, top }.
 */
export function planLayers(doc, sim, s = printSettings(doc), M = model(doc, sim, s)) {
  const { moving, transforms, shapeOf } = M;
  const n = moving.length;
  const idx = new Map(moving.map((l, i) => [l.id, i]));
  const m = PRINT.margin, z = sizes(s), t = s.thickness, gap = PRINT.layerGap;
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
  // counterweight stacks: the links that pass over or under one, and whether it would sweep over a ground pivot
  const stacks = [...M.weights.values()].filter((w) => w.pad).map((w) => {
    const where = onLink(w.link, w.pad.c), R = w.stack.od / 2 + m;
    const nearPivot = M.groundJoints.some((g) => transforms.some((_, k) => {
      const p = where(k), G = M.pos(g.joint.id);
      return Math.hypot(p.x - G.x, p.y - G.y) < R + z.Rf;
    }));
    return { w, hit: hits(where, R, [w.link.id]), nearPivot };
  });

  // score an order; null when it does not work
  const score = (L, needKnob) => {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (L[i] === L[j] && clash[i][j]) return null;
    let bosses = 0, heads = 0, raise = 0;
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
    const dirs = [];
    for (const st of stacks) {
      const k = L[idx.get(st.w.link.id)];
      const up = !st.hit.some((h, i) => h && L[i] > k);
      const down = !st.nearPivot && !st.hit.some((h, i) => h && L[i] < k);
      if (up) dirs.push('up');
      else if (down) { dirs.push('down'); raise = Math.max(raise, st.w.stack.height + m - (k - 1) * (t + gap)); }
      else return null;
    }
    return { top: Math.max(...L), bosses, heads, raise, dirs };
  };
  const better = (a, b) => !b || a.top < b.top || (a.top === b.top && (a.raise < b.raise || (a.raise === b.raise
    && (a.heads < b.heads || (a.heads === b.heads && a.bosses < b.bosses)))));
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
  if (!found && knobPin && s.joint !== 'hole' && pinKnobRadius(s)) { found = search('pin'); if (found) knobAt = 'pin'; }
  if (!found) found = search(null);
  if (!found) {
    return { layer: null, knob: null, problems: [stacks.length
      ? 'No stacking of the links keeps them and the counterweights clear of each other over the cycle: try a smaller counterweight radius in Balancing.'
      : 'No stacking of the links keeps them clear of each other over the cycle (check that the links do not cross through a pen or a ground pivot).'] };
  }
  const layer = new Map(moving.map((l, i) => [l.id, found.L[i]]));
  const stackDir = new Map(stacks.map((st, i) => [st.w.link.id, found.dirs[i]]));
  const notes = [];
  if (M.knob && !knobAt) notes.push('There is no room for a knob on the input crank (a link or counterweight passes over it); turn the crank by hand.');
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
  const baseClear = Math.max(PRINT.baseClear, Math.ceil(found.raise * 10) / 10);
  return { layer, knob: knobAt, stacks: stackDir, baseClear, notes, problems: [], top: found.top };
}

// =============================================================================
// 5. Round features of the flat parts
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
 *   kind 'upper'      the hole of the part on top: with the recess for a snap
 *                     pin, or the countersink for a separate pin's head
 *        'upperKnob'  the hole and recess of the part on top, closed by a knob
 *        'lower'      the part below: the pin (snap), or a hole with the recess
 *                     for a separate pin's ridge underneath (pins), or a plain
 *                     hole (pins and rivets); on a boss of height H when it skips layers
 *        'lowerHead'  the part below, with the countersink underneath (a
 *                     separate pin put in from below, under a knob)
 *        'hole'       a plain hole of radius rh
 *        'knob'       a round knob to turn the crank by
 *        'boltTop' / 'boltBottom'  a hole for a countersunk bolt (opt.bolt),
 *                     the countersink on the top or the bottom face
 */
function feature(kind, s, t, opt = {}) {
  const z = sizes(s), S = PRINT.snap, ch = PRINT.holeChamfer, Rf = opt.Rf || z.Rf;
  const P = (r, zz) => ({ r, z: zz });
  const H = opt.H || 0, zb = t + H;                 // top of the part (or of its boss) at the joint
  const boss = H > 0 ? [P(Rf, t)] : [];
  if (kind === 'hole' || (kind === 'upper' && s.joint === 'hole') || (kind === 'lower' && s.joint === 'hole' && !H)) {
    const rh = opt.rh || z.rh;
    return { Rf, profile: [P(Rf, 0), P(rh + ch, 0), P(rh, ch), P(rh, t), P(Rf, t)] };
  }
  if (kind === 'boltTop' || kind === 'boltBottom') {
    const rb = opt.bolt.d / 2 + 0.2, rk = opt.bolt.dk / 2 + 0.2, kd = rk - rb;
    return kind === 'boltTop'
      ? { Rf, profile: [P(Rf, 0), P(rb + ch, 0), P(rb, ch), P(rb, t - kd), P(rk, t), P(Rf, t)] }
      : { Rf, profile: [P(Rf, 0), P(rk, 0), P(rb, kd), P(rb, t), P(Rf, t)] };
  }
  if (kind === 'upper' && s.joint === 'pins') {
    return { Rf, profile: [P(Rf, 0), P(z.rh + ch, 0), P(z.rh, ch), P(z.rh, t - z.cs1), P(z.Rc, t - z.cs2), P(z.Rc, t), P(Rf, t)] };
  }
  if (kind === 'upper') {
    const zc = t - z.recessDepth;
    return { Rf, profile: [P(Rf, 0), P(z.rh + ch, 0), P(z.rh, ch), P(z.rh, zc), P(z.recessR, zc), P(z.recessR, t), P(Rf, t)] };
  }
  if (kind === 'upperKnob') {
    const zc = t - z.recessDepth, K = PRINT.knob, rk = pinKnobRadius(s), top = t + K.height;
    return { Rf, profile: [P(Rf, 0), P(z.rh + ch, 0), P(z.rh, ch), P(z.rh, zc), P(z.recessR, zc), P(z.recessR, t), P(0, t), null,
      P(0, top), P(rk - K.chamfer, top), P(rk, top - K.chamfer), P(rk, t), P(Rf, t)] };
  }
  if (kind === 'knob') {
    const K = PRINT.knob, rk = K.diameter / 2, top = t + K.height;
    return { Rf: rk + K.ring, profile: [P(rk + K.ring, 0), P(0, 0), null, P(0, top), P(rk - K.chamfer, top), P(rk, top - K.chamfer), P(rk, t), P(rk + K.ring, t)] };
  }
  if (kind === 'lowerHead') {
    return { Rf, profile: [P(Rf, 0), P(z.Rc, 0), P(z.Rc, z.cs2), P(z.rh, z.cs1), P(z.rh, zb), P(Rf, zb), ...boss] };
  }
  // 'lower'
  if (s.joint === 'hole') return { Rf, profile: [P(Rf, 0), P(z.rh + ch, 0), P(z.rh, ch), P(z.rh, zb), P(Rf, zb), ...boss] };
  if (s.joint === 'pins') {
    const rd = z.recessDepth;
    return { Rf, profile: [P(Rf, 0), P(z.recessR, 0), P(z.recessR, rd), P(z.rh, rd), P(z.rh, zb), P(Rf, zb), ...boss] };
  }
  const upperT = opt.upperT || t;
  const zf = zb + PRINT.layerGap + upperT - z.recessDepth;     // floor of the recess in the part above
  const z1 = zf + S.axialPlay, z2 = z1 + S.catchHeight, z3 = z2 + S.band, zt = z3 + S.lip + S.topInset;
  const zp = zb - S.pocketDepth, zs = zp + S.slotStart;
  const r = z.r, rb = z.bore, rl = r + S.lip;
  const profile = [P(Rf, 0), P(0, 0), null,
    P(0, zp), P(rb, zp), P(rb, zs), P(rb, zt), P(r - S.topInset, zt), P(rl, z3), P(rl, z2), P(r, z1), P(r, zs),
    P(r, zp), P(z.pocketR, zp), P(z.pocketR, zb), P(Rf, zb), ...boss];
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
    if (Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) < a.f.Rf + b.f.Rf + 0.4) return `${name}: two joints (or a joint and its counterweight) are too close together for this link width and pin size.`;
  }
  return null;
}

// =============================================================================
// 6. Separate snap pins, printed lying down
// =============================================================================

/**
 * The cross-section of a pin of radius R, flat top and bottom at ±f, with a
 * slot of width sw upright through it (in the pin's own y, z): the whole
 * section, and the two fingers either side of the slot (all counter-clockwise).
 * Where there is no slot yet (dent > 0), the points where the slot will start
 * sit a hair inside the flats, so no three points of the head's end face are
 * in line (its triangles would otherwise have no area).
 */
function pinSection(R, f, sw, na, dent = 0) {
  const a = Math.asin(f / R);
  const arc = (from) => Array.from({ length: na }, (_, j) => { const p = from + (2 * a * j) / (na - 1); return { y: R * Math.cos(p), z: R * Math.sin(p) }; });
  const right = arc(-a), left = arc(Math.PI - a);
  const h = sw / 2, fi = f - dent;
  return {
    full: [...right, { y: h, z: fi }, { y: -h, z: fi }, ...left, { y: -h, z: -fi }, { y: h, z: -fi }],
    right: [...right, { y: h, z: f }, { y: h, z: -f }],
    left: [{ y: -h, z: f }, ...left, { y: -h, z: -f }],
  };
}

/**
 * One pin along x (x = distance from the underside of the head towards the
 * tip), centred on y = z = 0. uc: where the ridge starts (its catch face);
 * us: where the slot starts. Returns { mesh, x0 (the head's end) }. gate: a
 * rectangle [y0, y1, z0, z1] left open in the head's end, for the tab.
 */
export function pinMesh(s, uc, us, gate = null) {
  const Pn = PRINT.pins, S = PRINT.snap, z = sizes(s);
  const r = z.r, f = z.flat, sw = Pn.slotWidth, na = Pn.arc;
  const iS = 3;                                                // the station where the slot starts
  const st = [
    { u: -(Pn.head + Pn.headTop), R: z.Rh }, { u: -Pn.head, R: z.Rh }, { u: 0, R: r },       // head: straight, then 45° to the pin
    { u: us, R: r },                                                                         // the slot starts here
    { u: uc, R: r }, { u: uc + S.catchHeight, R: r + S.lip }, { u: uc + S.catchHeight + S.band, R: r + S.lip },
    { u: uc + S.catchHeight + S.band + S.lip + S.topInset, R: r - S.topInset },             // the ridge and the tip
  ];
  const mesh = new Mesh();
  const sec = st.map((q, i) => pinSection(q.R, f, sw, na, i < iS ? 0.01 : 0));
  const P3 = (u, p) => [u, p.y, p.z];
  const loft = (A, B, a, b) => {
    const dRdu = (b.R - a.R) / (b.u - a.u);
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      const dy = A[j].y - A[i].y, dz = A[j].z - A[i].z, L = Math.hypot(dy, dz) || 1;
      const ny = dz / L, nz = -dy / L;                         // outward, for a counter-clockwise section
      const my = (A[i].y + A[j].y) / 2, mz = (A[i].z + A[j].z) / 2, mr = Math.hypot(my, mz) || 1;
      const hint = [-dRdu * ((ny * my + nz * mz) / mr), ny, nz];
      mesh.quad(P3(a.u, A[i]), P3(a.u, A[j]), P3(b.u, B[j]), P3(b.u, B[i]), hint);
    }
  };
  const cap = (poly, u, dir, holes = []) => {
    const all = [...poly, ...holes.flat()];
    const starts = []; let k = poly.length;
    for (const h of holes) { starts.push(k); k += h.length; }
    const idx = earcut(all.flatMap((p) => [p.y, p.z]), starts.length ? starts : null, 2);
    for (let i = 0; i < idx.length; i += 3) mesh.tri(P3(u, all[idx[i]]), P3(u, all[idx[i + 1]]), P3(u, all[idx[i + 2]]), [dir, 0, 0]);
  };
  for (let i = 0; i < iS; i++) loft(sec[i].full, sec[i + 1].full, st[i], st[i + 1]);
  for (let i = iS; i + 1 < st.length; i++) {
    loft(sec[i].right, sec[i + 1].right, st[i], st[i + 1]);
    loft(sec[i].left, sec[i + 1].left, st[i], st[i + 1]);
  }
  const g = gate && [{ y: gate[0], z: gate[2] }, { y: gate[1], z: gate[2] }, { y: gate[1], z: gate[3] }, { y: gate[0], z: gate[3] }];
  cap(sec[0].full, st[0].u, -1, g ? [g] : []);
  const h = sw / 2;
  cap([{ y: h, z: f }, { y: -h, z: f }, { y: -h, z: -f }, { y: h, z: -f }], st[iS].u, 1);      // the slot's floor
  const last = sec[sec.length - 1], uEnd = st[st.length - 1].u;
  cap(last.right, uEnd, 1);
  cap(last.left, uEnd, 1);
  return { mesh, x0: st[0].u, length: uEnd - st[0].u };
}

/**
 * The pins on a sheet: side by side along y, each held by a thin tab at the
 * end of its head to a bar. pins: [{ uc, us }]. Lying on the bed (z = 0).
 */
function pinSheet(s, pins) {
  const Pn = PRINT.pins, G = Pn.gate, B = Pn.bar, z = sizes(s), f = z.flat;
  const pitch = 2 * z.Rh + Pn.gap;
  const gz0 = -f + G.z, gz1 = gz0 + G.h;
  const sheet = new Mesh();
  let x0 = 0;
  pins.forEach((p, i) => {
    const y = i * pitch;
    const pm = pinMesh(s, p.uc, p.us, [-G.w / 2, G.w / 2, gz0, gz1]);
    x0 = pm.x0;
    pm.mesh.translate(0, y, 0);
    sheet.add(pm.mesh);
  });
  // the tabs, from each head to the bar
  const xb = x0 - G.length;
  const holes = pins.map((_, i) => { const y = i * pitch; return [{ y: y - G.w / 2, z: gz0 }, { y: y + G.w / 2, z: gz0 }, { y: y + G.w / 2, z: gz1 }, { y: y - G.w / 2, z: gz1 }]; });
  for (const hl of holes) {
    for (let k = 0; k < 4; k++) {
      const a = hl[k], b = hl[(k + 1) % 4];
      const hint = [0, (b.z - a.z), -(b.y - a.y)];             // outward from the rectangle (counter-clockwise)
      sheet.quad([xb, a.y, a.z], [xb, b.y, b.z], [x0, b.y, b.z], [x0, a.y, a.z], hint);
    }
  }
  // the bar: a box from xb − w to xb, its face towards the pins open where the tabs join
  const y0 = -z.Rh - B.end, y1 = (pins.length - 1) * pitch + z.Rh + B.end, zb0 = -f, zb1 = -f + B.h, xa = xb - B.w;
  // (the tab holes sit in a row, so their edges are in line: the face is cut by hand into a
  // band below them, a band above them and the pieces between them, with no triangle of no area)
  const F = (y, zz) => [xb, y, zz], up = [1, 0, 0];
  const ys = holes.flatMap((hl) => [hl[0].y, hl[1].y]);      // the tabs' sides, in order along y
  const below = [F(y1, zb0), F(y1, gz0), ...ys.slice().reverse().map((y) => F(y, gz0)), F(y0, gz0)];
  for (let i = 0; i + 1 < below.length; i++) sheet.tri(F(y0, zb0), below[i], below[i + 1], up);
  const above = [F(y0, zb1), F(y0, gz1), ...ys.map((y) => F(y, gz1)), F(y1, gz1)];
  for (let i = 0; i + 1 < above.length; i++) sheet.tri(F(y1, zb1), above[i], above[i + 1], up);
  const cols = [y0, ...ys, y1];                                // between the tabs (and at the ends)
  for (let i = 0; i + 1 < cols.length; i += 2) sheet.quad(F(cols[i], gz0), F(cols[i + 1], gz0), F(cols[i + 1], gz1), F(cols[i], gz1), up);
  sheet.quad([xa, y0, zb0], [xa, y1, zb0], [xa, y1, zb1], [xa, y0, zb1], [-1, 0, 0]);
  sheet.quad([xa, y0, zb0], [xb, y0, zb0], [xb, y1, zb0], [xa, y1, zb0], [0, 0, -1]);
  sheet.quad([xa, y0, zb1], [xb, y0, zb1], [xb, y1, zb1], [xa, y1, zb1], [0, 0, 1]);
  for (const [y, sgn] of [[y0, -1], [y1, 1]]) {              // the ends: their edge on the tab side has the band corners too
    const end = [[xb, y, zb0], [xb, y, gz0], [xb, y, gz1], [xb, y, zb1], [xa, y, zb1]];
    for (let i = 0; i + 1 < end.length; i++) sheet.tri([xa, y, zb0], end[i], end[i + 1], [0, sgn, 0]);
  }
  return sheet.translate(-xa, -y0, f);
}

/**
 * Where the ridge and the slot start on a pin through a stack from Zb (the
 * outer face of the part the ridge clicks into) to Zt (the outer face of the
 * part with the countersink), heights measured along the pin.
 */
export function pinFit(s, grip) {
  const z = sizes(s), S = PRINT.snap;
  const u0 = grip - z.cs1 - s.clearance / 2;                  // the head's cone meets the countersink's
  const uc = u0 - (z.recessDepth - S.axialPlay);
  const us = Math.max(0.8, uc - PRINT.pins.slotLength * s.thickness);
  return { uc, us };
}

// =============================================================================
// 7. Counterweights: the arm, the pad and the steel stack
// =============================================================================

/**
 * The stack of steel hardware closest to `grams`, from the smallest stack
 * that does it: { bolt, length, washers, grams, height, od } or null.
 */
export function chooseStack(grams, t) {
  const W = PRINT.weights;
  let best = null;
  for (const b of W.bolts) {
    if (b.k + 1.0 > t) continue;                               // the countersunk head must fit in the link
    for (let n = 0; n <= 60; n++) {
      const need = t + n * b.washer.h + b.nut.m + W.thread;
      const length = W.lengths.find((L) => L >= need);
      if (!length) break;
      const g = b.head + b.perMm * (length - b.k) + b.nut.g + n * b.washer.g;
      if (g > grams + b.washer.g / 2) break;
      if (g < grams - b.washer.g / 2) continue;
      const height = length - t, od = b.washer.od;
      if (height > W.maxStack * t) break;
      const size = height * od * od;                           // the room it takes
      if (!best || size < best.size) best = { bolt: b, length, washers: n, grams: g, height, od, size };
      break;
    }
  }
  return best;
}

/** Mass (g), first moment about the frame (g·mm, frame coords) of a printed part. */
function partMoment(mesh, toWorldPt, F, rho) {
  const V = mesh.volume(), c = mesh.centroid();
  const g = rho * 1e-6 * V;                                     // kg/m³ × mm³ = 1e-9 kg = 1e-6 g
  const q = toLocal(F, toWorldPt({ x: c[0], y: c[1] }));
  return { g, x: g * q.x, y: g * q.y };
}

/**
 * The first moment (g·mm, in the counterweight's frame) that each link with
 * a counterweight must have, with its arm and stack: for a fourbar, worked
 * out again from the printed coupler (Berkof–Lowen); otherwise what the
 * drawing's mass model has (the link with its counterweights).
 */
function targets(doc, M, coupler) {
  const out = new Map();
  for (const w of M.weights.values()) {
    const mp = massProps(doc, w.link);
    const q = toLocal(w.F, mp.cg);
    out.set(w.link.id, { x: mp.m * 1000 * q.x, y: mp.m * 1000 * q.y });
  }
  const kind = classify(doc);
  if (kind.type === 'fourbar' && coupler) {
    const { input, output } = kind.links;
    const l2 = kind.a, l3 = kind.b, l4 = kind.c;
    const c3 = coupler;                                         // { g, x, y } in the frame A → B
    const crank = M.weights.get(input), rocker = M.weights.get(output);
    if (crank && crank.from === kind.O2.id && crank.to === kind.A.id) out.set(input, { x: c3.x * (l2 / l3) - c3.g * l2, y: c3.y * (l2 / l3) });
    if (rocker && rocker.from === kind.O4.id && rocker.to === kind.B.id) out.set(output, { x: -c3.x * (l4 / l3), y: -c3.y * (l4 / l3) });
  }
  return out;
}

// =============================================================================
// 8. All the parts
// =============================================================================

/** The z of the bottom of layer k (1, 2, …) above the bottom of the base. */
export const layerZ = (s, plan, k) => PRINT.baseThickness + plan.baseClear + (k - 1) * (s.thickness + PRINT.layerGap);

/**
 * All the parts: [{ name, mesh, layer, … }], plus the plan, the pins and the
 * counterweight stacks; or { problems } when the drawing cannot be printed
 * with these settings.
 */
export function printParts(doc, sim, s = printSettings(doc)) {
  const problems = printProblems(doc, s);
  if (problems.length) return { problems };
  const M = model(doc, sim, s);
  const rho = densityOf(dynamicsOf(doc));
  const t = s.thickness, gap = PRINT.layerGap, z = sizes(s);
  const errors = [];

  // ---- counterweights, first estimate: the pad where the drawing has the counterweight ----
  for (const w of M.weights.values()) {
    const stack = chooseStack(Math.hypot(w.mR.x, w.mR.y) * 1000 / (w.radius || 1), t);
    if (!stack) { errors.push(`The counterweight on link ${linkNumbers(doc).get(w.link.id)} cannot be made from one bolt, washers and a nut: change its radius in Balancing.`); continue; }
    w.stack = stack;
    const dir = Math.hypot(w.mR.x, w.mR.y) > 0 ? { x: w.mR.x / Math.hypot(w.mR.x, w.mR.y), y: w.mR.y / Math.hypot(w.mR.x, w.mR.y) } : { x: -1, y: 0 };
    w.pad = { c: toWorld(w.F, { x: dir.x * w.radius, y: dir.y * w.radius }), r: padRadius(w.stack) };
  }
  if (errors.length) return { problems: errors };

  const plan = planLayers(doc, sim, s, M);
  if (!plan.layer) return { problems: plan.problems };
  const nums = linkNumbers(doc);
  const L = (l) => plan.layer.get(l.id);
  const flipped = (pj) => plan.knob === 'pin' && M.knob.pin === pj;   // a separate pin put in from below (under the knob)

  // ---- links: part coordinates with the first joint at the origin and the x-axis along the link ----
  const linkPart = (link) => {
    const P = link.joints.map(M.pos);
    const O = P[0];
    const ang = P.length >= 2 ? Math.atan2(P[1].y - O.y, P[1].x - O.x) : 0;
    const c = Math.cos(ang), sn = Math.sin(ang);
    const T = (p) => ({ x: c * (p.x - O.x) + sn * (p.y - O.y), y: -sn * (p.x - O.x) + c * (p.y - O.y) });
    const Tinv = (q) => ({ x: O.x + c * q.x - sn * q.y, y: O.y + sn * q.x + c * q.y });
    const w = M.weights.get(link.id);
    const outline = (link.disc ? circle(O, link.disc)
      : w ? circlesHull([...P.map((p) => ({ c: p, r: s.width / 2 })), w.pad])
        : outlinePolygon(P, s.width / 2)).map(T);
    const feats = [];
    let knobHere = false;
    for (const pj of M.pinJoints) {
      if (pj.a !== link && pj.b !== link) continue;
      const other = pj.a === link ? pj.b : pj.a;
      const at = T(M.pos(pj.joint.id));
      const lower = L(link) < L(other), H = lower ? (L(other) - L(link) - 1) * (t + gap) : 0;
      if (lower) feats.push({ c: at, f: feature(flipped(pj) && s.joint === 'pins' ? 'lowerHead' : 'lower', s, t, { H, upperT: t }) });
      else feats.push({ c: at, f: feature(flipped(pj) ? 'upperKnob' : 'upper', s, t) });
      if (flipped(pj) && !lower) knobHere = true;
    }
    for (const g of M.groundJoints) if (g.link === link) feats.push({ c: T(M.pos(g.joint.id)), f: feature('upper', s, t) });
    for (const p of M.pens) if (p.link === link) feats.push({ c: T(M.pos(p.joint.id)), f: feature('hole', s, t, { rh: PRINT.penHole / 2, Rf: PRINT.penHole / 2 + PRINT.holeChamfer + 1.2 }) });
    if (plan.knob === 'mid' && M.knob.link === link) {
      const kf = { c: T(M.knob.mid), f: feature('knob', s, t) };
      if (!spacingProblem([...feats, kf], 'knob')) { feats.push(kf); knobHere = true; } else plan.notes.push('The input crank is too short for a knob between its joints; turn the crank by hand.');
    }
    if (w) feats.push({ c: T(w.pad.c), f: feature(plan.stacks.get(link.id) === 'up' ? 'boltBottom' : 'boltTop', s, t, { bolt: w.stack.bolt, Rf: w.stack.bolt.dk / 2 + 1.0 }) });
    const name = `${link.disc ? 'Wheel' : 'Link'}${nums.get(link.id)}`;
    const sp = spacingProblem(feats, name);
    if (sp) return { error: sp };
    return { name, mesh: buildPart(outline, t, feats), layer: L(link), knob: knobHere, link: link.id, Tinv };
  };
  const built = new Map();
  for (const link of M.moving) {
    const part = linkPart(link);
    if (part.error) errors.push(part.error); else built.set(link.id, part);
  }
  if (errors.length) return { problems: errors };

  // ---- counterweights: size the stack for the printed parts, move the pad to suit, and again ----
  const stacks = [];
  if (M.weights.size) {
    const kind = classify(doc);
    // separate pins at the moving joints ride along: count them with the coupler (as masses at its joints)
    const movingPins = s.joint !== 'pins' ? [] : M.pinJoints.map((pj) => {
      const lo = L(pj.a) < L(pj.b) ? pj.a : pj.b, hi = lo === pj.a ? pj.b : pj.a;
      const fit = pinFit(s, layerZ(s, plan, L(hi)) + t - layerZ(s, plan, L(lo)));
      return { at: M.pos(pj.joint.id), g: rho * 1e-6 * pinMesh(s, fit.uc, fit.us).mesh.volume() };
    });
    for (let round = 0; round < 4; round++) {
      let coupler = null;
      if (kind.type === 'fourbar' && built.has(kind.links.coupler)) {
        const F3 = linkFrame(M.pos, kind.A.id, kind.B.id), cp = built.get(kind.links.coupler);
        coupler = partMoment(cp.mesh, cp.Tinv, F3, rho);
        for (const pn of movingPins) { const q = toLocal(F3, pn.at); coupler = { g: coupler.g + pn.g, x: coupler.x + pn.g * q.x, y: coupler.y + pn.g * q.y }; }
      }
      const need = targets(doc, M, coupler);
      for (const w of M.weights.values()) {
        const part = built.get(w.link.id);
        const own = partMoment(part.mesh, part.Tinv, w.F, rho);
        const v = { x: need.get(w.link.id).x - own.x, y: need.get(w.link.id).y - own.y }, mag = Math.hypot(v.x, v.y);
        w.grams = mag / w.radius;
        const stack = chooseStack(w.grams, t);
        if (!stack) { errors.push(`The counterweight on link ${nums.get(w.link.id)} (${fmt(w.grams)} g) cannot be made from one bolt, washers and a nut: change its radius in Balancing.`); continue; }
        w.stack = stack;
        w.pad = { c: toWorld(w.F, { x: (v.x / (mag || 1)) * w.radius, y: (v.y / (mag || 1)) * w.radius }), r: padRadius(stack) };
        const again = linkPart(w.link);
        if (again.error) { errors.push(again.error); continue; }
        built.set(w.link.id, again);
      }
      if (errors.length) return { problems: errors };
    }
    for (const w of M.weights.values()) {
      const dir = plan.stacks.get(w.link.id);
      // a stack that hangs below its link needs the room under it (it may have grown since the plan)
      if (dir === 'down') plan.baseClear = Math.max(plan.baseClear, Math.ceil((w.stack.height + PRINT.margin - (L(w.link) - 1) * (t + gap)) * 10) / 10);
      stacks.push({ link: w.link.id, name: built.get(w.link.id).name, at: w.pad.c, dir, grams: w.grams, stack: w.stack, radius: w.radius, F: w.F });
    }
  }
  if (errors.length) return { problems: errors };
  const parts = [...built.values()];

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
  const baseFeats = M.groundJoints.map((g) => ({ c: TG(M.pos(g.joint.id)), f: feature('lower', s, tb, { H: layerZ(s, plan, L(g.link)) - gap - tb, upperT: t }) }));
  const bsp = spacingProblem(baseFeats, 'Base');
  if (bsp) return { problems: [bsp] };
  parts.push({ name: 'Base', mesh: buildPart(baseOutline, tb, baseFeats), layer: 0, origin });

  // ---- separate pins: one per joint, each as long as its stack ----
  const pins = [];
  if (s.joint === 'pins') {
    for (const pj of M.pinJoints) {
      const lo = L(pj.a) < L(pj.b) ? pj.a : pj.b, hi = lo === pj.a ? pj.b : pj.a;
      const grip = layerZ(s, plan, L(hi)) + t - layerZ(s, plan, L(lo));
      pins.push({ joint: pj.joint, grip, up: flipped(pj), bottom: layerZ(s, plan, L(lo)), ...pinFit(s, grip) });
    }
    for (const g of M.groundJoints) {
      const grip = layerZ(s, plan, L(g.link)) + t;
      pins.push({ joint: g.joint, grip, up: false, bottom: 0, ...pinFit(s, grip) });
    }
    pins.sort((a, b) => a.grip - b.grip || doc.joints.indexOf(a.joint) - doc.joints.indexOf(b.joint));
    parts.push({ name: 'Pins', mesh: pinSheet(s, pins), layer: -2 });
  }

  // ---- the stand: a block with a slot the base stands in ----
  if (s.base === 'stand') parts.push({ name: 'Stand_print_2', mesh: standMesh(), layer: -1 });
  return { parts, plan, pins, stacks, settings: s };
}

/** Radius of the round pad a counterweight stack sits on. */
function padRadius(stack) {
  return Math.max(stack.od / 2 + PRINT.weights.pad, stack.bolt.dk / 2 + 1.5);
}

/** The stand: a block with a slot from the top, the base plate stands in it. */
function standMesh() {
  const St = PRINT.stand, w = PRINT.baseThickness + St.fit, len = St.length;
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
  return mesh;
}

// =============================================================================
// 9. Fit test: four test pieces with different clearances
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
  const at = PRINT.fitTest.map((_, k) => ({ x: k * pitch, y: 0 }));
  if (s.joint === 'snap') {
    const feats = at.map((c) => ({ c, f: feature('lower', s, t, { upperT: t }) }));
    parts.push({ name: 'Test_pins', mesh: buildPart(outlinePolygon(at, w / 2), t, feats) });
  }
  if (s.joint === 'pins') {
    // the bar under the pieces: its holes have the same clearances, in the same order
    const feats = at.map((c, k) => ({ c, f: feature('lower', { ...s, clearance: PRINT.fitTest[k] }, t) }));
    parts.push({ name: 'Test_bar', mesh: buildPart(outlinePolygon(at, w / 2), t, feats) });
    const fit = pinFit(s, 2 * t + PRINT.layerGap);
    parts.push({ name: 'Test_pins', mesh: pinSheet(s, PRINT.fitTest.map(() => fit)) });
  }
  return { parts, settings: s };
}

// =============================================================================
// 10. The download
// =============================================================================

const PRINT_TIPS = [
  'PRINT SETTINGS',
  '  PLA or PETG, 0.4 mm nozzle, 0.2 mm layers, 3 walls, 20 % infill, no supports.',
  '  Print every part as it lies in its file (flat face down, pins and knob up).',
  '  The holes have a small chamfer at the bottom, so no "elephant foot"',
  '  compensation is needed.',
];

const JOINT_TEXT = {
  snap: (s) => `Snap-fit joints: ${s.pin} mm pins printed on the links, in ${fmt3(s.pin + s.clearance)} mm holes (clearance ${s.clearance} mm).`,
  pins: (s) => `Separate snap pins: ${s.pin} mm pins (Pins.stl) in ${fmt3(s.pin + s.clearance)} mm holes (clearance ${s.clearance} mm).`,
  hole: (s) => `Holes of ${fmt3(s.pin + s.clearance)} mm for ${s.pin} mm pins, rivets or bolts (clearance ${s.clearance} mm).`,
};

/** The README in the zip. */
function readme(doc, res) {
  const s = res.settings, jn = (j) => `J${doc.joints.indexOf(j) + 1}`;
  const lines = [doc.meta.title || 'Mechanism', `Exported from ${APP.name} ${APP.version} for 3-D printing. All dimensions in millimetres.`, ''];
  lines.push('SETTINGS',
    `  Links ${s.width} mm wide and ${s.thickness} mm thick, as in the mass model (Forces).`,
    `  ${JOINT_TEXT[s.joint](s)}`,
    `  Base: ${s.base === 'stand' ? 'a plate that stands upright in the stand' : 'a plate that lies flat on the table'}.`, '');
  lines.push(...PRINT_TIPS);
  if (res.stacks.length) lines.push('  For the counterweights to balance the mechanism, print the links solid', '  (100 % infill): the masses are worked out for solid parts.');
  if (s.joint === 'pins') lines.push('  Pins.stl: the pins lie flat on a bar. Twist each one off its tab.');
  lines.push('');
  const links = res.parts.filter((p) => p.layer > 0).sort((a, b) => a.layer - b.layer);
  lines.push('ASSEMBLY',
    `  1. ${s.base === 'stand' ? 'Print the stand twice. Stand the base in their slots, one near each end, the side with the bosses to the front.' : 'Lay the base on the table, bosses up.'}`);
  let step = 2;
  if (res.stacks.length) lines.push(`  ${step++}. Bolt each counterweight to its link first (see COUNTERWEIGHTS below).`);
  const up = res.pins.find((p) => p.up);
  if (up) {
    const crank = res.parts.find((p) => p.link === doc.driver.link);
    lines.push(`  ${step++}. Push the pin for ${jn(up.joint)} up through ${crank ? crank.name : 'the crank'} from below, head underneath, before the crank goes on: the knob above will cover its top.`);
  }
  const how = { snap: (n) => `Press ${n > 1 ? 'each one' : 'it'} straight down over its pins until it clicks.`,
    pins: (n) => `Lay ${n > 1 ? 'them' : 'it'} on and push a pin of the right length (PINS below) down through each joint, head on top, until it clicks; where a pin already sticks up, press the link down onto it until it clicks.`,
    hole: () => 'Put the pins or rivets through the holes.' };
  for (const k of [...new Set(links.map((p) => p.layer))]) {
    const here = links.filter((p) => p.layer === k), names = here.map((p) => p.name).join(' and ');
    lines.push(`  ${step++}. Layer ${k}: ${names}. ${how[s.joint](here.length)}`);
  }
  if (doc.joints.some((j) => j.trace)) lines.push(`  ${step++}. To trace the path: tape paper to the base, put a pen refill (about 3 mm) in the hole at the traced point, and push it through until it just touches the paper.`);
  const knobText = res.plan.knob === 'pin' ? ' by the knob over the crank pin' : res.plan.knob === 'mid' ? ' by its knob' : '';
  lines.push(`  ${step}. Turn the crank${knobText} once by hand: everything should turn freely.`, '');
  if (s.joint !== 'hole') lines.push('  To take a joint apart, pull the parts firmly apart; the ridge lets go.', '');
  lines.push('LAYERS (from the base up)');
  for (const p of links) lines.push(`  ${p.name}: layer ${p.layer}${p.knob ? ' (with the knob)' : ''}`);
  lines.push('');
  if (res.pins.length) {
    lines.push('PINS (in Pins.stl from the end of the bar, shortest first)');
    res.pins.forEach((p, i) => lines.push(`  ${i + 1}. ${jn(p.joint)}: ${fmt(p.grip)} mm through${p.up ? ', put in from below' : ''}`));
    lines.push('');
  }
  if (res.stacks.length) {
    lines.push('COUNTERWEIGHTS (steel)');
    for (const c of res.stacks) {
      const b = c.stack.bolt;
      lines.push(`  ${c.name}: ${b.size} x ${c.stack.length} countersunk bolt (ISO 10642), ${c.stack.washers} large washer${c.stack.washers === 1 ? '' : 's'} (ISO 7093) and a nut,`,
        `    ${c.dir === 'up' ? 'head from below, washers and nut on top' : 'head from the top, washers and nut underneath'}, at ${fmt(c.radius)} mm from the pivot.`,
        `    Weigh the bolt, washers and nut together: ${fmt(c.grams)} g (add or leave out a washer to get close).`);
    }
    lines.push('  The printed arm and pad are counted: the stack makes up the rest.', '');
  }
  if (res.plan.baseClear > PRINT.baseClear) lines.push(`  The links stand ${fmt(res.plan.baseClear)} mm above the base, to make room for a counterweight underneath.`, '');
  if (res.plan.notes.length) { lines.push('NOTES'); for (const n of res.plan.notes) lines.push(`  ${n}`); lines.push(''); }
  lines.push('If a joint is too tight or too loose, print the fit test (Export > Fit test),',
    'pick the piece that clicks in and turns freely, and enter its clearance.');
  return lines.join('\r\n');
}

/** The zip for the mechanism: { name, bytes, summary } or { problems }. */
export function printZip(app, s = printSettings(app.doc)) {
  const res = printParts(app.doc, app.sim, s);
  if (res.problems) return res;
  const base = fileName(app.doc.meta.title);
  const files = res.parts.map((p) => ({ name: `${p.name}.stl`, data: p.mesh.stl(`${APP.name} ${p.name}`) }));
  files.push({ name: 'README.txt', data: readme(app.doc, res) });
  const n = res.parts.filter((p) => p.layer > 0).length;
  const extras = [res.pins.length ? `${res.pins.length} pins` : '', res.stacks.length ? `${res.stacks.length} counterweight${res.stacks.length === 1 ? '' : 's'}` : '', s.base === 'stand' ? 'the stand' : ''].filter(Boolean);
  const summary = `${n} link${n === 1 ? '' : 's'} in ${res.plan.top} layer${res.plan.top === 1 ? '' : 's'}, the base${extras.length ? `, ${extras.join(', ')}` : ''}`;
  return { name: `${base}-3d-print.zip`, bytes: makeZip(files), summary, notes: res.plan.notes };
}

/** The zip for the fit test. */
export function fitTestZip(app, s = printSettings(app.doc)) {
  const res = fitTestParts(app.doc, s);
  if (res.problems) return res;
  const files = res.parts.map((p) => ({ name: `${p.name}.stl`, data: p.mesh.stl(`${APP.name} ${p.name}`) }));
  const how = {
    snap: 'Press each piece onto a pin of Test_pins. Choose the loosest piece that still clicks in and holds,\r\nand turns freely without wobbling. Enter its clearance in Export > For 3-D printing.',
    pins: 'Lay each piece on the hole of Test_bar with the same number (from the end with the bar\'s first hole)\r\nand push a pin through from the top until it clicks. Choose the loosest pair that still holds and turns\r\nfreely without wobbling. Enter its clearance in Export > For 3-D printing.',
    hole: 'Push your pin, rivet or bolt through each piece. Choose the one that turns freely without\r\nwobbling, and enter its clearance in Export > For 3-D printing.',
  };
  const lines = ['Fit test', `Exported from ${APP.name} ${APP.version}. All dimensions in millimetres.`, '',
    `Four test pieces with ${s.pin} mm holes and clearances ${PRINT.fitTest.join(', ')} mm; the number of small holes`,
    'along a piece is its number (1 to 4).', how[s.joint], '', ...PRINT_TIPS];
  files.push({ name: 'README.txt', data: lines.join('\r\n') });
  return { name: `fit-test-${s.joint === 'hole' ? 'holes' : s.joint}-${s.pin}mm.zip`, bytes: makeZip(files) };
}
