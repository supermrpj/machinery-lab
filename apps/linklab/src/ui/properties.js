// =============================================================================
// properties.js — the Properties card (floats on the drawing; depends on the selection and tool)
// =============================================================================

import { h } from '../../../../packages/ui-kit/src/dom.js';
import { fmt, parseNum } from '../../../../packages/ui-kit/src/format.js';
import { jointById, linkById, linksAtJoint } from '../model/document.js';
import { ENTITY_NAMES } from '../model/construction.js';
import { linkColor, traceColor } from '../drawing/render.js';
import { compassTool } from '../drawing/tools/compass.js';
import { protractorTool } from '../drawing/tools/protractor.js';
import { pickFile } from '../../../../packages/ui-kit/src/files.js';
import { EXAMPLES } from '../model/examples.js';
import { unitsOf } from '../model/units.js';
import { massProps, dynamicsOf, defaultFrame, linkFrame, toLocal, toWorld, counterweightsOf, counterweightsOn } from '../model/mass.js';
import { openMassDialog } from './massDialog.js';
import { formulaFn, parseTable } from '../model/loads.js';
import { fmtSig } from '../../../../packages/ui-kit/src/format.js';

const DEG = Math.PI / 180;
// the drawing's length unit; lengths are stored in mm and converted here
let U = unitsOf(null);

/** A labelled number input that commits on change (Enter or leaving the field). */
function numField(label, value, onCommit, opts = {}) {
  // lengths (unit 'mm') are shown and typed in the drawing's unit; a force,
  // torque, mass … (opts.q, from unitsOf) in its chosen unit
  const isLen = opts.unit === 'mm' || opts.unit === 'mm/px';
  const q = opts.q || null;
  const shown = !Number.isFinite(value) ? value : q ? q.show(value) : isLen ? U.len(value) : value;
  const digits = opts.digits ?? (isLen ? Math.max(3, U.digits + 1) : 3);
  const input = h('input', {
    type: 'number', step: opts.step || 'any', value: Number.isFinite(shown) ? (q ? +shown.toPrecision(6) : +shown.toFixed(digits)) : '',
    'aria-label': label, disabled: !!opts.disabled, title: opts.disabled ? 'Locked — unlock lengths to edit' : null,
    onchange: (e) => { const v = parseNum(e.target.value); if (v !== null) onCommit(q ? q.si(v) : isLen ? U.mm(v) : v); },
  });
  const unit = q ? q.label : opts.unit === 'mm' ? U.label : opts.unit === 'mm/px' ? `${U.label}/px` : opts.unit;
  return h('div', { class: 'field' }, h('label', {}, label), unit ? h('div', { class: 'pair', style: { gridTemplateColumns: '1fr auto' } }, input, h('span', { class: 'unit' }, unit)) : input);
}

function xyField(label, p, onCommit, opts = {}) {
  const mk = (k) => h('input', {
    type: 'number', step: 'any', value: +U.len(p[k]).toFixed(Math.max(3, U.digits + 1)), 'aria-label': `${label} ${k} (${U.label})`, disabled: !!opts.disabled,
    onchange: (e) => { const v = parseNum(e.target.value); if (v !== null) onCommit({ ...p, [k]: U.mm(v) }); },
  });
  return h('div', { class: 'field' }, h('label', {}, `${label} x, y (${U.label})`), h('div', { class: 'pair' }, mk('x'), mk('y')));
}

function attachSelect(app, current, onChange) {
  const nums = app.linkNumbers();
  const sel = h('select', { 'aria-label': 'Moves with', onchange: (e) => onChange(e.target.value || null) },
    h('option', { value: '' }, 'Ground (fixed)'),
    app.doc.links.map((l) => h('option', { value: l.id, selected: l.id === current }, `Link ${nums.get(l.id)}`)));
  return h('div', { class: 'field' }, h('label', {}, 'Moves with'), sel);
}

const deleteBtn = (app) => h('button', { class: 'btn danger', onclick: () => app.deleteSelection() }, 'Delete');

export function buildProperties(app) {
  U = unitsOf(app.doc);
  const sel = app.selection;
  if (sel) {
    switch (sel.kind) {
      case 'joint': return jointProps(app, sel.id);
      case 'link': return linkProps(app, sel.id);
      case 'construction': return constructionProps(app, sel.id);
      case 'body': return bodyProps(app, sel.id);
      case 'slider': return sliderProps(app, sel.id);
      case 'pair': return pairProps(app, sel.id);
      case 'actuator': return actuatorProps(app, sel.id);
      case 'load': return loadProps(app, sel.id);
      default: break;
    }
  }
  if (app.tool.id === 'compass') return compassProps(app);
  if (app.tool.id === 'protractor') return protractorProps(app);
  if (app.tool.id === 'image' || app.tool.id === 'scale') return backgroundProps(app);
  return gettingStarted(app);
}

