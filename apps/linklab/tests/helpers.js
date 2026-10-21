// Helpers that build textbook mechanisms as LinkLab documents for the tests.
import { createDocument, addJoint, addLink, addSlider } from '../src/model/document.js';
import { fourbarPosition, sliderCrankPosition } from '../src/kinematics/index.js';

/**
 * Fourbar with ground pivot O2 at `origin`, ground link at angle theta1,
 * drawn at input angle theta2 (local) in the chosen assembly.
 */
export function makeFourbar({ a, b, c, d, theta2, theta1 = 0, origin = { x: 0, y: 0 }, assembly = 'open' }) {
  const sol = fourbarPosition(a, b, c, d, theta2)[assembly];
  const R = (p) => ({
    x: origin.x + p.x * Math.cos(theta1) - p.y * Math.sin(theta1),
    y: origin.y + p.x * Math.sin(theta1) + p.y * Math.cos(theta1),
  });
  const pA = R({ x: a * Math.cos(theta2), y: a * Math.sin(theta2) });
  const pO4 = R({ x: d, y: 0 });
  const pB = R({ x: d + c * Math.cos(sol.theta4), y: c * Math.sin(sol.theta4) });
  const doc = createDocument();
  const O2 = addJoint(doc, origin.x, origin.y, { ground: true });
  const O4 = addJoint(doc, pO4.x, pO4.y, { ground: true });
  const A = addJoint(doc, pA.x, pA.y);
  const B = addJoint(doc, pB.x, pB.y);
  addLink(doc, [O2.id, A.id]);
  addLink(doc, [A.id, B.id]);
  addLink(doc, [O4.id, B.id]);
  return { doc, O2, O4, A, B, sol };
}

/** Offset slider-crank, slider axis along +x at height c above O2. */
export function makeSliderCrank({ a, b, c, theta2, assembly = 'open' }) {
  const sol = sliderCrankPosition(a, b, c, theta2)[assembly];
  const doc = createDocument();
  const O2 = addJoint(doc, 0, 0, { ground: true });
  const A = addJoint(doc, a * Math.cos(theta2), a * Math.sin(theta2));
  const B = addJoint(doc, sol.d, c);
  addLink(doc, [O2.id, A.id]);
  addLink(doc, [A.id, B.id]);
  addSlider(doc, B.id, { x: -100, y: c }, { x: 100, y: c });
  return { doc, O2, A, B, sol };
}
