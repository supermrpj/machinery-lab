// =============================================================================
// A rocking input: it turns back at its two toggle positions, so on the way
// back it moves at −ω and every velocity has the other sign. Checked against
// the motion itself: ω₄ must equal dθ₄/dt along the cycle on both halves.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoDriver } from '../src/model/document.js';
import { Simulation } from '../src/model/simulation.js';
import { makeFourbar } from './helpers.js';

const DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function simOf(doc, motion = {}) {
  autoDriver(doc);
  Object.assign(doc.motion, motion);
  const s = new Simulation();
  s.reset(doc);
  return s;
}

/** Largest gap between the plotted ω₄ and dθ₄/dt along the cycle (central differences). */
function worstGap(s, doc) {
  const sw = s.getSweep(), L4 = doc.links[2].id, w = Math.abs(doc.motion.omega);
  let worst = 0, n = 0;
  for (let i = 1; i < sw.samples.length - 1; i++) {
    const a = sw.samples[i - 1], b = sw.samples[i + 1], m = sw.samples[i];
    if (a.special || b.special || m.special) continue;
    const dt = (b.travel - a.travel) / w; // time between the two samples at the input speed
    if (!(dt > 0)) continue;
    const rate = wrap(b.results.links.get(L4).theta - a.results.links.get(L4).theta) / dt;
    const got = m.results.links.get(L4).omega;
    if (Math.abs(got) > 30) continue; // next to a toggle the velocity grows without bound
    worst = Math.max(worst, Math.abs(rate - got) / (1 + Math.abs(got)));
    n++;
  }
  return { worst, n };
}

test('rocking input: velocities follow the way the input moves, out and back', () => {
  const { doc } = makeFourbar({ a: 80, b: 60, c: 70, d: 100, theta2: 80 * DEG });
  const s = simOf(doc);
  const sw = s.getSweep();
  assert.ok(sw.closed && !sw.fullTurn, 'a rocking input');
  const dirs = new Set(sw.samples.map((x) => x.dir));
  assert.ok(dirs.has(1) && dirs.has(-1), 'out (+) and back (−) halves');
  const { worst, n } = worstGap(s, doc);
  assert.ok(n > 100, `checked ${n} samples`);
  assert.ok(worst < 0.02, `ω₄ against dθ₄/dt: worst relative gap ${worst}`);
  // the input link itself turns at +ω out and −ω back
  const L2 = doc.links[0].id;
  for (const x of sw.samples) if (!x.special) assert.equal(Math.sign(x.results.links.get(L2).omega), x.dir);
});

test('a crank turns one way: every sample at +ω, as before', () => {
  const { doc } = makeFourbar({ a: 40, b: 120, c: 80, d: 100, theta2: 1 });
  const s = simOf(doc);
  const sw = s.getSweep();
  assert.ok(sw.fullTurn);
  assert.ok(sw.samples.every((x) => x.dir === 1));
  assert.ok(worstGap(s, doc).worst < 0.02);
});

test('the live pose: past a toggle the readouts carry the other sign', () => {
  const { doc } = makeFourbar({ a: 80, b: 60, c: 70, d: 100, theta2: 80 * DEG });
  const s = simOf(doc);
  const sw = s.getSweep();
  const back = sw.samples.findIndex((x) => x.dir === -1 && !x.special);
  s.goToSample(back + 5);
  assert.equal(s.travelSign(), -1);
  assert.equal(Math.sign(s.inputSpeed()), -1);
  const L2 = doc.links[0].id;
  assert.ok(s.results.links.get(L2).omega < 0, 'the input link turns back');
  s.goToSample(3);
  assert.equal(s.travelSign(), 1);
});
