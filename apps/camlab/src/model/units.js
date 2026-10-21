// =============================================================================
// units.js — what is shown and typed; everything is stored in mm, N, kg, s
// -----------------------------------------------------------------------------
// Two systems, as in the textbook examples:
//   si  mm, N, kg, N/mm, N·m
//   us  in, lb, blob (lb·s²/in), lb/in, lb·in
// =============================================================================

const IN = 25.4;
const LBF = 4.4482216152605;
const BLOB = LBF / 0.0254;

export const UNIT_SYSTEMS = {
  si: { key: 'si', name: 'SI (mm, N, kg)', len: 'mm', lenF: 1, force: 'N', forceF: 1, mass: 'kg', massF: 1, rate: 'N/mm', rateF: 1, torque: 'N·m', torqueF: 1, damping: 'N·s/mm', dampF: 1 },
  us: { key: 'us', name: 'US (in, lb, blob)', len: 'in', lenF: IN, force: 'lb', forceF: LBF, mass: 'blob', massF: BLOB, rate: 'lb/in', rateF: LBF / IN, torque: 'lb·in', torqueF: LBF * IN / 1000, damping: 'lb·s/in', dampF: LBF / IN },
};

/**
 * Helpers for the document's units: show(x) turns a stored value into the
 * shown unit; store(x) turns a typed value into the stored one.
 */
export function unitsOf(doc) {
  const u = UNIT_SYSTEMS[(doc && doc.units) || 'si'] || UNIT_SYSTEMS.si;
  const q = (label, f) => ({ label, show: (v) => v / f, store: (v) => v * f });
  return {
    key: u.key,
    L: q(u.len, u.lenF),                       // length
    V: q(`${u.len}/s`, u.lenF),                // velocity
    A: q(`${u.len}/s²`, u.lenF),               // acceleration
    J: q(`${u.len}/s³`, u.lenF),               // jerk
    F: q(u.force, u.forceF),                   // force
    M: q(u.mass, u.massF),                     // mass
    K: q(u.rate, u.rateF),                     // spring rate
    C: q(u.damping, u.dampF),                  // damping
    T: q(u.torque, u.torqueF),                 // torque (stored in N·m)
    digits: u.key === 'us' ? 4 : 2,
  };
}
