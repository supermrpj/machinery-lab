// =============================================================================
// examples.js — built-in example mechanisms
// =============================================================================

import { createDocument, addJoint, addLink, addWheel, addPair, addSlider, addActuator } from './document.js';
import { addConstruction } from './construction.js';

/** Grashof crank-rocker (a=40, b=120, c=80, d=100 mm) with a coupler point. */
export function exampleFourbar() {
  const doc = createDocument();
  doc.meta.title = 'Example fourbar';
  const a = 40, b = 120, c = 80, d = 100, t2 = (60 * Math.PI) / 180;
  const A = { x: a * Math.cos(t2), y: a * Math.sin(t2) };
  // B from the open circuit: intersection of circle(A, b) and circle(O4, c)
  const O4 = { x: d, y: 0 };
  const D = Math.hypot(O4.x - A.x, O4.y - A.y);
  const m = (b * b - c * c + D * D) / (2 * D);
  const hh = Math.sqrt(b * b - m * m);
  const ex = { x: (O4.x - A.x) / D, y: (O4.y - A.y) / D };
  const B = { x: A.x + m * ex.x - hh * ex.y, y: A.y + m * ex.y + hh * ex.x };
  const o2 = addJoint(doc, 0, 0, { ground: true });
  const o4 = addJoint(doc, O4.x, O4.y, { ground: true });
  const jA = addJoint(doc, A.x, A.y);
  const jB = addJoint(doc, B.x, B.y);
  const P = addJoint(doc, (A.x + B.x) / 2 - 0.35 * (B.y - A.y), (A.y + B.y) / 2 + 0.35 * (B.x - A.x), { trace: true });
  addLink(doc, [o2.id, jA.id]);
  addLink(doc, [jA.id, jB.id, P.id]);
  addLink(doc, [o4.id, jB.id]);
  return doc;
}

// ---- examples for the other joint types ------------------------------------------

/** Two gears (pitch circles in pure rolling) on fixed centres. */
export function exampleGears() {
  const doc = createDocument();
  doc.meta.title = 'Gear pair (pitch circles)';
  const O2 = addJoint(doc, 0, 0, { ground: true }), O3 = addJoint(doc, 100, 0, { ground: true });
  const g2 = addWheel(doc, O2.id, 40), g3 = addWheel(doc, O3.id, 60);
  const p = addJoint(doc, 0, 32, { trace: false });
  doc.links[0].joints.push(p.id); // a mark on gear 2 makes its turning easy to follow
  addPair(doc, { type: 'roll', a: { kind: 'disc', link: g2.id }, b: { kind: 'disc', link: g3.id } });
  return doc;
}

/** Planet gear on an arm, rolling around a fixed sun. */
export function examplePlanetary() {
  const doc = createDocument();
  doc.meta.title = 'Planet rolling on a fixed sun';
  const O = addJoint(doc, 0, 0, { ground: true });
  const P = addJoint(doc, 70, 0);
  addLink(doc, [O.id, P.id]);
  const planet = addWheel(doc, P.id, 25);
  const mark = addJoint(doc, 90, 0, { trace: true });
  planet.joints.push(mark.id);
  const sun = addConstruction(doc, 'circle', { c: { x: 0, y: 0 }, r: 45 }, null);
  addPair(doc, { type: 'roll', a: { kind: 'disc', link: planet.id }, b: { kind: 'entity', id: sun.id } });
  return doc;
}

/** Rack and pinion: the rack slides on the ground, rolling on the pinion. */
export function exampleRackPinion() {
  const doc = createDocument();
  doc.meta.title = 'Rack and pinion';
  const O = addJoint(doc, 0, 0, { ground: true });
  const pinion = addWheel(doc, O.id, 30);
  const R1 = addJoint(doc, -90, 30), R2 = addJoint(doc, 90, 30);
  const rack = addLink(doc, [R1.id, R2.id]);
  addPair(doc, { type: 'prismatic', guide: null, slider: rack.id, a: { x: -90, y: 30 }, b: { x: 90, y: 30 } });
  addPair(doc, { type: 'roll', a: { kind: 'disc', link: pinion.id }, b: { kind: 'linkline', link: rack.id } });
  return doc;
}

/** Eccentric circular cam with a flat-faced follower (roll + slip). */
export function exampleCam() {
  const doc = createDocument();
  doc.meta.title = 'Eccentric cam, flat-faced follower';
  const O = addJoint(doc, 0, 0, { ground: true });
  const C = addJoint(doc, 15, 0);
  const cam = addLink(doc, [O.id, C.id]);
  addConstruction(doc, 'circle', { c: { x: 15, y: 0 }, r: 40 }, cam.id);
  const F1 = addJoint(doc, -45, 40), F2 = addJoint(doc, 45, 40), F3 = addJoint(doc, 0, 110);
  const follower = addLink(doc, [F1.id, F2.id, F3.id]);
  addPair(doc, { type: 'prismatic', guide: null, slider: follower.id, a: { x: 0, y: 40 }, b: { x: 0, y: 110 } });
  addPair(doc, { type: 'rollslide', a: { kind: 'entity', id: doc.construction[0].id }, b: { kind: 'linkline', link: follower.id } });
  return doc;
}

/** Inverted slider-crank: link 3 slides through a block pivoted on the ground. */
export function exampleInverted() {
  const doc = createDocument();
  doc.meta.title = 'Inverted slider-crank';
  const O2 = addJoint(doc, 0, 0, { ground: true }), O4 = addJoint(doc, 90, 0, { ground: true });
  const A = addJoint(doc, 40 * Math.cos(1.2), 40 * Math.sin(1.2));
  const dx = 90 - A.x, dy = -A.y, L = Math.hypot(dx, dy);
  const E = addJoint(doc, A.x + (dx / L) * 170, A.y + (dy / L) * 170, { trace: true });
  addLink(doc, [O2.id, A.id]);
  const l3 = addLink(doc, [A.id, E.id]);
  addSlider(doc, O4.id, { x: A.x, y: A.y }, { x: E.x, y: E.y }, l3.id);
  return doc;
}

/** A boom lifted by a hydraulic cylinder (linear actuator input). */
export function exampleBoom() {
  const doc = createDocument();
  doc.meta.title = 'Boom lifted by a cylinder';
  const O = addJoint(doc, 0, 0, { ground: true });
  const G = addJoint(doc, 70, -45, { ground: true });
  const B = addJoint(doc, 110 * Math.cos(0.35), 110 * Math.sin(0.35));
  const T = addJoint(doc, 230 * Math.cos(0.35), 230 * Math.sin(0.35), { trace: true });
  addLink(doc, [O.id, B.id, T.id]);
  const u = addActuator(doc, G.id, B.id);
  doc.driver = { type: 'linear', actuator: u.id, ref: null };
  doc.motion.omega = 20;
  doc.output = { kind: 'angle', link: doc.links[0].id };
  return doc;
}

export const EXAMPLES = [
  { name: 'Fourbar (crank-rocker)', make: exampleFourbar },
  { name: 'Inverted slider-crank', make: exampleInverted },
  { name: 'Gear pair', make: exampleGears },
  { name: 'Planet on a fixed sun', make: examplePlanetary },
  { name: 'Rack and pinion', make: exampleRackPinion },
  { name: 'Cam and flat follower', make: exampleCam },
  { name: 'Boom lifted by a cylinder', make: exampleBoom },
];
