// =============================================================================
// tutorial-shots.mjs — retake the tutorial screenshots from the built apps
// -----------------------------------------------------------------------------
//   npm run build && npm run tutorial-shots
//
// Each lesson in docs/tutorial/ has a function below that follows the lesson's
// steps in the real app (dist/LinkLab.html, dist/CamLab.html) with clicks and
// key presses, checks the numbers the lesson quotes, and saves the pictures
// to docs/tutorial/img/. If a step no longer works (a button was renamed, a
// number changed), the script stops with an error: fix the lesson first.
//
// Run it before a release, when the apps have changed. It is a development
// tool only: Cloudflare's build never runs it.
//
// Browser: playwright-core does not download one. It uses, in this order,
// the CHROME_PATH environment variable, an installed Google Chrome, Microsoft
// Edge, or Playwright's Chromium in /opt/pw-browsers.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- CONFIG -------------------------------------------------------------------
const IMG_DIR = path.join(ROOT, 'docs/tutorial/img');
const VIEWPORT = { width: 1280, height: 800 };     // screen size of the pictures
const SCALE = 1;                                    // device pixel ratio
const TOL = 0.0005;                                 // relative tolerance for quoted numbers
// -------------------------------------------------------------------------------

const only = process.argv.slice(2);   // lesson names to run (default: all)

/** Start a browser from what is installed (see the header). */
async function launch() {
  const tries = [];
  if (process.env.CHROME_PATH) tries.push({ executablePath: process.env.CHROME_PATH });
  tries.push({ channel: 'chrome' }, { channel: 'msedge' });
  for (const dir of ['/opt/pw-browsers']) {
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir).filter((n) => n.startsWith('chromium-')).sort().reverse()) {
      const exe = path.join(dir, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(exe)) tries.push({ executablePath: exe });
    }
  }
  for (const opts of tries) {
    try { return await chromium.launch(opts); } catch { /* try the next one */ }
  }
  throw new Error('No browser found. Install Chrome or Edge, or set CHROME_PATH to a Chromium-based browser.');
}

/** A fresh page with one app open. `seed` presets the app's saved settings. */
async function openApp(browser, file, seed = {}) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('seeded')) return;
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    sessionStorage.setItem('seeded', '1');
  }, seed);
  await page.goto(pathToFileURL(path.join(ROOT, 'dist', file)).href);
  await page.waitForTimeout(1200);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(100); }
  page.errors = errors;
  return page;
}

/** Save a picture of the page (or of a region { x, y, width, height }). */
async function shot(page, name, clip = null) {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  await page.waitForTimeout(300);
  // WebP: a quarter of the size of PNG, so the site (kept offline) stays small
  await page.screenshot({ path: path.join(IMG_DIR, `${name}.webp`), type: 'webp', quality: 82, ...(clip ? { clip } : {}) });
  console.log(`  saved img/${name}.webp`);
}

/** Stop with a clear message when the app does not show what the lesson says. */
function expect(ok, what) {
  if (!ok) throw new Error(`Lesson out of date: ${what}`);
}
const near = (got, want, tol = TOL) => Math.abs(got - want) <= tol * Math.max(1, Math.abs(want));

// ---- LinkLab helpers ---------------------------------------------------------------

/** Screen position (page pixels) of a world point (mm) on LinkLab's drawing. */
async function llScreen(page, p) {
  return page.evaluate(({ x, y }) => {
    const a = window.linklab, s = a.view.toScreen({ x, y });
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }, p);
}
async function llClick(page, p) {
  const s = await llScreen(page, p);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(150);
}
/** Close the Properties card with its × button (Esc inside a box only leaves the box). */
async function llCloseCard(page) {
  const x = page.locator('button[aria-label="Close properties"]');
  if (await x.isVisible().catch(() => false)) { await x.click(); await page.waitForTimeout(150); }
}
/** Select joint Jn with the select tool and type its position. */
async function llSetJoint(page, n, x, y) {
  await llCloseCard(page);   // the Properties card can cover the next joint
  await page.keyboard.press('v');
  const at = await page.evaluate((k) => { const j = window.linklab.doc.joints[k - 1]; return { x: j.x, y: j.y }; }, n);
  await llClick(page, at);
  for (const [k, v] of [['x', x], ['y', y]]) {
    const box = page.locator(`input[aria-label="Position ${k} (mm)"]`);
    await box.fill(String(v));
    await box.press('Enter');
    await page.waitForTimeout(150);
  }
  const j = await page.evaluate((k) => window.linklab.doc.joints[k - 1], n);
  expect(near(j.x, x) && near(j.y, y), `J${n} did not move to (${x}, ${y})`);
}
const llPanelText = (page) => page.locator('.side-panel, #side-body').first().innerText();


