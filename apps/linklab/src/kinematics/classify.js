// =============================================================================
// classify.js — recognise textbook mechanisms in a drawing
// -----------------------------------------------------------------------------
// When the student's drawing is a fourbar or an offset slider-crank, LinkLab
// can show Norton's closed-form method beside the general solver. This file
// finds which joint is O2, A, B, O4 (etc.) and the link lengths a, b, c, d.
// =============================================================================

import { jointById, linkById, linksAtJoint, slidersAtJoint, isFrameLink, movingLinks } from '../model/document.js';
import { grashof } from './fourbar.js';

/** The links that can move at a joint (a frame link, held by two ground pivots, is part of the ground). */
const movingAtJoint = (doc, jointId) => linksAtJoint(doc, jointId).filter((l) => !isFrameLink(doc, l));

/** Joints of a link that connect to something else (ignores coupler points). */
function connectedJoints(doc, link) {
  return link.joints.filter((id) => {
    const j = jointById(doc, id);
    const k = movingAtJoint(doc, id).length + (j.ground ? 1 : 0) + slidersAtJoint(doc, id).length;
    return k >= 2;
  });
}

const len = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);

/**
 * The fourbar loop of a drawing, whatever drives it: three moving links in a
 * chain between two ground pivots, with only pin joints. O2 and the input
 * link are the ground-pivoted link `startId` when given (else the first
 * drawn). Returns the same shape as classify()'s fourbar, or null.
 */
export function fourbarLoop(doc, startId = null) {
  if ((doc.pairs || []).length || doc.sliders.length || doc.links.some((l) => l.disc)) return null;
  const moving = movingLinks(doc);
  if (moving.length !== 3) return null;
  const input = (startId && moving.find((l) => l.id === startId)) || moving.find((l) => connectedJoints(doc, l).some((id) => jointById(doc, id).ground));
  if (!input) return null;
  const inputConn = connectedJoints(doc, input);
  if (inputConn.length !== 2) return null;
  const O2 = jointById(doc, inputConn.find((id) => jointById(doc, id).ground));
  if (!O2) return null;
  const A = jointById(doc, inputConn.find((id) => id !== O2.id));
  if (!A || A.ground || movingAtJoint(doc, A.id).length !== 2) return null;
  const coupler = movingAtJoint(doc, A.id).find((l) => l.id !== input.id);
  const cConn = connectedJoints(doc, coupler);
  if (cConn.length !== 2) return null;
  const B = jointById(doc, cConn.find((id) => id !== A.id));
  if (!B || B.ground || movingAtJoint(doc, B.id).length !== 2) return null;
  const output = movingAtJoint(doc, B.id).find((l) => l.id !== coupler.id);
  if (!output || output.id === input.id) return null;
  const oConn = connectedJoints(doc, output);
  if (oConn.length !== 2) return null;
  const O4 = jointById(doc, oConn.find((id) => id !== B.id));
  if (!O4 || !O4.ground || O4.id === O2.id) return null;
  const a = len(O2, A), b = len(A, B), c = len(O4, B), d = len(O2, O4);
  return {
    type: 'fourbar', O2, A, B, O4,
    links: { input: input.id, coupler: coupler.id, output: output.id },
    a, b, c, d, theta1: Math.atan2(O4.y - O2.y, O4.x - O2.x),
    grashof: grashof({ a, b, c, d }),
  };
}

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

  // ---- fourbar: three moving links, two ground pivots, the motor at O2 ----
  if (movingLinks(doc).length === 3 && doc.sliders.length === 0) {
    const loop = fourbarLoop(doc, input.id);
    return loop && loop.O2.id === O2.id ? loop : general;
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
