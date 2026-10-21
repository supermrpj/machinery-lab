// =============================================================================
// mounting.js — how the cam fixes to its shaft (Part and mounting)
// -----------------------------------------------------------------------------
//   plain      a round bore (press fit, glue, or a pin added later in CAD)
//   keyway     round bore with a DIN 6885 keyway (size from the shaft Ø)
//   dflat      D-shaped bore for a motor shaft with a flat
//   setscrew   round bore and a hub on one face with a radial set-screw hole
//   flange     round bore and a ring of bolt holes, to bolt the cam to a
//              flange coupling or a shaft collar
// The keyway, the flat and the set screw are on +y: towards the follower when
// θ = 0, so the cam can be timed on its shaft. The bolt holes start there too.
//
// mounting(part, rMin, len) → {   len(v): how to write a length in messages
//   kind, d (shaft Ø), c (clearance), R (bore radius with clearance),
//   loop       the bore outline: segments in order, clockwise (material
//              outside), each { type: 'circle' | 'arc' | 'line', … }
//   reach      the farthest the bore outline goes from the centre
//   key { b, t2 }, flat { f }, hub { r, h }, screw { size, hole, d, z },
//   bolts { n, pcd, d, at: [{ x, y }] }   (null when not used)
//   checks     [{ level: 'ok' | 'warn' | 'error', text }]
//   blocked    true when the part cannot be made as set
// }
// rMin: the smallest radius of the cam surface (analysis.js).
// Lengths in mm. Part fields left empty (null) take the values worked out here.
// =============================================================================

import { MOUNTING } from '../config.js';

const round = (v, step) => Math.round(v / step) * step;

/** DIN 6885 key for a shaft Ø, or null outside the table. */
export function keyFor(d) {
  return MOUNTING.keys.find((k) => d > k.dMin - 1e-9 && d <= k.dMax + 1e-9) || null;
}

/** Screw hole diameter for a screw size and what the hole is for ('clear' | 'tap' | 'insert'). */
export function screwHole(size, use) {
  const s = MOUNTING.screws[size] || MOUNTING.screws.M3;
  return s[use] || s.clear;
}

