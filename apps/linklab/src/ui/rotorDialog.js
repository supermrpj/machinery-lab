// =============================================================================
// rotorDialog.js — rotor balancing calculator
// -----------------------------------------------------------------------------
// Three ways in:
//   Single plane     masses m at radius R and angle θ → one correction m·R
//   Two planes       the same with each mass's distance l from plane A, and
//                    plane B at lB → a correction m·R in each plane
//   Bearing forces   forces measured at two bearings on a balancing machine,
//                    with their phase angles and positions → m·R in A and B
// For each correction, give a radius and the mass follows. Values use the
// mass, length and force units chosen in the Units menu (top bar). The numbers typed
// stay for the session.
//
// Before the correction, at the speed given: the shaking force (and, for two
// planes, the shaking moment) the unbalance makes, with a graph of the force
// against speed (it grows with the square of the speed).
// Examples: a car wheel (single plane) and a shaft with three discs that is
// statically balanced but not dynamically (two planes). EXAMPLES below.
// =============================================================================

import { h } from '../../../../packages/ui-kit/src/dom.js';
import { fmt, fmtSig, parseNum } from '../../../../packages/ui-kit/src/format.js';
import { rotorStatic, rotorDynamic, rotorFromBearings, rotorUnbalance } from '../model/balance.js';
import { LinePlot } from '../../../../packages/plotting/src/linePlot.js';

// ---- CONFIG: built-in examples (SI: kg, mm; converted to the units in use) ----
const EXAMPLES = [
  {
    id: 'wheel', name: 'Car wheel (single plane)', mode: 'static',
    note: 'A car wheel and tyre, thin enough to balance in one plane. The balancing machine finds three heavy spots: the tyre (24 g at 300 mm), the valve (6 g at 200 mm) and the rim casting (10 g at 190 mm). Clip-on weights go on the rim lip, R = 190 mm. 830 rpm is about 100 km/h for this wheel.',
    masses: [{ m: 0.024, R: 300, angle: 30 }, { m: 0.006, R: 200, angle: 160 }, { m: 0.010, R: 190, angle: 255 }],
    R: 190, rpm: 830,
  },
  {
    id: 'shaft', name: 'Shaft with three discs (two planes)', mode: 'dynamic',
    note: 'A shaft with three discs, each with the same unbalance m·R = 12 kg·mm, 120° apart. Σ m·R = 0, so it stays put in any position on knife edges (statically balanced), yet it shakes when it turns. Correct it in planes A (l = 0) and B (l = 500 mm) at R = 75 mm.',
    masses: [{ m: 0.20, R: 60, angle: 0, l: 100 }, { m: 0.15, R: 80, angle: 120, l: 250 }, { m: 0.24, R: 50, angle: 240, l: 400 }],
    lB: 500, RA: 75, RB: 75, rpm: 1500,
  },
];
// the speed graph runs from 0 to this × the speed given
const SPEED_PLOT_SPAN = 1.5;

const st = {
  mode: 'static',
  masses: [{ m: 1, R: 100, angle: 0, l: 100 }, { m: 1, R: 100, angle: 90, l: 300 }],
  lB: 400, R: 100, RA: 100, RB: 100, rpm: 1000,
  example: null, // the example loaded (its note shows while its kind of balancing is chosen)
  bearing: { F1: 0, th1: 0, l1: 0, F2: 0, th2: 0, l2: 0, lB: 0, rpm: 600 },
};

const MODES = [
  { id: 'static', name: 'Single plane' },
  { id: 'dynamic', name: 'Two planes' },
  { id: 'bearing', name: 'Bearing forces' },
];

