// =============================================================================
// simulation.js — the moving state of the mechanism
// -----------------------------------------------------------------------------
// Holds the solved pose (q, θ), the full-cycle sweep used by plots and coupler
// curves, and the operations the interface needs: move the input, drag a link
// by hand, and "bake" the current pose back into the document before editing.
// The document itself always describes the design pose.
// =============================================================================

import {
  buildSystem, designCoordinates, solvePosition, stepInput, analyzePose, poseResults,
  numericDOF, gruebler, classify, sweep, sweepPath, linkTransform, pointOnBody, lengthScale,
  coordScale, onePath, startTangent, tangent, inputRate, pathStep, moveInput, travel, poseDistance, extremeFraction,
} from '../kinematics/index.js';
import { transformEntity } from './construction.js';
import { currentOutput, readOutput } from './outputs.js';
import { wrapPi } from '../../../../packages/core-math/src/index.js';
import { PATH, KINEMATICS } from '../config.js';

export class Simulation {
  constructor() { this.reset(null); }

  /** Rebuild everything from a document (call after every edit). */
  reset(doc) {
    this.doc = doc;
    this.sweepCache = null;
    // draft: set by the app while a joint is dragged, so the whole-cycle sweep
    // (plots, coupler curves, forces over the cycle) is coarser and quick
    if (this.draft === undefined) this.draft = false;
    this._masses = null; // mass properties, recomputed after every edit (model/forces.js)
    if (!doc || doc.links.length === 0) {
      Object.assign(this, { sys: null, q: [], theta: 0, results: null, info: null, limitHit: false, tan: null, hold: null, special: null, path: false });
      return;
    }
    this.hold = null;      // a toggle or stationary position the drag is resting at
    this.special = null;   // { kind } when the pose is at a toggle or stationary position
    this.sys = buildSystem(doc);
    this.q = designCoordinates(this.sys);
    this.theta = this.sys.driver ? this.sys.driver.thetaDesign : 0;
    this.limitHit = false;
    // Check the drawing actually satisfies its constraints. If a student drew
    // a link that cannot close the loop (e.g. moved a joint off a slider
    // line), pull it together with the solver.
    const r = solvePosition(this.sys, this.q, this.theta, { withDriver: !!this.sys.driver });
    this.assembled = r.ok;
    if (r.ok) this.q = r.q;
    this.info = {
      gruebler: gruebler(doc),
      dof: numericDOF(this.sys, this.q),
      kind: classify(doc),
    };
    // one degree of freedom: the mechanism moves along a single path, which
    // we follow directly (path.js) — through toggle positions, without chatter
    this.path = this.assembled && onePath(this.sys, this.q);
    this.w = this.path ? coordScale(this.sys) : null;
    this.tan = this.path ? this._orient(startTangent(this.sys, this.q, this.w), 1) : null;
    this.refresh();
  }

  /** Tangent t turned so the input moves in direction sign (when it moves at all). */
  _orient(t, sign) {
    if (!t || !this.sys.driver) return t;
    const r = inputRate(this.sys, this.q, t);
    return r * sign < 0 ? t.map((v) => -v) : t;
  }

  /** Make the next animation frames move the input in direction sign (±1). */
  orientTravel(sign) {
    if (this.path && this.tan) this.tan = this._orient(this.tan, sign);
  }

  /** Characteristic size of the mechanism (mm). */
  get size() { return this.sys ? lengthScale(this.sys) : 1; }

  /** The output value (degrees for angles) at pose q, for finding stationary positions. */
  _outputAt(q) {
    const o = currentOutput(this.doc);
    if (!o) return NaN;
    const r = readOutput(this.doc, poseResults(this.sys, this.doc, q), o);
    return r ? r.value : NaN;
  }

  /** Mechanism can be driven by its input: exactly one degree of freedom. */
  get drivable() {
    return !!(this.sys && this.sys.driver && this.info && this.info.dof === 1 && this.assembled);
  }

  /**
   * +1, or −1 where the input is on its way back: an input that rocks between
   * two toggle positions turns back at each, so on the return half of its
   * cycle it moves at −ω (the sweep marks each sample with its dir). Uses the
   * sweep only once it has been computed.
   */
  travelSign() {
    const s = this.sweepCache;
    if (!this.path || !s || s.fullTurn || !s.closed) return 1;
    const i = this.nearestSampleIndex();
    return i >= 0 && s.samples[i].dir === -1 ? -1 : 1;
  }

