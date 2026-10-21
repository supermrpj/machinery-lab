// =============================================================================
// balancePanel.js — the Balancing panel
// -----------------------------------------------------------------------------
//   1. Total centre of mass: how far it moves over the cycle; show its path
//   2. Force balance with counterweights:
//        a fourbar — exact balance with counterweights on the crank and rocker
//        any other mechanism — balance each link on its ground pivot
//   3. The counterweights in use (switch them off to compare, or remove them)
//   4. Before and after: the largest shaking force and moment, input torque
//      and joint force over the cycle, without and with the counterweights
//   5. Rotor balancing calculator (single and two-plane), in a dialog
// m·R values are kept in kg·mm and shown in the chosen mass × length units.
// =============================================================================

import { h } from '../../../../packages/ui-kit/src/dom.js';
import { fmt, fmtSig, parseNum } from '../../../../packages/ui-kit/src/format.js';
import { linkColor } from '../drawing/render.js';
import { fourbarForceBalance, selfBalance, counterweightFor, totalCentreOfMass } from '../model/balance.js';
import { counterweightsOn, counterweightsOf } from '../model/mass.js';
import { analyseForces, bodyMasses } from '../model/forces.js';
import { linkById, jointById } from '../model/document.js';
import { openRotorDialog } from './rotorDialog.js';

const sub = (t) => h('span', { class: 'sub' }, t);

/** Counterweight radius chosen for each link (mm), for this session, per document. */
const chosenRadii = new WeakMap();
const radiiOf = (doc) => { if (!chosenRadii.has(doc)) chosenRadii.set(doc, new Map()); return chosenRadii.get(doc); };

