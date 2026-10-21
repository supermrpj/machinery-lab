// =============================================================================
// export/step.js — the cam as a solid for CAD (STEP AP214, millimetres)
// -----------------------------------------------------------------------------
// One manifold solid made of exact faces, so SolidWorks, Inventor, Fusion 360
// or FreeCAD open it as a part that can be edited (holes added, edges
// filleted, the mounting changed):
//   cam side      the profile spline (the same curve as the DXF) swept up
//                 the thickness: SURFACE_OF_LINEAR_EXTRUSION
//   bore          cylinder; with a keyway: cylinder and three planes; with a
//                 flat: cylinder and one plane
//   bolt holes    cylinders
//   hub           cylinder and its top face, standing on the cam
//   faces         planes at the bottom, the top and the top of the hub
// The set-screw hole is left out: add it in CAD (it is marked in the DXF).
//
// How the faces are built: every boundary loop runs with the material on its
// left seen from +z (outer loops counter-clockwise, holes clockwise). A wall
// face above a loop segment is then bounded by: the segment at the bottom,
// up the line at its end, back along the segment at the top, down the line
// at its start. That runs counter-clockwise seen from outside, as STEP wants.
// =============================================================================

import { profile } from './cam.js';
import { periodicCubicControlPoints } from './dxf2000.js';
import { mounting } from '../model/mounting.js';
import { APP } from '../config.js';

// ---- numbers and text in STEP --------------------------------------------------------

const R = (v) => {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-13) return '0.';
  const s = (+v.toPrecision(15)).toString();
  if (/e/i.test(s)) { const [m, e] = s.split(/e/i); return `${m.includes('.') ? m : `${m}.`}E${e}`; }
  return s.includes('.') ? s : `${s}.`;
};
/** A STEP string: quotes doubled, characters beyond ASCII as \X2\hhhh\X0\. */
const S = (text) => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/[^\x20-\x7e]+/g, (m) => `\\X2\\${[...m].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('')}\\X0\\`)}'`;
const B = (b) => (b ? '.T.' : '.F.');

// ---- the closed profile as a clamped cubic B-spline --------------------------------------

/** Insert knot u once into a B-spline of degree p (knots U, control points P): NURBS Book A5.1. */
function insertKnot(p, U, P, u) {
  let k = U.length - 1;
  while (k > 0 && U[k] > u) k--;
  const s = U.filter((x) => x === u).length;
  const Q = [];
  for (let i = 0; i <= P.length; i++) {
    if (i <= k - p) Q.push(P[i]);
    else if (i >= k - s + 1) Q.push(P[i - 1]);
    else {
      const a = (u - U[i]) / (U[i + p] - U[i]);
      Q.push({ x: a * P[i].x + (1 - a) * P[i - 1].x, y: a * P[i].y + (1 - a) * P[i - 1].y });
    }
  }
  return { U: [...U.slice(0, k + 1), u, ...U.slice(k + 1)], P: Q };
}

/**
 * The periodic cubic spline through the points (as in the DXF), written as an
 * ordinary clamped cubic B-spline that starts and ends at its first point.
 * Returns { ctrl, knots: [{ u, m }] }, the curve running from u = 0 to n.
 */
export function clampedProfileSpline(points) {
  const n = points.length;
  const P = periodicCubicControlPoints(points);
  let c = { U: Array.from({ length: n + 7 }, (_, i) => i), P: [...P, P[0], P[1], P[2]] };
  for (const u of [3, 3, n + 3, n + 3]) c = insertKnot(3, c.U, c.P, u);
  const ctrl = c.P.slice(2, c.P.length - 2);
  const knots = [{ u: 0, m: 4 }];
  for (let i = 1; i < n; i++) knots.push({ u: i, m: 1 });
  knots.push({ u: n, m: 4 });
  return { ctrl, knots };
}

/** A point on a clamped B-spline (de Boor), for checks. */
export function splinePoint({ ctrl, knots }, u) {
  const U = knots.flatMap((k) => Array(k.m).fill(k.u));
  const p = 3;
  let k = p;
  while (k < ctrl.length - 1 && U[k + 1] <= u) k++;
  const d = [0, 1, 2, 3].map((j) => ({ ...ctrl[j + k - p] }));
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const a = (u - U[i]) / (U[i + p - r + 1] - U[i]);
      d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y };
    }
  }
  return d[p];
}

// ---- the file ----------------------------------------------------------------------------

