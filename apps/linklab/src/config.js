// =============================================================================
// LinkLab CONFIG — adjustable settings in one place
// -----------------------------------------------------------------------------
// Change values here rather than inside the code. Lengths are in millimetres,
// angles in degrees unless stated, screen sizes in CSS pixels.
// =============================================================================

export const APP = {
  name: 'LinkLab',
  version: '0.11.0',
  fileExtension: '.linklab.json',
};

// ---- numerical solver -------------------------------------------------------
export const KINEMATICS = {
  positionTolerance: 1e-10, // relative to mechanism size
  maxIterations: 60,
  maxStepHalvings: 14,      // how hard to try before declaring a limit position
  branchJumpFactor: 4,      // larger = more tolerant of fast motion per step
  sweepStepDeg: 1,          // resolution of plots (degrees of input per point)
  dragSweepStepDeg: 6,      // coarser while a joint is being dragged; full detail on release
};

// ---- following the path of motion (kinematics/path.js) ------------------------
// Lengths are fractions of the mechanism's size (its longest link, roughly).
export const PATH = {
  maxStep: 0.02,            // longest step along the path
  minStep: 1e-7,            // give up below this (a dead end or a jam)
  maxCorrection: 0.5,       // corrector may move at most this × the step
  minTangentCos: 0.94,      // the path may turn at most ~20° within one step
  maxCorrectorIterations: 12,
  maxSamples: 6000,         // safety limit for one sweep
  dragStepFactor: 4,        // longer steps (× maxStep) while a joint is being dragged
  animMaxStepPerFrame: 0.04, // fastest the mechanism moves on screen (× size per frame at 1×)
  specialSnap: 0.004,       // how close (× size) counts as "at" a toggle or stationary position
};

// ---- animation ----------------------------------------------------------------
export const ANIMATION = {
  defaultOmega: 10,         // rad/s, motor speed used for velocity/acceleration
  defaultSpeed: 20,         // mm/s, linear input speed used for velocity/acceleration
  displayDegPerSecond: 60,  // how fast a motor input turns on screen at speed 1×
  strokeSeconds: 4,         // time for a linear input to travel its stroke at 1×
  speeds: [0.25, 0.5, 1, 2, 4],
};

// ---- drawing and snapping ----------------------------------------------------
export const DRAWING = {
  snapRadiusPx: 12,         // how close the cursor must be to snap
  pickRadiusPx: 8,          // how close the cursor must be to select a line
  gridMinorMm: 10,
  gridMajorMm: 50,
  initialZoom: 2.5,         // pixels per mm
  minZoom: 0.05,
  maxZoom: 200,
  linkWidthPx: 14,          // drawn width of a link bar
  jointRadiusPx: 5,
  groundSizePx: 16,
  undoLimit: 200,
  compassDefaultRadius: 40, // mm
};

// ---- drawing colours ------------------------------------------------------------
export const THEME = {
  paper: '#F4F5F1',          // drawing sheet
  gridMinor: 'rgba(60, 72, 90, 0.07)',
  gridMajor: 'rgba(60, 72, 90, 0.14)',
  axis: 'rgba(60, 72, 90, 0.28)',
  ink: '#1D2433',            // joints, outlines, text
  graphite: '#4E5562',       // construction lines (like pencil)
  graphiteLight: 'rgba(78, 85, 98, 0.55)',
  ground: '#1D2433',
  trace: '#0F6F7C',          // coupler curves
  load: '#A15C07',           // external forces and torques
  counterweight: '#F4A7A7',  // balancing counterweights (fill)
  reaction: '#1D2433',       // joint forces in a free-body diagram
  torque: '#B0186A',         // the input torque (T₁₂), apart from the motor symbol
  weight: '#5B6474',         // weight and inertia forces
  select: '#1E5BD7',         // selection highlight
  snap: '#D1462F',           // snap marker
  preview: '#1E5BD7',        // tool previews
  input: '#1D2433',          // the input (motor / actuator) marker
  output: '#7A3E9D',         // the output marker
  bodyAlpha: 0.28,           // fill opacity of attached outlines
  fadedAlpha: 0.3,           // opacity of a "faded" layer
};

