// =============================================================================
// document.js — the LinkLab document (everything that gets saved to a file)
// -----------------------------------------------------------------------------
// All geometry is stored in WORLD coordinates (mm, y pointing up) at the
// DESIGN POSE — the position the mechanism was drawn in. While the mechanism
// moves, nothing here changes; the moving positions are computed from it.
//
//   joints      pin (revolute) joints. `ground: true` makes a fixed pivot.
//   links       rigid bodies; each lists the joints it carries. A link with
//               one joint and a `disc` radius is a wheel (or a gear's pitch
//               circle).
//   sliders     pin-in-slot: a joint that slides along a rail. The rail is
//               fixed (`on: null`) or carried by a link (`on: linkId`).
//   pairs       other kinematic pairs between two bodies:
//                 prismatic  { guide, slider, a, b }   sliding, no rotation
//                 roll       { a: ref, b: ref }        rolling without slip
//                 rollslide  { a: ref, b: ref }        rolling with slip
//               where ref = { kind: 'disc', link } | { kind: 'entity', id }
//                         | { kind: 'linkline', link }
//   actuators   linear actuators (hydraulic / electric cylinders) between two
//               joints { a, b, min, max }. The one chosen as input is driven;
//               the others hold their length, like a link.
//   driver      the input (what the motor or actuator moves):
//                 { type: 'rotary', link, pivot, ref }  motor at a pin; ref =
//                     null for a motor on the ground, or the link it is mounted on
//                 { type: 'linear', actuator }          a linear actuator
//                 { type: 'slider', slider }            push a slider along its rail
//                 { type: 'prismatic', pair }           push a prismatic joint
//   output      what to report and plot against the input (see outputs.js)
//   lockDesign  true = dragging cannot change any length (links may also be
//               locked one by one with link.locked)
//   construction  drafting entities (points, lines, arcs, circles, dims).
//   bodies      arbitrary outlines (polygons) shown on the bodies layer.
//
// Construction entities and bodies have `attach`: null means fixed to the
// ground (drawing sheet); a link id means the item moves with that link.
// =============================================================================

export const FORMAT = 'linklab';
export const FORMAT_VERSION = 1;

/** A new, empty document. */
export function createDocument() {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    meta: { title: 'Untitled mechanism', notes: '' },
    nextId: 1,
    layers: {
      background:   { visible: true, locked: false, faded: false },
      construction: { visible: true, locked: false, faded: false },
      mechanism:    { visible: true, locked: false, faded: false },
      bodies:       { visible: true, locked: false, faded: false },
    },
    background: null, // { image (data URL), x, y, mmPerPx, rotation, opacity }
    construction: [],
    joints: [],
    links: [],
    sliders: [],
    pairs: [],
    actuators: [],
    bodies: [],
    loads: [],      // external forces and torques on links (see loads.js)
    driver: { type: 'rotary', link: null, pivot: null, ref: null },
    output: null,
    units: { length: 'mm', grid: 0 }, // shown unit and grid spacing (geometry is stored in mm)
    dynamics: { mode: 'off', gravity: true, g: 9.81, material: 'steel', thickness: 6, width: null }, // force analysis (see mass.js)
    lockDesign: false,
    motion: { omega: 10, alpha: 0, reverse: false }, // input speed rad/s, CCW positive
  };
}

/** Next unique id with a readable prefix, e.g. newId(doc, 'j') → 'j7'. */
export function newId(doc, prefix) {
  return `${prefix}${doc.nextId++}`;
}

// ---- lookups ---------------------------------------------------------------

export const jointById = (doc, id) => doc.joints.find((j) => j.id === id) || null;
export const linkById = (doc, id) => doc.links.find((l) => l.id === id) || null;

/** All links that carry the given joint. */
export const linksAtJoint = (doc, jointId) => doc.links.filter((l) => l.joints.includes(jointId));

/** Sliders acting on the given joint. */
export const slidersAtJoint = (doc, jointId) => doc.sliders.filter((s) => s.joint === jointId);

/**
 * Is this link held still by the ground? A link with two or more ground
 * pivots (the "link 1" of a textbook figure, drawn as a link) cannot move:
 * it is part of the frame.
 */
