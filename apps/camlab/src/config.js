// =============================================================================
// CamLab CONFIG — adjustable settings in one place
// -----------------------------------------------------------------------------
// Lengths in millimetres, angles in degrees, forces in newtons, mass in kg,
// screen sizes in CSS pixels, unless stated.
// =============================================================================

export const APP = {
  name: 'CamLab',
  version: '0.3.0',
  fileExtension: '.camlab.json',
};

// ---- Basic and Advanced ---------------------------------------------------------------
// Basic (the default) keeps every design input and tool and leaves out the
// analysis that comes later in the course: sizing and dynamics.
export const MODE = {
  storeKey: 'camlab.mode',
  default: 'basic',
  advancedPlots: ['size', 'forces', 'dynamics'], // plot sets shown only in Advanced
  advancedInputs: ['spring'],            // input sections shown only in Advanced
  advancedResults: ['size', 'spring'],   // result sections shown only in Advanced
};

// ---- the centre: the cam beside a set of plots -------------------------------------------
// rows: s v a j (motion), phi (pressure angle), rho (radius of curvature),
// F (cam force), T (camshaft torque); see ui/views/plotset.js.
export const PLOTS = {
  sets: [
    { id: 'motion', name: 'Motion: s, v, a, j', rows: ['s', 'v', 'a', 'j'] },
    { id: 'size', name: 'Size: pressure angle, ρ', rows: ['phi', 'rho'] },
    { id: 'forces', name: 'Forces: Fc, torque', rows: ['F', 'T'] },
    { id: 'dynamics', name: 'Motion and force: s, a, Fc', rows: ['s', 'a', 'F'] },
  ],
  layouts: [
    { id: 'both', name: 'Cam + plots' },
    { id: 'cam', name: 'Cam' },
    { id: 'plots', name: 'Plots' },
  ],
  camShare: 0.45,        // width of the cam beside the plots (fraction; drag the line to change)
  minShare: 0.2,
  storeKey: 'camlab.layout',
};

// ---- design rules shown in the checks (Week 11-12 slides) ----------------------
export const RULES = {
  pressureAngleMaxDeg: 35,   // acceptable pressure angle (translating roller follower)
  primeRadiusPerStroke: 3,   // rule of thumb: prime circle radius ≈ 3 × the stroke
  rhoPerRollerRadius: 2,     // keep |ρ min| at least 2–3 × the roller radius
};

// ---- sampling --------------------------------------------------------------------
export const SAMPLING = {
  pointsPerTurn: 1440,       // plots, checks and the drawn profile (every 0.25°)
  exportPointsPerTurn: 720,  // points in the exported profile (every 0.5°)
};

// ---- graphical construction ------------------------------------------------------
export const CONSTRUCTION = {
  divisions: [8, 12, 18, 24, 36],
  defaultDivisions: 12,
};

// ---- animation ---------------------------------------------------------------------
export const ANIMATION = {
  displayDegPerSecond: 60,   // how fast the cam turns on screen at 1×
  speeds: [0.25, 0.5, 1, 2, 4],
};

// ---- mounting the cam on its shaft (Part and mounting; model/mounting.js) ----------------
// Sizes in mm. The keyway, the flat and the set screw sit on +y of the
// exported cam: towards the follower when θ = 0 (the start of the program).
export const MOUNTING = {
  kinds: [
    { id: 'plain', name: 'Plain bore' },
    { id: 'keyway', name: 'Bore with keyway' },
    { id: 'dflat', name: 'D-flat bore' },
    { id: 'setscrew', name: 'Hub with set screw' },
    { id: 'flange', name: 'Bolt-circle flange' },
  ],
  clearance: 0.2,      // default: added to the bore Ø, key width and flat (3-D print); 0 for a machined part
  minWall: 2,          // thinnest wall left round a hole or slot before a warning
  flatRatio: 0.9,      // D-flat: across-flats ≈ this × shaft Ø (5 mm motor shaft: 4.5)
  hubHeight: 10,
  // parallel keys, DIN 6885 / ISO R773: shaft Ø up to dMax → key width b and hub keyway depth t2
  keys: [
    { dMin: 6, dMax: 8, b: 2, t2: 1.0 },
    { dMin: 8, dMax: 10, b: 3, t2: 1.4 },
    { dMin: 10, dMax: 12, b: 4, t2: 1.8 },
    { dMin: 12, dMax: 17, b: 5, t2: 2.3 },
    { dMin: 17, dMax: 22, b: 6, t2: 2.8 },
    { dMin: 22, dMax: 30, b: 8, t2: 3.3 },
    { dMin: 30, dMax: 38, b: 10, t2: 3.3 },
    { dMin: 38, dMax: 44, b: 12, t2: 3.3 },
    { dMin: 44, dMax: 50, b: 14, t2: 3.8 },
    { dMin: 50, dMax: 58, b: 16, t2: 4.3 },
  ],
  // screws: clearance hole (ISO 273 medium), tap drill, heat-set insert hole
  screws: {
    M3: { clear: 3.4, tap: 2.5, insert: 4.0 },
    M4: { clear: 4.5, tap: 3.3, insert: 5.6 },
    M5: { clear: 5.5, tap: 4.2, insert: 6.4 },
  },
  boltCounts: [3, 4, 6],
};

// ---- drawing colours (canvas) --------------------------------------------------------
export const THEME = {
  paper: '#F4F5F1',
  grid: 'rgba(30, 40, 60, 0.06)',
  ink: '#1D2433',
  muted: '#6B7280',
  cam: '#F4C7A1',            // cam body fill
  camEdge: '#B0532A',
  pitch: '#7B3FA0',          // pitch curve
  circles: '#2A78D6',        // base and prime circles
  follower: '#3D4A5C',
  roller: '#FFFFFF',
  spring: '#5B6474',
  normal: '#B0186A',         // common normal and pressure angle
  warn: '#E5484D',           // undercut, too-small radius of curvature
  construction: '#0F6F7C',   // graphical method: radial lines, stations
  segment: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
};
