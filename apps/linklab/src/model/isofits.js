// =============================================================================
// isofits.js — ISO 286 limits and fits for a pin in a hole
// -----------------------------------------------------------------------------
// isoFit(hole, shaft, d) → the clearance limits of e.g. an H7 hole and a g6
// pin of nominal diameter d (mm): { min, max, mean, hole: {es, ei}, shaft:
// {es, ei} } in mm. Holes are H (lower deviation 0); shafts c, d, e, f, g, h
// (clearance fits: upper deviation ≤ 0). Grades IT5–IT11, sizes up to 500 mm.
// Tables: ISO 286-1 (IT grades and fundamental deviations, µm).
// =============================================================================

// ---- CONFIG -------------------------------------------------------------------
/** Size steps (mm, "over … up to and including"). */
const STEPS = [3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500];
/** Standard tolerance IT5–IT11 (µm) for each step. */
const IT = {
  5: [4, 5, 6, 8, 9, 11, 13, 15, 18, 20, 23, 25, 27],
  6: [6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40],
  7: [10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63],
  8: [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97],
  9: [25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155],
  10: [40, 48, 58, 70, 84, 100, 120, 140, 160, 185, 210, 230, 250],
  11: [60, 75, 90, 110, 130, 160, 190, 220, 250, 290, 320, 360, 400],
};
/** Shaft upper deviation es (µm) for each step; c changes within some steps (finer list). */
const ES = {
  c: { steps: [3, 6, 10, 18, 30, 40, 50, 65, 80, 100, 120, 140, 160, 180, 200, 225, 250, 280, 315, 355, 400, 450, 500],
    es: [-60, -70, -80, -95, -110, -120, -130, -140, -150, -170, -180, -200, -210, -230, -240, -260, -280, -300, -330, -360, -400, -440, -480] },
  d: { steps: STEPS, es: [-20, -30, -40, -50, -65, -80, -100, -120, -145, -170, -190, -210, -230] },
  e: { steps: STEPS, es: [-14, -20, -25, -32, -40, -50, -60, -72, -85, -100, -110, -125, -135] },
  f: { steps: STEPS, es: [-6, -10, -13, -16, -20, -25, -30, -36, -43, -50, -56, -62, -68] },
  g: { steps: STEPS, es: [-2, -4, -5, -6, -7, -9, -10, -12, -14, -15, -17, -18, -20] },
  h: { steps: STEPS, es: STEPS.map(() => 0) },
};
/** The classes offered in the panel. */
export const ISO_HOLES = ['H6', 'H7', 'H8', 'H9', 'H10', 'H11'];
export const ISO_SHAFTS = ['c11', 'd9', 'd10', 'e7', 'e8', 'e9', 'f6', 'f7', 'f8', 'g5', 'g6', 'g7', 'h5', 'h6', 'h7', 'h8', 'h9'];
/** Common pairs, for the list: [hole, shaft, name]. */
export const ISO_PAIRS = [
  ['H11', 'c11', 'loose running'], ['H9', 'd9', 'free running'], ['H8', 'f7', 'close running'],
  ['H7', 'f7', 'close running'], ['H7', 'g6', 'sliding'], ['H7', 'h6', 'locational clearance'],
];
// -------------------------------------------------------------------------------

const stepIndex = (steps, d) => steps.findIndex((s) => d <= s);

/** Parse "H7" → { letter: 'H', grade: 7 }; null if not a class this file knows. */
export function parseClass(text) {
  const m = /^([A-Za-z])(\d{1,2})$/.exec(String(text || '').trim());
  if (!m) return null;
  const grade = +m[2];
  if (!IT[grade]) return null;
  const letter = m[1];
  if (letter === 'H' || ES[letter]) return { letter, grade };
  return null;
}

/**
 * Limits of an ISO clearance fit, in mm: hole class (H6…H11), shaft class
 * (c11, d9, … h9) and nominal diameter d (mm, 0 < d ≤ 500). Null when the
 * classes or the size are outside the tables.
 */
export function isoFit(hole, shaft, d) {
  const H = parseClass(hole), S = parseClass(shaft);
  if (!H || !S || H.letter !== 'H' || !ES[S.letter] || !(d > 0) || d > 500) return null;
  const k = stepIndex(STEPS, d);
  const itH = IT[H.grade][k] / 1000, itS = IT[S.grade][k] / 1000;
  const table = ES[S.letter];
  const es = table.es[stepIndex(table.steps, d)] / 1000;
  const holeLim = { es: itH, ei: 0 }, shaftLim = { es, ei: es - itS };
  const min = holeLim.ei - shaftLim.es, max = holeLim.es - shaftLim.ei;
  return { hole: holeLim, shaft: shaftLim, min, max, mean: (min + max) / 2 };
}
