// =============================================================================
// tolerance.js — how far a point wanders when the parts are not perfect
// -----------------------------------------------------------------------------
// Two kinds of error, typical of 3D-printed and other quickly made parts:
//   pin play        the hole is larger than its pin (clearance c = hole Ø − pin Ø).
//                   The pin may sit anywhere in the hole; when loaded it touches
//                   the wall, so the centres are c/2 apart in some direction.
//   hole position   each pin hole is drilled or printed a little off, anywhere
//                   in a circle of radius t around its drawn position (a link
//                   length error of up to ±2t, fixed for one build).
//
// METHOD (Monte Carlo)
// Each "build" draws its own hole errors (fixed for that build). Then, at each
// input position of the cycle, every pin gets a random contact direction and
// the mechanism is solved at the same input value, starting from the ideal
// pose. The deviation of each checked point from its ideal position is
// recorded:
//   largest deviation      max |P − P₀| over all builds and input positions
//   RMS deviation          root mean square of |P − P₀|
//   random band            at each input position, the furthest the point went
//                          to each side of the ideal path (along its normal)
// A build that cannot be put together at some input position (the error is
// too large there, usually near a limit position) is counted, and that
// position is skipped for that build.
//
// WORST CASE (linear, also used for the band on the drawing)
// For small errors the deviation is linear in them. Each error source s (the
// play of one pin, radius c/2; one hole, radius t) is a vector u_s in a disc of
// radius r_s. It changes the constraint equations by δΦ, so the pose changes by
//   J δq = −δΦ        (J with the input row, the input held)
// and the point by δP = P_q δq = M_s u_s (M_s is 2×2). The furthest the point
// can go in a direction d is  Σ r_s |M_sᵀ d|  (every error at its worst):
//   along the path normal n → the half-width of the worst-case band (drawn
//                             on the canvas as a shaded ribbon),
//   over all directions d   → the worst-case deviation at that position.
//
// UNDER THE LOAD (needs the force analysis: Forces › Static or Dynamic)
// A loaded pin is pushed against one side of its hole: the side away from the
// push. With F the force on link i from link j at the pin, the gap is
//   u = P_i − P_j = −(c/2) F/|F|
// so the actual error is δ = Σ M_s u_s. (Virtual work gives a check: under
// one load P alone, the point it acts on gives way along P by exactly the
// worst case along P, and P·δ = Σ (c/2)|F_s|.)
//
// KNOCKS
// Where a pin's force passes near zero and comes back pointing the other way,
// the pin crosses its hole: the output jumps and the pin hits the far wall.
// A knock is reported where that happens (one or more pins at once) and the
// output jumps by at least TOLERANCE.knock.minJump of its play.
//
// WHAT IS CHECKED (the target)
//   angle   a link's angle (the output link), rad
//   along   a point's move along a fixed direction (a slider on a fixed rail,
//           or the x or y of a point), mm
//   point   a point's move in any direction, mm
//
// Clearances may differ from pin to pin: { value, pins: { jointId: c } }.
// Only pins (revolute joints) are studied; sliders and gears are taken as exact.
// =============================================================================

import { buildSystem, pointOnBody, evaluate } from '../kinematics/system.js';
import { linksAtJoint, isFrameLink } from './document.js';
import { solvePosition, solveDetermined, lengthScale } from '../kinematics/solver.js';
import { inverseDynamics } from '../kinematics/dynamics.js';
import { TOLERANCE } from '../config.js';

// ---- a small seeded random number generator (results repeat for one seed) ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random point in a disc of radius r (uniform over the area). */
function inDisc(rand, r) {
  const a = 2 * Math.PI * rand(), d = r * Math.sqrt(rand());
  return { x: d * Math.cos(a), y: d * Math.sin(a) };
}

