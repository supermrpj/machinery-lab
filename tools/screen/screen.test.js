// =============================================================================
// Screen tests: what the windows show after a setting is changed
// -----------------------------------------------------------------------------
// The other tests check the calculations. These check the screen. Each step
// changes one setting the way a user would, reads every number on the page,
// then reloads the page (which restores the saved drawing and computes
// everything again from nothing) and reads the numbers again. If the two
// differ, the screen was showing something old.
//
// They run on the built single files, so build first:
//     npm run test:screen        (builds, then runs these)
// They need Google Chrome or Edge. Without one they are skipped, not failed.
// Set CHROME=/path/to/chrome to choose the browser.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---- CONFIG -------------------------------------------------------------------
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'dist');
const FOURBAR = path.join(ROOT, 'docs/tutorial/files/fourbar.linklab.json');
const SETTLE_MS = 1300;   // longer than the 0.8 s the apps wait before saving
const LOAD_MS = 1200;
const BROWSERS = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
// lines that are allowed to differ after a reload (messages, not results)
const IGNORE = /restored|Click to select|Guide/;

// ---- helpers ------------------------------------------------------------------
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const built = fs.existsSync(path.join(DIST, 'LinkLab.html')) && fs.existsSync(path.join(DIST, 'CamLab.html'));
const skip = !browserPath ? 'no Chrome or Edge found (set CHROME=…)' : !built ? 'dist/ is missing: run npm run build' : false;

const lines = (text) => text.split('\n').map((s) => s.trim()).filter((s) => s && !IGNORE.test(s));
const tab = (page, name) => page.getByText(name, { exact: true }).first().click();
const inputAfter = (page, label, n = 1) => page.locator(`text=${label}`).first().locator(`xpath=following::input[${n}]`);
const type = async (el, value) => { await el.fill(String(value)); await el.press('Tab'); };
const choose = async (select, re) => {
  const options = await select.locator('option').allTextContents();
  await select.selectOption({ label: options.find((o) => re.test(o)) });
};
async function closeGuides(page) {
  for (let i = 0; i < 3; i++) {
    const x = page.locator('button:has-text("×"):visible').first();
    if (await x.count()) { try { await x.click({ timeout: 800 }); } catch { /* none open */ } }
  }
}

/** Open an app offline with a saved drawing (or a new one) in Advanced mode. */
async function open(browser, file, storeKey, modeKey, seed) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  await ctx.setOffline(true);
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(pathToFileURL(path.join(DIST, file)).href);
  await page.evaluate(([k, t, mk]) => { if (t) localStorage.setItem(k, t); localStorage.setItem(mk, 'advanced'); }, [storeKey, seed, modeKey]);
  await page.reload();
  await page.waitForTimeout(LOAD_MS);
  return { ctx, page };
}

/** Every line of text on the page, per side-panel tab (or the whole page when tabs is [null]). */
async function read(page, tabs) {
  const out = {};
  for (const t of tabs) {
    if (t) { await tab(page, t); await page.waitForTimeout(300); }
    out[t || 'page'] = lines(await page.evaluate(() => document.body.innerText));
  }
  return out;
}

/** Do one change, then check the screen against a fresh reload. Returns the differences. */
async function changeAndCompare(page, tabs, change) {
  await change(page);
  await page.waitForTimeout(SETTLE_MS);
  await closeGuides(page);
  const shown = await read(page, tabs);
  await page.reload();
  await page.waitForTimeout(LOAD_MS);
  await closeGuides(page);
  const fresh = await read(page, tabs);
  const diff = [];
  for (const t of Object.keys(shown)) {
    const a = shown[t], b = fresh[t];
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diff.push(`[${t}] shown "${a[i]}" but fresh "${b[i]}"`);
  }
  return diff.slice(0, 6);
}

async function runSteps(t, page, tabs, steps) {
  for (const [name, change] of steps) {
    await t.test(name, async () => {
      const diff = await changeAndCompare(page, tabs, change);
      assert.deepEqual(diff, [], `after "${name}" the screen shows old values:\n  ${diff.join('\n  ')}`);
    });
  }
}

