# Changelog

All notable changes are listed here, newest first. LinkLab and CamLab have
their own version numbers.

## CamLab [0.3.0] — 2026-10-19

### Changed
- CamLab is now laid out for designing by the analytical method: the cam
  turns beside a set of plots with one cursor, in place of the five view
  tabs. Plot sets: **Motion** (s, v, a, j), **Size** (φ, ρ), **Forces** (Fc,
  Tc) and **Motion and force** (s, a, Fc). Show the cam, the plots or both,
  and drag the line between them.
- The **graphical method** is a tutorial (top bar), drawn for the current
  design over the centre, from step 1.
- Each plot's title bar gives the value at the cursor and the largest and
  smallest values. **Copy** and **CSV** give the numbers of the plots shown.
  In Advanced, the motion bar also gives Fc and Tc at the cursor.
- Infinite acceleration and jerk are drawn as spikes (arrows the way the
  jump goes, both ways for a doublet) instead of a small ∞ label, and the
  title bar gives max ∞ / min −∞ there.
- Spring and forces: where the velocity jumps, the cam force and torque are
  infinite too (the sampled values miss it). They are now drawn as spikes on
  the Fc and Tc plots, the check reads *Infinite cam force*, and the largest
  and smallest force read ∞ and −∞ (−∞: the follower leaves the cam whatever
  the spring).
- The cam fills its pane at the start and refits when the pane changes size
  (until you pan or zoom).

### Added
- **Part and mounting:** print clearance, and how the cam fixes to its
  shaft: plain bore, bore with a DIN 6885 keyway, D-flat bore, hub with a
  radial set-screw hole (heat-set insert or tapped), or a bolt circle for a
  flange coupling; sizes worked out from the shaft Ø, with fit checks. The
  keyway, flat or screw faces the follower at θ = 0.
- **STEP export:** the part as an exact solid for CAD (AP214). Checked with
  OpenCASCADE: one valid solid for every mounting.
- The STL includes the mounting (keyway, flat, bolt holes, hub and its
  set-screw hole); the DXF has the mounting on its own layers.

## CamLab [0.2.2] — 2026-10-19

### Added
- CamLab results panel: **Polynomial coefficients** of every polynomial
  segment and of 3-4-5 and 4-5-6-7 rises and falls, as s = lift × (Σ cₖ xᵏ)
  with x = θ/β (Ex 8-8: 64x³ − 192x⁴ + 192x⁵ − 64x⁶, as on the slide).

## LinkLab [0.11.0] — 2026-10-15

