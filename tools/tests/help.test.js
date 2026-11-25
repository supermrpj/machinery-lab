// =============================================================================
// help.test.js — the help pages (help/) are whole and the search finds things
// -----------------------------------------------------------------------------
// Fails when a link inside the help points at a topic or lesson that is not
// there, a page has no title or description, the search list misses a topic,
// a How-do-I answer names something on screen (in **bold**) that the app no
// longer has, or a search people are likely to type finds the wrong answer.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHelp, readHelp, uiLabels, appOfQuestion, HELP_PAGES } from '../help.mjs';
import { APPS, TUTORIAL_DIR } from '../tutorial.mjs';
import { search } from '../../site/help.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// build the help into memory, as tools/build.mjs does
const files = new Map();
const topics = buildHelp({
  root: ROOT, write: (rel, data) => files.set(rel, String(data)),
  fill: (text) => text.replaceAll('{{SITE_URL}}', 'https://example.org/').replace(/\{\{[A-Z_]+\}\}/g, 'https://example.org/x'),
  version: () => '0.0.0',
});
const htmlPages = [...files.keys()].filter((f) => f.endsWith('.html'));
const index = JSON.parse(files.get('help/search-index.json'));
const idsOf = (html) => new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));

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

test('every help page is written, with a title, a description and its own address', () => {
  assert.ok(topics > 0);
  for (const p of HELP_PAGES) assert.ok(files.has(`help/${p.slug}.html`), `help/${p.slug}.html`);
  assert.ok(files.has('help/index.html'));
  for (const f of htmlPages) {
    const html = files.get(f);
    assert.match(html, /<title>[^<{]+<\/title>/, `${f}: title`);
    assert.match(html, /<meta name="description" content="[^"{]+">/, `${f}: description`);
    assert.match(html, /<link rel="canonical" href="https:\/\/example\.org\/help\//, `${f}: canonical address`);
    assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/, `${f}: a {{...}} value was left unfilled`);
  }
});

test('topic addresses are unique on each page', () => {
  for (const f of htmlPages) {
    const all = [...files.get(f).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    const twice = all.filter((id, i) => all.indexOf(id) !== i);
    assert.deepEqual(twice, [], `${f}: used twice: ${twice.join(', ')}`);
  }
});

test('every link inside the help goes somewhere', () => {
  const broken = [];
  for (const f of htmlPages) {
    for (const [, href] of files.get(f).matchAll(/ href="([^"]+)"/g)) {
      if (/^(https?:|mailto:)/.test(href) || href.startsWith('../icons/') || href === 'help.css') continue;
      const [file, hash] = href.split('#');
      const target = path.posix.normalize(path.posix.join('help', file || path.posix.basename(f)));
      if (target.startsWith('help/') || target === 'help') {
        const html = files.get(target === 'help' || target === 'help/' ? 'help/index.html' : target);
        if (!html) broken.push(`${f}: ${href} (no such page)`);
        else if (hash && !idsOf(html).has(hash)) broken.push(`${f}: ${href} (no such topic)`);
      } else if (target.startsWith('learn/') && target.endsWith('.html')) {
        const md = path.join(ROOT, TUTORIAL_DIR, path.basename(target).replace(/\.html$/, '.md'));
        if (!fs.existsSync(md)) broken.push(`${f}: ${href} (no such lesson)`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test('the search list has every topic, and each of its addresses exists', () => {
  for (const p of readHelp(ROOT)) {
    for (const t of p.topics) {
      if (p.questions && t.level === 2) continue;
      assert.ok(index.some((e) => e.u === `${p.slug}.html#${t.id}`), `${p.slug}: ${t.title}`);
    }
  }
  for (const e of index) {
    if (e.u.startsWith('../learn/')) continue;
    const [file, hash] = e.u.split('#');
    assert.ok(idsOf(files.get(`help/${file}`)).has(hash), e.u);
    assert.ok(e.t && e.x, `${e.u}: title and text`);
  }
  assert.ok(index.some((e) => e.u.startsWith('../learn/')), 'the lessons are in the list');
});

for (const p of readHelp(ROOT).filter((x) => x.questions)) {
  for (const t of p.topics.filter((x) => x.level === 3)) {
    test(`${t.title} — every label in bold is still in the app`, () => {
      const app = appOfQuestion(t);
      assert.ok(app, 'the question is under "## LinkLab" or "## CamLab"');
      const src = appSource(APPS[app].dir);
      const missing = uiLabels(t.md).filter((label) => !src.includes(label));
      assert.deepEqual(missing, [], `not found in ${APPS[app].name}: ${missing.join(', ')}`);
    });
  }
}

// what people type → the address the first result should have
const EXPECTED = [
  ['lock length', 'how-do-i.html#linklab-how-do-i-give-a-link-an-exact-length'],
  ['locking a link', 'how-do-i.html#linklab-how-do-i-give-a-link-an-exact-length'],
  ['counterweight', 'how-do-i.html#linklab-how-do-i-balance-a-four-bar'],
  ['mechanism stuck', 'how-do-i.html#linklab-why-does-my-mechanism-not-move'],
  ['coupler curve', 'how-do-i.html#linklab-how-do-i-trace-the-path-of-a-point-a-coupler-curve'],
  ['free body diagram', 'how-do-i.html#linklab-how-do-i-find-the-joint-forces-and-the-input-torque'],
  ['pressure angle', 'how-do-i.html#camlab-how-do-i-check-the-pressure-angle-and-the-radius-of-curvature'],
  ['protractor', 'linklab.html#graphical-construction'],
  ['keyway', 'camlab.html#part-and-mounting'],
];
for (const [query, address] of EXPECTED) {
  test(`searching "${query}" finds the right topic first`, () => {
    const found = search(index, query);
    assert.ok(found.length, 'nothing found');
    assert.equal(found[0].entry.u, address);
  });
}

test('a search for nothing, or for a word that is nowhere, finds nothing', () => {
  assert.deepEqual(search(index, '   '), []);
  assert.deepEqual(search(index, 'zzzqqq'), []);
});
