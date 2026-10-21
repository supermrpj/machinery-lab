// =============================================================================
// history.js — undo / redo by snapshots
// -----------------------------------------------------------------------------
// The document is small, so each change stores a full JSON copy. The
// background image (which can be large) is kept by reference: snapshots share
// the same image string instead of copying it.
// =============================================================================

import { DRAWING } from '../config.js';

export class History {
  constructor() { this.undoStack = []; this.redoStack = []; }

  /** Call BEFORE changing the document. */
  push(doc, label) {
    this.undoStack.push({ label, json: snapshot(doc), image: doc.background && doc.background.image });
    if (this.undoStack.length > DRAWING.undoLimit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo(doc) {
    const s = this.undoStack.pop();
    if (!s) return null;
    this.redoStack.push({ label: s.label, json: snapshot(doc), image: doc.background && doc.background.image });
    return { doc: restore(s), label: s.label };
  }

  redo(doc) {
    const s = this.redoStack.pop();
    if (!s) return null;
    this.undoStack.push({ label: s.label, json: snapshot(doc), image: doc.background && doc.background.image });
    return { doc: restore(s), label: s.label };
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