/**
 * Is there anything for the Properties card to show? A selection, a tool
 * with its own settings, or the getting-started steps on an empty sheet.
 */
export function hasProperties(app) {
  if (app.selection) return true;
  if (['compass', 'protractor', 'image', 'scale'].includes(app.tool.id)) return true;
  return !app.doc.joints.length && !app.doc.construction.length;
}

// ---- joint ---------------------------------------------------------------------
/**
 * Colour picker: shows the colour in use; picking one keeps it, and
 * "Automatic" goes back to the colour LinkLab chooses. set(null) = automatic.
 */
function colorField(label, color, picked, set) {
  return h('div', { class: 'field' }, h('label', {}, label),
    h('div', { class: 'color-pick' },
      h('input', { type: 'color', value: color, 'aria-label': label, onchange: (e) => set(e.target.value) }),
      picked
        ? h('button', { class: 'btn small', title: 'Go back to the colour LinkLab chooses', onclick: () => set(null) }, 'Automatic')
        : h('span', { class: 'sub' }, 'automatic')));
}

function jointProps(app, id) {
  const j = jointById(app.doc, id);
  if (!j) return null;
  const nums = app.linkNumbers();
  const links = linksAtJoint(app.doc, id).map((l) => nums.get(l.id));
  const p = app.sim.jointPos(id);
  const slider = app.doc.sliders.find((s) => s.joint === id);
  return h('div', {},
    h('div', { class: 'sel-title' }, `${j.ground ? 'Ground pivot' : 'Joint'} J${app.doc.joints.indexOf(j) + 1}`),
    xyField('Position', p, (np) => app.edit('Move joint', (doc) => { const jj = jointById(doc, id); jj.x = np.x; jj.y = np.y; }), { disabled: !app.jointEditable(id) }),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: j.ground, onchange: (e) => app.edit(e.target.checked ? 'Pin joint to ground' : 'Free joint', (doc) => { jointById(doc, id).ground = e.target.checked; }) }),
      'Fixed to the ground'),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: !!j.trace, onchange: (e) => app.edit(e.target.checked ? 'Trace path' : 'Stop tracing', (doc) => { jointById(doc, id).trace = e.target.checked; }) }),
      'Trace its path (coupler curve)'),
    j.trace ? colorField('Curve colour', traceColor(app.doc, j), !!j.traceColor, (c) => app.edit(c ? 'Curve colour' : 'Automatic curve colour', (doc) => {
      const jj = jointById(doc, id);
      if (c) jj.traceColor = c; else delete jj.traceColor;
    })) : null,
    h('p', { class: 'note' }, links.length ? `Connects link${links.length > 1 ? 's' : ''} ${links.join(', ')}${j.ground ? ' to the ground' : ''}.` : 'Not connected to any link yet.'),
    slider ? h('p', { class: 'note' }, 'Slides along a rail (see the slider).') : null,
    !app.jointEditable(id) ? h('p', { class: 'note' }, 'Its position is locked because lengths are locked.') : null,
    h('div', { class: 'row-buttons' }, deleteBtn(app)),
  );
}

