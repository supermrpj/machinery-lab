// =============================================================================
// massDialog.js — the "Mass of link N" popup
// -----------------------------------------------------------------------------
// Choose between the mass from the link's shape and typed values. A typed
// centre of mass G is given in the link's own frame, as in the textbook:
// measured from one of its joints, with x′ along the line to another joint
// (the line of centres). It can be typed as r ∠ θ (polar) or as x′, y′
// (along / across), or picked on the drawing. A small drawing of the link in
// its own frame shows where G is.
// =============================================================================

import { h } from '../../../../packages/ui-kit/src/dom.js';
import { fmtSig, parseNum } from '../../../../packages/ui-kit/src/format.js';
import { massProps, dynamicsOf, defaultFrame, linkFrame, toLocal, toWorld, materialName } from '../model/mass.js';
import { linkById, jointById } from '../model/document.js';
import { unitsOf } from '../model/units.js';
import { linkColor } from '../drawing/render.js';

const DEG = 180 / Math.PI;
const docPos = (doc) => (id) => { const j = jointById(doc, id); return j ? { x: j.x, y: j.y } : null; };

/** Starting state of the popup for a link: what is typed now, or the shape's values. */
function initialState(app, link) {
  const doc = app.doc, mp = massProps(doc, link, { own: true });
  const typed = !!link.mass;
  const fr = (typed && link.mass.local) || defaultFrame(doc, link);
  const F = linkFrame(docPos(doc), fr.from, fr.to);
  const g = F ? toLocal(F, mp.cg) : { x: 0, y: 0 };
  return { typed, m: mp.m, I: mp.I, from: fr.from, to: fr.to, x: g.x, y: g.y };
}

/**
 * Open the popup for a link. `state` restores the fields after picking a
 * point on the drawing.
 */
