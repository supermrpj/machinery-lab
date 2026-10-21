// =============================================================================
// fourbar.js — closed-form analysis of the pin-jointed fourbar (Norton Ch. 4, 6, 7)
// (Equation numbers differ between editions, so chapters are cited.)
// -----------------------------------------------------------------------------
// Notation follows Norton, "Design of Machinery":
//   a = input crank (link 2), b = coupler (3), c = output rocker (4),
//   d = ground (1). Angles are measured counter-clockwise from the ground
//   link (LOCAL x axis along O2 → O4).
// These formulas are used to show the textbook method beside the general
// solver, and to cross-check the solver in the tests.
// =============================================================================

/** Freudenstein's K constants (Norton Ch. 4). */
export function kConstants(a, b, c, d) {
  return {
    K1: d / a,
    K2: d / c,
    K3: (a * a - b * b + c * c + d * d) / (2 * a * c),
    K4: d / b,
    K5: (c * c - d * d - a * a - b * b) / (2 * a * b),
  };
}

/**
 * Position analysis. θ2 in radians (local). Returns both assemblies:
 *   open    (θ4 with the − root, Norton's θ4₁)
 *   crossed (θ4 with the + root, Norton's θ4₂)
 * Returns null if the linkage cannot be assembled at this θ2.
 */
export function fourbarPosition(a, b, c, d, theta2) {
  const { K1, K2, K3, K4, K5 } = kConstants(a, b, c, d);
  const c2 = Math.cos(theta2), s2 = Math.sin(theta2);
  const A = c2 - K1 - K2 * c2 + K3;
  const B = -2 * s2;
  const C = K1 - (K2 + 1) * c2 + K3;
  const D = c2 - K1 + K4 * c2 + K5;
  const E = -2 * s2;
  const F = K1 + (K4 - 1) * c2 + K5;
  const disc4 = B * B - 4 * A * C;
  const disc3 = E * E - 4 * D * F;
  if (disc4 < -1e-12 || disc3 < -1e-12) return null;
  const r4 = Math.sqrt(Math.max(disc4, 0));
  const r3 = Math.sqrt(Math.max(disc3, 0));
  return {
    K: { K1, K2, K3, K4, K5 }, A, B, C, D, E, F,
    open:    { theta3: 2 * Math.atan2(-E - r3, 2 * D), theta4: 2 * Math.atan2(-B - r4, 2 * A) },
    crossed: { theta3: 2 * Math.atan2(-E + r3, 2 * D), theta4: 2 * Math.atan2(-B + r4, 2 * A) },
  };
}

/** Velocity analysis (Norton Ch. 6). */
export function fourbarVelocity(a, b, c, theta2, theta3, theta4, omega2) {
  const omega3 = (a * omega2 / b) * Math.sin(theta4 - theta2) / Math.sin(theta3 - theta4);
  const omega4 = (a * omega2 / c) * Math.sin(theta2 - theta3) / Math.sin(theta4 - theta3);
  return { omega3, omega4 };
}

/** Acceleration analysis (Norton Ch. 7). */
export function fourbarAcceleration(a, b, c, theta2, theta3, theta4, omega2, omega3, omega4, alpha2 = 0) {
  const A = c * Math.sin(theta4);
  const B = b * Math.sin(theta3);
  const C = a * alpha2 * Math.sin(theta2) + a * omega2 * omega2 * Math.cos(theta2)
          + b * omega3 * omega3 * Math.cos(theta3) - c * omega4 * omega4 * Math.cos(theta4);
  const D = c * Math.cos(theta4);
  const E = b * Math.cos(theta3);
  const F = a * alpha2 * Math.cos(theta2) - a * omega2 * omega2 * Math.sin(theta2)
          - b * omega3 * omega3 * Math.sin(theta3) + c * omega4 * omega4 * Math.sin(theta4);
  const den = A * E - B * D;
  return { alpha3: (C * D - A * F) / den, alpha4: (C * E - B * F) / den };
}

/** Transmission angle μ (0…90°), Norton Ch. 4. */
export function transmissionAngle(theta3, theta4) {
  let mu = Math.abs(theta3 - theta4) % (2 * Math.PI);
  if (mu > Math.PI) mu = 2 * Math.PI - mu;
  if (mu > Math.PI / 2) mu = Math.PI - mu;
  return mu;
}

/**
 * Grashof condition (Norton Ch. 2): S + L vs P + Q, and the motion type
 * depending on which link is shortest.
 *   lengths: { a (input), b (coupler), c (output), d (ground) }
 */
export function grashof({ a, b, c, d }) {
  const named = [['ground', d], ['input', a], ['coupler', b], ['output', c]];
  const sorted = [...named].sort((x, y) => x[1] - y[1]);
  const S = sorted[0][1], L = sorted[3][1];
  const P = sorted[1][1], Q = sorted[2][1];
  const lhs = S + L, rhs = P + Q;
  const tol = 1e-9 * (lhs + rhs);
  const shortest = sorted[0][0];
  let condition, type;
  if (Math.abs(lhs - rhs) <= tol) {
    condition = 'special';
    type = 'Special-case Grashof (change point): can fold into a flat position';
  } else if (lhs < rhs) {
    condition = 'grashof';
    type = {
      ground: 'Grashof double-crank (drag link)',
      input: 'Grashof crank-rocker (input makes full turns)',
      output: 'Grashof rocker-crank (output makes full turns, input rocks)',
      coupler: 'Grashof double-rocker (coupler makes full turns)',
    }[shortest];
  } else {
    condition = 'non-grashof';
    type = 'Non-Grashof triple-rocker (no link makes a full turn)';
  }
  return { S, L, P, Q, lhs, rhs, condition, shortest, type, inputFullTurn: condition === 'grashof' && (shortest === 'input' || shortest === 'ground') };
}

/**
 * Toggle (limit) positions of the input for a non-crank input: the input
 * angles where links 3 and 4 become collinear (Norton Ch. 4).
 * Returns local θ2 values (radians) or [] if the input can turn fully.
 */
export function toggleAngles(a, b, c, d) {
  const out = [];
  for (const sgn of [1, -1]) {
    // b and c collinear: distance from A to O4 equals b ± c
    const e = b + sgn * c;
    const cosT = (a * a + d * d - e * e) / (2 * a * d);
    if (cosT >= -1 && cosT <= 1) {
      const t = Math.acos(cosT);
      out.push(t, -t);
    }
  }
  return out;
}
