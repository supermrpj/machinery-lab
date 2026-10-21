// =============================================================================
// quickmenu.js — the right-click (or long-press) menu on the drawing
// -----------------------------------------------------------------------------
// Right-click a link, joint, actuator or slider to make it the input, choose
// what it gives as the output, or change it, without going to the panels.
//
//   menuItems(app, sel)          → [{ head } | { label, checked?, disabled?, danger?, run }]
//   openQuickMenu(stage, app, at, sel)
// =============================================================================

import { h } from '../../../../packages/ui-kit/src/dom.js';
import { listInputs, specKey } from '../model/outputs.js';
import { jointById, linkById, mergeJoints, attachJoint } from '../model/document.js';
import { otherLinkAt } from '../drawing/tools/mechanism.js';
import { openMassDialog } from './massDialog.js';
import { openLoadDialog } from './loadDialog.js';

/** Key of the input in use, in the same form as specKey(listInputs()[k].spec). */
function currentInputKey(doc) {
  const d = doc.driver || {};
  const o = { type: d.type || 'rotary' };
  for (const k of ['link', 'pivot', 'ref', 'actuator', 'slider', 'pair']) if (d[k] !== undefined && d[k] !== null) o[k] = d[k];
  return specKey(o);
}

/** The menu for a selection (plain objects, so it can be tested without a page). */
export function menuItems(app, sel) {
  const doc = app.doc, nums = app.linkNumbers();
  const jname = (id) => `J${doc.joints.findIndex((j) => j.id === id) + 1}`;
  const inKey = currentInputKey(doc);
  const outKey = specKey(app.output());
  const inputs = listInputs(doc);
  const items = [];
  const input = (spec, label) => items.push({
    label, checked: specKey(spec) === inKey,
    run: () => { if (specKey(spec) !== inKey) app.setInputSpec(spec); },
  });
  const output = (spec, label) => items.push({
    label, checked: specKey(spec) === outKey,
    run: () => app.setOutput(spec),
  });
  const del = (label) => items.push({ label, danger: true, run: () => app.deleteSelection() });

  if (sel.kind === 'link') {
    const link = linkById(doc, sel.id);
    if (!link) return [];
    const n = nums.get(link.id);
    items.push({ head: `${link.disc ? 'Wheel' : 'Link'} ${n}` });
    const mine = inputs.filter((c) => c.spec.type === 'rotary' && c.spec.link === link.id);
    if (mine.length) {
      items.push({ sub: 'Input' });
      for (const c of mine) {
        const s = c.spec;
        input(s, s.ref ? `Motor at ${jname(s.pivot)}, turning against link ${nums.get(s.ref)}` : `Motor at ${jname(s.pivot)} on the ground`);
      }
    }
    items.push({ sub: 'Output' });
    output({ kind: 'angle', link: link.id }, `Angle of link ${n}`);
    items.push({ sub: 'Link' });
    items.push({ label: 'Mass and centre of mass…', run: () => openMassDialog(app, link.id) });
    items.push({
      label: 'Lock its lengths', checked: !!link.locked, disabled: !!doc.lockDesign,
      run: () => app.edit(link.locked ? 'Unlock link' : 'Lock link', (d) => { const l = linkById(d, link.id); l.locked = !l.locked; }),
    });
    del('Delete link');
  } else if (sel.kind === 'joint') {
    const j = jointById(doc, sel.id);
    if (!j) return [];
    items.push({ head: `${j.ground ? 'Ground pivot' : 'Joint'} ${jname(j.id)}` });
    const here = inputs.filter((c) => c.spec.type === 'rotary' && c.spec.pivot === j.id);
    if (here.length) {
      items.push({ sub: 'Input' });
      for (const c of here) {
        const s = c.spec;
        input(s, s.ref ? `Motor here: link ${nums.get(s.link)} turns on link ${nums.get(s.ref)}` : `Motor here, turning link ${nums.get(s.link)}`);
      }
    }
    if (!j.ground) {
      items.push({ sub: 'Output' });
      output({ kind: 'x', joint: j.id }, `x of ${jname(j.id)}`);
      output({ kind: 'y', joint: j.id }, `y of ${jname(j.id)}`);
    }
    items.push({ sub: 'Joint' });
    // repair: another joint on the same spot, or a link passing over this joint
    if (app.sim && app.view) {
      const p = app.sim.jointPos(j.id), tol = app.view.px(3);
      for (const o of doc.joints) {
        if (o.id === j.id) continue;
        const q = app.sim.jointPos(o.id);
        if (Math.hypot(q.x - p.x, q.y - p.y) > tol) continue;
        const keepName = jname(j.id), dropName = jname(o.id);
        items.push({
          label: `Join with ${dropName} here (one pin)`,
          run: () => {
            let ok = false;
            app.edit('Join joints', (d) => { ok = mergeJoints(d, j.id, o.id); });
            app.flash(ok ? `${dropName} joined into ${keepName}: they are now one pin.` : 'These joints are on the same link, so they cannot be joined.', !ok);
          },
        });
      }
      const over = otherLinkAt(app, app.view.toScreen(p), j.id, 4);
      if (over && !doc.joints.some((o) => o.id !== j.id && linkById(doc, over).joints.includes(o.id) && Math.hypot(app.sim.jointPos(o.id).x - p.x, app.sim.jointPos(o.id).y - p.y) <= tol)) {
        items.push({ label: `Pin to link ${nums.get(over)} here`, run: () => app.edit('Pin joint to link', (d) => { attachJoint(d, j.id, over); }) });
      }
    }
    items.push({
      label: 'Fixed to the ground', checked: !!j.ground,
      run: () => app.edit(j.ground ? 'Free joint' : 'Pin joint to ground', (d) => { const x = jointById(d, j.id); x.ground = !x.ground; }),
    });
    items.push({
      label: 'Trace its path', checked: !!j.trace,
      run: () => app.edit(j.trace ? 'Stop tracing' : 'Trace path', (d) => { const x = jointById(d, j.id); x.trace = !x.trace; }),
    });
    del('Delete joint');
  } else if (sel.kind === 'actuator') {
    const k = (doc.actuators || []).findIndex((u) => u.id === sel.id);
    if (k < 0) return [];
    items.push({ head: `Linear actuator ${k + 1}` });
    items.push({ sub: 'Input' });
    input({ type: 'linear', actuator: sel.id }, 'Drive the mechanism with it');
    items.push({ sub: 'Output' });
    output({ kind: 'stroke', actuator: sel.id }, 'Its length');
    del('Delete actuator');
  } else if (sel.kind === 'slider') {
    const k = doc.sliders.findIndex((s) => s.id === sel.id);
    if (k < 0) return [];
    items.push({ head: `Slider ${k + 1}` });
    if (!doc.sliders[k].on) {
      items.push({ sub: 'Input' });
      input({ type: 'slider', slider: sel.id }, 'Push it along its rail');
    }
    items.push({ sub: 'Output' });
    output({ kind: 'slider', slider: sel.id }, 'Its position');
    del('Delete slider');
  } else if (sel.kind === 'pair') {
    const p = (doc.pairs || []).find((x) => x.id === sel.id);
    if (!p) return [];
    items.push({ head: p.type === 'prismatic' ? 'Prismatic joint' : 'Contact' });
    if (p.type === 'prismatic') {
      items.push({ sub: 'Input' });
      input({ type: 'prismatic', pair: p.id }, `Push link ${nums.get(p.slider)} along it`);
    }
    del('Delete joint');
  } else if (sel.kind === 'load') {
    const f = (doc.loads || []).find((x) => x.id === sel.id);
    if (!f) return [];
    const isT = f.kind === 'torque';
    items.push({ head: `${isT ? 'Torque' : 'Force'} ${doc.loads.indexOf(f) + 1} on link ${nums.get(f.link)}` });
    items.push({ label: `Edit ${isT ? 'torque' : 'force'}…`, run: () => openLoadDialog(app, f.id) });
    if (!isT) {
      items.push({
        label: 'Turns with the link', checked: !!f.follow,
        run: () => app.edit(f.follow ? 'Force keeps its direction' : 'Force turns with link', (d) => { const x = d.loads.find((y) => y.id === f.id); x.follow = !x.follow; }),
      });
    }
    del(`Delete ${isT ? 'torque' : 'force'}`);
  } else {
    const names = { load: 'force', construction: 'drawing item', body: 'outline' };
    items.push({ head: names[sel.kind] ? names[sel.kind][0].toUpperCase() + names[sel.kind].slice(1) : 'Item' });
    del(`Delete ${names[sel.kind] || 'item'}`);
  }
  return items;
}

