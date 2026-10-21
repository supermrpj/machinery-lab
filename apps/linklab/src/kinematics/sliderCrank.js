// =============================================================================
// sliderCrank.js — closed-form analysis of the offset slider-crank
// (Norton Ch. 4, 6, 7)
// -----------------------------------------------------------------------------
// Notation: a = crank (link 2), b = coupler / connecting rod (3),
// c = offset of the slider axis from the crank pivot, d = slider position
// measured from the crank pivot along the slider axis. Angles are measured
// from the LOCAL x axis, which is parallel to the slider axis.
// =============================================================================

/** Position: both assemblies. Returns null if the rod is too short. */
export function sliderCrankPosition(a, b, c, theta2) {
  const s = (a * Math.sin(theta2) - c) / b;
  if (Math.abs(s) > 1 + 1e-12) return null;
  const t31 = Math.asin(Math.max(-1, Math.min(1, s)));
  const t32 = Math.PI - t31; // Norton: θ3₂ = asin(−(a sinθ2 − c)/b) + π
  const d = (t3) => a * Math.cos(theta2) - b * Math.cos(t3);
  return { open: { theta3: t31, d: d(t31) }, crossed: { theta3: t32, d: d(t32) } };
}

/** Velocity: ω3 and slider velocity ḋ. */
export function sliderCrankVelocity(a, b, theta2, theta3, omega2) {
  const omega3 = (a * omega2 * Math.cos(theta2)) / (b * Math.cos(theta3));
  const vd = -a * omega2 * Math.sin(theta2) + b * omega3 * Math.sin(theta3);
  return { omega3, vd };
}

/** Acceleration: α3 and slider acceleration d̈. */
export function sliderCrankAcceleration(a, b, theta2, theta3, omega2, omega3, alpha2 = 0) {
  const alpha3 = (a * alpha2 * Math.cos(theta2) - a * omega2 * omega2 * Math.sin(theta2)
               + b * omega3 * omega3 * Math.sin(theta3)) / (b * Math.cos(theta3));
  const ad = -a * alpha2 * Math.sin(theta2) - a * omega2 * omega2 * Math.cos(theta2)
           + b * alpha3 * Math.sin(theta3) + b * omega3 * omega3 * Math.cos(theta3);
  return { alpha3, ad };
}
