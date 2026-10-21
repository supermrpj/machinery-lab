// =============================================================================
// cad.js — export to SolidWorks, Autodesk Inventor and other CAD programs
// -----------------------------------------------------------------------------
// Two exports, both based on DXF (the 2-D format every CAD program imports):
//
//  1. Layout drawing (one .dxf)
//     The whole mechanism as it is on screen: link profiles with pin holes,
//     centre lines, sliders, outlines, the construction and the traced paths,
//     each on its own layer. Import it as a sketch to lay out an assembly.
//
//  2. Parts for CAD (one .zip)
//     One .dxf per link, drawn in the link's own frame (first joint at the
//     origin, x-axis along the link), ready to extrude into a part; a frame
//     drawing with the ground pivots; each traced path as an X Y Z point file
//     (SolidWorks: Insert › Curve › Curve Through XYZ Points); and a
//     README.txt with the link lengths and joint coordinates for mating.
// =============================================================================

import { Dxf, ACI } from '../../../../packages/cad-export/src/dxf.js';
import { makeZip } from '../../../../packages/cad-export/src/zip.js';
import { linkOutline } from '../../../../packages/cad-export/src/outline.js';
import { jointById, linksAtJoint, slidersAtJoint } from '../model/document.js';
import { railNow } from '../drawing/render.js';
import { APP } from '../config.js';

export const CAD_DEFAULTS = { linkWidth: 12, pinDiameter: 6 };

const LAYERS = {
  LINKS: ACI.white, PIN_HOLES: ACI.red, CENTRE_LINES: ACI.cyan, GROUND: ACI.yellow,
  SLIDERS: ACI.yellow, OUTLINES: ACI.green, CONSTRUCTION: ACI.grey, PATHS: ACI.magenta, NOTES: ACI.blue,
};

/** A joint is a pin (gets a hole) when two or more members meet there, or it is pinned to ground. */
function isPin(doc, j) {
  const k = linksAtJoint(doc, j.id).length + (j.ground ? 1 : 0) + slidersAtJoint(doc, j.id).length;
  return k >= 2 || j.ground;
}

/** Add one link's profile, holes and centre lines to a DXF, mapping points with T. */
function addLink(d, doc, link, pos, T, opt, layers = {}) {
  const L = { links: 'LINKS', holes: 'PIN_HOLES', centre: 'CENTRE_LINES', ...layers };
  const pts = link.joints.map((id) => T(pos(id)));
  const pinR = opt.pinDiameter / 2;
  if (link.disc) {
    d.circle(L.links, pts[0], link.disc);
  } else {
    const o = linkOutline(pts, opt.linkWidth / 2);
    if (o.circle) d.circle(L.links, o.circle.c, o.circle.r);
    for (const s of o.lines) d.line(L.links, s.a, s.b);
    for (const a of o.arcs) d.arc(L.links, a.c, a.r, a.start, a.end);
  }
  link.joints.forEach((id, k) => {
    const j = jointById(doc, id), p = pts[k];
    if (isPin(doc, j)) d.circle(L.holes, p, pinR);
    else { // a coupler point: centre mark only
      d.line(L.centre, { x: p.x - pinR, y: p.y }, { x: p.x + pinR, y: p.y });
      d.line(L.centre, { x: p.x, y: p.y - pinR }, { x: p.x, y: p.y + pinR });
    }
  });
  for (let i = 0; i < pts.length; i++) for (let k = i + 1; k < pts.length; k++) d.line(L.centre, pts[i], pts[k]);
}

const identity = (p) => p;
const fileName = (s) => (s || 'mechanism').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'mechanism';

