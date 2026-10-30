// =============================================================================
// print3d.js — the mechanism as parts for a 3-D printer (STL)
// -----------------------------------------------------------------------------
// One STL per link and one for the base (the frame), ready for a slicer: each
// part lies flat as printed, needs no supports, and the parts fit together
// as drawn. The link outlines are the same as in the DXF export (cad.js):
// the convex hull of the joints, rounded by half the link width.
//
// Joints (settings.joint). The parts have holes only.
//   'bolt'  standard steel fasteners (the default): at every joint a
//           countersunk bolt (ISO 10642) goes up from underneath, its head
//           flush in a countersink in the lower part (or the base), so
//           nothing sticks out below; a washer (ISO 7089) and a nylon-insert
//           lock nut (ISO 10511) go on top. The holes are the bolt's size
//           (settings.bolt, from the drawing's pin diameter) plus the
//           clearance. The README lists the bolts, each joint's bolt length,
//           and the washers and nuts.
// Printed pins: printed apart, lying down on a break-off sheet (Pins.stl), so
// the layers run along the pin (a pin printed upright snaps between its
// layers). The sheet has a pin for every joint, shortest first, and spares of
// each length.
//   'clip'  a solid pin with a countersunk head and a groove near its tip. It
//           goes up through both parts from underneath, the head flush in a
//           countersink in the lower part; a flat clip (Clips.stl), laid in a
//           pocket in the top of the upper part, slides sideways into the
//           groove and sits flush. The clip bends in its own plane (along its
//           layers) as it clicks on.
//   'pins'  snap pins: a countersunk head at one end, two springy fingers with
//           a ridge at the other (one long slot with a round end, so the
//           fingers bend along the layers and do not crack at the slot's end).
//           The head sits in a countersink in the upper part, the ridge
//           clicks into a recess under the lower part.
//   Every hole is the pin (or bolt) diameter plus the clearance (on the diameter).
//   (Drawings saved with the old pins printed on the links, 'snap', get clips;
//   those saved with plain holes, 'hole', get bolts.)
//
// Base (settings.base):
//   'flat'  a frame joining the ground pivots that lies on the table; the
//           links swing over the table beside it. A pen in a traced point
//           draws on paper taped to the table.
//   'stand' a plate from the pivots down to a straight bottom edge below
//           everything that moves, and a stand with a slot that holds it upright.
// Every part is checked against the print bed (settings.bedX, bedY); the pin
// bar is cut into bars that fit it.
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
// in the way of links in the layers between; with bolts, no link above a joint
// may pass over its nut (if no stacking avoids it, the README says where); the
// pen must not hit the links below it, nor the knob (on the input crank, or on
// its crank pin) the links above it (the knob over the crank pin only with snap
// pins: a clip pin has its clip there); a counterweight stack stands above its link, or hangs below it
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
  joint: 'bolt',          // 'bolt' (standard bolts, washers, lock nuts) | 'clip' (printed pins held by a flat clip) | 'pins' (printed snap pins)
  bolt: null,             // 'M3' … 'M8'; null: the size nearest the drawing's pin diameter (not above it)
  base: 'flat',           // 'flat' | 'stand'
  clearance: 0.2,         // hole Ø − pin Ø (mm); 0.2 fits best on a typical FDM printer (tested); the fit test helps to choose it
  counterweights: false,  // print the counterweights from Balancing (arm + bolted steel stack)
  bedX: 256,              // the printer's bed (mm): every part is checked against it
  bedY: 256,
};

