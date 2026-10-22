// =============================================================================
// history.js — undo / redo by snapshots
// -----------------------------------------------------------------------------
// The document is small, so each change stores a full JSON copy. The
// background image (which can be large) is kept by reference: snapshots share
// the same image string instead of copying it.
// Each step may also note which settings it changed (`changed`, set by the
// app when the change ends); undo and redo pass that note on.
// =============================================================================

import { DRAWING } from '../config.js';
import { outputValid } from './outputs.js';

/**
 * Settings saved with the drawing that are typed or chosen with a click, not
 * drawn, so they make no undo step: the units, the lengths lock, the output,
 * the input speed (ω, α, direction), the drawing's name and notes, the layers
 * (shown, locked, faded) and the CAD export sizes. Undo and redo keep them as
 * they are now, so Ctrl+Z undoes the last change to the drawing and nothing
 * else, unless that change itself set one of them (deleting the output's
 * link, for example, resets the output).
 */
export const KEPT_BY_UNDO = ['units', 'lockDesign', 'output', 'motion', 'meta', 'layers', 'cad'];

/** The kept settings as text, to compare before and after a change. */
export const settingsText = (doc) => KEPT_BY_UNDO.map((k) => JSON.stringify(doc[k] ?? null));

/** Which kept settings differ from `before` (settingsText) in doc. */
export function settingsChanged(before, doc) {
  const after = settingsText(doc);
  return KEPT_BY_UNDO.filter((k, i) => after[i] !== before[i]);
}

/**
 * The restored drawing of an undo or redo, with the kept settings of `now`
 * (the drawing on screen), except those the step itself changed.
 */
export function keepSettings(now, restored, changed = []) {
  for (const k of KEPT_BY_UNDO) {
    if (changed.includes(k)) continue;
    // an output on something that is not in the restored drawing cannot be kept
    if (k === 'output' && now.output && !outputValid(restored, now.output)) continue;
    if (now[k] === undefined) delete restored[k];
    else restored[k] = structuredClone(now[k]);
  }
  return restored;
}

export class History {
  constructor() { this.undoStack = []; this.redoStack = []; }

  /** Call BEFORE changing the document. Returns the new step. */
  push(doc, label) {
    const step = { label, json: snapshot(doc), image: doc.background && doc.background.image, changed: [] };
    this.undoStack.push(step);
    if (this.undoStack.length > DRAWING.undoLimit) this.undoStack.shift();
    this.redoStack.length = 0;
    return step;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo(doc) {
    const s = this.undoStack.pop();
    if (!s) return null;
    this.redoStack.push({ label: s.label, json: snapshot(doc), image: doc.background && doc.background.image, changed: s.changed });
    return { doc: restore(s), label: s.label, changed: s.changed };
  }

  redo(doc) {
    const s = this.redoStack.pop();
    if (!s) return null;
    this.undoStack.push({ label: s.label, json: snapshot(doc), image: doc.background && doc.background.image, changed: s.changed });
    return { doc: restore(s), label: s.label, changed: s.changed };
  }

  clear() { this.undoStack.length = 0; this.redoStack.length = 0; }
}

function snapshot(doc) {
  return JSON.stringify(doc, (k, v) => (k === 'image' ? undefined : v));
}

function restore(s) {
  const doc = JSON.parse(s.json);
  if (doc.background) doc.background.image = s.image;
  return doc;
}