// -----------------------------------------------------------------------------
// 1. Layout drawing at the current position
// -----------------------------------------------------------------------------
export function layoutDXF(app, opt = CAD_DEFAULTS) {
  const doc = app.doc, sim = app.sim, nums = app.linkNumbers();
  const d = new Dxf();
  for (const [n, c] of Object.entries(LAYERS)) d.layer(n, c);
  const pos = (id) => sim.jointPos(id);

  for (const link of doc.links) {
    addLink(d, doc, link, pos, identity, opt);
    const pts = link.joints.map(pos);
    const c = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, y: s.y + p.y / pts.length }), { x: 0, y: 0 });
    d.text('NOTES', { x: c.x + opt.linkWidth * 0.6, y: c.y + opt.linkWidth * 0.6 }, opt.linkWidth * 0.5, `Link ${nums.get(link.id)}`);
  }
  // ground pivots: hole plus a small base line
  for (const j of doc.joints) {
    if (!j.ground) continue;
    const p = pos(j.id), s = opt.linkWidth;
    d.circle('GROUND', p, opt.pinDiameter / 2);
    d.polyline('GROUND', [{ x: p.x, y: p.y }, { x: p.x - s * 0.6, y: p.y - s }, { x: p.x + s * 0.6, y: p.y - s }], true);
  }
  // sliders: rail and block
  for (const s of doc.sliders) {
    const r = railNow(app, s);
    d.line('SLIDERS', r.a, r.b);
    const p = pos(s.joint);
    const ux = r.b.x - r.a.x, uy = r.b.y - r.a.y, L = Math.hypot(ux, uy) || 1;
    const u = { x: ux / L, y: uy / L }, n = { x: -u.y, y: u.x };
    const hw = opt.linkWidth * 1.3, hh = opt.linkWidth * 0.8;
    d.polyline('SLIDERS', [
      { x: p.x - u.x * hw - n.x * hh, y: p.y - u.y * hw - n.y * hh }, { x: p.x + u.x * hw - n.x * hh, y: p.y + u.y * hw - n.y * hh },
      { x: p.x + u.x * hw + n.x * hh, y: p.y + u.y * hw + n.y * hh }, { x: p.x - u.x * hw + n.x * hh, y: p.y - u.y * hw + n.y * hh },
    ], true);
  }
  // outlines attached to links
  for (const b of app.currentBodies()) d.polyline('OUTLINES', b.pts, b.closed);
  // construction (endless lines are clipped to the drawing area)
  const cons = app.currentConstruction();
  const box = extent(app);
  for (const e of cons) addEntity(d, 'CONSTRUCTION', e, box, identity, 0);
  // traced paths over a full cycle
  const sw = sim.getSweep();
  if (sw) {
    for (const j of doc.joints.filter((x) => x.trace)) {
      d.polyline('PATHS', sw.samples.map((smp) => smp.results.joints.get(j.id).pos), sw.fullTurn || !!sw.closed);
    }
  }
  d.text('NOTES', { x: box.x0, y: box.y0 - 10 }, 3.5, `${doc.meta.title} - exported from ${APP.name} ${APP.version} - units mm`);
  return d.toString();
}

/** Bounding box of joints and drawings (for clipping endless lines). */
function extent(app) {
  const pts = [];
  for (const j of app.doc.joints) pts.push(app.sim.jointPos(j.id));
  for (const e of app.currentConstruction()) for (const k of ['p', 'a', 'b', 'c']) if (e[k]) pts.push(e[k]);
  if (!pts.length) pts.push({ x: 0, y: 0 });
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of pts) { box.x0 = Math.min(box.x0, p.x); box.y0 = Math.min(box.y0, p.y); box.x1 = Math.max(box.x1, p.x); box.y1 = Math.max(box.y1, p.y); }
  const m = Math.max(box.x1 - box.x0, box.y1 - box.y0, 50) * 0.5;
  return { x0: box.x0 - m, y0: box.y0 - m, x1: box.x1 + m, y1: box.y1 + m };
}