// ---- shared by the LinkLab lessons that start from docs/tutorial/files/fourbar.linklab.json ----
const FOURBAR_FILE = path.join(ROOT, 'docs/tutorial/files/fourbar.linklab.json');
/** LinkLab with the fourbar of lesson 1 loaded (as if opened from the file), on one tab. */
async function openFourbar(browser, { mode = 'advanced', tab = 'kinematics' } = {}) {
  const page = await openApp(browser, 'LinkLab.html', {
    'linklab.autosave.v1': fs.readFileSync(FOURBAR_FILE, 'utf8'),
    'linklab.mode': mode, 'linklab.hintShort': '1', 'linklab.guides': JSON.stringify({ off: true }),
    'linklab.side': JSON.stringify({ tab, hidden: false }),
  });
  await page.waitForTimeout(2500);   // the "restored" notice fades
  expect(await page.evaluate(() => window.linklab.sim.drivable), 'the fourbar file does not drive');
  return page;
}
/** Set the input angle from the box in the motion bar. */
async function llAngle(page, deg) {
  const box = page.locator('.timeline input[type="number"]').first();
  await box.fill(String(deg)); await box.press('Enter'); await page.waitForTimeout(300);
}
/** Numbers from the side panel: the first number after `label` on the same line. */
function panelNumber(text, label) {
  const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[=:]?\\s*([−\\-\\d.]+)');
  const m = text.match(re);
  return m ? parseFloat(m[1].replace('−', '-')) : NaN;
}
/** A row of a panel table: the numbers after its label, e.g. 'F₁₂ J1' → [0.6183, 122.8]. */
function panelRow(text, label) {
  const line = text.split('\n').find((l) => l.startsWith(label));
  return line ? line.slice(label.length).match(/[−\-\d.]+/g).map((v) => parseFloat(v.replace('−', '-'))) : null;
}

