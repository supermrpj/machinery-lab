// =============================================================================
// units.js — the units shown to the student
// -----------------------------------------------------------------------------
// Everything is STORED in one system: lengths in mm, forces in N, torques in
// N·m, masses in kg, moments of inertia in kg·m². Only what is shown and typed
// is converted. The choice is saved with the drawing (doc.units):
//   doc.units = { length: 'mm' | 'cm' | 'm' | 'in' | 'ft', grid: 0 | spacing,
//                 force: 'N' | …, torque: 'Nm' | …, mass: 'kg' | …,
//                 inertia: 'kgm2' | … }
// grid is the minor grid spacing in the chosen length unit (0 = automatic).
// UNIT_PRESETS set all of them at once (SI in mm or m, US in inches or feet).
// =============================================================================

import { fmt } from '../../../../packages/ui-kit/src/format.js';

export const LENGTH_UNITS = {
  mm: { key: 'mm', label: 'mm', name: 'Millimetres (mm)', f: 1, digits: 2, grids: [0.5, 1, 2, 5, 10, 20, 50, 100], auto: 10 },
  cm: { key: 'cm', label: 'cm', name: 'Centimetres (cm)', f: 10, digits: 3, grids: [0.1, 0.2, 0.5, 1, 2, 5, 10], auto: 1 },
  m: { key: 'm', label: 'm', name: 'Metres (m)', f: 1000, digits: 4, grids: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1], auto: 0.1 },
  in: { key: 'in', label: 'in', name: 'Inches (in)', f: 25.4, digits: 3, grids: [0.0625, 0.125, 0.25, 0.5, 1, 2, 6], auto: 0.5 },
  ft: { key: 'ft', label: 'ft', name: 'Feet (ft)', f: 304.8, digits: 4, grids: [0.01, 0.05, 0.1, 0.25, 0.5, 1], auto: 0.1 },
};

// ---- force, torque, mass and moment of inertia ------------------------------------
// f = how many of the stored unit (N, N·m, kg, kg·m²) one of these is
const LBF = 4.4482216152605;            // N per pound-force
const LBF_IN = LBF * 0.0254;            // N·m per lb·in
export const FORCE_UNITS = {
  N: { key: 'N', label: 'N', name: 'Newtons (N)', f: 1 },
  kN: { key: 'kN', label: 'kN', name: 'Kilonewtons (kN)', f: 1000 },
  lbf: { key: 'lbf', label: 'lb', name: 'Pounds-force (lb)', f: LBF },
};
export const TORQUE_UNITS = {
  Nm: { key: 'Nm', label: 'N·m', name: 'Newton-metres (N·m)', f: 1 },
  Nmm: { key: 'Nmm', label: 'N·mm', name: 'Newton-millimetres (N·mm)', f: 0.001 },
  lbin: { key: 'lbin', label: 'lb·in', name: 'Pound-inches (lb·in)', f: LBF_IN },
  lbft: { key: 'lbft', label: 'lb·ft', name: 'Pound-feet (lb·ft)', f: LBF * 0.3048 },
};
export const MASS_UNITS = {
  kg: { key: 'kg', label: 'kg', name: 'Kilograms (kg)', f: 1 },
  g: { key: 'g', label: 'g', name: 'Grams (g)', f: 0.001 },
  blob: { key: 'blob', label: 'blob', name: 'Blobs (lb·s²/in)', f: LBF / 0.0254 },
  slug: { key: 'slug', label: 'slug', name: 'Slugs (lb·s²/ft)', f: LBF / 0.3048 },
  lbm: { key: 'lbm', label: 'lbm', name: 'Pounds-mass (lbm)', f: 0.45359237 },
};
export const INERTIA_UNITS = {
  kgm2: { key: 'kgm2', label: 'kg·m²', name: 'kg·m²', f: 1 },
  kgmm2: { key: 'kgmm2', label: 'kg·mm²', name: 'kg·mm²', f: 1e-6 },
  lbins2: { key: 'lbins2', label: 'lb·in·s²', name: 'lb·in·s² (blob·in²)', f: LBF_IN },
  slugft2: { key: 'slugft2', label: 'slug·ft²', name: 'slug·ft² (lb·ft·s²)', f: LBF * 0.3048 },
  lbmin2: { key: 'lbmin2', label: 'lbm·in²', name: 'lbm·in²', f: 0.45359237 * 0.0254 * 0.0254 },
};