/** Add a construction entity (mapped by T, rotated by dphi) to a DXF layer. */
function addEntity(d, layer, e, box, T, dphi) {
  const deg = (r) => (r * 180) / Math.PI;
  switch (e.kind) {
    case 'point': d.point(layer, T(e.p)); break;
    case 'segment': d.line(layer, T(e.a), T(e.b)); break;
    case 'dim': {
      const a = T(e.a), b = T(e.b);
      d.line(layer, a, b);
      d.text(layer, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 2 }, 2.5, `${Math.hypot(b.x - a.x, b.y - a.y).toFixed(2)} mm`);
      break;
    }
    case 'xline': {
      const a = T(e.a), b = T(e.b);
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      const R = Math.hypot(box.x1 - box.x0, box.y1 - box.y0);
      d.line(layer, { x: a.x - (dx / L) * R, y: a.y - (dy / L) * R }, { x: a.x + (dx / L) * R, y: a.y + (dy / L) * R });
      break;
    }
    case 'circle': d.circle(layer, T(e.c), e.r); break;
    case 'arc': {
      const a0 = deg(e.a0 + dphi), a1 = deg(e.a0 + dphi + e.sweep);
      if (e.sweep >= 0) d.arc(layer, T(e.c), e.r, a0, a1); else d.arc(layer, T(e.c), e.r, a1, a0);
      break;
    }
    default: break;
  }
}