export function buildBalance(app, open = true) {
  const sim = app.sim, doc = app.doc, U = app.units;
  const radii = radiiOf(doc);
  // radius: the one typed here, else the counterweight's own, else the given length
  const radiusFor = (link, length) => {
    const cw = (link.counterweights || []).find((c) => c.id === `cw-${link.id}`);
    return radii.get(link.id) || (cw && Math.hypot(cw.x, cw.y)) || length || 100;
  };
  // shafts and rotors need no drawing: the calculator is there in any case
  if (!sim.sys) return h('div', {}, h('p', { class: 'note' }, 'Draw a mechanism to balance it here.'), rotorSection(app));
  if (!sim.drivable) return h('div', {}, h('p', { class: 'note' }, app.whyNotDrivable()), rotorSection(app));
  const nums = app.linkNumbers();
  const jname = (id) => `J${doc.joints.findIndex((j) => j.id === id) + 1}`;
  const mrUnit = `${U.M.label}·${U.label}`;
  const mrShow = (v) => U.M.show(U.len(v)); // kg·mm → shown units
  const parts = [];

  parts.push(h('p', { class: 'note' },
    'A mechanism is force balanced when its total centre of mass stays still: then the shaking force on the frame is zero. ',
    'Counterweights on the links that turn about the ground do this.'));

  // ---- 1. total centre of mass ----
  if (!sim._masses) sim._masses = bodyMasses(sim);
  const s = sim.getSweep();
  const path = s ? s.samples.map((smp) => totalCentreOfMass(sim, sim._masses, smp.q)).filter(Boolean) : [];
  parts.push(h('div', { class: 'subhead' }, 'Total centre of mass'));
  if (path.length) {
    const xs = path.map((p) => p.x), ys = path.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs), hgt = Math.max(...ys) - Math.min(...ys);
    const still = Math.max(w, hgt) < 1e-6 * Math.max(1, sim.size || 1);
    parts.push(h('div', { class: 'formula' }, still
      ? h('b', {}, 'It stays still: the mechanism is force balanced.')
      : ['Over the cycle it moves within ', h('b', {}, `${U.num(w)} × ${U.num(hgt)} ${U.label}`), '.']));
  }
  parts.push(h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: !!(doc.balance && doc.balance.showCM), onchange: (e) => setBalance(app, { showCM: e.target.checked }) }),
    ' Show it (G total) and its path on the drawing'));

  // ---- 2. what to add ----
  const k = sim.info.kind;
  const addRow = (title, link, bal, length) => {
    const r = radiusFor(link, length);
    const cw = counterweightFor(bal.add, bal.from, bal.to, r);
    return h('tr', {},
      h('td', { class: 'nowrap' }, h('span', { class: 'swatch', style: { background: linkColor(nums, link.id) } }), ` ${title}`),
      h('td', {}, fmtSig(mrShow(bal.add.mag), 4)),
      h('td', { title: `measured from ${jname(bal.from)} towards ${jname(bal.to)}, counter-clockwise` }, `${fmt(bal.add.angle, 1)}°`),
      h('td', {}, h('input', { type: 'number', step: 'any', min: 0, class: 'mini', value: +U.len(r).toPrecision(5), 'aria-label': `Counterweight radius for link ${nums.get(link.id)} in ${U.label}`,
        onchange: (e) => {
          const v = parseNum(e.target.value);
          if (!(v > 0)) return;
          radii.set(link.id, U.mm(v));
          const body = e.target.closest('.panel-body');
          if (body) body.replaceChildren(buildBalance(app));
        } })),
      h('td', {}, cw ? fmtSig(U.M.show(cw.m), 4) : '—'));
  };
  const table = (rows) => h('table', { class: 'data bal-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Link'), h('th', {}, `m·R (${mrUnit})`), h('th', {}, 'angle'), h('th', {}, `R (${U.label})`), h('th', {}, `m (${U.M.label})`))),
    h('tbody', {}, rows));
  const place = (list) => app.edit('Add counterweights', (d) => {
    for (const { linkId, bal } of list) {
      const l = linkById(d, linkId);
      const r = radiusFor(linkById(doc, linkId), bal.length);
      const cw = counterweightFor(bal.add, bal.from, bal.to, r);
      l.counterweights = (l.counterweights || []).filter((c) => c.id !== `cw-${linkId}`);
      if (cw) l.counterweights.push({ id: `cw-${linkId}`, ...cw });
    }
    d.balance = { ...(d.balance || {}), counterweights: true };
  });

  if (k && k.type === 'fourbar') {
    const bal = fourbarForceBalance(doc, k);
    const L2 = linkById(doc, bal.crank.link), L4 = linkById(doc, bal.rocker.link);
    parts.push(h('div', { class: 'subhead' }, 'Force balance of the fourbar'));
    parts.push(h('p', { class: 'note' }, `Exact balance (Berkof–Lowen): counterweights on the crank (link ${nums.get(L2.id)}) and the rocker (link ${nums.get(L4.id)}); the coupler stays as designed. `,
      'The angle is in each link’s own frame, from its ground pivot towards its other pin. Choose the radius R; the mass follows.'));
    parts.push(table([
      addRow(String(nums.get(L2.id)), L2, bal.crank, bal.crank.length),
      addRow(String(nums.get(L4.id)), L4, bal.rocker, bal.rocker.length),
    ]));
    parts.push(h('div', { class: 'row-buttons' },
      h('button', { class: 'btn primary', onclick: () => place([{ linkId: L2.id, bal: bal.crank }, { linkId: L4.id, bal: bal.rocker }]) },
        (L2.counterweights || []).length || (L4.counterweights || []).length ? 'Update the counterweights' : 'Add these counterweights')));
  } else {
    // any mechanism: put each ground-pivoted link's own centre of mass on its pivot
    const candidates = [];
    for (const l of doc.links) {
      const pivots = l.joints.filter((id) => { const j = jointById(doc, id); return j && j.ground; });
      if (pivots.length !== 1) continue;
      const bal = selfBalance(doc, l, pivots[0]);
      const len = bal.to ? Math.hypot(jointById(doc, bal.to).x - jointById(doc, bal.from).x, jointById(doc, bal.to).y - jointById(doc, bal.from).y) : (l.disc || 50);
      if (bal.add.mag > 1e-12) candidates.push({ link: l, bal: { ...bal, length: len } });
    }
    parts.push(h('div', { class: 'subhead' }, 'Balance each link on its ground pivot'));
    if (!candidates.length) {
      parts.push(h('p', { class: 'note' }, 'No link turns about a single ground pivot with its centre of mass away from it.'));
    } else {
      parts.push(h('p', { class: 'note' }, 'Exact force balance is worked out for fourbars. For this mechanism, a counterweight can put each crank’s own centre of mass on its pivot (rotating balance); the other links stay unbalanced.'));
      parts.push(table(candidates.map((c) => addRow(String(nums.get(c.link.id)), c.link, c.bal, c.bal.length))));
      parts.push(h('div', { class: 'row-buttons' },
        h('button', { class: 'btn primary', onclick: () => place(candidates.map((c) => ({ linkId: c.link.id, bal: c.bal }))) }, 'Add these counterweights')));
    }
  }

  // ---- 3. counterweights in use ----
  const withCw = doc.links.filter((l) => (l.counterweights || []).length);
  if (withCw.length) {
    parts.push(h('div', { class: 'subhead' }, 'Counterweights'));
    const rows = [];
    for (const l of withCw) {
      for (const c of counterweightsOf(doc, l)) {
        const r = Math.hypot(c.cw.x, c.cw.y), ang = Math.atan2(c.cw.y, c.cw.x) * 180 / Math.PI;
        rows.push(h('tr', { title: `angle measured from ${jname(c.cw.from)}${c.cw.to ? ` towards ${jname(c.cw.to)}` : ''}` },
          h('td', { class: 'nowrap' }, h('span', { class: 'swatch', style: { background: linkColor(nums, l.id) } }), ` link ${nums.get(l.id)}`),
          h('td', { class: 'nowrap' }, `${fmtSig(U.M.show(c.m), 4)} ${U.M.label}`),
          h('td', { class: 'nowrap' }, `${U.num(r)} ${U.label} ∠ ${fmt(ang, 1)}°`)));
      }
    }
    parts.push(h('table', { class: 'data' }, h('tbody', {}, rows)));
    parts.push(h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: counterweightsOn(doc), onchange: (e) => setBalance(app, { counterweights: e.target.checked }) }),
      ' Use the counterweights (untick to compare without them)'));
    parts.push(h('div', { class: 'row-buttons' },
      h('button', { class: 'btn danger', onclick: () => app.edit('Remove counterweights', (d) => { for (const l of d.links) delete l.counterweights; }) }, 'Remove all counterweights')));

    // ---- 4. before and after ----
    if (open) parts.push(...comparison(app));
  }

  // ---- 5. rotors ----
  parts.push(rotorSection(app));
  return h('div', {}, parts);
}