/** A random point on a circle of radius r. */
function onCircle(rand, r) {
  const a = 2 * Math.PI * rand();
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

/**
 * The clearance of each pin as a function of its joint: a number (every pin
 * the same), { value, pins: { jointId: c } } (some pins different), or a function.
 */
export function clearanceFn(c) {
  if (typeof c === 'function') return c;
  if (c && typeof c === 'object') {
    const v = Math.max(0, +c.value || 0), pins = c.pins || {};
    return (joint) => (Number.isFinite(pins[joint]) ? Math.max(0, pins[joint]) : v);
  }
  const v = Math.max(0, +c || 0);
  return () => v;
}
/** A short text that changes when any clearance changes (for caches). */
const clearanceKey = (c) => (c && typeof c === 'object' ? JSON.stringify(c) : String(c));

/**
 * The error sources at one pose of the ideal mechanism, each with the change
 * of pose it causes (the input held): J δq = −δΦ for a unit error along x and
 * along y. A source is the play of one pin (radius c/2: the pin's centre may
 * sit anywhere within c/2 of the hole's) or the position error of one hole
 * (radius t). Returns null at a position where J is singular (a toggle), or
 * so close to one that the linear answer does not hold (see linearHolds).
 *   [{ kind: 'pin' | 'hole', joint, i, j, r, rows, at, resp: [δq_x, δq_y] }]
 */
function sourcesAt(sys, q, theta, clearance, holePosition) {
  const cOf = clearanceFn(clearance);
  const { J } = evaluate(sys, q, theta, true);
  const nRows = J.length;
  // row offset of each pin constraint (a frame link has none: it is held by
  // one fixed constraint, see system.js)
  const pins = [];
  let row = 0;
  for (const c of sys.constraints) { if (c.info && c.info.kind === 'pin') pins.push({ c, row }); row += c.rows; }
  const sources = [];
  // pin play: Φ = P_i − P_j − gap, so a gap u changes Φ by −u
  for (const p of pins) {
    const { joint, i, j } = p.c.info, c = cOf(joint);
    if (c > 0) sources.push({ kind: 'pin', joint, i, j, r: c / 2, rows: [{ row: p.row, sign: -1 }], at: null });
  }
  if (holePosition > 0) {
    const holes = new Map(); // `${joint}|${body}` → source
    const hole = (joint, body) => {
      const key = joint + '|' + body;
      if (!holes.has(key)) { const src = { kind: 'hole', joint, i: body, j: null, r: holePosition, rows: [], at: { joint, body } }; holes.set(key, src); sources.push(src); }
      return holes.get(key);
    };
    // a hole on body i moves P_i by u (Φ = P_i − P_j gains +u); on body j, −u; the frame's hole moves G
    for (const p of pins) {
      const { joint, i, j } = p.c.info;
      hole(joint, i).rows.push({ row: p.row, sign: 1 });
      hole(joint, j).rows.push({ row: p.row, sign: -1 });
    }
  }
  for (const src of sources) {
    src.resp = [0, 1].map((axis) => {
      const rhs = new Array(nRows).fill(0);
      for (const { row: r, sign } of src.rows) rhs[r + axis] -= sign; // J δq = −δΦ
      return solveDetermined(J, rhs);
    });
    if (src.resp.some((x) => !x)) return null;
  }
  if (!linearHolds(sys, q, theta, sources, pins)) return null;
  return sources;
}

/**
 * Near a limit (dead-centre) position the linear answer breaks down: J is
 * nearly singular, so J δq = −δΦ predicts a huge move, while the real
 * mechanism moves far less (or cannot be put together at this input). So
 * each source is also applied with the full equations, along x and along y,
 * at the size of all the errors together (Σ r: in the worst case they add up),
 * and the pose change is compared with the linear one. If any
 * differs by more than TOLERANCE.linearCheck, or the mechanism cannot be
 * assembled, the linear answer is not used at this position.
 */
function linearHolds(sys, q, theta, sources, pins) {
  const byRow = new Map(pins.map((p) => [p.row, p.c]));
  const saved = pins.map((p) => p.c.gap);
  const L = lengthScale(sys);   // turns angle changes into lengths for the comparison
  const nb = q.length / 3;
  const rAll = sources.reduce((sum, src) => sum + src.r, 0);
  try {
    for (const src of sources) {
      for (const axis of [0, 1]) {
        const u = axis ? { x: 0, y: rAll } : { x: rAll, y: 0 };
        // Φ = P_i − P_j − gap, so a change δΦ = sign·u is a gap of −sign·u
        for (const p of pins) p.c.gap = { x: 0, y: 0 };
        for (const { row, sign } of src.rows) {
          const c = byRow.get(row);
          c.gap = { x: c.gap.x - sign * u.x, y: c.gap.y - sign * u.y };
        }
        const sol = solvePosition(sys, q, theta);
        if (!sol.ok) return false;
        let diff = 0, size = 0;
        for (let b = 0; b < nb; b++) {
          for (let k = 0; k < 3; k++) {
            const w = k === 2 ? L : 1;
            const lin = rAll * src.resp[axis][3 * b + k] * w;
            const full = (sol.q[3 * b + k] - q[3 * b + k]) * w;
            diff = Math.max(diff, Math.abs(full - lin));
            size = Math.max(size, Math.abs(lin));
          }
        }
        if (size > 1e-12 && diff > TOLERANCE.linearCheck * size) return false;
      }
    }
    return true;
  } finally {
    pins.forEach((p, k) => { p.c.gap = saved[k]; });
  }
}

/**
 * How each source moves one point w = { id, i, s } (body i, local position s):
 * for each source the 2×2 map M_s (δP = M_s u), as its columns ex, ey.
 */
function pointResponse(q, w, sources) {
  const dP = (dq) => {
    if (w.i < 0) return { x: 0, y: 0 };
    const t = q[3 * w.i + 2], c = Math.cos(t), sn = Math.sin(t);
    const bx = -sn * w.s.x - c * w.s.y, by = c * w.s.x - sn * w.s.y, dphi = dq[3 * w.i + 2];
    return { x: dq[3 * w.i] + bx * dphi, y: dq[3 * w.i + 1] + by * dphi };
  };
  return sources.map((src) => {
    const ex = dP(src.resp[0]), ey = dP(src.resp[1]);
    // the point itself is a hole on this body: it moves with the hole
    if (src.at && src.at.joint === w.id && src.at.body === w.i) { ex.x += 1; ey.y += 1; }
    return { src, ex, ey };
  });
}

/** Σ r_s |M_sᵀ d|: how far the errors can push the point along unit direction d. */
const reachOf = (M, d) => M.reduce((sum, m) => sum + m.src.r * Math.hypot(m.ex.x * d.x + m.ex.y * d.y, m.ey.x * d.x + m.ey.y * d.y), 0);

/** The direction (over half a turn) in which the errors can push the point furthest. */
function worstDirection(M) {
  let best = { d: { x: 1, y: 0 }, reach: -1 };
  for (let a = 0; a < TOLERANCE.worstDirections; a++) {
    const ang = (Math.PI * a) / TOLERANCE.worstDirections; // half a turn is enough: reach(−d) = reach(d)
    const d = { x: Math.cos(ang), y: Math.sin(ang) };
    const r = reachOf(M, d);
    if (r > best.reach) best = { d, reach: r };
  }
  return best;
}

/**
 * Worst-case (linear) deviation of each checked point at one pose.
 * sys is the ideal system; `where` says where each point sits on it.
 * Returns, for each point, { normal, total }: the worst-case distance along
 * the normal n (one side) and in any direction.
 */
function worstCase(sys, q, theta, where, normals, clearance, holePosition) {
  const sources = sourcesAt(sys, q, theta, clearance, holePosition);
  if (!sources) return null;
  return where.map((w, k) => {
    const M = pointResponse(q, w, sources);
    return { normal: reachOf(M, normals[k]), total: worstDirection(M).reach };
  });
}

/**
 * The worst case for one point at one pose, in detail, for the drawing and
 * the panel: every pin pushed against its hole (and every hole off) in the
 * direction that moves the point furthest.
 *   w = { id, i, s }   the point (body i, local position s)
 * Returns null at a toggle position, else
 *   { total, d, dP, dq, parts: [{ kind, joint, i, j, r, u, adds }] }
 *   total  the largest deviation (any direction); d its direction
 *   dP     the point's move; dq the pose change (to draw the mechanism so)
 *   u      how far the pin sits off the hole centre (or the hole off its place)
 *   adds   what this source alone adds to `total` (they add up to it)
 */
export function worstAtPose(sys, q, theta, w, clearance, holePosition) {
  const sources = sourcesAt(sys, q, theta, clearance, holePosition);
  if (!sources || !w || w.i === undefined) return null;
  const M = pointResponse(q, w, sources);
  const { d, reach } = worstDirection(M);
  const dq = new Array(q.length).fill(0);
  const dP = { x: 0, y: 0 };
  const parts = M.map((m) => {
    // M_sᵀ d: the error direction that moves the point most along d
    const g = { x: m.ex.x * d.x + m.ex.y * d.y, y: m.ey.x * d.x + m.ey.y * d.y }, L = Math.hypot(g.x, g.y);
    const u = L > 1e-15 ? { x: (m.src.r * g.x) / L, y: (m.src.r * g.y) / L } : { x: 0, y: 0 };
    for (let k = 0; k < dq.length; k++) dq[k] += u.x * m.src.resp[0][k] + u.y * m.src.resp[1][k];
    dP.x += m.ex.x * u.x + m.ey.x * u.y; dP.y += m.ex.y * u.x + m.ey.y * u.y;
    return { kind: m.src.kind, joint: m.src.joint, i: m.src.i, j: m.src.j, r: m.src.r, u, adds: m.src.r * L };
  });
  return { total: reach, d, dP, dq, parts };
}

/** Where joint `id` sits on the system: the first body that carries it ({ i: −1 } if none). */
export function pointOn(sys, id) {
  const i = sys.bodies.findIndex((bd) => bd.local.has(id));
  return { id, i, s: i >= 0 ? sys.bodies[i].local.get(id) : null };
}

/**
 * The worst case for one point at every position of the cycle (linear, so
 * quick enough to follow every change). Cached on the simulation's sweep.
 *   opts { clearance, holePosition, point }
 * Returns null without a cycle, else
 *   { samples, ideal: [P0], normal: [n], total: [mm], half: [mm along n], maxK }
 *   (total and half are NaN where the position is a toggle)
 */
export function cycleWorst(sim, opts) {
  const sw = sim.getSweep && sim.getSweep();
  if (!sw || sw.samples.length < 2 || !sim.sys) return null;
  const { clearance = 0, holePosition = 0, point } = opts;
  const w = pointOn(sim.sys, point);
  if (w.i < 0) return null;
  const key = `${clearanceKey(clearance)}|${holePosition}|${point}`;
  if (sw._tolerance && sw._tolerance.key === key) return sw._tolerance.value;
  const ideal = sw.samples.map((smp) => smp.results.joints.get(point).pos);
  const normal = ideal.map((_, k) => {
    const a = ideal[Math.max(0, k - 1)], b = ideal[Math.min(ideal.length - 1, k + 1)];
    const tx = b.x - a.x, ty = b.y - a.y, L = Math.hypot(tx, ty);
    return L > 1e-12 ? { x: -ty / L, y: tx / L } : { x: 0, y: 0 };
  });
  const total = [], half = [];
  let maxK = 0;
  sw.samples.forEach((smp, k) => {
    const sources = sourcesAt(sim.sys, smp.q, smp.theta, clearance, holePosition);
    if (!sources) { total.push(NaN); half.push(NaN); return; }
    const M = pointResponse(smp.q, w, sources);
    total.push(worstDirection(M).reach);
    half.push(reachOf(M, normal[k]));
    if (Number.isFinite(total[k]) && !(total[maxK] >= total[k])) maxK = k;
  });
  const value = { samples: sw.samples, ideal, normal, total, half, maxK };
  sw._tolerance = { key, value };
  return value;
}

/** Joints to check: the traced points, or every joint that moves if none is traced. */
export function studyPoints(doc) {
  const traced = doc.joints.filter((j) => j.trace).map((j) => j.id);
  if (traced.length) return traced;
  return doc.joints.filter((j) => !j.ground).map((j) => j.id);
}

/**
 * Run the study.
 *   sim       the Simulation (its document and full-cycle sweep are used)
 *   opts      { clearance, holePosition, builds, seed, points }
 *             clearance = hole Ø − pin Ø (mm); holePosition = radius (mm)
 * Returns null when the mechanism has no cycle to study, else
 *   { builds, poses, failedBuilds, points: [{ id, maxDev, maxTheta, maxIndex, rms, width,
 *     worstDev, worstTheta, worstIndex, band }] }
 *   band: [{ theta, p0, n, lo, hi, worst }]  ideal point p0, unit normal n,
 *         the furthest random deviation to each side along n (lo ≤ 0 ≤ hi, mm)
 *         and the worst-case half-width along n (mm)
 */
export function runTolerance(sim, opts = {}) {
  const doc = sim.doc;
  const sw = sim.getSweep && sim.getSweep();
  if (!sw || sw.samples.length < 2) return null;
  const clearance = opts.clearance ?? TOLERANCE.clearance;
  const cOf = clearanceFn(clearance);
  const holePosition = Math.max(0, opts.holePosition ?? TOLERANCE.holePosition);
  const builds = Math.max(1, Math.min(TOLERANCE.maxBuilds, Math.round(opts.builds ?? TOLERANCE.builds)));
  const rand = mulberry32(opts.seed ?? 1);
  const ids = (opts.points || studyPoints(doc)).filter((id) => doc.joints.some((j) => j.id === id));

  // input positions to check (every k-th sample of the cycle)
  const stride = Math.max(1, Math.ceil(sw.samples.length / TOLERANCE.maxPoses));
  const poses = sw.samples.filter((_, k) => k % stride === 0);

  // ideal positions and path normals
  const ideal = ids.map((id) => poses.map((smp) => smp.results.joints.get(id).pos));
  const normals = ideal.map((P) => P.map((_, k) => {
    const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)];
    const tx = b.x - a.x, ty = b.y - a.y, L = Math.hypot(tx, ty);
    return L > 1e-12 ? { x: -ty / L, y: tx / L } : { x: 0, y: 0 };
  }));

  // worst case (linear), on the ideal mechanism
  const ideal0 = buildSystem(doc);
  const where0 = ids.map((id) => {
    const i = ideal0.bodies.findIndex((bd) => bd.local.has(id));
    return { id, i, s: i >= 0 ? ideal0.bodies[i].local.get(id) : null };
  });
  const worst = poses.map((smp, k) => worstCase(ideal0, smp.q, smp.theta, where0, normals.map((N) => N[k]), clearance, holePosition));

  const stats = ids.map(() => ({ max: 0, maxK: 0, sum2: 0, count: 0, lo: poses.map(() => 0), hi: poses.map(() => 0) }));
  let failedBuilds = 0;

  for (let b = 0; b < builds; b++) {
    // hole errors for this build
    const holes = new Map();
    const holeOffset = (jointId, body) => {
      const key = jointId + '|' + body;
      if (!holes.has(key)) holes.set(key, holePosition > 0 ? inDisc(rand, holePosition) : null);
      return holes.get(key);
    };
    const sys = buildSystem(doc, { holeOffset });
    const pins = sys.constraints.filter((c) => c.info && c.info.kind === 'pin');
    // where each checked joint sits on the build (first link that carries it)
    const where = ids.map((id) => {
      const i = sys.bodies.findIndex((bd) => bd.local.has(id));
      return i >= 0 ? { i, s: sys.bodies[i].local.get(id) } : { i: -1, s: doc.joints.find((j) => j.id === id) };
    });

    let failed = false;
    poses.forEach((smp, k) => {
      for (const c of pins) { const cl = cOf(c.info.joint); c.gap = cl > 0 ? onCircle(rand, cl / 2) : { x: 0, y: 0 }; }
      const r = solvePosition(sys, smp.q, smp.theta);
      if (!r.ok) { failed = true; return; }
      where.forEach((w, n) => {
        const P = pointOnBody(r.q, w.i, w.s), P0 = ideal[n][k], N = normals[n][k], st = stats[n];
        const dx = P.x - P0.x, dy = P.y - P0.y, d = Math.hypot(dx, dy);
        if (d > st.max) { st.max = d; st.maxK = k; }
        st.sum2 += d * d; st.count++;
        const along = dx * N.x + dy * N.y;
        if (along < st.lo[k]) st.lo[k] = along;
        if (along > st.hi[k]) st.hi[k] = along;
      });
    });
    if (failed) failedBuilds++;
  }

  return {
    builds, poses: poses.length, failedBuilds, clearance, holePosition,
    points: ids.map((id, n) => {
      const st = stats[n];
      const wc = worst.map((w) => (w ? w[n] : null));
      const wTot = wc.map((w) => (w ? w.total : 0));
      const worstK = wTot.indexOf(Math.max(...wTot));
      return {
        worstDev: wTot[worstK],
        worstTheta: poses[worstK].theta,
        worstIndex: worstK,
        id,
        maxDev: st.max,
        maxTheta: poses[st.maxK].theta,
        maxIndex: st.maxK,
        rms: st.count ? Math.sqrt(st.sum2 / st.count) : 0,
        width: Math.max(...st.hi.map((h, k) => h - st.lo[k])),
        band: poses.map((smp, k) => ({ theta: smp.theta, p0: ideal[n][k], n: normals[n][k], lo: st.lo[k], hi: st.hi[k], worst: wc[k] ? wc[k].normal : 0 })),
      };
    }),
  };
}