  /** The input's speed at the current pose, with its sign: motor speed, Reverse, and the way it is travelling. */
  inputSpeed() {
    const m = this.doc.motion;
    return m.omega * (m.reverse ? -1 : 1) * this.travelSign();
  }

  /** Recompute velocities/accelerations at the current pose. */
  refresh() {
    if (!this.sys) { this.results = null; return; }
    const m = this.doc.motion;
    const sign = this.travelSign();
    const omega = m.omega * (m.reverse ? -1 : 1) * sign;
    const { qd, qdd } = this.drivable ? analyzePose(this.sys, this.q, this.theta, omega, m.alpha * sign) : { qd: null, qdd: null };
    this.qd = qd; this.qdd = qdd;
    this.results = poseResults(this.sys, this.doc, this.q, qd, qdd);
    const recent = this.passed && Date.now() < this.passed.until ? { kind: this.passed.kind } : null;
    // stopped by a limit while following the path = a toggle position
    const atLimit = this.path && this.limitHit ? { kind: 'toggle' } : null;
    this.special = this.hold ? { kind: this.hold.kind } : (this._nearSpecial() || atLimit || recent);
  }

  /**
   * Is the pose at a toggle or stationary position found by the sweep? Uses
   * the sweep only once it has been computed (never computes it here: this
   * runs on every frame).
   */
  _nearSpecial() {
    if (!this.path || !this.drivable) return null;
    const s = this.sweepCache;
    if (!s || !s.specials) return null;
    const tol = PATH.specialSnap * this.size;
    for (const sp of s.specials) {
      if (sp.kind === 'end') continue;
      if (poseDistance(this.sys, this.q, s.samples[sp.index].q, this.w) < tol) return { kind: sp.kind };
    }
    return null;
  }

  /** Is the mechanism away from the design pose? */
  get moved() {
    if (!this.sys) return false;
    const q0 = designCoordinates(this.sys);
    return this.q.some((v, k) => Math.abs(v - q0[k]) > 1e-9);
  }

  /**
   * Move the input by dθ (radians, or mm for a linear input). Follows the path,
   * so it stops exactly at a toggle position. Returns false if a limit stops it.
   */
  advance(dTheta) {
    if (!this.drivable) return false;
    this.hold = null;
    if (this.path && this.tan) {
      const sign = Math.sign(dTheta) || 1;
      // near a toggle the input hardly moves: keep going the way we were travelling
      const t = Math.abs(inputRate(this.sys, this.q, this.tan)) > 1e-9 ? this._orient(this.tan, sign) : this.tan;
      const r = moveInput(this.sys, this.q, t, this.theta + dTheta, this.w);
      this.q = r.q; this.theta = r.theta; this.tan = r.t;
      this.limitHit = r.limit;
      this.refresh();
      return !r.limit;
    }
    const r = stepInput(this.sys, this.q, this.theta, dTheta);
    this.q = r.q; this.theta = r.theta;
    this.limitHit = !r.ok;
    this.refresh();
    return r.ok;
  }

  /**
   * One animation frame: move along the path so the input changes by about
   * |dInput|, never faster than maxArc (× size). Toggle positions are passed
   * through — the input turns back and the mechanism flips to its other
   * assembly, as a real one does with momentum. A linear input turns back at
   * its stroke ends. Returns false if nothing could move.
   */
  run(dInput, maxArcFactor = PATH.animMaxStepPerFrame) {
    if (!this.drivable) return false;
    this.hold = null;
    if (!(this.path && this.tan)) {
      const ok = this.advance(dInput);
      return ok;
    }
    const range = this.sys.driver.unit === 'mm' ? this.sys.driver.range : null; // stroke ends
    const before = this.nearestSampleIndex();
    const r = travel(this.sys, this.q, this.tan, dInput, maxArcFactor * this.size, range, this.w);
    this.q = r.q; this.theta = r.theta; this.tan = r.t;
    this.limitHit = false;
    this._notePassed(before, this.nearestSampleIndex());
    this.refresh();
    return !r.stuck;
  }

  /**
   * While animating, a frame can jump over a toggle or stationary position;
   * remember it for a moment so the indicator is still seen.
   */
  _notePassed(i0, i1) {
    const s = this.sweepCache;
    if (!s || !s.specials || i0 < 0 || i1 < 0 || i0 === i1) return;
    const N = s.samples.length;
    let lo = i0, hi = i1;
    if (s.closed) {
      // the shorter way round the closed circuit
      const fwd = ((i1 - i0) % N + N) % N;
      if (fwd > N / 2) { lo = i1; hi = i1 + (N - fwd); } else { lo = i0; hi = i0 + fwd; }
    } else if (lo > hi) { [lo, hi] = [hi, lo]; }
    for (const sp of s.specials) {
      if (sp.kind === 'end') continue;
      for (const k of [sp.index, sp.index + N]) {
        if (k >= lo && k <= hi) { this.passed = { kind: sp.kind, until: Date.now() + 400 }; return; }
      }
    }
  }