// ---- link ----------------------------------------------------------------------
function linkProps(app, id) {
  const link = linkById(app.doc, id);
  if (!link) return null;
  const nums = app.linkNumbers();
  const n = nums.get(id);
  const d = app.doc.driver;
  const isInput = (d.type || 'rotary') === 'rotary' && d.link === id;
  const locked = !!link.locked || !!app.doc.lockDesign;
  const joints = link.joints.map((jid) => jointById(app.doc, jid));
  const hasGround = joints.some((j) => j.ground);
  const rows = [];
  for (let i = 0; i < joints.length; i++) {
    for (let k = i + 1; k < joints.length; k++) {
      const a = joints[i], b = joints[k];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const movable = !b.ground ? b : !a.ground ? a : null;
      const fixed = movable === b ? a : b;
      if (joints.length === 2 && movable) {
        rows.push(numField('Length', L, (v) => {
          if (locked) return;
          if (!(v > 0)) return;
          app.edit('Set link length', (doc) => {
            const m = jointById(doc, movable.id), f = jointById(doc, fixed.id);
            const ang = Math.atan2(m.y - f.y, m.x - f.x);
            m.x = f.x + v * Math.cos(ang); m.y = f.y + v * Math.sin(ang);
          });
        }, { unit: 'mm', disabled: locked }));
      } else {
        rows.push(h('div', { class: 'field' }, h('span', { class: 'label' }, `Joint ${i + 1}–${k + 1}`), h('span', {}, U.fmt(L, U.digits + 1))));
      }
    }
  }
  if (link.disc) {
    rows.unshift(numField('Radius', link.disc, (v) => v > 0 && app.edit('Set wheel radius', (doc) => { linkById(doc, id).disc = v; }), { unit: 'mm', disabled: locked }));
  }
  const attached = app.doc.construction.filter((e) => e.attach === id).length + app.doc.bodies.filter((b) => b.attach === id).length;
  return h('div', {},
    h('div', { class: 'sel-title' }, h('span', { class: 'swatch', style: { background: linkColor(nums, id) } }), `${link.disc ? 'Wheel' : 'Link'} ${n}`, isInput ? h('span', { class: 'tag info' }, 'input') : null),
    rows,
    colorField('Colour', linkColor(nums, id), !!link.color, (c) => app.edit(c ? 'Link colour' : 'Automatic link colour', (doc) => {
      const l = linkById(doc, id);
      if (c) l.color = c; else delete l.color;
    })),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: !!link.locked, disabled: !!app.doc.lockDesign,
        onchange: (e) => app.edit(e.target.checked ? 'Lock link' : 'Unlock link', (doc) => { linkById(doc, id).locked = e.target.checked; }) }),
      app.doc.lockDesign ? 'Locked (all lengths are locked)' : 'Lock this link’s lengths'),
    h('p', { class: 'note' }, `${link.disc ? 'A disc turning about its centre joint.' : `${joints.length} joints${joints.length > 2 ? ' (a rigid plate)' : ''}.`} ${attached ? `${attached} drawing item${attached > 1 ? 's' : ''} move with it.` : ''}`),
    h('div', { class: 'row-buttons' },
      !isInput && hasGround ? h('button', { class: 'btn primary', onclick: () => app.setInputSpec({ type: 'rotary', link: id, pivot: joints.find((j) => j.ground).id, ref: null }) }, 'Put the motor here') : null,
      deleteBtn(app)),
    !hasGround && !isInput ? h('p', { class: 'note' }, 'For a motor between two links, use the Input tool (D) or choose it under Input in the Kinematics panel.') : null,
    app.mode === 'advanced' ? massSection(app, link) : null, // masses only matter for forces (Advanced)
  );
}

// ---- mass properties of a link ---------------------------------------------------
// A short summary here; the values are set in the "Mass of link N" popup.
function massSection(app, link) {
  const doc = app.doc, all = massProps(doc, link, { own: false }), mp = all.own;
  const typed = !!link.mass;
  const jname = (id) => `J${doc.joints.findIndex((j) => j.id === id) + 1}`;
  const fr = (typed && link.mass.local) || defaultFrame(doc, link);
  const F = linkFrame((id) => { const j = jointById(doc, id); return j && { x: j.x, y: j.y }; }, fr.from, fr.to);
  const from = { outline: 'its outline', wheel: 'a disc', plate: 'a plate', bar: 'a bar with round ends' }[mp.from] || '';
  const polarG = (p) => { const v = F ? toLocal(F, p) : { x: 0, y: 0 }; return `${U.num(Math.hypot(v.x, v.y))} ${U.label} ∠ ${+(Math.atan2(v.y, v.x) * 180 / Math.PI).toFixed(2)}°`; };
  // counterweights from the Balancing panel
  const cws = counterweightsOf(doc, link);
  const cwNote = cws.length ? h('div', { class: 'formula' },
    cws.map((c) => [`Counterweight ${fmtSig(U.M.show(c.m))} ${U.M.label} at ${polarG(c.p)}`, h('br')]),
    counterweightsOn(doc)
      ? `With it: m = ${fmtSig(U.M.show(all.m))} ${U.M.label}, G at ${polarG(all.cg)}, I_G = ${fmtSig(U.I.show(all.I))} ${U.I.label}`
      : h('span', { class: 'sub' }, 'Not in use (switched off in Balancing)')) : null;
  return h('div', {},
    h('div', { class: 'subhead with-guide' }, 'Mass properties',
      h('button', { class: 'hint-guide', title: 'How to set masses and centres of mass', onclick: () => app.ui.guides && app.ui.guides.open('masses') }, 'Guide')),
    h('div', { class: 'formula' },
      `m = ${fmtSig(U.M.show(mp.m))} ${U.M.label}   I_G = ${fmtSig(U.I.show(mp.I))} ${U.I.label}`, h('br'),
      `G = ${polarG(mp.cg)}`,
      h('span', { class: 'sub' }, ` from ${jname(fr.from)}${fr.to ? ` towards ${jname(fr.to)}` : ''}`)),
    cwNote,
    h('p', { class: 'note' }, typed ? 'Typed values.' : `From ${from}. `),
    h('div', { class: 'row-buttons', style: { marginTop: '4px' } },
      h('button', { class: 'btn primary', onclick: () => openMassDialog(app, link.id) }, typed ? 'Edit mass…' : 'Type my own mass…')));
}

