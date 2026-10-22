// =============================================================================
// numbers.js — how CamLab shows a computed value, the same everywhere
// -----------------------------------------------------------------------------
// The results tables, the plot title bars, the cam's readout and the bar at
// the bottom all use showNum(v, scale). One rule:
//   - 4 significant figures, with the minus sign "−"       (7.620, 33.93, 2513)
//   - whole numbers from 10⁴ up to 10⁵ stay whole            (63165, 96000)
//   - from 10⁵ on: 4 significant figures × 10ⁿ, n a multiple of 3
//                                                         (814301 → 814.3×10³)
//   - a reading given with a scale (the size of the quantity over the turn)
//     reads 0 when it is below what the scale shows at 4 significant figures:
//     round-off, not a value (scale 2513: −6.156e-13 → 0, 0.4 → 0, 0.6 → 0.6000)
// =============================================================================

import { fmtSig } from '../../../../packages/ui-kit/src/format.js';

// ---- CONFIG -------------------------------------------------------------------
const SIG = 4;            // significant figures
const BIG = 1e5;          // from this size on: mantissa × 10ⁿ (n a multiple of 3)
// -------------------------------------------------------------------------------

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/** A computed value as text; scale: the largest size of this quantity (0 = none known). */
export function showNum(v, scale = 0) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const sc = Math.abs(scale || 0);
  // below the last figure the scale shows: round-off
  if (sc > 0 && Number.isFinite(sc) && a < 0.5 * 10 ** (Math.floor(Math.log10(sc)) - (SIG - 1))) return '0';
  if (+a.toPrecision(SIG) >= BIG) { // as rounded: 99 999.9 is 100.0×10³
    let n = 3 * Math.floor(Math.log10(a) / 3);
    // rounding can carry the mantissa to 1000 (999 950 → 1000×10³): move up one step
    if (+(a / 10 ** n).toPrecision(SIG) >= 1000) n += 3;
    return `${fmtSig(+(v / 10 ** n).toPrecision(SIG), SIG)}×10${String(n).split('').map((c) => SUP[c]).join('')}`;
  }
  return fmtSig(v, SIG);
}

/** The largest |value| of key k over a list of rows (the scale for showNum). */
export function scaleOf(rows, k) {
  let m = 0;
  for (const r of rows) { const v = Math.abs(r[k]); if (Number.isFinite(v) && v > m) m = v; }
  return m;
}