export function openRotorDialog(app) {
  const U = app.units;
  const ML = `${U.M.label}·${U.label}`;
  const d = h('dialog', { class: 'rotor-dlg', 'aria-label': 'Rotor balancing' });
  const body = h('div', { class: 'dlg-body' });
  const out = h('div', {});
  d.append(
    h('div', { class: 'dlg-head' }, h('h2', {}, 'Rotor balancing'),
      h('button', { class: 'btn', onclick: () => d.close() }, 'Close')),
    body);
  d.addEventListener('close', () => d.remove());

  // a number box that writes into obj[key] and redraws the results
  const num = (obj, key, label, unit, opts = {}) => h('label', { class: 'rf' },
    h('span', {}, label),
    h('input', {
      type: 'number', step: 'any', value: obj[key], min: opts.min, 'aria-label': `${label}${unit ? ` (${unit})` : ''}`,
      oninput: (e) => { const v = parseNum(e.target.value); if (Number.isFinite(v)) { obj[key] = v; results(); } },
    }),
    h('span', { class: 'sub' }, unit || ''));

  /** Load a built-in example (converted to the units in use). */
  const load = (ex) => {
    st.mode = ex.mode; st.example = ex.id;
    st.masses = ex.masses.map((k) => ({ m: +U.M.show(k.m).toPrecision(6), R: +U.len(k.R).toPrecision(6), angle: k.angle, l: +U.len(k.l || 0).toPrecision(6) }));
    for (const key of ['R', 'RA', 'RB', 'lB']) if (ex[key] !== undefined) st[key] = +U.len(ex[key]).toPrecision(6);
    st.rpm = ex.rpm;
    render();
  };

  function render() {
    const parts = [];
    parts.push(h('div', { class: 'row-buttons' },
      h('select', { 'aria-label': 'Open an example', onchange: (e) => { const ex = EXAMPLES.find((x) => x.id === e.target.value); if (ex) load(ex); } },
        h('option', { value: '' }, 'Examples…'),
        EXAMPLES.map((ex) => h('option', { value: ex.id, selected: st.example === ex.id }, ex.name)))));
    const ex = EXAMPLES.find((x) => x.id === st.example && x.mode === st.mode);
    if (ex) parts.push(h('p', { class: 'note' }, h('b', {}, `${ex.name}. `), ex.note));
    parts.push(h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Kind of balancing' },
      MODES.map((m) => h('button', {
        class: `seg-btn${st.mode === m.id ? ' on' : ''}`, role: 'radio', 'aria-checked': String(st.mode === m.id),
        onclick: () => { st.mode = m.id; st.example = null; render(); },
      }, m.name))));

    if (st.mode === 'bearing') {
      const b = st.bearing;
      parts.push(h('p', { class: 'note' }, 'Forces measured at the two bearings while the rotor turns, with their phase angles. Distances are from correction plane A; plane B is lB from A.'));
      parts.push(h('div', { class: 'rotor-grid' },
        h('div', { class: 'cg-col' }, h('div', { class: 'cg-head' }, 'Bearing 1'),
          num(b, 'F1', 'F₁', U.F.label), num(b, 'th1', 'θ₁', '°'), num(b, 'l1', 'l₁', U.label)),
        h('div', { class: 'cg-col' }, h('div', { class: 'cg-head' }, 'Bearing 2'),
          num(b, 'F2', 'F₂', U.F.label), num(b, 'th2', 'θ₂', '°'), num(b, 'l2', 'l₂', U.label))));
      parts.push(h('div', { class: 'rotor-grid' },
        h('div', { class: 'cg-col' }, num(b, 'lB', 'lB', U.label), num(b, 'rpm', 'Speed', 'rpm', { min: 0 })),
        h('div', { class: 'cg-col' }, num(st, 'RA', 'R in A', U.label, { min: 0 }), num(st, 'RB', 'R in B', U.label, { min: 0 }))));
    } else {
      const two = st.mode === 'dynamic';
      parts.push(h('p', { class: 'note' }, two
        ? 'Each mass at radius R, angle θ, and distance l along the shaft from plane A. Plane B is lB from A.'
        : 'Each mass at radius R and angle θ, all in one plane (or a thin disc).'));
      parts.push(h('table', { class: 'data rotor-masses' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, `m (${U.M.label})`), h('th', {}, `R (${U.label})`), h('th', {}, 'θ (°)'),
          two ? h('th', {}, `l (${U.label})`) : null, h('th', {}, ''))),
        h('tbody', {}, st.masses.map((k, i) => h('tr', {},
          h('td', {}, String(i + 1)),
          h('td', {}, cell(k, 'm', `Mass ${i + 1}`)),
          h('td', {}, cell(k, 'R', `Radius ${i + 1}`)),
          h('td', {}, cell(k, 'angle', `Angle ${i + 1}`)),
          two ? h('td', {}, cell(k, 'l', `Distance ${i + 1} from plane A`)) : null,
          h('td', {}, st.masses.length > 1
            ? h('button', { class: 'btn small', 'aria-label': `Remove mass ${i + 1}`, onclick: () => { st.masses.splice(i, 1); render(); } }, '×')
            : null))))));
      parts.push(h('div', { class: 'row-buttons' },
        h('button', { class: 'btn small', onclick: () => { st.masses.push({ m: 1, R: 100, angle: 0, l: 0 }); render(); } }, 'Add a mass')));
      parts.push(h('div', { class: 'rotor-grid' }, two
        ? [h('div', { class: 'cg-col' }, num(st, 'lB', 'lB', U.label, { min: 0 }), num(st, 'rpm', 'Speed', 'rpm', { min: 0 })),
          h('div', { class: 'cg-col' }, num(st, 'RA', 'R in A', U.label, { min: 0 }), num(st, 'RB', 'R in B', U.label, { min: 0 }))]
        : [h('div', { class: 'cg-col' }, num(st, 'R', 'R', U.label, { min: 0 })),
          h('div', { class: 'cg-col' }, num(st, 'rpm', 'Speed', 'rpm', { min: 0 }))]));
    }
    parts.push(out);
    body.replaceChildren(...parts);
    results();
  }

  function cell(obj, key, label) {
    return h('input', {
      type: 'number', step: 'any', class: 'mini', value: obj[key], 'aria-label': label,
      oninput: (e) => { const v = parseNum(e.target.value); if (Number.isFinite(v)) { obj[key] = v; results(); } },
    });
  }

  // one correction: m·R ∠ θ, and the mass at the chosen radius
  const line = (name, v, R, weight) => h('div', {},
    h('b', {}, name), ': m·R = ', h('b', {}, `${fmtSig(v.mag, 4)} ${ML}`), ` at θ = ${fmt(v.angle < 0 ? v.angle + 360 : v.angle, 2)}°`,
    R > 0 ? [`; at R = ${fmtSig(R, 4)} ${U.label}, m = `, h('b', {}, `${fmtSig(v.mag / R, 4)} ${U.M.label}`)] : null,
    weight !== undefined ? ` (weight ${fmtSig(U.F.show(weight), 3)} ${U.F.label})` : null);

  function results() {
    const lines = [];
    let arrows = [];
    if (st.mode === 'static') {
      const r = rotorStatic(st.masses);
      lines.push(line('Correction', r, st.R));
      arrows = [...massArrows(), { v: r, name: 'b', corr: true }];
    } else if (st.mode === 'dynamic') {
      if (!(st.lB > 0)) lines.push(h('div', {}, 'Give lB, the distance between the planes.'));
      else {
        const r = rotorDynamic(st.masses, st.lB);
        lines.push(line('Plane A', r.A, st.RA), line('Plane B', r.B, st.RB));
        arrows = [...massArrows(), { v: r.A, name: 'A', corr: true }, { v: r.B, name: 'B', corr: true }];
      }
    } else {
      const b = st.bearing, omega = (b.rpm * 2 * Math.PI) / 60;
      if (!(b.lB > 0) || !(omega > 0)) lines.push(h('div', {}, 'Give lB and the speed.'));
      else {
        // forces in N; distances stay in the length unit, so m·R comes out in kg·(unit)
        const r = rotorFromBearings({
          F1: U.F.si(b.F1), th1: b.th1, l1: b.l1, F2: U.F.si(b.F2), th2: b.th2, l2: b.l2,
          lB: b.lB, omega, RA: st.RA, RB: st.RB, unitPerMetre: 1000 / U.mm(1),
        });
        const shown = (v) => ({ ...v, mag: U.M.show(v.mag) });
        lines.push(line('Plane A', shown(r.A), st.RA, r.A.weight), line('Plane B', shown(r.B), st.RB, r.B.weight));
        arrows = [{ v: shown(r.A), name: 'A', corr: true }, { v: shown(r.B), name: 'B', corr: true }];
      }
    }
    out.replaceChildren(
      st.mode !== 'bearing' ? beforeCorrection() : '',
      h('div', { class: 'subhead' }, 'Correction'),
      h('div', { class: 'formula' }, lines),
      arrows.length ? endView(arrows) : '',
      h('p', { class: 'note' }, st.mode === 'bearing'
        ? 'm·R_B = (F₁l₁ + F₂l₂)/(lB ω²) and m·R_A = (F₁ + F₂)/ω² − m·R_B, component by component.'
        : st.mode === 'dynamic'
          ? 'Σ m R l + m_B R_B lB = 0 (moments about A), then Σ m R + m_A R_A + m_B R_B = 0.'
          : 'Σ m R + m_b R_b = 0: the correction cancels the sum of the m·R vectors.'));
  }

  /**
   * What the unbalance does before the correction: Σ m·R (and Σ m·R·l), the
   * shaking force (and moment) at the speed given, and a graph of the force
   * against speed. Masses and lengths in the units in use; forces in SI then shown.
   */
  function beforeCorrection() {
    const two = st.mode === 'dynamic';
    const u = rotorUnbalance(st.masses.map((k) => ({ ...k, l: two ? k.l : undefined })));
    const kgm = (mR) => U.M.si(mR) * U.mm(1) / 1000;             // m·R shown → kg·m
    const kgm2 = (mRl) => U.M.si(mRl) * (U.mm(1) / 1000) ** 2;   // m·R·l shown → kg·m²
    const omega = ((st.rpm || 0) * 2 * Math.PI) / 60;
    const F = kgm(u.force.mag) * omega * omega;                  // N
    const M = u.moment ? kgm2(u.moment.mag) * omega * omega : 0;  // N·m
    const tiny = (v, ref) => v <= 1e-9 * Math.max(1, ref);
    const ref = st.masses.reduce((s, k) => s + Math.abs(k.m * k.R), 0);
    const rows = [
      h('div', {}, 'Σ m·R = ', h('b', {}, tiny(u.force.mag, ref) ? `0 ${ML}` : `${fmtSig(u.force.mag, 4)} ${ML}`),
        tiny(u.force.mag, ref) ? ' — statically balanced: it stays put in any position on knife edges.' : ` at θ = ${fmt((u.force.angle + 360) % 360, 1)}°`),
    ];
    if (two && u.moment) {
      rows.push(h('div', {}, 'Σ m·R·l = ', h('b', {}, `${fmtSig(u.moment.mag, 4)} ${U.M.label}·${U.label}²`),
        tiny(u.moment.mag, ref * (st.lB || 1)) ? ' — no couple.' : ` at θ = ${fmt((u.moment.angle + 360) % 360, 1)}° (a couple: it rocks the shaft end to end)`));
    }
    if (omega > 0) {
      rows.push(h('div', {}, `At ${+(+st.rpm).toPrecision(4)} rpm: shaking force `, h('b', {}, `${fmtSig(U.F.show(F), 3)} ${U.F.label}`),
        two && u.moment ? [', shaking moment about A ', h('b', {}, `${fmtSig(U.T.show(M), 3)} ${U.T.label}`)] : null, '.'));
    }
    const parts = [h('div', { class: 'subhead' }, 'Before the correction'), h('div', { class: 'formula' }, rows)];
    // the graph: the shaking force against speed, or the moment when there is no force (a pure couple)
    const hasF = !tiny(u.force.mag, ref);
    const hasM = two && u.moment && !tiny(u.moment.mag, ref * (st.lB || 1));
    if (omega > 0 && (hasF || hasM)) {
      const box = h('div', { class: 'rotor-plot', role: 'img', 'aria-label': hasF ? 'Shaking force against speed' : 'Shaking moment against speed' });
      parts.push(box);
      if (!hasF) parts.push(h('p', { class: 'note' }, 'No shaking force, but the couple still shakes the bearings: this is why a shaft is balanced in two planes.'));
      // drawn once the box is in the page (it needs its size)
      requestAnimationFrame(() => {
        if (!box.isConnected) return;
        const top = Math.max(1, st.rpm * SPEED_PLOT_SPAN), n = 60;
        const xs = Array.from({ length: n + 1 }, (_, i) => (top * i) / n);
        const w2 = (r) => ((r * 2 * Math.PI) / 60) ** 2;
        const plot = new LinePlot(box, { formatY: (v) => String(+(+v).toPrecision(3)), expandable: false });
        plot.setData(hasF
          ? { x: xs, xName: 'rpm', yLabel: `Shaking force (${U.F.label}) against speed (rpm)`, legend: false,
            series: [{ name: 'F', color: '#E5484D', values: xs.map((r) => U.F.show(kgm(u.force.mag) * w2(r))) }] }
          : { x: xs, xName: 'rpm', yLabel: `Shaking moment (${U.T.label}) against speed (rpm)`, legend: false,
            series: [{ name: 'M', color: '#E5484D', values: xs.map((r) => U.T.show(kgm2(u.moment.mag) * w2(r))) }] });
        plot.setCursor(st.rpm);
      });
    }
    return h('div', {}, parts);
  }

  const massArrows = () => st.masses.map((k, i) => {
    const a = (k.angle * Math.PI) / 180, mag = Math.abs(k.m * k.R);
    return { v: { x: k.m * k.R * Math.cos(a), y: k.m * k.R * Math.sin(a), mag }, name: String(i + 1) };
  });

  render();
  document.body.append(d);
  d.showModal();
}

