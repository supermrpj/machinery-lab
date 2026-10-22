// =============================================================================
// views/plotset.js — the plots beside the cam, one set at a time
// -----------------------------------------------------------------------------
// The sets are listed in config.js PLOTS (Motion, Size, Forces, Motion and
// force). Every row is defined once below (ROWS) and can appear in any set:
//   s v a j   displacement, velocity, acceleration, jerk (in time at ω, or
//             per radian of cam); ∞ marks where the curve above jumps
//   phi       pressure angle φ with the limit (flat face: contact distance)
//   rho       radius of curvature of the pitch curve and the cam surface
//   F         cam force Fc with the spring and inertia parts; below 0 = jump
//   T         camshaft torque Tc
//   const p = plotPane(el, app)
//   p.show(setId)   p.update(what)   p.table() → { head, rows } for CSV/copy
// =============================================================================

import { plotStack, boundaries } from './plotstack.js';
import { THEME, RULES, PLOTS } from '../../config.js';
import { evaluate } from '../../model/program.js';
import { valuesAt, onGrid } from '../../model/analysis.js';

const RHO_RANGE = 2; // plot ρ within ± this × the prime circle radius

/**
 * Each row: title(ctx) and data(ctx) → { unit, series }. Series with ref: true
 * are guide lines (not exported). at(ctx, x): the first line's value at the
 * exact cam angle, from x = valuesAt() (the reading in the title bar).
 */
const ROWS = {
  s: { title: () => 's  displacement', data: (c) => svaj(c, 's'), at: (c, x) => svajAt(c, x, 's') },
  v: { title: () => 'v  velocity', data: (c) => svaj(c, 'v'), at: (c, x) => svajAt(c, x, 'v') },
  a: { title: () => 'a  acceleration', data: (c) => svaj(c, 'a'), at: (c, x) => svajAt(c, x, 'a') },
  j: { title: () => 'j  jerk', data: (c) => svaj(c, 'j'), at: (c, x) => svajAt(c, x, 'j') },
  phi: {
    title: (c) => (c.flat ? 'Contact distance from the follower stem' : `Pressure angle φ (limit ±${RULES.pressureAngleMaxDeg}°)`),
    data(c) {
      const rows = c.r.shape.rows, lim = RULES.pressureAngleMaxDeg;
      if (c.noCam) return noCamData;
      if (c.flat) return { unit: c.U.L.label, series: [{ name: 'contact', color: THEME.normal, values: rows.map((x) => c.U.L.show(x.arm - (c.f.e || 0))) }] };
      return { unit: '°', series: [
        { name: 'φ', color: THEME.normal, values: rows.map((x) => (x.phi * 180) / Math.PI) },
        { name: `+${lim}°`, color: THEME.warn, dash: [5, 4], ref: true, values: rows.map(() => lim) },
        { name: `−${lim}°`, color: THEME.warn, dash: [5, 4], ref: true, values: rows.map(() => -lim) }] };
    },
    at: (c, x) => (c.noCam ? NaN : c.flat ? c.U.L.show(x.g.arm - (c.f.e || 0)) : (x.g.phi * 180) / Math.PI),
  },
  rho: {
    title: (c) => (c.flat ? 'Radius of curvature ρ = Rb + s + a' : 'Radius of curvature ρ'),
    tip: (c) => (c.flat ? 'ρ = Rb + s + a must stay above 0' : `+ convex, − concave; shown within ±${RHO_RANGE} Rp (it passes through infinity where the curve straightens)`),
    data(c) {
      const rows = c.r.shape.rows, U = c.U, f = c.f;
      if (c.noCam) return noCamData;
      if (c.flat) return { unit: U.L.label, series: [
        { name: 'ρ cam', color: THEME.camEdge, values: rows.map((x) => U.L.show(x.rhoCam)) },
        { name: '0', color: THEME.warn, dash: [5, 4], ref: true, values: rows.map(() => 0) }] };
      // ρ passes through infinity where the curve straightens: show ±RHO_RANGE × Rp, gaps beyond
      const lim = RHO_RANGE * f.Rp;
      const clip = (v) => (Math.abs(v) <= lim ? U.L.show(v) : NaN);
      const [cam, pitch] = cutOutliers([rows.map((x) => clip(x.rhoCam)), rows.map((x) => clip(x.rhoPitch))], [rows.map(() => U.L.show(f.Rf))]);
      return { unit: U.L.label, series: [
        { name: 'ρ cam', color: THEME.camEdge, values: cam, csv: rows.map((x) => U.L.show(x.rhoCam)) },
        { name: 'ρ pitch', color: THEME.pitch, values: pitch, csv: rows.map((x) => U.L.show(x.rhoPitch)) },
        { name: 'Rf', color: THEME.warn, dash: [5, 4], ref: true, values: rows.map(() => U.L.show(f.Rf)) }] };
    },
    at: (c, x) => (c.noCam ? NaN : c.U.L.show(x.g.rhoCam)),
  },
  F: {
    title: (c) => (c.r.forces.spikes.length ? 'Cam force Fc — infinite where v jumps' : c.r.forces.jump.length ? 'Cam force Fc — below zero: follower jump' : 'Cam force Fc'),
    data(c) {
      const r = c.r, U = c.U, dy = c.doc.dynamics, F = r.forces;
      return { unit: U.F.label, series: [
        { name: 'Fc', color: THEME.ink, values: F.rows.map((x) => U.F.show(x.F)) },
        { name: 'spring k·s + Fpl', color: THEME.circles, dash: [6, 4], values: r.samples.map((x) => U.F.show(dy.k * x.s + dy.preload)) },
        { name: 'inertia m·a', color: THEME.pitch, dash: [2, 3], values: r.time.map((x) => U.F.show((dy.m * x.a) / 1000)) },
        { name: '0', color: THEME.muted, ref: true, values: F.rows.map(() => 0) }], extra: c.inf.F };
    },
    at: (c, x) => c.U.F.show(x.F),
  },
  T: {
    title: () => 'Camshaft torque Tc',
    data: (c) => ({ unit: c.U.T.label, series: [{ name: 'Tc', color: THEME.ink, values: c.r.forces.rows.map((x) => c.U.T.show(x.T)) }], extra: c.inf.T }),
    at: (c, x) => c.U.T.show(x.T),
  },
};