/**
 * Settings of the Tolerance panel for this session (app.tolerance):
 *   clearance (mm, every pin), pins ({ jointId: mm } for pins that differ),
 *   holePosition (mm), builds, target ('output' or a joint id; null = automatic),
 *   point (the joint used when a point is wanted; null = automatic),
 *   lens (the magnifier on the drawing), drag ('follow' or 'walls': what a push by
 *   hand does, see setPush),
 *   scale ('auto' or a magnification of the exaggerated drawing),
 *   result and version (the last random-build run and the design it was for)
 */
export function toleranceSettings(app) {
  if (!app.tolerance) {
    app.tolerance = {
      clearance: TOLERANCE.clearance, pins: {}, holePosition: TOLERANCE.holePosition, builds: TOLERANCE.builds,
      target: null, point: null, lens: true, scale: 'auto', result: null, version: -1,
      push: null, drag: 'follow',
      iso: null,   // { hole: 'H7', shaft: 'g6', d: 10 (mm), use: 'max' | 'mean' } when the clearance comes from an ISO fit
    };
  }
  return app.tolerance;
}

/** Joints that can be studied: every joint that moves (traced ones first). */
export function movingJoints(doc) {
  const moving = doc.joints.filter((j) => !j.ground && !linksAtJoint(doc, j.id).some((l) => isFrameLink(doc, l)));
  return [...moving.filter((j) => j.trace), ...moving.filter((j) => !j.trace)];
}

