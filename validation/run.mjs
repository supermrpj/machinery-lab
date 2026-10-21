// =============================================================================
// run.mjs — check LinkLab's general solver against textbook worked examples
// -----------------------------------------------------------------------------
//   npm run validate
// Reads every JSON case in validation/cases/ (see README.md for the format),
// builds the mechanism, solves it with the GENERAL solver (not the closed-form
// equations) and compares with the book's answers.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFourbar, makeSliderCrank } from '../apps/linklab/tests/helpers.js';
import { buildSystem, designCoordinates, analyzePose, poseResults } from '../apps/linklab/src/kinematics/index.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cases');
const DEG = Math.PI / 180;
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];
let failed = 0, checked = 0;

const wrapDeg = (x) => ((((x + 180) % 360) + 360) % 360) - 180;

for (const f of files) {
  const c = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const tol = { angle_deg: 0.01, relative: 1e-3, ...(c.tolerance || {}) };
  for (const assembly of Object.keys(c.expect)) {
    const inp = c.input;
    const th2 = inp.theta2_deg * DEG;
    const built = c.type === 'fourbar'
      ? makeFourbar({ ...inp, theta2: th2, assembly })
      : makeSliderCrank({ ...inp, theta2: th2, assembly });
    const doc = built.doc;
    const sys = buildSystem(doc);
    const q = designCoordinates(sys);
    const { qd, qdd } = analyzePose(sys, q, sys.driver.thetaDesign, inp.omega2 || 0, inp.alpha2 || 0);
    const r = poseResults(sys, doc, q, qd, qdd);
    const L3 = r.links.get(doc.links[1].id);
    const got = { theta3_deg: L3.theta / DEG, omega3: L3.omega, alpha3: L3.alpha };
    if (c.type === 'fourbar') {
      const L4 = r.links.get(doc.links[2].id);
      Object.assign(got, { theta4_deg: L4.theta / DEG, omega4: L4.omega, alpha4: L4.alpha });
    } else {
      const B = r.joints.get(doc.sliders[0].joint);
      got.theta3_deg += 180; // Norton measures link 3 from B to A
      Object.assign(got, { d: B.pos.x, vd: B.vel.x, ad: B.acc.x });
    }
    for (const [key, want] of Object.entries(c.expect[assembly])) {
      checked++;
      const v = got[key];
      const ok = key.endsWith('_deg')
        ? Math.abs(wrapDeg(v - want)) <= tol.angle_deg
        : Math.abs(v - want) <= tol.relative * Math.max(1, Math.abs(want));
      if (!ok) failed++;
      console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.source}  ${assembly}  ${key}: got ${v.toFixed(4)}, book ${want}`);
    }
  }
}
console.log(`\n${checked} values checked from ${files.length} case(s), ${failed} failed.`);
if (files.length === 0) console.log('No cases yet. See validation/README.md to add textbook examples.');
process.exit(failed ? 1 : 0);
