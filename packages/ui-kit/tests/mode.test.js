// Basic | Advanced: the stored choice, with and without browser storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMode, saveMode } from '../src/mode.js';

test('starts in Basic when nothing is stored or storage is missing', () => {
  delete globalThis.localStorage;
  assert.equal(loadMode('x.mode'), 'basic');
  assert.equal(loadMode('x.mode', 'advanced'), 'advanced');
});

test('remembers the choice and ignores anything else', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  saveMode('x.mode', 'advanced');
  assert.equal(loadMode('x.mode'), 'advanced');
  store.set('x.mode', 'expert');
  assert.equal(loadMode('x.mode'), 'basic');
  delete globalThis.localStorage;
});