/** The point studied: the one chosen, else the first traced point, else the last joint that moves. */
export function chosenPoint(app) {
  const t = toleranceSettings(app), doc = app.doc;
  const ok = (id) => id && doc.joints.some((j) => j.id === id && !j.ground) && app.sim.sys && app.sim.sys.bodies.some((b) => b.local.has(id));
  if (ok(t.point)) return t.point;
  const traced = doc.joints.find((j) => j.trace && ok(j.id));
  if (traced) return traced.id;
  const moving = doc.joints.filter((j) => ok(j.id));
  return moving.length ? moving[moving.length - 1].id : null;
}

/**
 * How much larger than true size the clearance is drawn. 'auto': the
 * smallest listed size at which the pin's play (c/2) shows as about
 * TOLERANCE.autoGapPx pixels at this zoom, but (with `limit`, see drawLimit)
 * no larger than keeps the checked point's play, drawn, within
 * TOLERANCE.autoMaxDrawn of the mechanism's size: next to a dead centre a
 * small clearance moves the point a long way, and 50× of that would dwarf
 * the mechanism.
 */
export function magnification(t, zoom, limit = null) {
  if (t.scale !== 'auto') return +t.scale || 1;
  const sizes = TOLERANCE.magnify;
  const largest = Math.max(t.clearance, ...Object.values(t.pins || {}).filter(Number.isFinite));
  const play = Math.max(largest / 2, t.holePosition, 1e-9) * zoom; // pixels at true size
  let k = sizes.find((m) => play * m >= TOLERANCE.autoGapPx) || sizes[sizes.length - 1];
  if (limit && limit.play > 0 && limit.size > 0) {
    const fits = sizes.filter((m) => m * limit.play <= TOLERANCE.autoMaxDrawn * limit.size);
    k = Math.min(k, fits.length ? fits[fits.length - 1] : sizes[0]);
  }
  return k;
}