export function openMassDialog(app, linkId, state = null) {
  const doc = app.doc, link = linkById(doc, linkId);
  if (!link) return;
  const U = unitsOf(doc);
  const nums = app.linkNumbers();
  const n = nums.get(link.id);
  const jname = (id) => `J${doc.joints.findIndex((j) => j.id === id) + 1}`;
  const shape = massProps(doc, { ...link, mass: undefined }, { own: true });
  const st = state || initialState(app, link);
  // the shape's radius of gyration k (I_G = m k²): keeping k while m changes
  // is the same shape in a heavier or lighter material
  const kShape2 = shape.m > 0 ? shape.I / shape.m : 0;
  if (st.keepK === undefined) st.keepK = !(st.typed && link.mass) || Math.abs(st.I - st.m * kShape2) <= 1e-9 * Math.max(st.I, 1e-12);
  const dyn = dynamicsOf(doc);

  const d = h('dialog', { class: 'mass-dlg', 'aria-label': `Mass of link ${n}` });
  const body = h('div', { class: 'dlg-body' });
  d.append(
    h('div', { class: 'dlg-head' },
      h('h2', {}, h('span', { class: 'swatch', style: { background: linkColor(nums, link.id) } }), ` Mass of link ${n}`),
      h('div', { class: 'row-buttons', style: { marginTop: 0 } },
        h('button', { class: 'hint-guide', onclick: () => { close(); app.ui.guides && app.ui.guides.open('masses'); } }, 'Guide'),
        h('button', { class: 'btn', 'aria-label': 'Close without changing', onclick: () => close() }, 'Close'))),
    body);
  const close = () => { if (d.open) d.close(); };
  d.addEventListener('close', () => d.remove());

  // ---- move the frame without moving G (G stays where it is on the link) ----
  const framePos = docPos(doc);
  function setFrame(from, to) {
    const F0 = linkFrame(framePos, st.from, st.to), F1 = linkFrame(framePos, from, to);
    if (F0 && F1) { const g = toLocal(F1, toWorld(F0, st)); st.x = g.x; st.y = g.y; }
    st.from = from; st.to = to;
    render();
  }

  // ---- a number box in display units ----
  const num = (value, onSet, opts = {}) => h('input', {
    type: 'number', step: 'any', value: Number.isFinite(value) ? +(+value).toPrecision(opts.digits || 6) : '',
    'aria-label': opts.label, onchange: (e) => { const v = parseNum(e.target.value); if (v !== null && (!opts.min || v >= 0)) { onSet(v); render(); } },
  });

  function render() {
    const parts = [];
    // shape or typed
    parts.push(h('div', { class: 'seg seg2', role: 'radiogroup', 'aria-label': 'Where the mass comes from' },
      h('button', { class: `seg-btn${st.typed ? '' : ' on'}`, role: 'radio', 'aria-checked': String(!st.typed), onclick: () => { st.typed = false; render(); } }, 'From its shape'),
      h('button', { class: `seg-btn${st.typed ? ' on' : ''}`, role: 'radio', 'aria-checked': String(st.typed), onclick: () => { st.typed = true; render(); } }, 'Typed values')));

    if (!st.typed) {
      const F = linkFrame(framePos, st.from, st.to), g = F ? toLocal(F, shape.cg) : { x: 0, y: 0 };
      const mat = materialName(dyn);
      const from = { outline: 'its outline', wheel: 'a disc', plate: 'a plate round its joints', bar: 'a bar with round ends' }[shape.from] || 'its shape';
      parts.push(h('div', { class: 'formula' },
        `m = ${fmtSig(U.M.show(shape.m), 4)} ${U.M.label}     I_G = ${fmtSig(U.I.show(shape.I), 4)} ${U.I.label}`, h('br'),
        `G = ${U.num(Math.hypot(g.x, g.y))} ${U.label} ∠ ${(+(Math.atan2(g.y, g.x) * DEG).toFixed(2))}°  from ${jname(st.from)}${st.to ? ` towards ${jname(st.to)}` : ''}`));
      parts.push(h('p', { class: 'note' }, `Worked out from ${from}: ${U.fmt(dyn.thickness)} thick ${mat}${shape.from === 'outline' ? '' : `, ${U.fmt(dyn.width || (doc.cad && doc.cad.linkWidth) || 12)} wide`}. `,
        'Change the material and size in the Forces panel. For an odd-shaped link, draw its outline on it with Outline (B).'));
      parts.push(h('div', { class: 'row-buttons' },
        h('button', { class: 'btn', onclick: () => { Object.assign(st, { typed: true, m: shape.m, I: shape.I, x: g.x, y: g.y, keepK: true }); render(); } }, 'Type my own, starting from these')));
    } else {
      // m and I_G are kept in kg and kg·m²; shown and typed in the chosen units
      parts.push(h('div', { class: 'field' }, h('label', {}, `Mass m (${U.M.label})`), num(U.M.show(st.m), (v) => { st.m = U.M.si(v); if (st.keepK) st.I = st.m * kShape2; }, { label: `Mass in ${U.M.label}`, min: true })));

      parts.push(h('div', { class: 'subhead' }, 'Centre of mass G, on the link'));
      const others = link.joints.filter((id) => id !== st.from);
      parts.push(h('div', { class: 'field' }, h('label', {}, 'Measured from'), h('div', { class: 'pair' },
        h('select', { 'aria-label': 'Origin joint', onchange: (e) => setFrame(e.target.value, e.target.value === st.to ? link.joints.find((id) => id !== e.target.value) || null : st.to) },
          link.joints.map((id) => h('option', { value: id, selected: id === st.from }, jname(id)))),
        others.length
          ? h('select', { 'aria-label': 'Towards joint (the x′ axis)', onchange: (e) => setFrame(st.from, e.target.value) },
            others.map((id) => h('option', { value: id, selected: id === st.to }, `towards ${jname(id)}`)))
          : h('span', { class: 'unit' }, 'x′ along x as drawn'))));

      const r = Math.hypot(st.x, st.y), th = Math.atan2(st.y, st.x) * DEG;
      const setPolar = (rr, tt) => { st.x = rr * Math.cos(tt / DEG); st.y = rr * Math.sin(tt / DEG); };
      parts.push(h('div', { class: 'cg-grid' },
        h('div', { class: 'cg-col' },
          h('div', { class: 'cg-head' }, 'Polar (as in the textbook)'),
          h('label', {}, `r (${U.label})`, num(U.len(r), (v) => setPolar(U.mm(v), th), { label: `Distance r in ${U.label}`, min: true })),
          h('label', {}, 'θ (°)', num(+th.toFixed(4), (v) => setPolar(r, v), { label: 'Angle θ from the line of centres, degrees, counter-clockwise' }))),
        h('div', { class: 'cg-col' },
          h('div', { class: 'cg-head' }, 'Along / across'),
          h('label', {}, `x′ (${U.label})`, num(U.len(st.x), (v) => { st.x = U.mm(v); }, { label: `x′ along the line of centres in ${U.label}` })),
          h('label', {}, `y′ (${U.label})`, num(U.len(st.y), (v) => { st.y = U.mm(v); }, { label: `y′ across, counter-clockwise, in ${U.label}` })))));
      parts.push(h('div', { class: 'row-buttons', style: { marginTop: '6px' } },
        h('button', { class: 'btn', onclick: pick }, 'Pick G on the drawing'),
        h('button', { class: 'btn', onclick: () => { const F = linkFrame(framePos, st.from, st.to); const g = F ? toLocal(F, shape.cg) : st; st.x = g.x; st.y = g.y; render(); } }, 'G from the shape')));

      parts.push(h('div', { class: 'field' }, h('label', {}, `I_G (${U.I.label})`), num(U.I.show(st.I), (v) => { st.I = U.I.si(v); st.keepK = false; }, { label: `Moment of inertia about G in ${U.I.label}`, min: true, digits: 7 })));
      const k = st.m > 0 ? Math.sqrt(st.I / st.m) * 1000 : 0; // m → mm
      parts.push(h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: st.keepK, disabled: !(kShape2 > 0), onchange: (e) => { st.keepK = e.target.checked; if (st.keepK) st.I = st.m * kShape2; render(); } }),
        ` I_G changes with m (same shape: I_G = m k², k = ${U.num(Math.sqrt(kShape2) * 1000)} ${U.label})`));
      parts.push(h('p', { class: 'note' }, `Radius of gyration now: k = √(I_G / m) = ${U.num(k)} ${U.label}. Untick to type I_G on its own, as a textbook problem gives it.`));
      parts.push(h('p', { class: 'note' }, 'θ is measured counter-clockwise from the line of centres; I_G is about G, not about a pivot. ',
        'A weight W gives m = W / g. The units are chosen under Units and grid (e.g. US: blob = lb·s²/in, lb·in·s²).'));
    }
    parts.push(preview());
    parts.push(h('div', { class: 'row-buttons dlg-actions' },
      h('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: apply }, 'Apply')));
    body.replaceChildren(...parts);
  }

  /** The link drawn in its own frame: joints, the x′ axis, and G with r and θ. */
  function preview() {
    const F = linkFrame(framePos, st.from, st.to);
    if (!F) return null;
    const pts = link.joints.map((id) => ({ id, ...toLocal(F, framePos(id)) }));
    const G = st.typed ? { x: st.x, y: st.y } : toLocal(F, shape.cg);
    const all = [...pts, G, { x: 0, y: 0 }];
    const W = 300, H = 150, pad = 26;
    const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const k = Math.min((W - 2 * pad) / Math.max(maxX - minX, 1e-6), (H - 2 * pad) / Math.max(maxY - minY, 1e-6), 1e6);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const S = (p) => ({ x: W / 2 + (p.x - cx) * k, y: H / 2 - (p.y - cy) * k }); // y up
    const o = S({ x: 0, y: 0 }), g = S(G);
    const color = linkColor(nums, link.id);
    const svg = [];
    // the link: lines between its joints (a plate's outline), or a disc
    if (link.disc) {
      svg.push(`<circle cx="${o.x}" cy="${o.y}" r="${link.disc * k}" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="3"/>`);
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = S(pts[i]), b = S(pts[j]);
        svg.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#1D1D1F" stroke-width="11" stroke-linecap="round"/>`,
          `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="8" stroke-linecap="round"/>`);
      }
    }
    // x′ axis through the origin
    const axEnd = Math.min(W - 16, Math.max(S({ x: maxX, y: 0 }).x + 10, o.x + 30));
    svg.push(`<line x1="${o.x}" y1="${o.y}" x2="${axEnd}" y2="${o.y}" stroke="#2196F3" stroke-width="1.5" stroke-dasharray="5 3"/>`,
      `<text x="${axEnd + 2}" y="${o.y - 4}" class="pv-t" style="fill:#2196F3">x′</text>`);
    // r and θ
    const rpx = Math.hypot(g.x - o.x, g.y - o.y), th = Math.atan2(G.y, G.x);
    if (rpx > 4) {
      svg.push(`<line x1="${o.x}" y1="${o.y}" x2="${g.x}" y2="${g.y}" stroke="#1D1D1F" stroke-width="1.2" stroke-dasharray="3 3"/>`);
      const ra = Math.min(26, rpx * 0.6);
      if (Math.abs(th) > 0.02) {
        const ex = o.x + ra * Math.cos(th), ey = o.y - ra * Math.sin(th);
        svg.push(`<path d="M ${o.x + ra} ${o.y} A ${ra} ${ra} 0 0 ${th > 0 ? 0 : 1} ${ex} ${ey}" fill="none" stroke="#1D1D1F" stroke-width="1.2"/>`,
          `<text x="${o.x + (ra + 9) * Math.cos(th / 2)}" y="${o.y - (ra + 9) * Math.sin(th / 2) + 4}" class="pv-t">θ</text>`);
      }
      svg.push(`<text x="${(o.x + g.x) / 2 - 4}" y="${(o.y + g.y) / 2 - 5}" class="pv-t">r</text>`);
    }
    // joints and G
    // joint names placed outside the link, away from its middle
    const mid = S({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
    for (const p of pts) {
      const q = S(p);
      let dx = q.x - mid.x, dy = q.y - mid.y;
      const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      if (pts.length === 1) { dx = 0.7; dy = 0.7; }
      svg.push(`<circle cx="${q.x}" cy="${q.y}" r="4.5" fill="#fff" stroke="#1D1D1F" stroke-width="1.6"/>`,
        `<text x="${q.x + dx * 16}" y="${q.y + dy * 16 + 4}" text-anchor="middle" class="pv-t">${jname(p.id)}</text>`);
    }
    svg.push(`<circle cx="${g.x}" cy="${g.y}" r="6" fill="#fff" stroke="#1D1D1F" stroke-width="1.5"/>`,
      `<path d="M ${g.x} ${g.y} L ${g.x + 6} ${g.y} A 6 6 0 0 1 ${g.x} ${g.y + 6} Z M ${g.x} ${g.y} L ${g.x - 6} ${g.y} A 6 6 0 0 1 ${g.x} ${g.y - 6} Z" fill="#1D1D1F"/>`,
      `<text x="${g.x + 9}" y="${g.y - 7}" class="pv-t pv-b">G</text>`);
    const box = h('div', { class: 'mass-preview', title: 'The link in its own frame: x′ runs from the first joint along the line of centres' });
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Link ${n} with its centre of mass">${svg.join('')}</svg>`;
    return box;
  }

  /** Close for a moment, let the student click G on the drawing, then come back. */
  function pick() {
    close();
    app.pickPoint(`Click where the centre of mass of link ${n} is (it snaps to points). Esc cancels.`, (w) => {
      // the click is where the link is now: use the joints' current positions
      const F = linkFrame((id) => app.sim.jointPos(id), st.from, st.to);
      if (F) { const g = toLocal(F, w); st.x = g.x; st.y = g.y; }
      openMassDialog(app, linkId, st);
    }, () => openMassDialog(app, linkId, st));
  }

  function apply() {
    const { typed, m, I, from, to, x, y } = st;
    app.edit(`Set mass of link ${n}`, (dd) => {
      const l = linkById(dd, link.id);
      if (!typed) { delete l.mass; return; }
      // the frame where the link is now (the edit has just adopted this pose)
      const F = linkFrame(docPos(dd), from, to);
      l.mass = { m, I, local: { from, to, x, y }, cg: F ? toWorld(F, { x, y }) : { x, y } };
    });
    close();
  }

  render();
  document.body.append(d);
  d.showModal();
}
