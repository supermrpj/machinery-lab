// =============================================================================
// mobility.js — Gruebler / Kutzbach degree-of-freedom count
// -----------------------------------------------------------------------------
//   M = 3(L − 1) − 2·J1 − J2                         (Norton, Ch. 2)
//   L  = number of links, INCLUDING the ground (frame) and slider blocks
//   J1 = full joints (1 DOF): pins, sliding joints, pure rolling
//        a pin where k members meet counts as k − 1 full joints
//   J2 = half joints (2 DOF): rolling with slipping (e.g. cam or gear teeth)
// A linear actuator is counted the textbook way: the one used as the input is
// a cylinder and a rod (2 links, 2 pins and a sliding joint); an actuator
// that only holds its length counts as a binary link (1 link, 2 pins).
// =============================================================================

import { jointById, linksAtJoint, slidersAtJoint } from '../model/document.js';

export function gruebler(doc) {
  // a slider (pin-in-slot) is counted the textbook way: a block link with a
  // pin and a sliding joint
  const blocks = doc.sliders.filter((s) => {
    const j = jointById(doc, s.joint);
    return j && (linksAtJoint(doc, s.joint).length > 0 || j.ground);
  }).length;
  const acts = (doc.actuators || []).filter((u) => jointById(doc, u.a) && jointById(doc, u.b));
  const inputAct = acts.filter((u) => doc.driver && doc.driver.type === 'linear' && doc.driver.actuator === u.id).length;
  const heldAct = acts.length - inputAct;
  const L = 1 + doc.links.length + blocks + 2 * inputAct + heldAct;
  const actAt = (id) => acts.filter((u) => u.a === id || u.b === id).length;
  let pinCount = 0;
  const detail = [];
  for (const j of doc.joints) {
    const k = linksAtJoint(doc, j.id).length + (j.ground ? 1 : 0) + slidersAtJoint(doc, j.id).length + actAt(j.id);
    if (k >= 2) { pinCount += k - 1; detail.push({ joint: j.id, members: k, counts: k - 1 }); }
  }
  const pairs = doc.pairs || [];
  const prismatic = blocks + inputAct + pairs.filter((p) => p.type === 'prismatic').length;
  const roll = pairs.filter((p) => p.type === 'roll').length;
  const rollslide = pairs.filter((p) => p.type === 'rollslide').length;
  const J1 = pinCount + prismatic + roll;
  const J2 = rollslide;
  const M = 3 * (L - 1) - 2 * J1 - J2;
  return { L, J1, J2, M, detail, blocks, pins: pinCount, prismatic, roll, rollslide, actuators: acts.length };
}