/**
 * The limit for 'auto' (magnification): the largest play of the checked
 * target over the cycle (mm; an angle is taken at the longest link) and the
 * mechanism's size (the span of its joints as drawn). Null until there is a
 * study.
 */
export function drawLimit(app) {
  const st = studyFor(app);
  if (!st || !app.sim.sys || !app.doc.joints.length) return null;
  const plays = st.play.filter(Number.isFinite);
  if (!plays.length) return null;
  const xs = app.doc.joints.map((j) => j.x), ys = app.doc.joints.map((j) => j.y);
  const size = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const play = Math.max(...plays);
  return { play: st.kind === 'angle' ? play * 2 * lengthScale(app.sim.sys) : play, size };
}

/**
 * The app keeps the settings and last result of the Tolerance panel in
 * app.tolerance = { …settings, result, version }. The result is current only
 * while the design is unchanged (app.version).
 */
export function currentTolerance(app) {
  const t = app.tolerance;
  return t && t.result && t.version === app.version ? t : null;
}

// =============================================================================
// What is checked, under the load, and knocks
// =============================================================================

/**
 * The target on the system (see the header):
 *   'output'    the document's output: a link's angle, a slider on a fixed
 *               rail (along the rail), x or y of a joint (along that axis)
 *   a joint id  that point, in any direction
 * Returns null when it cannot be checked (e.g. the output is the frame).
 *   { key, kind: 'angle', i, link }  or  { key, kind: 'along' | 'point', id, i, s, e }
 */
export function targetOn(sys, doc, key) {
  if (!sys) return null;
  const point = (id, e = null) => {
    const w = pointOn(sys, id);
    return w.i < 0 ? null : { key, kind: e ? 'along' : 'point', id, i: w.i, s: w.s, e };
  };
  if (key !== 'output') return key ? point(key) : null;
  const o = doc.output;
  if (!o) return null;
  if (o.kind === 'angle') {
    const i = sys.bodyIndex.get(o.link);
    return i === undefined ? null : { key, kind: 'angle', i, link: o.link };
  }
  if (o.kind === 'x' || o.kind === 'y') return point(o.joint, o.kind === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 });
  if (o.kind === 'slider') {
    const sl = doc.sliders.find((x) => x.id === o.slider);
    if (!sl) return null;
    if (sl.on) return point(sl.joint); // a rail on a moving link: any direction
    const L = Math.hypot(sl.b.x - sl.a.x, sl.b.y - sl.a.y) || 1;
    return point(sl.joint, { x: (sl.b.x - sl.a.x) / L, y: (sl.b.y - sl.a.y) / L });
  }
  return null;
}

/**
 * How each source moves the target, per unit error along x and along y:
 * a row g = [gx, gy] for an angle or a move along e (δ = g·u), or the 2×2
 * map M (columns ex, ey) for a point (δP = M u).
 */
function targetResponse(q, tg, sources) {
  if (tg.kind === 'angle') return sources.map((src) => ({ src, g: [src.resp[0][3 * tg.i + 2], src.resp[1][3 * tg.i + 2]] }));
  const M = pointResponse(q, tg, sources);
  if (tg.kind === 'point') return M;
  const e = tg.e;
  return M.map((m) => ({ src: m.src, g: [m.ex.x * e.x + m.ex.y * e.y, m.ey.x * e.x + m.ey.y * e.y] }));
}

/** The force on body i from body j at this source's pin (N), from a force result; null if unknown. */
function pinForce(f, src) {
  if (!f || src.kind !== 'pin') return null;
  const p = f.pins.find((x) => x.joint === src.joint && x.i === src.i && x.j === src.j);
  if (p) return p.F;
  const r = f.pins.find((x) => x.joint === src.joint && x.i === src.j && x.j === src.i);
  return r ? { x: -r.F.x, y: -r.F.y } : null;
}

/**
 * Where a loaded pin sits in its hole: pushed to the side away from the push,
 * u = P_i − P_j = −(c/2) F/|F|. A pin with (almost) no force has no side: 0.
 * A hole position error is not moved by the load: 0 (it is in the worst case only).
 */
function loadedGap(src, F) {
  if (!F) return { x: 0, y: 0 };
  const L = Math.hypot(F.x, F.y);
  return L > TOLERANCE.floatForce ? { x: (-src.r * F.x) / L, y: (-src.r * F.y) / L } : { x: 0, y: 0 };
}

/**
 * The target at one pose, in detail (for the panel and the drawing).
 *   f       the force result at this pose (null: no load known)
 *   gapOf   optional: source → its gap u { x, y } (a push by hand, see followGaps);
 *           it takes the place of the gaps the forces give
 * Returns null at a toggle position, else
 *   { kind, play, parts, dqWorst, loaded, dqLoaded, zone, d }
 *   play     the most the target can be off (rad, or mm), every source at its worst
 *   parts    [{ kind, joint, i, j, r, adds, F }]: what each source adds to play (they add up to it)
 *   loaded   the actual error under the load: rad or mm (signed) for angle/along, { x, y } mm for a point; null without f
 *   worst    where the worst case puts the target (as `loaded`; what the dashed drawing shows without a load or push)
 *   dqWorst, dqLoaded   the pose change, to draw the mechanism so (exaggerated)
 *   zone     a point's worst-case zone: its outline as offsets { x, y } (mm) from the ideal place
 */