export function isFrameLink(doc, link) {
  if (link.disc) return false;
  let n = 0;
  for (const id of link.joints) { const j = jointById(doc, id); if (j && j.ground) n++; }
  return n >= 2;
}

/** The links that can move: all links except frame links. */
export const movingLinks = (doc) => doc.links.filter((l) => !isFrameLink(doc, l));

/**
 * Number of members meeting at a joint: links + ground (if pinned to ground)
 * + slider blocks. A joint with 2 or more members is a real connection.
 */
export function membersAtJoint(doc, joint) {
  return linksAtJoint(doc, joint.id).length + (joint.ground ? 1 : 0) + slidersAtJoint(doc, joint.id).length;
}

// ---- edits that keep the document consistent ------------------------------

export function addJoint(doc, x, y, opts = {}) {
  const j = { id: newId(doc, 'j'), x, y, ground: !!opts.ground, trace: !!opts.trace };
  doc.joints.push(j);
  return j;
}

export function addLink(doc, jointIds) {
  const l = { id: newId(doc, 'L'), joints: [...jointIds] };
  doc.links.push(l);
  autoDriver(doc);
  return l;
}

/**
 * Make a joint slide along a rail through a and b (design-pose world
 * coordinates). `on` = null for a fixed rail, or the link that carries it.
 */
export function addSlider(doc, jointId, a, b, on = null) {
  // one slider per joint keeps things simple to explain
  doc.sliders = doc.sliders.filter((s) => s.joint !== jointId);
  const s = { id: newId(doc, 's'), joint: jointId, a: { ...a }, b: { ...b }, on };
  doc.sliders.push(s);
  return s;
}

/** A wheel: a link with one joint (its centre) and a disc of radius r. */
export function addWheel(doc, jointId, r) {
  const l = { id: newId(doc, 'L'), joints: [jointId], disc: r };
  doc.links.push(l);
  autoDriver(doc);
  return l;
}

/** Add a prismatic, roll or roll-slide pair. */
export function addPair(doc, pair) {
  const p = { id: newId(doc, 'p'), ...pair };
  doc.pairs.push(p);
  return p;
}

/** Does this pair use the given link (directly or through a wheel/centre line)? */
export function pairUsesLink(p, linkId) {
  if (p.type === 'prismatic') return p.guide === linkId || p.slider === linkId;
  return [p.a, p.b].some((r) => (r.kind === 'disc' || r.kind === 'linkline') && r.link === linkId);
}

/** Does this pair use the given construction entity as a contour? */
export const pairUsesEntity = (p, id) => p.type !== 'prismatic' && [p.a, p.b].some((r) => r.kind === 'entity' && r.id === id);

/** Delete a construction entity and any contact pair that rolls on it. */
export function removeConstruction(doc, id) {
  doc.construction = doc.construction.filter((e) => e.id !== id);
  doc.pairs = doc.pairs.filter((p) => !pairUsesEntity(p, id));
}

/** A linear actuator between joints a and b, with its stroke limits (lengths in mm). */
export function addActuator(doc, aId, bId) {
  const A = jointById(doc, aId), B = jointById(doc, bId);
  const L = Math.hypot(B.x - A.x, B.y - A.y);
  const act = { id: newId(doc, 'u'), a: aId, b: bId, min: +(L * 0.7).toFixed(2), max: +(L * 1.3).toFixed(2) };
  doc.actuators.push(act);
  return act;
}

/**
 * Join two joints into one pin (keep `keepId`, drop `dropId`): every link,
 * slider and actuator on the dropped joint moves to the kept one. Returns
 * false (and changes nothing) if both are on the same link, which would
 * collapse that link.
 */
