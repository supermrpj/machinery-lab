# CamLab user guide (v0.3.0)

CamLab designs a disk cam with a translating follower by the analytical
method: the motion functions (SVAJ), then sizing and dynamics, then the part
with its mounting, ready to 3-D print or to finish in CAD. The graphical
method is a tutorial on the same design. It is one file, `CamLab.html`: double-click it to open it
in Edge, Chrome or Safari. It needs no installation and no internet.

## The screen

- **Top bar:** New, Open, Save, Export, undo and redo, the slide examples,
  units (SI or US), **Graphical method** (the tutorial), **Basic | Advanced**,
  Help.
- **Inputs** (left): the motion program, follower and size, speed, spring and
  follower mass, and the part and its mounting.
- **The cam and the plots** (centre): the cam turning on the left, a set of
  plots on the right, one cursor for both.
- **Checks and results** (right): hide it with the arrow; the dots on its
  rail turn red when a check fails.
- **Motion bar** (bottom): play (Space), the cam angle θ, speed, and s, v, a
  and φ at the current angle (in Advanced also Fc and Tc).

### Basic and Advanced

CamLab starts in **Basic**: every design input, the cam, the motion plots, the
tutorial, and the checks for the fundamental law, peaks and factors.
**Advanced** adds the Size, Forces and Motion and force plots, the spring
inputs, and the size and spring checks. An undercut cam is flagged in both.
CamLab remembers the mode on each computer.

## The motion program

Build one turn of the cam from segments. Each segment has a duration β (°)
and, for a rise or fall, a lift h and a law: constant velocity, constant
acceleration, simple harmonic, cycloidal, 3-4-5 and 4-5-6-7 polynomials,
modified trapezoid, modified sine, trapezoidal acceleration or double
harmonic. Hover over the law to see what it does at the ends.

A **polynomial** segment passes through conditions you choose (s, v, a, j at
its start and end, or in between): use it for a single-dwell cam. The
results panel gives the equation of every polynomial segment (and of 3-4-5
and 4-5-6-7 rises and falls), s = lift × (c₃x³ + c₄x⁴ + …) with x = θ/β, so
the coefficients can be checked against a hand solution. The total
must be 360°; the bar under the program says what is missing and offers a
fix. The follower must end where it started. Click a segment to mark it on the
plots and the cam.

## The cam and the plots

The cam turns on the left with the follower on its spring, the contact
normal and the pressure angle; undercut places are marked, and so is how the
cam mounts (bore, keyway, flat, hub, bolt holes). The plots on the right
follow it. Choose them in the bar above:

- **Motion:** s, v, a and j, in time at ω (**at ω**) or per radian of cam
  (**per rad**). Where the curve above jumps, the next one is infinite there:
  a red arrow (∞) shows the spike and which way it goes. A sampled curve
  cannot show an infinite value, so the arrows mark where the fundamental law
  is broken.
- **Size** (Advanced): the pressure angle φ with the ±35° limit, and the
  radius of curvature of the pitch curve and the cam (+ convex, − concave).
  For a flat face: where the contact sits on the face, and ρ = Rb + s + a.
- **Forces** (Advanced): the cam force Fc = m·a + c·v + k·s + Fpl with its
  spring and inertia parts, and the camshaft torque Tc. Below zero, the
  follower jumps. Where the velocity jumps, a is infinite and so are Fc and
  Tc: spikes mark them, and the spring check fails (−∞ means the cam would
  have to pull, so no spring can hold the follower).
- **Motion and force** (Advanced): s, a and Fc together, to see which part
  of the motion makes the force drop.

Each plot's title bar gives the value at the cursor and the largest and
smallest values with their angles. **Copy** puts the numbers of the plots
shown on the clipboard (θ every 0.25° and one column per line), ready to
paste into Excel or Google Sheets; **CSV** saves them as a file.

**Cam + plots | Cam | Plots** shows both or one of them. Drag the line
between them to share the width (double-click it to go back).

