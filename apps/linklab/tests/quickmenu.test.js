// =============================================================================
// Right-click menu: it offers the inputs and outputs that belong to what was
// clicked, ticks the ones in use, and choosing one really changes the input.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoDriver, linkNumbers, setDriverSpec } from '../src/model/document.js';
import { currentOutput } from '../src/model/outputs.js';
import { menuItems } from '../src/ui/quickmenu.js';
import { makeFourbar } from './helpers.js';

/** Just enough of the app for the menu. */
function fakeApp(doc) {
  return {
    doc,
    linkNumbers: () => linkNumbers(doc),
    output: () => currentOutput(doc),
    setInputSpec(spec) { setDriverSpec(doc, spec); },
    setOutput(spec) { doc.output = spec; },
    edit(label, fn) { fn(doc); },
    deleteSelection() {},
  };
}
const labels = (items) => items.filter((i) => i.label).map((i) => `${i.checked ? '✓' : ''}${i.label}`);

test('menu for a ground pivot moves the motor to it', () => {
  const { doc, O2, O4 } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: 1 });
  autoDriver(doc);
  const app = fakeApp(doc);
  const atO2 = labels(menuItems(app, { kind: 'joint', id: O2.id }));
  assert.ok(atO2.includes('✓Motor here, turning link 2'), atO2.join(' / '));
  const items = menuItems(app, { kind: 'joint', id: O4.id });
  const motor = items.find((i) => i.label && i.label.startsWith('Motor here'));
  assert.ok(motor && !motor.checked);
  motor.run();
  assert.equal(doc.driver.pivot, O4.id);
  assert.equal(doc.driver.ref, null);
});

test('menu for a coupler offers its angle as the output and motors between links', () => {
  const { doc, A } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: 1 });
  autoDriver(doc);
  const app = fakeApp(doc);
  const coupler = doc.links.find((l) => l.joints.includes(A.id) && !l.joints.includes(doc.driver.pivot));
  const items = menuItems(app, { kind: 'link', id: coupler.id });
  const ls = labels(items);
  assert.ok(ls.includes('Angle of link 3'), ls.join(' / '));
  assert.ok(ls.some((l) => l.startsWith('Motor at J3, turning against link 2')), ls.join(' / '));
  items.find((i) => i.label === 'Angle of link 3').run();
  assert.deepEqual(doc.output, { kind: 'angle', link: coupler.id });
  assert.ok(labels(menuItems(app, { kind: 'link', id: coupler.id })).includes('✓Angle of link 3'));
});

test('a moving joint offers x and y outputs; a ground pivot does not', () => {
  const { doc, A, O2 } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: 1 });
  autoDriver(doc);
  const app = fakeApp(doc);
  const ls = labels(menuItems(app, { kind: 'joint', id: A.id }));
  assert.ok(ls.includes('x of J3') && ls.includes('y of J3'), ls.join(' / '));
  assert.ok(!labels(menuItems(app, { kind: 'joint', id: O2.id })).some((l) => l.includes('x of')));
});
