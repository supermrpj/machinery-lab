// =============================================================================
// commands.js — everything "Find a command" can find and do in CamLab
// -----------------------------------------------------------------------------
// One entry per top-bar action, example, plot set, view and unit system (the
// last four are taken from their own lists, so a new one appears here by
// itself). The search window is packages/ui-kit/src/commands.js; the top bar
// opens it. Labels are the words on the screen. `words` are other words a
// student may type for the same thing: add to them when a search finds nothing.
// =============================================================================

import { EXAMPLES } from '../model/document.js';
import { UNIT_SYSTEMS } from '../model/units.js';
import { PLOTS, MODE } from '../config.js';
import { openExportDialog, openHelp, openAbout } from './dialogs.js';

// ---- CONFIG: other words for each plot set (by id) ------------------------------
const PLOT_WORDS = {
  motion: 'svaj displacement velocity acceleration jerk lift',
  size: 'pressure angle radius of curvature undercut base circle prime circle',
  forces: 'contact force camshaft torque spring',
  dynamics: 'follower jump force acceleration spring',
};
// -------------------------------------------------------------------------------

/** CamLab's commands. `confirmDiscard` asks before a changed design is replaced (topbar.js). */
export function camlabCommands(app, { confirmDiscard }) {
  const examples = EXAMPLES.map((ex) => ({
    label: `Example: ${ex.name}`, group: 'Examples', words: 'sample demo open',
    run: () => { if (confirmDiscard()) app.loadExample(ex.id); },
  }));
  const plots = PLOTS.sets.map((p) => ({
    label: `Plots: ${p.name}`, group: MODE.advancedPlots.includes(p.id) ? 'Plots (Advanced)' : 'Plots', words: `graph chart curve ${PLOT_WORDS[p.id] || ''}`,
    run: () => {
      if (!app.shows('plots', p.id)) app.setMode('advanced');
      if (app.layout === 'cam') app.setLayout('both');
      app.setPlots(p.id);
    },
  }));
  const layouts = PLOTS.layouts.map((l) => ({
    label: `Show: ${l.name}`, group: 'View', words: 'layout view only side by side', run: () => app.setLayout(l.id),
  }));
  const units = Object.values(UNIT_SYSTEMS).map((u) => ({
    label: `Units: ${u.name}`, group: 'Units', words: u.key === 'us' ? 'imperial inch' : 'metric',
    run: () => app.edit('Change units', (d) => { d.units = u.key; }),
  }));
  return [
    { label: 'New', group: 'File', words: 'new cam design blank start again', run: () => { if (confirmDiscard()) app.newDocument(); } },
    { label: 'Open', group: 'File', key: 'Ctrl+O', words: 'load file saved design', run: () => { if (confirmDiscard()) app.open(); } },
    { label: 'Save', group: 'File', key: 'Ctrl+S', words: 'file keep download', run: () => app.save() },
    { label: 'Save as', group: 'File', key: 'Ctrl+Shift+S', words: 'copy rename another name', run: () => app.save({ saveAs: true }) },
    { label: 'Export', group: 'File', words: 'stl step dxf cad solidworks inventor fusion 3-d print 3d data csv keyway hub', run: () => openExportDialog(app) },
    { label: 'Undo', group: 'Edit', key: 'Ctrl+Z', words: 'back mistake', run: () => app.undo() },
    { label: 'Redo', group: 'Edit', key: 'Ctrl+Y', words: 'again forward', run: () => app.redo() },
    { label: 'Play or pause', group: 'Motion', key: 'Space', words: 'run animate turn rotate start stop', run: () => app.play() },
    ...plots,
    ...layouts,
    { label: 'Graphical method', group: 'Learn', words: 'draw by hand construction tutorial inversion step by step', run: () => app.ui.openTutorial() },
    ...examples,
    { label: 'Basic', group: 'Mode', words: 'simple mode fewer plots', run: () => app.setMode('basic') },
    { label: 'Advanced', group: 'Mode', words: 'mode all plots size forces spring', run: () => app.setMode('advanced') },
    ...units,
    { label: 'Help', group: 'Help', words: 'how to guide manual instructions shortcuts', run: () => openHelp(app) },
    { label: 'About CamLab', group: 'Help', words: 'version licence license credits', run: () => openAbout() },
  ];
}