## Graphical method (tutorial)

**Graphical method** in the top bar opens the hand construction of the
current design over the centre, in five steps: displacement diagram,
stations, transferred displacements, rollers, profile. Next and Back step
through it. Choose the number of divisions to see the hand method approach
the exact cam, which is drawn for comparison. The inputs stay open, so a
change to the design shows in the construction at once. Close it (or Esc) to
go back to the cam and plots.

## Plots

- Click or drag on a plot to turn the cam to that angle.
- Mouse wheel zooms along θ about the pointer; the vertical scale fits what
  is shown. Shift + wheel moves along. Double-click puts both axes back to
  automatic.
- The θ axis has ticks every 15°, 30°, 45°, 60° or 90°, as the plot's width
  allows.
- The **axes** button beside ⤢ sets where each axis starts and ends and the
  tick spacing (empty = automatic). The y range stays while the plot shows
  the same quantity.
- **⤢** at a plot's corner opens it large; Esc closes it.
- Drag the line between two plots to give one more height; double-click the
  line to share it evenly again. CamLab remembers this.

## Part and mounting

The part to make: its **thickness**, the **shaft Ø**, and the **print
clearance** added to the bore, the key width and the flat (0.2 mm for FDM
printing; 0 for a machined part). Then how it fixes to the shaft:

- **Plain bore:** press-fit or glue, or add a pin or set screw later in CAD.
- **Bore with keyway:** a DIN 6885 parallel key from the shaft Ø (6–58 mm),
  or type the key width b and the keyway depth t₂ in the cam.
- **D-flat bore:** for a motor shaft with a flat (across-flats 0.9 × the
  shaft Ø unless typed: 5 mm shaft, 4.5 mm).
- **Hub with set screw:** a hub on one face with a radial M3, M4 or M5 hole,
  sized for a heat-set insert or for tapping.
- **Bolt-circle flange:** 3, 4 or 6 clearance holes on a bolt circle, to bolt
  the cam to a flange coupling or a shaft collar.

Empty boxes take the sizes CamLab works out (shown greyed). CamLab checks that
the bore, keyway and holes stay inside the cam with at least 2 mm of material,
and that the hub wall can take the screw. The keyway, the flat, the set screw
and the first bolt hole face the follower when θ = 0, so the cam is timed
on its shaft.

## Export

- **STL (3-D print):** the part with its mounting, in mm, ready for a slicer.
  Print it lying flat, hub up.
- **STEP (solid for CAD):** an exact solid (the profile as a spline surface,
  the bore, keyway, flat, holes and hub as planes and cylinders) that
  SolidWorks, Inventor, Fusion 360 and FreeCAD open as a part, to change the
  mounting, add holes or fillets. The set-screw hole is left out; it is
  marked in the DXF.
- **DXF (sketch):** a closed smooth spline through the cam profile (layer
  CAM), the pitch curve (PITCH), the bore with its keyway or flat (BORE),
  bolt holes (HOLES), the hub (HUB), the set-screw hole seen from above
  (SETSCREW) and a centre mark, DXF R2000 in mm. Open it as a sketch and
  extrude.
- **Points (.txt or .csv):** x y z every 0.5°, in the drawing's length unit.
  SolidWorks: Insert › Curve › Curve Through XYZ Points, tick *Closed curve*.
- **Data (.csv):** θ, s, v, a, j, pressure angle, ρ, cam force and torque
  every 0.25°.

Export is blocked while the sizes cannot make a cam (for example a roller
larger than the prime circle), and the STL and STEP while the mounting does
not fit (for example a bore that would cut through the cam).

## Examples

The examples menu opens Examples 8-1 to 8-8 and 15-1 from the slides, in
inches. CamLab reproduces their numbers.

## Keys

Space: play or pause · Ctrl+Z / Ctrl+Y: undo / redo · Ctrl+S: save ·
Ctrl+Shift+S: save as · Ctrl+O: open.
