// =============================================================================
// vec2.js — small 2-D vector helpers
// -----------------------------------------------------------------------------
// Points and vectors are plain objects {x, y}. Every function returns a NEW
// object and never modifies its arguments, so they are safe to use anywhere.
// =============================================================================

export const vec = (x = 0, y = 0) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;

/** 2-D cross product (z-component of a × b). */
export const cross = (a, b) => a.x * b.y - a.y * b.x;

export const length = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Angle of vector a, measured counter-clockwise from +x (radians, -π..π). */
export const angle = (a) => Math.atan2(a.y, a.x);

/** Unit vector in the direction of a (returns {0,0} for a zero vector). */
export function normalize(a) {
  const L = Math.hypot(a.x, a.y);
  return L > 0 ? { x: a.x / L, y: a.y / L } : { x: 0, y: 0 };
}

/** Rotate vector a by angle t (radians, counter-clockwise). */
export function rotate(a, t) {
  const c = Math.cos(t), s = Math.sin(t);
  return { x: c * a.x - s * a.y, y: s * a.x + c * a.y };
}

/** Rotate by +90° (counter-clockwise). */
export const perp = (a) => ({ x: -a.y, y: a.x });

export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const polar = (r, t) => ({ x: r * Math.cos(t), y: r * Math.sin(t) });