  /**
   * The input value nearest to θ (radians or mm) that the mechanism can reach:
   * within a linear input's stroke, or between a rocking input's limit
   * positions (an angle is first taken whole turns nearer to that range).
   * θ itself for an input that turns fully, or when there is no sweep.
   */
  reachable(theta) {
    const s = this.drivable ? this.getSweep() : null;
    if (!s || s.fullTurn || !s.limits || s.limits.length < 2) return theta;
    const [lo, hi] = s.limits;
    if (this.inputIsAngle) { const mid = (lo + hi) / 2; theta = mid + wrapPi(theta - mid); }
    return Math.min(hi, Math.max(lo, theta));
  }

  /**
   * Move the input to an absolute value θ (radians or mm). Where the input
   * reaches θ twice (open and crossed assembly), the one on the current side
   * is chosen. A value the input cannot reach goes to the nearest one it can
   * (see reachable).
   */
  goTo(theta) {
    if (!this.drivable) return false;
    const s = this.getSweep();
    theta = this.reachable(theta);
    if (s && s.samples.length) {
      const dist = (smp) => (s.fullTurn ? Math.abs(wrapPi(smp.theta - theta)) : Math.abs(smp.theta - theta));
      let bd = Infinity;
      for (const smp of s.samples) bd = Math.min(bd, dist(smp));
      // among the samples nearest to θ, prefer the one closest to where we are
      const step = s.fullTurn || this.inputIsAngle ? Math.PI / 90 : (s.limits[1] - s.limits[0]) / 90;
      let best = null, bq = Infinity;
      for (const smp of s.samples) {
        if (dist(smp) > bd + step) continue;
        const d = this.path ? poseDistance(this.sys, smp.q, this.q, this.w) : 0;
        if (d < bq) { bq = d; best = smp; }
      }
      this._jumpTo(best);
      const target = s.fullTurn ? this.theta + wrapPi(theta - this.theta) : theta;
      return this.advance(target - this.theta);
    }
    return this.advance(this.inputIsAngle ? wrapPi(theta - this.theta) : theta - this.theta);
  }

  /** Index of the sweep sample nearest to the current pose (for plot cursors). */
  nearestSampleIndex() {
    const s = this.sweepCache;
    if (!s || !s.samples.length) return -1;
    let bi = -1, bd = Infinity;
    if (this.path) {
      for (let i = 0; i < s.samples.length; i++) {
        const d = poseDistance(this.sys, s.samples[i].q, this.q, this.w);
        if (d < bd) { bd = d; bi = i; }
      }
    } else {
      for (let i = 0; i < s.samples.length; i++) {
        const d = Math.abs(s.fullTurn ? wrapPi(s.samples[i].theta - this.theta) : s.samples[i].theta - this.theta);
        if (d < bd) { bd = d; bi = i; }
      }
    }
    return bi;
  }

  /** Go straight to sample i of the sweep (a click on a plot). */
  goToSample(i) {
    const s = this.getSweep();
    if (!s || !s.samples[i]) return;
    this._jumpTo(s.samples[i]);
    this.limitHit = false;
    this.refresh();
  }

  _jumpTo(smp) {
    this.passed = null;
    this.q = smp.q.slice(); this.theta = smp.theta;
    if (this.path) this.tan = smp.t ? smp.t.slice() : (tangent(this.sys, this.q, this.tan, this.w) || this.tan);
    this.hold = null;
  }

  /** True when the input is a motor (an angle); false for a linear input (mm). */
  get inputIsAngle() { return !this.sys || !this.sys.driver || this.sys.driver.unit === 'rad'; }