// ---- external force or torque ----------------------------------------------------
/**
 * Editor for an external force or torque (in Properties, and in the popup
 * opened by double-click or right-click). opts.onPick(cb) lets the popup step
 * aside while the student clicks the point of action on the drawing.
 */
export function loadProps(app, id, opts = {}) {
  const f = (app.doc.loads || []).find((x) => x.id === id);
  if (!f) return null;
  const nums = app.linkNumbers();
  const set = (label, fn) => app.edit(label, (doc) => { const x = doc.loads.find((y) => y.id === id); fn(x, doc); });
  const isT = f.kind === 'torque';
  const kind = h('select', { 'aria-label': 'Kind of load', onchange: (e) => set('Change load', (x) => {
    x.kind = e.target.value;
    if (x.kind === 'torque' && x.T === undefined) x.T = 1;
    if (x.kind === 'force' && !x.F) x.F = { x: 0, y: -10 };
  }) },
  h('option', { value: 'force', selected: !isT }, 'Force'), h('option', { value: 'torque', selected: isT }, 'Torque (couple)'));
  const parts = [
    opts.inDialog ? null : h('div', { class: 'sel-title' }, isT ? 'Torque' : 'Force', h('span', { class: 'tag info' }, `on link ${nums.get(f.link)}`)),
    h('div', { class: 'field' }, h('label', {}, 'Kind'), kind),
  ];
  if (isT) {
    parts.push(numField('Torque', f.T, (v) => set('Set torque', (x) => { x.T = v; }), { q: U.T }),
      h('p', { class: 'note' }, 'Counter-clockwise is positive.'));
  } else {
    const mag = Math.hypot(f.F.x, f.F.y), ang = Math.atan2(f.F.y, f.F.x) / DEG;
    parts.push(
      numField('Size', mag, (v) => v >= 0 && set('Set force', (x) => { const a = Math.atan2(x.F.y, x.F.x); x.F = { x: v * Math.cos(a), y: v * Math.sin(a) }; }), { q: U.F }),
      numField('Direction', ang, (v) => set('Set force direction', (x) => { const m = Math.hypot(x.F.x, x.F.y); x.F = { x: m * Math.cos(v * DEG), y: m * Math.sin(v * DEG) }; }), { unit: '°', digits: 2 }),
      h('div', { class: 'field' }, h('label', {}, `Fx, Fy (${U.F.label})`), h('div', { class: 'pair' },
        ...['x', 'y'].map((k) => h('input', { type: 'number', step: 'any', value: +U.F.show(f.F[k]).toPrecision(6), 'aria-label': `F${k} in ${U.F.label}`,
          onchange: (e) => { const v = parseNum(e.target.value); if (v !== null) set('Set force', (x) => { x.F = { ...x.F, [k]: U.F.si(v) }; }); } })))),
      ...actsAt(app, f, set, opts),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!f.follow, onchange: (e) => set(e.target.checked ? 'Force turns with link' : 'Force keeps its direction', (x) => { x.follow = e.target.checked; }) }),
        ' Turns with the link (else keeps its direction)'),
    );
  }
  // how it changes over the cycle
  const prof = f.profile || { type: 'constant' };
  const lab = app.sim.inputIsAngle ? 'θ (°)' : `s (${U.label})`;
  parts.push(h('div', { class: 'subhead' }, 'Over the cycle'),
    h('div', { class: 'field' }, h('label', {}, 'Size changes'), h('select', { 'aria-label': 'How the load changes', onchange: (e) => set('Change load profile', (x) => {
      x.profile = { ...(x.profile || {}), type: e.target.value };
      if (e.target.value === 'formula' && !x.profile.expr) x.profile.expr = '1 + 0.5*sin(theta)';
      if (e.target.value === 'table' && !x.profile.table) x.profile.table = [[0, 1], [180, 0.5], [360, 1]];
    }) },
    h('option', { value: 'constant', selected: prof.type === 'constant' || !prof.type }, 'Not at all (constant)'),
    h('option', { value: 'formula', selected: prof.type === 'formula' }, 'By a formula'),
    h('option', { value: 'table', selected: prof.type === 'table' }, 'By a table'))));
  if (prof.type === 'formula') {
    const c = formulaFn(prof.expr || '');
    const input = h('input', { type: 'text', value: prof.expr || '', 'aria-label': 'Factor formula', spellcheck: 'false', style: { fontFamily: 'var(--mono)' },
      onchange: (e) => set('Set load formula', (x) => { x.profile = { ...x.profile, expr: e.target.value }; }) });
    parts.push(h('div', { class: 'field' }, h('label', {}, 'Factor ='), input),
      c.error ? h('p', { class: 'note', style: { color: 'var(--ink)', background: 'var(--red-soft)', padding: '4px 6px' } }, c.error)
        : h('p', { class: 'note' }, 'The size above is multiplied by this. Use theta (input angle, °), s (stroke, mm) or t (time, s); sin, cos in degrees; step(x), pulse(x, a, b), min, max, abs, sqrt, ^.'));
  } else if (prof.type === 'table') {
    const text = (prof.table || []).map((r) => `${r[0]}\t${r[1]}`).join('\n');
    const ta = h('textarea', { rows: 5, 'aria-label': 'Factor table', spellcheck: 'false', style: { width: '100%', fontFamily: 'var(--mono)', fontSize: '12px', border: '2px solid var(--ink)', borderRadius: 'var(--radius)', padding: '4px 6px' },
      onchange: (e) => { const rows = parseTable(e.target.value); if (rows.length) set('Set load table', (x) => { x.profile = { ...x.profile, table: rows }; }); } });
    ta.value = text;
    parts.push(h('p', { class: 'note' }, `Two columns: ${lab.replace(` (${U.label})`, ' (mm)')} and factor. Paste from Excel; straight lines between rows.`), ta);
  }
  if (!opts.inDialog) parts.push(h('div', { class: 'row-buttons' }, deleteBtn(app)));
  if (!app.forcesOn()) {
    parts.push(h('p', { class: 'note' }, app.mode === 'basic' ? 'Switch to Advanced and choose Static or Dynamic in the ' : 'Choose Static or Dynamic in the ',
      h('button', { class: 'text-link', onclick: (e) => { const dlg = e.target.closest('dialog'); if (dlg) dlg.close(); app.ui.showPanel('forces'); } }, 'Forces panel'), ' to see its effect.'));
  }
  return h('div', {}, parts);
}

