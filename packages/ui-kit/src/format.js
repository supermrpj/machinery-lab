// =============================================================================
// format.js — number formatting for engineering read-outs
// =============================================================================

/** Fixed decimals, with a proper minus sign and "—" for missing values. */
export function fmt(v, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = Math.abs(v) < 0.5 * 10 ** -digits ? (0).toFixed(digits) : v.toFixed(digits);
  return s.replace('-', '−');
}

/** Significant-figure formatting for values that vary widely in size. */
export function fmtSig(v, sig = 4) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a < 1e-9) return '0'; // round-off noise around zero
  // very small or very large: a power of ten, e.g. 2.000×10⁻⁷ or −2.117×10²²
  if (a < 1e-3 || a >= 1e9) {
    const [m, e] = v.toExponential(sig - 1).split('e');
    const sup = String(+e).replace(/[-0-9]/g, (c) => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)]);
    return `${m.replace('-', '−')}×10${sup}`;
  }
  // the digits after rounding (9.99996 rounds to 10.00, not 10.000)
  const mag = Math.floor(Math.log10(Number(a.toPrecision(sig))));
  const digits = Math.max(0, Math.min(6, sig - 1 - mag));
  return fmt(v, digits);
}

export const fmtDeg = (rad, digits = 2) => (rad === null || rad === undefined ? '—' : fmt((rad * 180) / Math.PI, digits) + '°');

/** Parse a user-typed number; accepts "," as decimal separator. Null if invalid. */
export function parseNum(text) {
  const v = Number(String(text).trim().replace(',', '.').replace('−', '-'));
  return Number.isFinite(v) ? v : null;
}