export function mergeJoints(doc, keepId, dropId) {
  const keep = jointById(doc, keepId), drop = jointById(doc, dropId);
  if (!keep || !drop || keepId === dropId) return false;
  if (doc.links.some((l) => l.joints.includes(keepId) && l.joints.includes(dropId))) return false;
  keep.ground = keep.ground || drop.ground;
  keep.trace = keep.trace || drop.trace;
  if (!keep.traceColor && drop.traceColor) keep.traceColor = drop.traceColor;
  for (const l of doc.links) l.joints = l.joints.map((id) => (id === dropId ? keepId : id));
  // frames that name the dropped joint (typed centre of mass, counterweights, loads)
  const swap = (o) => { if (o) { if (o.from === dropId) o.from = keepId; if (o.to === dropId) o.to = keepId; } };
  for (const l of doc.links) { swap(l.mass && l.mass.local); (l.counterweights || []).forEach(swap); }
  for (const f of doc.loads || []) swap(f.frame);
  // one slider per joint: keep the kept joint's own slider if it has one
  if (doc.sliders.some((s) => s.joint === keepId)) doc.sliders = doc.sliders.filter((s) => s.joint !== dropId);
  for (const s of doc.sliders) if (s.joint === dropId) s.joint = keepId;
  for (const u of doc.actuators || []) { if (u.a === dropId) u.a = keepId; if (u.b === dropId) u.b = keepId; }
  doc.actuators = (doc.actuators || []).filter((u) => u.a !== u.b);
  if (doc.driver.pivot === dropId) doc.driver.pivot = keepId;
  if (doc.output && doc.output.joint === dropId) doc.output = { ...doc.output, joint: keepId };
  doc.joints = doc.joints.filter((j) => j.id !== dropId);
  autoDriver(doc);
  return true;
}

/** Pairs of joints drawn on the same spot but not joined (a common slip): [[a, b], …]. */
export function coincidentJoints(doc, tol = 0.01) {
  const out = [];
  for (let i = 0; i < doc.joints.length; i++) {
    for (let k = i + 1; k < doc.joints.length; k++) {
      const a = doc.joints[i], b = doc.joints[k];
      if (Math.hypot(a.x - b.x, a.y - b.y) <= tol) out.push([a.id, b.id]);
    }
  }
  return out;
}

/** Pin an existing joint to a link it is not on yet (the link gets one more joint). */
export function attachJoint(doc, jointId, linkId) {
  const l = linkById(doc, linkId);
  if (!l || l.disc || l.joints.includes(jointId) || !jointById(doc, jointId)) return false;
  l.joints.push(jointId);
  return true;
}

/** Minimum joints for a link to exist: wheels need 1, bars and plates 2. */
const minJoints = (l) => (l.disc ? 1 : 2);

/** Delete a joint and everything that depends on it. */
export function removeJoint(doc, jointId) {
  doc.joints = doc.joints.filter((j) => j.id !== jointId);
  doc.sliders = doc.sliders.filter((s) => s.joint !== jointId);
  doc.actuators = (doc.actuators || []).filter((u) => u.a !== jointId && u.b !== jointId);
  for (const l of doc.links) l.joints = l.joints.filter((id) => id !== jointId);
  const dead = doc.links.filter((l) => l.joints.length < minJoints(l)).map((l) => l.id);
  for (const id of dead) removeLink(doc, id, false);
  autoDriver(doc);
}

/** Delete a link. Joints it leaves unused are removed too (unless ground). */
export function removeLink(doc, linkId, cleanJoints = true) {
  const link = linkById(doc, linkId);
  doc.links = doc.links.filter((l) => l.id !== linkId);
  doc.sliders = doc.sliders.filter((s) => s.on !== linkId);
  doc.pairs = doc.pairs.filter((p) => !pairUsesLink(p, linkId));
  doc.loads = (doc.loads || []).filter((f) => f.link !== linkId);
  for (const c of doc.construction) if (c.attach === linkId) c.attach = null;
  for (const b of doc.bodies) if (b.attach === linkId) b.attach = null;
  if (cleanJoints && link) {
    for (const jid of link.joints) {
      const j = jointById(doc, jid);
      if (j && !j.ground && linksAtJoint(doc, jid).length === 0) removeJoint(doc, jid);
    }
  }
  autoDriver(doc);
}

/**
 * Clear part of the sheet. `what` is
 *   'construction'  points, lines, arcs, circles and dimensions (a circle or
 *                   line that a roll joint uses is kept, so the joint still works)
 *   'mechanism'     joints, links, wheels, sliders, other joints, actuators and
 *                   outlines; drawings carried by a link stay where they are
 *   'background'    the background picture
 *   'all'           all of these
 * The drawing name, layers and motion settings are kept. Returns how many
 * construction items were kept because a joint uses them.
 */