export function mounting(part, rMin, len = (v) => `${+v.toFixed(2)} mm`) {
  const kind = MOUNTING.kinds.some((k) => k.id === part.mount) ? part.mount : 'plain';
  const d = Math.max(0, part.bore || 0);
  const c = Math.max(0, part.clearance ?? MOUNTING.clearance);
  const R = d > 0 ? (d + c) / 2 : 0;
  const t = Math.max(0, part.thickness || 0);
  const wall = MOUNTING.minWall;
  const checks = [];
  let blocked = false;
  const say = (level, text) => { checks.push({ level, text }); if (level === 'error') blocked = true; };
  const mm = len;

  let loop = R > 0 ? [{ type: 'circle', c: { x: 0, y: 0 }, r: R, start: Math.PI / 2, ccw: false }] : [];
  let reach = R, key = null, flat = null, hub = null, screw = null, bolts = null;

  if (kind === 'keyway' && d > 0) {
    const std = keyFor(d);
    const b = part.keyB > 0 ? part.keyB : std && std.b;
    const t2 = part.keyT2 > 0 ? part.keyT2 : std && std.t2;
    if (!(b > 0 && t2 > 0)) say('error', `There is no DIN 6885 key for a ${mm(d)} shaft. Type the key width and depth, or use a D-flat.`);
    else if (b + c >= 2 * R) say('error', 'The key is wider than the bore.');
    else {
      key = { b, t2, standard: !(part.keyB > 0 || part.keyT2 > 0) && !!std };
      const w = (b + c) / 2, top = d / 2 + t2 + c / 2;
      const yA = Math.sqrt(R * R - w * w);
      const aA = Math.atan2(yA, w), aD = Math.atan2(yA, -w);
      // clockwise: up the left side of the slot, across its top, down the right, round the bore
      loop = [
        { type: 'line', a: { x: -w, y: yA }, b: { x: -w, y: top } },
        { type: 'line', a: { x: -w, y: top }, b: { x: w, y: top } },
        { type: 'line', a: { x: w, y: top }, b: { x: w, y: yA } },
        { type: 'arc', c: { x: 0, y: 0 }, r: R, a0: aA, a1: aD - 2 * Math.PI, ccw: false },
      ];
      reach = Math.hypot(w, top);
    }
  }

  if (kind === 'dflat' && d > 0) {
    const f = part.flat > 0 ? part.flat : round(MOUNTING.flatRatio * d, 0.1);
    if (!(f > d / 2 && f < d)) say('error', `The across-flats size must be between ${mm(d / 2)} and ${mm(d)}.`);
    else {
      flat = { f, standard: !(part.flat > 0) };
      const yf = f - d / 2 + c / 2;              // centre to the flat, with clearance
      const x = Math.sqrt(R * R - yf * yf);
      loop = [
        { type: 'line', a: { x: -x, y: yf }, b: { x, y: yf } },
        { type: 'arc', c: { x: 0, y: 0 }, r: R, a0: Math.atan2(yf, x), a1: Math.atan2(yf, -x) - 2 * Math.PI, ccw: false },
      ];
    }
  }

  if (kind === 'setscrew') {
    const size = MOUNTING.screws[part.screw] ? part.screw : 'M3';
    const use = part.screwHole === 'tap' ? 'tap' : 'insert';
    const hd = screwHole(size, use);
    const D = part.hubD > 0 ? part.hubD : Math.ceil(Math.max(2 * d, 2 * R + 3 * hd));
    const H = part.hubH > 0 ? part.hubH : MOUNTING.hubHeight;
    hub = { r: D / 2, h: H, standard: !(part.hubD > 0) };
    screw = { size, hole: use, d: hd, z: t + H / 2 };
    if (d <= 0) say('error', 'A hub with a set screw needs a bore: set the shaft Ø.');
    if (D / 2 - R < hd) say('error', `The hub wall (${mm(D / 2 - R)}) is thinner than the screw hole (${mm(hd)}): make the hub larger.`);
    else if (D / 2 - R < 1.5 * hd) say('warn', `The hub wall (${mm(D / 2 - R)}) is thin for an ${size} ${use === 'insert' ? 'insert' : 'thread'}.`);
    if (hd / 2 > 0.8 * R && d > 0) say('error', `The ${size} screw hole is too large for a ${mm(d)} bore: use a smaller screw.`);
    if (H <= hd + 1) say('error', `The hub is too low for the screw hole: make it at least ${mm(hd + 2 * wall)} high.`);
    else if (H < hd + 2 * wall) say('warn', `The hub is low for the screw hole: make it at least ${mm(hd + 2 * wall)} high.`);
    if (D / 2 > rMin - wall) say('warn', `The hub (Ø ${mm(D)}) comes past the cam outline (smallest radius ${mm(rMin)}).`);
  }

  if (kind === 'flange') {
    const size = MOUNTING.screws[part.screw] ? part.screw : 'M3';
    const n = MOUNTING.boltCounts.includes(part.boltN) ? part.boltN : 4;
    const hd = screwHole(size, 'clear');
    const pcd = part.boltPcd > 0 ? part.boltPcd : round(R + rMin, 0.5);
    const at = Array.from({ length: n }, (_, i) => {
      const a = Math.PI / 2 + (2 * Math.PI * i) / n;
      return { x: (pcd / 2) * Math.cos(a), y: (pcd / 2) * Math.sin(a) };
    });
    bolts = { n, pcd, d: hd, size, at, standard: !(part.boltPcd > 0) };
    if (pcd / 2 - hd / 2 < R + wall) say(pcd / 2 - hd / 2 <= R ? 'error' : 'warn', `The bolt holes come within ${mm(Math.max(0, pcd / 2 - hd / 2 - R))} of the bore: make the bolt circle larger.`);
    if (pcd / 2 + hd / 2 > rMin - wall) say(pcd / 2 + hd / 2 >= rMin ? 'error' : 'warn', `The bolt holes come within ${mm(Math.max(0, rMin - pcd / 2 - hd / 2))} of the cam edge: make the bolt circle smaller.`);
    if (pcd * Math.sin(Math.PI / n) - hd < wall) say('error', 'The bolt holes are too close together: fewer holes or a larger bolt circle.');
  }

  // the bore, keyway or flat must stay inside the cam
  if (reach >= rMin) say('error', `The bore${key ? ' and keyway' : ''} (${mm(reach)} from the centre) cut through the cam (smallest radius ${mm(rMin)}).`);
  else if (rMin - reach < wall) say('warn', `Only ${mm(rMin - reach)} of material between the bore${key ? ' and keyway' : ''} and the cam edge.`);
  if (!(t > 0)) say('error', 'The thickness must be above 0.');
  if (!checks.length) say('ok', `Fits: ${mm(rMin - Math.max(reach, bolts ? bolts.pcd / 2 + bolts.d / 2 : 0))} of material left to the cam edge.`);

  return { kind, d, c, R, loop, reach, key, flat, hub, screw, bolts, checks, blocked };
}

/** Points along a bore loop segment (for drawing and meshing), not repeating the end. */
export function segmentPoints(seg, n) {
  if (seg.type === 'line') return [seg.a];
  const a0 = seg.type === 'circle' ? seg.start : seg.a0;
  const a1 = seg.type === 'circle' ? seg.start + (seg.ccw ? 2 : -2) * Math.PI : seg.a1;
  const k = Math.max(2, Math.ceil((n * Math.abs(a1 - a0)) / (2 * Math.PI)));
  return Array.from({ length: k }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / k;
    return { x: seg.c.x + seg.r * Math.cos(a), y: seg.c.y + seg.r * Math.sin(a) };
  });
}

/** The whole loop as a polygon, n points per full turn of an arc. */
export function loopPoints(loop, n = 96) {
  return loop.flatMap((seg) => segmentPoints(seg, n));
}
