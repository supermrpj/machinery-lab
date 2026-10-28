// =============================================================================
// app.js — the LinkLab controller
// -----------------------------------------------------------------------------
// Owns the document, undo history, simulation, view and current tool, and
// connects them to the canvas and panels. Panels talk to the app only through
// the public methods below; tools receive the app as their first argument.
//
// Editing pattern (keeps undo correct):
//   app.edit('Label', (doc) => { …change doc… })        one-step change
//   app.beginEdit('Label'); …change app.doc…; app.docChangedLive(); app.endEdit()
//                                                        continuous drag
// =============================================================================

import { createDocument, linkNumbers, jointById, removeJoint, removeLink, removeConstruction, autoDriver, setDriverSpec, clearDocument, coincidentJoints, strokeAllows } from './model/document.js';
import { currentOutput } from './model/outputs.js';
import { transformEntity, distanceToEntity } from './model/construction.js';
import { History, settingsText, settingsChanged, keepSettings } from './model/history.js';
import { Simulation } from './model/simulation.js';
import { serialize, deserialize } from './model/fileio.js';
import { Viewport } from './drawing/viewport.js';
import { Renderer, contactPoint } from './drawing/render.js';
import { fileName } from './export/cad.js';
import { loadDisplay, saveDisplay, defaultDisplay } from './drawing/display.js';
import { buildSnapTargets, snapPoint } from './drawing/snap.js';
import { TOOLS, toolById } from './drawing/tools/index.js';
import { defaultCompass } from './drawing/tools/compass.js';
import { defaultProtractor } from './drawing/tools/protractor.js';
import { APP, ANIMATION, DRAWING, PATH, FORCES, MODE } from './config.js';
import { loadMode, saveMode } from '../../../packages/ui-kit/src/mode.js';
import { unitsOf, gridSpacing } from './model/units.js';
import { dynamicsOf, counterweightsOn } from './model/mass.js';
import { analyseForces, bodyMasses } from './model/forces.js';
import { downloadFile, saveFile, openFile, readText, readDataURL, safeStorage } from '../../../packages/ui-kit/src/files.js';
import { nearestOnLine, pointInPolygon, convexHull, wrap2Pi, wrapPi } from '../../../packages/core-math/src/index.js';
import { fmt } from '../../../packages/ui-kit/src/format.js';

const AUTOSAVE_KEY = 'linklab.autosave.v1';

/** File type shown in the Save and Open dialogs. */
const FILE_TYPES = [{ description: 'LinkLab drawing', accept: { 'application/json': ['.json'] } }];

export class App {
  constructor({ canvas, ui }) {
    this.canvas = canvas;
    this.ui = ui;                      // panels object: { refresh(app, what) }
    this.view = new Viewport();
    this.renderer = new Renderer(canvas);
    this.history = new History();
    this.sim = new Simulation();
    this.settings = { grid: true, snapGrid: false, midpoints: false, linkNumbers: true, jointNames: false, specialPositions: true };
    this.selection = null;
    this.hoverSnap = null;
    this.playing = false;
    this.speed = 1;
    this.direction = 1;
    this.version = 0;
    this.tool = toolById('select');
    this.mode = loadMode(MODE.storeKey, MODE.default); // 'basic' | 'advanced' (config.js MODE)
    this.display = loadDisplay();      // text and arrow size, arrow colours (drawing/display.js)
    this._cache = {};
    this._renderQueued = false;
    this._pendingEdit = null;
    this.doc = createDocument();
    this.compass = defaultCompass();
    this.protractor = defaultProtractor();
    this.sim.reset(this.doc);
    this._bindCanvas();
    this._bindKeys();
    this._bindPaste();
  }

  // ===========================================================================
  // document and editing
  // ===========================================================================

  /** Replace the whole document (new file, open, undo). */
  /**
   * Show a different document. `file` is the file handle it came from (so
   * Save writes back to it); any other new document starts unsaved.
   */
  setDoc(doc, { fit = false, keepHistory = false, file = null } = {}) {
    this.doc = doc;
    this.file = file;
    if (doc.instruments && doc.instruments.compass) this.compass = doc.instruments.compass;
    if (doc.instruments && doc.instruments.protractor) this.protractor = doc.instruments.protractor;
    if (!keepHistory) this.history.clear();
    this.selection = null;
    this.playing = false;
    this._afterDocChange();
    if (fit) this.fitView();
  }

  edit(label, fn) {
    this.beginEdit(label);
    const result = fn(this.doc);
    this.endEdit();
    return result;
  }

  /** Start a change: remember the old state for undo, and adopt the current pose. */
  beginEdit(label) {
    this._step = this.history.push(this.doc, label);   // undo returns to exactly this state
    this._settingsBefore = settingsText(this.doc);
    this.sim.bakeInto(this.doc);          // then edit what the student sees
    this._pendingEdit = label;
  }

  /** During a drag: update the drawing without adding undo steps. */
  docChangedLive() {
    this.version++;
    this._cache = {};
    this.sim.draft = true; // a quick, coarse whole-cycle sweep while dragging (full one on release)
    this.sim.reset(this.doc);
    this.requestRender();
    this.ui.refresh(this, 'live');
  }

  endEdit() {
    this._pendingEdit = null;
    autoDriver(this.doc);
    // which of the settings kept by undo (units, lock, output) this change set itself
    if (this._step) { this._step.changed = settingsChanged(this._settingsBefore, this.doc); this._step = null; }
    if (this.selection && !this._selectionExists(this.selection)) this.selection = null;
    this._afterDocChange();
  }

  _afterDocChange() {
    this.version++;
    this._cache = {};
    this.sim.draft = false;
    this.sim.reset(this.doc);
    // toggle and stationary positions come from the sweep: find them now
    if (this.settings.specialPositions && this.sim.drivable) { this.sim.getSweep(); this.sim.refresh(); }
    this.requestRender();
    this.ui.refresh(this, 'doc');
    this._scheduleAutosave();
  }