/** End view of the shaft: each m·R as an arrow from the axis; corrections in red. */
function endView(arrows) {
  const S = 220, c = S / 2, big = Math.max(...arrows.map((a) => a.v.mag), 1e-12), k = (c - 26) / big;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [n, v] of Object.entries(attrs)) e.setAttribute(n, v); if (text) e.textContent = text; return e; };
  const svg = el('svg', { viewBox: `0 0 ${S} ${S}`, width: S, height: S, role: 'img', 'aria-label': 'End view of the m·R vectors' });
  svg.append(el('circle', { cx: c, cy: c, r: c - 22, fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.25, 'stroke-dasharray': '3 3' }));
  svg.append(el('line', { x1: 8, y1: c, x2: S - 8, y2: c, stroke: 'currentColor', 'stroke-opacity': 0.2 }));
  svg.append(el('line', { x1: c, y1: 8, x2: c, y2: S - 8, stroke: 'currentColor', 'stroke-opacity': 0.2 }));
  for (const a of arrows) {
    if (!(a.v.mag > 0)) continue;
    const x = c + a.v.x * k, y = c - a.v.y * k, col = a.corr ? '#E5484D' : '#1F2328';
    const ang = Math.atan2(y - c, x - c), hd = 7;
    svg.append(el('line', { x1: c, y1: c, x2: x, y2: y, stroke: col, 'stroke-width': a.corr ? 2.5 : 1.8 }));
    svg.append(el('path', { d: `M${x},${y} L${x - hd * Math.cos(ang - 0.4)},${y - hd * Math.sin(ang - 0.4)} L${x - hd * Math.cos(ang + 0.4)},${y - hd * Math.sin(ang + 0.4)}Z`, fill: col }));
    svg.append(el('text', { x: x + 9 * Math.cos(ang), y: y + 9 * Math.sin(ang) + 4, 'text-anchor': 'middle', class: 'pv-t', fill: col }, a.name));
  }
  svg.append(el('circle', { cx: c, cy: c, r: 3, fill: '#1F2328' }));
  return h('div', { class: 'mass-preview' }, svg);
}
