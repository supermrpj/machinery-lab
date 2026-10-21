// =============================================================================
// document.js — a cam design, its defaults, examples and files
// -----------------------------------------------------------------------------
// Everything a design needs, in stored units (mm, N, kg, s):
//   program    the segments (program.js)
//   follower   { type: 'roller' | 'flat', Rp, Rb, Rf, e, dir }
//              Rp: prime circle (roller); Rb: base circle (flat face);
//              dir +1 counter-clockwise, −1 clockwise
//   motion     { omega } camshaft speed, rad/s
//   dynamics   { m, k (N/mm), preload (N), zeta }
//   part       the part to make (export): thickness, shaft Ø (bore), print
//              clearance, and how it mounts on the shaft (mounting.js):
//              mount, keyB, keyT2, flat, hubD, hubH, screw, screwHole,
//              boltN, boltPcd. null = worked out from the shaft Ø.
// =============================================================================

import { APP } from '../config.js';

export const FORMAT = 'camlab';
export const FORMAT_VERSION = 1;
const IN = 25.4, LBF = 4.4482216152605, BLOB = LBF / 0.0254;

/** The textbook's double-dwell cam with one law for the rise and the fall. */
const doubleDwell = (law) => [
  { kind: 'dwell', beta: 90 }, { kind: 'rise', law, beta: 90, h: IN },
  { kind: 'dwell', beta: 90 }, { kind: 'fall', law, beta: 90, h: IN },
];
const singleDwell = (law) => [
  { kind: 'rise', law, beta: 90, h: IN }, { kind: 'fall', law, beta: 90, h: IN }, { kind: 'dwell', beta: 180 },
];

export function createDocument() {
  return {
    format: FORMAT, version: FORMAT_VERSION,
    meta: { title: 'Untitled cam', notes: '' },
    units: 'si',
    program: { segments: [
      { kind: 'dwell', beta: 90 }, { kind: 'rise', law: 'cycloidal', beta: 90, h: 25 },
      { kind: 'dwell', beta: 90 }, { kind: 'fall', law: 'cycloidal', beta: 90, h: 25 },
    ] },
    follower: { type: 'roller', Rp: 75, Rb: 75, Rf: 12.5, e: 0, dir: 1 },
    motion: { omega: 2 * Math.PI },
    dynamics: { m: 1, k: 10, preload: 50, zeta: 0.06 },
    part: defaultPart(),
  };
}

export function defaultPart() {
  return {
    thickness: 10, bore: 12, clearance: 0.2, mount: 'plain',
    keyB: null, keyT2: null, flat: null, hubD: null, hubH: null, screw: 'M3', screwHole: 'insert', boltN: 4, boltPcd: null,
  };
}

/**
 * Examples from the Week 11-13 slides. The same
 * double-dwell specification is solved with each law so students can compare.
 */
export const EXAMPLES = [
  { id: 'novice', name: 'Double dwell — straight lines', make: () => usDoc('Double dwell, straight lines', doubleDwell('constVel'), 2 * Math.PI) },
  { id: 'apprentice', name: 'Double dwell — simple harmonic', make: () => usDoc('Double dwell, simple harmonic', doubleDwell('shm'), 2 * Math.PI) },
  { id: 'junior', name: 'Double dwell — cycloidal', make: () => usDoc('Double dwell, cycloidal', doubleDwell('cycloidal'), 2 * Math.PI) },
  { id: 'modtrap', name: 'Double dwell — modified trapezoid', make: () => usDoc('Double dwell, modified trapezoid', doubleDwell('modTrap'), 2 * Math.PI) },
  { id: 'modsine', name: 'Double dwell — modified sine', make: () => usDoc('Double dwell, modified sine', doubleDwell('modSine'), 2 * Math.PI) },
  { id: 'poly345', name: 'Double dwell — 3-4-5 polynomial', make: () => usDoc('Double dwell, 3-4-5 polynomial', doubleDwell('poly345'), 2 * Math.PI) },
  { id: 'single-cyc', name: 'Single dwell — cycloidal rise and fall', make: () => usDoc('Single dwell, cycloidal', singleDwell('cycloidal'), 15) },
  { id: 'single-dh', name: 'Single dwell — double harmonic', make: () => usDoc('Single dwell, double harmonic', singleDwell('doubleHarmonic'), 15) },
  { id: 'single-poly', name: 'Single dwell — one 3-4-5-6 polynomial', make: () => usDoc('Single dwell, 3-4-5-6 polynomial', [
    { kind: 'poly', beta: 180, conditions: [
      { at: 0, d: 0, value: 0 }, { at: 0, d: 1, value: 0 }, { at: 0, d: 2, value: 0 },
      { at: 0.5, d: 0, value: IN },
      { at: 1, d: 0, value: 0 }, { at: 1, d: 1, value: 0 }, { at: 1, d: 2, value: 0 }] },
    { kind: 'dwell', beta: 180 }], 15) },
  { id: 'ex15-1', name: 'Four dwells, spring and preload', make: () => {
    const d = usDoc('Four-dwell cam', [
      { kind: 'rise', law: 'modSine', beta: 50, h: IN }, { kind: 'dwell', beta: 40 },
      { kind: 'fall', law: 'cycloidal', beta: 50, h: IN }, { kind: 'dwell', beta: 40 },
      { kind: 'rise', law: 'poly345', beta: 50, h: IN }, { kind: 'dwell', beta: 40 },
      { kind: 'fall', law: 'poly4567', beta: 50, h: IN }, { kind: 'dwell', beta: 40 },
    ], 18.85);
    d.follower.Rp = 4 * IN;
    d.dynamics = { m: 0.0738 * BLOB, k: (200 * LBF) / IN, preload: 150 * LBF, zeta: 0.15 };
    return d;
  } },
];

/** A document in inches, as the textbook examples are. */
function usDoc(title, segments, omega) {
  const d = createDocument();
  d.meta.title = title;
  d.units = 'us';
  d.program.segments = segments;
  d.motion.omega = omega;
  d.follower = { type: 'roller', Rp: 3 * IN, Rb: 3 * IN, Rf: 0.5 * IN, e: 0, dir: 1 };
  d.dynamics = { m: 0.05 * BLOB, k: (100 * LBF) / IN, preload: 50 * LBF, zeta: 0.06 };
  d.part = { ...defaultPart(), thickness: 0.375 * IN, bore: 0.5 * IN };
  return d;
}

// ---- files ---------------------------------------------------------------------------

export function serialize(doc) {
  return JSON.stringify({ ...doc, savedWith: `${APP.name} ${APP.version}` }, null, 1);
}

/** File text → document; throws an Error with a plain message if it is not a CamLab file. */
export function deserialize(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('This file is not a CamLab file (it could not be read as JSON).'); }
  if (!data || data.format !== FORMAT) throw new Error('This file is not a CamLab cam design.');
  if (data.version > FORMAT_VERSION) throw new Error('This file was made by a newer version of CamLab. Please update CamLab to open it.');
  const base = createDocument();
  const doc = { ...base, ...data };
  for (const k of ['meta', 'follower', 'motion', 'dynamics', 'part']) doc[k] = { ...base[k], ...(data[k] || {}) };
  doc.program = { segments: Array.isArray(data.program && data.program.segments) ? data.program.segments : base.program.segments };
  delete doc.savedWith;
  return doc;
}
