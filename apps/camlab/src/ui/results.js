// =============================================================================
// results.js — the right panel: is this a good cam?
// -----------------------------------------------------------------------------
//   Fundamental law     s, v, a continuous over the turn (jerk finite)
//   Peaks               largest s, v, a, j in time units at ω, and where
//   Each rise and fall  peak factors V·β/h, A·β²/h, J·β³/h (Table 8-3)
//   Polynomial coefficients  s = lift × (Σ cₖ xᵏ) of each polynomial segment
//   Size                pressure angle, radius of curvature, undercut
//   Spring and forces   follower jump, natural frequency, camshaft torque
// A rail at the edge hides the panel; its dots show which checks fail.
// =============================================================================

import { h, icon, replaceChildren } from '../../../../packages/ui-kit/src/dom.js';
import { fmt } from '../../../../packages/ui-kit/src/format.js';
import { ICONS } from './icons.js';
import { LAWS } from '../model/laws.js';
import { RULES, THEME } from '../config.js';
import { safeStorage } from '../../../../packages/ui-kit/src/files.js';
import { segmentName } from '../model/program.js';
import { showNum } from './numbers.js';

const DEG = 180 / Math.PI;
const STORE = 'camlab.results';

export function buildResults(el, app) {
  let hidden = safeStorage.get(STORE) === 'hidden';
  const body = h('div', { class: 'results-body' });
  const panel = h('div', { class: 'results-panel' },
    h('div', { class: 'results-head' }, h('h2', {}, 'Checks and results'),
      h('button', { class: 'ibtn', title: 'Hide this panel', 'aria-label': 'Hide the results panel', onclick: () => setHidden(true) }, icon(ICONS.chevronRight, 18))),
    body);
  const dots = {}, railBtns = {};
  const railBtn = (key, ic, title) => {
    const dot = h('span', { class: 'side-dot' });
    dots[key] = dot;
    return railBtns[key] = h('button', { class: 'side-tab', title, 'aria-label': title, onclick: () => { setHidden(false); requestAnimationFrame(() => { const t = body.querySelector(`[data-sec="${key}"]`); if (t) t.scrollIntoView({ block: 'start' }); }); } }, icon(ICONS[ic], 20), dot);
  };
  const rail = h('div', { class: 'results-rail' },
    railBtn('law', 'law', 'Fundamental law of cam design'),
    railBtn('size', 'size', 'Size: pressure angle and radius of curvature'),
    railBtn('spring', 'spring', 'Spring and forces'));
  replaceChildren(el, panel, rail);

  function setHidden(v) {
    hidden = v;
    safeStorage.set(STORE, v ? 'hidden' : 'shown');
    el.classList.toggle('collapsed', hidden);
    if (!hidden) update();
  }
  el.classList.toggle('collapsed', hidden);

  const head = (key, text) => h('div', { class: 'subhead', 'data-sec': key }, text);
  const verdict = (ok, good, bad) => h('div', { class: 'verdict' }, h('span', { class: `tag ${ok ? 'good' : 'warn'}` }, ok ? good : bad));

  function update() {
    const r = app.result(), U = app.units, doc = app.doc, f = doc.follower;
    const roller = f.type !== 'flat';
    const law = r.law, shape = r.shape, F = r.forces;
    const phiLimit = RULES.pressureAngleMaxDeg;
    const phiMax = shape.phiMax * DEG, phiMin = shape.phiMin * DEG;
    const phiOk = !roller || (phiMax <= phiLimit && -phiMin <= phiLimit);
    // sizes that cannot make a cam (Rp ≤ ε, Rf ≥ Rp, …): no size numbers, only the message
    const noCam = r.problems.some((p) => p.kind === 'size') || !r.valid;
    const sizeOk = phiOk && !shape.undercut && !noCam;
    const springOk = F.jump.length === 0 && !F.spikes.length;
    dots.law.className = `side-dot ${law.ok && !r.problems.length ? 'good' : 'bad'}`;
    dots.size.className = `side-dot ${sizeOk ? 'good' : 'bad'}`;
    dots.spring.className = `side-dot ${springOk ? 'good' : 'bad'}`;
    // Basic leaves out sizing and the spring (config.js MODE)
    const showSize = app.shows('result', 'size'), showSpring = app.shows('result', 'spring');
    railBtns.size.hidden = !showSize; railBtns.spring.hidden = !showSpring;
    if (hidden) return;

    const parts = [];
    // ---- the design itself ----
    if (r.problems.length) {
      parts.push(head('design', 'Fix the design first'));
      parts.push(r.problems.map((p) => h('div', { class: 'warn-note' }, p.text)));
    }
    // ---- fundamental law ----
    parts.push(head('law', 'Fundamental law of cam design'));
    parts.push(verdict(law.ok, 'Met: s, v, a continuous', 'Broken'));
    const lines = [];
    for (const j of law.joins) {
      const [a, b] = j.between, padded = r.prep.segments[a].implicit || r.prep.segments[b].implicit;
      const which = a === b ? `the end of segment ${a + 1} meets its start` : padded ? `${segmentName(r.prep, a)} → ${segmentName(r.prep, b)}` : `segments ${a + 1}→${b + 1}`;
      const where = `at ${fmt(j.at, 1)}° (${which})`;
      if (j.s) lines.push(`The displacement jumps ${where}.`);
      else if (j.v) lines.push(`The velocity jumps ${where}: infinite acceleration.`);
      else if (j.a) lines.push(`The acceleration jumps ${where}: infinite jerk.`);
    }
    for (const at of law.inner || []) lines.push(`The acceleration jumps at ${fmt(at, 1)}° (middle of a constant-acceleration segment): infinite jerk.`);
    if (lines.length) parts.push(lines.map((t) => h('div', { class: 'warn-note' }, t)));
    else parts.push(h('p', { class: 'note' }, 'The jerk is finite everywhere. Smaller peaks of acceleration and jerk mean lower forces and less vibration.'));

    // ---- peaks ----
    parts.push(head('peaks', `Peaks at ω = ${showNum(r.omega)} rad/s`));
    const pk = r.peaks;
    // a jump in s makes v infinite there, a jump in v makes a infinite, a jump in a makes j infinite
    const jumps = law.joins.filter((j) => j.s || j.v || j.a);
    const infAt = {
      v: law.joins.filter((j) => j.s),
      a: law.joins.filter((j) => j.s || j.v),
      j: [...jumps, ...(law.inner || []).map((at) => ({ at }))],
    };
    const prow = (name, q, p, key) => infAt[key] && infAt[key].length
      ? h('tr', {}, h('td', {}, name), h('td', { class: 'bad' }, '∞'), h('td', {}, q.label), h('td', {}, `${fmt(infAt[key][0].at, 1)}°`))
      : h('tr', {}, h('td', {}, name), h('td', {}, showNum(q.show(Math.abs(p.value)))), h('td', {}, q.label), h('td', {}, `${fmt(p.at, 1)}°`));
    parts.push(h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'largest'), h('th', {}, ''), h('th', {}, 'at θ'))),
      h('tbody', {},
        h('tr', {}, h('td', {}, 'Stroke s'), h('td', {}, showNum(U.L.show(r.stroke))), h('td', {}, U.L.label), h('td', {}, '')),
        prow('Velocity v', U.V, pk.v, 'v'), prow('Acceleration a', U.A, pk.a, 'a'), prow('Jerk j', U.J, pk.j, 'j'))));

    // ---- each rise and fall: factors ----
    const moving = r.segments.filter((sg) => sg.factors);
    if (moving.length) {
      parts.push(head('factors', 'Each rise and fall (peak factors)'));
      parts.push(h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Segment'), h('th', { title: 'peak velocity × β / h' }, 'V'), h('th', { title: 'peak acceleration × β² / h' }, 'A'), h('th', { title: 'peak jerk × β³ / h' }, 'J'))),
        h('tbody', {}, moving.map((sg) => {
          const name = sg.kind === 'poly' ? 'Polynomial' : (LAWS[sg.law] ? LAWS[sg.law].short : sg.law);
          const touches = (j) => j.between[0] === sg.index || j.between[1] === sg.index;
          const vInf = law.joins.some((j) => j.s && touches(j));
          const aInf = law.joins.some((j) => (j.s || j.v) && touches(j));
          const jInf = law.joins.some((j) => (j.s || j.v || j.a) && touches(j)) || (law.inner || []).some((at) => at > sg.start && at < sg.start + sg.beta);
          const cell = (inf, v) => h('td', { class: inf ? 'bad' : '' }, inf ? '∞' : showNum(v));
          return h('tr', {},
            h('td', {}, h('span', { class: 'swatch', style: { background: THEME.segment[sg.index % THEME.segment.length] } }), ` ${sg.index + 1} ${name}`),
            cell(vInf, sg.factors.v), cell(aInf, sg.factors.a), cell(jInf, sg.factors.j));
        }))));
      parts.push(h('p', { class: 'note' }, 'Peak velocity = V·h/β, acceleration = A·h/β², jerk = J·h/β³ (β in radians, times ω, ω², ω³ in time). ∞: infinite where this segment meets its neighbour (the curve above it jumps there).'));
    }

    // ---- polynomial segments: their coefficients ----
    const polys = r.segments.filter((sg) => r.prep.segments[sg.index] && r.prep.segments[sg.index].poly);
    if (polys.length) {
      parts.push(head('poly', 'Polynomial coefficients'));
      parts.push(polys.map((sg) => {
        const ps = r.prep.segments[sg.index], c = ps.poly;
        // scale: the lift as typed (a rise or fall's h; for a polynomial, its largest displacement condition)
        const typed = ps.kind === 'poly' ? Math.max(0, ...(ps.conditions || []).filter((k) => k.d === 0).map((k) => Math.abs(k.value - ps.s0))) : Math.abs(ps.s1 - ps.s0);
        const L = typed > 0 ? typed : sg.lift > 0 ? sg.lift : 1;
        const name = sg.kind === 'poly' ? 'Polynomial' : (LAWS[sg.law] ? LAWS[sg.law].short : sg.law);
        return h('div', { class: 'poly-line' },
          h('div', {}, h('span', { class: 'swatch', style: { background: THEME.segment[sg.index % THEME.segment.length] } }),
            ` ${sg.index + 1} ${name}, θ = ${fmt(sg.start, 1)}° … ${fmt(sg.start + sg.beta, 1)}°`),
          h('div', { class: 'formula' }, `s = ${+U.L.show(L).toPrecision(4)} ${U.L.label} × (${polyText(c.map((v) => v / L))})`));
      }));
      parts.push(h('p', { class: 'note' }, 'x = (θ − start)/β runs from 0 to 1 over the segment; s is measured from the lowest position.'));
    }

    // ---- size ----
    if (showSize) {
      parts.push(head('size', 'Size'));
      if (noCam) {
        parts.push(verdict(false, '', 'No cam with these sizes'));
        parts.push(h('p', { class: 'note' }, 'Fix the sizes under Follower and size first (see the message at the top).'));
      } else if (roller) {
        parts.push(verdict(sizeOk, 'Pressure angle and curvature fine', 'Needs attention'));
        parts.push(h('table', { class: 'data' }, h('tbody', {},
          h('tr', {}, h('td', {}, 'Pressure angle, largest'), h('td', { class: phiMax > phiLimit ? 'bad' : '' }, `${fmt(phiMax, 2)}°`)),
          h('tr', {}, h('td', {}, 'Pressure angle, most negative'), h('td', { class: -phiMin > phiLimit ? 'bad' : '' }, `${fmt(phiMin, 2)}°`)),
          h('tr', {}, h('td', {}, 'ρ min, pitch curve (convex)'), h('td', {}, Number.isFinite(shape.rhoPitchMin) ? `${showNum(U.L.show(shape.rhoPitchMin))} ${U.L.label}` : '—')),
          h('tr', {}, h('td', {}, 'ρ min, cam surface (= ρ − Rf)'), h('td', { class: shape.undercut ? 'bad' : shape.rhoPitchMin < RULES.rhoPerRollerRadius * f.Rf ? '' : 'good' }, Number.isFinite(shape.rhoMin) ? `${showNum(U.L.show(shape.rhoMin))} ${U.L.label}` : '—')),
          h('tr', {}, h('td', {}, 'Roller radius Rf'), h('td', {}, `${showNum(U.L.show(f.Rf))} ${U.L.label}`)))));
        if (phiMax > phiLimit || -phiMin > phiLimit) parts.push(h('div', { class: 'warn-note' }, `The pressure angle goes beyond ±${phiLimit}°. Make the prime circle larger, give the rise (or fall) more degrees, or use eccentricity to share the angle between rise and fall.`));
        if (shape.undercut) parts.push(h('div', { class: 'warn-note' }, 'Undercut: somewhere the pitch curve is sharper than the roller (ρ ≤ Rf), so the roller cannot follow it. Use a smaller roller, a larger prime circle, or a gentler motion.'));
        else if (shape.rhoPitchMin < RULES.rhoPerRollerRadius * f.Rf) parts.push(h('div', { class: 'warn-note' }, `ρ min is less than ${RULES.rhoPerRollerRadius}× the roller radius: workable, but the contact stress is high there. Keep |ρ min| ≫ Rf.`));
      } else {
        parts.push(verdict(!shape.undercut, 'Curvature fine', 'Undercut'));
        parts.push(h('table', { class: 'data' }, h('tbody', {},
          h('tr', {}, h('td', {}, 'ρ min (= Rb + s + a)'), h('td', { class: shape.undercut ? 'bad' : 'good' }, `${showNum(U.L.show(shape.rhoMin))} ${U.L.label}`)),
          h('tr', {}, h('td', {}, 'Contact from the stem'), h('td', {}, `${showNum(U.L.show(shape.armMin - (f.e || 0)))} … ${showNum(U.L.show(shape.armMax - (f.e || 0)))} ${U.L.label}`)),
          h('tr', {}, h('td', {}, 'Face width needed'), h('td', {}, `≥ ${showNum(U.L.show(shape.faceWidth))} ${U.L.label}`)))));
        if (shape.undercut) parts.push(h('div', { class: 'warn-note' }, 'A flat face needs ρ > 0 everywhere; here the cam would have to be concave. Use a larger base circle or a gentler motion.'));
        parts.push(h('p', { class: 'note' }, 'The pressure angle of a flat face is always 0, but the contact moves along the face: keep the cam small to limit the overturning moment.'));
      }
    } else if (shape.undercut) {
      parts.push(h('div', { class: 'warn-note' }, 'The profile is undercut: the follower cannot follow it. Switch to Advanced to see the size checks.'));
    }

    // ---- spring and forces ----
    if (showSpring) {
      parts.push(head('spring', 'Spring and forces'));
      const up = F.spikes.find((x) => x.F >= 0), down = F.spikes.find((x) => x.F <= 0);
      parts.push(verdict(springOk, 'Follower stays on the cam', F.spikes.length ? 'Infinite cam force' : 'Follower jump'));
      parts.push(h('table', { class: 'data' }, h('tbody', {},
        h('tr', {}, h('td', {}, 'Damping c = 2ζ√(km)'), h('td', {}, `${showNum(U.C.show(F.c))} ${U.C.label}`)),
        h('tr', {}, h('td', {}, 'Natural frequency ωn'), h('td', {}, Number.isFinite(F.wn) ? `${showNum(F.wn)} rad/s` : '— (no mass)')),
        h('tr', {}, h('td', {}, 'Damped ωd'), h('td', {}, !Number.isFinite(F.wd) ? '—' : doc.dynamics.zeta > 1 ? 'overdamped (no oscillation)'
          : doc.dynamics.zeta === 1 ? 'critically damped (no oscillation)' : `${showNum(F.wd)} rad/s`)),
        h('tr', {}, h('td', {}, 'Speed ratio ω/ωn'), h('td', {}, F.wn > 0 && Number.isFinite(F.wn) ? fmt(r.omega / F.wn, 3) : '—')),
        h('tr', {}, h('td', {}, 'Cam force, largest'), h('td', { class: up ? 'bad' : '' }, up ? `∞ at ${fmt(up.at, 1)}°` : `${showNum(U.F.show(F.Fmax))} ${U.F.label}`)),
        h('tr', {}, h('td', {}, 'Cam force, smallest'), h('td', { class: F.Fmin < 0 || down ? 'bad' : 'good' }, down ? `−∞ at ${fmt(down.at, 1)}°` : `${showNum(U.F.show(F.Fmin))} ${U.F.label}`)),
        h('tr', {}, h('td', {}, 'Camshaft torque'), h('td', { class: F.spikes.length ? 'bad' : '' },
          `${F.spikes.some((x) => x.T <= 0) ? '−∞' : showNum(U.T.show(F.Tmin))} … ${F.spikes.some((x) => x.T >= 0) ? '∞' : showNum(U.T.show(F.Tmax))} ${U.T.label}`)))));
      if (F.spikes.length) parts.push(h('div', { class: 'warn-note' }, `The velocity jumps at ${F.spikes.map((x) => `${fmt(x.at, 1)}°`).join(', ')}, so the acceleration and the cam force are infinite there: `
        + `a hammer blow where v steps up${down ? ', and where it steps down the cam would have to pull, so the follower leaves the cam whatever the spring' : ''}. `
        + 'The numbers above leave these points out. Use a law with continuous velocity (and acceleration).'));
      if (F.jump.length) parts.push(h('div', { class: 'warn-note' }, `The cam force goes below zero ${F.jump.map((j) => `from ${fmt(j.from, 1)}° to ${fmt(j.to, 1)}°`).join(' and ')}: the spring cannot keep the follower on the cam. Raise the spring rate or the preload.`));
      parts.push(h('p', { class: 'note' }, 'Fc = m·a + c·v + k·s + Fpl (spring rate k, preload Fpl at s = 0). Torque Tc = Fc·v/ω (no friction).'));
    }
    if (!showSize || !showSpring) parts.push(h('p', { class: 'note mode-note' }, 'Sizing (pressure angle, curvature) and the spring and forces are in Advanced mode (top bar).'));

    replaceChildren(body, parts);
  }

  return { update };
}

/** Σ cₖ·xᵏ as text: 64x³ − 192x⁴ + …, leaving out terms that are zero. */
function polyText(c) {
  const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const sup = (k) => String(k).split('').map((d) => SUP[+d]).join('');
  const big = Math.max(...c.map(Math.abs), 1e-12);
  const terms = [];
  c.forEach((v, k) => {
    if (Math.abs(v) < 1e-9 * big) return;
    const mag = String(+Math.abs(v).toPrecision(5));
    const body = k === 0 ? mag : `${mag === '1' ? '' : mag}x${k > 1 ? sup(k) : ''}`;
    terms.push({ neg: v < 0, body });
  });
  if (!terms.length) return '0';
  return terms.map((t, i) => (i === 0 ? (t.neg ? '−' : '') + t.body : `${t.neg ? ' − ' : ' + '}${t.body}`)).join('');
}