// ---- LinkLab ------------------------------------------------------------------
test('LinkLab: the panels follow every setting', { skip }, async (t) => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: browserPath, args: ['--no-sandbox'] });
  const { ctx, page } = await open(browser, 'LinkLab.html', 'linklab.autosave.v1', 'linklab.mode', fs.readFileSync(FOURBAR, 'utf8'));
  const speed = (v) => async (p) => { await tab(p, 'Kinematics'); await type(inputAfter(p, 'ω₂ (rad/s)'), v); };
  const accel = (v) => async (p) => { await tab(p, 'Kinematics'); await type(inputAfter(p, 'α₂ (rad/s²)'), v); };
  const forces = (name) => async (p) => { await tab(p, 'Forces'); await p.getByText(name, { exact: true }).first().click(); };
  const units = (re) => (p) => choose(p.locator('select').filter({ hasText: 'SI (mm)' }).first(), re);
  try {
    await runSteps(t, page, ['Kinematics', 'Forces', 'Balancing'], [
      ['forces on, Dynamic', forces('Dynamic')],
      ['input speed typed', speed(23)],
      ['input acceleration typed', accel(50)],
      ['gravity off', async (p) => { await tab(p, 'Forces'); await p.locator('label', { hasText: 'Gravity' }).locator('input[type=checkbox]').click(); }],
      ['thickness', async (p) => { await tab(p, 'Forces'); await type(inputAfter(p, 'Thickness'), 10); }],
      ['width', async (p) => { await tab(p, 'Forces'); await type(inputAfter(p, 'Thickness', 2), 20); }],
      ['material', async (p) => { await tab(p, 'Forces'); await choose(p.locator('text=Material').first().locator('xpath=following::select[1]'), /lumin/i); }],
      ['Static', forces('Static')],
      ['Dynamic', forces('Dynamic')],
      ['units SI (m)', units(/SI \(m\)/)],
      ['units US (in)', units(/US \(in\)/)],
      ['input speed typed in US units', speed(31)],
      ['units SI (mm)', units(/SI \(mm\)/)],
      ['counterweights added', async (p) => { await tab(p, 'Balancing'); await p.getByText('Add these counterweights').click(); }],
      ['input speed typed with counterweights', speed(17)],
      ['counterweights switched off', async (p) => { await tab(p, 'Balancing'); await p.locator('label', { hasText: 'Use the counterweights' }).locator('input[type=checkbox]').click(); }],
      ['input speed reversed', speed(-15)],
      ['input acceleration back to zero', accel(0)],
    ]);
  } finally { await ctx.close(); await browser.close(); }
});

// ---- CamLab -------------------------------------------------------------------
test('CamLab: the results follow every input', { skip }, async (t) => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: browserPath, args: ['--no-sandbox'] });
  const { ctx, page } = await open(browser, 'CamLab.html', 'camlab.autosave', 'camlab.mode', null);
  await page.getByText('New', { exact: true }).first().click();
  await page.waitForTimeout(400);
  // a new design's boxes, in order: name, β1, β2, h2, β3, β4, h4, Rp, Rf, ε, ω, rpm
  const box = (i, v) => (p) => type(p.locator('input:visible').nth(i), v);
  const law = (from, to) => async (p) => {
    const s = p.locator('select:visible');
    for (let i = 0; i < await s.count(); i++) if ((await s.nth(i).inputValue()) === from) { await s.nth(i).selectOption(to); return; }
    throw new Error(`no segment uses ${from}`);
  };
  const button = (re) => (p) => p.getByText(re).first().click();
  const units = (re) => (p) => choose(p.locator('select').filter({ hasText: 'SI (mm, N, kg)' }).first(), re);
  try {
    await runSteps(t, page, [null], [
      ['first dwell 120°', box(1, 120)], ['rise 80°', box(2, 80)], ['rise 27 mm', box(3, 27)],
      ['second dwell 60°', box(4, 60)], ['fall 100°', box(5, 100)], ['fall 27 mm', box(6, 27)],
      ['prime circle', box(7, 55)], ['roller radius', box(8, 10)], ['eccentricity', box(9, 6)], ['speed in rpm', box(11, 120)],
      ['rise law 3-4-5', law('cycloidal', 'poly345')], ['fall law modified sine', law('cycloidal', 'modSine')], ['rise law simple harmonic', law('poly345', 'shm')],
      ['cam turns clockwise', button(/Clockwise$/)], ['flat-faced follower', button(/^Flat-faced$/)], ['roller follower again', button(/^Roller$/)],
      ['units US', units(/US/)], ['prime circle typed in inches', box(7, 2)], ['units SI', units(/SI/)],
    ]);
  } finally { await ctx.close(); await browser.close(); }
});