/** Rotors and shafts: the calculator (with its examples), drawing or not. */
function rotorSection(app) {
  return h('div', {},
    h('div', { class: 'subhead' }, 'Rotors and shafts'),
    h('p', { class: 'note' }, 'Single-plane (static) and two-plane (dynamic) balancing of masses on a shaft, or from bearing forces measured on a balancing machine. Examples: a car wheel, and a shaft with three discs.'),
    h('div', { class: 'row-buttons' }, h('button', { class: 'btn', onclick: () => openRotorDialog(app) }, 'Rotor balancing calculator…')));
}

/** Change doc.balance (show the centre of mass, use counterweights). */
function setBalance(app, changes) {
  app.edit('Balancing settings', (d) => { d.balance = { ...(d.balance || {}), ...changes }; });
}

/**
 * The largest shaking force and moment, input torque and joint force over
 * the cycle (moving at the input speed), without and with the counterweights.
 * Positions near a toggle are left out, as in the Forces panel.
 */
function comparison(app) {
  const sim = app.sim, U = app.units, s = sim.getSweep();
  if (!s) return [];
  const m = app.doc.motion;
  const key = `${app.version}|${s.samples.length}|${JSON.stringify(app.doc.dynamics)}|${m.omega}|${m.alpha}|${m.reverse}`;
  if (!app._balanceCmp || app._balanceCmp.key !== key) {
    const near = app.nearToggle(s);
    const run = (masses) => {
      const saved = sim._masses;
      sim._masses = masses;
      const pk = { F: 0, M: 0, T: 0, J: 0 };
      s.samples.forEach((smp, k) => {
        if (near[k]) return;
        const r = analyseForces(sim, smp, 'dynamic');
        if (!r) return;
        pk.F = Math.max(pk.F, Math.hypot(r.shaking.F.x, r.shaking.F.y));
        pk.M = Math.max(pk.M, Math.abs(r.shaking.M));
        if (r.input) pk.T = Math.max(pk.T, Math.abs(r.input.torque ?? r.input.force));
        for (const p of r.pins) pk.J = Math.max(pk.J, Math.hypot(p.F.x, p.F.y));
      });
      sim._masses = saved;
      return pk;
    };
    app._balanceCmp = { key, without: run(bodyMasses(sim, { own: true })), with: run(bodyMasses(sim, { own: false })) };
  }
  const { without: a, with: b } = app._balanceCmp;
  const isT = sim.inputIsAngle;
  const fmtQ = (q, v) => `${fmtSig(q.show(v), 4)}`;
  const change = (x, y) => (x > 0 ? `${y >= x ? '+' : '−'}${fmt(Math.abs((y - x) / x) * 100, 0)}%` : '');
  const row = (name, q, x, y) => h('tr', {}, h('td', {}, name, sub(` (${q.label})`)), h('td', {}, fmtQ(q, x)), h('td', {}, fmtQ(q, y)), h('td', {}, change(x, y)));
  return [
    h('div', { class: 'subhead' }, 'Without and with the counterweights'),
    h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Largest over the cycle'), h('th', {}, 'without'), h('th', {}, 'with'), h('th', {}, ''))),
      h('tbody', {},
        row('Shaking force', U.F, a.F, b.F),
        row('Shaking moment', U.T, a.M, b.M),
        row(isT ? 'Input torque' : 'Input force', isT ? U.T : U.F, a.T, b.T),
        row('Joint force', U.F, a.J, b.J))),
    h('p', { class: 'note' }, 'Moving at the input speed (dynamic), whatever the Forces panel is set to. Force balancing removes the shaking force but usually raises the input torque and joint forces, and it does not remove the shaking moment (that needs extra links or rotating counterweights).'),
  ];
}