let openMenu = null;

/** Close the open menu, if any. */
export function closeQuickMenu() {
  if (openMenu) openMenu();
}

/** Show the menu for `sel` (or the `given` items) at screen point `at` (stage coordinates). */
export function openQuickMenu(stage, app, at, sel, given = null) {
  closeQuickMenu();
  const items = given || menuItems(app, sel);
  if (!items.length) return;
  const buttons = [];
  const box = h('div', { class: 'quickmenu', role: 'menu', 'aria-label': items[0].head || 'Menu' },
    items.map((it) => {
      if (it.head) return h('div', { class: 'qm-head' }, it.head);
      if (it.sub) return h('div', { class: 'qm-sub' }, it.sub);
      const b = h('button', {
        class: `qm-item${it.danger ? ' danger' : ''}`, role: it.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
        'aria-checked': it.checked === undefined ? null : String(!!it.checked), disabled: !!it.disabled,
        onclick: () => { close(); it.run(); },
      }, h('span', { class: 'qm-check' }, it.checked ? '✓' : ''), it.label);
      buttons.push(b);
      return b;
    }));

  const onDown = (e) => { if (!box.contains(e.target)) close(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      const live = buttons.filter((b) => !b.disabled);
      const k = live.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (k + 1) % live.length : (k - 1 + live.length) % live.length;
      if (live[next]) live[next].focus();
    }
  };
  function close() {
    box.remove();
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('wheel', close, true);
    window.removeEventListener('resize', close);
    openMenu = null;
  }
  openMenu = close;

  stage.append(box);
  // keep it inside the drawing area
  const W = stage.clientWidth, H = stage.clientHeight;
  const w = box.offsetWidth, ht = box.offsetHeight;
  const x = at.x + 4 + w > W - 6 ? Math.max(6, at.x - w - 4) : at.x + 4;
  const y = Math.max(6, Math.min(at.y + 4, H - ht - 6));
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;

  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('wheel', close, true);
  window.addEventListener('resize', close);
  const first = buttons.find((b) => !b.disabled);
  if (first) first.focus({ preventScroll: true });
}
