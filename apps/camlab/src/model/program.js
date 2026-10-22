// =============================================================================
// program.js — the cam's motion program: segments around one turn
// -----------------------------------------------------------------------------
// A program is a list of segments in order from θ = 0:
//   { kind: 'rise' | 'fall' | 'dwell', law, beta (deg), h (mm) }
//   { kind: 'poly', beta, conditions: [...] }   polynomial through given
//      conditions (single-dwell cams, critical path motion), see below
// Rise and fall move the follower by h; a dwell holds it. The program starts
// at s = 0 (the follower on the prime circle).
//
// evaluate(program, θ) gives s and its derivatives with respect to θ (per
// radian); times ω, ω², ω³ give velocity, acceleration and jerk in time.
// check(program) reports the fundamental law of cam design: s, v and a must
// be continuous over the whole turn, so the jerk stays finite.
// =============================================================================

import { LAWS, polyFromConditions, polyAt, reversePoly } from './laws.js';

const DEG = Math.PI / 180;

// ---- CONFIG -------------------------------------------------------------------
const MIN_BETA = 0.1;      // degrees: a shorter segment (or 0, or not a number) is an error
const MIN_SAMPLES = 64;    // samples per moving segment at least, so short segments show their true peaks
const KINDS = ['rise', 'fall', 'dwell', 'poly'];
// -------------------------------------------------------------------------------

/**
 * Prepare a program for evaluation: start angles and levels of each segment,
 * and the coefficients of polynomial segments. Returns
 * { segments: [{ ...seg, start, end, s0, s1, f, poly }], total (deg), ok, problems }.
 * Each prepared segment has f(x) → { s, v, a, j } in mm and per-radian derivatives.
 * poly: for a segment that is a polynomial (a polynomial segment, or a rise or
 * fall with the 3-4-5 or 4-5-6-7 law), its coefficients C[k] in mm with
 * s = Σ C[k]·xᵏ, x = (θ − start)/β; otherwise null.
 */
