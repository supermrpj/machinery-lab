// =============================================================================
// fileio.js — save and open .linklab.json files
// =============================================================================

import { FORMAT, FORMAT_VERSION, createDocument, drawingId } from './document.js';

/** Document → file text. */
export function serialize(doc) {
  const { session, ...saved } = doc;   // the window's id for the drawing is not part of the file
  return JSON.stringify({ ...saved, savedWith: 'LinkLab', savedAt: new Date().toISOString() }, null, 1);
}

/**
 * File text → document. Throws an Error with a plain-language message if the
 * file is not a LinkLab document.
 */
export function deserialize(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('This file is not a LinkLab file (it could not be read as JSON).'); }
  if (!data || data.format !== FORMAT) throw new Error('This file is not a LinkLab mechanism file.');
  if (data.version > FORMAT_VERSION) throw new Error('This file was made by a newer version of LinkLab. Please update LinkLab to open it.');
  // fill in anything missing from older files
  const base = createDocument();
  const doc = { ...base, ...data };
  doc.layers = { ...base.layers, ...(data.layers || {}) };
  doc.motion = { ...base.motion, ...(data.motion || {}) };
  doc.driver = { type: 'rotary', ref: null, ...(data.driver || {}) };
  delete doc.savedWith; delete doc.savedAt;
  doc.session = drawingId();   // an opened file is a drawing of its own in this window
  return doc;
}
