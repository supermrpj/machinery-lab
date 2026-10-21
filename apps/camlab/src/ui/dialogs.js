// =============================================================================
// dialogs.js — Export (STL, STEP, DXF, points, data), Help and About
// =============================================================================

import { h } from '../../../../packages/ui-kit/src/dom.js';
import { aboutContent } from '../../../../packages/ui-kit/src/about.js';
import { downloadFile } from '../../../../packages/ui-kit/src/files.js';
import { dxf, points, stl } from '../export/cam.js';
import { step } from '../export/step.js';
import { APP, MOUNTING } from '../config.js';

/* global __BUILD_INFO__ */
function buildInfo() {
  try { return __BUILD_INFO__; } catch { return { version: APP.version, date: 'development' }; }
}

function dialog(title, ...body) {
  const d = h('dialog', {},
    h('div', { class: 'dlg-head' }, h('h2', {}, title), h('button', { class: 'btn', onclick: () => d.close() }, 'Close')),
    h('div', { class: 'dlg-body' }, body));
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

const baseName = (app) => (app.doc.meta.title || 'cam').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'cam';

export function openExportDialog(app) {
  const U = app.units, p = app.doc.part, name = baseName(app);
  const L = (v) => `${+U.L.show(v).toPrecision(4)} ${U.L.label}`;
  const row = (title, text, button) => h('div', { class: 'export-row' }, h('div', {}, h('div', { class: 'export-title' }, title), h('div', { class: 'note' }, text)), button);
  const r = app.result(), m = r.mount;
  // no file from a design that cannot be made; no part if the mounting does not fit
  const blocked = !r.valid || r.problems.some((x) => x.kind === 'size');
  const noPart = blocked || m.blocked;
  const dl = (label, fn, off = blocked) => h('button', { class: 'btn primary', onclick: fn, disabled: off || null }, label);
  const bad = !r.law.sOk || r.shape.undercut || r.problems.length;
  const kindName = (MOUNTING.kinds.find((k) => k.id === m.kind) || MOUNTING.kinds[0]).name;
  const detail = m.key ? `, key ${L(m.key.b)} × keyway depth ${L(m.key.t2)}` : m.flat ? `, ${L(m.flat.f)} across the flat`
    : m.hub ? `, hub Ø ${L(2 * m.hub.r)} × ${L(m.hub.h)}, ${m.screw.size} ${m.screw.hole === 'tap' ? 'tapped' : 'insert'} hole`
    : m.bolts ? `, ${m.bolts.n} × ${m.bolts.size} on a ${L(m.bolts.pcd)} bolt circle` : '';
  const safeName = (ext) => `${name}.${ext}`;
  dialog('Export the cam',
    blocked ? h('div', { class: 'warn-note' }, 'This design cannot be exported yet. ', (r.problems.find((x) => x.kind === 'size' || x.kind === 'shape') || { text: 'The cam shape cannot be worked out.' }).text)
      : bad ? h('div', { class: 'warn-note' }, 'Check the design first: ', r.problems.length ? r.problems[0].text : r.shape.undercut ? 'the profile is undercut, so the follower cannot follow it.' : 'the displacement jumps somewhere.') : null,
    h('p', { class: 'export-part' }, h('b', {}, 'The part: '), `${L(p.thickness)} thick, ${kindName.toLowerCase()} for a ${L(p.bore)} shaft${detail}, ${L(m.c)} print clearance. Change it under Part and mounting.`),
    m.checks.filter((c) => c.level !== 'ok').map((c) => h('div', { class: 'warn-note' }, c.text)),
    row('3-D print (STL)',
      `The cam with its mounting, in millimetres, ready for a slicer. Print it lying flat${m.hub ? ', hub up' : ''}.`,
      dl('Download .stl', () => downloadFile(safeName('stl'), new Blob([stl(app.doc, name)], { type: 'model/stl' })), noPart)),
    row('Solid for CAD (STEP)',
      'An exact solid that SolidWorks, Inventor, Fusion 360 and FreeCAD open as a part: change the mounting there, add holes or fillets. The set-screw hole is left out (it is marked in the DXF).',
      dl('Download .step', () => downloadFile(safeName('step'), step(app.doc, name), 'model/step'), noPart)),
    row('Sketch for CAD (DXF)',
      'The profile as one smooth spline (layer CAM) with the pitch curve and the mounting outlines on their own layers (BORE, HOLES, HUB, SETSCREW). Millimetres. Open it as a sketch and extrude it.',
      dl('Download .dxf', () => downloadFile(safeName('dxf'), dxf(app.doc), 'application/dxf'))),
    row('Profile points (text)',
      `x y z of 720 points round the cam (every 0.5°), in ${U.L.label}. In SolidWorks: Insert › Curve › Curve Through XYZ Points, tick Closed curve.`,
      h('div', { class: 'row-buttons', style: { marginTop: 0 } },
        dl('.txt', () => downloadFile(`${name} points (${U.L.label}).txt`, points(app.doc, 'txt'), 'text/plain')),
        dl('.csv', () => downloadFile(`${name} points (${U.L.label}).csv`, points(app.doc, 'csv'), 'text/csv')))),
    row('Design data (CSV)',
      'θ, s, v, a, j, pressure angle, radius of curvature, cam force and torque at every 0.25°, for a report or a spreadsheet. (The Copy numbers and CSV buttons above the plots give just the plots shown.)',
      dl('Download .csv', () => downloadFile(`${name} data.csv`, dataCsv(app), 'text/csv'))),
    h('p', { class: 'note' }, `The ${m.kind === 'keyway' ? 'keyway' : m.kind === 'dflat' ? 'flat' : m.kind === 'setscrew' ? 'set screw' : m.kind === 'flange' ? 'first bolt hole' : 'top of the drawing (+y)'} is where the follower is when θ = 0.`),
  );
}

/** Everything over the turn, in the drawing's units. */
function dataCsv(app) {
  const r = app.result(), U = app.units;
  const head = ['theta (deg)', `s (${U.L.label})`, `v (${U.V.label})`, `a (${U.A.label})`, `j (${U.J.label})`, 'pressure angle (deg)',
    `rho cam (${U.L.label})`, `cam force (${U.F.label})`, `torque (${U.T.label})`, 'segment'];
  const rows = r.time.map((t, i) => {
    const s = r.shape.rows[i], f = r.forces.rows[i];
    return [t.deg, U.L.show(t.s), U.V.show(t.v), U.A.show(t.a), U.J.show(t.j), (s.phi * 180) / Math.PI, U.L.show(s.rhoCam), U.F.show(f.F), U.T.show(f.T), t.segment + 1]
      .map((v) => (Number.isFinite(v) ? +(+v).toPrecision(8) : '')).join(',');
  });
  return `${head.join(',')}\n${rows.join('\n')}\n`;
}

export function openHelp() {
  dialog('How to use CamLab',
    h('h3', {}, 'The idea'),
    h('p', {}, 'Design a disk cam by the analytical method: choose the follower motion (SVAJ), size the cam (pressure angle, radius of curvature), check the spring (forces), then export the part with its mounting for 3-D printing or CAD. Inputs are on the left, the cam and its plots in the middle, checks on the right.'),
    h('h3', {}, 'Motion program'),
    h('p', {}, 'Build the motion from segments: rise, dwell, fall, or one polynomial through conditions you choose (for single-dwell cams). Each segment has a duration β in degrees, a lift h, and a law. The total must be 360° and the follower must end where it started.'),
    h('h3', {}, 'The cam and the plots'),
    h('p', {}, 'The cam turns on the left; the plots on the right follow it with one cursor. Pick the plots in the bar above: ',
      h('b', {}, 'Motion'), ' (s, v, a, j; ∞ marks where the fundamental law is broken), ',
      h('b', {}, 'Size'), ' (pressure angle, radius of curvature), ',
      h('b', {}, 'Forces'), ' (cam force, camshaft torque) and ',
      h('b', {}, 'Motion and force'), ' (s, a and Fc together, to see where the follower would jump). Size and the force plots are in Advanced. ',
      'Each plot’s title bar gives its value at the cursor and its largest and smallest values. ',
      h('b', {}, 'Copy numbers'), ' puts the plotted numbers on the clipboard for a spreadsheet; ', h('b', {}, 'CSV'), ' saves them. Show the cam, the plots, or both; drag the line between them to share the width.'),
    h('p', {}, 'Click or drag on any plot to turn the cam to that angle. Drag the drawing to pan, use the wheel to zoom, double-click to fit. Click a segment in the program to mark it on the plots and the cam.'),
    h('h3', {}, 'Graphical method (tutorial)'),
    h('p', {}, 'The Graphical method button opens the hand construction for the current design, step by step: displacement diagram, stations round the base circle, transferred displacements, rollers, profile. Change the number of divisions to see the hand construction approach the exact cam. Close it (or press Esc) to go back.'),
    h('h3', {}, 'Part and mounting'),
    h('p', {}, 'Set the thickness, the shaft Ø and the print clearance, and how the cam fixes to its shaft: a plain bore, a bore with a keyway (DIN 6885 size from the shaft Ø), a D-flat bore for a motor shaft, a hub with a set screw, or a ring of bolt holes for a flange coupling. Empty boxes take sensible sizes; CamLab checks that everything fits inside the cam. The keyway, flat or set screw faces the follower when θ = 0, so the cam is timed on its shaft.'),
    h('h3', {}, 'Export'),
    h('p', {}, h('b', {}, 'STL'), ' to 3-D print the part. ', h('b', {}, 'STEP'), ' for an editable solid in SolidWorks, Inventor, Fusion 360 or FreeCAD. ',
      h('b', {}, 'DXF'), ' for a sketch: the profile as one spline with the mounting on its own layers. Also the profile points and all the design data as CSV.'),
    h('h3', {}, 'Basic and Advanced'),
    h('p', {}, 'The switch in the top bar. ', h('b', {}, 'Basic'), ' (the start) has the cam and the motion plots, with every design input. ',
      h('b', {}, 'Advanced'), ' adds sizing (pressure angle, radius of curvature), the spring and forces, and the force at the cursor in the bar at the bottom. CamLab remembers your choice on this computer.'),
    h('h3', {}, 'Plots'),
    h('p', {}, 'Use the mouse wheel on a plot to zoom along θ (Shift + wheel moves along); double-click puts the axes back to automatic. ',
      'The axes button beside ⤢ sets where each axis starts and ends. The ⤢ button at a plot’s corner opens it large; Esc closes it. Drag the line between two plots to give one more height (double-click the line to share it evenly).'),
    h('h3', {}, 'Examples'),
    h('p', {}, 'The Examples menu opens worked examples, in inches: one double-dwell cam with each motion law so the laws can be compared, three single-dwell cams, and a four-dwell cam with a spring and preload.'),
    h('h3', {}, 'Keys'),
    h('p', {}, h('kbd', {}, 'Space'), ' play or pause · ', h('kbd', {}, 'Ctrl'), '+', h('kbd', {}, 'Z'), ' undo · ', h('kbd', {}, 'Ctrl'), '+', h('kbd', {}, 'Y'), ' redo · ', h('kbd', {}, 'Ctrl'), '+', h('kbd', {}, 'S'), ' save · ', h('kbd', {}, 'Ctrl'), '+', h('kbd', {}, 'O'), ' open'),
    h('div', { class: 'row-buttons' }, h('button', { class: 'btn', onclick: (e) => { e.target.closest('dialog').close(); openAbout(); } }, `About ${APP.name} ${APP.version} and licence`)),
  );
}

export function openAbout() {
  dialog(`About ${APP.name}`, aboutContent({ name: APP.name, info: buildInfo(),
    summary: 'cam design for teaching Mechanics of Machinery.' }));
}
