// =============================================================================
// commands.js — everything "Find a command" can find and do in LinkLab
// -----------------------------------------------------------------------------
// One entry per tool (taken from the tool list, so a new tool appears here by
// itself), per top-bar action, per side-panel tab and per motion control.
// The search window is packages/ui-kit/src/commands.js; the top bar opens it.
// Labels are the words on the buttons. `words` are other words a student may
// type for the same thing: add to them when a search finds nothing.
// =============================================================================

import { TOOLS } from '../drawing/tools/index.js';
import { UNIT_PRESETS } from '../model/units.js';
import { MODE } from '../config.js';
import { openUnits, applyPreset } from './unitsPanel.js';

// ---- CONFIG: other words for each tool (by tool id) -----------------------------
const TOOL_WORDS = {
  select: 'pointer arrow pick drag edit',
  drive: 'hand turn rotate animate drag without changing',
  point: 'dot mark',
  segment: 'straight line draw',
  xline: 'infinite line guide',
  compass: 'circle arc radius',
  protractor: 'angle degrees',
  measure: 'distance dimension length ruler',
  eraser: 'delete remove rub out',
  ground: 'fixed pivot pin frame support bearing',
  link: 'bar rod crank coupler rocker member binary',
  coupler: 'coupler point tracer trace path curve ternary',
  wheel: 'disc circle roller pulley',
  slider: 'piston slot sliding block crank-slider',
  prismatic: 'sliding joint telescopic',
  roll: 'rolling contact gear friction wheel',
  rollslide: 'cam contact rolling sliding half joint',
  actuator: 'cylinder piston hydraulic pneumatic linear motor',
  input: 'motor driver crank drive actuator',
  load: 'force torque moment load weight push',
  body: 'shape polygon outline profile',
  image: 'photo picture sketch import background trace over',
  scale: 'calibrate picture size',
};
// side-panel tabs: [id, label, other words]
const PANELS = [
  ['kinematics', 'Kinematics', 'mobility degrees of freedom dof grashof position velocity acceleration input output'],
  ['forces', 'Forces', 'statics dynamics joint force pin reaction torque free body diagram fbd mass inertia gravity'],
  ['balance', 'Balancing', 'balance counterweight shaking force moment centre of mass'],
  ['tolerance', 'Tolerance', 'clearance error accuracy manufacturing play'],
  ['sheet', 'Sheet', 'layers display colours grid units arrows labels'],
];
// -------------------------------------------------------------------------------

/**
 * LinkLab's commands. `dialogs` are the windows (dialogs.js); `confirmDiscard`
 * asks before a drawing is thrown away (topbar.js).
 */
export function linklabCommands(app, dialogs, { confirmDiscard }) {
  const tools = TOOLS.map((t) => ({
    label: t.label, group: `${t.group} tool`, key: t.shortcut, words: TOOL_WORDS[t.id] || '',
    run: () => { if (t.advanced && app.mode === 'basic') app.setMode('advanced'); app.setTool(t.id); },
  }));
  const panels = PANELS.map(([id, label, words]) => ({
    label: `${label} panel`, group: MODE.advancedTabs.includes(id) ? 'Panel (Advanced)' : 'Panel', words,
    run: () => app.ui.showPanel(id),
  }));
  const units = Object.entries(UNIT_PRESETS).map(([key, p]) => ({
    label: `Units: ${p.short}`, group: 'Units', words: `${p.name} ${key.startsWith('us') ? 'imperial' : 'metric'}`,
    run: () => applyPreset(app, key),
  }));
  return [
    ...tools,
    { label: 'New', group: 'File', words: 'new drawing blank start again', run: () => { if (confirmDiscard(app)) app.newDocument(); } },
    { label: 'Open', group: 'File', key: 'Ctrl+O', words: 'load file saved drawing', run: () => app.open() },
    { label: 'Save', group: 'File', key: 'Ctrl+S', words: 'file keep download', run: () => app.save() },
    { label: 'Save as', group: 'File', key: 'Ctrl+Shift+S', words: 'copy rename another name', run: () => app.save({ saveAs: true }) },
    { label: 'Export', group: 'File', words: 'dxf stl cad solidworks inventor fusion 3-d print 3d picture png image data csv', run: () => dialogs.exportDialog(app) },
    { label: 'Clear', group: 'Edit', words: 'erase all remove everything construction mechanism picture', run: () => dialogs.clearDialog(app) },
    { label: 'Undo', group: 'Edit', key: 'Ctrl+Z', words: 'back mistake', run: () => app.undo() },
    { label: 'Redo', group: 'Edit', key: 'Ctrl+Y', words: 'again forward', run: () => app.redo() },
    { label: 'Delete the selection', group: 'Edit', key: 'Del', words: 'remove erase', run: () => app.deleteSelection() },
    { label: 'Play or pause', group: 'Motion', key: 'Enter', words: 'run animate start stop move simulate', run: () => app.play() },
    { label: 'Step forward', group: 'Motion', key: '→', words: 'next advance input', run: () => app.stepInput(1) },
    { label: 'Step back', group: 'Motion', key: '←', words: 'previous input', run: () => app.stepInput(-1) },
    { label: 'Back to the drawn position', group: 'Motion', words: 'home reset start position', run: () => app.resetPose() },
    { label: app.doc.lockDesign ? 'Unlock the lengths' : 'Lock all lengths', group: 'Motion', words: 'fix fixed padlock lengths locked constraint', run: () => app.setLock(!app.doc.lockDesign) },
    ...panels,
    { label: 'Plots', group: 'View', words: 'graph chart curves velocity acceleration show hide', run: () => app.ui.togglePlots() },
    { label: 'Grid', group: 'View', words: 'show hide squares', run: () => { app.settings.grid = !app.settings.grid; app.requestRender(); app.ui.refresh(app, 'tool'); } },
    { label: 'Names', group: 'View', words: 'joint names labels j1 show hide', run: () => { app.settings.jointNames = !app.settings.jointNames; app.requestRender(); app.ui.refresh(app, 'tool'); } },
    { label: 'Fit', group: 'View', key: 'F', words: 'zoom all centre whole drawing', run: () => app.fitView() },
    { label: 'Basic', group: 'Mode', words: 'simple mode fewer panels', run: () => app.setMode('basic') },
    { label: 'Advanced', group: 'Mode', words: 'mode all panels forces balancing tolerance', run: () => app.setMode('advanced') },
    ...units,
    { label: 'Units and grid…', group: 'Units', words: 'unit length force torque mass grid spacing', run: () => openUnits(app) },
    { label: 'Help', group: 'Help', words: 'how to guide manual instructions shortcuts', run: () => dialogs.help(app) },
    { label: 'About LinkLab', group: 'Help', words: 'version licence license credits', run: () => dialogs.about() },
  ];
}
