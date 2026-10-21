// =============================================================================
// analysis.js — everything the views and checks need, from one document
// -----------------------------------------------------------------------------
// analyse(doc) → {
//   prep, samples      the program and its values over one turn (per radian)
//   time               the same in time units at ω (mm/s, mm/s², mm/s³)
//   law                fundamental-law check (program.js check)
//   peaks              largest |s|, |v|, |a|, |j| in time units, with angles
//   segments           per rise/fall: its peak factors V·β/h, A·β²/h, J·β³/h
//   shape              cam curves and the size checks (geometry.js camShape)
//   forces             spring force and torque (dynamics.js camForces), and
//                      forces.spikes: where v jumps, a is infinite, so Fc and
//                      Tc are too: [{ at, F, T }] with the sign of each spike
//                      (F: the way v jumps; T: the way the kinetic energy
//                      jumps, v²; 0 = both ways)
//   stroke             largest rise above the start
//   mount              the bore and mounting, with its fit checks (mounting.js)
// }
// =============================================================================

import { prepare, sample, check, peaks, toTime, evaluate } from './program.js';
import { camShape } from './geometry.js';
import { camForces } from './dynamics.js';
import { mounting } from './mounting.js';
import { unitsOf } from './units.js';
import { SAMPLING } from '../config.js';

const DEG = Math.PI / 180;

export function analyse(doc) {
  const prep = prepare(doc.program);
  const samples = sample(prep, SAMPLING.pointsPerTurn);
  const omega = doc.motion.omega;
  const time = samples.map((sm) => ({ ...toTime(sm, omega), deg: sm.deg, segment: sm.segment }));
  const law = check(prep);
  const pk = peaks(time);
  const sMin = Math.min(...samples.map((x) => x.s)), sMax = Math.max(...samples.map((x) => x.s));
  // per segment: peak factors as in Table 8-3 (V·β/h, A·β²/h, J·β³/h)
  const segments = prep.segments.map((sg, i) => {
    const rows = samples.filter((x) => x.segment === i);
    const mx = (k) => Math.max(0, ...rows.map((x) => Math.abs(x[k])));
    const lift = sg.kind === 'poly' ? Math.max(...rows.map((x) => Math.abs(x.s - sg.s0))) : Math.abs(sg.s1 - sg.s0);
    const b = sg.beta * DEG;
    return {
      index: i, kind: sg.kind, law: sg.law, beta: sg.beta, start: sg.start, lift,
      factors: lift > 0 ? { v: (mx('v') * b) / lift, a: (mx('a') * b * b) / lift, j: (mx('j') * b ** 3) / lift } : null,
    };
  });
  const follower = doc.follower;
  const shape = camShape(follower, samples);
  const forces = camForces({ ...doc.dynamics, omega }, samples);
  // the samples are finite on both sides of a jump in v: the infinite force there is found from the jumps
  forces.spikes = doc.dynamics.m > 0 ? law.joins.filter((j) => j.s || j.v).map((j) => {
    const e = 1e-6, b = evaluate(prep, (j.at - e + 360) % 360), a = evaluate(prep, (j.at + e) % 360);
    return { at: ((j.at % 360) + 360) % 360, F: j.s ? 0 : Math.sign(a.v - b.v), T: j.s ? 0 : Math.sign(a.v * a.v - b.v * b.v) };
  }) : [];
  // sizes that cannot make a cam, and other things that make the results misleading
  const problems = [...prep.problems];
  const roller = follower.type !== 'flat';
  if (roller && !(follower.Rp > Math.abs(follower.e || 0))) problems.push({ kind: 'size', text: 'The prime circle Rp must be larger than the eccentricity ε.' });
  if (roller && !(follower.Rp > (follower.Rf || 0))) problems.push({ kind: 'size', text: 'The roller must be smaller than the prime circle (base circle Rb = Rp − Rf must be above 0).' });
  if (!roller && !(follower.Rb > 0)) problems.push({ kind: 'size', text: 'The base circle Rb must be above 0.' });
  if (sMin < -1e-9) problems.push({ kind: 'below', text: 'The follower goes below where it starts (s < 0), so it comes inside the prime circle. Start the program at the lowest position.' });
  const valid = shape.surface.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!valid) problems.push({ kind: 'shape', text: 'The cam shape cannot be worked out with these sizes.' });
  // smallest distance from the centre to the cam surface (the bore must fit inside it)
  const rMin = Math.min(...shape.surface.map((p) => Math.hypot(p.x, p.y)));
  const U = unitsOf(doc);
  const mount = mounting(doc.part, rMin, (v) => `${+U.L.show(v).toPrecision(4)} ${U.L.label}`);
  return { prep, samples, time, law, peaks: pk, segments, shape, forces, stroke: sMax - sMin, sMin, sMax, omega, problems, valid, rMin, mount };
}