/**
 * The plot (packages/plotting LinePlot) cuts its y range at the 2–98 % spread
 * of the values when a few lie far outside it, and then writes "Off-scale near
 * limits" where the legend is. ρ, which runs off towards infinity, is cut here
 * first by the same rule to the same range (leaving gaps), so the legend stays clear.
 * lines: arrays of values (NaN = gap); guides: the guide lines' values (they count too).
 */
function cutOutliers(lines, guides) {
  let out = lines.map((l) => l.slice());
  for (let pass = 0; pass < 5; pass++) {
    const all = [...guides.flat(), ...out.flat()].filter(Number.isFinite).sort((a, b) => a - b);
    if (all.length < 2) break;
    const q = (fr) => all[Math.min(all.length - 1, Math.max(0, Math.round(fr * (all.length - 1))))];
    const lo = q(0.02), hi = q(0.98), span = Math.max(hi - lo, 1e-12);
    if (!(all[0] < lo - 1.5 * span) && !(all[all.length - 1] > hi + 1.5 * span)) break;
    // the plot would show lo − ¼ span … hi + ¼ span: the same here, with gaps where ρ leaves it
    const low = all[0] < lo - 1.5 * span ? lo - 0.25 * span : -Infinity, high = all[all.length - 1] > hi + 1.5 * span ? hi + 0.25 * span : Infinity;
    out = out.map((l) => l.map((v) => (v < low || v > high ? NaN : v)));
  }
  return out;
}

/** A size plot when the sizes make no cam (analysis.js 'size' problems). */
const noCamData = { unit: '', series: [], empty: 'No cam with these sizes.' };

/** The unit of s, v, a or j: [conversion, label], in time at ω or per radian of cam. */
function svajUnit(c, k) {
  const U = c.U;
  const units = c.perRad
    ? { s: [U.L, U.L.label], v: [U.L, `${U.L.label}/rad`], a: [U.L, `${U.L.label}/rad²`], j: [U.L, `${U.L.label}/rad³`] }
    : { s: [U.L, U.L.label], v: [U.V, U.V.label], a: [U.A, U.A.label], j: [U.J, U.J.label] };
  return units[k];
}
const svajAt = (c, x, k) => svajUnit(c, k)[0].show((c.perRad ? x.m : x.t)[k]);

/** s, v, a or j, in time units at ω or per radian of cam; the picked segment in its colour. */
function svaj(c, k) {
  const rows = c.perRad ? c.r.samples : c.r.time;
  const [q, unit] = svajUnit(c, k);
  const vals = rows.map((x) => q.show(x[k]));
  const series = [{ name: k, color: THEME.ink, values: vals }];
  const sel = c.sel;
  if (sel >= 0) series.push({ name: `segment ${sel + 1}`, color: THEME.segment[sel % THEME.segment.length], ref: true, values: rows.map((x, i) => (x.segment === sel ? vals[i] : NaN)) });
  return { unit, series, extra: c.inf[k] || [] };
}

