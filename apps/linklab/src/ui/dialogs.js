// =============================================================================
// dialogs.js — Help and About (licence, third-party notices)
// =============================================================================

import { h } from '../../../../packages/ui-kit/src/dom.js';
import { aboutContent } from '../../../../packages/ui-kit/src/about.js';
import { APP } from '../config.js';
import { layoutDXF, partsZip, CAD_DEFAULTS, fileName } from '../export/cad.js';
import { exportCSV } from './plots.js';
import { downloadFile } from '../../../../packages/ui-kit/src/files.js';
import { parseNum } from '../../../../packages/ui-kit/src/format.js';
import { GUIDES } from './guides.js';
import { mechanismParameters, parametersCSV, parametersJSON } from '../export/parameters.js';

/* global __BUILD_INFO__ */
function buildInfo() {
  try { return __BUILD_INFO__; } catch { return { version: APP.version, date: 'development' }; }
}

function dialog(title, ...content) {
  const d = h('dialog', { 'aria-label': title },
    h('div', { class: 'dlg-head' }, h('h2', {}, title), h('button', { class: 'btn', onclick: () => d.close() }, 'Close')),
    h('div', { class: 'dlg-body' }, content));
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

/** "3 links, 2 sliders" — counts that are not zero, in words. */
function counts(parts) {
  const words = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  return words.length ? words.join(', ') : 'nothing';
}

export const dialogs = {
  clearDialog(app) {
    const doc = app.doc;
    const mech = [[doc.joints.length, 'joint', 'joints'], [doc.links.length, 'link', 'links'], [doc.sliders.length, 'slider', 'sliders'],
      [doc.pairs.length, 'other joint', 'other joints'], [(doc.actuators || []).length, 'actuator', 'actuators'], [doc.bodies.length, 'outline', 'outlines']];
    const nMech = mech.reduce((s, [n]) => s + n, 0);
    const nCons = doc.construction.length;
    let d = null;
    const row = (title, text, what, empty) => h('div', { class: 'export-row' },
      h('div', {}, h('div', { class: 'export-title' }, title), h('div', { class: 'note' }, text)),
      h('button', { class: 'btn', disabled: empty, onclick: () => { d.close(); app.clear(what); } }, empty ? 'Nothing to clear' : 'Clear'));
    d = dialog('Clear the sheet',
      h('p', {}, 'Clearing is one step: press ', h('kbd', {}, 'Ctrl+Z'), ' to bring it back. The drawing name and settings stay. ',
        'Save first if you want to keep this version as a file.'),
      row('Everything', 'The whole sheet: mechanism, construction and background picture.', 'all', !nMech && !nCons && !doc.background),
      row('Mechanism only', nMech ? `Pivots, links, wheels, sliders, other joints, actuators and outlines (${counts(mech)}). Construction lines stay.` : 'There is no mechanism.', 'mechanism', !nMech),
      row('Construction only', nCons ? `Points, lines, arcs, circles and dimensions (${counts([[nCons, 'item', 'items']])}). The mechanism stays.` : 'There are no construction lines.', 'construction', !nCons),
      row('Background picture', doc.background ? 'Remove the pasted sketch or photo.' : 'There is no background picture.', 'background', !doc.background),
    );
  },

  exportDialog(app) {
    const cad = { ...CAD_DEFAULTS, ...(app.doc.cad || {}) };
    const field = (label, key) => h('div', { class: 'field' }, h('label', {}, label),
      h('div', { class: 'pair', style: { gridTemplateColumns: '1fr auto' } },
        h('input', { type: 'number', step: 'any', min: 0.1, value: cad[key], 'aria-label': label,
          onchange: (e) => { const v = parseNum(e.target.value); if (v > 0) { cad[key] = v; app.doc.cad = { ...cad }; } } }),
        h('span', { class: 'unit' }, 'mm')));
    const row = (title, text, label, action) => h('div', { class: 'export-row' },
      h('div', {}, h('div', { class: 'export-title' }, title), h('div', { class: 'note' }, text)),
      h('button', { class: 'btn primary', onclick: action }, label));
    const name = fileName(app.doc.meta.title);
    let d = null;
    const done = (msg) => { app.flash(msg); d.close(); };
    d = dialog('Export',
      h('h3', {}, 'For SolidWorks, Inventor and other CAD'),
      h('p', { class: 'note' }, 'DXF files open in SolidWorks, Autodesk Inventor, Fusion 360, AutoCAD and laser-cutting software. Units are millimetres.'),
      field('Link width', 'linkWidth'),
      field('Pin hole diameter', 'pinDiameter'),
      row('Parts for CAD (.zip)', 'One sketch per link in its own frame, ready to extrude; the frame with ground pivots; traced paths as X Y Z point files; and a README with lengths and joint positions.',
        'Export parts', () => { const z = partsZip(app, cad); downloadFile(z.name, new Blob([z.bytes], { type: 'application/zip' })); done(`Saved ${z.name} to your Downloads folder.`); }),
      row('Layout drawing (.dxf)', 'The whole mechanism as shown now, with each kind of geometry on its own layer.',
        'Export layout', () => { downloadFile(`${name}-layout.dxf`, layoutDXF(app, cad), 'application/dxf'); done(`Saved ${name}-layout.dxf to your Downloads folder.`); }),
      h('h3', {}, 'For further analysis (acceleration, dynamics)'),
      h('p', { class: 'note' }, 'Joints are named J1, J2, … as on the drawing (turn on ', h('b', {}, 'Names'), ' in the top bar to see them). ',
        'Link parameters are taken at the position shown now: set the input first.'),
      row('Link parameters (.csv)', 'Joint coordinates; each link’s length, angle, ω and α; each link’s joints in its own frame; how the links are joined; and the input. One file with labelled tables, for Excel.',
        'Export CSV', () => { const P = mechanismParameters(app); downloadFile(`${name}-parameters.csv`, parametersCSV(P), 'text/csv'); done(`Saved ${name}-parameters.csv to your Downloads folder.`); }),
      row('Link parameters (.json)', 'The same data for MATLAB (jsondecode), Python (json.load) or your own programs.',
        'Export JSON', () => { const P = mechanismParameters(app); downloadFile(`${name}-parameters.json`, parametersJSON(P), 'application/json'); done(`Saved ${name}-parameters.json to your Downloads folder.`); }),
      row('Motion data (.csv)', 'Every joint and link over the whole cycle: position, velocity and acceleration at each step of the input, for Excel.', 'Export data', () => { exportCSV(app); d.close(); }),
      h('h3', {}, 'Other'),
      row('Picture (.png)', 'The drawing sheet as you see it now.', 'Save picture', () => { app.exportPNG(); d.close(); }),
    );
  },

  help(app) {
    const key = (k, what) => [h('span', {}, h('kbd', {}, k)), h('span', {}, what)];
    let d = null;
    const guides = app && app.ui.guides;
    const guideSection = guides ? [
      h('h3', {}, 'Tool guides'),
      h('p', {}, 'Each tool shows a short animated guide the first time you use it. Open any of them here, or with the ', h('b', {}, 'Guide'), ' button next to the hint.'),
      h('div', { class: 'guide-list' }, app.tools.filter((t) => GUIDES[t.id]).map((t) =>
        h('button', { class: 'btn', onclick: () => { d.close(); app.setTool(t.id); guides.open(t.id); } }, t.label)),
        h('button', { class: 'btn', onclick: () => { d.close(); guides.open('masses'); } }, 'Masses and centres of mass')),
      h('div', { class: 'guide-opts' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !guides.off, onchange: (e) => guides.setOff(!e.target.checked) }), ' Show a guide for each new tool'),
        h('button', { class: 'btn', onclick: () => { guides.reset(); app.flash('Guides will show again for every tool.'); d.close(); } }, 'Show all guides again')),
    ] : [];
    d = dialog('How to use LinkLab',
      h('h3', {}, 'Basic and Advanced'),
      h('p', {}, 'The switch in the top bar. ', h('b', {}, 'Basic'), ' (the start) has every drawing tool, kinematics and the plots. ',
        h('b', {}, 'Advanced'), ' adds the Forces and Balancing tabs, force plots and link masses. A drawing keeps its force settings in either mode. LinkLab remembers your choice on this computer.'),
      h('h3', {}, 'Plots'),
      h('p', {}, 'Use the mouse wheel on a plot to zoom along the input axis (Shift + wheel moves along); double-click puts the axes back to automatic. ',
        'The axes button beside ⤢ sets where each axis starts and ends. ',
        'The ⤢ button at a plot’s corner opens it large; Esc closes it. Drag the top edge of the plot drawer to make it taller. ',
        'Text size: Sheet › Display.'),
      h('h3', {}, 'The side panel'),
      h('p', {}, 'The panel on the right has four tabs: ', h('b', {}, 'Kinematics'), ', ', h('b', {}, 'Forces'), ', ', h('b', {}, 'Balancing'), ' (these two in Advanced) and ', h('b', {}, 'Sheet'),
        ' (layers, units and grid). Click the open tab, or the arrow beside its title, to hide the panel and give the drawing more room; click any tab to bring it back. ',
        'A dot on Forces or Balancing means force analysis or counterweights are on. The − on the hint card shrinks it to the tool name.'),
      h('h3', {}, 'The four layers'),
      h('p', {}, 'The ', h('b', {}, 'background'), ' holds a pasted sketch or screenshot. The ', h('b', {}, 'construction'),
        ' layer is your drafting sheet (compass, lines, points). The ', h('b', {}, 'mechanism'), ' layer holds pivots, links and sliders. ',
        h('b', {}, 'Outlines'), ' are shapes that move with a link. Each layer can be hidden, locked or faded under Sheet › Layers.'),
      h('h3', {}, 'Forces'),
      h('p', {}, 'In the Forces panel choose ', h('b', {}, 'Static'), ' (held still: gravity and your loads) or ', h('b', {}, 'Dynamic'), ' (also the inertia of the links at the input speed). ',
        'Add forces and torques with the Force tool (E). Masses come from the link shapes and material, or type them for a link in Properties. ',
        'Select a link to see its free-body diagram. ', h('b', {}, 'F₂₃'), ' is the force of link 2 on link 3 (link 1 is the ground); F₃₂ = −F₂₃.'),
      h('h3', {}, 'Balancing'),
      h('p', {}, 'The Balancing panel works out counterweights that keep the total centre of mass still, so the shaking force on the frame is zero (exact for a fourbar), and compares the largest forces without and with them. ',
        'Its rotor calculator does single-plane and two-plane balancing of masses on a shaft, or from measured bearing forces.'),
      h('h3', {}, 'Toggle and stationary positions'),
      h('p', {}, 'A ', h('b', {}, 'toggle position'), ' is where the input reaches its limit: it cannot drive the mechanism further, and the motion carries on only by the input turning back while the mechanism flips to its other assembly. ',
        'A ', h('b', {}, 'stationary position'), ' is where the output is momentarily at rest at its extreme. Both are marked on the drawing, in the motion bar and on the plots (T and S). ',
        'Dragging the mechanism rests at them; pull a little further to carry on. Switch this off in Kinematics › Input and output.'),
      h('h3', {}, 'Graphical construction'),
      h('p', {}, 'Everything snaps to exact points: ends, centres and intersections of lines, arcs and circles (shown by a red marker). ',
        'Use the compass like a real one: drag the needle to move it, drag the pencil tip to open it, and turn the knob on top to draw an arc. ',
        'The ', h('b', {}, 'Eraser'), ' (Z) deletes drawings you click or drag across; it never touches the mechanism.'),
      h('h3', {}, 'Building and running a mechanism'),
      h('p', {}, 'Place ground pivots, then draw links from joint to joint. The first link that turns about a ground pivot is the input (link 2); ',
        'choose another with the ', h('b', {}, 'Input'), ' tool (D): click a pivot or a link for a motor there, or a linear actuator or slider to drive with it. ',
        'Choose the output under Kinematics; the plots show it against the input. ',
        h('b', {}, 'Right-click'), ' a link, joint, actuator or slider (press and hold on a touch screen) to make it the input or the output in one click. ',
        'Press Enter or ▶ to run it. ',
        'With Select, dragging a joint changes the design and dragging a link moves the mechanism; the ', h('b', {}, 'Move mechanism'),
        ' tool (H) and the padlock below the drawing (', h('b', {}, 'Lengths locked'), ') make sure nothing changes by accident.'),
      ...guideSection,
      h('h3', {}, 'Keys'),
      h('div', { class: 'keys' },
        key('V', 'Select and move'), key('H', 'Move mechanism (never edits)'), key('P', 'Point'), key('L', 'Line'), key('X', 'Construction line'), key('C', 'Compass'),
        key('A', 'Protractor'), key('M', 'Measure'), key('Z', 'Eraser (drawings)'), key('G', 'Ground pivot'), key('K', 'Link'), key('J', 'Point on link'),
        key('W', 'Wheel'), key('S', 'Slider (pin in slot)'), key('T', 'Prismatic joint'), key('O', 'Roll joint'), key('Q', 'Roll + slip joint'), key('U', 'Linear actuator'), key('D', 'Input: motor or actuator'), key('E', 'Force or torque (Shift: torque)'),
        key('B', 'Outline'), key('I', 'Background picture'), key('R', 'Set picture scale'),
        key('Enter', 'Play / pause'), key('← →', 'Step the input 1° (Shift: 10°)'), key('F', 'Fit drawing in window'),
        key('Shift', 'Hold while drawing for 15° steps'), key('Esc', 'Cancel / back to Select'), key('Right-click', 'Menu: input, output, lock, delete'), key('Delete', 'Delete selection'),
        key('Space + drag', 'Pan (or middle mouse button, or two fingers)'), key('Wheel', 'Zoom (or pinch)'), key('Ctrl+Z / Ctrl+Y', 'Undo / redo'),
        key('Ctrl+V', 'Paste a picture as background'), key('Ctrl+S / Ctrl+O', 'Save / open'), key('Ctrl+Shift+S', 'Save as (a copy, new name or folder)')),
      h('h3', {}, 'Units and conventions'),
      h('p', {}, 'Lengths are shown in the unit chosen under ', h('b', {}, 'Sheet › Units and grid'), ' (mm, cm, m, inches or feet; mm unless you change it). Angles are in degrees, measured counter-clockwise from +x. Links are numbered with the ground as link 1 and the input as link 2.'),
      h('div', { class: 'row-buttons' }, h('button', { class: 'btn', onclick: () => { d.close(); dialogs.about(); } }, `About ${APP.name} ${APP.version} and licence`)),
    );
  },

  about() {
    dialog(`About ${APP.name}`, aboutContent({ name: APP.name, info: buildInfo(),
      summary: 'linkage drafting and kinematic analysis for teaching Mechanics of Machinery.' }));
  },
};