export function analysePose(sys, q, theta, tg, clearance, holePosition, f = null, gapOf = null) {
  const sources = sourcesAt(sys, q, theta, clearance, holePosition);
  if (!sources || !tg) return null;
  const R = targetResponse(q, tg, sources);
  const n = q.length;
  const gapFor = typeof gapOf === 'function' ? gapOf : f ? (src) => loadedGap(src, pinForce(f, src)) : null;
  const dqWorst = new Array(n).fill(0), dqLoaded = gapFor ? new Array(n).fill(0) : null;
  const addDq = (dq, src, u) => { for (let k = 0; k < n; k++) dq[k] += u.x * src.resp[0][k] + u.y * src.resp[1][k]; };
  const parts = [];
  let play = 0, loaded = null, d = null, zone = null, worst = null;
  if (tg.kind === 'point') {
    const wd = worstDirection(R);
    d = wd.d; play = wd.reach;
    const dP = { x: 0, y: 0 }, wP = { x: 0, y: 0 };
    R.forEach((m) => {
      const gx = m.ex.x * d.x + m.ex.y * d.y, gy = m.ey.x * d.x + m.ey.y * d.y, L = Math.hypot(gx, gy);
      const u = L > 1e-15 ? { x: (m.src.r * gx) / L, y: (m.src.r * gy) / L } : { x: 0, y: 0 };
      addDq(dqWorst, m.src, u);
      wP.x += m.ex.x * u.x + m.ey.x * u.y; wP.y += m.ex.y * u.x + m.ey.y * u.y;
      const F = pinForce(f, m.src);
      if (gapFor) {
        const ul = gapFor(m.src);
        addDq(dqLoaded, m.src, ul);
        dP.x += m.ex.x * ul.x + m.ey.x * ul.y; dP.y += m.ex.y * ul.x + m.ey.y * ul.y;
      }
      parts.push({ kind: m.src.kind, joint: m.src.joint, i: m.src.i, j: m.src.j, r: m.src.r, adds: m.src.r * L, F });
    });
    if (gapFor) loaded = dP;
    worst = wP;
    // the zone: for each direction, its furthest point (support point of the sum of ellipses)
    zone = [];
    for (let a = 0; a < 72; a++) {
      const dd = { x: Math.cos((a * Math.PI) / 36), y: Math.sin((a * Math.PI) / 36) };
      const z = { x: 0, y: 0 };
      for (const m of R) {
        const gx = m.ex.x * dd.x + m.ex.y * dd.y, gy = m.ey.x * dd.x + m.ey.y * dd.y, L = Math.hypot(gx, gy);
        if (L < 1e-15) continue;
        const ux = (m.src.r * gx) / L, uy = (m.src.r * gy) / L;
        z.x += m.ex.x * ux + m.ey.x * uy; z.y += m.ex.y * ux + m.ey.y * uy;
      }
      zone.push(z);
    }
  } else {
    if (gapFor) loaded = 0;
    R.forEach((m) => {
      const L = Math.hypot(m.g[0], m.g[1]);
      // worst: every source pushes the target the + way
      const u = L > 1e-15 ? { x: (m.src.r * m.g[0]) / L, y: (m.src.r * m.g[1]) / L } : { x: 0, y: 0 };
      addDq(dqWorst, m.src, u);
      play += m.src.r * L;
      const F = pinForce(f, m.src);
      if (gapFor) {
        const ul = gapFor(m.src);
        addDq(dqLoaded, m.src, ul);
        loaded += m.g[0] * ul.x + m.g[1] * ul.y;
      }
      parts.push({ kind: m.src.kind, joint: m.src.joint, i: m.src.i, j: m.src.j, r: m.src.r, adds: m.src.r * L, F });
    });
  }
  if (tg.kind !== 'point') worst = play;   // every source pushes the + way
  return { kind: tg.kind, play, parts, dqWorst, loaded, dqLoaded, zone, d, worst };
}

/**
 * The study over the cycle for one target (linear: quick enough to follow
 * every change). Cached on the simulation's sweep.
 *   opts { clearance, holePosition, target (key, see targetOn),
 *          forceOf (sample → force result, or null when forces are off),
 *          version (anything that changes when the forces change) }
 * Returns null without a cycle, else
 *   { kind, target, samples, play: [], loaded: [] | null, knocks: [], maxK }
 *   play     per sample, the most the target can be off (rad or mm; NaN at a toggle)
 *   loaded   per sample, the actual error under the load: a number (angle,
 *            along) or { x, y } (point); NaN / null where unknown
 *   knocks   [{ k, theta, jump, pins: [joint ids] }], the largest jump first
 *   maxK     the sample with the largest play
 *   maxAwayK when maxK is next to a toggle or stationary position: the sample
 *            with the largest play away from all of them (else −1)
 *   hull     a point: the outline of its zones over the whole cycle (offsets, mm)
 */
export function cycleStudy(sim, opts) {
  const sw = sim.getSweep && sim.getSweep();
  if (!sw || sw.samples.length < 2 || !sim.sys) return null;
  const { clearance = 0, holePosition = 0, target, forceOf = null, version = '' } = opts;
  const tg = targetOn(sim.sys, sim.doc, target);
  if (!tg) return null;
  const key = `${clearanceKey(clearance)}|${holePosition}|${target}|${forceOf ? 'F' : '-'}|${version}`;
  if (sw._tolStudy && sw._tolStudy.key === key) return sw._tolStudy.value;
  const n = sw.samples.length;
  const play = [], loaded = forceOf ? [] : null;
  const pinF = new Map(); // joint|i|j → [force per sample]
  let maxK = 0;
  // a point: the outline of every zone over the cycle (in each direction, the furthest of them)
  const hull = tg.kind === 'point' ? [] : null, reachH = [];
  sw.samples.forEach((smp, k) => {
    const f = forceOf ? forceOf(smp) : null;
    const a = analysePose(sim.sys, smp.q, smp.theta, tg, clearance, holePosition, f);
    if (!a) { play.push(NaN); if (loaded) loaded.push(tg.kind === 'point' ? null : NaN); return; }
    play.push(a.play);
    if (Number.isFinite(a.play) && !(play[maxK] >= a.play)) maxK = k;
    if (loaded) loaded.push(f ? a.loaded : (tg.kind === 'point' ? null : NaN));
    if (hull) {
      a.zone.forEach((z, n) => {
        const ang = (n * Math.PI) / 36, r = z.x * Math.cos(ang) + z.y * Math.sin(ang);
        if (!(reachH[n] >= r)) { reachH[n] = r; hull[n] = z; }
      });
    }
    for (const p of a.parts) {
      if (p.kind !== 'pin') continue;
      const id = `${p.joint}|${p.i}|${p.j}`;
      if (!pinF.has(id)) pinF.set(id, { joint: p.joint, F: new Array(n).fill(null) });
      pinF.get(id).F[k] = p.F;
    }
  });
  const knocks = loaded ? findKnocks(sw, [...pinF.values()], loaded, play, tg.kind, sim.inputIsAngle) : [];
  // next to a toggle or stationary position the play grows; when the largest
  // sits there, also find the largest away from every such position
  const window = Math.max(1, Math.round(TOLERANCE.nearSpecial * n));
  const specials = (sw.specials || []).filter((sp) => sp.kind !== 'end').map((sp) => sp.index);
  const nearSpecial = (k) => specials.some((i) => Math.abs(k - i) <= window || (sw.fullTurn && n - Math.abs(k - i) <= window));
  let maxAwayK = -1;
  if (specials.length && nearSpecial(maxK)) {
    play.forEach((v, k) => { if (Number.isFinite(v) && !nearSpecial(k) && (maxAwayK < 0 || v > play[maxAwayK])) maxAwayK = k; });
  }
  const value = { kind: tg.kind, target: tg, samples: sw.samples, play, loaded, knocks, maxK, maxAwayK, hull };
  sw._tolStudy = { key, value };
  return value;
}