/**
 * Where a force acts, in its link's own frame: r ∠ θ from one of the link's
 * joints, θ counter-clockwise from the line to another joint (as for the
 * centre of mass). Or pick the point on the drawing.
 */
function actsAt(app, f, set, opts) {
  const doc = app.doc, link = linkById(doc, f.link);
  if (!link) return [xyField('Acts at', f.at, (p) => set('Move force', (x) => { x.at = p; }))];
  const jname = (id) => `J${doc.joints.findIndex((j) => j.id === id) + 1}`;
  const fr = f.frame && link.joints.includes(f.frame.from) ? f.frame : defaultFrame(doc, link);
  const docPos = (d) => (jid) => { const j = jointById(d, jid); return j && { x: j.x, y: j.y }; };
  const F = linkFrame(docPos(doc), fr.from, fr.to);
  if (!F) return [xyField('Acts at', f.at, (p) => set('Move force', (x) => { x.at = p; }))];
  const q = toLocal(F, f.at), r = Math.hypot(q.x, q.y), th = Math.atan2(q.y, q.x) / DEG;
  // r and θ as they are now (the other field may have changed since this was drawn)
  const now = () => {
    const x = (app.doc.loads || []).find((y) => y.id === f.id) || f;
    const G = linkFrame(docPos(app.doc), fr.from, fr.to), c = toLocal(G, x.at);
    return { r: Math.hypot(c.x, c.y), th: Math.atan2(c.y, c.x) / DEG };
  };
  // set the point from r, θ in the frame where the link is now (the edit adopts this pose)
  const place = (rr, tt) => set('Move force', (x, d) => {
    const G = linkFrame(docPos(d), fr.from, fr.to);
    x.at = toWorld(G, { x: rr * Math.cos(tt * DEG), y: rr * Math.sin(tt * DEG) });
  });
  const others = link.joints.filter((jid) => jid !== fr.from);
  const pickBtn = h('button', { class: 'btn', onclick: () => {
    const go = () => app.pickPoint(`Click where the force acts on link ${app.linkNumbers().get(link.id)}. Esc cancels.`,
      (w) => { set('Move force', (x) => { x.at = w; }); if (opts.afterPick) opts.afterPick(); }, () => { if (opts.afterPick) opts.afterPick(); });
    if (opts.beforePick) opts.beforePick(); go();
  } }, 'Pick on the drawing');
  return [
    h('div', { class: 'field' }, h('label', {}, 'Acts at, from'), h('div', { class: 'pair' },
      h('select', { 'aria-label': 'Measured from joint', onchange: (e) => set('Change reference joint', (x) => {
        x.frame = { from: e.target.value, to: link.joints.find((jid) => jid !== e.target.value) || null };
      }) }, link.joints.map((jid) => h('option', { value: jid, selected: jid === fr.from }, jname(jid)))),
      others.length
        ? h('select', { 'aria-label': 'Towards joint', onchange: (e) => set('Change reference joint', (x) => { x.frame = { from: fr.from, to: e.target.value }; }) },
          others.map((jid) => h('option', { value: jid, selected: jid === fr.to }, `towards ${jname(jid)}`)))
        : h('span', { class: 'unit' }, 'x′ along x'))),
    h('div', { class: 'field' }, h('label', {}, `r (${U.label}), θ (°)`), h('div', { class: 'pair' },
      h('input', { type: 'number', step: 'any', min: 0, value: +U.len(r).toFixed(Math.max(3, U.digits + 1)), 'aria-label': `Distance from the joint in ${U.label}`,
        onchange: (e) => { const v = parseNum(e.target.value); if (v !== null && v >= 0) place(U.mm(v), now().th); } }),
      h('input', { type: 'number', step: 'any', value: +th.toFixed(3), 'aria-label': 'Angle from the line of centres in degrees, counter-clockwise',
        onchange: (e) => { const v = parseNum(e.target.value); if (v !== null) place(now().r, v); } }))),
    h('div', { class: 'row-buttons', style: { marginTop: '2px' } }, pickBtn),
  ];
}

