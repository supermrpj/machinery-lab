// =============================================================================
// Exports: STL watertight with the right volume (every mounting), DXF spline
// through the profile with unique handles and the mounting on its layers,
// STEP solid with every face and reference in place, point list in the
// drawing's unit, mounting sizes and fit checks.
// (Checked outside the tests as well: the DXF with ezdxf (no audit errors,
// spline through every profile point to 1e-8 mm); the STEP files with
// OpenCASCADE (one valid solid for every mounting, volume within 2e-5 of the
// STL less the set-screw hole).)
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../src/model/document.js';
import { camSolid, stl, dxf, points, profile } from '../src/export/cam.js';
import { periodicCubicControlPoints } from '../src/export/dxf2000.js';
import { step, clampedProfileSpline, splinePoint } from '../src/export/step.js';
import { mounting, loopPoints, keyFor } from '../src/model/mounting.js';

const polyArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a / 2); };

/** Closed and consistently wound (every edge once each way); returns the enclosed volume. */
function closedVolume(tris) {
  const key = (a, b) => `${a.join(',')}|${b.join(',')}`;
  const edges = new Map();
  for (const t of tris) for (let k = 0; k < 3; k++) { const a = t.v[k], b = t.v[(k + 1) % 3]; edges.set(key(a, b), (edges.get(key(a, b)) || 0) + 1); }
  for (const [k, c] of edges) {
    assert.equal(c, 1, `edge used ${c} times: ${k}`);
    const [a, b] = k.split('|');
    assert.ok(edges.has(`${b}|${a}`), 'every edge has its partner the other way');
  }
  // signed volume (divergence theorem): positive means the normals point outward
  let V = 0;
  for (const t of tris) { const [a, b, c] = t.v; V += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; }
  return V;
}

for (const type of ['roller', 'flat']) {
  test(`STL of a ${type}-follower cam is closed, faces outward, right volume`, () => {
    const doc = createDocument();
    doc.follower.type = type;
    doc.part = { ...doc.part, thickness: 8, bore: 14 };
    const V = closedVolume(camSolid(doc, 360));
    const outer = profile(doc, 360).surface;
    const bore = loopPoints(mounting(doc.part, 50).loop, 60);       // the same polygon as the STL (60 points at n = 360)
    const want = (polyArea(outer) - polyArea(bore)) * 8;
    assert.ok(V > 0 && Math.abs(V - want) < 1e-6 * want, `volume ${V} vs ${want}`);
    // binary layout
    const bin = stl(doc);
    assert.equal(bin.length, 84 + 50 * new DataView(bin.buffer).getUint32(80, true));
  });
}

test('STL with each mounting: closed, faces outward, the volume the mounting takes away', () => {
  const vol = {};
  for (const mount of ['plain', 'keyway', 'dflat', 'setscrew', 'flange']) {
    const doc = createDocument();
    doc.part.mount = mount;
    vol[mount] = closedVolume(camSolid(doc, 720));
  }
  const t = 10, c = 0.2, R = (12 + c) / 2;
  // keyway: a 4 + c wide slot up to 6 + 1.8 + c/2 from the centre, above the bore
  const w = (4 + c) / 2, yA = Math.sqrt(R * R - w * w), seg = R * R * Math.asin(w / R) - w * yA; // circle cap above the chord
  const slot = 2 * w * (6 + 1.8 + c / 2 - yA) - seg;
  assert.ok(Math.abs((vol.plain - vol.keyway) / t - slot) < 0.02 * slot, `keyway ${(vol.plain - vol.keyway) / t} vs ${slot}`);
  // D-flat: the cap beyond the flat is material again
  const yf = 10.8 - 6 + c / 2, cap = R * R * Math.acos(yf / R) - yf * Math.sqrt(R * R - yf * yf);
  assert.ok(Math.abs((vol.dflat - vol.plain) / t - cap) < 0.02 * cap, `flat ${(vol.dflat - vol.plain) / t} vs ${cap}`);
  // hub: Ø ceil(2R + 3 × 4.0) = 25, 10 high, less the Ø 4 radial hole through its wall
  const hub = Math.PI * (12.5 ** 2 - R * R) * 10, hole = Math.PI * 4 * (Math.sqrt(12.5 ** 2 - 4) - Math.sqrt(R * R - 4));
  assert.ok(Math.abs(vol.setscrew - vol.plain - (hub - hole)) < 0.01 * hub, `hub ${vol.setscrew - vol.plain} vs ${hub - hole}`);
  // flange: four Ø 3.4 holes
  const bolts = 4 * Math.PI * 1.7 ** 2 * t;
  assert.ok(Math.abs(vol.plain - vol.flange - bolts) < 0.02 * bolts, `bolts ${vol.plain - vol.flange} vs ${bolts}`);
});