/**
 * Knocks: where a pin's force passes near zero and comes back the other way
 * (TOLERANCE.knock), grouped when several pins do it together, with the jump
 * of the target across them. The cycle wraps round when it is a full turn.
 */
export function findKnocks(sw, pins, loaded, play, kind, isAngle = true) {
  const K = TOLERANCE.knock, n = sw.samples.length;
  const wrap = !!sw.fullTurn;
  const m = wrap ? n - 1 : n; // a full turn repeats its first sample at the end
  const idx = (k) => (wrap ? ((k % m) + m) % m : Math.max(0, Math.min(n - 1, k)));
  // window: ±windowDeg of input (or 1/90 of the cycle), from the mean step between samples
  let travel = 0;
  for (let k = 1; k < n; k++) travel += Math.abs(sw.samples[k].theta - sw.samples[k - 1].theta);
  const step = travel / (n - 1);
  const w = Math.max(2, Math.round(isAngle && step > 0 ? (K.windowDeg * Math.PI) / 180 / step : n / 90));
  const events = [];
  for (const p of pins) {
    const mag = p.F.map((F) => (F ? Math.hypot(F.x, F.y) : NaN));
    const top = Math.max(...mag.filter(Number.isFinite));
    if (!(top > 0)) continue;
    for (let k = 0; k < m; k++) {
      const v = mag[k];
      if (!Number.isFinite(v) || v >= K.minFraction * top) continue;
      if (!(v <= mag[idx(k - 1)] && v < mag[idx(k + 1)])) continue; // a lowest point
      const a = p.F[idx(k - w)], b = p.F[idx(k + w)];
      if (!a || !b) continue;
      const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) || 1);
      if (cos > Math.cos((K.minTurnDeg * Math.PI) / 180)) continue;
      events.push({ k, joint: p.joint, size: v });
    }
  }
  if (!events.length) return [];
  // group events within 1.5 windows of each other
  events.sort((x, y) => x.k - y.k);
  const groups = [];
  const dist = (x, y) => { const d = Math.abs(x - y); return wrap ? Math.min(d, m - d) : d; };
  for (const e of events) {
    const g = groups.find((gr) => gr.events.some((x) => dist(x.k, e.k) <= 1.5 * w));
    if (g) g.events.push(e); else groups.push({ events: [e] });
  }
  const val = (k) => loaded[idx(k)];
  const diff = (a, b) => {
    if (kind === 'point') return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : NaN;
    return Math.abs(a - b);
  };
  const topPlay = Math.max(...play.filter(Number.isFinite));
  const out = [];
  for (const g of groups) {
    const ks = g.events.map((e) => e.k);
    // the middle of the group (round the wrap if needed)
    let k0 = ks[0], spread = 0;
    for (const k of ks) { const d = dist(k, k0); if (d > spread) spread = d; }
    const centre = g.events.reduce((best, e) => (e.size < best.size ? e : best)).k;
    const reach = w + Math.ceil(spread);
    const jump = diff(val(centre + reach), val(centre - reach));
    if (!(jump >= K.minJump * topPlay)) continue;
    out.push({ k: centre, theta: sw.samples[centre].theta, jump, pins: [...new Set(g.events.map((e) => e.joint))] });
  }
  return out.sort((a, b) => b.jump - a.jump);
}

/** What can be checked: the output (when it can be), then the moving joints (traced first). */
export function targetChoices(app) {
  const out = [];
  if (targetOn(app.sim.sys, app.doc, 'output')) out.push('output');
  for (const j of movingJoints(app.doc)) if (app.sim.sys && app.sim.sys.bodies.some((b) => b.local.has(j.id))) out.push(j.id);
  return out;
}

/** The target checked: the one chosen, else the output, else the point chosen automatically. */
export function chosenTarget(app) {
  const t = toleranceSettings(app);
  const ok = targetChoices(app);
  if (t.target && ok.includes(t.target)) return t.target;
  if (ok.includes('output')) return 'output';
  return chosenPoint(app);
}

/** The clearances of the panel as one value for the model: { value, pins }. */
export function clearanceSetting(t) {
  return { value: t.clearance, pins: t.pins || {} };
}

/**
 * The study over the cycle for the app's current settings (Tolerance panel),
 * with the loads from the force analysis when it is on. Null when there is
 * nothing to check.
 */
export function studyFor(app) {
  const t = toleranceSettings(app);
  const target = chosenTarget(app);
  if (!target || !app.sim.sys || !app.sim.drivable) return null;
  const list = app.forceSweep();
  return cycleStudy(app.sim, {
    clearance: clearanceSetting(t), holePosition: t.holePosition, target,
    forceOf: list ? (smp) => app.forceOf(smp) : null,
    version: list && app._forceSweep ? app._forceSweep.key : '',
  });
}