// ---- construction ------------------------------------------------------------
function constructionProps(app, id) {
  const e = app.doc.construction.find((x) => x.id === id);
  if (!e) return null;
  const set = (label, fn) => app.edit(label, (doc) => fn(doc.construction.find((x) => x.id === id)));
  const parts = [h('div', { class: 'sel-title' }, ENTITY_NAMES[e.kind])];
  if (e.kind === 'point') parts.push(xyField('Position', e.p, (p) => set('Move point', (x) => { x.p = p; })));
  if (['segment', 'xline', 'dim'].includes(e.kind)) {
    parts.push(xyField('Point A', e.a, (p) => set('Edit line', (x) => { x.a = p; })));
    parts.push(xyField('Point B', e.b, (p) => set('Edit line', (x) => { x.b = p; })));
    const L = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y), ang = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x);
    if (e.kind !== 'xline') {
      parts.push(numField('Length', L, (v) => set('Set length', (x) => { x.b = { x: x.a.x + v * Math.cos(ang), y: x.a.y + v * Math.sin(ang) }; }), { unit: 'mm' }));
    }
    parts.push(numField('Angle', ang / DEG, (v) => set('Set angle', (x) => { x.b = { x: x.a.x + L * Math.cos(v * DEG), y: x.a.y + L * Math.sin(v * DEG) }; }), { unit: '°' }));
  }
  if (e.kind === 'circle' || e.kind === 'arc') {
    parts.push(xyField('Centre', e.c, (p) => set('Move centre', (x) => { x.c = p; })));
    parts.push(numField('Radius', e.r, (v) => v > 0 && set('Set radius', (x) => { x.r = v; }), { unit: 'mm' }));
    if (e.kind === 'arc') {
      parts.push(numField('Start angle', e.a0 / DEG, (v) => set('Edit arc', (x) => { x.a0 = v * DEG; }), { unit: '°' }));
      parts.push(numField('Sweep', e.sweep / DEG, (v) => set('Edit arc', (x) => { x.sweep = v * DEG; }), { unit: '°' }));
    }
  }
  parts.push(attachSelect(app, e.attach, (v) => set('Change attachment', (x) => { x.attach = v; })));
  parts.push(h('p', { class: 'note' }, 'Drawing items attached to a link move with it when the mechanism moves.'));
  parts.push(h('div', { class: 'row-buttons' }, deleteBtn(app)));
  return h('div', {}, parts);
}

// ---- body ----------------------------------------------------------------------
function bodyProps(app, id) {
  const b = app.doc.bodies.find((x) => x.id === id);
  if (!b) return null;
  return h('div', {},
    h('div', { class: 'sel-title' }, 'Outline'),
    attachSelect(app, b.attach, (v) => app.edit('Change attachment', (doc) => { doc.bodies.find((x) => x.id === id).attach = v; })),
    h('p', { class: 'note' }, `${b.pts.length} corners. Drag it with the Select tool to reposition it.`),
    h('div', { class: 'row-buttons' }, deleteBtn(app)));
}

// ---- slider ----------------------------------------------------------------------
function sliderProps(app, id) {
  const s = app.doc.sliders.find((x) => x.id === id);
  if (!s) return null;
  const ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) / DEG;
  return h('div', {},
    h('div', { class: 'sel-title' }, 'Slider'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Rail angle'), h('span', {}, `${fmt(ang, 2)}°`)),
    h('p', { class: 'note' }, s.on ? `The joint slides in a slot along link ${app.linkNumbers().get(s.on)} (a pin-in-slot, counted as a block with a pin and a sliding joint).` : 'The joint slides along this fixed rail (counted as a slider block with a pin and a sliding joint).'),
    h('div', { class: 'row-buttons' },
      !s.on && !(app.doc.driver.type === 'slider' && app.doc.driver.slider === id)
        ? h('button', { class: 'btn primary', onclick: () => app.setInputSpec({ type: 'slider', slider: id }) }, 'Make this the input (push it)') : null,
      deleteBtn(app)));
}

