// =============================================================================
// commands.test.js — "Find a command" finds the right command first
// -----------------------------------------------------------------------------
// findCommands() on a small list, then on the real command lists of LinkLab
// and CamLab: every tool is there, no two commands share a label, and words a
// student is likely to type bring up the expected command first.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCommands } from '../src/commands.js';
import { linklabCommands } from '../../../apps/linklab/src/ui/commands.js';
import { camlabCommands } from '../../../apps/camlab/src/ui/commands.js';
import { TOOLS } from '../../../apps/linklab/src/drawing/tools/index.js';

const SMALL = [
  { label: 'Link', group: 'Mechanism tool', key: 'K', words: 'bar rod', run() {} },
  { label: 'Slider (pin in slot)', group: 'Mechanism tool', key: 'S', words: 'piston', run() {} },
  { label: 'Save', group: 'File', key: 'Ctrl+S', words: 'file keep', run() {} },
  { label: 'Point on link', group: 'Mechanism tool', key: 'J', words: 'coupler trace', run() {} },
];
const labels = (list) => list.map((c) => c.label);

test('nothing typed lists every command in its own order', () => {
  assert.deepEqual(labels(findCommands(SMALL, '  ')), labels(SMALL));
});

test('a word is matched from its start, in the label first', () => {
  assert.deepEqual(labels(findCommands(SMALL, 'sl')), ['Slider (pin in slot)']);
  assert.deepEqual(labels(findCommands(SMALL, 'link')), ['Link', 'Point on link']);   // the label that starts with it comes first
  assert.deepEqual(labels(findCommands(SMALL, 'piston')), ['Slider (pin in slot)']);
  assert.equal(labels(findCommands(SMALL, 'k'))[0], 'Link');                           // its key
  assert.deepEqual(labels(findCommands(SMALL, 'mechanism point')), ['Point on link']); // every word must fit
  assert.deepEqual(findCommands(SMALL, 'zzz'), []);
});

// the real lists, made with stand-ins for the app (nothing is run)
const fakeApp = { doc: { lockDesign: false }, mode: 'basic', settings: {}, ui: {} };
const LINKLAB = linklabCommands(fakeApp, {}, { confirmDiscard: () => true });
const CAMLAB = camlabCommands(fakeApp, { confirmDiscard: () => true });

for (const [name, list] of [['LinkLab', LINKLAB], ['CamLab', CAMLAB]]) {
  test(`${name}: every command has a label, a group and something to do; no label twice`, () => {
    for (const c of list) assert.ok(c.label && c.group && typeof c.run === 'function', JSON.stringify(c));
    const twice = labels(list).filter((l, i, all) => all.indexOf(l) !== i);
    assert.deepEqual(twice, []);
  });
}

test('LinkLab: every tool can be found by its name and has other words', () => {
  for (const t of TOOLS) {
    assert.equal(findCommands(LINKLAB, t.label)[0].label, t.label);
    assert.ok(LINKLAB.find((c) => c.label === t.label).words, `${t.label}: add its other words to TOOL_WORDS`);
  }
});

// what a student may type → the command that should come first
const EXPECTED = [
  [LINKLAB, 'piston', 'Slider (pin in slot)'],
  [LINKLAB, 'motor', 'Input: motor or actuator'],
  [LINKLAB, 'circle', 'Compass'],
  [LINKLAB, 'angle', 'Protractor'],
  [LINKLAB, 'fixed pivot', 'Ground pivot'],
  [LINKLAB, 'counterweight', 'Balancing panel'],
  [LINKLAB, 'free body diagram', 'Forces panel'],
  [LINKLAB, 'stl', 'Export'],
  [LINKLAB, 'inch', 'Units: US (in)'],
  [LINKLAB, 'graph', 'Plots'],
  [LINKLAB, 'lock', 'Lock all lengths'],
  [LINKLAB, 'sav', 'Save'],
  [CAMLAB, 'pressure angle', 'Plots: Size: pressure angle, ρ'],
  [CAMLAB, 'jerk', 'Plots: Motion: s, v, a, j'],
  [CAMLAB, 'step', 'Export'],
  [CAMLAB, 'cycloidal', 'Example: Double dwell — cycloidal'],
  [CAMLAB, 'by hand', 'Graphical method'],
];
for (const [list, typed, first] of EXPECTED) {
  test(`typing "${typed}" brings up "${first}" first`, () => {
    const found = findCommands(list, typed);
    assert.ok(found.length, 'nothing found');
    assert.equal(found[0].label, first);
  });
}
