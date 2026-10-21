// =============================================================================
// outputs.js — the choices of input and output, in words students recognise
// -----------------------------------------------------------------------------
//   listInputs(doc)   every way the mechanism could be driven
//   listOutputs(doc)  every quantity that can be reported against the input
//   readOutput(...)   value, velocity and acceleration of the chosen output
// =============================================================================

import { jointById, linksAtJoint, linkNumbers, isFrameLink } from './document.js';

const DEG = 180 / Math.PI;

/** All possible inputs: motors at pins, actuators, sliders, prismatic joints. */
export function listInputs(doc) {
  const nums = linkNumbers(doc);
  const out = [];
  const name = (id) => `link ${nums.get(id)}`;
  for (const j of doc.joints) {
    const links = linksAtJoint(doc, j.id).filter((l) => !isFrameLink(doc, l)); // a frame link cannot turn
    if (j.ground) {
      for (const l of links) out.push({ spec: { type: 'rotary', link: l.id, pivot: j.id, ref: null }, label: `Motor on the ground turning ${name(l.id)}` });
    }
    for (const l of links) for (const r of links) {
      if (l.id === r.id) continue;
      out.push({ spec: { type: 'rotary', link: l.id, pivot: j.id, ref: r.id }, label: `Motor on ${name(r.id)} turning ${name(l.id)}` });
    }
  }
  (doc.actuators || []).forEach((u, i) => out.push({ spec: { type: 'linear', actuator: u.id }, label: `Linear actuator ${i + 1}` }));
  doc.sliders.forEach((s, i) => { if (!s.on) out.push({ spec: { type: 'slider', slider: s.id }, label: `Push slider ${i + 1} along its rail` }); });
  (doc.pairs || []).filter((p) => p.type === 'prismatic').forEach((p) => out.push({ spec: { type: 'prismatic', pair: p.id }, label: `Push ${name(p.slider)} along its prismatic joint` }));
  return out;
}

/** A short, stable key for an input or output spec (for <select> values). */
export const specKey = (s) => (s ? Object.entries(s).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}:${v}`).sort().join('|') : '');

/** All possible outputs. */
export function listOutputs(doc) {
  const nums = linkNumbers(doc);
  const out = [];
  for (const l of doc.links) if (!isFrameLink(doc, l)) out.push({ spec: { kind: 'angle', link: l.id }, label: `Angle of link ${nums.get(l.id)}`, unit: '°' });
  doc.joints.forEach((j, i) => {
    if (j.ground) return;
    const nm = j.trace ? `point P${doc.joints.filter((x) => x.trace).indexOf(j) + 1}` : `joint ${i + 1}`;
    out.push({ spec: { kind: 'x', joint: j.id }, label: `x of ${nm}`, unit: 'mm' });
    out.push({ spec: { kind: 'y', joint: j.id }, label: `y of ${nm}`, unit: 'mm' });
  });
  doc.sliders.forEach((s, i) => out.push({ spec: { kind: 'slider', slider: s.id }, label: `Position of slider ${i + 1}`, unit: 'mm' }));
  (doc.actuators || []).forEach((u, i) => out.push({ spec: { kind: 'stroke', actuator: u.id }, label: `Length of actuator ${i + 1}`, unit: 'mm' }));
  return out;
}

/** Is an output spec still valid for this document? */
export function outputValid(doc, o) {
  if (!o) return false;
  if (o.kind === 'angle') return doc.links.some((l) => l.id === o.link && !isFrameLink(doc, l)); // a frame link does not turn
  if (o.kind === 'x' || o.kind === 'y') return !!jointById(doc, o.joint);
  if (o.kind === 'slider') return doc.sliders.some((s) => s.id === o.slider);
  if (o.kind === 'stroke') return (doc.actuators || []).some((u) => u.id === o.actuator);
  return false;
}

/**
 * A sensible output when none is chosen: the last link that is not the
 * input (the rocker of a fourbar), or the slider of a slider-crank.
 */
export function defaultOutput(doc) {
  // a slider on a fixed rail (slider-crank): its position
  const fixed = doc.sliders.filter((s) => !s.on);
  if (fixed.length && doc.driver.type !== 'slider') return { kind: 'slider', slider: fixed[0].id };
  // a link sliding on the ground (rack, cam follower): its movement along the axis
  const pr = (doc.pairs || []).find((p) => p.type === 'prismatic' && !p.guide && !(doc.driver.type === 'prismatic' && doc.driver.pair === p.id));
  if (pr) {
    const l = doc.links.find((x) => x.id === pr.slider);
    const horizontal = Math.abs(pr.b.x - pr.a.x) >= Math.abs(pr.b.y - pr.a.y);
    if (l) return { kind: horizontal ? 'x' : 'y', joint: l.joints[0] };
  }
  const candidates = doc.links.filter((l) => l.id !== doc.driver.link && !isFrameLink(doc, l));
  const ground = candidates.filter((l) => l.joints.some((id) => { const j = jointById(doc, id); return j && j.ground; }));
  const pick = ground[ground.length - 1] || candidates[candidates.length - 1] || doc.links[0];
  return pick ? { kind: 'angle', link: pick.id } : null;
}

/** The output in use (the chosen one, or the default). */
export function currentOutput(doc) {
  return outputValid(doc, doc.output) ? doc.output : defaultOutput(doc);
}

/**
 * Value, velocity and acceleration of output `o` from pose results.
 * Angles in degrees (velocity rad/s, acceleration rad/s²); lengths in mm.
 */
export function readOutput(doc, results, o) {
  if (!o || !results) return null;
  if (o.kind === 'angle') {
    const r = results.links.get(o.link);
    return r && { value: r.theta * DEG, vel: r.omega, acc: r.alpha, angle: true };
  }
  if (o.kind === 'x' || o.kind === 'y') {
    const r = results.joints.get(o.joint);
    return r && { value: r.pos[o.kind], vel: r.vel ? r.vel[o.kind] : null, acc: r.acc ? r.acc[o.kind] : null };
  }
  if (o.kind === 'slider') {
    const r = results.sliders.get(o.slider);
    return r && { value: r.d, vel: r.v, acc: r.a };
  }
  if (o.kind === 'stroke') {
    const u = (doc.actuators || []).find((x) => x.id === o.actuator);
    const a = u && results.joints.get(u.a), b = u && results.joints.get(u.b);
    if (!a || !b) return null;
    const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, L = Math.hypot(dx, dy) || 1e-12;
    const vel = a.vel && b.vel ? (dx * (b.vel.x - a.vel.x) + dy * (b.vel.y - a.vel.y)) / L : null;
    return { value: L, vel, acc: null };
  }
  return null;
}