/** The target at the pose shown (see analysePose), with the load there when forces are on. */
export function poseFor(app) {
  const t = toleranceSettings(app);
  const target = chosenTarget(app);
  if (!target || !app.sim.sys || !app.sim.drivable) return null;
  const tg = targetOn(app.sim.sys, app.doc, target);
  if (!tg) return null;
  // a push by hand (see setPush) takes the place of the load
  const push = currentPush(app);
  const c = clearanceSetting(t), sim = app.sim;
  if (push && t.drag !== 'walls') {
    // smooth: the pins sit wherever brings the grabbed point closest to the mouse
    const k = magnification(t, app.view.zoom, drawLimit(app));
    const d = { x: push.F.x / k, y: push.F.y / k };
    const gaps = followGaps(sim.sys, sim.q, sim.theta, { i: push.i, s: push.s }, d, c, t.holePosition);
    const a = gaps && analysePose(sim.sys, sim.q, sim.theta, tg, c, t.holePosition, null, (src) => gaps.get(srcKey(src)) || { x: 0, y: 0 });
    if (a) return { ...a, target: tg, pushed: true };
  }
  const f = push ? pushForces(sim, push) : (app.forceSweep() ? app.forcesNow() : null);
  const a = analysePose(sim.sys, sim.q, sim.theta, tg, c, t.holePosition, f);
  return a ? { ...a, target: tg, pushed: !!(push && f) } : null;
}

// =============================================================================
// Pushing by hand
// -----------------------------------------------------------------------------
// In the Tolerance tab, dragging a link moves it as a hand would move a real
// loose linkage: the motor holds the input, so the links move only within
// their play. Two ways (Tolerance › When you drag, app.tolerance.drag):
//   'follow'  smooth: the pins take the places, each inside its hole, that
//             bring the grabbed point closest to the mouse (followGaps); it
//             follows the hand until the pins reach the walls
//   'walls'   the extremes: every pin goes to the side of its hole that the
//             push loads it against (pushForces)
// The push stays (app.tolerance.push) until the input moves or the design
// changes.
//   push = { i, s (point on body i, local), F (mouse offset since the press, world mm), q (the pose), version }
// =============================================================================

/** Dragging pushes (instead of moving the mechanism) while the Tolerance tab is open (Advanced). */
export function pushActive(app) {
  const t = app.tolerance;
  return app.mode === 'advanced' && !!t && !!app.sim.sys && !!app.sim.drivable
    && !!(app.ui && app.ui.toleranceOpen && app.ui.toleranceOpen());
}

/** Push at grab = { i, s } in direction F (world, any length). */
export function setPush(app, grab, F) {
  if (!grab || !(Math.hypot(F.x, F.y) > 0)) return;
  toleranceSettings(app).push = { i: grab.i, s: grab.s, F, q: app.sim.q, version: app.version };
}

/** The push, if it still applies at the pose shown. */
function currentPush(app) {
  const p = app.tolerance && app.tolerance.push;
  // every move of the mechanism makes a new pose (sim.q), so coming back to
  // the same input angle later does not bring an old push back
  return p && p.q === app.sim.q && p.version === app.version ? p : null;
}

/**
 * Smooth push: the gap u_s of every pin (|u_s| ≤ c/2) that brings the grabbed
 * point w = { i, s } closest to its ideal place + d (mm, true size):
 *   minimise |Σ M_s u_s − d|² + ε Σ |u_s|²   with every u_s inside its circle,
 * M_s the 2×2 map from pin s's gap to the point's move (linear, as the zone).
 * The small ε picks, of equal fits, the one that moves the pins least.
 * Solved by projected gradient steps (FISTA); hole position errors are not
 * moved by hand (0). Returns Map srcKey(source) → u, or null at a toggle position.
 */
export const srcKey = (src) => `${src.kind}|${src.joint}|${src.i}|${src.j}`;

export function followGaps(sys, q, theta, w, d, clearance, holePosition) {
  const sources = sourcesAt(sys, q, theta, clearance, holePosition);
  if (!sources) return null;
  const M = pointResponse(q, { i: w.i, s: w.s }, sources).filter((m) => m.src.kind === 'pin' && m.src.r > 0);
  const gaps = new Map();
  if (!M.length) return gaps;
  // A: 2 × 2n, columns ex, ey of each pin
  const cols = M.flatMap((m) => [m.ex, m.ey]);
  const scale = Math.max(1e-12, ...M.map((m) => m.src.r));
  const eps = 1e-6 * cols.reduce((t, v) => t + v.x * v.x + v.y * v.y, 0) / cols.length;
  const L = 2 * (cols.reduce((t, v) => t + v.x * v.x + v.y * v.y, 0) + eps);   // ≥ the gradient's Lipschitz constant
  let u = new Array(cols.length).fill(0), y = u.slice(), tk = 1;
  const project = (v) => { for (let k = 0; k < M.length; k++) { const a = v[2 * k], b = v[2 * k + 1], n = Math.hypot(a, b), r = M[k].src.r; if (n > r) { v[2 * k] = (a * r) / n; v[2 * k + 1] = (b * r) / n; } } return v; };
  for (let it = 0; it < TOLERANCE.followIterations; it++) {
    let ex = -d.x, ey = -d.y;
    for (let k = 0; k < cols.length; k++) { ex += cols[k].x * y[k]; ey += cols[k].y * y[k]; }
    const next = project(y.map((yk, k) => yk - (2 * (cols[k].x * ex + cols[k].y * ey) + 2 * eps * yk) / L));
    const t1 = (1 + Math.sqrt(1 + 4 * tk * tk)) / 2;
    y = next.map((v, k) => v + ((tk - 1) / t1) * (v - u[k]));
    u = next; tk = t1;
    if (Math.max(...u.map(Math.abs)) > 10 * scale) break;   // cannot happen inside the circles; a guard
  }
  M.forEach((m, k) => gaps.set(srcKey(m.src), { x: u[2 * k], y: u[2 * k + 1] }));
  return gaps;
}

/** The pin forces from the push alone: no weight, no inertia, the motor holding the input. */
export function pushForces(sim, push) {
  const sys = sim.sys;
  const still = new Array(sys.n).fill(0);
  const massless = sys.bodies.map(() => ({ m: 0, c: { x: 0, y: 0 }, I: 0 }));
  const L = Math.hypot(push.F.x, push.F.y);
  const load = { i: push.i, s: push.s, F: { x: push.F.x / L, y: push.F.y / L } };   // 1 N: only its direction matters
  return inverseDynamics(sys, sim.q, still, still, sim.theta, massless, [load], {});
}
