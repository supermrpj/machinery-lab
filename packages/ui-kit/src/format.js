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
  if (Math.abs(v) < 1e-9) return '0'; // round-off noise around zero
  const mag = Math.floor(Math.log10(Math.abs(v)));
  const digits = Math.max(0, Math.min(6, sig - 1 - mag));
  return fmt(v, digits);
}

export const fmtDeg = (rad, digits = 2) => (rad === null || rad === undefined ? '—' : fmt((rad * 180) / Math.PI, digits) + '°');

/** Parse a user-typed number; accepts "," as decimal separator. Null if invalid. */
export function parseNum(text) {
  const v = Number(String(text).trim().replace(',', '.').replace('−', '-'));
  return Number.isFinite(v) ? v : null;
}