  /**
   * Drag a point of a link by hand. `bodyIndex` and local point `s` identify
   * the grabbed point; `target` is the cursor position (world mm).
   */
  dragTo(bodyIndex, s, target, opts = {}) {
    if (!this.sys) return;
    if (this.path && this.tan) { this._dragAlongPath(bodyIndex, s, target, opts); return; }
    const sys = this.sys;
    // Step 1: pull the grabbed point toward the cursor while keeping the
    // joints together (damped least squares, input released).
    const extra = (q) => {
      const P = pointOnBody(q, bodyIndex, s);
      const c = Math.cos(q[3 * bodyIndex + 2]), sn = Math.sin(q[3 * bodyIndex + 2]);
      const Bx = -sn * s.x - c * s.y, By = c * s.x - sn * s.y;
      const w = 0.05;
      const rx = new Array(sys.n).fill(0), ry = new Array(sys.n).fill(0);
      rx[3 * bodyIndex] = w; rx[3 * bodyIndex + 2] = w * Bx;
      ry[3 * bodyIndex + 1] = w; ry[3 * bodyIndex + 2] = w * By;
      return { F: [w * (P.x - target.x), w * (P.y - target.y)], J: [rx, ry] };
    };
    const r = solvePosition(sys, this.q, this.theta, { withDriver: false, extra });
    let q = r.q;
    // Step 2: if the mechanism has an input, read θ and solve exactly.
    if (sys.driver && this.drivable) {
      const theta = sys.driver.read(q); // the input value at the dragged position
      const exact = solvePosition(sys, q, theta);
      if (exact.ok) { this.q = exact.q; this.theta = theta; }
    } else {
      const exact = solvePosition(sys, q, this.theta, { withDriver: false });
      this.q = exact.q;
    }
    this.limitHit = false;
    this.refresh();
  }

  /**
   * Drag along the path: move the mechanism the way that brings the grabbed
   * point closest to the cursor. With opts.stopAtSpecial, it rests at a toggle
   * or stationary position until the cursor is pulled opts.release mm past it.
   */
  _dragAlongPath(bodyIndex, sLocal, target, { stopAtSpecial = false, release = 10 } = {}) {
    const sys = this.sys, w = this.w, L = this.size;
    const P = (q) => pointOnBody(q, bodyIndex, sLocal);
    const gap = (q) => { const p = P(q); return Math.hypot(p.x - target.x, p.y - target.y); };
    let ignoreFirst = false;
    if (this.hold) {
      if (gap(this.q) < release) { this.refresh(); return; } // keep resting there
      this.hold = null; ignoreFirst = true;                  // pulled past: let go
    }
    const hMax = PATH.maxStep * L, hMin = PATH.minStep * L * 10;
    const eps = 1e-4 * L;
    const slope = (q, t) => { const r = pathStep(sys, q, t, eps, w); return r.ok ? (gap(r.q) - gap(q)) / eps : 0; };
    let q = this.q, t = this.tan;
    if (slope(q, t) > 0) t = t.map((v) => -v);       // walk downhill
    const read = sys.driver ? (x) => sys.driver.read(x) : null;
    const out = (x) => this._outputAt(x);
    const o = currentOutput(this.doc);
    const outAngle = !!o && o.kind === 'angle';
    const rateOf = (fn, x, tt) => {
      const r = pathStep(sys, x, tt, eps, w);
      if (!r.ok) return 0;
      const d = fn(r.q) - fn(x);
      return fn === out && outAngle ? ((d + 540) % 360) - 180 : d; // output angles wrap at ±180°
    };
    let h = hMax, f0 = gap(q);
    for (let k = 0; k < 400 && h >= hMin; k++) {
      const r = pathStep(sys, q, t, h, w);
      if (!r.ok) { h /= 2; continue; }
      const f1 = gap(r.q);
      if (!(f1 < f0 - 1e-9 * L)) { h /= 2; continue; }
      if (stopAtSpecial && !ignoreFirst) {
        // did the input (toggle) or the output (stationary) turn back in this step?
        const checks = [];
        if (read) checks.push(['toggle', read]);
        if (Number.isFinite(out(q))) checks.push(['stationary', out]);
        for (const [kind, fn] of checks) {
          const a = rateOf(fn, q, t), b = rateOf(fn, r.q, r.t);
          if (a * b < 0) {
            const f = extremeFraction(sys, q, t, h, fn, a > 0 ? 'max' : 'min', w);
            const e = pathStep(sys, q, t, h * f, w);
            if (e.ok) { q = e.q; t = e.t; }
            this.hold = { kind };
            this._setPose(q, t);
            return;
          }
        }
      }
      ignoreFirst = false;
      q = r.q; t = r.t; f0 = f1;
      h = Math.min(h * 1.5, hMax);
    }
    this._setPose(q, t);
  }