// -----------------------------------------------------------------------------
// 2. Parts for CAD
// -----------------------------------------------------------------------------
export function partsZip(app, opt = CAD_DEFAULTS) {
  const doc = app.doc, nums = app.linkNumbers();
  const files = [];
  const designPos = (id) => { const j = jointById(doc, id); return { x: j.x, y: j.y }; };
  const readme = [];
  const title = doc.meta.title || 'mechanism';
  readme.push(`${title}`, `Exported from ${APP.name} ${APP.version}. All dimensions in millimetres.`,
    `Link width ${opt.linkWidth} mm, pin hole diameter ${opt.pinDiameter} mm.`, '');
  readme.push('HOW TO USE',
    '  SolidWorks: File > Open > (DXF) > "Import to a new part as 2D sketch", units millimetres.',
    '              Then extrude the LINKS layer profile; the PIN_HOLES circles cut the holes.',
    '  Inventor:   New part > Start 2D Sketch > Insert > ACAD (choose the DXF), units mm,',
    '              then Extrude. Or File > Open the DXF to import it into a drawing.',
    '  Paths:      SolidWorks: Insert > Curve > Curve Through XYZ Points > Browse to the .txt.',
    '              Inventor: copy the columns into Excel and use Insert > Points from Excel (Manage tab).',
    '  Assembly:   mate each pin hole to the matching hole on the next link (concentric),',
    '              and the frame holes to the ground pivots. Joint positions are listed below.', '');

  // ---- one file per link, in the link's own frame ----
  for (const link of doc.links) {
    const n = nums.get(link.id);
    const P = link.joints.map(designPos);
    const O = P[0];
    const ang = P.length >= 2 ? Math.atan2(P[1].y - O.y, P[1].x - O.x) : 0;
    const c = Math.cos(-ang), s = Math.sin(-ang);
    const T = (p) => ({ x: c * (p.x - O.x) - s * (p.y - O.y), y: s * (p.x - O.x) + c * (p.y - O.y) });
    const d = new Dxf();
    for (const [nm, col] of [['LINKS', ACI.white], ['PIN_HOLES', ACI.red], ['CENTRE_LINES', ACI.cyan], ['PROFILE', ACI.green], ['NOTES', ACI.blue]]) d.layer(nm, col);
    addLink(d, doc, link, designPos, T, opt);
    // drawings attached to this link (for example a cam profile) and outlines
    for (const e of doc.construction.filter((x) => x.attach === link.id)) addEntity(d, 'PROFILE', e, { x0: -500, y0: -500, x1: 500, y1: 500 }, T, -ang);
    for (const b of doc.bodies.filter((x) => x.attach === link.id)) d.polyline('PROFILE', b.pts.map(T), b.closed);
    d.text('NOTES', { x: 0, y: -opt.linkWidth * 1.4 }, 3, `Link ${n} - ${title}`);
    const kind = link.disc ? 'Wheel' : 'Link';
    files.push({ name: `${kind}${n}.dxf`, data: d.toString() });

    readme.push(`${kind} ${n}  (file ${kind}${n}.dxf)`);
    if (link.disc) readme.push(`  wheel radius ${link.disc.toFixed(3)} mm`);
    link.joints.forEach((id, k) => {
      const lp = T(P[k]);
      const j = jointById(doc, id);
      readme.push(`  joint ${k + 1}: local (${lp.x.toFixed(3)}, ${lp.y.toFixed(3)})  world (${P[k].x.toFixed(3)}, ${P[k].y.toFixed(3)})${j.ground ? '  ground pivot' : ''}${isPin(doc, j) ? '' : '  coupler point'}`);
    });
    for (let i = 0; i < P.length; i++) for (let k = i + 1; k < P.length; k++) {
      readme.push(`  length joint ${i + 1}-${k + 1}: ${Math.hypot(P[k].x - P[i].x, P[k].y - P[i].y).toFixed(3)} mm`);
    }
    readme.push('');
  }

  // ---- the frame (ground): pivot holes, rails, fixed tracks ----
  const g = new Dxf();
  for (const [nm, col] of [['PIN_HOLES', ACI.red], ['SLIDERS', ACI.yellow], ['PROFILE', ACI.green], ['NOTES', ACI.blue]]) g.layer(nm, col);
  const grounds = doc.joints.filter((j) => j.ground);
  const origin = grounds.length ? { x: grounds[0].x, y: grounds[0].y } : { x: 0, y: 0 };
  const TG = (p) => ({ x: p.x - origin.x, y: p.y - origin.y });
  readme.push('Frame (ground)  (file Frame.dxf, origin at the first ground pivot)');
  for (const j of grounds) {
    g.circle('PIN_HOLES', TG(j), opt.pinDiameter / 2);
    readme.push(`  ground pivot at (${TG(j).x.toFixed(3)}, ${TG(j).y.toFixed(3)})`);
  }
  for (const s of doc.sliders.filter((x) => !x.on)) g.line('SLIDERS', TG(s.a), TG(s.b));
  for (const p of doc.pairs.filter((x) => x.type === 'prismatic' && !x.guide)) g.line('SLIDERS', TG(p.a), TG(p.b));
  for (const e of doc.construction.filter((x) => !x.attach && doc.pairs.some((p) => [p.a, p.b].some((r) => r && r.kind === 'entity' && r.id === x.id)))) {
    addEntity(g, 'PROFILE', e, { x0: -1000, y0: -1000, x1: 1000, y1: 1000 }, TG, 0);
  }
  g.text('NOTES', { x: 0, y: -15 }, 3, `Frame - ${title}`);
  files.push({ name: 'Frame.dxf', data: g.toString() });
  readme.push('');

  // ---- paths as point files ----
  const sw = app.sim.getSweep();
  const traced = doc.joints.filter((j) => j.trace);
  if (sw && traced.length) {
    readme.push('Paths (X Y Z in mm, same axes as the layout; Z = 0)');
    traced.forEach((j, i) => {
      const lines = sw.samples.map((smp) => { const p = smp.results.joints.get(j.id).pos; return `${p.x.toFixed(4)} ${p.y.toFixed(4)} 0`; });
      files.push({ name: `Path_P${i + 1}.txt`, data: lines.join('\r\n') + '\r\n' });
      readme.push(`  Path_P${i + 1}.txt: ${lines.length} points${sw.fullTurn ? ' (closed loop: first and last points repeat)' : ''}`);
    });
    readme.push('');
  }

  files.push({ name: 'Layout.dxf', data: layoutDXF(app, opt) });
  readme.push('Layout.dxf: the whole mechanism at the position shown on screen when exported.');
  files.unshift({ name: 'README.txt', data: readme.join('\r\n') + '\r\n' });
  return { name: `${fileName(title)}-CAD.zip`, bytes: makeZip(files) };
}

export { fileName };
