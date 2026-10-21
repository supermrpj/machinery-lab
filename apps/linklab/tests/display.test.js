// Display settings (Sheet › Display): saved values are read back, damaged ones ignored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY, THEME } from '../src/config.js';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { loadDisplay, saveDisplay, arrowColor, isDefaultDisplay } = await import('../src/drawing/display.js');

test('default display when nothing is saved', () => {
  store.clear();
  const d = loadDisplay();
  assert.deepEqual(d, { text: 1, arrow: 1, angleStep: 0, colors: {} });
  assert.ok(isDefaultDisplay(d));
  assert.equal(arrowColor(d, 'reaction'), THEME.reaction);
});

test('saved sizes and colours come back', () => {
  saveDisplay({ text: 1.5, arrow: 2, colors: { load: '#ff0000' } });
  const d = loadDisplay();
  assert.equal(d.text, 1.5);
  assert.equal(d.arrow, 2);
  assert.equal(arrowColor(d, 'load'), '#ff0000');
  assert.equal(arrowColor(d, 'weight'), THEME.weight);
  assert.ok(!isDefaultDisplay(d));
});

test('values that are not offered, and damaged data, fall back to the default', () => {
  store.set(DISPLAY.storeKey, JSON.stringify({ text: 7, arrow: '2', colors: { load: 'red', reaction: '#00ff00', nope: '#123456' } }));
  const d = loadDisplay();
  assert.equal(d.text, 1);
  assert.equal(d.arrow, 1);
  assert.deepEqual(d.colors, { reaction: '#00ff00' });
  store.set(DISPLAY.storeKey, '{not json');
  assert.deepEqual(loadDisplay(), { text: 1, arrow: 1, angleStep: 0, colors: {} });
});