export const PRINT = {
  segments: 72,         // points round a full circle (a multiple of 4)
  layerGap: 0.3,        // gap between parts stacked on each other (mm)
  baseThickness: 3,     // the base plate
  baseClear: 2,         // lowest link above the plate (more when a counterweight hangs below)
  frame: {             // the base: a frame joining the ground pivots
    margin: 8,          // beyond a pivot's boss (so 2 x (link width / 2 + 7.5) wide)
    single: 30,         // radius of the base round a single ground pivot
    standWidth: 80,     // the stand's base is at least this wide at the bottom
  },
  bedEdge: 5,           // kept clear at the edge of the print bed
  margin: 1.0,          // kept between parts that pass each other in the cycle
  ringInset: 0.5,       // a joint's round features stay this far inside the link edge
  holeChamfer: 0.4,     // at the bottom of every hole (the first layer spreads)
  penHole: 3.3,         // a traced point: a hole for a pen refill
  penRadius: 2.5,       // room the pen needs as it passes over other links
  knob: { diameter: 7, height: 12, chamfer: 0.8, ring: 0.8 },
  pins: {               // separate pins (both kinds), printed lying down on a sheet
    head: 1.2,          // the countersunk head stands out this far (45°)
    headTop: 0.6,       // straight part of the head
    nubRoom: 0.4,       // the head sits this far below the surface (room for the break-off nub)
    arc: 10,            // points on each rounded side
    gate: { w: 1.0, h: 1.0, z: 0.3, length: 1.5 },   // the thin tab that holds a pin to the bar
    bar: { w: 3, h: 2, end: 2 },                      // the bar along the heads
    gap: 2.5,           // between pins on the sheet
    spares: 2,          // spare pins of each length
  },
  clip: {               // clip pins: a groove near the tip, a flat clip slid into it
    flat: 0.85,         // flat top and bottom at ± this share of the pin radius (the groove stays round)
    groove: 0.5,        // groove depth (at least; deeper on thick pins so it is round inside the flats)
    thickness: 1.2,     // the clip
    play: 0.15,         // the groove is this much wider than the clip
    below: 0.1,         // the groove starts this far below the pocket's floor
    tip: 0.8,           // the pin above the groove (it holds the clip)
    tipChamfer: 0.3,
    flushInset: 0.2,    // the tip this far below the top face
    fit: 0.05,          // clip's inner radius over the groove's
    ring: 1.6,          // clip's ring width
    grip: 0.4,          // the clip's mouth is this much narrower than the groove, each side (it clicks on)
    lead: 0.3,          // the mouth's funnel opens to the pin's radius plus this
    pocketGap: 0.3,     // round the clip in its pocket
    wall: 0.8,          // least material beside the pocket
    spares: 4,          // spare clips
    gap: 3,             // between clips on their plate
  },
  snapPin: {            // snap pins: one slot across the pin, upright as printed (the fingers bend in the bed's plane)
    flat: 0.75,         // flat top and bottom at ± this share of the pin radius
    slotWidth: 1.4,
    slotLength: 2.2,    // slot length, as a share of the link thickness (long fingers bend more gently)
    lip: 0.35,          // the ridge stands out this far from the pin
    catchHeight: 0.2,   // the ridge's catch face: about 30° from flat
    band: 0.4,          // straight part of the ridge
    topInset: 0.25,     // pin tip this much smaller than the pin (lead-in)
    axialPlay: 0.1,     // the ridge sits this far past the floor of the recess
    flushInset: 0.15,   // pin tip this far inside the outer face of the part
    recess: 0.4,        // the recess is this much wider than the ridge
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
  // joint hardware ('bolt'): countersunk bolt ISO 10642 (dk, k: head Ø and
  // height; the length includes the head), washer ISO 7089 (od, h), nylon-insert
  // lock nut ISO 10511 (s across flats, m height)
  fasteners: [
    { size: 'M3', d: 3, dk: 6.72, k: 1.86, washer: { od: 7, h: 0.5 }, nut: { s: 5.5, m: 4.0 } },
    { size: 'M4', d: 4, dk: 8.96, k: 2.48, washer: { od: 9, h: 0.8 }, nut: { s: 7, m: 5.0 } },
    { size: 'M5', d: 5, dk: 11.2, k: 3.1, washer: { od: 10, h: 1.0 }, nut: { s: 8, m: 5.0 } },
    { size: 'M6', d: 6, dk: 13.44, k: 3.72, washer: { od: 12, h: 1.6 }, nut: { s: 10, m: 6.0 } },
    { size: 'M8', d: 8, dk: 17.92, k: 4.96, washer: { od: 16, h: 1.6 }, nut: { s: 13, m: 8.0 } },
  ],
  boltLengths: [8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100],
  boltSink: 0.3,        // the head sits this far below the face (a countersink a little wider than the head)
  boltPast: 1.0,        // the bolt's end stands at least this far past its nut
  nutTrap: {            // at a ground pivot the nut sits in a hexagonal pocket under the base
    fit: 0.2,           // across the flats, over the nut's
    roof: 1.5,          // least base material above the pocket
    end: 0.5,           // the bolt's end stays at least this far inside the base's underside
  },
  steel: 7.85e-3,       // g/mm³
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
  // 'snap' (pins printed on the links) is gone: clip pins take its place; plain holes ('hole') are now bolt holes
  const joint = { snap: 'clip', hole: 'bolt' }[saved.joint] || (['bolt', 'clip', 'pins'].includes(saved.joint) ? saved.joint : PRINT_DEFAULTS.joint);
  const s = {
    ...PRINT_DEFAULTS, ...saved, joint,
    width: dyn.width || cad.linkWidth || 12,        // as the mass model (mass.js)
    thickness: dyn.thickness || 6,
    pinDrawn: cad.pinDiameter || 6,                 // the drawing's pin diameter
  };
  s.bolt = PRINT.fasteners.some((f) => f.size === saved.bolt) ? saved.bolt : defaultBolt(s);
  return withPin(s);
}

/**
 * The settings with `pin`, the diameter the holes are for: the bolt's with
 * bolts, the drawing's pin diameter with printed pins. (Settings changed after
 * printSettings, e.g. another joint, get it again here.)
 */
function withPin(s) {
  const pinDrawn = s.pinDrawn ?? s.pin ?? 6;
  return { ...s, pinDrawn, pin: s.joint === 'bolt' ? fastener(s.bolt).d : pinDrawn };
}

/** The fastener of a size ('M4'). */
export const fastener = (size) => PRINT.fasteners.find((f) => f.size === size) || PRINT.fasteners[1];

/**
 * The bolt to start with: the largest size not above the drawing's pin
 * diameter whose countersink fits the links (else the smallest).
 */
export function defaultBolt(s) {
  const fit = PRINT.fasteners.filter((f) => f.d <= s.pinDrawn + 1e-9 && !sizeProblems(withPin({ ...s, joint: 'bolt', bolt: f.size })).length);
  return (fit.length ? fit[fit.length - 1] : PRINT.fasteners[0]).size;
}

/** Does the drawing have counterweights (from Balancing) that can be printed? */
export function hasCounterweights(doc) {
  return counterweightsOn(doc) && doc.links.some((l) => counterweightsOf(doc, l).length);
}

/** Sizes that follow from the settings (mm). */
function sizes(s) {
  const N = PRINT.snapPin, Pn = PRINT.pins, C = PRINT.clip;
  const r = s.pin / 2;
  const Rf = s.width / 2 - PRINT.ringInset;                  // edge of a joint's round features
  const rh = (s.pin + s.clearance) / 2;                      // hole radius
  // snap pins: the recess the ridge clicks into
  const recessDepth = N.axialPlay + N.catchHeight + N.band + N.lip + N.topInset + N.flushInset;
  const recessR = r + N.lip + N.recess;
  // both kinds: head radius, countersink radius and depths (to its straight part, and to its cone's bottom)
  const Rh = r + Pn.head, Rc = Rh + s.clearance / 2 + 0.1;
  const cs2 = Pn.headTop + Pn.nubRoom, cs1 = cs2 + (Rc - rh);
  // clip pins: groove radius, the clip's inner and outer radius, the pocket
  const rg = r - Math.max(C.groove, (1 - C.flat) * r + 0.1);
  const Ri = rg + C.fit, Ro = Ri + C.ring;
  const pocketDepth = C.thickness + C.play + C.tip + C.flushInset;
  // bolts: the countersink under the lower part (a 90° cone from rk down to the hole), and what stands above the top part
  const F = fastener(s.bolt), rk = F.dk / 2 + PRINT.boltSink, sinkDepth = rk - rh;
  const nutR = Math.max(F.washer.od / 2, F.nut.s / Math.sqrt(3));     // the washer, or the nut's corners
  return { r, Rf, rh, recessDepth, recessR, Rh, Rc, cs1, cs2, flatSnap: N.flat * r, flatClip: C.flat * r,
    rg, Ri, Ro, pocketDepth, pocketR: Ro + C.pocketGap, rk, sinkDepth, nutR, nutH: F.washer.h + F.nut.m };
}

// =============================================================================
// 1. Checks: what this version can print
// =============================================================================

/** Problems that stop the export (plain-language messages); empty when it can go ahead. */
export function printProblems(doc, s = printSettings(doc)) {
  s = withPin(s);
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
  // (a bolt's countersink is a cone at the bottom face only: 0.8 mm of wall at its rim is enough)
  const widest = s.joint === 'clip' ? Math.max(z.Rc, z.rh + PRINT.holeChamfer) : s.joint === 'pins' ? Math.max(z.recessR, z.Rc) : z.rk;
  const wallNeed = s.joint === 'bolt' ? 0.8 - PRINT.ringInset : 0.8;
  if (z.Rf - widest < wallNeed) {
    out.push(s.joint === 'bolt'
      ? `The links are too narrow for ${s.bolt} countersunk bolts: make the link width at least ${fmt(2 * (widest + 0.8))} mm, or choose a smaller bolt.`
      : `The links are too narrow for ${s.pin} mm pins: make the link width at least ${fmt(2 * (widest + 0.8 + PRINT.ringInset))} mm, or the pins thinner.`);
  } else if (s.joint === 'clip' && s.width / 2 - z.pocketR < PRINT.clip.wall) {
    out.push(`The links are too narrow for the clips of ${s.pin} mm pins: make the link width at least ${fmt(2 * (z.pocketR + PRINT.clip.wall))} mm, use snap pins, or make the pins thinner.`);
  }
  if (s.joint === 'clip' && s.thickness - Math.max(z.cs1, z.pocketDepth) < 2.5) {
    out.push(`Clip pins need links at least ${fmt(Math.max(z.cs1, z.pocketDepth) + 2.5)} mm thick (the thickness is set in Forces).`);
  }
  if (s.joint === 'pins' && s.thickness - Math.max(z.cs1, z.recessDepth) < 2.5) {
    out.push(`Snap pins need links at least ${fmt(Math.max(z.cs1, z.recessDepth) + 2.5)} mm thick (the thickness is set in Forces).`);
  }
  if (s.joint === 'bolt' && s.thickness - z.sinkDepth < 2.5) {
    out.push(`${s.bolt} countersunk bolts need links at least ${fmt(z.sinkDepth + 2.5)} mm thick (the thickness is set in Forces), or choose a smaller bolt.`);
  }
  if (s.joint !== 'bolt' && s.pin < 3) out.push('Clip and snap pins need a pin diameter of at least 3 mm.');
  if (!(s.clearance >= 0) || s.clearance > s.pin / 2) out.push('The clearance must be between 0 and half the pin diameter.');
  return out;
}

const fmt = (v) => String(Math.round(v * 10) / 10);
const fmt3 = (v) => String(Math.round(v * 100) / 100);

/**
 * Radius of a knob on top of a joint (it covers a snap pin's recess); 0 when
 * it does not fit. With clip pins the crank pin itself is longer and its top
 * is the handle: the pin's radius.
 */
function pinKnobRadius(s) {
  const z = sizes(s);
  if (s.joint === 'clip') return z.r;
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
      // (with clip pins the crank's pocket at its pivot reaches along the crank)
      const reach = s.joint === 'clip' ? Math.max(z.Rf, clipTravel(s) + z.pocketR) : z.Rf;
      const midFits = !weights.has(crank.id) && Math.hypot(Q.x - P.x, Q.y - P.y) / 2 >= reach + K.diameter / 2 + K.ring + 0.4;
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
export function planLayers(doc, sim, s = printSettings(doc), M = model(doc, sim, withPin(s))) {
  s = withPin(s);
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
  // (head: the room a nut and washer, or a pin's head, needs above or below the joint)
  const headR = s.joint === 'bolt' ? z.nutR + m : 0.9 * s.pin + m;
  const pins = M.pinJoints.map((p) => ({ ...p, hit: hits(onLink(p.a, M.pos(p.joint.id)), bossR, [p.a.id, p.b.id]),
    head: hits(onLink(p.a, M.pos(p.joint.id)), headR, [p.a.id, p.b.id]) }));
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
  // strictNuts: with bolts, no link may pass over a nut and the bolt's end above it (else only
  // counted, as few as possible). A link that skips layers can pass over it: the bosses
  // under it lift it clear.
  const nutClear = (lo, hi, above) => (above - hi - 1) * (t + gap) + gap >= boltSet(s, (hi - lo) * (t + gap) + t).above + m;
  const score = (L, needKnob, strictNuts = false) => {
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
        // a bolt's head is flush underneath: only the nut on top stands out
        if (s.joint === 'bolt' && p.head[i] && L[i] > hi && !nutClear(lo, hi, L[i])) { if (strictNuts) return null; heads++; }
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
  const search = (needKnob, strictNuts) => {
    let best = null, bestL = null;
    const L = new Array(n).fill(1);
    const walk = (i) => {
      if (i === n) { const sc = score(L, needKnob, strictNuts); if (sc && better(sc, best)) { best = sc; bestL = L.slice(); } return; }
      for (let k = 1; k <= n; k++) { L[i] = k; walk(i + 1); }
    };
    walk(0);
    return bestL && { L: bestL, ...best };
  };
  let found = null, knobAt = null;
  // with bolts: first keep every link clear of the nuts, with a knob if there is room
  for (const strict of s.joint === 'bolt' ? [true, false] : [false]) {
    if (knobMid) { found = search('mid', strict); if (found) knobAt = 'mid'; }
    // (with clip pins the crank pin's top is the handle; with bolts the nut at
    // the crank pin is the handle instead)
    if (!found && knobPin && s.joint !== 'bolt' && pinKnobRadius(s)) { found = search('pin', strict); if (found) knobAt = 'pin'; }
    if (!found) found = search(null, strict);
    if (found) break;
  }
  if (!found) {
    return { layer: null, knob: null, problems: [stacks.length
      ? 'No stacking of the links keeps them and the counterweights clear of each other over the cycle: try a smaller counterweight radius in Balancing.'
      : 'No stacking of the links keeps them clear of each other over the cycle (check that the links do not cross through a pen or a ground pivot).'] };
  }
  const layer = new Map(moving.map((l, i) => [l.id, found.L[i]]));
  const stackDir = new Map(stacks.map((st, i) => [st.w.link.id, found.dirs[i]]));
  const notes = [];
  if (M.knob && !knobAt) notes.push(s.joint === 'bolt'
    ? 'There is no room for a knob on the input crank (a link or counterweight passes over it); turn the crank by pushing its crank pin round by the nut.'
    : 'There is no room for a knob on the input crank (a link or counterweight passes over it); turn the crank by hand.');
  if (found.heads) notes.push('A link passes over a nut and washer, and no stacking of the links avoids it: use a thin nut there (ISO 4035), or check the turn before tightening.');
  if (!M.cycle) notes.push('The mechanism cannot be driven through a cycle, so the parts were checked at the drawn position only.');
  // standing up, the pen draws on paper on the plate: it must not run over a boss there
  for (const p of s.base === 'stand' ? M.pens : []) {
    const P = (k) => transforms[k].get(p.link.id)(M.pos(p.joint.id));
    for (const g of M.groundJoints) {
      const G = M.pos(g.joint.id);
      if (transforms.some((_, k) => Math.hypot(P(k).x - G.x, P(k).y - G.y) < z.Rf + PRINT.penRadius)) {
        notes.push(`The pen at J${doc.joints.indexOf(p.joint) + 1} passes over the pivot at J${doc.joints.indexOf(g.joint) + 1}: keep it short of the base there.`);
      }
    }
  }
  let baseClear = Math.max(PRINT.baseClear, Math.ceil(found.raise * 10) / 10);
  // with bolts, the base under each ground pivot must be deep enough for the nut's pocket
  // (the bolt's end stays inside the base): lift the links until it is
  if (s.joint === 'bolt') {
    const deepEnough = (bc) => M.groundJoints.every((g) => {
      const k = found.L[idx.get(g.link.id)], zLink = PRINT.baseThickness + bc + (k - 1) * (t + gap);
      const gb = groundBolt(s, zLink + t);
      return gb && zLink - gap - gb.ceiling >= PRINT.nutTrap.roof;
    });
    while (!deepEnough(baseClear) && baseClear < 40) baseClear = Math.round((baseClear + 0.1) * 10) / 10;
  }
  return { layer, knob: knobAt, stacks: stackDir, baseClear, notes, problems: [], top: found.top };
}

// =============================================================================
// 5. Round features of the flat parts
// =============================================================================

/**
 * A surface of revolution at centre c: profile = points { r, z } (r = 0 on the
 * axis; null marks a jump along the axis), walked with the material on its
 * right, from the part's bottom face to its top face.
 */
function revolve(mesh, c, profile, N) {
  // i is taken round the circle (i = N is point 0), so shared points match exactly
  const pt = (p, i) => { i %= N; return p.r === 0 ? [c.x, c.y, p.z] : [c.x + p.r * Math.cos((TAU * i) / N), c.y + p.r * Math.sin((TAU * i) / N), p.z]; };
  for (let s = 0; s + 1 < profile.length; s++) {
    const p = profile[s], q = profile[s + 1];
    if (!p || !q) continue;
    const nr = -(q.z - p.z), nz = q.r - p.r;   // outward (left of the walk)
    for (let i = 0; i < N; i++) {
      const fm = (TAU * (i + 0.5)) / N, hint = [nr * Math.cos(fm), nr * Math.sin(fm), nz];
      const A = pt(p, i), B = pt(p, i + 1), C = pt(q, i + 1), D = pt(q, i);
      if (p.r === 0) mesh.tri(A, C, D, hint);
      else if (q.r === 0) mesh.tri(A, B, C, hint);
      else mesh.quad(A, B, C, D, hint);
    }
  }
}

/**
 * Round features at a joint (profiles from z = 0 to the part's thickness t,
 * with the ring at radius Rf where they meet the flat faces).
 *   kind 'upper'      the hole of the part on top: with the countersink for a
 *                     snap pin's head, else plain
 *        'upperClip'  the hole of the part on top for a clip pin, ending in
 *                     the floor of the clip's pocket (opt.dir: the pocket's
 *                     direction, radians); adds `pocket` and `zones`
 *        'upperKnob'  the hole and recess of the part on top, closed by a knob
 *                     (a snap pin put in from below)
 *        'lower'      the part below: a hole with the recess for a snap pin's
 *                     ridge underneath, else a plain hole; on a boss of height
 *                     H when it skips layers
 *        'lowerHead'  the part below, with the countersink underneath (a clip
 *                     pin, or a snap pin put in from below, under a knob)
 *        'lowerBolt'  the part below, with the countersink underneath for a
 *                     countersunk bolt; on a boss of height H
 *        'upperBolt'  a link at a ground pivot: the countersink on top
 *        'baseNut'    the base at a ground pivot: a hexagonal pocket for the
 *                     nut underneath, opt.depth deep; on a boss of height H
 *        'hole'       a plain hole of radius rh
 *        'knob'       a round knob to turn the crank by
 *        'boltTop' / 'boltBottom'  a hole for a countersunk bolt (opt.bolt),
 *                     the countersink on the top or the bottom face
 */
function feature(kind, s, t, opt = {}) {
  const z = sizes(s), ch = PRINT.holeChamfer, Rf = opt.Rf || z.Rf;
  const P = (r, zz) => ({ r, z: zz });
  const H = opt.H || 0, zb = t + H;                 // top of the part (or of its boss) at the joint
  const boss = H > 0 ? [P(Rf, t)] : [];
  if (kind === 'hole' || (kind === 'upper' && s.joint !== 'pins')) {
    const rh = opt.rh || z.rh;
    return { Rf, profile: [P(Rf, 0), P(rh + ch, 0), P(rh, ch), P(rh, t), P(Rf, t)] };
  }
  if (kind === 'boltTop' || kind === 'boltBottom') {
    const rb = opt.bolt.d / 2 + 0.2, rk = opt.bolt.dk / 2 + 0.2, kd = rk - rb;
    return kind === 'boltTop'
      ? { Rf, profile: [P(Rf, 0), P(rb + ch, 0), P(rb, ch), P(rb, t - kd), P(rk, t), P(Rf, t)] }
      : { Rf, profile: [P(Rf, 0), P(rk, 0), P(rb, kd), P(rb, t), P(Rf, t)] };
  }
  if (kind === 'upper') {
    return { Rf, profile: [P(Rf, 0), P(z.rh + ch, 0), P(z.rh, ch), P(z.rh, t - z.cs1), P(z.Rc, t - z.cs2), P(z.Rc, t), P(Rf, t)] };
  }
  if (kind === 'upperClip') {
    const zf = t - z.pocketDepth, d = clipTravel(s), a = opt.dir || 0;
    const far = { x: d * Math.cos(a), y: d * Math.sin(a) };
    return { Rf, profile: [P(Rf, 0), P(z.rh + ch, 0), P(z.rh, ch), P(z.rh, zf)],
      pocket: { loop: circlesHull([{ c: { x: 0, y: 0 }, r: z.pocketR }, { c: far, r: z.pocketR }], 48), z: zf, r: z.rh },
      zones: [{ c: { x: 0, y: 0 }, r: z.pocketR }, { c: far, r: z.pocketR }] };
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
  if (kind === 'lowerBolt') {
    return { Rf, profile: [P(Rf, 0), P(z.rk, 0), P(z.rh, z.sinkDepth), P(z.rh, zb), P(Rf, zb), ...boss] };
  }
  if (kind === 'upperBolt') {
    return { Rf, profile: [P(Rf, 0), P(z.rh + ch, 0), P(z.rh, ch), P(z.rh, t - z.sinkDepth), P(z.rk, t), P(Rf, t)] };
  }
  if (kind === 'baseNut') {
    // a hexagon (counter-clockwise), a little larger than the nut, turned by opt.turn (radians):
    // the pockets of one base are turned differently, so no two of their edges lie in line
    // (the underside's triangles would otherwise meet edge to edge wrongly)
    const F = fastener(s.bolt), rc = (F.nut.s + PRINT.nutTrap.fit) / Math.sqrt(3), a0 = opt.turn || 0;
    const hex = Array.from({ length: 6 }, (_, i) => ({ x: rc * Math.cos(a0 + (i * Math.PI) / 3), y: rc * Math.sin(a0 + (i * Math.PI) / 3) }));
    return { Rf, profile: [P(z.rh, opt.depth), P(z.rh, zb), P(Rf, zb), ...boss], trap: { loop: hex, h: opt.depth, r: z.rh },
      zones: [{ c: { x: 0, y: 0 }, r: rc }] };
  }
  // 'lower'
  if (s.joint === 'pins') {
    const rd = z.recessDepth;
    return { Rf, profile: [P(Rf, 0), P(z.recessR, 0), P(z.recessR, rd), P(z.rh, rd), P(z.rh, zb), P(Rf, zb), ...boss] };
  }
  return { Rf, profile: [P(Rf, 0), P(z.rh + ch, 0), P(z.rh, ch), P(z.rh, zb), P(Rf, zb), ...boss] };
}

/**
 * A flat part of thickness t with outline `outline` (counter-clockwise, part
 * coordinates) and round features [{ c, f }] (f from feature()). A feature
 * with a pocket (a clip pin's) has the pocket in the top face instead of its
 * ring: the pocket's walls and floor, and the hole through the floor.
 */
function buildPart(outline, t, features) {
  const N = PRINT.segments, mesh = new Mesh();
  const at = (c, loop) => loop.map((p) => ({ x: c.x + p.x, y: c.y + p.y }));
  const below = features.map(({ c, f }) => (f.trap ? at(c, f.trap.loop) : circle(c, f.Rf, N)));
  const above = features.map(({ c, f }) => (f.pocket ? at(c, f.pocket.loop) : circle(c, f.Rf, N)));
  const loop = signedArea(outline) > 0 ? outline : outline.slice().reverse();
  mesh.face(loop, below, 0, false);
  mesh.face(loop, above, t, true);
  mesh.wall(loop, 0, t, true);
  for (const { c, f } of features) {
    revolve(mesh, c, f.profile, N);
    if (f.pocket) {
      const pl = at(c, f.pocket.loop);
      mesh.face(pl, [circle(c, f.pocket.r, N)], f.pocket.z, true);
      mesh.wall(pl, f.pocket.z, t, false);
    }
    if (f.trap) {                                   // the nut's pocket: its sides, and its roof round the hole
      const tl = at(c, f.trap.loop);
      mesh.wall(tl, 0, f.trap.h, false);
      mesh.face(tl, [circle(c, f.trap.r, N)], f.trap.h, false);
    }
  }
  return mesh;
}

/** Check that the round features (and clip pockets) of a part do not run into each other. */
function spacingProblem(features, name) {
  const circles = ({ c, f }) => [{ c, r: f.Rf }, ...(f.zones || []).map((zn) => ({ c: { x: c.x + zn.c.x, y: c.y + zn.c.y }, r: zn.r }))];
  for (let i = 0; i < features.length; i++) for (let j = i + 1; j < features.length; j++) {
    for (const a of circles(features[i])) for (const b of circles(features[j])) {
      if (Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) < a.r + b.r + 0.4) return `${name}: two joints (or a joint and its counterweight or clip pocket) are too close together for this link width and pin size.`;
    }
  }
  return null;
}

/**
 * A clip pin's joint on a part: the 'upperClip' feature at c with its pocket
 * pointing into the part. It tries the direction `toward` first, then others
 * either side of it, and takes the first whose pocket stays inside the outline
 * (convex, counter-clockwise) and clear of the features already there; null
 * when none does.
 */
function placeClip(s, t, c, toward, outline, feats) {
  const wall = PRINT.clip.wall;
  for (let k = 0; k <= 18; k++) {
    for (const sgn of k ? [1, -1] : [1]) {
      const f = feature('upperClip', s, t, { dir: toward + (sgn * k * Math.PI) / 18 });
      const inside = f.pocket.loop.every((p) => distToConvex({ x: c.x + p.x, y: c.y + p.y }, outline) <= -wall);
      if (inside && !spacingProblem([...feats, { c, f }], '')) return f;
    }
  }
  return null;
}

// =============================================================================
// 6. Separate pins (clip pins and snap pins), printed lying down, and clips
// =============================================================================

/**
 * The cross-section of a pin of radius R, flat top and bottom at ±f, with a
 * slot of width sw upright through it (in the pin's own y, z): the whole
 * section, and the two fingers either side of the slot (all counter-clockwise).
 * Where there is no slot (dent > 0), the points where a slot would start
 * sit a hair inside the flats, so no three points of an end face are in line
 * (its triangles would otherwise have no area).
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
 * Lofts between sections of a pin along x (stations { u, R }) and the flat
 * caps across it. A step at one u (a groove's shoulder) is a flat ring.
 */
function pinBuilder(mesh) {
  const P3 = (u, p) => [u, p.y, p.z];
  const loft = (A, B, a, b) => {
    const step = Math.abs(b.u - a.u) < 1e-12;
    const dRdu = step ? 0 : (b.R - a.R) / (b.u - a.u);
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      const dy = A[j].y - A[i].y, dz = A[j].z - A[i].z, L = Math.hypot(dy, dz) || 1;
      const ny = dz / L, nz = -dy / L;                         // outward, for a counter-clockwise section
      const my = (A[i].y + A[j].y) / 2, mz = (A[i].z + A[j].z) / 2, mr = Math.hypot(my, mz) || 1;
      const hint = step ? [Math.sign(a.R - b.R), 0, 0] : [-dRdu * ((ny * my + nz * mz) / mr), ny, nz];
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
  return { loft, cap };
}

/** The opening a gate [y0, y1, z0, z1] leaves in a pin's head, as a section hole. */
const gateHole = (g) => [{ y: g[0], z: g[2] }, { y: g[1], z: g[2] }, { y: g[1], z: g[3] }, { y: g[0], z: g[3] }];

/**
 * A snap pin along x (x = distance from the underside of the head towards the
 * tip), centred on y = z = 0. uc: where the ridge starts (its catch face);
 * us: where the slot starts. The slot's end is round (in the bed's plane), so
 * the fingers bend without a sharp corner at their root. Returns { mesh,
 * x0 (the head's end) }. gate: a rectangle [y0, y1, z0, z1] left open in the
 * head's end, for the tab.
 */
export function pinMesh(s, uc, us, gate = null) {
  const Pn = PRINT.pins, N = PRINT.snapPin, z = sizes(s);
  const r = z.r, f = z.flatSnap, h = N.slotWidth / 2, na = Pn.arc;
  us = Math.max(0.5, Math.min(us, uc - h - 0.5));
  const st = [{ u: -(Pn.head + Pn.headTop), R: z.Rh, w: h }, { u: -Pn.head, R: z.Rh, w: h }, { u: 0, R: r, w: h }];   // head: straight, then 45° to the pin
  const iS = st.length;                                        // the station where the slot starts
  for (const deg of [20, 45, 70, 90]) {                        // the slot's round end, to its full width
    const a = (deg * Math.PI) / 180;
    st.push({ u: us + h * (1 - Math.cos(a)), R: r, w: h * Math.sin(a) });
  }
  st.push({ u: uc, R: r, w: h }, { u: uc + N.catchHeight, R: r + N.lip, w: h }, { u: uc + N.catchHeight + N.band, R: r + N.lip, w: h },
    { u: uc + N.catchHeight + N.band + N.lip + N.topInset, R: r - N.topInset, w: h });   // the ridge and the tip
  const mesh = new Mesh(), { loft, cap } = pinBuilder(mesh);
  const sec = st.map((q, i) => pinSection(q.R, f, 2 * q.w, na, i < iS ? 0.01 : 0));
  for (let i = 0; i < iS; i++) loft(sec[i].full, sec[i + 1].full, st[i], st[i + 1]);
  for (let i = iS; i + 1 < st.length; i++) {
    loft(sec[i].right, sec[i + 1].right, st[i], st[i + 1]);
    loft(sec[i].left, sec[i + 1].left, st[i], st[i + 1]);
  }
  cap(sec[0].full, st[0].u, -1, gate ? [gateHole(gate)] : []);
  const w0 = st[iS].w;
  cap([{ y: w0, z: f }, { y: -w0, z: f }, { y: -w0, z: -f }, { y: w0, z: -f }], st[iS].u, 1);      // the slot's floor
  const last = sec[sec.length - 1], uEnd = st[st.length - 1].u;
  cap(last.right, uEnd, 1);
  cap(last.left, uEnd, 1);
  return { mesh, x0: st[0].u, length: uEnd - st[0].u };
}

/**
 * A clip pin along x, as pinMesh: the countersunk head, the groove from ug0
 * to ug1, the tip to uEnd (fit from clipFit). Solid. The groove is round
 * (inside the flats), so the clip grips it all round.
 */
export function clipPinMesh(s, fit, gate = null) {
  const Pn = PRINT.pins, C = PRINT.clip, z = sizes(s);
  const r = z.r, f = z.flatClip, w = 0.3, na = Pn.arc;
  // (fit.chamfer: the tip's chamfer, larger on a handle)
  const st = [
    { u: -(Pn.head + Pn.headTop), R: z.Rh }, { u: -Pn.head, R: z.Rh }, { u: 0, R: r },
    { u: fit.ug0, R: r }, { u: fit.ug0, R: z.rg }, { u: fit.ug1, R: z.rg }, { u: fit.ug1, R: r },
    { u: fit.uEnd - (fit.chamfer ?? C.tipChamfer), R: r }, { u: fit.uEnd, R: r - (fit.chamfer ?? C.tipChamfer) },
  ];
  // a section with flats has the points of pinSection; a smaller one is round, its points at the same angles
  const ref = pinSection(r, f, 2 * w, na, 0.01).full;
  const sec = st.map((q) => (q.R > Math.hypot(w, f) + 0.01 ? pinSection(q.R, f, 2 * w, na, 0.01).full
    : ref.map((p) => { const k = q.R / Math.hypot(p.y, p.z); return { y: p.y * k, z: Math.max(-f, Math.min(f, p.z * k)) }; })));
  const mesh = new Mesh(), { loft, cap } = pinBuilder(mesh);
  for (let i = 0; i + 1 < st.length; i++) loft(sec[i], sec[i + 1], st[i], st[i + 1]);
  cap(sec[0], st[0].u, -1, gate ? [gateHole(gate)] : []);
  cap(sec[sec.length - 1], st[st.length - 1].u, 1);
  return { mesh, x0: st[0].u, length: fit.uEnd - st[0].u };
}

/**
 * The pins on a sheet: side by side along y, each held by a thin tab at the
 * end of its head to a bar. pins: [{ uc, us }] (snap) or [{ ug0, ug1, uEnd }]
 * (clip). Lying on the bed (z = 0).
 */
function pinSheet(s, pins, kind) {
  const Pn = PRINT.pins, G = Pn.gate, B = Pn.bar, z = sizes(s), f = kind === 'clip' ? z.flatClip : z.flatSnap;
  const make = (p, gate) => (kind === 'clip' ? clipPinMesh(s, p, gate) : pinMesh(s, p.uc, p.us, gate));
  const pitch = 2 * z.Rh + Pn.gap;
  const gz0 = -f + G.z, gz1 = gz0 + G.h;
  const sheet = new Mesh();
  let x0 = 0;
  pins.forEach((p, i) => {
    const y = i * pitch;
    const pm = make(p, [-G.w / 2, G.w / 2, gz0, gz1]);
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
 * Where the ridge and the slot start on a snap pin through a stack from Zb
 * (the outer face of the part the ridge clicks into) to Zt (the outer face of
 * the part with the countersink), heights measured along the pin.
 */
export function pinFit(s, grip) {
  const z = sizes(s), N = PRINT.snapPin;
  const u0 = grip - z.cs1 - s.clearance / 2;                  // the head's cone meets the countersink's
  const uc = u0 - (z.recessDepth - N.axialPlay);
  const us = Math.max(0.8, uc - N.slotLength * s.thickness);
  return { uc, us };
}

/**
 * Where the groove is on a clip pin through a stack of height grip, from the
 * face with the countersink (underneath) to the top face of the part with the
 * clip's pocket: the groove from ug0 to ug1, the tip ends at uEnd, just below
 * the top face.
 */
export function clipFit(s, grip, handle = false) {
  const z = sizes(s), C = PRINT.clip, K = PRINT.knob;
  const u0 = z.cs1 + s.clearance / 2;                         // from the face with the countersink to the pin's u = 0
  const floor = grip - z.pocketDepth - u0;                    // the pocket's floor
  const ug1 = floor + C.thickness + C.play;
  // the crank pin under the knob goes on up: its top is the handle
  return handle ? { ug0: floor - C.below, ug1, uEnd: grip - u0 + K.height, chamfer: K.chamfer }
    : { ug0: floor - C.below, ug1, uEnd: ug1 + C.tip, chamfer: C.tipChamfer };
}

/**
 * The clip's outline (counter-clockwise), centred on the pin, its open end
 * (the mouth) towards −x: a ring from Ri to Ro, the mouth narrower than the
 * groove by `grip` each side, and a funnel that leads the pin in.
 */
export function clipOutline(s, n = 48) {
  const z = sizes(s), C = PRINT.clip;
  const wm = z.rg - C.grip, wl = Math.min(z.r + C.lead, z.Ro - 0.5);
  const aO = Math.PI - Math.asin(wl / z.Ro), aI = Math.PI - Math.asin(wm / z.Ri);   // the outer corners, the throat
  const arc = (R, a0, a1) => {
    const k = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (TAU / n)));
    return Array.from({ length: k + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / k; return { x: R * Math.cos(a), y: R * Math.sin(a) }; });
  };
  return [...arc(z.Ro, -aO, aO), ...arc(z.Ri, aI, -aI)];   // round the outside, in along the funnel, round the inside
}

const segDist = (p, a, b) => {
  const ex = b.x - a.x, ey = b.y - a.y, L2 = ex * ex + ey * ey || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / L2));
  return Math.hypot(p.x - a.x - t * ex, p.y - a.y - t * ey);
};

/**
 * How far from the pin the clip must be laid in its pocket to clear the pin's
 * tip (mouth towards the pin), before it is pushed on: the pocket's length
 * beyond the pin.
 */
export function clipTravel(s) {
  const z = sizes(s), poly = clipOutline(s, 96), rho = z.r + 0.1;
  const clear = (d) => poly.every((a, i) => segDist({ x: -d, y: 0 }, a, poly[(i + 1) % poly.length]) >= rho);
  let d = z.Ro + rho + 0.5;
  while (d > 0.05 && clear(d - 0.05)) d -= 0.05;
  return d + 0.2;
}

/** One clip lying on the bed, centred on (cx, cy). */
function clipInto(mesh, s, cx = 0, cy = 0) {
  const tc = PRINT.clip.thickness;
  const loop = clipOutline(s).map((p) => ({ x: cx + p.x, y: cy + p.y }));
  mesh.face(loop, [], 0, false);
  mesh.face(loop, [], tc, true);
  mesh.wall(loop, 0, tc, true);
  return mesh;
}

/** One clip (for its mass). */
export const clipMesh = (s) => clipInto(new Mesh(), s);

/** n clips in rows on one plate (each a separate piece). */
function clipSheet(s, n) {
  const z = sizes(s), pitch = 2 * z.Ro + PRINT.clip.gap, cols = Math.min(n, 5), mesh = new Mesh();
  for (let i = 0; i < n; i++) clipInto(mesh, s, z.Ro + (i % cols) * pitch, z.Ro + Math.floor(i / cols) * pitch);
  return mesh;
}

/**
 * The pins on as many bars as it takes for each bar to fit the print bed, the
 * bars side by side: { mesh, bars }.
 */
function pinSheets(s, pins, kind) {
  const Pn = PRINT.pins, z = sizes(s), pitch = 2 * z.Rh + Pn.gap;
  const room = Math.max(s.bedX, s.bedY) - 2 * PRINT.bedEdge - 2 * (z.Rh + Pn.bar.end);
  const per = Math.max(1, Math.floor(room / pitch) + 1);
  const mesh = new Mesh();
  let x = 0, bars = 0;
  for (let i = 0; i < pins.length; i += per, bars++) {
    const sheet = pinSheet(s, pins.slice(i, i + per), kind), b = sheet.bounds();
    mesh.add(sheet.translate(x - b.min[0], 0, 0));
    x += b.max[0] - b.min[0] + 2 * Pn.gap;
  }
  return { mesh, bars };
}

/**
 * Does a part fit the print bed (less PRINT.bedEdge round it), turned any way
 * on it? { fits, long, short }: the part's own size (its smallest enclosing
 * rectangle), in mm.
 */
export function bedFit(mesh, s) {
  const hull = convexHull(mesh.tris.flatMap((t) => t.v.map((v) => ({ x: v[0], y: v[1] }))));
  const bx = s.bedX - 2 * PRINT.bedEdge, by = s.bedY - 2 * PRINT.bedEdge;
  let fits = false, size = null;
  for (let deg = 0; deg < 180; deg += 0.5) {
    const c = Math.cos((deg * Math.PI) / 180), sn = Math.sin((deg * Math.PI) / 180);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of hull) { const u = c * p.x + sn * p.y, v = -sn * p.x + c * p.y; x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
    const w = x1 - x0, h = y1 - y0;
    if ((w <= bx && h <= by) || (w <= by && h <= bx)) fits = true;
    if (!size || w * h < size.long * size.short) size = { long: Math.max(w, h), short: Math.min(w, h) };
  }
  return { fits, ...size };
}

/** The pins for the sheet: each joint's pin, shortest first, with spares after each length. */
function withSpares(pins) {
  const out = [];
  pins.forEach((p, i) => {
    out.push(p);
    const next = pins[i + 1];
    if (!next || Math.abs(next.grip - p.grip) > 0.01 || !!next.handle !== !!p.handle) for (let k = 0; k < PRINT.pins.spares; k++) out.push({ ...p, joint: null, spare: true, up: false });
  });
  return out;
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
  s = withPin(s);
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
  // the joint under the knob: a snap pin put in from below (under the knob), or a clip pin whose top is the handle
  const flipped = (pj) => plan.knob === 'pin' && M.knob.pin === pj;

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
    const feats = [], clips = [];
    const name = `${link.disc ? 'Wheel' : 'Link'}${nums.get(link.id)}`;
    let knobHere = false;
    for (const pj of M.pinJoints) {
      if (pj.a !== link && pj.b !== link) continue;
      const other = pj.a === link ? pj.b : pj.a;
      const at = T(M.pos(pj.joint.id));
      const lower = L(link) < L(other), H = lower ? (L(other) - L(link) - 1) * (t + gap) : 0;
      const lowerKind = s.joint === 'bolt' ? 'lowerBolt' : s.joint === 'clip' || flipped(pj) ? 'lowerHead' : 'lower';
      if (lower) feats.push({ c: at, f: feature(lowerKind, s, t, { H }) });
      else if (s.joint === 'clip') clips.push({ c: at, joint: pj.joint });
      else feats.push({ c: at, f: feature(flipped(pj) ? 'upperKnob' : 'upper', s, t) });
      if (flipped(pj) && !lower && s.joint === 'pins') knobHere = true;
    }
    for (const g of M.groundJoints) {
      if (g.link !== link) continue;
      if (s.joint === 'clip') clips.push({ c: T(M.pos(g.joint.id)), joint: g.joint });
      else feats.push({ c: T(M.pos(g.joint.id)), f: feature(s.joint === 'bolt' ? 'upperBolt' : 'upper', s, t) });
    }
    for (const p of M.pens) if (p.link === link) feats.push({ c: T(M.pos(p.joint.id)), f: feature('hole', s, t, { rh: PRINT.penHole / 2, Rf: PRINT.penHole / 2 + PRINT.holeChamfer + 1.2 }) });
    if (w) feats.push({ c: T(w.pad.c), f: feature(plan.stacks.get(link.id) === 'up' ? 'boltBottom' : 'boltTop', s, t, { bolt: w.stack.bolt, Rf: w.stack.bolt.dk / 2 + 1.0 }) });
    // clip pockets: towards the middle of the link (the other joints), else turned to fit
    for (const k of clips) {
      const rest = P.map(T).filter((q) => Math.hypot(q.x - k.c.x, q.y - k.c.y) > 1e-6);
      const mid = rest.length ? { x: rest.reduce((a, q) => a + q.x, 0) / rest.length, y: rest.reduce((a, q) => a + q.y, 0) / rest.length } : { x: k.c.x + 1, y: k.c.y };
      const f = placeClip(s, t, k.c, Math.atan2(mid.y - k.c.y, mid.x - k.c.x), outline, feats);
      if (!f) return { error: `${name}: there is no room for the clip's pocket at J${doc.joints.indexOf(k.joint) + 1} (it reaches about ${fmt(clipTravel(s) + sizes(s).pocketR)} mm along the link from the joint). Use snap pins, or make the link longer.` };
      feats.push({ c: k.c, f });
    }
    if (plan.knob === 'mid' && M.knob.link === link) {
      const kf = { c: T(M.knob.mid), f: feature('knob', s, t) };
      if (!spacingProblem([...feats, kf], 'knob')) { feats.push(kf); knobHere = true; } else plan.notes.push('The input crank is too short for a knob between its joints; turn the crank by hand.');
    }
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
    // separate pins (and clips), or the bolts, washers and nuts, at the moving joints ride along:
    // count them with the coupler (as masses at its joints)
    const movingPins = M.pinJoints.map((pj) => {
      const lo = L(pj.a) < L(pj.b) ? pj.a : pj.b, hi = lo === pj.a ? pj.b : pj.a;
      const grip = layerZ(s, plan, L(hi)) + t - layerZ(s, plan, L(lo));
      return { at: M.pos(pj.joint.id), g: s.joint === 'bolt' ? boltSet(s, grip).grams : rho * 1e-6 * pinVolume(s, grip, flipped(pj)) };
    });
    for (let round = 0; round < 8; round++) {
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

  // ---- the base: a frame joining the ground pivots (and any frame links drawn); the links
  //      swing over the table beside it. For the stand it reaches down to a straight edge
  //      below everything that moves, as wide as the pivots (at least frame.standWidth) ----
  const Fr = PRINT.frame, Rb = z.Rf + Fr.margin;
  const anchors = [...M.groundJoints.map((g) => M.pos(g.joint.id)),
    ...doc.links.filter((l) => isFrameLink(doc, l)).flatMap((l) => l.joints.map(M.pos))];
  const one = anchors.length < 2 || anchors.every((p) => Math.hypot(p.x - anchors[0].x, p.y - anchors[0].y) < 1e-6);
  let hullPts = circlesHull(anchors.map((c) => ({ c, r: one ? Math.max(Rb, Fr.single) : Rb })), 48);
  if (s.base === 'stand') {
    // a straight bottom edge for the stand's slot, below everything (gravity is −y)
    const pts = [];
    M.transforms.forEach((Tk) => M.moving.forEach((l) => { for (const p of M.shapeOf(l, s.width / 2)) pts.push(Tk.get(l.id)(p)); }));
    const minY = Math.min(...pts.map((p) => p.y), ...hullPts.map((p) => p.y));
    let minX = Math.min(...hullPts.map((p) => p.x)), maxX = Math.max(...hullPts.map((p) => p.x));
    const grow = Math.max(0, Fr.standWidth - (maxX - minX)) / 2;
    minX -= grow; maxX += grow;
    const yb = minY - PRINT.stand.slot - PRINT.margin;
    hullPts = dedupe(convexHull([...hullPts, { x: minX, y: yb }, { x: maxX, y: yb }]));
  } else {
    // a pen draws on paper on the table: it must not run over the frame
    for (const p of M.pens) {
      const at = (Tk) => Tk.get(p.link.id)(M.pos(p.joint.id));
      if (M.transforms.some((Tk) => distToConvex(at(Tk), hullPts) < PRINT.penRadius)) {
        plan.notes.push(`The pen at J${doc.joints.indexOf(p.joint) + 1} passes over the base frame: it will catch on it there. Lift the pen over that part of the path.`);
      }
    }
  }
  const grounds = doc.joints.filter((j) => j.ground);
  const origin = grounds.length ? M.pos(grounds[0].id) : { x: 0, y: 0 };
  const TG = (p) => ({ x: p.x - origin.x, y: p.y - origin.y });
  const baseOutline = hullPts.map(TG);
  const tb = PRINT.baseThickness;
  const baseKind = { bolt: 'baseNut', clip: 'lowerHead', pins: 'lower' }[s.joint];
  const baseFeats = M.groundJoints.map((g, i) => {
    const zl = layerZ(s, plan, L(g.link));
    const depth = s.joint === 'bolt' ? groundBolt(s, zl + t).ceiling : 0;      // the nut's pocket (planLayers made room)
    const turn = (((11 + 23 * i) % 60) * Math.PI) / 180;
    return { c: TG(M.pos(g.joint.id)), f: feature(baseKind, s, tb, { H: zl - gap - tb, depth, turn }) };
  });
  const bsp = spacingProblem(baseFeats, 'Base');
  if (bsp) return { problems: [bsp] };
  parts.push({ name: 'Base', mesh: buildPart(baseOutline, tb, baseFeats), layer: 0, origin });

  // ---- separate pins: one per joint, each as long as its stack, and spares ----
  //   lower / upper: the layers of the parts it joins (0: the base)
  const pins = [];
  let batch = [], clipCount = 0, pinBars = 0;
  if (s.joint !== 'bolt') {
    const clip = s.joint === 'clip';
    const fitOf = (grip, handle = false) => (clip ? clipFit(s, grip, handle) : pinFit(s, grip));
    for (const pj of M.pinJoints) {
      const lo = L(pj.a) < L(pj.b) ? pj.a : pj.b, hi = lo === pj.a ? pj.b : pj.a;
      const grip = layerZ(s, plan, L(hi)) + t - layerZ(s, plan, L(lo));
      const handle = clip && flipped(pj);
      pins.push({ joint: pj.joint, grip, up: clip || flipped(pj), handle, lower: L(lo), upper: L(hi), bottom: layerZ(s, plan, L(lo)), ...fitOf(grip, handle) });
    }
    for (const g of M.groundJoints) {
      const grip = layerZ(s, plan, L(g.link)) + t;
      pins.push({ joint: g.joint, grip, up: clip, handle: false, lower: 0, upper: L(g.link), bottom: 0, ...fitOf(grip) });
    }
    pins.sort((a, b) => a.grip - b.grip || a.handle - b.handle || doc.joints.indexOf(a.joint) - doc.joints.indexOf(b.joint));
    batch = withSpares(pins);
    const sheets = pinSheets(s, batch, s.joint);
    pinBars = sheets.bars;
    parts.push({ name: 'Pins', mesh: sheets.mesh, layer: -2 });
    if (clip) {
      clipCount = pins.length + PRINT.clip.spares;
      parts.push({ name: 'Clips', mesh: clipSheet(s, clipCount), layer: -3 });
    }
  }

  // ---- bolts: one countersunk bolt per joint. Between links: up from underneath, a washer
  //      and a lock nut on top. At a ground pivot: down from the top, into a lock nut in a
  //      pocket under the base (nothing stands up there for a link to catch) ----
  const bolts = [];
  if (s.joint === 'bolt') {
    for (const pj of M.pinJoints) {
      const lo = L(pj.a) < L(pj.b) ? pj.a : pj.b, hi = lo === pj.a ? pj.b : pj.a;
      const grip = layerZ(s, plan, L(hi)) + t - layerZ(s, plan, L(lo));
      bolts.push({ joint: pj.joint, grip, lower: L(lo), upper: L(hi), down: false, ...boltSet(s, grip) });
    }
    for (const g of M.groundJoints) {
      const grip = layerZ(s, plan, L(g.link)) + t;
      bolts.push({ joint: g.joint, grip, lower: 0, upper: L(g.link), down: true, ...groundBolt(s, grip) });
    }
    bolts.sort((a, b) => doc.joints.indexOf(a.joint) - doc.joints.indexOf(b.joint));
  }

  // ---- the stand: a block with a slot the base stands in ----
  if (s.base === 'stand') parts.push({ name: 'Stand_print_2', mesh: standMesh(), layer: -1 });

  // ---- every part must fit the print bed ----
  for (const p of parts) {
    const fit = bedFit(p.mesh, s);
    if (fit.fits) continue;
    const advice = p.layer === 0 ? 'Put the ground pivots closer together (draw the mechanism smaller), or print on a larger printer.'
      : p.layer > 0 ? 'Make the link shorter (draw the mechanism smaller), or print on a larger printer.' : 'Print it on a larger printer.';
    plan.notes.push(`${p.name} is ${fmt(fit.long)} × ${fmt(fit.short)} mm: it does not fit the ${s.bedX} × ${s.bedY} mm print bed. ${advice}`);
  }
  return { parts, plan, pins, batch, pinBars, clips: clipCount, bolts, stacks, settings: s };
}

/** Volume (mm³) of the pin for a stack of height grip, with its clip (handle: the long crank pin). */
function pinVolume(s, grip, handle = false) {
  if (s.joint === 'clip') return clipPinMesh(s, clipFit(s, grip, handle)).mesh.volume() + clipMesh(s).volume();
  const fit = pinFit(s, grip);
  return pinMesh(s, fit.uc, fit.us).mesh.volume();
}

/**
 * The bolt for a joint whose stack is `grip` mm from the face with the
 * countersink to the top face: { length (a standard length, head included),
 * need (the least that does), grams (bolt, washer and nut, steel) }.
 */
export function boltSet(s, grip) {
  const F = fastener(s.bolt), W = F.washer, N = F.nut, rho = PRINT.steel;
  const need = grip - PRINT.boltSink + W.h + N.m + PRINT.boltPast;
  const length = PRINT.boltLengths.find((L) => L >= need) || Math.ceil(need / 10) * 10;
  // masses: the head a cone frustum, the shank at 85 % of the full section (the thread),
  // the washer a ring, the nut a hexagon less its hole (and its nylon insert, 85 %)
  const head = (Math.PI / 12) * F.k * (F.dk ** 2 + F.dk * F.d + F.d ** 2);
  const shank = 0.85 * (Math.PI / 4) * F.d ** 2 * (length - F.k);
  const washer = (Math.PI / 4) * (W.od ** 2 - (F.d + 0.3) ** 2) * W.h;
  const nut = 0.85 * ((Math.sqrt(3) / 2) * N.s ** 2 - (Math.PI / 4) * F.d ** 2) * N.m;
  // above: how far the washer, nut and the bolt's end stand above the top face
  return { length, need, above: length - (grip - PRINT.boltSink), grams: rho * (head + shank + washer + nut) };
}

/**
 * The bolt at a ground pivot: down from the link's top face (head flush in a
 * countersink there) into a nut in a pocket under the base, its end inside
 * the base. D: from the link's top face to the base's underside. The longest
 * standard length that keeps the end inside: { length, end (the end's height
 * above the underside), ceiling (the pocket's depth: the nut above the end,
 * the end past the nut) } or null when even the shortest bolt is too long.
 */
export function groundBolt(s, D) {
  const F = fastener(s.bolt), T = PRINT.nutTrap;
  const reach = D - PRINT.boltSink - T.end;                         // the most the bolt may be
  const fits = PRINT.boltLengths.filter((L) => L <= reach);
  if (!fits.length) return null;
  const length = fits[fits.length - 1], end = D - PRINT.boltSink - length;
  return { length, end, ceiling: end + PRINT.boltPast + F.nut.m };
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
  s = withPin(s);
  const problems = sizeProblems(s);
  if (problems.length) return { problems };
  const t = s.thickness, w = s.width, z = sizes(s), parts = [];
  const pitch = 1.5 * w + 4;
  // the marks (small holes) start beyond the joint's features (the clip's pocket reaches further)
  const m0 = s.joint === 'clip' ? Math.max(0.8 * w, clipTravel(s) + z.pocketR + 2.2) : s.joint === 'bolt' ? Math.max(0.8 * w, z.nutR + 2) : 0.8 * w;
  const len = m0 + 3.5 * 3 + 0.2 * w + 3.5;
  PRINT.fitTest.forEach((c, k) => {
    const sc = { ...s, clearance: c };
    const feats = [{ c: { x: 0, y: 0 }, f: s.joint === 'clip' ? feature('upperClip', sc, t, { dir: 0 }) : feature('upper', sc, t) }];
    // k + 1 small holes along the piece tell the pieces apart
    for (let i = 0; i <= k; i++) feats.push({ c: { x: m0 + 3.5 * i, y: 0 }, f: feature('hole', sc, t, { rh: 0.9, Rf: 1.6 }) });
    parts.push({ name: `Test${k + 1}_clearance_${c.toFixed(1)}`, mesh: buildPart(outlinePolygon([{ x: 0, y: 0 }, { x: len, y: 0 }], w / 2), t, feats), clearance: c });
  });
  if (s.joint !== 'bolt') {
    // the bar under the pieces: its holes have the same clearances, in the same order
    const at = PRINT.fitTest.map((_, k) => ({ x: k * pitch, y: 0 }));
    const feats = at.map((c, k) => ({ c, f: feature(s.joint === 'clip' ? 'lowerHead' : 'lower', { ...s, clearance: PRINT.fitTest[k] }, t) }));
    parts.push({ name: 'Test_bar', mesh: buildPart(outlinePolygon(at, w / 2), t, feats) });
    const grip = 2 * t + PRINT.layerGap;
    const fit = s.joint === 'clip' ? clipFit(s, grip) : pinFit(s, grip);
    parts.push({ name: 'Test_pins', mesh: pinSheet(s, PRINT.fitTest.map(() => ({ ...fit, grip })), s.joint) });
    if (s.joint === 'clip') parts.push({ name: 'Test_clips', mesh: clipSheet(s, PRINT.fitTest.length + 2) });
  }
  return { parts, settings: s };
}

// =============================================================================
// 10. The download
// =============================================================================

const PRINT_TIPS = [
  'PRINT SETTINGS',
  '  PLA or PETG, 0.4 mm nozzle, 0.2 mm layers, 3 walls, 20 % infill, no supports.',
  '  Print every part as it lies in its file (flat face down, any knob up).',
  '  The holes have a small chamfer at the bottom, so no "elephant foot"',
  '  compensation is needed.',
];

const PIN_TIPS = {
  clip: ['  Pins.stl and Clips.stl: print them solid (100 % infill), PETG if you have it,',
    '  with a brim (small parts lift off the bed easily).',
    '  The pins lie on their flats on a bar: twist each one off its tab.'],
  pins: ['  Pins.stl: print it solid (100 % infill), PETG if you have it, with a brim',
    '  (small parts lift off the bed easily).',
    '  The pins lie on their flats on a bar: twist each one off its tab.'],
  bolt: [],
};

const JOINT_TEXT = {
  bolt: (s) => `Bolts: ${s.bolt} countersunk bolts with a washer and a lock nut at every joint, in ${fmt3(s.pin + s.clearance)} mm holes (clearance ${s.clearance} mm).`,
  clip: (s) => `Clip pins: ${s.pin} mm pins (Pins.stl) held by flat clips (Clips.stl), in ${fmt3(s.pin + s.clearance)} mm holes (clearance ${s.clearance} mm).`,
  pins: (s) => `Snap pins: ${s.pin} mm pins (Pins.stl) in ${fmt3(s.pin + s.clearance)} mm holes (clearance ${s.clearance} mm).`,
};

const BOLT_HOW = [
  '  Between two links: a countersunk bolt goes up from underneath, its head flush',
  '  in the countersink of the lower part; a washer and a lock nut go on top.',
  '  At a ground pivot: a lock nut sits in the hexagonal pocket under the base, and',
  '  the bolt goes down from the top of the link into it, head flush.',
  '  Tighten each joint until it has no play but still turns freely, then stop:',
  '  the nylon ring in the nut keeps it there.',
];

const CLIP_HOW = [
  '  To clip a pin: lay a clip flat in the far end of the pocket round the pin\'s top,',
  '  open end towards the pin, and push it along the pocket until it clicks into',
  '  the groove. To take it off, put a small flat screwdriver in the clip\'s open',
  '  end, against the pin, and lever the clip back along the pocket.',
];

/** "J1", "J1 and J3", "J1, J2 and J4" */
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The README in the zip. */
function readme(doc, res) {
  const s = res.settings, jn = (j) => `J${doc.joints.indexOf(j) + 1}`;
  const jns = (pins) => pins.map((p) => p.joint).sort((a, b) => doc.joints.indexOf(a) - doc.joints.indexOf(b)).map(jn);
  const lines = [doc.meta.title || 'Mechanism', `Exported from ${APP.name} ${APP.version} for 3-D printing. All dimensions in millimetres.`, ''];
  lines.push('SETTINGS',
    `  Links ${s.width} mm wide and ${s.thickness} mm thick, as in the mass model (Forces).`,
    `  ${JOINT_TEXT[s.joint](s)}`,
    `  Base: ${s.base === 'stand' ? 'a plate that stands upright in the stand' : 'a frame between the ground pivots that lies flat on the table'}.`,
    `  Every part fits a ${s.bedX} × ${s.bedY} mm print bed${res.plan.notes.some((n) => /does not fit the/.test(n)) ? ', except as said under NOTES' : ''}.`, '');
  lines.push(...PRINT_TIPS, ...PIN_TIPS[s.joint]);
  if (res.stacks.length) lines.push('  For the counterweights to balance the mechanism, print the links solid', '  (100 % infill): the masses are worked out for solid parts.');
  lines.push('');
  const links = res.parts.filter((p) => p.layer > 0).sort((a, b) => a.layer - b.layer);
  const clip = s.joint === 'clip', bolt = s.joint === 'bolt';
  // clip pins and bolts both go up from underneath, layer by layer: the same steps
  const fixings = bolt ? res.bolts : res.pins, word = bolt ? 'bolt' : 'pin';
  const basePins = jns(fixings.filter((p) => p.lower === 0));
  lines.push('ASSEMBLY');
  if (clip) lines.push(...CLIP_HOW, '');
  if (bolt) lines.push(...BOLT_HOW, '');
  const plural = basePins.length > 1;
  const basePinText = !basePins.length ? ''
    : bolt ? `Push a lock nut into the pocket${plural ? 's' : ''} under the base for ${andList(basePins)}, nylon ring outwards (it may need a tap). `
      : clip ? `Push the pin${plural ? 's' : ''} for ${andList(basePins)} into the base from underneath, head${plural ? 's' : ''} flush in the countersink${plural ? 's' : ''}. ` : '';
  lines.push(`  1. ${s.base === 'stand'
    ? `Print the stand twice. ${basePinText}Stand the base in the stands' slots, one near each end, the side with the bosses to the front.`
    : `${basePinText}Lay the base on the table, bosses up, and tape it down (double-sided tape) or hold it: the links reach out beyond it.`}`);
  let step = 2;
  if (res.stacks.length) lines.push(`  ${step++}. Bolt each counterweight to its link first (see COUNTERWEIGHTS below).`);
  const up = !clip && !bolt && res.pins.find((p) => p.up);
  if (up) {
    const crank = res.parts.find((p) => p.link === doc.driver.link);
    lines.push(`  ${step++}. Push the pin for ${jn(up.joint)} up through ${crank ? crank.name : 'the crank'} from below, head underneath, before the crank goes on: the knob above will cover its top.`);
  }
  const how = { pins: (n) => `Lay ${n > 1 ? 'them' : 'it'} on and push a pin of the right length (PINS below) down through each joint, head on top, until it clicks; where a pin already sticks up, press the link down onto it until it clicks.` };
  for (const k of [...new Set(links.map((p) => p.layer))]) {
    const here = links.filter((p) => p.layer === k), names = here.map((p) => p.name).join(' and ');
    if (!clip && !bolt) { lines.push(`  ${step++}. Layer ${k}: ${names}. ${how[s.joint](here.length)}`); continue; }
    const first = jns(fixings.filter((p) => p.lower === k));
    const tops = jns(fixings.filter((p) => p.upper === k && p.lower > 0));
    const grounds = bolt ? jns(fixings.filter((p) => p.upper === k && p.lower === 0)) : [];
    const it = here.length > 1 ? 'them' : 'it', ws = (xs) => `${word}${xs.length > 1 ? 's' : ''}`;
    const lengths = bolt ? ' (lengths under BOLTS below)' : '';
    lines.push(`  ${step++}. Layer ${k}: ${names}. ${first.length ? `First push the ${ws(first)} for ${andList(first)}${lengths} up through ${it} from underneath, head${first.length > 1 ? 's' : ''} flush. ` : ''}`
      + `Lay ${it} on over the ${word}s${tops.length ? (bolt ? `, then put a washer and a lock nut on ${andList(tops)}` : `, then clip ${andList(tops)}`) : ''}`
      + `${grounds.length ? `${tops.length ? ', and' : ', then'} push the bolt${grounds.length > 1 ? 's' : ''} for ${andList(grounds)} down through ${it} into the nut${grounds.length > 1 ? 's' : ''} under the base, head${grounds.length > 1 ? 's' : ''} flush` : ''}.`);
  }
  if (doc.joints.some((j) => j.trace)) lines.push(`  ${step++}. To trace the path: tape paper to the ${s.base === 'stand' ? 'base' : 'table under the mechanism'}, put a pen refill (about 3 mm) in the hole at the traced point, and push it through until it just touches the paper.`);
  const knobText = res.plan.knob === 'pin' ? (clip ? ' by the top of the long crank pin' : ' by the knob over the crank pin') : res.plan.knob === 'mid' ? ' by its knob' : bolt ? ', pushing the crank pin round by its nut' : '';
  lines.push(`  ${step}. Turn the crank once by hand${knobText}: everything should turn freely.`, '');
  if (s.joint === 'pins') lines.push('  To take a joint apart, pull the parts firmly apart; the ridge lets go.', '');
  lines.push('LAYERS (from the base up)');
  for (const p of links) lines.push(`  ${p.name}: layer ${p.layer}${p.knob ? ' (with the knob)' : ''}`);
  lines.push('');
  if (res.batch.length) {
    lines.push(`PINS (in Pins.stl from the end of the bar${res.pinBars > 1 ? `, on ${res.pinBars} bars side by side, the first bar first` : ''}, shortest first; ${PRINT.pins.spares} spares of each length)`);
    res.batch.forEach((p, i) => lines.push(`  ${i + 1}. ${p.joint ? jn(p.joint) : 'spare'}: ${fmt(p.grip)} mm through${!clip && p.up ? ', put in from below' : ''}${p.handle ? `, with a ${PRINT.knob.height} mm handle above` : ''}`));
    if (clip) lines.push(`  Clips.stl: ${res.clips} clips (${res.clips - res.pins.length} spare).`);
    lines.push('');
  }
  if (bolt && res.bolts.length) {
    const F = fastener(s.bolt), byLength = new Map();
    for (const b of res.bolts) byLength.set(b.length, [...(byLength.get(b.length) || []), b]);
    lines.push(`BOLTS (steel, ${s.bolt}; one per joint)`);
    for (const [len, list] of [...byLength].sort((a, b) => a[0] - b[0])) {
      lines.push(`  ${list.length} x ${s.bolt} x ${len} countersunk bolt (ISO 10642, length with the head): ${andList(list.map((b) => jn(b.joint)))}`);
    }
    const between = res.bolts.filter((b) => !b.down).length;
    if (between) lines.push(`  ${between} x ${s.bolt} washer (ISO 7089, ${F.washer.od} mm), under the nuts between links`);
    lines.push(
      `  ${res.bolts.length} x ${s.bolt} nylon-insert lock nut (ISO 10511)`,
      '  Between links a longer bolt also works (its end stands out further above the nut);',
      '  at a ground pivot it must not be longer, or its end stands out under the base.', '');
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
  const room = [bolt && 'the nuts in the base', res.stacks.some((st) => st.dir === 'down') && 'a counterweight underneath'].filter(Boolean);
  if (res.plan.baseClear > PRINT.baseClear) lines.push(`  The links stand ${fmt(res.plan.baseClear)} mm above the base, to make room for ${room.length ? room.join(' and ') : 'a counterweight underneath'}.`, '');
  if (res.plan.notes.length) { lines.push('NOTES'); for (const n of res.plan.notes) lines.push(`  ${n}`); lines.push(''); }
  lines.push('If a joint is too tight or too loose, print the fit test (Export > Fit test),',
    bolt ? 'pick the piece that turns freely on the bolt without wobbling, and enter its clearance.' : 'pick the piece that clicks in and turns freely, and enter its clearance.');
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
  const extras = [res.batch.length ? `${res.batch.length} pins (${res.batch.length - res.pins.length} spare)` : '', res.clips ? `${res.clips} clips` : '',
    res.bolts.length ? `a list of ${res.bolts.length} ${s.bolt} bolts with washers and lock nuts` : '', res.stacks.length ? `${res.stacks.length} counterweight${res.stacks.length === 1 ? '' : 's'}` : '', s.base === 'stand' ? 'the stand' : ''].filter(Boolean);
  const summary = `${n} link${n === 1 ? '' : 's'} in ${res.plan.top} layer${res.plan.top === 1 ? '' : 's'}, the base${extras.length ? `, ${extras.join(', ')}` : ''}`;
  return { name: `${base}-3d-print.zip`, bytes: makeZip(files), summary, notes: res.plan.notes };
}

/** The zip for the fit test. */
export function fitTestZip(app, s = printSettings(app.doc)) {
  const res = fitTestParts(app.doc, s);
  s = res.settings || withPin(s);
  if (res.problems) return res;
  const files = res.parts.map((p) => ({ name: `${p.name}.stl`, data: p.mesh.stl(`${APP.name} ${p.name}`) }));
  const how = {
    clip: 'Push a pin up through each hole of Test_bar from underneath, head flush in its countersink.\r\nLay on each pin the piece with the same number (counting from the end of the bar with\r\nthe first hole) and clip it (see the clip in Test_clips). Choose the loosest pair that still\r\nturns freely without wobbling. Enter its clearance in Export > For 3-D printing.\r\nThe clips should click on and hold firmly: if they are too stiff or too loose, say so.',
    pins: 'Lay each piece on the hole of Test_bar with the same number (from the end with the bar\'s first hole)\r\nand push a pin through from the top until it clicks. Choose the loosest pair that still holds and turns\r\nfreely without wobbling. Enter its clearance in Export > For 3-D printing.',
    bolt: `Push an ${s.bolt} bolt through each piece. Choose the loosest one that still turns on the bolt\r\nwithout wobbling, and enter its clearance in Export > For 3-D printing.`,
  };
  const lines = ['Fit test', `Exported from ${APP.name} ${APP.version}. All dimensions in millimetres.`, '',
    `Four test pieces with ${s.joint === 'bolt' ? `holes for ${s.bolt} bolts` : `${s.pin} mm holes`} and clearances ${PRINT.fitTest.join(', ')} mm; the number of small holes`,
    'along a piece is its number (1 to 4).', how[s.joint], '', ...PRINT_TIPS, ...PIN_TIPS[s.joint]];
  files.push({ name: 'README.txt', data: lines.join('\r\n') });
  return { name: s.joint === 'bolt' ? `fit-test-${s.bolt}-bolts.zip` : `fit-test-${{ clip: 'clip-pins', pins: 'snap-pins' }[s.joint]}-${s.pin}mm.zip`, bytes: makeZip(files) };
}