// ---- display: size of text and arrows, arrow colours (Sheet › Display) ----------
// Kept on each computer, not in the drawing file, so a projector can use
// bigger text without changing anyone's drawings. The sizes multiply the
// screen sizes used in drawing/render.js (1 = as designed).
export const DISPLAY = {
  storeKey: 'linklab.display',
  textSizes: [1, 1.25, 1.5, 2],     // "Text size": labels, values, link numbers, joint names
  arrowSizes: [1, 1.5, 2, 2.5],     // "Arrow size": forces, loads and torques
  angleSteps: [0, 15, 30, 45, 60, 90], // "Angle axis ticks" on the plots, degrees (0 = automatic)
  colors: {                         // arrow colours that can be changed (defaults are in THEME)
    load: 'Applied forces and torques',
    reaction: 'Joint forces (F₁₂, F₃₂, …)',
    weight: 'Weight and inertia (mg, −ma)',
    torque: 'Input torque (T₁₂)',
  },
  basicColors: ['load'],            // the ones shown in Basic (the rest belong to force analysis)
};

// ---- link colours (Norton numbering: 2, 3, 4, …) ---------------------------
// The same colour marks a link on the drawing and in every plot. This order
// passes colour-blind separation checks for neighbouring colours; links are
// also labelled with their number so colour is never the only cue.
export const LINK_COLORS = [
  '#2a78d6', // link 2 (input)
  '#eb6834', // link 3
  '#1baf7a', // link 4
  '#eda100', // link 5
  '#e87ba4', // link 6
  '#008300', // link 7
  '#4a3aa7', // link 8
  '#e34948', // link 9
];

// Coupler curves (traced points P1, P2, …) unless a colour is picked for one.
export const TRACE_COLORS = ['#0F6F7C', '#7B3FA0', '#B5462E', '#3D6B1F', '#1F4E9E', '#9C6B00'];

// ---- Basic and Advanced -----------------------------------------------------------
// Basic (the default) keeps every drawing tool and leaves out the force
// analysis: the Forces and Balancing tabs, force plots, link masses, and the
// forces drawn on the mechanism. A drawing with forces switched on keeps them;
// they show again in Advanced.
export const MODE = {
  storeKey: 'linklab.mode',
  default: 'basic',
  advancedTabs: ['forces', 'balance', 'tolerance'],   // side-panel tabs shown only in Advanced
};

// ---- force analysis -------------------------------------------------------------
export const FORCES = {
  // In dynamic mode, positions this close to a toggle position (input travel)
  // are left out of force plots and of the largest values: at a constant input
  // speed the forces there grow without limit.
  toggleWindowDeg: 3,       // for a motor (degrees of input travel)
  toggleWindowStroke: 0.02, // for a linear input (fraction of the whole travel)
};

// ---- tolerance study (pin play and hole position error) ----------------------
export const TOLERANCE = {
  clearance: 0.2,     // default hole Ø − pin Ø (mm), typical for 3D-printed parts
  holePosition: 0,    // default hole position error (mm, radius of the zone); optional, off at first
  builds: 100,        // default number of random builds
  maxBuilds: 2000,
  maxPoses: 180,      // input positions checked per build (at most)
  worstDirections: 90, // directions tried for the worst-case deviation (over half a turn)
  linearCheck: 0.2,   // the linear answer is used only where the full equations agree within this fraction
  followIterations: 400, // steps of the smooth push (Tolerance › When you drag › Follow the mouse)
  bandColor: '#B5462E',
  bandAlpha: 0.22,
  // drawing the clearance: it is far too small to see at true size, so the
  // pins, the shifted mechanism and the band are drawn larger (Tolerance › Play drawn)
  magnify: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000],
  autoGapPx: 6,       // "Auto" picks the size at which the pin's play is about this many pixels
  autoMaxDrawn: 0.4,  // …but no larger than makes the checked point's play, drawn, this fraction of the mechanism's size
  // typical clearances (hole Ø − pin Ø, mm) for pins of about 6–10 mm
  presets: [
    { label: '3D print (FDM)', c: 0.3 },
    { label: 'Drilled, loose fit H11/c11', c: 0.15 },
    { label: 'Reamed, sliding fit H7/g6', c: 0.015 },
    { label: 'Ball bearing', c: 0.01 },
  ],
  floatForce: 1e-6,   // N: a pin carrying less than this has no side to sit on
  // knocks: where a pin's force passes near zero and comes back the other way
  knock: {
    windowDeg: 6,     // look this far either side (degrees of input; 1/90 of the cycle for a linear input)
    minFraction: 0.2, // the pin's force must drop below this fraction of its largest
    minTurnDeg: 120,  // and its direction must turn at least this much across the window
    minJump: 0.1,     // report a knock when the output jumps at least this fraction of its play
  },
  // the magnifier at the checked point (on the drawing)
  lens: { radiusPx: 84, gapPx: 46 },
  zoneColor: '#B5462E',  // where it can be (worst case)
  loadColor: '#E8622C',  // where it sits under the load
  knockColor: '#C0392B',
};
