// =============================================================================
// inputs.js — the left panel: everything the student designs
// -----------------------------------------------------------------------------
//   Motion program      segments (rise / dwell / fall / polynomial), each with
//                       its duration β, lift h and law; the total must be 360°
//   Follower and size   roller or flat face, prime (or base) circle, roller
//                       radius, eccentricity, direction of rotation
//   Speed               camshaft ω (rad/s or rpm)
//   Spring and mass     for the force analysis
//   Part and mounting   thickness, shaft Ø, print clearance and how the cam
//                       fixes to its shaft (model/mounting.js), for export
// Values are typed in the chosen units and stored in mm, N, kg.
// =============================================================================

import { h, icon, replaceChildren } from '../../../../packages/ui-kit/src/dom.js';
import { fmt, parseNum } from '../../../../packages/ui-kit/src/format.js';
import { ICONS } from './icons.js';
import { LAWS, LAW_ORDER } from '../model/laws.js';
import { THEME, RULES, MOUNTING, PLOTS } from '../config.js';
import { showNum } from './numbers.js';

const KIND_NAMES = { rise: 'Rise', dwell: 'Dwell', fall: 'Fall', poly: 'Polynomial' };
const COND_NAMES = ['s =', 'v = 0', 'a = 0', 'j = 0'];

// ---- CONFIG -------------------------------------------------------------------
const ADD_DWELL = 30;   // degrees: the dwell "Add segment" adds to a program that already fills the turn
// -------------------------------------------------------------------------------