/** Rows of a set that move with the "per radian" switch. */
export const isMotionRow = (key) => ['s', 'v', 'a', 'j'].includes(key);

export function plotPane(el, app) {
  let st = null, setId = null, perRad = false;

  function show(id) {
    const set = PLOTS.sets.find((x) => x.id === id) || PLOTS.sets[0];
    if (set.id === setId && st) return;
    if (st) st.destroy();
    setId = set.id;
    st = plotStack(el, app, set.rows.map((key) => ({ key, title: '' })));
    update('doc');
  }

  /** What every row needs, worked out once per update. */
  function context() {
    const r = app.result(), doc = app.doc;
    const xs = r.samples.map((x) => x.deg);
    const nearest = (deg) => { let bi = 0, bd = Infinity; xs.forEach((x, i) => { const d = Math.abs(x - deg) % 360; const dd = Math.min(d, 360 - d); if (dd < bd) { bd = dd; bi = i; } }); return bi; };
    // ∞ where the curve above jumps: v jumps → a infinite, a jumps → j infinite.
    // Drawn as a spike (arrow) the way the jump goes; where v jumps, j has a
    // spike both ways (the derivative of a spike).
    const jump = (at, k) => {
      const e = 1e-6, after = evaluate(r.prep, (at + e) % 360), before = evaluate(r.prep, (at - e + 360) % 360);
      return Math.sign(after[k] - before[k]);
    };
    // at 0° the spike shows at both ends of the plot (0° and 360°)
    const spike = (at, sign) => [{ index: nearest(at), label: '∞', impulse: sign },
      ...(Math.min(at % 360, 360 - (at % 360)) < 1e-9 ? [{ index: xs.length - 1, label: '∞', impulse: sign }] : [])];
    const inf = { v: [], a: [], j: [] };
    for (const j of r.law.joins) {
      if (j.s) inf.v.push(...spike(j.at, jump(j.at, 's')));
      if (j.s || j.v) inf.a.push(...spike(j.at, j.s ? 0 : jump(j.at, 'v')));
      if (j.s || j.v || j.a) inf.j.push(...spike(j.at, j.s || j.v ? 0 : jump(j.at, 'a')));
    }
    for (const at of r.law.inner || []) inf.j.push(...spike(at, jump(at, 'a')));
    // the cam force and torque are infinite where v jumps (analysis.js forces.spikes)
    inf.F = r.forces.spikes.flatMap((x) => spike(x.at, x.F));
    inf.T = r.forces.spikes.flatMap((x) => spike(x.at, x.T));
    return {
      r, doc, U: app.units, f: doc.follower, flat: doc.follower.type === 'flat', perRad, sel: app.ui.selectedSegment, xs, inf,
      marks: boundaries(r.samples).map((i) => ({ index: i, label: r.prep.segments[r.samples[i].segment].implicit ? 'added' : String(r.samples[i].segment + 1) })),
      noCam: r.problems.some((p) => p.kind === 'size') || !r.valid,
    };
  }

  function update(what) {
    if (!st) return;
    if (what === 'doc') {
      const c = context();
      for (const key of currentRows()) {
        const d = ROWS[key].data(c);
        st.title(key, ROWS[key].title(c), ROWS[key].tip ? ROWS[key].tip(c) : '');
        // the reading in the title: at the exact cam angle, as the bar at the bottom and the cam
        const at = (deg) => ROWS[key].at(c, valuesAt(c.doc, c.r, deg));
        st.set(key, { xs: c.xs, unit: d.unit, series: d.series, empty: d.empty, at, markers: [...(d.extra || []), ...c.marks] }); // ∞ first: it wins where marks coincide
      }
    }
    st.cursor();
  }

  const currentRows = () => (PLOTS.sets.find((x) => x.id === setId) || PLOTS.sets[0]).rows;

  return {
    show, update,
    get set() { return setId; },
    get perRad() { return perRad; },
    setPerRad(on) { perRad = on; update('doc'); },
    hasMotion: () => currentRows().some(isMotionRow),
    /** The plotted numbers of this set: θ and every line that is not a guide line, at exactly 0, 0.25, … 360°. */
    table() {
      const c0 = context(), grid = onGrid(app.doc, c0.r);
      const c = { ...c0, r: { ...c0.r, ...grid }, xs: grid.samples.map((x) => x.deg) };
      const head = ['theta (deg)'], cols = [];
      for (const key of currentRows()) {
        const d = ROWS[key].data(c);
        for (const s of d.series) {
          if (s.ref) continue;
          head.push(`${s.name} (${d.unit})`);
          cols.push(s.csv || s.values);
        }
      }
      const rows = c.xs.map((x, i) => [x, ...cols.map((col) => col[i])]);
      return { head, rows };
    },
  };
}