export function prepare(program) {
  const out = [];
  const problems = [];
  let start = 0, level = 0;
  for (const segIn of program.segments) {
    // values from a file are checked: a bad one is said, never changed in silence
    const n = out.length + 1;
    const raw = +segIn.beta;
    if (!(raw >= MIN_BETA)) {
      problems.push({ kind: 'segment', text: `Segment ${n} is ${Number.isFinite(raw) ? `${+raw.toFixed(4)}°` : `"${segIn.beta}"`} long: a segment must be at least ${MIN_BETA}°. It is taken as ${MIN_BETA}°.` });
    }
    let seg = segIn;
    if (!KINDS.includes(seg.kind)) {
      problems.push({ kind: 'segment', text: `Segment ${n}: unknown kind "${seg.kind}". It is taken as a dwell.` });
      seg = { ...seg, kind: 'dwell' };
    }
    if (seg.kind === 'rise' || seg.kind === 'fall') {
      if (!LAWS[seg.law]) {
        problems.push({ kind: 'segment', text: `Segment ${n}: unknown motion law "${seg.law}". Cycloidal is used.` });
        seg = { ...seg, law: 'cycloidal' };
      }
      const hv = +seg.h;
      if (!(hv > 0)) problems.push({ kind: 'segment', text: `Segment ${n}: the ${seg.kind} h must be a number above 0 (it is ${Number.isFinite(hv) ? String(+hv.toFixed(4)).replace('-', '−') : `"${seg.h}"`}). ${Number.isFinite(hv) && hv < 0 ? `${+(-hv).toFixed(4)} mm is used.` : 'It is taken as 0.'}` });
    }
    const beta = Number.isFinite(raw) ? Math.max(MIN_BETA, raw) : MIN_BETA;
    const b = beta * DEG;
    const s0 = level;
    let f, s1, poly = null;
    if (seg.kind === 'dwell') {
      f = () => ({ s: s0, v: 0, a: 0, j: 0 });
      s1 = s0;
    } else if (seg.kind === 'poly') {
      // conditions in physical units at a fraction of the segment:
      // { at: 0..1, d: 0..3, value } with value in mm, mm/rad, mm/rad², mm/rad³
      const conds = (seg.conditions || []).map((c) => ({ x: c.at, d: c.d, value: c.value * b ** c.d }));
      const coef = conds.length >= 2 ? polyFromConditions(conds) : null;
      if (!coef) {
        problems.push({ kind: 'poly', at: start, text: conds.length < 2
          ? `Segment ${out.length + 1} needs at least two conditions (for example s at both ends).`
          : `The conditions of segment ${out.length + 1} cannot all be met by one polynomial: two of them clash, or they do not pin the curve down (for example two values at the same point). It is treated as a dwell.` });
      }
      const P = coef ? polyAt(coef) : () => ({ s: s0, v: 0, a: 0, j: 0 });
      poly = coef;
      f = (x) => { const r = P(x); return { s: r.s, v: r.v / b, a: r.a / b ** 2, j: r.j / b ** 3 }; };
      s1 = f(1).s;
    } else {
      const law = LAWS[seg.law] || LAWS.cycloidal;
      const h = (seg.kind === 'fall' ? -1 : 1) * Math.abs(+seg.h || 0);
      // a fall is the rise run backwards: S(1 − x)
      f = seg.kind === 'fall'
        ? (x) => { const r = law.at(1 - x); return { s: s0 + h + -h * r.s, v: (h * r.v) / b, a: (-h * r.a) / b ** 2, j: (h * r.j) / b ** 3 }; }
        : (x) => { const r = law.at(x); return { s: s0 + h * r.s, v: (h * r.v) / b, a: (h * r.a) / b ** 2, j: (h * r.j) / b ** 3 }; };
      s1 = s0 + h;
      if (law.coef) {
        // rise: s = s0 + h·S(x); fall: s = s0 + h − h·S(1 − x) (h < 0 for a fall)
        const c = seg.kind === 'fall' ? reversePoly(law.coef).map((v) => -h * v) : law.coef.map((v) => h * v);
        c[0] += seg.kind === 'fall' ? s0 + h : s0;
        poly = c;
      }
    }
    out.push({ ...seg, beta, start, end: start + beta, xEnd: 1, s0, s1, f, poly });
    start += beta;
    level = s1;
  }
  // the cam always has one turn: a short program is padded with a dwell, a long one is cut at 360°
  const given = start;
  if (given < 360 - 1e-6) {
    problems.push({ kind: 'total', text: `The segments add up to ${+given.toFixed(3)}°, not 360°. The rest of the turn is shown as an added dwell.` });
    const s0 = level;
    out.push({ kind: 'dwell', implicit: true, beta: 360 - given, start: given, end: 360, xEnd: 1, s0, s1: s0, f: () => ({ s: s0, v: 0, a: 0, j: 0 }) });
  } else if (given > 360 + 1e-6) {
    // segments that start at 360° or later are dropped whole; the one across 360° is cut there
    const kept = out.filter((sg) => sg.start < 360 - 1e-9).length;
    const dropped = out.length - kept;
    const which = dropped === 0 ? '' : dropped === 1 ? `, including all of segment ${kept + 1}`
      : `, including all of segments ${kept + 1} ${dropped === 2 ? 'and' : 'to'} ${kept + dropped}`;
    problems.push({ kind: 'total', over: true, text: `The segments add up to ${+given.toFixed(3)}°, more than one turn: everything after 360° is left out${which}.` });
    out.length = kept;
    const last = out[out.length - 1];
    if (last) { last.end = 360; last.xEnd = (360 - last.start) / last.beta; last.s1 = last.f(last.xEnd).s; level = last.s1; }
  }
  // the text is in mm; analysis.js says it again in the design's units (`level` kept for that)
  if (out.length && Math.abs(level) > 1e-6) problems.push({ kind: 'level', level, text: `The follower ends ${+Math.abs(level).toPrecision(4)} mm ${level > 0 ? 'above' : 'below'} where it started: the program does not close.` });
  return { segments: out, total: 360, given, problems };
}

/**
 * The boundary conditions of a polynomial segment, in physical units
 * ({ at: 0..1, d: 0..3, value } with value in mm, mm/rad, mm/rad², mm/rad³),
 * for a prepared segment that has a polynomial (prep segment .poly): a
 * polynomial segment's own, or those a rise or fall with a polynomial law
 * meets: s at both ends, and v, a (and j for 4-5-6-7) zero at both ends.
 * Null for any other segment.
 */
export function polyConditions(ps) {
  if (!ps || !ps.poly) return null;
  if (ps.kind === 'poly') return (ps.conditions || []).map((c) => ({ at: c.at, d: c.d, value: c.value }));
  const law = LAWS[ps.law];
  if (!law || !law.coef) return null;
  const top = law.coef.length / 2 - 1;   // 6 coefficients: s, v, a at each end; 8: s, v, a, j
  const out = [];
  for (const [at, s] of [[0, ps.s0], [1, ps.s1]]) {
    out.push({ at, d: 0, value: s });
    for (let d = 1; d <= top; d++) out.push({ at, d, value: 0 });
  }
  return out;
}

/**
 * How messages name segment i of a prepared program: "segment 3", or "the
 * added dwell" for the dwell that pads a short program to 360° (it is not in
 * the list the student typed).
 */
export function segmentName(prep, i) {
  const sg = prep.segments[i];
  return sg && sg.implicit ? 'the added dwell' : `segment ${i + 1}`;
}

/**
 * Values at exactly 0, step, 2·step, … 360° (exported data: one row per angle,
 * 1441 rows at 0.25°, whatever the segment lengths). Where two segments meet,
 * the value of the one that starts there; at 360°, the end of the last one.
 * Each sample: { deg, s, v, a, j, segment }, as sample().
 */