  // undo and redo keep the units, the lock and the output as they are now
  // (they are not undo steps: see KEPT_BY_UNDO in model/history.js)
  undo() {
    const r = this.history.undo(this.doc);
    if (!r) return;
    this.doc = keepSettings(this.doc, r.doc, r.changed); this.selection = null;
    this._afterDocChange();
    this.flash(`Undid: ${r.label}`);
  }

  redo() {
    const r = this.history.redo(this.doc);
    if (!r) return;
    this.doc = keepSettings(this.doc, r.doc, r.changed); this.selection = null;
    this._afterDocChange();
    this.flash(`Redid: ${r.label}`);
  }

  // ===========================================================================
  // pose (the moving mechanism)
  // ===========================================================================

  // ===========================================================================
  // forces (static and dynamic analysis)
  // ===========================================================================

  /** Basic or Advanced: which panels are shown. Not part of the drawing, so no undo step. */
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    saveMode(MODE.storeKey, mode);
    if (mode !== 'advanced' && this.tool.advanced) this.setTool('select');
    this._cache = {};
    this.ui.modeChanged();
    this.requestRender();
  }

  /** Force analysis shown: switched on for this drawing, and Advanced mode. */
  forcesOn() { return this.mode === 'advanced' && dynamicsOf(this.doc).mode !== 'off'; }

  /** Change the force-analysis settings (mode, gravity, material, …). */
  setDynamics(changes) {
    this.edit('Force analysis settings', (doc) => { doc.dynamics = { ...dynamicsOf(doc), ...changes }; });
    // first time forces are switched on: show how to set the masses
    if (changes.mode && changes.mode !== 'off' && this.ui.guides) this.ui.guides.topic('masses');
  }

  /** Forces at the current pose (null when off or not possible). */
  forcesNow() {
    if (!this.forcesOn()) return null;
    if (!('forces' in this._cache)) this._cache.forces = analyseForces(this.sim);
    return this._cache.forces;
  }

  /** Forces at every sample of the sweep (for plots and maxima), cached until something changes. */
  forceSweep() {
    const s = this.sim.getSweep();
    const mode = dynamicsOf(this.doc).mode;
    if (!s || !this.forcesOn()) return null;
    const key = `${this.version}|${mode}|${JSON.stringify(this.doc.dynamics)}|${this.doc.motion.omega}|${this.doc.motion.alpha}|${this.doc.motion.reverse}`;
    if (this._forceSweep && this._forceSweep.sweep === s && this._forceSweep.key === key) return this._forceSweep.list;
    const list = s.samples.map((smp) => analyseForces(this.sim, smp));
    // Moving at a constant input speed, the accelerations (so the forces) grow
    // without limit as a toggle position comes near. Positions close to one are
    // left out of the plots and the largest values; FORCES.toggleWindow says how close.
    let masked = 0;
    if (mode === 'dynamic') {
      const near = this.nearToggle(s);
      s.samples.forEach((smp, k) => { if (list[k] && near[k]) { list[k] = null; masked++; } });
    }
    this._forceSweep = { sweep: s, key, list, masked, bySample: new Map(s.samples.map((smp, k) => [smp, list[k]])) };
    return list;
  }

  /**
   * For each position of sweep s: is it within FORCES.toggleWindow of a toggle
   * position? (Moving at a constant input speed, forces grow without limit there.)
   */
  nearToggle(s) {
    const toggles = (s.specials || []).filter((sp) => sp.kind === 'toggle').map((sp) => s.samples[sp.index].travel).filter(Number.isFinite);
    if (!toggles.length) return s.samples.map(() => false);
    const total = Math.abs(s.samples[s.samples.length - 1].travel - s.samples[0].travel) || 1;
    const win = this.sim.inputIsAngle ? FORCES.toggleWindowDeg * Math.PI / 180 : FORCES.toggleWindowStroke * total;
    return s.samples.map((smp) => toggles.some((t) => Math.abs(smp.travel - t) < win));
  }

  /**
   * The same forces over the cycle as if the counterweights were not there,
   * for the plots to compare (Balancing preset). A Map sample → result, or
   * null when no counterweights are in use.
   */
  forceSweepWithout() {
    const list = this.forceSweep();
    if (!list || !counterweightsOn(this.doc) || !this.doc.links.some((l) => (l.counterweights || []).length)) return null;
    const fs = this._forceSweep;
    if (this._forceSweepWithout && this._forceSweepWithout.list === list) return this._forceSweepWithout.bySample;
    const saved = this.sim._masses;
    this.sim._masses = bodyMasses(this.sim, { own: true });
    const bySample = new Map();
    try { fs.sweep.samples.forEach((smp, k) => bySample.set(smp, list[k] ? analyseForces(this.sim, smp) : null)); }
    finally { this.sim._masses = saved; }
    this._forceSweepWithout = { list, bySample };
    return bySample;
  }

  /** How many positions near toggle positions forceSweep() left out (0 if none). */
  forceSweepMasked() {
    return this.forceSweep() ? this._forceSweep.masked : 0;
  }

  /** Forces at one sweep sample (after forceSweep), whatever order the plots use. */
  forceOf(smp) {
    if (!this.forceSweep()) return null;
    return this._forceSweep.bySample.get(smp) || null;
  }

  /**
   * Where a load is drawn on screen: { kind, p (screen point), tip (arrow end)
   * | r (torque circle radius) }.
   */
  loadGlyph(f) {
    const t = this.sim.transformFor(f.link);
    if (!t && this.sim.sys) return null;
    const at = t ? t.T(f.at) : f.at;
    const p = this.view.toScreen(at);
    const k = this.display.arrow; // Sheet › Display › Arrow size
    if (f.kind === 'torque') return { kind: 'torque', p, r: 20 * k };
    let F = f.F || { x: 0, y: -1 };
    if (f.follow && t) { const c = Math.cos(t.dphi), sn = Math.sin(t.dphi); F = { x: c * F.x - sn * F.y, y: sn * F.x + c * F.y }; }
    const m = Math.hypot(F.x, F.y) || 1;
    const len = 46 * k; // screen px: loads are drawn the same length, labelled with their size
    return { kind: 'force', p, tip: { x: p.x + (F.x / m) * len, y: p.y - (F.y / m) * len }, F };
  }

  /**
   * Change the display (Sheet › Display): { text, arrow, colors: { kind: '#rrggbb' | '' } }.
   * Kept in this browser; the drawing file does not change.
   */
  setDisplay(changes) {
    const d = this.display;
    if (changes.text !== undefined) d.text = changes.text;
    if (changes.arrow !== undefined) d.arrow = changes.arrow;
    if (changes.angleStep !== undefined) d.angleStep = changes.angleStep;
    for (const [k, c] of Object.entries(changes.colors || {})) { if (c) d.colors[k] = c; else delete d.colors[k]; }
    saveDisplay(d);
    this.requestRender();
    if (this.ui && this.ui.restylePlots) this.ui.restylePlots();
  }

  /** Put the display back to the default sizes and colours. */
  resetDisplay() {
    this.display = defaultDisplay();
    saveDisplay(this.display);
    this.requestRender();
    if (this.ui && this.ui.restylePlots) this.ui.restylePlots();
  }

  /** Options for dragging the mechanism by hand (rest at toggle/stationary positions). */
  dragOptions() {
    return { stopAtSpecial: !!this.settings.specialPositions, release: this.view.px(28) };
  }

  /** Mark toggle and stationary positions (and rest at them when dragging). */
  setSpecialPositions(on) {
    this.settings.specialPositions = !!on;
    if (on) { this.sim.getSweep(); this.sim.refresh(); }
    this.requestRender();
    this.ui.refresh(this, 'motion');
  }

  /** Call after the simulation pose changed (animation, slider, drag). */
  poseChanged() {
    this._cache = {};
    this.requestRender();
    this.ui.refresh(this, 'pose');
  }

  /** Motion settings changed (speed ω, α, direction): recompute plots. */
  motionChanged() {
    this.sim.invalidateSweep();
    this.sim.refresh();
    this.requestRender();
    this.ui.refresh(this, 'motion');
    this._scheduleAutosave();
  }

  play(on = !this.playing) {
    if (on && !this.sim.drivable) {
      this.flash(this.whyNotDrivable());
      on = false;
    }
    this.playing = on;
    if (on) {
      // start moving the input the way the motor turns (or the actuator pushes)
      this.sim.orientTravel((this.doc.motion.omega >= 0) !== !!this.doc.motion.reverse ? 1 : -1);
      this._lastFrame = null;
      requestAnimationFrame((t) => this._animate(t));
    }
    this.ui.refresh(this, 'play');
  }

  _animate(t) {
    if (!this.playing) return;
    if (this._lastFrame !== null) {
      const dt = Math.min((t - this._lastFrame) / 1000, 0.05);
      const sign = (this.doc.motion.omega >= 0) !== !!this.doc.motion.reverse ? 1 : -1;
      const sim = this.sim;
      if (sim.path) {
        // follow the path of motion: toggle positions are passed through (the
        // input turns back and the mechanism flips assembly); a linear input
        // turns back at its stroke ends
        const s = sim.inputIsAngle ? null : sim.getSweep();
        const span = s && s.limits.length ? s.limits[1] - s.limits[0] : 1;
        const amount = sim.inputIsAngle
          ? (ANIMATION.displayDegPerSecond * this.speed * dt * Math.PI) / 180
          : (span / ANIMATION.strokeSeconds) * this.speed * dt;
        sim.run(amount, PATH.animMaxStepPerFrame * this.speed * dt * 60);
      } else if (sim.inputIsAngle) {
        const dTheta = (ANIMATION.displayDegPerSecond * this.speed * dt * Math.PI / 180) * this.direction * sign;
        if (!sim.advance(dTheta)) this.direction *= -1; // limit position: rock back
      } else {
        // a linear input runs between its stroke ends in about 4 s at 1×
        const s = sim.getSweep();
        const [lo, hi] = s ? s.limits : [sim.theta - 1, sim.theta + 1];
        let du = ((hi - lo) / ANIMATION.strokeSeconds) * this.speed * dt * this.direction * sign;
        const target = sim.theta + du;
        if (target > hi || target < lo) { du = (target > hi ? hi : lo) - sim.theta; this.direction *= -1; }
        if (!sim.advance(du)) this.direction *= -1;
      }
      this.poseChanged();
    }
    this._lastFrame = t;
    requestAnimationFrame((tt) => this._animate(tt));
  }

  /** The input in display units: degrees for a motor, mm for a linear input. */
  inputDisplay(value = this.sim.theta) {
    return this.sim.inputIsAngle ? (value * 180) / Math.PI : this.units.len(value);
  }

  /**
   * The input as shown to the student: a crank that turns fully is shown
   * between 0° and 360° (like the plots' "Input from 0°"), not as the angle
   * it has turned through in total.
   */
  inputShown(value = this.sim.theta) {
    if (this.sim.inputIsAngle) {
      const s = this.sim.drivable ? this.sim.getSweep() : null;
      if (!s || s.fullTurn) value = wrap2Pi(value);
    }
    return this.inputDisplay(value);
  }

  /** The length unit shown (see model/units.js); geometry stays in mm. */
  get units() { return unitsOf(this.doc); }

  /** Change the shown unit or grid spacing (saved with the drawing). */
  setUnits(changes) {
    this.doc.units = { ...(this.doc.units || {}), ...changes };
    this._cache = {};
    this.requestRender();
    this.ui.refresh(this, 'doc');
    this._scheduleAutosave();
  }

  /** Move the input by a step in display units (1° or 1 mm). */
  stepInput(step) {
    if (!this.sim.drivable) { this.flash(this.whyNotDrivable()); return; }
    const ok = this.sim.advance(this.sim.inputIsAngle ? (step * Math.PI) / 180 : step);
    if (!ok) this.flash('Toggle position: the input cannot move further this way. Press ▶ to carry on through it.');
    this.poseChanged();
  }

  /** Move to sample i of the full-cycle sweep (a click on a plot). */
  goToSample(i) {
    if (!this.sim.drivable) return;
    this.sim.goToSample(i);
    this.poseChanged();
  }

  /**
   * Set the input to a value in display units (degrees or mm). A value out of
   * reach (beyond the stroke, or past a rocking input's limits) goes to the
   * nearest one it can reach, with a message (pass quiet for the slider).
   */
  setInput(value, quiet = false) {
    if (!this.sim.drivable) return;
    const theta = this.sim.inputIsAngle ? (value * Math.PI) / 180 : this.units.mm(value);
    const reach = this.sim.reachable(theta);
    this.sim.goTo(reach);
    this.poseChanged();
    // (an angle a whole number of turns away is the same position)
    const off = this.sim.inputIsAngle ? wrapPi(reach - theta) : reach - theta;
    if (!quiet && Math.abs(off) > 1e-9 * (1 + Math.abs(theta))) {
      const s = this.sim.getSweep(), shown = (v) => `${fmt(this.inputShown(v), 2)}${this.sim.inputIsAngle ? '°' : ` ${this.units.label}`}`;
      this.flash(`The input reaches only ${shown(s.limits[0])} to ${shown(s.limits[1])}: moved to ${shown(reach)}.`, true);
    }
  }

  /** The output being reported and plotted (chosen, or a sensible default). */
  output() {
    return this._cache.output || (this._cache.output = currentOutput(this.doc));
  }

  /** Choose the output (spec from listOutputs). */
  setOutput(spec) {
    this.doc.output = spec;
    this.sim.invalidateSweep(); // stationary positions depend on the output
    this.sim.refresh();
    this._cache = {};
    this.requestRender();
    this.ui.refresh(this, 'motion');
    this._scheduleAutosave();
  }

  /** Choose the input (spec from listInputs). Speeds switch units with it. */
  setInputSpec(spec) {
    const wasAngle = (this.doc.driver.type || 'rotary') === 'rotary';
    const isAngle = spec.type === 'rotary';
    const ok = this.edit('Change input', (doc) => {
      const done = setDriverSpec(doc, spec);
      if (done && wasAngle !== isAngle) {
        doc.motion.omega = isAngle ? ANIMATION.defaultOmega : ANIMATION.defaultSpeed;
        doc.motion.alpha = 0;
      }
      return done;
    });
    if (!ok) this.flash('That input is not possible for this mechanism.', true);
    else if (!this.sim.drivable) this.flash(this.whyNotDrivable());
  }

  /**
   * Set one end ('min' or 'max', mm) of an actuator's stroke. Refused, with a
   * message, when the shortest would not be below the longest. Returns true
   * when set (a panel puts the old value back otherwise).
   */
  setActuatorStroke(id, end, v) {
    const u = (this.doc.actuators || []).find((x) => x.id === id);
    if (!u || !(v > 0)) return false;
    if (!strokeAllows(u, end, v)) {
      const U = this.units;
      this.flash(end === 'min' ? `Shortest must be less than Longest (${U.fmt(u.max)}).` : `Longest must be more than Shortest (${U.fmt(u.min)}).`, true);
      return false;
    }
    this.edit('Set actuator stroke', (doc) => { doc.actuators.find((x) => x.id === id)[end] = v; });
    return true;
  }

  /** Lock or unlock all lengths (dragging joints then moves the mechanism). */
  setLock(on) {
    this.doc.lockDesign = !!on;
    this.flash(on ? 'Lengths locked: dragging a joint now moves the mechanism instead of changing it.' : 'Lengths unlocked: dragging a joint changes the design.');
    this.requestRender();
    this.ui.refresh(this, 'doc');
    this._scheduleAutosave();
  }

  /** Can this joint be dragged to a new place (or is its link locked)? */
  jointEditable(jointId) {
    if (this.doc.lockDesign) return false;
    return !this.doc.links.some((l) => l.locked && l.joints.includes(jointId));
  }

  /** Back to the position the mechanism was drawn in. */
  resetPose() {
    this.playing = false;
    this.sim.reset(this.doc);
    this.poseChanged();
    this.ui.refresh(this, 'play');
  }

  whyNotDrivable() {
    const s = this.sim;
    if (!s.sys) return 'Draw a mechanism first: place ground pivots, then links.';
    if (!s.sys.driver) return 'Choose an input with the Input tool (D), or under Kinematics › Input: a motor at a pin, a linear actuator, or a slider to push.';
    if (!s.assembled) return 'The links cannot be assembled in this position. Check the link lengths.';
    if (s.info.dof !== 1) {
      // two joints drawn on one spot but never joined leave the links loose
      const pair = coincidentJoints(this.doc)[0];
      const jn = (id) => `J${this.doc.joints.findIndex((j) => j.id === id) + 1}`;
      let hint = pair ? ` ${jn(pair[0])} and ${jn(pair[1])} are on the same spot but not joined: right-click one and choose “Join”.` : '';
      // a cylinder that is not the input holds its length like a strut
      const struts = (this.doc.actuators || []).filter((u) => !(this.doc.driver.type === 'linear' && this.doc.driver.actuator === u.id));
      if (!hint && s.info.dof === 0 && struts.length) hint = ' A linear actuator that is not the input holds its length like a strut: to drive with it, click it with the Input tool (D).';
      return `The mechanism has ${s.info.dof} degrees of freedom. It needs exactly 1 to be driven by one input.${hint}`;
    }
    return 'The mechanism cannot move.';
  }

  // ===========================================================================
  // geometry at the current pose (cached)
  // ===========================================================================

  linkNumbers() {
    return this._cache.nums || (this._cache.nums = linkNumbers(this.doc));
  }

  /** Construction entities where they appear now (attached ones move). */
  currentConstruction() {
    if (this._cache.cons) return this._cache.cons;
    this._cache.cons = this.doc.construction.map((e) => {
      const t = this.sim.transformFor(e.attach);
      return t ? transformEntity(e, t.T, t.dphi) : e;
    });
    return this._cache.cons;
  }

  currentBodies() {
    if (this._cache.bodies) return this._cache.bodies;
    this._cache.bodies = this.doc.bodies.map((b) => {
      const t = this.sim.transformFor(b.attach);
      return t ? { ...b, pts: b.pts.map(t.T) } : b;
    });
    return this._cache.bodies;
  }

  snapTargets() {
    if (this._cache.snap) return this._cache.snap;
    const joints = this.doc.layers.mechanism.visible
      ? this.doc.joints.map((j) => ({ id: j.id, p: this.sim.jointPos(j.id) }))
      : [];
    const cons = this.doc.layers.construction.visible ? this.currentConstruction() : [];
    this._cache.snap = buildSnapTargets({ construction: cons, joints }, { midpoints: this.settings.midpoints });
    return this._cache.snap;
  }

  /** Snap a screen point; returns { p (world), kind, ref }. */
  snapWorld(s, options = {}) {
    const w = this.view.toWorld(s);
    return snapPoint(this.snapTargets(), w, this.view.px(1), {
      grid: this.settings.snapGrid ? this.renderer.gridMinor || gridSpacing(this.doc).minor : null,
      ...options,
    });
  }

  compassRadius() {
    const c = this.compass;
    return Math.hypot(c.pencil.x - c.needle.x, c.pencil.y - c.needle.y);
  }

  // ===========================================================================
  // picking and selection
  // ===========================================================================

  /** What is under screen point s? Respects hidden and locked layers. */
  pickAt(s) {
    const L = this.doc.layers;
    const w = this.view.toWorld(s);
    const tol = this.view.px(DRAWING.pickRadiusPx);
    const usable = (name) => L[name].visible && !L[name].locked;
    // external forces and torques are drawn on top: pick them first
    if (usable('mechanism')) {
      for (const f of this.doc.loads || []) {
        const g = this.loadGlyph(f);
        if (!g) continue;
        const d = g.kind === 'torque'
          ? Math.abs(Math.hypot(s.x - g.p.x, s.y - g.p.y) - g.r)
          : Math.hypot(s.x - nearestOnLine(s, g.p, g.tip, true).point.x, s.y - nearestOnLine(s, g.p, g.tip, true).point.y);
        if (d < DRAWING.pickRadiusPx) return { kind: 'load', id: f.id };
      }
    }
    if (usable('mechanism')) {
      let best = null, bd = tol + this.view.px(DRAWING.jointRadiusPx);
      for (const j of this.doc.joints) {
        const p = this.sim.jointPos(j.id);
        const d = Math.hypot(p.x - w.x, p.y - w.y);
        if (d < bd) { bd = d; best = j; }
      }
      if (best) return { kind: 'joint', id: best.id };
    }
    if (usable('construction')) {
      let best = null, bd = tol;
      for (const e of this.currentConstruction()) {
        const d = distanceToEntity(e, w);
        // points win over the lines they sit on
        const dd = e.kind === 'point' ? d * 0.6 : d;
        if (dd < bd) { bd = dd; best = e; }
      }
      if (best) return { kind: 'construction', id: best.id };
    }
    if (usable('mechanism')) {
      // linear actuators (drawn over the links)
      for (const u of this.doc.actuators || []) {
        const a = this.sim.jointPos(u.a), b = this.sim.jointPos(u.b);
        if (!a || !b) continue;
        const n = nearestOnLine(w, a, b, true).point;
        if (Math.hypot(n.x - w.x, n.y - w.y) < this.view.px(DRAWING.linkWidthPx / 2 + 3)) return { kind: 'actuator', id: u.id };
      }
      const link = this.pickLink(s, DRAWING.linkWidthPx / 2 + 3);
      if (link) return { kind: 'link', id: link };
      // contact points and prismatic sleeves
      if (this.sim.sys) {
        for (const pr of this.sim.sys.pairs) {
          let c;
          if (pr.type === 'prismatic') {
            const src = this.doc.pairs.find((x) => x.id === pr.id);
            const t = this.sim.transformFor(src.slider);
            c = t ? t.T(src.a) : src.a;
          } else c = contactPoint(this.sim, pr);
          if (c && Math.hypot(c.x - w.x, c.y - w.y) < tol + this.view.px(4)) return { kind: 'pair', id: pr.id };
        }
      }
      for (const sl of this.doc.sliders) {
        const t = sl.on ? this.sim.transformFor(sl.on) : null;
        const a = t ? t.T(sl.a) : sl.a, b = t ? t.T(sl.b) : sl.b;
        const n = nearestOnLine(w, a, b, true).point;
        if (Math.hypot(n.x - w.x, n.y - w.y) < tol) return { kind: 'slider', id: sl.id };
      }
    }
    if (usable('bodies')) {
      const bodies = this.currentBodies();
      for (let i = bodies.length - 1; i >= 0; i--) {
        if (pointInPolygon(w, bodies[i].pts)) return { kind: 'body', id: bodies[i].id };
      }
    }
    return null;
  }

  /** Link under (or within tolPx of) screen point s, or null. */
  pickLink(s, tolPx = DRAWING.linkWidthPx / 2) {
    const w = this.view.toWorld(s);
    const tol = this.view.px(tolPx);
    let best = null, bd = tol;
    const consider = (id, d) => { if (d < bd) { bd = d; best = id; } };
    for (const link of this.doc.links) {
      const pts = link.joints.map((id) => this.sim.jointPos(id));
      if (link.disc) {
        // inside a wheel counts as near — but a bar drawn over it wins
        const d = Math.hypot(pts[0].x - w.x, pts[0].y - w.y);
        consider(link.id, d <= link.disc ? tol * 0.6 : d - link.disc);
      }
      if (pts.length > 2 && pointInPolygon(w, convexHull(pts))) consider(link.id, 0);
      for (let i = 0; i < pts.length; i++) {
        for (let k = i + 1; k < pts.length; k++) {
          const n = nearestOnLine(w, pts[i], pts[k], true).point;
          consider(link.id, Math.hypot(n.x - w.x, n.y - w.y));
        }
      }
    }
    return best;
  }

  select(sel) {
    this.selection = sel;
    this.requestRender();
    this.ui.refresh(this, 'selection');
  }

  _selectionExists(sel) {
    const d = this.doc;
    const list = { joint: d.joints, link: d.links, construction: d.construction, body: d.bodies, slider: d.sliders, pair: d.pairs, actuator: d.actuators, load: d.loads || [] }[sel.kind];
    return !!(list && list.some((x) => x.id === sel.id));
  }

  deleteSelection() {
    const sel = this.selection;
    if (!sel) return;
    const names = { joint: 'joint', link: 'link', construction: 'drawing item', body: 'outline', slider: 'slider', pair: 'joint', actuator: 'actuator', load: 'force' };
    this.edit(`Delete ${names[sel.kind]}`, (doc) => {
      if (sel.kind === 'load') doc.loads = (doc.loads || []).filter((f) => f.id !== sel.id);
      if (sel.kind === 'actuator') doc.actuators = doc.actuators.filter((u) => u.id !== sel.id);
      if (sel.kind === 'joint') removeJoint(doc, sel.id);
      else if (sel.kind === 'link') removeLink(doc, sel.id);
      else if (sel.kind === 'construction') removeConstruction(doc, sel.id);
      else if (sel.kind === 'pair') doc.pairs = doc.pairs.filter((p) => p.id !== sel.id);
      else if (sel.kind === 'body') doc.bodies = doc.bodies.filter((b) => b.id !== sel.id);
      else if (sel.kind === 'slider') doc.sliders = doc.sliders.filter((s) => s.id !== sel.id);
    });
    this.selection = null;
    this.ui.refresh(this, 'selection');
  }

  // ===========================================================================
  // tools
  // ===========================================================================

  setTool(id) {
    const t = toolById(id);
    if (!t || t === this.tool) return;
    if (t.advanced && this.mode !== 'advanced') { this.flash(`${t.label}: switch to Advanced (top bar) to use it.`); return; }
    if (this.tool.cancel) this.tool.cancel(this);
    this.tool = t;
    if (t.activate) t.activate(this);
    // a tool for a hidden or locked layer would do nothing: show/unlock it
    if (t.layer) {
      const L = this.doc.layers[t.layer];
      if (!L.visible || L.locked) {
        L.visible = true; L.locked = false;
        this.flash(`The ${t.layer} layer was shown and unlocked for this tool.`);
      }
    }
    this.hoverSnap = null;
    this.canvas.style.cursor = 'crosshair';
    this.requestRender();
    this.ui.refresh(this, 'tool');
    if (this.ui.toolActivated) this.ui.toolActivated(t);
  }

  get tools() { return TOOLS; }

  // ===========================================================================
  // view
  // ===========================================================================

  fitView() {
    const pts = [];
    for (const j of this.doc.joints) pts.push(this.sim.jointPos(j.id));
    for (const l of this.doc.links) {
      if (!l.disc) continue;
      const c = this.sim.jointPos(l.joints[0]);
      pts.push({ x: c.x - l.disc, y: c.y - l.disc }, { x: c.x + l.disc, y: c.y + l.disc });
    }
    for (const e of this.currentConstruction()) {
      for (const k of ['p', 'a', 'b']) if (e[k]) pts.push(e[k]);
      if (e.c) { pts.push({ x: e.c.x - e.r, y: e.c.y - e.r }, { x: e.c.x + e.r, y: e.c.y + e.r }); }
    }
    for (const b of this.currentBodies()) pts.push(...b.pts);
    const s = this.sim.getSweep();
    // every joint over the whole cycle, so the moving parts stay in view as it runs
    if (s) for (const smp of s.samples) for (const r of smp.results.joints.values()) if (r && r.pos) pts.push(r.pos);
    if (!pts.length) { this.view.cx = 0; this.view.cy = 0; this.view.zoom = DRAWING.initialZoom; this.requestRender(); return; }
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const p of pts) { box.x0 = Math.min(box.x0, p.x); box.y0 = Math.min(box.y0, p.y); box.x1 = Math.max(box.x1, p.x); box.y1 = Math.max(box.y1, p.y); }
    this.view.resize(this.canvas.clientWidth, this.canvas.clientHeight);
    const hint = document.getElementById('hint');
    const clear = hint && hint.offsetParent ? Math.max(0, hint.offsetHeight - 30) : 0; // the hint bar sits in the bottom margin
    this.view.fit(box, 60, clear);
    this._cache = {};
    this.requestRender();
  }

  requestRender() {
    if (this._renderQueued) return;
    this._renderQueued = true;
    requestAnimationFrame(() => {
      this._renderQueued = false;
      this.renderer.draw(this);
    });
  }

  // ===========================================================================
  // files
  // ===========================================================================

  newDocument() {
    this.setDoc(createDocument());
    this.compass = defaultCompass();
    this.protractor = defaultProtractor();
    this.view.cx = 0; this.view.cy = 0; this.view.zoom = DRAWING.initialZoom;
    this.flash('New drawing.');
  }

  /** Clear part of the sheet (see clearDocument). One undo step brings it back. */
  clear(what) {
    const names = { all: 'everything', construction: 'the construction', mechanism: 'the mechanism', background: 'the background picture' };
    if (this.playing) this.play(false);
    const { kept } = this.edit(`Clear ${names[what]}`, (doc) => clearDocument(doc, what));
    this.selection = null;
    const note = kept ? ` ${kept} construction item${kept > 1 ? 's were' : ' was'} kept because a roll joint uses ${kept > 1 ? 'them' : 'it'}.` : '';
    this.flash(`Cleared ${names[what]}.${note} Press Ctrl+Z to undo.`);
  }

  /**
   * Save the drawing. The first time (or with saveAs) the browser asks where
   * and under what name, where it can; after that Save writes to the same
   * file. Browsers without a Save dialog (Safari, iPad, Firefox) download it.
   */
  async save({ saveAs = false } = {}) {
    this.doc.instruments = { compass: this.compass, protractor: this.protractor };
    const name = (this.doc.meta.title || 'mechanism').replace(/[^\w\- ]+/g, '').trim() || 'mechanism';
    const res = await saveFile(name + APP.fileExtension, serialize(this.doc), { handle: this.file, saveAs, types: FILE_TYPES });
    if (!res) return; // cancelled
    this.file = res.handle;
    this.flash(res.downloaded ? `Saved as ${res.name} (in your Downloads folder).` : `Saved to ${res.name}.`);
  }

  async open() {
    const picked = await openFile('.json,application/json', FILE_TYPES);
    if (!picked) return;
    const f = picked.file;
    try {
      const doc = deserialize(await readText(f));
      if (!doc.meta.title || doc.meta.title === 'Untitled mechanism') doc.meta.title = f.name.replace(/\.linklab\.json$|\.json$/i, '');
      this.setDoc(doc, { fit: true, file: picked.handle });
      this.flash(`Opened ${f.name}.`);
    } catch (err) {
      this.flash(err.message, true);
    }
  }

  /**
   * Open an example the website links to: …/app/?open=walking-leg loads
   * ../examples/walking-leg.linklab.json from the same site (a name of
   * letters, digits and dashes only). The drawing open before stays one Undo
   * away. Nothing happens in the single-file copy (no site to load from).
   */
  async openLinked() {
    const name = new URLSearchParams(location.search).get('open');
    if (!name || !/^[a-z0-9-]{1,64}$/.test(name) || location.protocol === 'file:') return false;
    try {
      const res = await fetch(`../examples/${name}.linklab.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const doc = deserialize(await res.text());
      const before = this.doc.joints.length || this.doc.construction.length;
      if (before) this.history.push(this.doc, 'Open the linked example');   // Undo brings the old drawing back
      this.setDoc(doc, { fit: true, keepHistory: true });
      this.flash(`Opened the example: ${doc.meta.title}.${before ? ' Undo brings back your previous drawing.' : ''}`);
      // drop ?open= from the address, so reloading keeps what the student changed
      window.history.replaceState(null, '', location.pathname + location.hash);
      return true;
    } catch {
      this.flash(`The example "${name}" could not be opened.`, true);
      return false;
    }
  }

  exportPNG() {
    const name = fileName(this.doc.meta.title);   // the same style as the other exports
    this.renderer.draw(this);
    this.canvas.toBlob((blob) => { if (blob) downloadFile(name + '.png', blob, 'image/png'); });
  }

  async loadBackground(file) {
    const url = await readDataURL(file);
    this._setBackground(url);
  }

  _setBackground(url) {
    const img = new Image();
    img.onload = () => {
      // place the picture centred in the view, about 80% of the view wide
      const vw = this.view.px(this.canvas.clientWidth) * 0.8;
      const mmPerPx = vw / img.naturalWidth;
      const tl = { x: this.view.cx - (img.naturalWidth * mmPerPx) / 2, y: this.view.cy + (img.naturalHeight * mmPerPx) / 2 };
      this.edit('Add background picture', (doc) => {
        doc.background = { image: url, x: tl.x, y: tl.y, mmPerPx, rotation: 0, opacity: 0.6 };
        doc.layers.background.visible = true;
      });
      this.flash('Picture added. Use Set scale (R) to make it true size.');
    };
    img.src = url;
  }

  _scheduleAutosave() {
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => {
      this.doc.instruments = { compass: this.compass, protractor: this.protractor };
      const text = serialize(this.doc);
      // a large picture may not fit; save without it rather than fail
      if (!safeStorage.set(AUTOSAVE_KEY, text) && this.doc.background) {
        safeStorage.set(AUTOSAVE_KEY, serialize({ ...this.doc, background: null }));
      }
    }, 800);
  }

  restoreAutosave() {
    const text = safeStorage.get(AUTOSAVE_KEY);
    if (!text) return false;
    try {
      const doc = deserialize(text);
      if (!doc.joints.length && !doc.construction.length && !doc.bodies.length) return false;
      this.setDoc(doc, { fit: true });
      this.flash('Your last drawing was restored.');
      return true;
    } catch { return false; }
  }

  // ===========================================================================
  // messages
  // ===========================================================================

  flash(msg, isError = false) { this.ui.flash(msg, isError); }

  askNumber(screenPt, label, initial, onOk, onCancel) { this.ui.askNumber(screenPt, label, initial, onOk, onCancel); }

  // ===========================================================================
  // input events
  // ===========================================================================

  _event(e) {
    const r = this.canvas.getBoundingClientRect();
    const s = { x: e.clientX - r.left, y: e.clientY - r.top };
    const w = this.view.toWorld(s);
    const snap = this.snapWorld(s);
    return { s, w, snap, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: e.button, original: e };
  }

  _bindCanvas() {
    const cv = this.canvas;
    let panning = null;
    // touch screens (iPad, tablets): two fingers pan and pinch-zoom
    const touches = new Map();
    let gesture = null;
    const touchCentre = () => {
      const r = cv.getBoundingClientRect();
      const pts = [...touches.values()];
      return {
        mid: { x: (pts[0].x + pts[1].x) / 2 - r.left, y: (pts[0].y + pts[1].y) / 2 - r.top },
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      };
    };
    const longPress = { timer: 0, at: null, fired: false };
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch { /* not every device supports capture */ }
      // where the student last pressed (the Properties card keeps clear of it)
      { const r = cv.getBoundingClientRect(); this.lastPointer = { x: e.clientX - r.left, y: e.clientY - r.top }; }
      cv.focus();
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          clearTimeout(longPress.timer); longPress.at = null;
          // second finger: stop what the first finger started and switch to pan/zoom
          if (this.tool.up) this.tool.up(this, this._event(e));
          if (this.tool.cancel) this.tool.cancel(this);
          gesture = touchCentre();
          return;
        }
        if (gesture) return;
        // a long press with the select tool opens the right-click menu
        if (this.tool.id === 'select') {
          const at = this._event(e).s;
          clearTimeout(longPress.timer);
          longPress.at = at; longPress.fired = false;
          longPress.timer = setTimeout(() => {
            longPress.fired = true;
            if (this.tool.up) this.tool.up(this, this._event(e));
            this._contextMenu(at);
          }, 550);
        }
      }
      // middle button or space+drag: pan with any tool
      if (e.button === 1 || this._spaceDown) { panning = { x: e.clientX, y: e.clientY }; cv.style.cursor = 'grabbing'; return; }
      // picking one point for a dialog (e.g. a centre of mass)
      if (this._pick) {
        const pk = this._pick;
        this._pick = null;
        if (e.button === 0) pk.onPick(this._event(e).snap.p);
        else if (pk.onCancel) pk.onCancel();
        this.ui.refresh(this, 'hint');
        return;
      }
      if (e.button === 2) {
        // first stop what the tool is doing (a chain of links, …)
        if (this.tool.cancel && this.tool.cancel(this)) { this.requestRender(); this.ui.refresh(this, 'tool'); return; }
        this._contextMenu(this._event(e).s);
        return;
      }
      const ev = this._event(e);
      this.hoverSnap = ev.snap.kind ? ev.snap : null;
      if (this.tool.down) this.tool.down(this, ev);
      this.requestRender();
      this.ui.refresh(this, 'hint');
    });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (gesture && touches.size >= 2) {
          const g = touchCentre();
          this.view.panBy(g.mid.x - gesture.mid.x, g.mid.y - gesture.mid.y);
          if (gesture.dist > 0 && g.dist > 0) this.view.zoomAt(g.mid, g.dist / gesture.dist);
          gesture = g;
          this._cache.snap = null;
          this.requestRender();
          return;
        }
        if (gesture) return;
        if (longPress.fired) return;
        if (longPress.at) {
          const r = cv.getBoundingClientRect();
          if (Math.hypot(e.clientX - r.left - longPress.at.x, e.clientY - r.top - longPress.at.y) > 8) { clearTimeout(longPress.timer); longPress.at = null; }
        }
      }
      if (panning) {
        this.view.panBy(e.clientX - panning.x, e.clientY - panning.y);
        panning = { x: e.clientX, y: e.clientY };
        this._cache.snap = null;
        this.requestRender();
        return;
      }
      const ev = this._event(e);
      this.hoverSnap = (this.tool.id !== 'select' || this._pick) && ev.snap.kind ? ev.snap : null;
      if (this._pick) { cv.style.cursor = 'crosshair'; this.ui.pointer(ev.snap.p, ev.snap.kind); this.requestRender(); return; }
      if (this.tool.move) this.tool.move(this, ev);
      cv.style.cursor = this.tool.cursor ? this.tool.cursor(this, ev.s) : 'crosshair';
      this.ui.pointer(ev.snap.p, ev.snap.kind);
      this.requestRender();
      if (['compass', 'protractor', 'select'].includes(this.tool.id)) this.ui.refresh(this, 'hint');
    });
    const end = (e) => {
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        if (gesture) { if (touches.size === 0) gesture = null; return; }
        clearTimeout(longPress.timer); longPress.at = null;
        if (longPress.fired) { longPress.fired = false; return; }
      }
      if (panning) { panning = null; cv.style.cursor = 'crosshair'; return; }
      if (this.tool.up) this.tool.up(this, this._event(e));
      this.requestRender();
      this.ui.refresh(this, 'hint');
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { this.hoverSnap = null; this.requestRender(); });
    cv.addEventListener('dblclick', (e) => { if (this.tool.dblclick) this.tool.dblclick(this, this._event(e)); this.requestRender(); });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      this.view.zoomAt({ x: e.clientX - r.left, y: e.clientY - r.top }, k);
      this._cache.snap = null;
      this.requestRender();
    }, { passive: false });
    new ResizeObserver(() => this.requestRender()).observe(cv);
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === ' ') { this._spaceDown = true; e.preventDefault(); return; }
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
      if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); this.save({ saveAs: e.shiftKey }); return; }
      if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); this.open(); return; }
      if (ctrl) return;
      if (this.tool.key && this.tool.key(this, e)) { e.preventDefault(); this.requestRender(); return; }
      if (e.key === 'Escape' && this._pick) {
        const pk = this._pick;
        this._pick = null;
        if (pk.onCancel) pk.onCancel();
        this.ui.refresh(this, 'hint');
        return;
      }
      if (e.key === 'Escape') {
        if (!(this.tool.cancel && this.tool.cancel(this))) { if (this.selection) this.select(null); else this.setTool('select'); }
        this.requestRender(); this.ui.refresh(this, 'tool');
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { this.deleteSelection(); e.preventDefault(); return; }
      if (e.key === 'Enter' && (e.target === document.body || e.target === this.canvas)) { this.play(); return; }
      if (e.key === 'ArrowRight') { this.stepInput(e.shiftKey ? 10 : 1); e.preventDefault(); return; }
      if (e.key === 'ArrowLeft') { this.stepInput(e.shiftKey ? -10 : -1); e.preventDefault(); return; }
      if (e.key === 'f' || e.key === 'F') { this.fitView(); return; }
      const t = TOOLS.find((tt) => tt.shortcut && tt.shortcut.toLowerCase() === e.key.toLowerCase());
      if (t) { this.setTool(t.id); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => { if (e.key === ' ') this._spaceDown = false; });
  }

  _bindPaste() {
    window.addEventListener('paste', async (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) {
          e.preventDefault();
          const file = it.getAsFile();
          if (file) await this.loadBackground(file);
          return;
        }
      }
    });
    // drag-and-drop a picture or a .linklab.json file onto the window
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (f.type.startsWith('image/')) await this.loadBackground(f);
      else {
        try { this.setDoc(deserialize(await readText(f)), { fit: true }); this.flash(`Opened ${f.name}.`); }
        catch (err) { this.flash(err.message, true); }
      }
    });
  }

  /**
   * Right-click (or long press) at screen point s: select what is there and
   * show its menu. On empty space, go back to the select tool.
   */
  _contextMenu(s) {
    const hit = this.pickAt(s);
    if (this.tool.id !== 'select') this.setTool('select');
    if (!hit) { this.select(null); return; }
    this.select(hit);
    this.ui.quickMenu(s, hit);
  }

  /**
   * Let the student click one point on the drawing (it snaps like the tools
   * do). onPick(worldPoint) is called with it; Esc or right-click cancels.
   */
  pickPoint(prompt, onPick, onCancel = null) {
    this._pick = { prompt, onPick, onCancel };
    this.flash(prompt);
    this.ui.refresh(this, 'hint');
  }

  /** Helper for panels: the selected joint object. */
  selectedJoint() {
    return this.selection && this.selection.kind === 'joint' ? jointById(this.doc, this.selection.id) : null;
  }
}