export function buildInputs(el, app) {
  const openState = { program: true, follower: true, speed: true, spring: false, part: false };
  const section = (key, title, body) => h('details', {
    class: 'panel', open: openState[key],
    ontoggle: (e) => { openState[key] = e.target.open; },
  }, h('summary', {}, title), h('div', { class: 'panel-body' }, body));

  /**
   * A number box in the chosen unit `q` (or plain), stored on change.
   * opts.auto: the value used when the box is left empty (shown greyed); an
   * empty box then stores null. opts.name: what a message about a value out
   * of range calls the box (default: its label).
   */
  function num(key, label, stored, q, set, opts = {}) {
    const shown = q ? q.show(stored) : stored;
    const auto = opts.auto !== undefined && Number.isFinite(opts.auto) ? +(+(q ? q.show(opts.auto) : opts.auto)).toPrecision(4) : null;
    const input = h('input', {
      type: 'number', step: opts.step || 'any', min: opts.min, value: stored !== null && Number.isFinite(shown) ? +(+shown).toPrecision(6) : '',
      placeholder: auto !== null ? `${auto} (auto)` : null,
      'data-key': key, 'aria-label': `${label}${q ? ` (${q.label})` : opts.unit ? ` (${opts.unit})` : ''}`,
      onchange: (e) => {
        if (opts.auto !== undefined && e.target.value.trim() === '') { set(null); return; }
        const v = e.target.value.trim() === '' ? null : parseNum(e.target.value);
        if (v === null) { update(); return; } // empty: the stored value comes back
        const low = (opts.min !== undefined && v < opts.min) || (opts.positive && !(v > 0));
        // a value out of range is put back, and said (not reverted in silence)
        if (low) { app.ui.flash(`${opts.name || label} must be ${opts.positive ? 'above 0' : `${opts.min} or more`}.`, true); update(); return; }
        set(q ? q.store(v) : v);
      },
    });
    return h('div', { class: 'field' }, h('label', {}, label),
      h('div', { class: 'with-unit' }, input, h('span', { class: 'unit' }, q ? q.label : opts.unit || '')));
  }

  const segBtn = (options, value, onPick, cls = '') => h('div', { class: `seg ${cls}`, role: 'radiogroup' },
    options.map(([v, label]) => h('button', {
      class: `seg-btn${value === v ? ' on' : ''}`, role: 'radio', 'aria-checked': String(value === v), onclick: () => onPick(v),
    }, label)));

  // ---- motion program ----
  function programSection() {
    const U = app.units, r = app.result();
    const segs = app.doc.program.segments;
    if (app.ui.selectedSegment >= segs.length) app.ui.selectedSegment = -1;
    const sel = app.ui.selectedSegment;
    const cards = segs.map((sg, i) => segmentCard(sg, i, segs.length, r, sel === i));
    const prep = r.prep;
    const total = prep.given;
    const missing = 360 - total;
    // a short program has its own button below (Add a dwell); a long one says what is left out.
    // Size problems are shown under Follower and size.
    const problems = r.problems.filter((p) => ['segment', 'poly', 'level'].includes(p.kind) || (p.kind === 'total' && p.over));
    // the last fall can be set to close the program only if it is used whole (not cut or left out at 360°)
    const lastFallAt = segs.map((s) => s.kind).lastIndexOf('fall');
    const lastPrep = prep.segments[lastFallAt];
    const lastFall = lastFallAt >= 0 && lastPrep && !lastPrep.implicit && lastPrep.xEnd === 1
      && segs.slice(lastFallAt + 1).every((s) => s.kind === 'dwell') && lastPrep.s0 > 0
      ? [segs[lastFallAt], lastFallAt] : null;
    return [
      h('div', { class: 'segs' }, cards),
      h('div', { class: 'total' },
        h('span', {}, `Total ${fmt(total, 1)}°`),
        Math.abs(missing) < 1e-6 ? h('span', { class: 'tag good' }, '360° ✓')
          : missing > 0 ? h('button', { class: 'btn small', onclick: () => app.edit('Fill to 360°', (d) => { d.program.segments.push({ kind: 'dwell', beta: +missing.toFixed(6) }); }) }, `Add a ${fmt(missing, 1)}° dwell`)
            : h('span', { class: 'tag warn' }, `${fmt(-missing, 1)}° too many`)),
      problems.map((p) => h('div', { class: 'warn-note' }, p.text,
        p.kind === 'level' && lastFall ? [' ', h('button', { class: 'btn small', onclick: () => app.edit('Return to the start', (d) => {
          const k = lastFall[1];
          const start = prep.segments[k].s0;
          d.program.segments[k].h = Math.abs(start);
        }) }, 'Let the last fall return to 0')] : null)),
      h('div', { class: 'row-buttons' },
        h('button', { class: 'btn', onclick: addSegment }, icon(ICONS.plus, 14), ' Add segment')),
      h('p', { class: 'note' }, `Lift in ${U.key === 'us' ? 'inches' : 'mm'}, durations in degrees of cam rotation. Click a segment to mark it on the plots.`),
    ];
  }

  /**
   * Add a dwell at the end. A short program gets the rest of the turn; a full
   * one gets a dwell of ADD_DWELL (at most half the last segment) taken from
   * the last segment, so the turn stays 360° (said in a message).
   */
  function addSegment() {
    const segs = app.doc.program.segments, total = app.result().prep.given;
    const left = 360 - total;
    if (left > 1e-6) { app.edit('Add segment', (d) => { d.program.segments.push({ kind: 'dwell', beta: +left.toFixed(6) }); }); return; }
    const n = segs.length, lastBeta = +segs[n - 1].beta, take = +Math.min(ADD_DWELL, lastBeta / 2).toFixed(6);
    app.edit('Add segment', (d) => { const a = d.program.segments; a[n - 1].beta = +(lastBeta - take).toFixed(6); a.push({ kind: 'dwell', beta: take }); });
    app.ui.flash(`Added a ${+take.toFixed(2)}° dwell, taken from segment ${n} (now ${+(lastBeta - take).toFixed(2)}°), so the total stays ${+total.toFixed(2)}°.`);
  }

  function segmentCard(sg, i, n, r, selected) {
    const U = app.units;
    const set = (label, fn) => app.edit(label, (d) => fn(d.program.segments[i], d));
    const color = THEME.segment[i % THEME.segment.length];
    const kind = h('select', { 'aria-label': `Segment ${i + 1} kind`, 'data-key': `kind${i}`, onchange: (e) => set('Change segment', (s, d) => changeKind(s, e.target.value, i, d)) },
      // a kind or law not known (from a file) is shown as what is used instead: a dwell, cycloidal
      Object.entries(KIND_NAMES).map(([k, name]) => h('option', { value: k, selected: (KIND_NAMES[sg.kind] ? sg.kind : 'dwell') === k }, name)));
    const head = h('div', { class: 'seg-head' },
      h('span', { class: 'seg-num', style: { background: color }, title: `Segment ${i + 1}` }, String(i + 1)),
      kind,
      h('button', { class: 'ibtn', title: 'Move up', 'aria-label': `Move segment ${i + 1} up`, disabled: i === 0, onclick: () => { follow(i, i - 1); app.edit('Move segment', (d) => { const a = d.program.segments; [a[i - 1], a[i]] = [a[i], a[i - 1]]; }); } }, icon(ICONS.up, 16)),
      h('button', { class: 'ibtn', title: 'Move down', 'aria-label': `Move segment ${i + 1} down`, disabled: i === n - 1, onclick: () => { follow(i, i + 1); app.edit('Move segment', (d) => { const a = d.program.segments; [a[i + 1], a[i]] = [a[i], a[i + 1]]; }); } }, icon(ICONS.down, 16)),
      h('button', { class: 'ibtn', title: 'Delete', 'aria-label': `Delete segment ${i + 1}`, disabled: n <= 1, onclick: () => { follow(i, null); app.edit('Delete segment', (d) => { d.program.segments.splice(i, 1); }); } }, icon(ICONS.close, 16)));
    const beta = h('label', {}, 'β', h('input', { type: 'number', step: 'any', min: 0, value: sg.beta, 'data-key': `beta${i}`, 'aria-label': `Segment ${i + 1} duration in degrees`,
      onchange: (e) => { const v = e.target.value.trim() === '' ? null : parseNum(e.target.value); if (v > 0) set('Change duration', (s) => { s.beta = v; }); else { if (v !== null) app.ui.flash('β must be above 0°.', true); update(); } } }), h('span', { class: 'sub' }, '°'));
    const parts = [head];
    if (sg.kind === 'rise' || sg.kind === 'fall') {
      const lift = h('label', {}, 'h', h('input', { type: 'number', step: 'any', min: 0, value: +U.L.show(Math.abs(sg.h || 0)).toPrecision(6), 'data-key': `h${i}`, 'aria-label': `Segment ${i + 1} lift in ${U.L.label}`,
        onchange: (e) => { const v = e.target.value.trim() === '' ? null : parseNum(e.target.value); if (v > 0) set('Change lift', (s) => { s.h = U.L.store(v); }); else { if (v !== null) app.ui.flash('h must be above 0.', true); update(); } } }), h('span', { class: 'sub' }, U.L.label));
      parts.push(h('div', { class: 'seg-row' }, beta, lift));
      const law = LAWS[sg.law] || LAWS.cycloidal;
      parts.push(h('div', { class: 'seg-law' },
        h('select', { 'aria-label': `Segment ${i + 1} law`, title: law.note, 'data-key': `law${i}`, onchange: (e) => set('Change law', (s) => { s.law = e.target.value; }) },
          LAW_ORDER.map((k) => h('option', { value: k, selected: (LAWS[sg.law] ? sg.law : 'cycloidal') === k }, LAWS[k].name)))));
    } else if (sg.kind === 'poly') {
      parts.push(h('div', { class: 'seg-row' }, beta, h('span', { class: 'sub', style: { alignSelf: 'center' } }, `degree ${Math.max(0, (sg.conditions || []).length - 1)}`)));
      parts.push(conditionsTable(sg, i, set));
    } else {
      parts.push(h('div', { class: 'seg-row' }, beta, h('span', {})));
    }
    return h('div', {
      class: `seg-card${selected ? ' selected' : ''}`,
      onclick: (e) => { if (!/INPUT|SELECT|BUTTON|OPTION/.test(e.target.tagName)) app.ui.selectSegment(selected ? -1 : i); },
    }, parts);
  }

  /** Keep the picked segment the same one when segment i moves to j (or is deleted: j = null). */
  function follow(i, j) {
    const sel = app.ui.selectedSegment;
    if (sel < 0) return;
    if (j === null) app.ui.selectedSegment = sel === i ? -1 : sel > i ? sel - 1 : sel;
    else app.ui.selectedSegment = sel === i ? j : sel === j ? i : sel;
  }

  /** Polynomial segment: its boundary conditions. */
  function conditionsTable(sg, i, set) {
    const U = app.units;
    const conds = sg.conditions || [];
    const rows = conds.map((c, k) => h('tr', {},
      h('td', {}, h('input', { type: 'number', step: 'any', min: 0, max: 100, value: +(c.at * 100).toPrecision(6), 'data-key': `cat${i}-${k}`, 'aria-label': `Condition ${k + 1}: where, percent of the segment`,
        onchange: (e) => {
          const v = parseNum(e.target.value);
          if (v !== null && v >= 0 && v <= 100) { set('Change condition', (s) => { s.conditions[k].at = v / 100; }); return; }
          if (v !== null) app.ui.flash('Where (at %) must be from 0 to 100.', true);
          update(); // the stored value comes back
        } })),
      h('td', {}, h('select', { 'aria-label': `Condition ${k + 1}: what`, 'data-key': `cd${i}-${k}`, onchange: (e) => set('Change condition', (s) => { s.conditions[k].d = +e.target.value; if (+e.target.value > 0) s.conditions[k].value = 0; }) },
        COND_NAMES.map((name, d) => h('option', { value: d, selected: c.d === d }, name)))),
      h('td', {}, c.d === 0 ? h('input', { type: 'number', step: 'any', value: +U.L.show(c.value).toPrecision(6), 'data-key': `cv${i}-${k}`, 'aria-label': `Condition ${k + 1}: s in ${U.L.label}`,
        onchange: (e) => { const v = parseNum(e.target.value); if (v !== null) set('Change condition', (s) => { s.conditions[k].value = U.L.store(v); }); } }) : h('span', { class: 'sub' }, '')),
      h('td', {}, h('button', { class: 'ibtn', 'aria-label': `Remove condition ${k + 1}`, onclick: () => set('Remove condition', (s) => { s.conditions.splice(k, 1); }) }, icon(ICONS.close, 14)))));
    return h('div', {},
      h('table', { class: 'cond-table' },
        h('colgroup', {}, h('col', { class: 'at' }), h('col', { class: 'what' }), h('col', {}), h('col', { class: 'x' })),
        h('thead', {}, h('tr', {}, h('th', { class: 'sub' }, 'at %'), h('th', { class: 'sub' }, ''), h('th', { class: 'sub' }, `s (${U.L.label})`), h('th', {}))),
        h('tbody', {}, rows)),
      h('div', { class: 'row-buttons', style: { marginTop: '4px' } },
        h('button', { class: 'btn small', onclick: () => set('Add condition', (s) => { (s.conditions = s.conditions || []).push({ at: 0.5, d: 0, value: 0 }); }) }, 'Add condition')));
  }

  /** Change a segment's kind, keeping sensible values. */
  function changeKind(s, kind, i, d) {
    const prev = app.result().prep.segments[i];
    const level = prev ? prev.s0 : 0;
    s.kind = kind;
    if (kind === 'rise') { s.law = s.law || 'cycloidal'; s.h = s.h || 25; }
    if (kind === 'fall') { s.law = s.law || 'cycloidal'; s.h = level > 0 ? level : (s.h || 25); }
    if (kind === 'poly') {
      const peak = s.h || 25;
      s.conditions = [
        { at: 0, d: 0, value: level }, { at: 0, d: 1, value: 0 }, { at: 0, d: 2, value: 0 },
        { at: 0.5, d: 0, value: level + peak },
        { at: 1, d: 0, value: level }, { at: 1, d: 1, value: 0 }, { at: 1, d: 2, value: 0 },
      ];
    }
    void d;
  }

  // ---- follower and size ----
  function followerSection() {
    const U = app.units, f = app.doc.follower, r = app.result();
    const set = (label, fn) => app.edit(label, (d) => fn(d.follower));
    const roller = f.type !== 'flat';
    const stroke = r.stroke;
    const radiusKey = roller ? 'Rp' : 'Rb';
    const suggested = RULES.primeRadiusPerStroke * stroke;
    const flatNeed = Math.max(...r.samples.map((x) => -(x.s + x.a))); // flat face: Rb > −min(s + s″) (s″ per rad²)
    // sizes that cannot make a cam: said here, next to the boxes (and in Checks and results)
    const sizeProblems = r.problems.filter((p) => p.kind === 'size');
    return [
      segBtn([['roller', 'Roller'], ['flat', 'Flat-faced']], roller ? 'roller' : 'flat', (v) => set('Follower type', (x) => { x.type = v; })),
      roller
        ? num('Rp', 'Prime circle Rp', f.Rp, U.L, (v) => set('Prime circle', (x) => { x.Rp = v; }), { positive: true })
        : num('Rb', 'Base circle Rb', f.Rb, U.L, (v) => set('Base circle', (x) => { x.Rb = v; }), { positive: true }),
      roller ? num('Rf', 'Roller radius Rf', f.Rf, U.L, (v) => set('Roller radius', (x) => { x.Rf = v; }), { min: 0 }) : null,
      num('e', roller ? 'Eccentricity ε' : 'Stem offset ε', f.e || 0, U.L, (v) => set('Eccentricity', (x) => { x.e = v; })),
      sizeProblems.map((p) => h('div', { class: 'warn-note' }, p.text)),
      // the label above the buttons: beside it, two buttons this long do not fit the panel
      h('div', { class: 'field stacked' }, h('label', {}, 'Cam turns'),
        segBtn([[1, '↺ Counter-clockwise'], [-1, '↻ Clockwise']], f.dir === -1 ? -1 : 1, (v) => set('Direction of rotation', (x) => { x.dir = v; }), 'small-text')),
      roller ? (f.Rp - f.Rf > 0 ? h('p', { class: 'note' }, `Base circle Rb = Rp − Rf = ${showNum(U.L.show(f.Rp - f.Rf))} ${U.L.label}.`) : null)
        : h('p', { class: 'note' }, 'The stem offset changes only the overturning moment, not the cam shape.'),
      // Rp ≈ 3 × stroke is a rule for the roller (pressure angle); a flat face has none, but needs ρ = Rb + s + s″ > 0
      roller ? h('p', { class: 'note' }, `Rule of thumb: Rp ≈ ${RULES.primeRadiusPerStroke} × stroke = ${showNum(U.L.show(suggested))} ${U.L.label}. `,
        stroke > 0 ? h('button', { class: 'btn small', onclick: () => set('Size from the stroke', (x) => { x[radiusKey] = +suggested.toPrecision(6); }) }, 'Use it') : null)
        : h('p', { class: 'note' }, flatNeed > 0 ? `A flat face needs ρ = Rb + s + s″ above 0 everywhere: here Rb must be more than ${showNum(U.L.show(flatNeed))} ${U.L.label}.`
          : 'A flat face needs ρ = Rb + s + s″ above 0 everywhere: any Rb above 0 does that here.'),
    ];
  }

  // ---- speed ----
  function speedSection() {
    const w = app.doc.motion.omega;
    const set = (v) => app.edit('Camshaft speed', (d) => { d.motion.omega = v; });
    return [
      num('omega', 'Camshaft ω', w, null, (v) => set(v), { min: 0, unit: 'rad/s' }),
      num('rpm', 'or', (w * 60) / (2 * Math.PI), null, (v) => set((v * 2 * Math.PI) / 60), { min: 0, unit: 'rpm', name: 'The camshaft speed' }),
      h('p', { class: 'note' }, 'Velocity, acceleration and jerk in time are ds/dθ·ω, d²s/dθ²·ω², d³s/dθ³·ω³.'),
    ];
  }

  // ---- spring and mass ----
  function springSection() {
    const U = app.units, dy = app.doc.dynamics;
    const set = (label, fn) => app.edit(label, (d) => fn(d.dynamics));
    return [
      num('m', 'Follower mass m', dy.m, U.M, (v) => set('Follower mass', (x) => { x.m = v; }), { min: 0 }),
      num('k', 'Spring rate k', dy.k, U.K, (v) => set('Spring rate', (x) => { x.k = v; }), { min: 0 }),
      num('pl', 'Preload Fpl', dy.preload, U.F, (v) => set('Preload', (x) => { x.preload = v; }), { min: 0 }),
      num('z', 'Damping ratio ζ', dy.zeta, null, (v) => set('Damping ratio', (x) => { x.zeta = v; }), { min: 0, step: 0.01 }),
      h('p', { class: 'note' }, `Cam-follower systems typically have ζ ≈ 0.06. See the ${(PLOTS.sets.find((x) => x.id === 'forces') || {}).name} plots.`),
    ];
  }

  // ---- part and mounting ----
  function partSection() {
    const U = app.units, p = app.doc.part, r = app.result(), m = r.mount;
    const set = (label, fn) => app.edit(label, (d) => fn(d.part));
    const L = U.L;
    const screwSel = () => h('div', { class: 'field' }, h('label', {}, 'Screw'),
      segBtn(Object.keys(MOUNTING.screws).map((k) => [k, k]), MOUNTING.screws[p.screw] ? p.screw : 'M3', (v) => set('Screw size', (x) => { x.screw = v; }), 'three'));
    const kindFields = {
      plain: () => [h('p', { class: 'note' }, 'Press-fit or glue it on, or add a pin or set screw later in CAD (STEP or DXF).')],
      keyway: () => [
        num('keyB', 'Key width b', p.keyB, L, (v) => set('Key width', (x) => { x.keyB = v; }), { auto: m.key ? m.key.b : NaN, positive: true }),
        num('keyT2', 'Keyway depth t₂', p.keyT2, L, (v) => set('Keyway depth', (x) => { x.keyT2 = v; }), { auto: m.key ? m.key.t2 : NaN, positive: true }),
        h('p', { class: 'note' }, 'Empty boxes take the DIN 6885 parallel key for the shaft Ø. t₂ is the depth in the cam above the shaft.'),
      ],
      dflat: () => [
        num('flat', 'Across flats', p.flat, L, (v) => set('Across flats', (x) => { x.flat = v; }), { auto: m.flat ? m.flat.f : NaN, positive: true }),
        h('p', { class: 'note' }, 'For a motor shaft with a flat, e.g. 5 mm shaft, 4.5 mm across the flat.'),
      ],
      setscrew: () => [
        num('hubD', 'Hub Ø', p.hubD, L, (v) => set('Hub diameter', (x) => { x.hubD = v; }), { auto: m.hub ? 2 * m.hub.r : NaN, positive: true }),
        num('hubH', 'Hub height', p.hubH, L, (v) => set('Hub height', (x) => { x.hubH = v; }), { auto: MOUNTING.hubHeight, positive: true }),
        screwSel(),
        h('div', { class: 'field' }, h('label', {}, 'Hole for'),
          segBtn([['insert', 'Heat-set insert'], ['tap', 'Tapping']], p.screwHole === 'tap' ? 'tap' : 'insert', (v) => set('Set screw hole', (x) => { x.screwHole = v; }), 'small-text')),
        m.screw ? h('p', { class: 'note' }, `Radial hole Ø ${+L.show(m.screw.d).toPrecision(3)} ${L.label} in the hub. It is in the STL; in CAD add it from the mark in the DXF.`) : null,
      ],
      flange: () => [
        h('div', { class: 'field' }, h('label', {}, 'Bolt holes'),
          segBtn(MOUNTING.boltCounts.map((n) => [n, String(n)]), MOUNTING.boltCounts.includes(p.boltN) ? p.boltN : 4, (v) => set('Bolt holes', (x) => { x.boltN = v; }), 'three')),
        screwSel(),
        num('pcd', 'Bolt circle Ø', p.boltPcd, L, (v) => set('Bolt circle', (x) => { x.boltPcd = v; }), { auto: m.bolts ? m.bolts.pcd : NaN, positive: true }),
        m.bolts ? h('p', { class: 'note' }, `Clearance holes Ø ${+L.show(m.bolts.d).toPrecision(3)} ${L.label}. Match the bolt circle to the flange coupling or collar you use.`) : null,
      ],
    };
    return [
      h('div', { class: 'field' }, h('label', {}, 'Mounting'),
        h('select', { 'aria-label': 'How the cam fixes to its shaft', onchange: (e) => set('Mounting', (x) => { x.mount = e.target.value; }) },
          MOUNTING.kinds.map((k) => h('option', { value: k.id, selected: k.id === m.kind }, k.name)))),
      num('t', 'Thickness', p.thickness, L, (v) => set('Thickness', (x) => { x.thickness = v; }), { positive: true }),
      num('bore', 'Shaft Ø', p.bore, L, (v) => set('Shaft diameter', (x) => { x.bore = v; }), { min: 0 }),
      num('clr', 'Print clearance', p.clearance ?? MOUNTING.clearance, L, (v) => set('Print clearance', (x) => { x.clearance = v; }), { min: 0 }),
      ...kindFields[m.kind](),
      m.checks.map((c) => h('div', { class: c.level === 'ok' ? 'ok-note' : 'warn-note' }, c.text)),
      h('p', { class: 'note' }, m.kind === 'flange' ? 'The first bolt hole is on the follower side when θ = 0.'
        : m.kind === 'plain' ? 'Clearance is added to the bore Ø (0 for a machined part).'
        : `The ${m.kind === 'keyway' ? 'keyway' : m.kind === 'dflat' ? 'flat' : 'set screw'} faces the follower when θ = 0, so the cam is timed on its shaft. Clearance is added to the bore.`),
    ];
  }

  // rebuilt just after the event that changed the design, so a Tab has already
  // moved the focus to the next box and it can be found again after the rebuild
  let pending = null;
  function update() {
    if (pending) return;
    pending = setTimeout(() => { pending = null; render(); }, 0);
  }

  function render() {
    const ae = document.activeElement;
    const active = ae && el.contains(ae) ? ae.dataset.key : null;
    const scroll = el.scrollTop;
    const shown = (key, title, make) => (app.shows('input', key) ? section(key, title, make()) : null);
    replaceChildren(el,
      shown('program', 'Motion program', programSection),
      shown('follower', 'Follower and size', followerSection),
      shown('speed', 'Speed', speedSection),
      shown('spring', 'Spring and follower mass', springSection),
      shown('part', 'Part and mounting', partSection));
    el.scrollTop = scroll;
    if (active) {
      const again = el.querySelector(`[data-key="${active}"]`);
      // the rebuild follows a change (Tab or Enter): select the text, as Tab does, so typing replaces it
      if (again) { again.focus(); if (again.tagName === 'INPUT') again.select(); }
    }
  }

  return { update };
}
