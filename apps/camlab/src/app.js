// =============================================================================
// app.js — CamLab state: the design, undo, the cam angle, files
// -----------------------------------------------------------------------------
//   app.doc          the design (model/document.js)
//   app.edit(label, fn)   change the design with one undo step
//   app.result()     the analysis of the current design (cached)
//   app.theta        current cam angle in degrees (animation, plot cursors)
//   app.plots        which plot set is beside the cam (config.js PLOTS)
//   app.layout       'both' | 'cam' | 'plots'
//   app.mode         'basic' | 'advanced' (config.js MODE), remembered here
// The UI calls app.ui.refresh(what) with what = 'doc' | 'angle' | 'plots'.
// =============================================================================

import { createDocument, serialize, deserialize, EXAMPLES } from './model/document.js';
import { analyse } from './model/analysis.js';
import { unitsOf } from './model/units.js';
import { APP, ANIMATION, MODE, PLOTS } from './config.js';
import { saveFile, openFile, readText, safeStorage } from '../../../packages/ui-kit/src/files.js';
import { loadMode, saveMode } from '../../../packages/ui-kit/src/mode.js';

const AUTOSAVE_KEY = 'camlab.autosave';
const UNDO_LIMIT = 200;

export class App {
  constructor(ui) {
    this.ui = ui;
    this.doc = createDocument();
    this.version = 0;
    this.undoStack = []; this.redoStack = [];
    this.theta = 0;
    this.playing = false;
    this.speed = 1;
    this.mode = loadMode(MODE.storeKey, MODE.default);
    this.plots = PLOTS.sets[0].id;
    this.layout = 'both';
    this.file = null;
    this._result = null;
  }

  get units() { return unitsOf(this.doc); }

  /** The analysis of the current design, worked out once per change. */
  result() {
    if (!this._result || this._result.version !== this.version) this._result = { version: this.version, value: analyse(this.doc) };
    return this._result.value;
  }

  // ---- changes and undo ----------------------------------------------------------

  edit(label, fn) {
    this.undoStack.push({ label, json: JSON.stringify(this.doc) });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    fn(this.doc);
    this.changed();
  }

  changed() {
    this.version++;
    this.autosave();
    this.ui.refresh('doc');
  }

  undo() { this._step(this.undoStack, this.redoStack, 'Undid'); }
  redo() { this._step(this.redoStack, this.undoStack, 'Redid'); }
  _step(from, to, word) {
    const s = from.pop();
    if (!s) return;
    to.push({ label: s.label, json: JSON.stringify(this.doc) });
    this.doc = JSON.parse(s.json);
    this.changed();
    this.ui.flash(`${word}: ${s.label}`);
  }

  setDoc(doc, { keepHistory = false } = {}) {
    this.doc = doc;
    if (!keepHistory) { this.undoStack.length = 0; this.redoStack.length = 0; }
    this.theta = 0;
    this.ui.selectedSegment = -1;
    this.changed();
  }

  /** Replace the design with another, as one undo step (an example, a new design). */
  replaceDoc(doc, label) {
    this.undoStack.push({ label, json: JSON.stringify(this.doc) });
    this.redoStack.length = 0;
    this.setDoc(doc, { keepHistory: true });
  }

  loadExample(id) {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    this.replaceDoc(ex.make(), 'Open example');
    this.file = null;
    this.ui.flash(`Example: ${ex.name}`);
  }

  newDocument() { this.replaceDoc(createDocument(), 'New design'); this.file = null; }

  // ---- the cam angle and animation --------------------------------------------

  setTheta(deg) {
    this.theta = ((deg % 360) + 360) % 360;
    this.ui.refresh('angle');
  }

  play(on = !this.playing) {
    this.playing = on;
    if (on) { this._last = null; requestAnimationFrame((t) => this._tick(t)); }
    this.ui.refresh('play');
  }

  _tick(t) {
    if (!this.playing) return;
    if (this._last !== null) {
      const dt = Math.min(0.05, (t - this._last) / 1000);
      this.setTheta(this.theta + ANIMATION.displayDegPerSecond * this.speed * dt);
    }
    this._last = t;
    requestAnimationFrame((tt) => this._tick(tt));
  }

  /** The plots beside the cam (a set id from config.js PLOTS). */
  setPlots(id) { this.plots = id; this.ui.refresh('plots'); }
  /** Show the cam and the plots, or one of them: 'both' | 'cam' | 'plots'. */
  setLayout(id) { this.layout = id; this.ui.refresh('plots'); }

  /** Basic or Advanced: which panels and views are shown (not part of the design). */
  setMode(mode) {
    this.mode = mode;
    saveMode(MODE.storeKey, mode);
    if (mode === 'basic' && MODE.advancedPlots.includes(this.plots)) this.plots = PLOTS.sets[0].id;
    this.ui.refresh('mode');
  }

  /** Is this plot set, input section or result section shown in the current mode? */
  shows(kind, id) {
    if (this.mode === 'advanced') return true;
    const list = { plots: MODE.advancedPlots, input: MODE.advancedInputs, result: MODE.advancedResults }[kind];
    return !list.includes(id);
  }

  // ---- files -------------------------------------------------------------------------

  fileName() {
    const t = (this.doc.meta.title || 'cam').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'cam';
    return `${t}${APP.fileExtension}`;
  }

  async save({ saveAs = false } = {}) {
    const res = await saveFile(this.fileName(), serialize(this.doc), {
      handle: this.file && this.file.handle, saveAs,
      types: [{ description: 'CamLab cam design', accept: { 'application/json': [APP.fileExtension, '.json'] } }],
    });
    if (!res) return;
    this.file = res.handle ? { handle: res.handle, name: res.name } : null;
    this.ui.flash(res.downloaded ? `Saved to your Downloads folder as ${res.name}.` : `Saved ${res.name}.`);
  }

  async open() {
    const got = await openFile(`${APP.fileExtension},.json`, [{ description: 'CamLab cam design', accept: { 'application/json': [APP.fileExtension, '.json'] } }]);
    if (!got) return;
    try {
      this.setDoc(deserialize(await readText(got.file)));
      this.file = got.handle ? { handle: got.handle, name: got.file.name } : null;
      this.ui.flash(`Opened ${got.file.name}.`);
    } catch (err) {
      this.ui.flash(err.message, true);
    }
  }

  autosave() { safeStorage.set(AUTOSAVE_KEY, serialize(this.doc)); }

  restoreAutosave() {
    const text = safeStorage.get(AUTOSAVE_KEY);
    if (!text) return false;
    try { this.doc = deserialize(text); this.version++; return true; } catch { return false; }
  }
}