// ---- other pairs ---------------------------------------------------------------------
const PAIR_NAMES = { prismatic: 'Prismatic joint', roll: 'Roll joint (no slip)', rollslide: 'Roll + slip joint' };
const PAIR_NOTES = {
  prismatic: 'Full joint (1 DOF): one link slides along the other without turning.',
  roll: 'Full joint (1 DOF): the two contours roll without slipping. Gear pitch circles behave like this.',
  rollslide: 'Half joint (2 DOF): the contours stay in contact but may slip, as with a cam and follower or gear teeth.',
};

function pairProps(app, id) {
  const p = app.doc.pairs.find((x) => x.id === id);
  if (!p) return null;
  const nums = app.linkNumbers();
  const name = (linkId) => (linkId ? `link ${nums.get(linkId)}` : 'the ground');
  const refName = (r) => {
    if (r.kind === 'disc') return `wheel ${nums.get(r.link)}`;
    if (r.kind === 'linkline') return `centre line of link ${nums.get(r.link)}`;
    const e = app.doc.construction.find((x) => x.id === r.id);
    return e ? `${ENTITY_NAMES[e.kind].toLowerCase()} ${e.attach ? `on link ${nums.get(e.attach)}` : '(fixed)'}` : 'missing contour';
  };
  const between = p.type === 'prismatic'
    ? `${name(p.slider).replace(/^./, (c) => c.toUpperCase())} slides in ${name(p.guide)}.`
    : `Between the ${refName(p.a)} and the ${refName(p.b)}.`;
  const parts = [h('div', { class: 'sel-title' }, PAIR_NAMES[p.type]), h('p', {}, between), h('p', { class: 'note' }, PAIR_NOTES[p.type])];
  if (p.type === 'prismatic') {
    const ang = Math.atan2(p.b.y - p.a.y, p.b.x - p.a.x) / DEG;
    parts.push(h('div', { class: 'field' }, h('span', { class: 'label' }, 'Axis angle'), h('span', {}, `${fmt(ang, 2)}°`)));
    if (!(app.doc.driver.type === 'prismatic' && app.doc.driver.pair === id)) {
      parts.push(h('div', { class: 'row-buttons' }, h('button', { class: 'btn primary', onclick: () => app.setInputSpec({ type: 'prismatic', pair: id }) }, 'Make this the input (push it)')));
    }
  } else {
    parts.push(h('div', { class: 'row-buttons' },
      h('button', { class: 'btn', onclick: () => app.edit('Change contact type', (doc) => { const x = doc.pairs.find((y) => y.id === id); x.type = x.type === 'roll' ? 'rollslide' : 'roll'; }) },
        p.type === 'roll' ? 'Allow slipping' : 'Make it pure rolling')));
  }
  parts.push(h('div', { class: 'row-buttons' }, deleteBtn(app)));
  return h('div', {}, parts);
}

// ---- linear actuator -----------------------------------------------------------------
function actuatorProps(app, id) {
  const u = (app.doc.actuators || []).find((x) => x.id === id);
  if (!u) return null;
  const i = app.doc.actuators.indexOf(u) + 1;
  const isInput = app.doc.driver.type === 'linear' && app.doc.driver.actuator === id;
  const a = app.sim.jointPos(u.a), b = app.sim.jointPos(u.b);
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const set = (label, fn) => app.edit(label, (doc) => fn(doc.actuators.find((x) => x.id === id)));
  return h('div', {},
    h('div', { class: 'sel-title' }, `Linear actuator ${i}`, isInput ? h('span', { class: 'tag info' }, 'input') : null),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Length now'), h('span', {}, U.fmt(L))),
    numField('Shortest', u.min, (v) => v > 0 && set('Set actuator stroke', (x) => { x.min = v; }), { unit: 'mm' }),
    numField('Longest', u.max, (v) => v > 0 && set('Set actuator stroke', (x) => { x.max = v; }), { unit: 'mm' }),
    h('p', { class: 'note' }, isInput
      ? 'This actuator drives the mechanism. Press Enter to run it between its shortest and longest lengths.'
      : 'Not the input: it holds its length, like a link (a cylinder with its valves closed).'),
    h('div', { class: 'row-buttons' },
      !isInput ? h('button', { class: 'btn primary', onclick: () => app.setInputSpec({ type: 'linear', actuator: id }) }, 'Make this the input') : null,
      deleteBtn(app)));
}

