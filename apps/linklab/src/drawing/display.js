// =============================================================================
// display.js — text size, arrow size and arrow colours on the drawing
// -----------------------------------------------------------------------------
// Chosen in Sheet › Display and kept in this browser (config.js DISPLAY), not
// in the drawing file. The renderer reads them through app.display:
//   text    multiplies every label, value, link number and joint name
//   arrow   multiplies the length, width and head of force, load and torque arrows
//   colors  overrides THEME.load / reaction / weight / torque ('' = default)
//   angleStep  tick spacing of an angle x-axis on the plots (degrees, 0 = automatic)
// =============================================================================

import { DISPLAY, THEME } from '../config.js';
import { safeStorage } from '../../../../packages/ui-kit/src/files.js';

export const FONT = 'system-ui, "Segoe UI", sans-serif';

const isColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

/** The default display: sizes as designed, colours from THEME. */
export function defaultDisplay() {
  return { text: 1, arrow: 1, angleStep: 0, colors: {} };
}

/** Read the saved display; anything unknown or damaged falls back to the default. */
export function loadDisplay() {
  const d = defaultDisplay();
  try {
    const v = JSON.parse(safeStorage.get(DISPLAY.storeKey) || 'null');
    if (!v) return d;
    if (DISPLAY.textSizes.includes(v.text)) d.text = v.text;
    if (DISPLAY.arrowSizes.includes(v.arrow)) d.arrow = v.arrow;
    if (DISPLAY.angleSteps.includes(v.angleStep)) d.angleStep = v.angleStep;
    for (const k of Object.keys(DISPLAY.colors)) if (v.colors && isColor(v.colors[k])) d.colors[k] = v.colors[k];
  } catch { /* use the default */ }
  return d;
}

export function saveDisplay(d) {
  safeStorage.set(DISPLAY.storeKey, JSON.stringify(d));
}

/** The colour for one kind of arrow: the chosen one, else the default in THEME. */
export function arrowColor(d, kind) {
  return (d && d.colors && d.colors[kind]) || THEME[kind];
}

/** True when nothing differs from the default. */
export function isDefaultDisplay(d) {
  return d.text === 1 && d.arrow === 1 && !d.angleStep && !Object.keys(d.colors).length;
}