  _setPose(q, t) {
    this.q = q; this.tan = t;
    if (this.sys.driver) this.theta = this.sys.driver.read(q);
    this.limitHit = false;
    this.refresh();
  }

  /** Full-cycle analysis (cached until the next edit or speed change). */
  getSweep() {
    if (!this.drivable) return null;
    if (!this.sweepCache) {
      const m = this.doc.motion;
      const omega = m.omega * (m.reverse ? -1 : 1);
      const q0 = designCoordinates(this.sys);
      const start = solvePosition(this.sys, q0, this.sys.driver.thetaDesign);
      const o = currentOutput(this.doc);
      const isAngle = o && o.kind === 'angle';
      this.sweepCache = (this.path && start.ok && sweepPath(this.sys, this.doc, start.q, this.sys.driver.thetaDesign, omega, m.alpha, {
        output: o ? (res) => { const v = readOutput(this.doc, res, o); return v ? v.value : NaN; } : null,
        outputAngle: isAngle,
        stepDeg: this.draft ? KINEMATICS.dragSweepStepDeg : undefined,
        draft: this.draft,
      })) || sweep(this.sys, this.doc, start.q, this.sys.driver.thetaDesign, omega, m.alpha, this.draft ? KINEMATICS.dragSweepStepDeg : undefined);
      // how far the input has travelled along the cycle at each sample (for
      // time in load profiles: t = travel / |input speed|)
      let cum = 0;
      this.sweepCache.samples.forEach((smp, k, all) => { if (k) cum += Math.abs(smp.theta - all[k - 1].theta); smp.travel = cum; });
      this.sweepCache.travel = cum;
    }
    return this.sweepCache;
  }

  invalidateSweep() { this.sweepCache = null; }

  /** Transform for drawings attached to a link at the current pose. */
  transformFor(linkId) {
    if (!this.sys || linkId === null || linkId === undefined) return null;
    const i = this.sys.bodyIndex.get(linkId);
    if (i === undefined) return null;
    return { T: linkTransform(this.sys, this.q, linkId), dphi: this.q[3 * i + 2] };
  }

  /** Current world position of a joint. */
  jointPos(jointId) {
    const r = this.results && this.results.joints.get(jointId);
    if (r) return r.pos;
    const j = this.doc && this.doc.joints.find((x) => x.id === jointId);
    return j ? { x: j.x, y: j.y } : null;
  }

  /**
   * Write the current pose into the document (so editing happens on what the
   * student sees). Must be called on a document copy that is about to change.
   */
  bakeInto(doc) {
    if (!this.sys || !this.moved || doc !== this.doc) return;
    for (const j of doc.joints) {
      const p = this.jointPos(j.id);
      if (p) { j.x = p.x; j.y = p.y; }
    }
    const move = (item, fn) => {
      const t = this.transformFor(item.attach);
      if (t) fn(t);
    };
    doc.construction = doc.construction.map((e) => {
      const t = this.transformFor(e.attach);
      return t ? transformEntity(e, t.T, t.dphi) : e;
    });
    for (const b of doc.bodies) move(b, (t) => { b.pts = b.pts.map(t.T); });
    // rails and sliding axes carried by a moving link move with it
    for (const s of doc.sliders) {
      const t = this.transformFor(s.on);
      if (t) { s.a = t.T(s.a); s.b = t.T(s.b); }
    }
    // loads and typed centres of mass are fixed to their links
    for (const f of doc.loads || []) {
      const t = this.transformFor(f.link);
      if (!t) continue;
      f.at = t.T(f.at);
      if (f.follow && f.F) { const c = Math.cos(t.dphi), s = Math.sin(t.dphi); f.F = { x: c * f.F.x - s * f.F.y, y: s * f.F.x + c * f.F.y }; }
    }
    for (const l of doc.links) {
      if (!l.mass || !l.mass.cg) continue;
      const t = this.transformFor(l.id);
      if (t) l.mass.cg = t.T(l.mass.cg);
    }
    for (const p of doc.pairs) {
      if (p.type !== 'prismatic') continue;
      const t = p.guide ? this.transformFor(p.guide) : null;
      if (t) { p.a = t.T(p.a); p.b = t.T(p.b); }
      else {
        // fixed guide: keep the axis, but move its reference point with the slider
        const ts = this.transformFor(p.slider);
        if (ts) { const a2 = ts.T(p.a); const d = { x: a2.x - p.a.x, y: a2.y - p.a.y }; p.a = a2; p.b = { x: p.b.x + d.x, y: p.b.y + d.y }; }
      }
    }
  }
}