/** Whole sets of units, chosen in one go. */
export const UNIT_PRESETS = {
  'si-mm': { name: 'SI, millimetres (mm, N, N·m, kg)', short: 'SI (mm)', length: 'mm', force: 'N', torque: 'Nm', mass: 'kg', inertia: 'kgm2' },
  'si-m': { name: 'SI, metres (m, N, N·m, kg)', short: 'SI (m)', length: 'm', force: 'N', torque: 'Nm', mass: 'kg', inertia: 'kgm2' },
  'us-in': { name: 'US, inches (in, lb, lb·in, blob)', short: 'US (in)', length: 'in', force: 'lbf', torque: 'lbin', mass: 'blob', inertia: 'lbins2' },
  'us-ft': { name: 'US, feet (ft, lb, lb·ft, slug)', short: 'US (ft)', length: 'ft', force: 'lbf', torque: 'lbft', mass: 'slug', inertia: 'slugft2' },
};

export const DEFAULT_UNITS = { length: 'mm', grid: 0, force: 'N', torque: 'Nm', mass: 'kg', inertia: 'kgm2' };

/** The preset the document's units match, or 'custom'. */
export function presetOf(doc) {
  const u = { ...DEFAULT_UNITS, ...((doc && doc.units) || {}) };
  for (const [k, p] of Object.entries(UNIT_PRESETS)) {
    if (['length', 'force', 'torque', 'mass', 'inertia'].every((q) => p[q] === u[q])) return k;
  }
  return 'custom';
}

/** Helpers for one physical quantity: show(stored) → shown number, si(shown) → stored. */
function quantity(table, key, fallback) {
  const q = table[key] || table[fallback];
  return { ...q, show: (v) => v / q.f, si: (v) => v * q.f };
}

/**
 * Helpers for the document's units:
 *   u.label      'mm' …            u.vel / u.acc   'mm/s', 'mm/s²'
 *   u.len(mm)    → number in the unit       u.mm(v) → millimetres
 *   u.fmt(mm, d) → "12.50 mm"               u.num(mm, d) → "12.50"
 *   u.F, u.T, u.M, u.I   force, torque, mass, moment of inertia:
 *                { label, show(stored) → shown, si(shown) → stored }
 *   u.E          energy (shown in the torque's unit; N·m is called J)
 */
export function unitsOf(doc) {
  const units = (doc && doc.units) || {};
  const key = units.length || 'mm';
  const u = LENGTH_UNITS[key] || LENGTH_UNITS.mm;
  const len = (mm) => mm / u.f;
  const num = (mm, d = u.digits) => fmt(len(mm), d);
  const T = quantity(TORQUE_UNITS, units.torque, 'Nm');
  return {
    ...u,
    vel: `${u.label}/s`,
    acc: `${u.label}/s²`,
    len,
    mm: (v) => v * u.f,
    num,
    fmt: (mm, d = u.digits) => `${num(mm, d)} ${u.label}`,
    F: quantity(FORCE_UNITS, units.force, 'N'),
    T,
    M: quantity(MASS_UNITS, units.mass, 'kg'),
    I: quantity(INERTIA_UNITS, units.inertia, 'kgm2'),
    E: { ...T, label: T.key === 'Nm' ? 'J' : T.label },
  };
}

/** Grid spacing in mm: the minor spacing chosen (or automatic) and its major lines. */
export function gridSpacing(doc) {
  const u = unitsOf(doc);
  const g = doc && doc.units && doc.units.grid > 0 ? doc.units.grid : 0;
  const minor = (g || u.auto) * u.f;
  const major = minor * (u.key === 'in' ? 4 : 5);
  return { minor, major, fixed: !!g };
}

/** A grid spacing written nicely in the unit (fractions of an inch as ¹⁄₁₆ …). */
export function gridLabel(u, v) {
  if (u.key === 'in' && v < 1) {
    const frac = { 0.0625: '1/16', 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' }[v];
    if (frac) return `${frac} in`;
  }
  return `${+v.toPrecision(4)} ${u.label}`;
}