// =============================================================================
// Lessons
// =============================================================================
const LESSONS = {
  /** LinkLab 1: your first fourbar (docs/tutorial/linklab-1-first-fourbar.md) */
  async 'linklab-1'(browser) {
    const page = await openApp(browser, 'LinkLab.html', {
      'linklab.mode': 'basic', 'linklab.hintShort': '1', 'linklab.guides': JSON.stringify({ off: true }),
      'linklab.side': JSON.stringify({ tab: 'kinematics', hidden: false }),
    });
    // start from an empty sheet
    await page.evaluate(() => window.linklab.newDocument());
    await page.waitForTimeout(3200);   // let the "New drawing." notice fade

    // step 1: two ground pivots
    await page.keyboard.press('g');
    await llClick(page, { x: 0, y: 0 });
    await llClick(page, { x: 100, y: 0 });
    // step 2: crank and coupler as one chain, then the rocker from its own pivot
    await page.keyboard.press('k');
    for (const p of [{ x: 0, y: 0 }, { x: 20, y: 35 }, { x: 135, y: 70 }]) await llClick(page, p);
    await page.keyboard.press('Escape');
    for (const p of [{ x: 100, y: 0 }, { x: 135, y: 70 }]) await llClick(page, p);
    await page.keyboard.press('Escape');
    const counts = await page.evaluate(() => ({ joints: window.linklab.doc.joints.length, links: window.linklab.doc.links.length }));
    expect(counts.joints === 4 && counts.links === 3, `expected 4 joints and 3 links, got ${JSON.stringify(counts)}`);
    await shot(page, 'linklab-1-drawn');

    // step 3: exact positions
    await llSetJoint(page, 1, 0, 0);
    await llSetJoint(page, 2, 100, 0);
    await llSetJoint(page, 3, 20, 34.641);
    await llSetJoint(page, 4, 133.881, 72.471);
    await llCloseCard(page);
    await page.keyboard.press('f');

    // step 4: the motor is already on J1 (the first link from a ground pivot gets it)
    const motor = await page.evaluate(() => { const a = window.linklab, d = a.doc.driver; return { on: a.sim.drivable, pivot: d.pivot, link: d.link, j1: a.doc.joints[0].id, l1: a.doc.links[0].id }; });
    expect(motor.on && motor.pivot === motor.j1 && motor.link === motor.l1, `the motor is not on link 2 at J1: ${JSON.stringify(motor)}`);

    // step 6: a coupler point (Point on link) in the middle of the coupler
    await page.keyboard.press('j');
    await llClick(page, { x: 76.94, y: 53.556 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');

    // step 7: read the numbers at θ2 = 60°
    const angle = page.locator('.timeline input[type="number"]').first();
    await angle.fill('60'); await angle.press('Enter'); await page.waitForTimeout(300);
    const text = await llPanelText(page);
    const num = (re) => { const m = text.match(re); return m ? parseFloat(m[1].replace('−', '-')) : NaN; };
    const got = { out: num(/output\s*=\s*\n?\s*([−\-\d.]+)/), vel: num(/velocity ([−\-\d.]+) rad\/s/), acc: num(/acceleration ([−\-\d.]+) rad\/s²/) };
    console.log('  at θ2 = 60°:', JSON.stringify(got));
    expect(near(got.out, 64.943) && near(got.vel, 4.574) && near(got.acc, 31.99), `numbers at 60° are ${JSON.stringify(got)}, the lesson says 64.943°, 4.574 rad/s, 31.99 rad/s²`);
    expect(/Toggle[^\n]*none/.test(text), 'the Kinematics panel does not say "Toggle (input limit): none"');
    await shot(page, 'linklab-1-numbers');

    // step 8: the plots
    await page.getByRole('button', { name: 'Plots' }).click();
    await page.waitForTimeout(500);
    await page.keyboard.press('f');
    await shot(page, 'linklab-1-plots');
    // the rocker's swing over a full turn of the crank (quoted in the lesson)
    const swing = await page.evaluate(() => { const a = window.linklab, id = a.doc.links[2].id;
      const t = a.sim.getSweep().samples.map((x) => x.results.links.get(id).theta * 180 / Math.PI); return [Math.min(...t), Math.max(...t)]; });
    console.log('  rocker swing:', swing.map((v) => v.toFixed(2)).join(' to '));
    expect(near(swing[0], 54.90) && near(swing[1], 128.68), `the rocker swings ${swing}, the lesson says 54.90° to 128.68°`);

    // exercise: double the input speed → velocity ×2, acceleration ×4
    const w = page.locator('input[aria-label="Input angular velocity in rad/s"]');
    expect(await w.count(), 'no input speed box (ω₂) in the Kinematics panel');
    await w.fill('20'); await w.press('Tab'); await page.waitForTimeout(400);
    const t2 = await llPanelText(page);
    const num2 = (re) => { const m = t2.match(re); return m ? parseFloat(m[1].replace('−', '-')) : NaN; };
    const ex = { vel: num2(/velocity ([−\-\d.]+) rad\/s/), acc: num2(/acceleration ([−\-\d.]+) rad\/s²/) };
    console.log('  exercise at ω2 = 20 rad/s:', JSON.stringify(ex));
    expect(near(ex.vel, 9.147) && near(ex.acc, 128.0), `at ω2 = 20 rad/s the panel shows ${JSON.stringify(ex)}, the answer says 9.147 rad/s and 128 rad/s²`);
    expect(!page.errors.length, `errors in the page: ${page.errors.join('; ')}`);
    await page.close();
  },

  /** LinkLab 2: kinematics (docs/tutorial/linklab-2-kinematics.md) */
  async 'linklab-2'(browser) {
    const page = await openFourbar(browser, { mode: 'basic' });
    await llAngle(page, 60);
    // step 2: the output as x of the coupler point, read in the panel
    const out = page.locator('#side-body select[aria-label="Output"]');
    await out.selectOption({ label: 'Angle of link 3' }); await page.waitForTimeout(300);
    let t = await llPanelText(page);
    const l3 = { th: panelNumber(t, 'output ='), w: panelNumber(t, 'velocity'), a: panelNumber(t, 'acceleration') };
    console.log('  link 3 at 60°:', JSON.stringify(l3));
    expect(near(l3.th, 18.376) && near(l3.w, -0.3956) && near(l3.a, 26.68), `link 3 at 60°: ${JSON.stringify(l3)}, expected 18.376°, −0.3956 rad/s, 26.68 rad/s²`);
    // step 3: the point path plots
    await page.getByRole('button', { name: 'Plots' }).click(); await page.waitForTimeout(400);
    await page.locator('select[aria-label="Plot preset"]').selectOption({ label: 'Preset: Point path' }); await page.waitForTimeout(500);
    await page.keyboard.press('f');
    await shot(page, 'linklab-2-pointpath');
    // the point's speed at 60° from the data behind the plot
    const vP = await page.evaluate(() => { const a = window.linklab, P = a.doc.joints.find((j) => j.trace); const r = a.sim.results.joints.get(P.id); return Math.hypot(r.vel.x, r.vel.y); });
    console.log('  |V_P| at 60°:', vP.toFixed(2));
    expect(near(vP, 382.58), `|V_P| at 60° is ${vP}, expected 382.58 mm/s`);
    // step 4: transmission angle
    await page.locator('select[aria-label="Plot preset"]').selectOption({ label: 'Preset: Transmission' }); await page.waitForTimeout(500);
    const mu = await page.evaluate(() => { const a = window.linklab, s = a.sim.getSweep(); const k = a.sim.info.kind; let min = 1e9, at = 0;
      for (const smp of s.samples) { const P = (j) => smp.results.joints.get(j.id).pos; const t3 = Math.atan2(P(k.B).y - P(k.A).y, P(k.B).x - P(k.A).x), t4 = Math.atan2(P(k.B).y - P(k.O4).y, P(k.B).x - P(k.O4).x);
        let m = Math.abs((t4 - t3) * 180 / Math.PI) % 360; if (m > 180) m = 360 - m; if (m > 90) m = 180 - m; if (m < min) { min = m; at = smp.theta * 180 / Math.PI; } } return { min, at }; });
    console.log('  smallest transmission angle:', mu.min.toFixed(2), 'at', mu.at.toFixed(1));
    expect(near(mu.min, 26.38) && (near(mu.at, 0) || near(mu.at, 360)), `smallest transmission angle ${JSON.stringify(mu)}, expected 26.38° at θ₂ = 0°`);
    await shot(page, 'linklab-2-transmission');
    // step 5: time axis and CSV export exist
    await page.locator('select[aria-label="Plot x-axis"]').selectOption({ label: 'Time over one cycle' }); await page.waitForTimeout(300);
    expect(await page.getByRole('button', { name: 'Export data (CSV)' }).count(), 'no "Export data (CSV)" button');
    expect(!page.errors.length, `errors in the page: ${page.errors.join('; ')}`);
    await page.close();
  },

  /** LinkLab 3: dynamics (docs/tutorial/linklab-3-dynamics.md) */
  async 'linklab-3'(browser) {
    const page = await openFourbar(browser, { tab: 'forces' });
    await llAngle(page, 60);
    const panel = page.locator('#side-body');
    // step 1: Static
    await panel.locator('button', { hasText: 'Static' }).first().click(); await page.waitForTimeout(600);
    let t = await llPanelText(page);
    expect(/Steel/.test(t), 'the material is not steel');
    const st = { T: panelNumber(t, 'T₁₂ ='), F12: panelRow(t, 'F₁₂ J1'), F14: panelRow(t, 'F₁₄ J2') };
    console.log('  static at 60°:', JSON.stringify(st));
    expect(near(st.T, 0.01927) && near(st.F12[0], 0.6183) && near(st.F12[1], 122.8) && near(st.F14[0], 1.021) && near(st.F14[1], 70.8), `static: ${JSON.stringify(st)}`);
    // the free-body diagram: select link 3
    await page.keyboard.press('v');
    await llClick(page, { x: 48.5, y: 44.1 });   // on the coupler's line A→B, a quarter along
    expect(await page.evaluate(() => window.linklab.selection && window.linklab.selection.kind === 'link'), 'the coupler was not selected');
    await shot(page, 'linklab-3-static');
    await llCloseCard(page);
    // step 2: Dynamic
    await panel.locator('button', { hasText: 'Dynamic' }).first().click(); await page.waitForTimeout(600);
    t = await llPanelText(page);
    const dy = { T: panelNumber(t, 'T₁₂ ='), F14: panelRow(t, 'F₁₄ J2'), Tmax: panelNumber(t, 'largest over the cycle:'), shake: panelNumber(t, 'Shaking force'), F14max: panelRow(t, 'F₁₄ J2') };
    console.log('  dynamic at 60°:', JSON.stringify(dy));
    expect(near(dy.T, 0.02453) && near(dy.F14[0], 1.003) && near(dy.F14[1], 72.0) && near(dy.Tmax, 0.03663) && near(dy.shake, 0.351), `dynamic: ${JSON.stringify(dy)}`);
    // largest joint force over the cycle: the panel's line
    const big = t.match(/Largest joint force: (F[₀-₉,]+ J\d) = ([\d.]+) N at ∠([−\-\d.]+)°, when θ₂ = ([\d.]+)°/);
    console.log('  largest:', big && big.slice(1).join(' | '));
    expect(big && big[1] === 'F₁₄ J2' && near(+big[2], 2.487) && near(+big[4], 8.9), 'largest joint force line changed');
    // step 3: forces plot preset
    await page.getByRole('button', { name: 'Plots' }).click(); await page.waitForTimeout(400);
    await page.locator('select[aria-label="Plot preset"]').selectOption({ label: 'Preset: Forces' }); await page.waitForTimeout(500);
    await page.keyboard.press('f');
    await shot(page, 'linklab-3-dynamic');
    // exercise: at 30 rad/s inertia dominates: T max ×? read it
    const w = page.locator('#side-body input[aria-label="Input angular velocity in rad/s"]');
    if (await w.count() === 0) { await page.locator('.side-tab', { hasText: 'Kinematics' }).click(); await page.waitForTimeout(300); }
    const wb = page.locator('#side-body input[aria-label="Input angular velocity in rad/s"]');
    await wb.fill('30'); await wb.press('Tab'); await page.waitForTimeout(500);
    await page.locator('.side-tab', { hasText: 'Forces' }).click(); await page.waitForTimeout(500);
    t = await llPanelText(page);
    const ex = { Tmax: panelNumber(t, 'largest over the cycle:'), F14max: (t.match(/Largest joint force: F[₀-₉,]+ J\d = ([\d.]+) N/) || [])[1], who: (t.match(/Largest joint force: (F[₀-₉,]+ J\d)/) || [])[1] };
    console.log('  exercise at 30 rad/s:', JSON.stringify(ex));
    expect(near(ex.Tmax, 0.2683) && near(+ex.F14max, 15.02) && ex.who === 'F₁₂ J1', `at 30 rad/s: ${JSON.stringify(ex)}, the lesson says 0.2683 N·m and F₁₂ J1 = 15.02 N`);
    expect(!page.errors.length, `errors in the page: ${page.errors.join('; ')}`);
    await page.close();
  },

  /** LinkLab 4: balancing (docs/tutorial/linklab-4-balancing.md) */
  async 'linklab-4'(browser) {
    const page = await openFourbar(browser, { tab: 'forces' });
    const panel = page.locator('#side-body');
    await panel.locator('button', { hasText: 'Dynamic' }).first().click(); await page.waitForTimeout(500);
    await page.locator('.side-tab', { hasText: 'Balancing' }).click(); await page.waitForTimeout(500);
    let t = await llPanelText(page);
    const box = t.match(/moves within ([\d.]+) × ([\d.]+) mm/);
    const row2 = panelRow(t, ' 2'), row4 = panelRow(t, ' 4');
    console.log('  G total box:', box && box.slice(1).join(' × '), '| m·R rows:', JSON.stringify([row2, row4]));
    expect(box && near(+box[1], 62.86) && near(+box[2], 32.48), 'G total travel changed');
    expect(row2 && near(row2[0], 2.016) && near(row2[1], -180) && row4 && near(row4[0], 4.936) && near(row4[1], -180), 'counterweight m·R changed');
    await panel.locator('label.check', { hasText: 'Show it' }).locator('input').check(); await page.waitForTimeout(300);
    await page.keyboard.press('f');
    await shot(page, 'linklab-4-before');
    // radius 20 mm on both, then add
    for (const n of [2, 4]) { const r = panel.locator(`input[aria-label="Counterweight radius for link ${n} in mm"]`); await r.fill('20'); await r.press('Tab'); await page.waitForTimeout(200); }
    t = await llPanelText(page);
    const m2 = panelRow(t, ' 2'), m4 = panelRow(t, ' 4');
    console.log('  with R = 20 mm:', JSON.stringify([m2, m4]));
    expect(m2 && near(m2[2], 0.1008) && m4 && near(m4[2], 0.2468), `masses at R = 20 mm: ${JSON.stringify([m2, m4])}`);
    await panel.getByRole('button', { name: 'Add these counterweights' }).click(); await page.waitForTimeout(600);
    t = await llPanelText(page);
    expect(/It stays still: the mechanism is force balanced/.test(t), 'G total still moves after balancing');
    const cmp = { shake: panelRow(t, 'Shaking force (N)'), moment: panelRow(t, 'Shaking moment (N·m)'), torque: panelRow(t, 'Input torque (N·m)'), joint: panelRow(t, 'Joint force (N)') };
    console.log('  without / with:', JSON.stringify(cmp));
    expect(near(cmp.shake[0], 1.022) && cmp.shake[1] === 0 && near(cmp.moment[0], 0.08563) && near(cmp.moment[1], 0.06296)
      && near(cmp.torque[0], 0.03663) && near(cmp.torque[1], 0.04017) && near(cmp.joint[0], 2.487) && near(cmp.joint[1], 4.528), `comparison table: ${JSON.stringify(cmp)}`);
    await page.keyboard.press('f');
    await shot(page, 'linklab-4-after');
    // the shaking force is now zero, the input torque is not
    await page.locator('.side-tab', { hasText: 'Forces' }).click(); await page.waitForTimeout(500);
    t = await llPanelText(page);
    const shake = panelNumber(t, 'Shaking force'), T = panelNumber(t, 'largest over the cycle:');
    console.log('  shaking force now:', shake, '| largest torque:', T);
    expect(shake < 1e-3 && near(T, 0.04017), `after balancing: shaking ${shake} N, largest torque ${T} N·m`);
    await page.getByRole('button', { name: 'Plots' }).click(); await page.waitForTimeout(400);
    await page.locator('select[aria-label="Plot preset"]').selectOption({ label: 'Preset: Balancing' }); await page.waitForTimeout(500);
    await shot(page, 'linklab-4-plots');
    // exercise: R = 40 mm
    await page.locator('.side-tab', { hasText: 'Balancing' }).click(); await page.waitForTimeout(400);
    for (const n of [2, 4]) { const r = panel.locator(`input[aria-label="Counterweight radius for link ${n} in mm"]`); await r.fill('40'); await r.press('Tab'); await page.waitForTimeout(200); }
    await panel.locator('button', { hasText: 'counterweights' }).first().click(); await page.waitForTimeout(500);
    t = await llPanelText(page);
    const r40 = { m2: panelRow(t, ' link 2'), m4: panelRow(t, ' link 4'), torque: panelRow(t, 'Input torque (N·m)'), joint: panelRow(t, 'Joint force (N)') };
    console.log('  R = 40 mm:', JSON.stringify(r40));
    expect(near(r40.m2[0], 0.0504) && near(r40.m4[0], 0.1234) && near(r40.torque[1], 0.05009) && near(r40.joint[1], 3.834), `R = 40: ${JSON.stringify(r40)}`);
    expect(!page.errors.length, `errors in the page: ${page.errors.join('; ')}`);
    await page.close();
  },

  /** LinkLab 5: tolerance (docs/tutorial/linklab-5-tolerance.md) */
  async 'linklab-5'(browser) {
    const page = await openFourbar(browser, { tab: 'tolerance' });
    const panel = page.locator('#side-body');
    await llAngle(page, 60);
    // step 1: 3D print clearance, output = link 4 angle
    await panel.locator('select[aria-label="Typical clearances"]').selectOption({ label: '3D print (FDM): 0.300 mm' }); await page.waitForTimeout(400);
    let t = await llPanelText(page);
    const play = panelNumber(t, 'Play here: ±'), largest = panelNumber(t, 'Largest play: ±'), at = (t.match(/Largest play: ±[\d.]+° at θ₂ = ([\d.]+)°/) || [])[1];
    console.log('  play here:', play, '| largest:', largest, 'at', at);
    expect(near(play, 0.59) && near(largest, 0.97) && (near(+at, 0) || near(+at, 360)), `play ${play}, largest ${largest} at ${at}; expected 0.59°, 0.97° at θ₂ = 0°`);
    await shot(page, 'linklab-5-play');
    // step 2: push by hand
    await page.keyboard.press('v');
    const grab = await llScreen(page, { x: 48.5, y: 44.1 });
    await page.mouse.move(grab.x, grab.y); await page.mouse.down(); await page.mouse.move(grab.x - 40, grab.y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
    t = await llPanelText(page);
    const pushed = parseFloat(((t.match(/Pushed by hand: ([−+\-\d.]+)°/) || [])[1] || 'NaN').replace('−', '-').replace('+', ''));
    console.log('  pushed by hand:', pushed);
    expect(Number.isFinite(pushed) && Math.abs(pushed) > 0 && Math.abs(pushed) <= play * 1.001, `pushed ${pushed}, play ${play}`);
    await shot(page, 'linklab-5-pushed');
    // step 3: under the load (dynamic) and knocks
    await page.locator('.side-tab', { hasText: 'Forces' }).click(); await page.waitForTimeout(300);
    await panel.locator('button', { hasText: 'Dynamic' }).first().click(); await page.waitForTimeout(400);
    await page.locator('.side-tab', { hasText: 'Tolerance' }).click(); await page.waitForTimeout(600);
    t = await llPanelText(page);
    const under = panelNumber(t, 'Under the load:'), knocks = (t.match(/Knocks (\d+|once) times? a cycle|Knocks once a cycle|No knock/) || [''])[0];
    console.log('  under the load:', under, '|', knocks);
    expect(Number.isFinite(under) && /Knocks/.test(knocks), `under the load ${under}, ${knocks}`);
    page.knocks = knocks;
    await page.getByRole('button', { name: 'Plots' }).click(); await page.waitForTimeout(400);
    await page.locator('select[aria-label="Plot preset"]').selectOption({ label: 'Preset: Tolerance' }); await page.waitForTimeout(500);
    await page.keyboard.press('f');
    await shot(page, 'linklab-5-knocks');
    // step 4: which pin to improve: a ball bearing on J1
    await panel.locator('summary', { hasText: 'Pins that differ' }).click(); await page.waitForTimeout(300);
    const j1 = panel.locator('input[aria-label="Clearance of J1 in mm"]');
    await j1.fill('0.01'); await j1.press('Tab'); await page.waitForTimeout(400);
    t = await llPanelText(page);
    const play2 = panelNumber(t, 'Play here: ±');
    console.log('  with a bearing at J1:', play2);
    expect(play2 < play, `play with a bearing at J1: ${play2}`);
    page.play2 = play2;
    expect(!page.errors.length, `errors in the page: ${page.errors.join('; ')}`);
    await page.close();
  },

  /** LinkLab 6: export (docs/tutorial/linklab-6-export.md) */
  async 'linklab-6'(browser) {
    const page = await openFourbar(browser, { mode: 'basic' });
    await llAngle(page, 60);
    await page.getByRole('button', { name: 'Export for CAD (DXF), picture or data' }).click(); await page.waitForTimeout(400);
    const dlg = page.locator('dialog[open]');
    await shot(page, 'linklab-6-export');
    /** Click an export button and read what it downloads (text). */
    const download = async (name) => {
      if (!(await dlg.count())) { await page.getByRole('button', { name: 'Export for CAD (DXF), picture or data' }).click(); await page.waitForTimeout(300); }
      const [dl] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name, exact: true }).click()]);
      await page.waitForTimeout(300);   // the window closes itself
      const file = await dl.path();
      return { name: dl.suggestedFilename(), bytes: fs.readFileSync(file) };
    };
    // the layout DXF: one file, mm, with the four joints as circles and the links as lines
    const dxf = await download('Export layout');
    const text = dxf.bytes.toString('latin1');
    console.log('  layout:', dxf.name, dxf.bytes.length, 'bytes');
    expect(/\.dxf$/i.test(dxf.name) && /SECTION/.test(text) && /ENTITIES/.test(text), 'the layout is not a DXF file');
    const layers = [...new Set([...text.matchAll(/\r?\n *8\r?\n([^\r\n]+)/g)].map((m) => m[1].trim()))];
    console.log('  layers:', layers.join(', '));
    expect(layers.length >= 2, 'the DXF has fewer than two layers');
    // the parameters CSV: link lengths at this position
    const csv = await download('Export CSV');
    const ctext = csv.bytes.toString('utf8');
    console.log('  csv:', csv.name, ctext.split('\n').length, 'lines');
    const lines = ctext.replace(/\r/g, '').split('\n');
    const from = lines.indexOf('LINKS (link 1 is the ground)') + 2;
    const links = lines.slice(from, lines.indexOf('', from)).map((l) => l.split(','));
    const len = Object.fromEntries(links.map((r) => [r[0], r[3] === '' ? null : +r[3]]));
    console.log('  link lengths in the CSV:', JSON.stringify(len));
    expect(near(len[2], 40) && len[3] === null && near(len[4], 80) && near(len[1], 100), `link lengths ${JSON.stringify(len)}`);
    const j3 = lines.find((l) => l.startsWith('J3,')).split(',');
    expect(near(+j3[4], 20) && near(+j3[5], 34.641), `J3 in the CSV: ${j3.slice(4, 6)}`);
    // the parts zip: one DXF per link
    const zip = await download('Export parts');
    console.log('  parts:', zip.name, zip.bytes.length, 'bytes');
    expect(/\.zip$/i.test(zip.name) && zip.bytes[0] === 0x50 && zip.bytes[1] === 0x4b, 'the parts file is not a zip');
    const names = [...zip.bytes.toString('latin1').matchAll(/[\w\-]+\.(dxf|txt|md|xyz|csv)/g)].map((m) => m[0]);
    console.log('  in the zip:', [...new Set(names)].join(', '));
    expect(names.filter((n) => /\.dxf$/.test(n)).length >= 4, 'fewer than four DXF files in the parts zip');
    page.zipNames = [...new Set(names)];
    expect(!page.errors.length, `errors in the page: ${page.errors.join('; ')}`);
    await page.close();
  },

  /** CamLab 1: your first cam (docs/tutorial/camlab-1-first-cam.md) */
  async 'camlab-1'(browser) {
    const page = await openApp(browser, 'CamLab.html', { 'camlab.mode': 'basic' });
    await page.getByRole('button', { name: 'New cam design', exact: true }).click();
    await page.waitForTimeout(3200);   // let the notice fade
    const peaks = async () => {
      const t = await page.locator('body').innerText();
      const val = (re) => { const m = t.match(re); return m ? (m[1] === '∞' ? Infinity : parseFloat(m[1].replace('−', '-'))) : NaN; };
      return { v: val(/Velocity v\s+([∞\d.]+)/), a: val(/Acceleration a\s+([∞\d.]+)/), j: val(/Jerk j\s+([∞\d.]+)/),
        law: (t.match(/Fundamental law of cam design\s*\n\s*([^\n]+)/) || [, ''])[1] };
    };
    /** Set the motion law of segment i (1-based) by its name in the list. */
    const setLaw = async (i, name) => {
      const sel = page.locator('.segs').locator(':scope > *').nth(i - 1).locator('.seg-law select');
      await sel.selectOption({ label: name });
      await page.waitForTimeout(300);
    };
    // step 1-3: the new design is a double dwell, cycloidal rise and fall
    let p = await peaks();
    console.log('  cycloidal:', JSON.stringify(p));
    expect(near(p.v, 200.0) && near(p.a, 2513) && near(p.j, 63165) && /^Met/.test(p.law), `cycloidal peaks ${JSON.stringify(p)}`);
    await shot(page, 'camlab-1-new');

    // step 4: simple harmonic rise and fall
    await setLaw(2, 'Simple harmonic'); await setLaw(4, 'Simple harmonic');
    p = await peaks();
    console.log('  simple harmonic:', JSON.stringify(p));
    expect(near(p.v, 157.1) && near(p.a, 1974) && p.j === Infinity && /^Broken/.test(p.law), `simple harmonic peaks ${JSON.stringify(p)}`);
    await shot(page, 'camlab-1-harmonic');

    // exercise: 3-4-5 polynomial
    await setLaw(2, '3-4-5 polynomial'); await setLaw(4, '3-4-5 polynomial');
    p = await peaks();
    console.log('  3-4-5 polynomial:', JSON.stringify(p));
    expect(near(p.v, 187.5) && near(p.a, 2309) && near(p.j, 96000) && /^Met/.test(p.law), `3-4-5 polynomial peaks ${JSON.stringify(p)}`);
    expect(!page.errors.length, `errors in the page: ${page.errors.join('; ')}`);
    await page.close();
  },

  /** CamLab 2: sizing (docs/tutorial/camlab-2-sizing.md) */
  async 'camlab-2'(browser) {
    const page = await openApp(browser, 'CamLab.html', { 'camlab.mode': 'advanced' });
    await page.getByRole('button', { name: 'New cam design', exact: true }).click(); await page.waitForTimeout(3200);
    await page.locator('select[aria-label="Plots beside the cam"]').selectOption({ label: 'Size: pressure angle, ρ' }); await page.waitForTimeout(400);
    const size = async () => { const t = await page.locator('body').innerText(); return { phi: panelNumber(t, 'Pressure angle, largest'), rho: panelNumber(t, 'ρ min, pitch curve (convex)'), surf: panelNumber(t, 'ρ min, cam surface (= ρ − Rf)'), verdict: (t.match(/Size\n([^\n]+)/) || [])[1] }; };
    let z = await size(); console.log('  Rp 75:', JSON.stringify(z));
    expect(near(z.phi, 20.14) && near(z.rho, 59.49) && near(z.surf, 46.99) && /fine/.test(z.verdict), `Rp 75: ${JSON.stringify(z)}`);
    await shot(page, 'camlab-2-rp75');
    const rp = page.locator('input[aria-label="Prime circle Rp (mm)"]');
    await rp.fill('50'); await rp.press('Tab'); await page.waitForTimeout(400);
    z = await size(); console.log('  Rp 50:', JSON.stringify(z));
    expect(near(z.phi, 27.37) && near(z.rho, 39.51) && near(z.surf, 27.01), `Rp 50: ${JSON.stringify(z)}`);
    await shot(page, 'camlab-2-rp50');
    await rp.fill('30'); await rp.press('Tab'); await page.waitForTimeout(400);
    z = await size(); console.log('  Rp 30:', JSON.stringify(z));
    expect(z.phi > 30 && !/fine/.test(z.verdict), `Rp 30 should be flagged: ${JSON.stringify(z)}`);
    page.rp30 = z;
    await shot(page, 'camlab-2-rp30');
    expect(!page.errors.length, `errors in the page: ${page.errors.join('; ')}`);
    await page.close();
  },

  /** CamLab 3: dynamics (docs/tutorial/camlab-3-dynamics.md) */
  async 'camlab-3'(browser) {
    const page = await openApp(browser, 'CamLab.html', { 'camlab.mode': 'advanced' });
    await page.getByRole('button', { name: 'New cam design', exact: true }).click(); await page.waitForTimeout(3200);
    await page.locator('summary', { hasText: 'Spring and follower mass' }).click(); await page.waitForTimeout(300);
    await page.locator('select[aria-label="Plots beside the cam"]').selectOption({ label: 'Forces: Fc, torque' }); await page.waitForTimeout(400);
    const dyn = async () => { const t = await page.locator('body').innerText(); return { verdict: (t.match(/Spring and forces\n([^\n]+)/) || [])[1], c: panelNumber(t, 'Damping c = 2ζ√(km)'), wn: panelNumber(t, 'Natural frequency ωn'), Fmax: panelNumber(t, 'Cam force, largest'), Fmin: panelNumber(t, 'Cam force, smallest'), T: (t.match(/Camshaft torque\s+([−\-\d.]+) … ([−\-\d.]+)/) || []).slice(1).map((v) => parseFloat(v.replace('−', '-'))) }; };
    let z = await dyn(); console.log('  60 rpm:', JSON.stringify(z));
    expect(/stays on/.test(z.verdict) && near(z.c, 0.012) && near(z.wn, 100) && near(z.Fmax, 300) && near(z.Fmin, 50) && near(z.T[0], -6.327) && near(z.T[1], 6.453), `60 rpm: ${JSON.stringify(z)}`);
    await shot(page, 'camlab-3-60rpm');
    const rpm = page.locator('input[aria-label="or (rpm)"]');
    await rpm.fill('600'); await rpm.press('Tab'); await page.waitForTimeout(400);
    z = await dyn(); console.log('  600 rpm:', JSON.stringify(z));
    expect(/stays on/.test(z.verdict) && near(z.Fmin, 7.6, 0.02), `600 rpm: ${JSON.stringify(z)}`);
    await rpm.fill('900'); await rpm.press('Tab'); await page.waitForTimeout(400);
    z = await dyn(); console.log('  900 rpm:', JSON.stringify(z));
    expect(!/stays on/.test(z.verdict) && near(z.Fmin, -309.4, 0.01), `900 rpm: ${JSON.stringify(z)}`);
    await shot(page, 'camlab-3-900rpm');
    // exercise: more preload keeps it on at 900 rpm
    const pre = page.locator('input[aria-label="Preload Fpl (N)"]');
    await pre.fill('400'); await pre.press('Tab'); await page.waitForTimeout(400);
    z = await dyn(); console.log('  900 rpm, preload 400 N:', JSON.stringify(z));
    expect(/stays on/.test(z.verdict) && near(z.Fmin, 40.6, 0.02), `preload 400: ${JSON.stringify(z)}`);
    expect(!page.errors.length, `errors in the page: ${page.errors.join('; ')}`);
    await page.close();
  },

  /** CamLab 4: export (docs/tutorial/camlab-4-export.md) */
  async 'camlab-4'(browser) {
    const page = await openApp(browser, 'CamLab.html', { 'camlab.mode': 'advanced' });
    await page.getByRole('button', { name: 'New cam design', exact: true }).click(); await page.waitForTimeout(3200);
    await page.locator('summary', { hasText: 'Part and mounting' }).click(); await page.waitForTimeout(300);
    await page.locator('select[aria-label="How the cam fixes to its shaft"]').selectOption({ label: 'Hub with set screw' }); await page.waitForTimeout(400);
    await page.locator('select[aria-label="Plots beside the cam"]').selectOption({ label: 'Motion: s, v, a, j' }).catch(() => {});
    await page.locator('.topbar button', { hasText: /^Cam$/ }).first().click().catch(() => {});
    await shot(page, 'camlab-4-mounting');
    await page.getByRole('button', { name: /Export the cam/ }).click(); await page.waitForTimeout(400);
    await shot(page, 'camlab-4-export');
    const download = async (label) => {
      const dlg = page.locator('dialog[open]');
      if (!(await dlg.count())) { await page.getByRole('button', { name: /Export the cam/ }).click(); await page.waitForTimeout(300); }
      const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('dialog[open] button', { hasText: label }).first().click()]);
      await page.waitForTimeout(300);
      return { name: dl.suggestedFilename(), bytes: fs.readFileSync(await dl.path()) };
    };
    const stl = await download('Download .stl');
    console.log('  stl:', stl.name, stl.bytes.length, 'bytes');
    expect(/\.stl$/i.test(stl.name) && stl.bytes.length > 10000, 'no STL');
    const tri = stl.bytes.length >= 84 ? stl.bytes.readUInt32LE(80) : 0;
    console.log('  triangles:', tri, '| size matches:', 84 + 50 * tri === stl.bytes.length);
    expect(84 + 50 * tri === stl.bytes.length, 'the STL is not a well-formed binary STL');
    const dxf = await download('Download .dxf');
    const text = dxf.bytes.toString('latin1');
    const layers = [...new Set([...text.matchAll(/\r?\n *8\r?\n([^\r\n]+)/g)].map((m) => m[1].trim()))];
    console.log('  dxf:', dxf.name, dxf.bytes.length, 'bytes | layers:', layers.join(', '));
    expect(layers.includes('CAM') && /SPLINE/.test(text), 'the DXF has no CAM spline');
    const pts = await download('.txt');
    const rows = pts.bytes.toString('utf8').trim().split(/\r?\n/);
    console.log('  points:', pts.name, rows.length, 'rows; first:', rows[0]);
    expect(rows.length === 720, `expected 720 points, got ${rows.length}`);
    const radii = rows.map((r) => { const [x, y] = r.trim().split(/[\s,]+/).map(Number); return Math.hypot(x, y); });
    console.log('  radius min/max:', Math.min(...radii).toFixed(2), Math.max(...radii).toFixed(2));
    expect(near(Math.min(...radii), 62.5, 0.01) && near(Math.max(...radii), 87.5, 0.01), 'profile radii should run from Rb = 62.5 to Rb + h = 87.5 mm');
    const csv = await download('Download .csv');
    const head = csv.bytes.toString('utf8').split(/\r?\n/)[0];
    console.log('  data csv header:', head);
    expect(/theta|θ/i.test(head) && /pressure/i.test(head), 'the data CSV header changed');
    expect(!page.errors.length, `errors in the page: ${page.errors.join('; ')}`);
    await page.close();
  },
};

const browser = await launch();
try {
  for (const [name, run] of Object.entries(LESSONS)) {
    if (only.length && !only.includes(name)) continue;
    console.log(name);
    await run(browser);
  }
} finally {
  await browser.close();
}
