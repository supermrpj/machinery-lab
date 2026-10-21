// =============================================================================
// tutorial.test.js — the lessons (docs/tutorial/) still match the apps
// -----------------------------------------------------------------------------
// Fails when a lesson names something on screen (in **bold**) that the app no
// longer has, uses a picture that is missing, or leaves a picture unused.
// The numbers a lesson quotes are checked by npm run tutorial-shots.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLessons, uiLabels, images, linkedFiles, TUTORIAL_DIR, APPS } from '../tutorial.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lessons = readLessons(ROOT);

/** All text of an app's source: every label it can show is somewhere in here. */
function appSource(dir) {
  let all = fs.readFileSync(path.join(ROOT, dir, 'index.html'), 'utf8');
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(js|html)$/.test(e.name)) all += fs.readFileSync(f, 'utf8');
    }
  })(path.join(ROOT, dir, 'src'));
  return all;
}

test('there are lessons, each with a title, an app, an order and a summary', () => {
  assert.ok(lessons.length > 0);
  for (const l of lessons) {
    assert.ok(l.meta.title, `${l.file}: title`);
    assert.ok(APPS[l.meta.app], `${l.file}: app is linklab or camlab`);
    assert.ok(Number.isInteger(l.meta.order), `${l.file}: order is a whole number`);
    assert.ok(l.meta.summary, `${l.file}: summary`);
  }
});

for (const l of lessons) {
  test(`${l.file}: every label in bold is still in ${APPS[l.meta.app].name}`, () => {
    const src = appSource(APPS[l.meta.app].dir);
    const missing = uiLabels(l.body).filter((label) => !src.includes(label));
    assert.deepEqual(missing, [], `not found in the app: ${missing.join(', ')}`);
  });
  test(`${l.file}: every picture and linked file exists`, () => {
    for (const img of images(l.body)) assert.ok(fs.existsSync(path.join(ROOT, TUTORIAL_DIR, img)), `missing ${img}`);
    for (const f of linkedFiles(l.body)) assert.ok(fs.existsSync(path.join(ROOT, TUTORIAL_DIR, f)), `missing ${f}`);
  });
}

test('every picture in docs/tutorial/img is used by a lesson', () => {
  const dir = path.join(ROOT, TUTORIAL_DIR, 'img');
  if (!fs.existsSync(dir)) return;
  const used = new Set(lessons.flatMap((l) => images(l.body).map((i) => path.basename(i))));
  const unused = fs.readdirSync(dir).filter((f) => !used.has(f));
  assert.deepEqual(unused, [], `unused pictures: ${unused.join(', ')}`);
});