// ---- compass ---------------------------------------------------------------------
function compassProps(app) {
  return h('div', {},
    h('div', { class: 'sel-title' }, 'Compass'),
    numField('Radius', app.compassRadius(), (v) => { compassTool.setRadius(app, v); app.requestRender(); app.ui.refresh(app, 'tool'); }, { unit: 'mm' }),
    xyField('Needle', app.compass.needle, (p) => {
      const c = app.compass, off = { x: c.pencil.x - c.needle.x, y: c.pencil.y - c.needle.y };
      c.needle = p; c.pencil = { x: p.x + off.x, y: p.y + off.y };
      app.requestRender(); app.ui.refresh(app, 'tool');
    }),
    h('div', { class: 'row-buttons' }, h('button', { class: 'btn', onclick: () => compassTool.drawCircle(app) }, 'Draw full circle')),
    h('p', { class: 'note' }, 'To copy a length: drag the needle onto one end and the pencil tip onto the other. Then drag the needle to where you need that length.'),
  );
}

// ---- protractor ---------------------------------------------------------------------
function protractorProps(app) {
  const p = app.protractor;
  const set = (ch) => { protractorTool.set(app, ch); app.ui.refresh(app, 'tool'); };
  return h('div', {},
    h('div', { class: 'sel-title' }, 'Protractor'),
    xyField('Centre', p.c, (c) => set({ c })),
    numField('Baseline angle', (p.base * 180) / Math.PI, (v) => set({ base: (v * Math.PI) / 180 }), { unit: '°' }),
    numField('Size (radius)', p.r, (v) => v > 0 && set({ r: v }), { unit: 'mm' }),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: p.full, onchange: (e) => set({ full: e.target.checked }) }), 'Full circle (360°)'),
    h('div', { class: 'row-buttons' }, h('button', { class: 'btn', onclick: () => set({ base: 0 }) }, 'Baseline horizontal')),
    h('p', { class: 'note' }, 'To measure an angle: put the centre on the vertex, turn the grip until the baseline passes through one arm, then hover over the other arm.'),
  );
}

// ---- background picture -------------------------------------------------------------
function backgroundProps(app) {
  const bg = app.doc.background;
  const load = h('button', { class: 'btn primary', onclick: async () => { const f = await pickFile('image/*'); if (f) app.loadBackground(f); } }, bg ? 'Replace picture' : 'Load picture');
  if (!bg) {
    return h('div', {},
      h('div', { class: 'sel-title' }, 'Background picture'),
      h('p', { class: 'note' }, 'Paste a screenshot with Ctrl+V, drop a picture on the window, or load one.'),
      h('div', { class: 'row-buttons' }, load));
  }
  const set = (label, fn) => app.edit(label, (doc) => fn(doc.background));
  return h('div', {},
    h('div', { class: 'sel-title' }, 'Background picture'),
    h('div', { class: 'field' }, h('label', {}, 'Opacity'),
      h('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: bg.opacity, oninput: (e) => { bg.opacity = +e.target.value; app.requestRender(); }, onchange: () => app.ui.refresh(app, 'doc') })),
    numField('Rotation', (bg.rotation * 180) / Math.PI, (v) => set('Rotate picture', (b) => { b.rotation = (v * Math.PI) / 180; }), { unit: '°' }),
    numField('Scale', bg.mmPerPx, (v) => v > 0 && set('Scale picture', (b) => { b.mmPerPx = v; }), { unit: 'mm/px', digits: 5 }),
    h('div', { class: 'row-buttons' },
      h('button', { class: 'btn', onclick: () => app.setTool('scale') }, 'Set scale from a known length'),
      load,
      h('button', { class: 'btn danger', onclick: () => app.edit('Remove picture', (doc) => { doc.background = null; }) }, 'Remove')),
  );
}

// ---- nothing selected ---------------------------------------------------------------
function gettingStarted(app) {
  const empty = !app.doc.joints.length;
  return h('div', {},
    h('p', { class: 'note' }, 'Select something to see and edit its properties here.'),
    empty ? h('div', {},
      h('div', { class: 'subhead' }, 'Getting started'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Paste a sketch (Ctrl+V) or draw a construction with the ', h('b', {}, 'Compass'), ' and ', h('b', {}, 'Line'), ' tools.'),
        h('li', {}, 'Place ', h('b', {}, 'Ground pivots'), ' (G) — they snap to intersections.'),
        h('li', {}, 'Draw ', h('b', {}, 'Links'), ' (K) from pivot to joint to joint to pivot.'),
        h('li', {}, 'Press ', h('kbd', {}, 'Enter'), ' or ▶ to run it. Drag a link to move it by hand.'),
      ),
      h('div', { class: 'subhead' }, 'Examples'),
      h('div', { class: 'row-buttons' }, EXAMPLES.map((ex, i) => h('button', { class: 'btn', onclick: () => app.ui.loadExample(i) }, ex.name))),
    ) : null,
  );
}