export function clearDocument(doc, what) {
  let kept = 0;
  if (what === 'mechanism' || what === 'all') {
    doc.joints = []; doc.links = []; doc.sliders = []; doc.pairs = []; doc.actuators = []; doc.bodies = []; doc.loads = [];
    for (const c of doc.construction) c.attach = null;
    doc.driver = { type: 'rotary', link: null, pivot: null, ref: null };
    doc.output = null;
  }
  if (what === 'construction' || what === 'all') {
    const used = (c) => doc.pairs.some((p) => pairUsesEntity(p, c.id));
    kept = doc.construction.filter(used).length;
    doc.construction = doc.construction.filter(used);
  }
  if (what === 'background' || what === 'all') doc.background = null;
  return { kept };
}

/** Is the document's input still valid (everything it refers to exists)? */
export function driverValid(doc) {
  const d = doc.driver || {};
  switch (d.type || 'rotary') {
    case 'rotary': {
      const link = d.link && linkById(doc, d.link);
      const pivot = d.pivot && jointById(doc, d.pivot);
      if (!link || !pivot || !link.joints.includes(pivot.id) || isFrameLink(doc, link)) return false;
      if (d.ref) { const ref = linkById(doc, d.ref); return !!ref && ref.id !== link.id && ref.joints.includes(pivot.id); }
      return pivot.ground;
    }
    case 'linear': return (doc.actuators || []).some((u) => u.id === d.actuator);
    case 'slider': return doc.sliders.some((s) => s.id === d.slider && !s.on);
    case 'prismatic': return (doc.pairs || []).some((p) => p.id === d.pair && p.type === 'prismatic');
    default: return false;
  }
}

/**
 * If no valid input is set, choose the first link that turns about a ground
 * pivot (a motor there). Students can change this, but usually it is the crank.
 */
export function autoDriver(doc) {
  if (driverValid(doc)) return;
  doc.driver = { type: 'rotary', link: null, pivot: null, ref: null };
  for (const l of movingLinks(doc)) {
    const g = l.joints.map((id) => jointById(doc, id)).find((j) => j && j.ground);
    if (g) { doc.driver = { type: 'rotary', link: l.id, pivot: g.id, ref: null }; return; }
  }
}

/** Put a motor on the ground pivot of a link (not a frame link: it cannot turn). */
export function setDriver(doc, linkId) {
  const l = linkById(doc, linkId);
  if (!l || isFrameLink(doc, l)) return false;
  const g = l.joints.map((id) => jointById(doc, id)).find((j) => j && j.ground);
  if (!g) return false;
  doc.driver = { type: 'rotary', link: l.id, pivot: g.id, ref: null };
  return true;
}

/** Set any kind of input (see the document header). Returns false if invalid. */
export function setDriverSpec(doc, spec) {
  const old = doc.driver;
  doc.driver = { ref: null, ...spec };
  if (!driverValid(doc)) { doc.driver = old; return false; }
  return true;
}

/**
 * The joint used with the pivot to measure the input angle θ2: the first
 * other joint on the driver link (Norton's point A).
 */
export function driverTipJoint(doc) {
  const l = linkById(doc, doc.driver.link);
  if (!l) return null;
  return jointById(doc, l.joints.find((id) => id !== doc.driver.pivot)) || null;
}

/**
 * Norton numbering: the ground (frame) is link 1, the input is link 2, and the
 * remaining links follow in the order they were drawn.
 */
export function linkNumbers(doc) {
  const map = new Map();
  let n = 2;
  // a frame link is the ground, link 1
  for (const l of doc.links) if (isFrameLink(doc, l)) map.set(l.id, 1);
  if ((doc.driver.type || 'rotary') === 'rotary' && doc.driver.link && linkById(doc, doc.driver.link) && !map.has(doc.driver.link)) map.set(doc.driver.link, n++);
  for (const l of doc.links) if (!map.has(l.id)) map.set(l.id, n++);
  // colours picked by hand ride along, so linkColor(map, id) can use them
  map.colors = new Map(doc.links.filter((l) => l.color).map((l) => [l.id, l.color]));
  return map;
}