export function step(doc, name = 'cam') {
  let outer = profile(doc).surface;
  const sgn = outer.reduce((a, p, i) => { const q = outer[(i + 1) % outer.length]; return a + p.x * q.y - q.x * p.y; }, 0);
  if (sgn < 0) outer = outer.slice().reverse();                       // counter-clockwise
  const rMin = Math.min(...outer.map((p) => Math.hypot(p.x, p.y)));
  const m = mounting(doc.part, rMin);
  const t = doc.part.thickness;
  const top = m.hub ? t + m.hub.h : t;

  const lines = [];
  const add = (text) => { lines.push(text); return `#${lines.length}`; };
  const pt = (x, y, z) => add(`CARTESIAN_POINT('',(${R(x)},${R(y)},${R(z)}))`);
  const dir = (x, y, z) => add(`DIRECTION('',(${R(x)},${R(y)},${R(z)}))`);
  const axis = (o, zd = [0, 0, 1], xd = [1, 0, 0]) => add(`AXIS2_PLACEMENT_3D('',${pt(...o)},${dir(...zd)},${dir(...xd)})`);
  const Z = () => dir(0, 0, 1);

  // ---- loops: segments with the material on the left -------------------------------
  // segment: { type: 'spline' | 'circle' | 'arc' | 'line', p0: its start point, ang0: a circle's start angle, … }
  const spline = clampedProfileSpline(outer);
  const camLoop = [{ type: 'spline', p0: spline.ctrl[0], spline }];
  const startOf = (sg) => (sg.type === 'line' ? sg.a : sg.type === 'circle'
    ? { x: sg.c.x + sg.r * Math.cos(sg.start), y: sg.c.y + sg.r * Math.sin(sg.start) }
    : { x: sg.c.x + sg.r * Math.cos(sg.a0), y: sg.c.y + sg.r * Math.sin(sg.a0) });
  const boreLoop = m.loop.map((sg) => ({ ...sg, p0: startOf(sg), ang0: sg.type === 'circle' ? sg.start : 0 }));
  const circleLoop = (c, r, ccw) => [{ type: 'circle', c, r, ccw, ang0: Math.PI / 2, p0: { x: c.x, y: c.y + r } }];
  const boltLoops = m.bolts ? m.bolts.at.map((c) => circleLoop(c, m.bolts.d / 2, false)) : [];
  const hubLoop = m.hub ? circleLoop({ x: 0, y: 0 }, m.hub.r, true) : null;

  /** The curve of a segment at height z, and whether it runs the same way as the segment. */
  function curve(sg, z) {
    if (sg.type === 'line') {
      const dx = sg.b.x - sg.a.x, dy = sg.b.y - sg.a.y, L = Math.hypot(dx, dy);
      return { id: add(`LINE('',${pt(sg.a.x, sg.a.y, z)},${add(`VECTOR('',${dir(dx / L, dy / L, 0)},${R(L)})`)})`), same: true };
    }
    if (sg.type === 'spline') {
      const c = sg.spline;
      const ps = c.ctrl.map((p) => pt(p.x, p.y, z)).join(',');
      return { id: add(`B_SPLINE_CURVE_WITH_KNOTS('',3,(${ps}),.UNSPECIFIED.,.T.,.F.,(${c.knots.map((k) => k.m).join(',')}),(${c.knots.map((k) => R(k.u)).join(',')}),.UNSPECIFIED.)`), same: true };
    }
    // circle or arc: STEP circles run counter-clockwise about +z
    const a = sg.ang0;
    const id = add(`CIRCLE('',${axis([sg.c.x, sg.c.y, z], [0, 0, 1], [Math.cos(a), Math.sin(a), 0])},${R(sg.r)})`);
    return { id, same: !!sg.ccw };
  }

  /** Edges of a loop at height z: { verts, edges }, one vertex at each segment start. */
  function level(loop, z) {
    const verts = loop.map((sg) => add(`VERTEX_POINT('',${pt(sg.p0.x, sg.p0.y, z)})`));
    const edges = loop.map((sg, k) => {
      const c = curve(sg, z);
      return add(`EDGE_CURVE('',${verts[k]},${verts[(k + 1) % loop.length]},${c.id},${B(c.same)})`);
    });
    return { verts, edges };
  }

  /** Upright edges at each vertex of a loop, from level a to level b. */
  function uprights(loop, a, b, za, zb) {
    return loop.map((sg, k) => add(`EDGE_CURVE('',${a.verts[k]},${b.verts[k]},${add(`LINE('',${pt(sg.p0.x, sg.p0.y, za)},${add(`VECTOR('',${Z()},${R(zb - za)})`)})`)},.T.)`));
  }

  const oe = (e, fwd) => add(`ORIENTED_EDGE('',*,*,${e},${B(fwd)})`);
  const edgeLoop = (oes) => add(`EDGE_LOOP('',(${oes.join(',')}))`);
  const faces = [];
  const face = (bounds, surface, same) => faces.push(add(`ADVANCED_FACE('',(${bounds.join(',')}),${surface},${B(same)})`));

  /** The wall faces above a loop between two levels. */
  function walls(loop, a, b, za, zb) {
    const up = uprights(loop, a, b, za, zb);
    loop.forEach((sg, k) => {
      const k1 = (k + 1) % loop.length;
      const bound = add(`FACE_OUTER_BOUND('',${edgeLoop([oe(a.edges[k], true), oe(up[k1], true), oe(b.edges[k], false), oe(up[k], false)])},.T.)`);
      if (sg.type === 'line') {
        const dx = sg.b.x - sg.a.x, dy = sg.b.y - sg.a.y, L = Math.hypot(dx, dy);
        face([bound], add(`PLANE('',${axis([sg.a.x, sg.a.y, za], [dy / L, -dx / L, 0], [dx / L, dy / L, 0])})`), true);
      } else if (sg.type === 'spline') {
        const c = curve(sg, za);
        face([bound], add(`SURFACE_OF_LINEAR_EXTRUSION('',${c.id},${add(`VECTOR('',${Z()},${R(zb - za)})`)})`), true);
      } else {
        const a0 = sg.ang0;
        face([bound], add(`CYLINDRICAL_SURFACE('',${axis([sg.c.x, sg.c.y, za], [0, 0, 1], [Math.cos(a0), Math.sin(a0), 0])},${R(sg.r)})`), !!sg.ccw);
      }
    });
  }

  /** A flat face at height z; up: its outside faces +z. bounds: [{ level, reverse }], the first is the outer one. */
  function flat(z, up, bounds) {
    const plane = add(`PLANE('',${axis([0, 0, z])})`);
    const fb = bounds.map((b, i) => add(`${i ? 'FACE_BOUND' : 'FACE_OUTER_BOUND'}('',${edgeLoop(b.level.edges.map((e) => oe(e, true)))},${B(up !== !!b.reverse)})`));
    face(fb, plane, up);
  }

  // ---- levels, walls and faces ------------------------------------------------------
  const cam0 = level(camLoop, 0), camT = level(camLoop, t);
  walls(camLoop, cam0, camT, 0, t);
  const bore0 = boreLoop.length ? level(boreLoop, 0) : null;
  const boreTop = boreLoop.length ? level(boreLoop, top) : null;
  if (bore0) walls(boreLoop, bore0, boreTop, 0, top);
  const bolts = boltLoops.map((lp) => { const a = level(lp, 0), b = level(lp, t); walls(lp, a, b, 0, t); return { a, b }; });
  let hubT = null, hubTop = null;
  if (hubLoop) { hubT = level(hubLoop, t); hubTop = level(hubLoop, top); walls(hubLoop, hubT, hubTop, t, top); }

  flat(0, false, [{ level: cam0 }, ...(bore0 ? [{ level: bore0 }] : []), ...bolts.map((b) => ({ level: b.a }))]);
  flat(t, true, [{ level: camT }, ...(hubT ? [{ level: hubT, reverse: true }] : boreTop ? [{ level: boreTop }] : []), ...bolts.map((b) => ({ level: b.b }))]);
  if (hubTop) flat(top, true, [{ level: hubTop }, ...(boreTop ? [{ level: boreTop }] : [])]);

  // ---- product, units, the solid -------------------------------------------------------
  const shell = add(`CLOSED_SHELL('',(${faces.join(',')}))`);
  const solid = add(`MANIFOLD_SOLID_BREP(${S(name)},${shell})`);
  const appCtx = add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${appCtx})`);
  const prodCtx = add(`PRODUCT_CONTEXT('',${appCtx},'mechanical')`);
  const product = add(`PRODUCT(${S(name)},${S(name)},'',(${prodCtx}))`);
  add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${product}))`);
  const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',${product})`);
  const pdCtx = add(`PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`);
  const pd = add(`PRODUCT_DEFINITION('design','',${pdf},${pdCtx})`);
  const pds = add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
  const mmUnit = add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
  const radUnit = add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
  const srUnit = add('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),${mmUnit},'distance_accuracy_value','confusion accuracy')`);
  const ctx = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${mmUnit},${radUnit},${srUnit}))REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`);
  const rep = add(`ADVANCED_BREP_SHAPE_REPRESENTATION(${S(name)},(${solid},${axis([0, 0, 0])}),${ctx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);

  const stamp = new Date().toISOString().slice(0, 19);
  return ['ISO-10303-21;', 'HEADER;',
    `FILE_DESCRIPTION((${S(`${APP.name} cam`)}),'2;1');`,
    `FILE_NAME(${S(`${name}.step`)},'${stamp}',(''),(''),${S(`${APP.name} ${APP.version}`)},${S(APP.name)},'');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", 'ENDSEC;', 'DATA;',
    ...lines.map((l, i) => `#${i + 1}=${l};`),
    'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
}
