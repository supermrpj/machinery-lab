// =============================================================================
// classify.js — recognise textbook mechanisms in a drawing
// -----------------------------------------------------------------------------
// When the student's drawing is a fourbar or an offset slider-crank, LinkLab
// can show Norton's closed-form method beside the general solver. This file
// finds which joint is O2, A, B, O4 (etc.) and the link lengths a, b, c, d.
// =============================================================================

import { jointById, linkById, linksAtJoint, slidersAtJoint } from '../model/document.js';
import { grashof } from './fourbar.js';

/** Joints of a link that connect to something else (ignores coupler points). */
function connectedJoints(doc, link) {
  return link.joints.filter((id) => {
    const j = jointById(doc, id);
    const k = linksAtJoint(doc, id).length + (j.ground ? 1 : 0) + slidersAtJoint(doc, id).length;
    return k >= 2;
  });
}

const len = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);

/**
 * Returns one of
 *   { type: 'fourbar', O2, A, B, O4, links: {input, coupler, output}, a, b, c, d, theta1, grashof }
 *   { type: 'slider-crank', O2, A, B, slider, links: {input, coupler}, a, b, c, theta1, sign }
 *   { type: 'general' }
 */
export function classify(doc) {
  const general = { type: 'general' };
  const input = linkById(doc, doc.driver.link);
  if (!input) return general;
  // the textbook closed forms assume a motor on the ground pivot of the crank
  if ((doc.driver.type || 'rotary') !== 'rotary' || doc.driver.ref) return general;
  // the textbook closed forms cover only pins and a fixed slider
  if ((doc.pairs || []).length || doc.sliders.some((s) => s.on) || doc.links.some((l) => l.disc)) return general;
  const O2 = jointById(doc, doc.driver.pivot);

  const inputConn = connectedJoints(doc, input);
  if (inputConn.length !== 2) return general;
  const A = jointById(doc, inputConn.find((id) => id !== O2.id));
  if (!A || A.ground) return general;

  // ---- fourbar: three moving links, two ground pivots ----
  if (doc.links.length === 3 && doc.sliders.length === 0) {
    const coupler = linksAtJoint(doc, A.id).find((l) => l.id !== input.id);
    if (!coupler) return general;
    const cConn = connectedJoints(doc, coupler);
    if (cConn.length !== 2 || linksAtJoint(doc, A.id).length !== 2) return general;
    const B = jointById(doc, cConn.find((id) => id !== A.id));
    if (!B || B.ground) return general;
    const output = linksAtJoint(doc, B.id).find((l) => l.id !== coupler.id);
    if (!output || output.id === input.id) return general;
    const oConn = connectedJoints(doc, output);
    if (oConn.length !== 2 || linksAtJoint(doc, B.id).length !== 2) return general;
    const O4 = jointById(doc, oConn.find((id) => id !== B.id));
    if (!O4 || !O4.ground || O4.id === O2.id) return general;
    const a = len(O2, A), b = len(A, B), c = len(O4, B), d = len(O2, O4);
    const theta1 = Math.atan2(O4.y - O2.y, O4.x - O2.x);
    // which assembly was drawn? compare with the open-circuit solution
    return {
      type: 'fourbar', O2, A, B, O4,
      links: { input: input.id, coupler: coupler.id, output: output.id },
      a, b, c, d, theta1,
      grashof: grashof({ a, b, c, d }),
    };
  }

  // ---- slider-crank: two moving links, one ground slider ----
  if (doc.links.length === 2 && doc.sliders.length === 1) {
    const coupler = linksAtJoint(doc, A.id).find((l) => l.id !== input.id);
    if (!coupler) return general;
    const cConn = connectedJoints(doc, coupler);
    if (cConn.length !== 2) return general;
    const B = jointById(doc, cConn.find((id) => id !== A.id));
    const slider = doc.sliders[0];
    if (!B || slider.joint !== B.id || B.ground) return general;
    const ux = slider.b.x - slider.a.x, uy = slider.b.y - slider.a.y;
    const theta1 = Math.atan2(uy, ux);
    const u = { x: Math.cos(theta1), y: Math.sin(theta1) };
    // offset c: distance of the slider axis from O2, measured along local +y
    const c = (slider.a.x - O2.x) * -u.y + (slider.a.y - O2.y) * u.x;
    return {
      type: 'slider-crank', O2, A, B, slider,
      links: { input: input.id, coupler: coupler.id },
      a: len(O2, A), b: len(A, B), c, theta1,
    };
  }
  return general;
}