export function sampleGrid(prep, step = 0.25) {
  const segs = prep.segments, out = [];
  if (!segs.length) return out;
  const n = Math.round(360 / step);
  for (let i = 0; i <= n; i++) {
    const deg = i === n ? 360 : i * step;
    let k = segs.findIndex((sg) => deg >= sg.start - 1e-9 && deg < sg.end - 1e-9);
    if (k < 0) k = segs.length - 1; // 360°: the end of the turn
    const sg = segs[k];
    const x = Math.min(sg.xEnd, Math.max(0, (deg - sg.start) / sg.beta));
    out.push({ deg, ...sg.f(x), segment: k });
  }
  return out;
}

/** The segment holding cam angle θ (degrees, wrapped into the program). */
function segmentAt(prep, deg) {
  const segs = prep.segments;
  if (!segs.length) return null;
  const t = ((deg % prep.total) + prep.total) % prep.total;
  for (const sg of segs) if (t <= sg.end + 1e-12) return { sg, x: (t - sg.start) / sg.beta };
  const last = segs[segs.length - 1];
  return { sg: last, x: last.xEnd };
}

/**
 * s (mm) and its derivatives with respect to θ (mm/rad, mm/rad², mm/rad³) at
 * cam angle θ (degrees). `prep` comes from prepare().
 */
export function evaluate(prep, deg) {
  const hit = segmentAt(prep, deg);
  if (!hit) return { s: 0, v: 0, a: 0, j: 0, segment: -1 };
  const r = hit.sg.f(Math.min(hit.sg.xEnd, Math.max(0, hit.x)));
  return { ...r, segment: prep.segments.indexOf(hit.sg) };
}

/**
 * Values over one turn at n + 1 equally spaced angles (0 … 360°), with every
 * segment boundary included exactly (both sides) so jumps show in the plots.
 * Each sample: { deg, s, v, a, j, segment }.
 */
export function sample(prep, n = 720) {
  const out = [];
  const total = prep.total || 360;
  for (const sg of prep.segments) {
    const span = sg.end - sg.start;
    const k = Math.max(sg.kind === 'dwell' ? 2 : MIN_SAMPLES, Math.round((n * span) / total));
    for (let i = 0; i <= k; i++) {
      const x = (i / k) * sg.xEnd;
      out.push({ deg: sg.start + x * sg.beta, ...sg.f(x), segment: prep.segments.indexOf(sg) });
    }
  }
  return out;
}

/**
 * The fundamental law of cam design, boundary by boundary (including the
 * join at 360° back to 0°). Returns a list of
 * { at (deg), between: [i, j], jumps: { s, v, a, j } } where a jump is the
 * size of the step (0 when continuous), and a summary.
 */
export function check(prep, tol = 1e-6) {
  const segs = prep.segments;
  const joins = [];
  if (!segs.length) return { joins, sOk: true, vOk: true, aOk: true, jFinite: true, ok: true };
  const scale = Math.max(1, ...segs.map((sg) => Math.abs(sg.s0)), ...segs.map((sg) => Math.abs(sg.s1)));
  for (let i = 0; i < segs.length; i++) {
    const A = segs[i], B = segs[(i + 1) % segs.length];
    const ea = A.f(A.xEnd), eb = B.f(0);
    const d = { s: eb.s - ea.s, v: eb.v - ea.v, a: eb.a - ea.a, j: eb.j - ea.j };
    const big = (k) => Math.abs(d[k]) > tol * scale;
    joins.push({ at: A.end % 360, between: [i, (i + 1) % segs.length], jumps: d, s: big('s'), v: big('v'), a: big('a'), j: big('j') });
  }
  // inside a segment: laws whose acceleration jumps part-way (constant acceleration)
  const inner = segs.filter((sg) => sg.law === 'constAccel' && sg.kind !== 'dwell' && sg.kind !== 'poly').map((sg) => sg.start + sg.beta / 2);
  const sOk = !joins.some((x) => x.s), vOk = !joins.some((x) => x.v), aOk = !joins.some((x) => x.a);
  return { joins, inner, sOk, vOk, aOk, jFinite: sOk && vOk && aOk && !inner.length, ok: sOk && vOk && aOk && !inner.length };
}

/**
 * Peak values over the turn (per radian), with the angle where each occurs.
 * Each: { max, at } for s, v, a, j (largest absolute value; sign kept).
 */
export function peaks(samples) {
  const pk = {};
  for (const k of ['s', 'v', 'a', 'j']) {
    let best = { value: 0, at: 0 };
    for (const sm of samples) if (Math.abs(sm[k]) > Math.abs(best.value)) best = { value: sm[k], at: sm.deg };
    pk[k] = best;
  }
  return pk;
}

/** Time values from per-radian values at camshaft speed ω (rad/s). */
export const toTime = (r, omega) => ({ s: r.s, v: r.v * omega, a: r.a * omega ** 2, j: r.j * omega ** 3 });
