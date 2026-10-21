// =============================================================================
// angles.js — angle conversion and wrapping
// =============================================================================

export const DEG = Math.PI / 180;
export const TWO_PI = 2 * Math.PI;

export const toRad = (deg) => deg * DEG;
export const toDeg = (rad) => rad / DEG;

/** Wrap an angle into the range [0, 2π). */
export function wrap2Pi(t) {
  const r = t % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/** Wrap an angle into the range (-π, π]. */
export function wrapPi(t) {
  let r = wrap2Pi(t);
  if (r > Math.PI) r -= TWO_PI;
  return r;
}

/** Smallest signed difference a − b, in (-π, π]. */
export const angleDiff = (a, b) => wrapPi(a - b);

/**
 * Given a new angle that may have jumped by ±2π, return the equivalent
 * angle closest to `previous`. Keeps plotted angles continuous.
 */
export function unwrapNear(angle, previous) {
  return previous + angleDiff(angle, previous);
}
