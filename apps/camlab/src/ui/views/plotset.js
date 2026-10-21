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

const RHO_RANGE = 2; // plot ρ within ± this × the prime circle radius

/** Each row: title(ctx) and data(ctx) → { unit, series }. Series with ref: true are guide lines (not exported). */
const ROWS = {
  s: { title: () => 's  displacement', data: (c) => svaj(c, 's') },
  v: { title: () => 'v  velocity', data: (c) => svaj(c, 'v') },
  a: { title: () => 'a  acceleration', data: (c) => svaj(c, 'a') },
  j: { title: () => 'j  jerk', data: (c) => svaj(c, 'j') },
  phi: {
    title: (c) => (c.flat ? 'Contact distance from the follower stem' : `Pressure angle φ (limit ±${RULES.pressureAngleMaxDeg}°)`),
    data(c) {
      const rows = c.r.shape.rows, lim = RULES.pressureAngleMaxDeg;
      if (c.flat) return { unit: c.U.L.label, series: [{ name: 'contact', color: THEME.normal, values: rows.map((x) => c.U.L.show(x.arm - (c.f.e || 0))) }] };
      return { unit: '°', series: [
        { name: 'φ', color: THEME.normal, values: rows.map((x) => (x.phi * 180) / Math.PI) },
        { name: `+${lim}°`, color: THEME.warn, dash: [5, 4], ref: true, values: rows.map(() => lim) },
        { name: `−${lim}°`, color: THEME.warn, dash: [5, 4], ref: true, values: rows.map(() => -lim) }] };
    },
  },
  rho: {
    title: (c) => (c.flat ? 'Radius of curvature ρ = Rb + s + a (must stay above 0)' : `Radius of curvature ρ (+ convex, − concave; shown within ±${RHO_RANGE} Rp)`),
    data(c) {
      const rows = c.r.shape.rows, U = c.U, f = c.f;
      if (c.flat) return { unit: U.L.label, series: [
        { name: 'ρ cam', color: THEME.camEdge, values: rows.map((x) => U.L.show(x.rhoCam)) },
        { name: '0', color: THEME.warn, dash: [5, 4], ref: true, values: rows.map(() => 0) }] };
      // ρ passes through infinity where the curve straightens: show ±RHO_RANGE × Rp, gaps beyond
      const lim = RHO_RANGE * f.Rp;
      const clip = (v) => (Math.abs(v) <= lim ? U.L.show(v) : NaN);
      return { unit: U.L.label, series: [
        { name: 'ρ cam', color: THEME.camEdge, values: rows.map((x) => clip(x.rhoCam)), csv: rows.map((x) => U.L.show(x.rhoCam)) },
        { name: 'ρ pitch', color: THEME.pitch, values: rows.map((x) => clip(x.rhoPitch)), csv: rows.map((x) => U.L.show(x.rhoPitch)) },
        { name: 'Rf', color: THEME.warn, dash: [5, 4], ref: true, values: rows.map(() => U.L.show(f.Rf)) }] };
    },
  },
  F: {
    title: (c) => (c.r.forces.spikes.length ? 'Cam force Fc — infinite where v jumps' : c.r.forces.jump.length ? 'Cam force Fc — below zero: follower jump' : 'Cam force Fc'),
    data(c) {
      const r = c.r, U = c.U, dy = c.doc.dynamics, F = r.forces;
      return { unit: U.F.label, series: [
        { name: 'Fc', color: F.jump.length || F.spikes.length ? THEME.warn : THEME.ink, values: F.rows.map((x) => U.F.show(x.F)) },
        { name: 'spring k·s + Fpl', color: THEME.circles, dash: [6, 4], values: r.samples.map((x) => U.F.show(dy.k * x.s + dy.preload)) },
        { name: 'inertia m·a', color: THEME.pitch, dash: [2, 3], values: r.time.map((x) => U.F.show((dy.m * x.a) / 1000)) },
        { name: '0', color: THEME.muted, ref: true, values: F.rows.map(() => 0) }], extra: c.inf.F };
    },
  },
  T: {
    title: () => 'Camshaft torque Tc',
    data: (c) => ({ unit: c.U.T.label, series: [{ name: 'Tc', color: THEME.ink, values: c.r.forces.rows.map((x) => c.U.T.show(x.T)) }], extra: c.inf.T }),
  },
};

/** s, v, a or j, in time units at ω or per radian of cam; the picked segment in its colour. */
function svaj(c, k) {
  const U = c.U, rows = c.perRad ? c.r.samples : c.r.time;
  const units = c.perRad
    ? { s: [U.L, U.L.label], v: [U.L, `${U.L.label}/rad`], a: [U.L, `${U.L.label}/rad²`], j: [U.L, `${U.L.label}/rad³`] }
    : { s: [U.L, U.L.label], v: [U.V, U.V.label], a: [U.A, U.A.label], j: [U.J, U.J.label] };
  const [q, unit] = units[k];
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
      marks: boundaries(r.samples).map((i) => ({ index: i, label: String(r.samples[i].segment + 1) })),
    };
  }

  function update(what) {
    if (!st) return;
    if (what === 'doc') {
      const c = context();
      for (const key of currentRows()) {
        const d = ROWS[key].data(c);
        st.title(key, ROWS[key].title(c));
        st.set(key, { xs: c.xs, unit: d.unit, series: d.series, markers: [...(d.extra || []), ...c.marks] }); // ∞ first: it wins where marks coincide
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
    /** The plotted numbers of this set: θ and every line that is not a guide line. */
    table() {
      const c = context();
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
