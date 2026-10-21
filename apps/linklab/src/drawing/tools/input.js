// =============================================================================
// input.js — the Input tool (put the motor or choose the actuator that drives)
// -----------------------------------------------------------------------------
//   click a pivot     a motor there (if several links meet, choose which turns)
//   click a link      a motor at its pivot nearest the click (ground first)
//   click an actuator it drives the mechanism
//   click a slider    it is pushed along its rail
// =============================================================================

import { listInputs, specKey } from '../../model/outputs.js';

/** Inputs that belong to what is under screen point s: { hit, options[] }. */
export function inputsAt(app, s) {
  const hit = app.pickAt(s);
  if (!hit) return { hit: null, options: [] };
  const doc = app.doc, all = listInputs(doc);
  const nums = app.linkNumbers();
  const jname = (id) => `J${doc.joints.findIndex((j) => j.id === id) + 1}`;
  const label = (sp) => (sp.type === 'rotary'
    ? (sp.ref ? `Motor at ${jname(sp.pivot)}: link ${nums.get(sp.link)} turns on link ${nums.get(sp.ref)}` : `Motor at ${jname(sp.pivot)} turning link ${nums.get(sp.link)}`)
    : all.find((c) => specKey(c.spec) === specKey(sp)).label);
  let specs = [];
  if (hit.kind === 'joint') specs = all.filter((c) => c.spec.type === 'rotary' && c.spec.pivot === hit.id).map((c) => c.spec);
  if (hit.kind === 'link') {
    // the pivot nearest the click, ground pivots first
    const w = app.view.toWorld(s);
    const mine = all.filter((c) => c.spec.type === 'rotary' && c.spec.link === hit.id).map((c) => c.spec);
    const dist = (sp) => { const p = app.sim.jointPos(sp.pivot); return Math.hypot(p.x - w.x, p.y - w.y); };
    const ground = mine.filter((sp) => !sp.ref);
    const pool = ground.length ? ground : mine;
    pool.sort((a, b) => dist(a) - dist(b));
    specs = pool.length ? pool.filter((sp) => sp.pivot === pool[0].pivot) : [];
  }
  if (hit.kind === 'actuator') specs = [{ type: 'linear', actuator: hit.id }];
  if (hit.kind === 'slider' && !doc.sliders.find((x) => x.id === hit.id).on) specs = [{ type: 'slider', slider: hit.id }];
  if (hit.kind === 'pair') {
    const p = doc.pairs.find((x) => x.id === hit.id);
    if (p && p.type === 'prismatic') specs = [{ type: 'prismatic', pair: p.id }];
  }
  return { hit, options: specs.map((spec) => ({ spec, label: label(spec) })) };
}

export const inputTool = {
  id: 'input', label: 'Input: motor or actuator', shortcut: 'D', group: 'Mechanism', icon: 'motor', layer: 'mechanism',
  hint: () => 'Click a pivot or a link to put the motor there, or click a linear actuator or slider to drive with it. To add a cylinder, use Linear actuator (U).',
  cursor(app, s) { return inputsAt(app, s).options.length ? 'pointer' : 'default'; },
  down(app, ev) {
    const { hit, options } = inputsAt(app, ev.s);
    if (!options.length) {
      app.flash(hit && hit.kind === 'joint'
        ? 'No motor fits here: a motor goes on a pin where a link meets the ground or another link.'
        : 'Click a pivot, a link, a linear actuator or a slider.');
      return;
    }
    if (options.length === 1) { this.apply(app, options[0]); return; }
    // several links meet at this pin: ask which one the motor turns
    app.ui.quickMenu(ev.s, hit, [
      { head: 'Which link does the motor turn?' },
      ...options.map((o) => ({ label: o.label, checked: specKey(o.spec) === specKey(app.doc.driver), run: () => this.apply(app, o) })),
    ]);
  },
  apply(app, option) {
    app.setInputSpec(option.spec);
    if (!app.sim.drivable) return;
    // link numbers follow the input (it becomes link 2), so name it afterwards
    const d = app.doc.driver, nums = app.linkNumbers();
    const jn = (id) => `J${app.doc.joints.findIndex((j) => j.id === id) + 1}`;
    const what = d.type === 'rotary'
      ? `motor at ${jn(d.pivot)} turning link ${nums.get(d.link)}${d.ref ? ` on link ${nums.get(d.ref)}` : ''}`
      : option.label.toLowerCase();
    app.flash(`Input: ${what}. Press Enter to run it.`);
  },
};