test('mounting: DIN 6885 keys, sizes worked out from the shaft, fit checks', () => {
  assert.deepEqual([6, 8, 10, 12, 17, 22, 30, 38].map((d) => keyFor(d).b), [2, 2, 3, 4, 5, 6, 8, 10]);
  assert.equal(keyFor(12.7).t2, 2.3);
  assert.equal(keyFor(5), null);
  const part = { ...createDocument().part };
  // a plain 12 mm bore in a cam of smallest radius 50: fits
  assert.equal(mounting(part, 50).checks[0].level, 'ok');
  // no key for a 5 mm shaft unless one is typed
  assert.ok(mounting({ ...part, bore: 5, mount: 'keyway' }, 50).blocked);
  assert.ok(!mounting({ ...part, bore: 5, mount: 'keyway', keyB: 2, keyT2: 1 }, 50).blocked);
  // a bore that cuts through the cam
  assert.ok(mounting({ ...part, bore: 60 }, 25).blocked);
  // D-flat: 5 mm motor shaft → 4.5 across the flat
  assert.equal(mounting({ ...part, bore: 5, mount: 'dflat' }, 50).flat.f, 4.5);
  // bolt circle halfway between the bore and the cam edge; holes too close to the edge are refused
  const f = mounting({ ...part, mount: 'flange' }, 50);
  assert.equal(f.bolts.pcd, 56);
  assert.ok(mounting({ ...part, mount: 'flange', boltPcd: 99 }, 50).blocked);
  // the hub and its screw: M3 heat-set insert Ø 4.0 at mid-height of the hub
  const s = mounting({ ...part, mount: 'setscrew' }, 50);
  assert.equal(s.screw.d, 4.0);
  assert.equal(s.screw.z, 10 + 5);
  assert.ok(!s.blocked);
});

test('STEP: one closed shell, every reference defined, the faces each mounting needs', () => {
  const faces = {};
  for (const mount of ['plain', 'keyway', 'dflat', 'setscrew', 'flange']) {
    const doc = createDocument();
    doc.part.mount = mount;
    const text = step(doc, `cam ${mount}`);
    assert.ok(text.startsWith('ISO-10303-21;') && text.includes("FILE_SCHEMA(('AUTOMOTIVE_DESIGN"));
    const ids = new Set([...text.matchAll(/^#(\d+)=/gm)].map((x) => x[1]));
    for (const ref of text.matchAll(/#(\d+)(?!\d|=)/g)) assert.ok(ids.has(ref[1]), `#${ref[1]} is used but not defined`);
    assert.equal((text.match(/MANIFOLD_SOLID_BREP/g) || []).length, 1);
    faces[mount] = (text.match(/ADVANCED_FACE/g) || []).length;
  }
  // cam side, bottom, top + bore 1 | keyway 4 | flat 2 | bore, hub side, hub top | bore, 4 holes
  assert.deepEqual(faces, { plain: 4, keyway: 7, dflat: 5, setscrew: 6, flange: 8 });
});

test('STEP: the clamped spline is the DXF spline (through every profile point)', () => {
  const Q = profile(createDocument()).surface;
  const sp = clampedProfileSpline(Q);
  assert.equal(sp.ctrl.length, Q.length + 3);
  let worst = 0;
  for (let i = 0; i <= Q.length; i++) {
    const p = splinePoint(sp, Math.min(i, Q.length - 1e-12)), q = Q[(i + 1) % Q.length];
    worst = Math.max(worst, Math.hypot(p.x - q.x, p.y - q.y));
  }
  assert.ok(worst < 1e-9, `misses a point by ${worst}`);
});

test('DXF: the mounting on its layers', () => {
  const layers = (mount) => {
    const doc = createDocument();
    doc.part.mount = mount;
    const L = dxf(doc).split('\r\n');
    const out = {};
    for (let i = 0; i < L.length - 1; i++) {
      if (L[i] === '0' && ['LINE', 'ARC', 'CIRCLE', 'SPLINE'].includes(L[i + 1])) {
        const layer = L[L.indexOf('8', i) + 1];
        out[`${L[i + 1]} ${layer}`] = (out[`${L[i + 1]} ${layer}`] || 0) + 1;
      }
    }
    return out;
  };
  assert.equal(layers('keyway')['LINE BORE'], 3);
  assert.equal(layers('keyway')['ARC BORE'], 1);
  assert.equal(layers('dflat')['LINE BORE'], 1);
  assert.equal(layers('flange')['CIRCLE HOLES'], 4);
  assert.equal(layers('setscrew')['CIRCLE HUB'], 1);
  assert.equal(layers('setscrew')['LINE SETSCREW'], 3);
});

test('DXF: R2000, unique handles, one closed spline through the profile', () => {
  const doc = createDocument();
  const text = dxf(doc);
  const L = text.split('\r\n');
  assert.equal(L[L.indexOf('$ACADVER') + 2], 'AC1015');
  // handles (group 5 and 105) are unique
  const handles = [];
  for (let i = 0; i < L.length - 1; i += 2) if (L[i] === '5' || L[i] === '105') handles.push(L[i + 1]);
  assert.equal(new Set(handles).size, handles.length, 'handles unique');
  assert.equal(L.filter((x) => x === 'SPLINE').length, 2, 'cam and pitch curve');
  // the spline passes through every profile point: uniform cubic B-spline at the knots
  const Q = profile(doc).surface;
  const P = periodicCubicControlPoints(Q);
  const n = Q.length;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
    worst = Math.max(worst, Math.hypot((a.x + 4 * b.x + c.x) / 6 - Q[i].x, (a.y + 4 * b.y + c.y) / 6 - Q[i].y));
  }
  assert.ok(worst < 1e-9, `spline misses a point by ${worst}`);
});

test('points: in the drawing unit, one line per point', () => {
  const doc = createDocument();
  const mm = points(doc, 'txt').trim().split('\r\n');
  doc.units = 'us';
  const inch = points(doc, 'txt').trim().split('\r\n');
  assert.equal(mm.length, inch.length);
  const x0 = +mm[0].split('\t')[0], x1 = +inch[0].split('\t')[0];
  assert.ok(Math.abs(x0 / 25.4 - x1) < 1e-5);
  assert.ok(points(doc, 'csv').startsWith('x (in),y (in),z (in)'));
});