### Changed
- LinkLab **Tolerance** tab, rebuilt for practical use. It checks the
  output (a link's angle, a slider along its rail) or any joint, and gives:
  the **play** (the most it can be off, every pin at its worst side), where it
  is **under the load** (each pin pushed against the side of its hole away
  from the push, from the force analysis), the largest play over the cycle,
  the **knocks** (where a pin force passes zero and turns round, so the pin
  crosses its hole and the output jumps), and which pin to improve (or that
  every pin counts the same in one loop with one clearance).
- Clearance presets (3D print, drilled H11/c11, reamed H7/g6, ball bearing)
  and a clearance for each pin that differs.
- On the drawing: a **magnifier** beside the checked point instead of the
  band drawn 50× over the mechanism; the exaggerated drawing is now an
  option and shows the pins where the load puts them.
- The *Tolerance* plot preset: the error from pin clearance (play either way
  and under the load, knocks marked K), joint forces and their directions.
- Checked in `tests/tolerance.test.js` against hand cases, virtual work and
  the full nonlinear solver.

### Added
- LinkLab **bearing loads**: joint forces as a polar diagram (size and
  direction over the cycle, the input angle marked along it, the arrow at the
  position shown) and the joint force direction ∠F against the input, each
  with directions fixed to the frame or turning with a chosen link, and a
  *Bearing loads* preset (Advanced).

## LinkLab [0.10.0] and CamLab [0.2.1] — 2026-10-15

### Changed
- LinkLab **Tolerance** tab, made clearer: one point at a time, and the pin
  clearance shown on the drawing (on/off), drawn larger so it can be seen
  (Auto or a chosen size): each hole as a ring with its pin pushed to one
  side, a dashed copy of the mechanism with every pin pushed the way that
  moves the point most, an arrow to where the point ends up, and the band
  round its path over the cycle. The panel gives the deviation at this
  position with each pin's share, and the largest over the cycle (Go there).
  It follows every change (linear worst case); random builds and hole
  position error are optional (hole error now 0 at first).
- LinkLab: the rotor balancing calculator opens on an empty sheet too.

### Added
- LinkLab plot **presets**: Output motion, Link motion, Transmission, Point
  path, and in Advanced Forces, Balancing, Energy and Tolerance.
- LinkLab Balancing plots: with counterweights in use, the shaking force,
  shaking moment and input torque also show the curve without them (dashed).
- LinkLab plot quantity *Path deviation, pin clearance* (Advanced).
- LinkLab energy plots: potential energy (gravity) and kinetic, potential and
  total energy together, with an *Energy* preset (energies, input torque,
  link ω). With no applied loads the torque is the slope of the total energy
  (checked in `tests/energy.test.js`).
- LinkLab rotor calculator: **Examples** (a car wheel, single plane; a shaft
  with three discs, statically balanced but needing two planes), and
  **Before the correction**: Σ m·R, Σ m·R·l, the shaking force and moment at
  the speed given, and a graph of it against speed.
- Plots (LinkLab and CamLab): an angle x-axis is marked every 15°, 30°, 45°,
  60° or 90° (as the width allows) instead of 50° or 100°; LinkLab can fix it
  for all plots (Sheet › Display › Angle axis ticks).
- Plots (LinkLab and CamLab): an **axes** button beside ⤢ (and *Axes…* in
  the large window) to type where each axis starts and ends, and the tick
  spacing of each; empty is automatic. Double-click puts both axes back to automatic. LinkLab plot text
  follows Sheet › Display › Text size.

### Fixed
- LinkLab: plots "Input from 0°" started at the first step after 0° (for
  example 0.37°) instead of 0°. A full-turn cycle now has a sample exactly at
  0°, so the plots run from 0° to 360°.

## LinkLab [0.9.0] — 2026-10-14

### Added
- **Tolerance** tab (Advanced): pin clearance (hole Ø − pin Ø) and hole
  position error, over the whole cycle. Gives the worst-case deviation of
  each traced point from its ideal path (linear, every error at its worst)
  and the largest and RMS deviation of random builds, and shades the
  worst-case band on the drawing (optionally drawn wider).
  `src/model/tolerance.js`, `src/ui/tolerancePanel.js`,
  `tests/tolerance.test.js`. The constraint builder takes optional hole
  offsets, and each pin constraint an optional gap (both zero normally).

## Released with LinkLab 0.9.0 — 2026-10-08

### Changed (both apps)
- Licence: GNU GPL v3 (`LICENSE`) with credit terms in `NOTICE.md`,
  replacing the freeware licence. The About box shows the credit, the
  licence and, once the GitHub username is set, links to the website, the
  source and GitHub Sponsors.

### Added
- LinkLab: **Sheet › Display** sets the text size (up to 200 %) and the arrow
  size (up to 250 %) on the drawing, and the colours of the force, load and
  torque arrows. Kept on each computer, not in the drawing. Value labels,
  tags, link numbers and joint names now keep clear of each other, and value
  labels are drawn on top of the arrows.

### Added (website and release)
- Website build: `npm run build` also makes `dist/web/` with a landing page,
  both apps (installable, work offline), and the single files to download.
  Published to GitHub Pages by `.github/workflows/pages.yml`.
- `NOTICE.md`, `CITATION.cff`, `CONTRIBUTING.md`, `.github/FUNDING.yml`,
  `tools/set-owner.mjs`, `tools/export-public.mjs`.

## LinkLab [0.8.0] and CamLab [0.2.0] — 2026-10-06

### Added (both apps)
- **Basic | Advanced** switch in the top bar. Both apps start in Basic,
  which keeps every drawing and design tool and hides the analysis that
  comes later in the course. The choice is remembered on each computer.
  - LinkLab Basic: Kinematics and Sheet tabs, plots without force
    quantities, no link masses in Properties, no forces drawn on the
    mechanism. Advanced adds the Forces and Balancing tabs and all of these.
    A drawing with forces switched on keeps them; a link to the Forces panel
    (in a note) switches to Advanced.
  - CamLab Basic: Graphical method, Cam and follower and SVAJ views; checks
    for the fundamental law, peaks and the Table 8-3 factors. Advanced adds
    the Pressure angle, ρ and Forces views, the spring inputs, and the size
    and spring checks. An undercut cam is still flagged in Basic.
- **Plots zoom.** Mouse wheel on a plot zooms the x-axis about the pointer,
  with the y-axis fitted to what is shown; Shift + wheel moves along;
  double-click shows everything again.
- **Plots open large.** The ⤢ button on each plot opens it in a window (Esc
  closes). It follows the cursor, zooms on its own, and can be clicked to
  move the mechanism or turn the cam.
- **Resizable plots.** LinkLab: drag the top edge of the plot drawer.
  CamLab: drag the line between two stacked plots. Double-click for the
  default; the size is remembered.
- Help explains both; the About box is also reached from Help (the version
  button hides on narrow screens).

### Changed
- CamLab: the Novice / Apprentice / Junior / Senior labels are gone from the
  law menu and the example names. The law's note shows as a tooltip instead.
- CamLab: a new test runs every built-in example the way the app does and
  compares 26 numbers with the slides (all within the slides' rounding).
- A plot always shows at least two y-axis labels.
- The top bar fits from 1024 px to wide screens without being cut off
  (labels give way to icons in steps).

### Fixed (CamLab, after an independent review)
- Export is blocked for a design that cannot be made (roller larger than the
  prime circle, prime circle inside the eccentricity, no base circle), and
  the STL is blocked when the bore would cut through the cam.
- STL header no longer starts with "solid" (some readers then take a binary
  file for text). DXF layers no longer carry a plot-style reference.
- The results list the design problems first; ∞ is shown in the peaks and
  factor table where the law is broken; flat-face contact is measured from
  the stem; ωn reads "— (no mass)" for a massless follower.
- The spring line on the Forces plot includes the preload; a follower jump
  over 360°/0° is reported as one range.
- Short programs get an implicit closing dwell; programs over 360° are cut.

## CamLab [0.1.0] — 2026-10-06

### Added
- First version: motion program (rise, dwell, fall, polynomial) with the
  laws from the Week 11-12 slides, graphical construction in five steps,
  animated cam and follower, SVAJ plots, pressure angle and radius of
  curvature, Week 13 dynamics (cam force, follower jump, camshaft torque),
  export as one closed DXF spline, profile points (txt/csv), STL for 3-D
  printing and a data CSV. Checked against every number in the slides.

## LinkLab [0.7.3] — 2026-10-06

### Changed (speed)
- **Dragging a joint is about 4× lighter.** Every mouse move used to
  recompute the whole cycle in full detail (all positions, the forces at
  each one in dynamic mode, and three plots), then rebuild the side panel.
  While dragging, the cycle is now worked out every 6° instead of every 1°,
  without the exact refinement of toggle and stationary positions. The plots
  are redrawn at most 10 times a second, and the side panel when the drag
  pauses. Full detail returns when you let go.
- **Playback is smoother.** Each plot keeps its curves as a picture and
  only redraws the cursor every frame. The side panel is rebuilt 4 times a
  second while playing (was 8). The total centre-of-mass path is no longer
  recomputed every frame.
- Measured on a CPU slowed 4× (a modest laptop), Example fourbar, dynamic
  mode: dragging 867 → 202 ms per mouse move; playback 10 → 16–20 frames/s.

## [0.7.2] — 2026-10-06

### Fixed
- **Ground pivot did not attach to the link.** Clicking the body of a link
  with the Ground pivot tool (G) placed a pivot that was not connected to the
  link, although the guide says the link should pivot there. It now pins the
  link there (Shift keeps the pivot separate, as with the Link tool).
- A click on a joint's circle now always picks that joint, even when a drawn
  point next to it (a construction end point, say) is a little nearer. Before,
  the Ground pivot, Link and Point on link tools could add a second,
  unconnected joint beside it.
- Ground pivot on two joints that only sit on top of each other joins them
  into one pin fixed to the ground.

## [0.7.1] — 2026-10-06

### Changed
- **Side panel in tabs.** Kinematics, Forces, Balancing and Sheet (layers,
  units and grid) sit on a rail at the right edge and one is shown at a
  time, instead of five stacked panels in one long scroll. Click the open
  tab (or the arrow by its title) to hide the panel and give the drawing the
  full width. Dots on Forces and Balancing show when they are on. The tab
  and hidden state are remembered; on a phone the panel starts hidden. Only
  the open tab is rebuilt, so the app does less work while it animates.
- The hint card can be shrunk to the tool's name (− / +), remembered.
- On screens 800 px high or less the tools are in two columns, so none is
  cut off. Below 1200 px wide the top-bar buttons show icons only. Fixed the
  page scrolling sideways at 1024 px and on phones.
- The input torque T₁₂ is drawn on a wider circle in its own colour, apart
  from the motor symbol (a short arc and the M disc).
- Notes that point to the Forces panel open it when clicked.
- **Ground tool on a joint added a separate pivot beside it** (not connected)
  when a drawn point near the joint took the snap. A click on a joint's
  circle now always means that joint, for every mechanism tool. Two joints
  that only sit on top of each other are joined into one ground pin. A
  ground pivot clicked onto the body of a link now pivots that link there
  (Shift keeps it separate).
- The hint's buttons can be clicked while the mechanism plays (the hint is
  only rebuilt when its text changes). The unit lists under Sheet update at
  once after a unit change. Very narrow windows scroll the top bar, not the
  page.

### Added
- **Colours for links and coupler curves** in Properties. Automatic by
  default (links by number; each traced point its own colour, also used in
  the plots); a picked colour stays with the link or point and is saved;
  *Automatic* goes back. Several coupler curves are no longer all one colour.
- **Materials for 3-D printing** (solid): PLA, ABS, PETG, ASA,
  polycarbonate and nylon (PA12), grouped with metals and sheet, plus a
  **custom density** in kg/m³ (with a note on partial infill). The density
  is in the link parameters export.

## [0.7.0] — 2026-10-06

### Added
- **Balancing panel** (below Forces).
  - Total centre of mass: how far it moves over the cycle, with an option to
    draw G total and its path.
  - Exact force balance of a fourbar (Berkof–Lowen, as in the Week 10
    slides): m·R and angle for a counterweight on the crank and on the
    rocker, in each link's own frame. Choose the radius and add them in one
    click. Other mechanisms: a counterweight that puts each ground-pivoted
    link's own centre of mass on its pivot.
  - Counterweights are point masses on a rod from the pivot, stored with the
    link and added to its m, G and I_G in all force results. They can be
    switched off to compare, and are drawn on the drawing (dashed when off).
  - Without/with table: largest shaking force, shaking moment, input torque
    and joint force over the cycle.
  - Rotor balancing calculator: single plane, two planes, and two planes
    from measured bearing forces, with an end view of the m·R vectors.
- Properties shows a link's counterweight and the link with it.
- `tests/balance.test.js`: Week 10 Examples 12-1 and 12-2, the fan example,
  and the fourbar of Example 2 (shaking force zero over a full turn after
  balancing).

## [0.6.3] — 2026-10-06

### Changed
- **Properties is a floating card** at the top right of the drawing. It
  appears when something is selected (or a tool with settings is in use, or
  the sheet is empty: then it shows how to start) and closes with × or Esc.
  It moves to the top left when it would cover the point just clicked. The
  side panel now holds Layers, Units and grid, Kinematics and Forces.

### Added
- **Units for force, torque, mass and moment of inertia** under *Units and
  grid*, with presets: SI in mm or m (N, N·m, kg, kg·m²), US in inches (lb,
  lb·in, blob, lb·in·s²) and US in feet (lb, lb·ft, slug, slug·ft²), or each
  chosen separately (also kN, N·mm, g, lbm, kg·mm², lbm·in²). Feet were added
  as a length unit. Everything is still stored in mm, N, kg, so switching
  changes only what is shown and typed: the Forces panel, the mass and force
  popups, free-body and load labels, gravity, plots and both data exports
  (column names carry the unit). A textbook problem in US units can be typed
  as given; `tests/units.test.js` types Week 9 Example 2 in inches, pounds
  and blobs and reads T₁₂ = 243.23 lb·in.

## [0.6.2] — 2026-10-05

### Fixed
- **A link could not be joined to the middle of another link.** Point on
  link (J) clicked on an existing joint made a second joint on top of it, so
  the links stayed loose (a reported fourbar showed 3 degrees of freedom).
  It now pins that joint to the link. The Link tool pins a new end to a link
  whose body it lands on. Two joints on one spot can be joined from the
  right-click menu (*Join with … (one pin)*) or by dragging one onto the
  other, and the Kinematics panel names such joints when the mechanism will
  not move.

### Added
- **Input tool (D):** click a pivot or link for a motor there, or an
  actuator or slider to drive with it; where several links meet it asks
  which one turns.
- **Eraser (Z):** click or drag across drawings to delete them; the
  mechanism is never erased.
- **Mass popup for each link** (right-click a link › *Mass and centre of
  mass…*, a row of the Masses table, or *Edit mass…* in Properties): mass
  from the shape or typed. A typed centre of mass G is given in the link's
  own frame, as in the textbook: from one of its joints along the line to
  another, as r ∠ θ or as x′, y′ (kept in step), or picked on the drawing.
  A small drawing of the link in that frame shows r, θ and G. G stays on the
  link when it moves or its lengths change (`link.mass.local`). With *I_G changes with m* ticked (the
  default when starting from the shape), a new mass keeps the shape's
  radius of gyration k (I_G = m k²); typing I_G unticks it.
- **Editing forces and torques:** double-click one on the drawing, right-click
  it (*Edit force…*, *Turns with the link*, *Delete*), click its row in the
  Loads table, or click it with the Force tool. A popup shows the same
  editor as Properties; changes apply at once. The point of action is now
  given like the centre of mass: r ∠ θ from a joint of the link, or picked
  on the drawing.
- **Plots: tick boxes to show or hide each line** (joint forces, link angles,
  points, …). Joint forces list every pin now, not only the first six.
- **Largest forces over the cycle:** a table in the Forces panel with each
  joint force's largest size, its direction at that moment and the input
  angle (or stroke) where it happens; the largest of all is highlighted, and
  clicking a row moves the mechanism there. In dynamic mode, positions within
  3° (or 2 % of a stroke) of a toggle position are left out of these values
  and of the force plots, because the forces there grow without limit at a
  constant input speed; the panel says so.
- **Masses guide:** a popup guide (with an animation) on setting masses,
  centres of mass and I_G: from the shape, from a drawn outline, or typed.
  It opens the first time forces are switched on or values are typed, and
  from the Guide buttons beside *Mass properties* and *Masses*, and in Help.

### Fixed (plots)
- *Input from 0°* (and *from here*) put the start of the sweep in the middle
  of the plot, so an angle that keeps turning (a gear, a crank-crank output,
  link angles) dropped back by its change over one turn there. Values from
  the second part of the turn are now carried on, so the curve is continuous.
- Clicking a plot whose x always increases now moves to the input under the
  click, not to the nearest point of the curve.
- A constant curve (a gear's velocity ratio) showed rounding noise of 10⁻¹²
  magnified to fill the plot; it is now drawn level.
- A crank that turns fully is shown as 0–360° everywhere (motion bar,
  read-outs, toggle list, largest-force angle), matching *Input from 0°*.

### Changed
- **Forces has its own panel**, apart from Kinematics (the old Analysis
  panel): Off / Static / Dynamic, Masses (with each link's m and I_G),
  Loads, results at this position, and what the frame feels.
- Tools are a little tighter on screens up to 1000 px high so all of them fit.

## [0.6.1] — 2026-10-05

### Added
- **Right-click menu** on the drawing (press and hold on a touch screen): make
  a link, pivot, actuator or slider the input, or its angle, x/y, length or
  position the output, in one click. It also locks, grounds, traces and
  deletes.
- Plot x-axis: input from 0°, input from the position shown (*Start here*),
  or time over one cycle.

### Changed
- Force names follow the textbook convention F₂₃ = force of link 2 on link 3
  (F₃₂ = −F₂₃) on free-body diagrams, in the Forces table, plots, CSV and the
  parameter export. Free-body diagrams label m₃g, −m₃a₃, −I₃α₃ and T₁₂.
- The joint-force plot follows the selection (forces on the selected link,
  or at the selected joint) and draws each force with its own dash, so
  coinciding curves (equal and opposite pin forces on a two-force member)
  stay readable.
- Toggle and stationary markers on plots are dotted lines with one label.

### Checked
- Dynamic forces over a whole crank turn (406 positions) for the Week 9
  fourbar, with and without gravity, against the textbook 9 × 9 matrix built
  from the closed-form kinematics: largest difference 10⁻¹³, and the
  largest force at each joint, its direction and its crank angle agree
  (`tests/cycle.test.js`).
- Every recent feature was run on every example (crank-rocker, inverted
  slider-crank, gear pair, planet, rack and pinion, cam, boom) and on a
  triple rocker, a slider-crank and a Watt six-bar: right-click menus, the
  mass popup on every link and wheel (typing the shape's own values leaves
  the forces unchanged), the force popup, the Input tool, the eraser (roll
  contours are kept), all plot x-axis choices and line tick boxes.
- The two worked examples of the Week 9 lecture (single link in pure
  rotation; fourbar with a force on the coupler and a torque on the rocker)
  are rebuilt and solved in a test. The fourbar matches every force and T₁₂
  on the slide to the figures printed (F₁₂ = −117.65, −107.84 lb … T₁₂ =
  243.23 lb·in). The single link agrees within 0.4 %, the slide having
  rounded a_G to 2001 in/s² at 208°; with the exact acceleration it agrees to
  10⁻⁹.

## [0.6.0] — 2026-10-05

### Added
- **Force analysis (rigid-body dynamics).** Static (held still) and dynamic
  (inverse dynamics at the input speed and acceleration) analysis for every
  joint type, by Lagrange multipliers on the same constraint equations as the
  kinematics: input torque or force, every joint force, slider and prismatic
  normal forces, rolling contact forces, actuator forces, shaking force and
  moment, force on the frame, kinetic energy. Redundant constraints (gears on
  fixed centres) are detected and the smallest force set is shown.
- **Mass properties** from link shape and material (bar, plate, wheel or the
  link's outlines; steel, aluminium, brass, acrylic, PLA, plywood; thickness
  and width), or typed per link.
- **Force or torque tool (E)** with constant, formula or table profiles over
  the cycle.
- **Free-body diagrams:** select a link to see the joint forces on it, its
  weight, inertia force and couple, and the motor torque.
- Force plots (input torque, joint forces, shaking force and moment, kinetic
  energy), force columns in the motion CSV, masses and forces in the link
  parameter export.
- Tests: statics by hand, a spinning crank, a fourbar against an independent
  Newton–Euler solution (agreement to 10⁻⁷), and power balance
  (T·ω = dKE/dt − applied power) over the cycle for every example.

### Checked
- An independent review rebuilt every link's balance from the reported
  forces (residuals ~10⁻¹³) for all examples and extra cases (inverted
  slider-crank, prismatic on a rotating guide, slider and prismatic inputs,
  relative motor, held actuator) and confirmed the power balance. Defects it
  found are fixed: gear contact force was √2 too big; forces at a toggle
  position in dynamic mode are now reported as unbounded instead of huge
  numbers; formulas accept only their own function names and the right number
  of arguments; table and time profiles repeat every cycle and time runs
  forward when the motor is reversed; free-body diagrams now include prismatic,
  contact and slider-input forces; a load whose formula gives no number is
  reported instead of dropped quietly.

### Fixed
- Solver polishing step: rows measured in radians (the input angle) are now
  converged to round-off. Velocities and accelerations are checked against
  numerical differentiation for every example and many random fourbars and
  slider-cranks.

## [0.5.0] — 2026-10-05

### Added
- **Motion through toggle positions.** LinkLab now follows the mechanism
  along its path of motion (arc-length continuation) instead of stepping the
  input angle. Animation passes through toggle positions — the input turns
  back while the mechanism flips between open and crossed assembly — with no
  stalling or chattering. Sweeps and plots cover the whole circuit (a rocking
  input plots as a closed loop). A slider driving a slider-crank passes its
  dead centres and turns the crank round.
- **Toggle and stationary positions** found over the whole motion and checked
  against the closed form (fourbar toggle angles, rocker extremes, slider-crank
  dead centres). Shown on the drawing (dashed line through the links in line,
  and a tag), in the motion bar, on the plots (T, S) and listed in Analysis.
  Can be switched off.
- **Dragging rests** at toggle and stationary positions until pulled clearly
  past; dragging the input beyond its limit stops at the toggle.
- **Units and grid:** show and type lengths in mm, cm, m or inches (saved with
  the drawing; plots and CSV/JSON exports follow it), choose a fixed grid
  spacing, and snap to the grid.

### Changed
- Stepping the input with ← → stops exactly at a toggle position.
- Clicking a plot picks the nearest point of the curve.
- At a toggle position the read-out explains that velocities are unbounded
  instead of showing huge numbers.

## [0.4.0] — 2026-10-05

### Added
- **Clear** in the top bar: clear everything, the mechanism only, the
  construction only, or the background picture. Each clear is one undo step.
- **Save** asks where to save the first time (Chrome, Edge) and then writes
  back to the same file; **Save as** (Ctrl+Shift+S) saves a copy. **Open**
  remembers the file so Save writes back to it. Safari, iPad and Firefox
  still save to Downloads.
- **Link parameters export** (Export › For further analysis), as CSV for
  Excel and JSON for MATLAB or Python: joint coordinates, velocities and
  accelerations; link lengths, angles, ω and α; each link's joints in its own
  frame; joint-to-joint distances; connections; and the input. Checked
  against the closed-form fourbar solution, including α₃, α₄ and joint
  accelerations.
- **Names** toggle: joint names J1, J2, … on the drawing, matching the
  exported data. Properties shows the selected joint's name.

### Changed
- The app no longer names a textbook author in its text (analysis panel,
  help, guides and exports).
- On laptop-width screens, Save as, Grid, Names and Fit show their icon only.

## [0.3.0] — 2026-10-02

### Added
- **Inputs and outputs.** Drive a mechanism with a motor at a ground pivot,
  a motor at any pin between two links, a linear actuator, a pushed slider,
  or a link pushed along a prismatic joint. Choose the output (a link angle,
  the x or y of a point, a slider position or an actuator length); it is
  marked on the drawing, reported with velocity, acceleration and velocity
  ratio, and plotted against the input.
- **Linear actuator tool (U)**: a hydraulic or electric cylinder between two
  joints or from a fixed mount, with stroke limits. Animation runs it in and
  out between the limits. An actuator that is not the input holds its
  length.
- **Move mechanism tool (H)**: moves the mechanism by hand and never changes
  the design.
- **Lengths lock** in the motion bar, and a per-link lock in Properties, so
  an accidental drag can't change link lengths.
- **Tool guides**: the first time a tool is chosen, a card shows a short
  looping animation of the clicks and the steps in words (animated demos for
  roll, roll + slip, prismatic, slider, wheel, actuator, link, compass,
  protractor, move and point-on-link). Reopen from the hint bar; switch off,
  browse or reset in Help.
- Example: boom lifted by a hydraulic cylinder.

### Changed
- New neubrutalist look for the interface (thick ink outlines, hard
  shadows, flat yellow / red / blue); the drawing sheet is unchanged. See
  docs/DESIGN.md §4.
- Fit (F) now keeps the whole cycle of motion in view and leaves room for
  the hint bar.
- Default output is the rack or follower for rack-and-pinion and cam
  mechanisms.
- Plots, CSV export and the motion bar use the chosen input (θ or stroke s).

## [0.2.0] — 2026-10-02

### Added
- Joint types for planar linkages: revolute (pin), prismatic (sliding,
  between any two links or on the ground), pin-in-slot on a fixed rail or on
  a moving link (inverted slider-crank), roll (pure rolling, no slip) and
  roll + slip (half joint), between wheels, circles, arcs, lines and link
  centre lines.
- Wheel tool (discs pinned at their centre: wheels, rollers, gear pitch
  circles). Gruebler count now separates J₁ (pins, sliding, rolling) and J₂
  (roll + slip), and explains redundant contacts.
- Realistic instruments: GeoEnzo-style steel compass with a pencil, and a
  new clear protractor (move, rotate, live angle reading, draw a line or
  mark a point at an angle).
- CAD export for SolidWorks, Inventor, Fusion 360 and AutoCAD: a layout DXF
  with layers, and a parts ZIP (one DXF sketch per link in its own frame
  with pin holes, a frame drawing, coupler paths as X Y Z point files, and a
  README with lengths and joint positions). Export dialog also offers PNG
  and CSV.
- Two-finger pan and pinch-zoom for iPad and touch screens.
- Built-in examples: inverted slider-crank, gear pair, planet on a fixed
  sun, rack and pinion, eccentric cam with a flat follower.
- docs/DESIGN.md (design and interaction guide), docs/ARCHITECTURE.md
  (layers, platforms, .exe and 3-D paths).

### Changed
- The solver is now built from constraint objects, so new joint types plug
  in without changing the solver. All earlier results are unchanged (tests).

## [0.1.0] — 2026-10-02

First usable version of LinkLab.

### Added
- Repository structure, freeware licence, legal notes, build tooling
  (single-file HTML output), development server.
- Shared math package: vectors, intersections, linear algebra.
- LinkLab kinematics engine: general constraint solver for any planar
  pin/slider linkage (position, velocity, acceleration), branch-following
  through the cycle, limit (toggle) detection, Gruebler and numeric DOF.
- Norton closed-form fourbar and offset slider-crank, Grashof classification,
  transmission angle; automatic tests that cross-check them against the
  general solver.
- Drawing sheet with four layers (background picture, construction,
  outlines, mechanism), each can be hidden, locked or faded.
- Drafting tools: point, line, construction line, movable compass (needle,
  pencil, knob), measure; exact snapping to ends, centres and intersections.
- Mechanism tools: ground pivot, link chains, point on link (coupler curves),
  slider on a line, outlines attached to links (polygon or freehand).
- Background picture: paste (Ctrl+V), drop or load; set true scale from a
  known length.
- Motion: play/rock between limits, step, set θ₂, drag links by hand, edit
  joints at any position.
- Analysis panel: Gruebler with numbers and actual DOF, Grashof, results
  table, transmission angle over the cycle, and Norton's closed-form method
  with live numbers checked against the solver.
- Three synced plots against θ₂ (angles, ω, α, point and slider motion,
  transmission angle), robust scaling near limits, CSV export.
- Save/open files, PNG picture export, undo/redo, autosave in the browser,
  help and about (licence) dialogs, built-in example.
