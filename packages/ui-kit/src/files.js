// =============================================================================
// files.js — save and open files from a web page (works offline, file://)
// -----------------------------------------------------------------------------
// PLATFORM SEAM: this is the only file that talks to the operating system.
// A desktop (Tauri .exe / .app) or iPad build replaces it with a version that
// uses native Save/Open dialogs; nothing else in the apps needs to change.
// Keep every function's name and behaviour the same in any replacement.
// =============================================================================

/** Offer a text or Blob as a download with the given file name. */
export function downloadFile(name, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Ask the user to pick a file; resolves with the File (or null). */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
    input.click();
  });
}

// ---- save and open with the system's own file dialogs ---------------------------
// Chrome and Edge (Windows, Mac) can show a real Save dialog and write back to
// the same file later. Safari, iPad and Firefox cannot; there the functions
// fall back to a download and a file picker, so callers never need to care.

/** True when the browser can ask where to save and write back to that file. */
export const canChooseSaveLocation = () => typeof window.showSaveFilePicker === 'function';

const isAbort = (err) => err && (err.name === 'AbortError');

/**
 * Save text or a Blob.
 *   handle  a file handle from an earlier save/open: write straight to it
 *   saveAs  always ask for a location and name
 *   types   [{ description, accept: { 'mime/type': ['.ext'] } }] for the dialog
 * Resolves with { name, handle, downloaded } or null if the user cancelled.
 * `handle` is null and `downloaded` true when the file went to Downloads.
 */
export async function saveFile(name, content, { handle = null, saveAs = false, types, type = 'application/json' } = {}) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  if (canChooseSaveLocation()) {
    try {
      let h = saveAs ? null : handle;
      if (h && h.requestPermission && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') h = null;
      if (!h) h = await window.showSaveFilePicker({ suggestedName: name, types });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return { name: h.name, handle: h, downloaded: false };
    } catch (err) {
      if (isAbort(err)) return null;
      // anything else (blocked by policy, read-only location): fall back to a download
    }
  }
  downloadFile(name, blob);
  return { name, handle: null, downloaded: true };
}

/**
 * Ask the user to open a file. Resolves with { file, handle } (handle is null
 * where the browser cannot write back) or null if cancelled.
 */
export async function openFile(accept, types) {
  if (typeof window.showOpenFilePicker === 'function') {
    try {
      const [h] = await window.showOpenFilePicker({ types, multiple: false });
      return { file: await h.getFile(), handle: h };
    } catch (err) {
      if (isAbort(err)) return null;
    }
  }
  const file = await pickFile(accept);
  return file ? { file, handle: null } : null;
}

export const readText = (file) => file.text();

export function readDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** localStorage that never throws (it can be blocked in private windows). */
export const safeStorage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};
