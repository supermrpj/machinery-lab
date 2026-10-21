// =============================================================================
// geometry.js — cam shape for a translating follower
// -----------------------------------------------------------------------------
// Frames:
//   fixed frame   cam centre at the origin, the follower moves along +y
//                 (its axis is offset by the eccentricity ε along x)
//   cam frame     fixed to the cam; at cam angle θ it is the fixed frame
//                 turned by α = dir·θ (dir = +1 counter-clockwise, −1 clockwise)
// Roller follower (radius Rf): the roller centre traces the PITCH CURVE; the
// cam surface lies Rf inside it along the normal. Prime circle Rp is the
// smallest pitch-curve radius (s = 0); base circle Rb = Rp − Rf.
// Flat-faced follower: the face is perpendicular to the axis at height
// Rb + s; it touches the cam |ds/dθ| from the axis.
//
// Everything is exact from s, ds/dθ, d²s/dθ² (no numerical differencing).
// Lengths in mm, angles in radians unless named …Deg.
// =============================================================================

const rot = (p, t) => ({ x: p.x * Math.cos(t) - p.y * Math.sin(t), y: p.x * Math.sin(t) + p.y * Math.cos(t) });

/**
 * Cam geometry at one cam angle. `follower`:
 *   { type: 'roller' | 'flat', Rp (roller: prime circle), Rb (flat: base circle),
 *     Rf (roller radius), e (eccentricity), dir (+1 ccw, −1 cw) }
 * `m` = { s, v, a } with v = ds/dθ, a = d²s/dθ².
 * Returns { pitch, surface (cam frame), pitchFixed, contactFixed (fixed frame),
 *   phi (pressure angle, rad), rhoPitch, rhoCam (signed: + convex), arm (flat:
 *   contact distance from the axis) }.
 */
export function camPoint(follower, m, theta) {
  const dir = follower.dir === -1 ? -1 : 1;
  const alpha = dir * theta;
  const back = -alpha; // fixed frame → cam frame
  if (follower.type === 'flat') {
    const Rb = follower.Rb;
    const y = Rb + m.s, x = dir * m.v; // contact point in the fixed frame
    const contactFixed = { x, y };
    const rho = Rb + m.s + m.a;
    return {
      pitch: null, pitchFixed: null,
      surface: rot(contactFixed, back), contactFixed,
      phi: 0, rhoPitch: null, rhoCam: rho, arm: x,
      followerFixed: { x: follower.e || 0, y },
    };
  }
  const Rp = follower.Rp, e = follower.e || 0, Rf = follower.Rf || 0;
  const d = Math.sqrt(Math.max(0, Rp * Rp - e * e));
  const Pf = { x: e, y: d + m.s }; // roller centre, fixed frame
  // derivatives of the pitch point in the cam frame (rotated back to fixed axes):
  //   T = dP/dθ, N2 = d²P/dθ²   (both expressed in fixed-frame axes at this θ)
  const J = (p) => ({ x: -p.y, y: p.x });
  const Q = { x: 0 - dir * J(Pf).x, y: m.v - dir * J(Pf).y };          // (0, v) − dir·J·P
  const dQ = { x: 0 - dir * J({ x: 0, y: m.v }).x, y: m.a - dir * J({ x: 0, y: m.v }).y };
  const T = Q;
  const T2 = { x: -dir * J(Q).x + dQ.x, y: -dir * J(Q).y + dQ.y };
  const speed = Math.hypot(T.x, T.y);
  const cross = T.x * T2.y - T.y * T2.x;
  // outward normal (away from the cam centre), fixed-frame axes
  let n = { x: T.y / speed, y: -T.x / speed };
  if (n.x * Pf.x + n.y * Pf.y < 0) n = { x: -n.x, y: -n.y };
  // signed curvature radius: + where the curve bends round the cam centre (convex)
  const sense = Math.sign(T.x * Pf.y - T.y * Pf.x) || 1; // which way the curve runs round the centre
  const rhoPitch = cross !== 0 ? (speed ** 3 / cross) * -sense : Infinity;
  const contactFixed = { x: Pf.x - Rf * n.x, y: Pf.y - Rf * n.y };
  // pressure angle: between the common normal and the follower's motion,
  // positive on a rise (checked against the normal above)
  const phi = Math.atan((m.v - dir * e) / (d + m.s));
  return {
    pitch: rot(Pf, back), surface: rot(contactFixed, back),
    pitchFixed: Pf, contactFixed, followerFixed: Pf,
    phi, rhoPitch, rhoCam: rhoPitch - Rf, arm: null, normalFixed: n,
  };
}

/**
 * The whole cam: samples of the program (program.js sample()) → curves and
 * the checks. Returns { pitch: [pts], surface: [pts], rows: [{ deg, phi,
 * rhoPitch, rhoCam, arm }], phiMax, phiMin, rhoMin (convex part), rhoConcaveMin,
 * undercut, faceWidth (flat), arm range }.
 */
export function camShape(follower, samples) {
  const pitch = [], surface = [], rows = [];
  for (const sm of samples) {
    const g = camPoint(follower, sm, (sm.deg * Math.PI) / 180);
    if (g.pitch) pitch.push(g.pitch);
    surface.push(g.surface);
    rows.push({ deg: sm.deg, phi: g.phi, rhoPitch: g.rhoPitch, rhoCam: g.rhoCam, arm: g.arm, segment: sm.segment });
  }
  const finite = (v) => Number.isFinite(v);
  const phis = rows.map((r) => r.phi);
  const res = { pitch, surface, rows };
  res.phiMax = Math.max(...phis); res.phiMin = Math.min(...phis);
  if (follower.type === 'flat') {
    const rh = rows.map((r) => r.rhoCam).filter(finite);
    res.rhoMin = Math.min(...rh);
    res.undercut = res.rhoMin <= 0; // a flat face needs ρ > 0 everywhere
    const arms = rows.map((r) => r.arm);
    res.armMin = Math.min(...arms); res.armMax = Math.max(...arms);
    res.faceWidth = res.armMax - res.armMin;
  } else {
    const conv = rows.map((r) => r.rhoPitch).filter((v) => finite(v) && v > 0);
    const conc = rows.map((r) => r.rhoPitch).filter((v) => finite(v) && v < 0);
    res.rhoPitchMin = conv.length ? Math.min(...conv) : Infinity;            // smallest convex radius of the pitch curve
    res.rhoConcaveMin = conc.length ? -Math.max(...conc) : Infinity;         // smallest concave radius (magnitude)
    res.rhoMin = res.rhoPitchMin - (follower.Rf || 0);                       // cam surface, convex part
    // undercut (convex): the roller is bigger than the pitch curve's radius there
    res.undercut = res.rhoPitchMin <= (follower.Rf || 0);
  }
  return res;
}
