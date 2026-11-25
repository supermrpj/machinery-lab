# How do I…?

Short answers to the questions people ask most. Each one ends with where to
read more. Words in bold are what you see on the screen.

## LinkLab

### How do I draw a four-bar linkage?
keywords: fourbar, 4-bar, four bar, start, first mechanism, crank rocker, begin

Pick **Ground pivot** (G) and click twice to place the two fixed pivots. Pick
**Link** (K) and click the first pivot, then two points for the moving
joints, then the second pivot: each click adds a link. Press Esc to stop
drawing and Enter to run it. The first link from a ground pivot is the input.

More: [Building a mechanism](linklab.html#building-a-mechanism) and the lesson
[Your first fourbar](../learn/linklab-1-first-fourbar.html).

### How do I give a link an exact length?
keywords: lock, locked, dimension, constraint, constrain, set length, type length, padlock, fix

Select the link and type its **Length** in Properties. The length is then
fixed: a small padlock shows on the link, and it keeps that length when you
drag other joints. Untick **Fixed length** to free it again. If the length
you type cannot fit with the fixed lengths around it, LinkLab says so and
changes nothing.

More: [Running it](linklab.html#running-it).

### How do I stop the lengths changing when I drag the mechanism?
keywords: lock all, lengths lock, drag changes design, accident, move only, hand tool

Two ways. The padlock in the motion bar (**Lengths locked**) fixes every
length at once. Or use the **Move mechanism** tool (H): it only moves the
mechanism and never changes the design.

More: [Running it](linklab.html#running-it).

### How do I draw links separately and then put them together?
keywords: assemble, assembly, join, connect, snap together, merge joints, separate parts

Draw each link on its own and type its length. Then drag a joint onto another
joint with Select: they become one pin and the fixed lengths are kept. In a
mechanism that already runs, joints pass over each other without joining;
there, right-click the joint and choose **Join with**.

More: [Running it](linklab.html#running-it).

### Why does my mechanism not move?
keywords: stuck, locked, frozen, does not run, will not move, not joined, zero degrees of freedom, DOF, structure

Look at **Mobility** in the Kinematics panel. Three common causes:

- Two joints sit on the same spot but are not joined. The panel names them.
  Right-click one and choose **Join with**.
- The degree of freedom is 0: the drawing is a structure. Remove a link or
  free a ground pivot.
- The input is at a toggle position. It turns back there; press ▶ to carry on.

More: [Building a mechanism](linklab.html#building-a-mechanism) and
[Toggle and stationary positions](linklab.html#running-it-toggle-and-stationary-positions).

### How do I choose the input and the output?
keywords: motor, driver, crank, driven link, change input, output link, actuator

Right-click a link, joint, actuator or slider (press and hold on a touch
screen) and pick from the menu, for example **Motor here** on a ground pivot.
Or use the **Input** tool (D), or **Input and output** in the Kinematics
panel.

More: [Choosing the input and the output](linklab.html#building-a-mechanism-choosing-the-input-and-the-output).

### How do I make a slider-crank?
keywords: slider crank, piston, sliding joint, rail, prismatic, slot

Draw the crank and the connecting rod with **Link** (K). Pick **Slider** (S),
click the free end of the rod, then what it slides along: a line, a link, or
two points for a new fixed rail.

More: [Building a mechanism](linklab.html#building-a-mechanism).

### How do I trace the path of a point (a coupler curve)?
keywords: coupler curve, trace, path, tracer point, locus

Pick **Point on link** (J) and click the link. The point moves with the link
and its path is drawn. To trace a joint you already have, right-click it and
choose **Trace its path**.

More: [Building a mechanism](linklab.html#building-a-mechanism).

### How do I plot velocity and acceleration?
keywords: graph, plot, chart, velocity, acceleration, angular velocity, omega, alpha, position

Open **Plots** in the top bar. **Preset** sets all three plots for one topic,
for example the output with its velocity and acceleration. Click or drag on a
plot to move the mechanism to that position.

More: [Running it](linklab.html#running-it) and the lesson
[Kinematics of a point](../learn/linklab-2-kinematics.html).

### How do I find the joint forces and the input torque?
keywords: pin force, reaction, bearing load, torque, free body diagram, FBD, statics, dynamics, inertia, force analysis

Switch to **Advanced** in the top bar and open the **Forces** tab. Choose
**Static** (held still: gravity and your loads) or **Dynamic** (also the
inertia of the links at the input speed). The panel lists the input torque
and every joint force. Select a link to see its free-body diagram.

More: [Forces: statics and dynamics](linklab.html#forces-statics-and-dynamics).

### How do I balance a four-bar?
keywords: counterweight, shaking force, shaking moment, balance, vibration

Set the masses in the Forces tab first. Then open the **Balancing** tab and
press **Add these counterweights**. The table underneath compares the largest
shaking force, shaking moment, input torque and joint force without and with
them.

More: [Balancing](linklab.html#balancing).

### How do I save my work and open it again?
keywords: save, file, open, load, lost drawing, autosave, position kept

Ctrl+S saves a `.linklab.json` file; Ctrl+O opens one, or drop the file on the
window. The file keeps the position the mechanism was left in. LinkLab also
keeps your last drawing in the browser and brings it back next time.

More: [Saving, opening and clearing](linklab.html#saving-opening-and-clearing).

### How do I get my linkage into CAD or 3-D print it?
keywords: DXF, STL, SolidWorks, Inventor, Fusion 360, AutoCAD, slicer, print, export

**Export** in the top bar. For CAD it makes one DXF sketch per link, ready to
extrude. For 3-D printing it makes one STL per link and one for the base.

More: [Export to CAD](linklab.html#export-to-cad-solidworks-inventor-fusion-360-autocad)
and [Export for 3-D printing](linklab.html#export-for-3-d-printing-stl).

### How do I find a tool or command when I do not know where it is?
keywords: search, command, find, palette, where is, menu, shortcut, button, list of commands

Press **Find** in the top bar, or Ctrl+K, or the / key. Type what you want to
do, for example "piston" or "counterweight", and press Enter on the result:
LinkLab picks that tool or opens that panel. Each result also shows its key.
CamLab has the same search.

More: [The screen](linklab.html#the-screen).

### How do I change the units?
keywords: inch, inches, mm, metric, US units, imperial, feet, lb, grid

The **Units** menu in the top bar sets every unit at once: SI in mm or m, or
US in inches or feet. The values themselves do not change, so you can switch
back and forth.

More: [Units and grid](linklab.html#units-and-grid).

### Can I use LinkLab on an iPad or without internet?
keywords: tablet, phone, touch, offline, no internet, install, download, Safari

Yes. On an iPad open the website in Safari. One finger drags, two fingers pan
and zoom, and press-and-hold opens the right-click menu. After the first
visit the website also opens with no internet. On a computer you can also
download LinkLab as one file and double-click it.

More: [Touch screens and iPad](linklab.html#touch-screens-and-ipad).

## CamLab

### How do I design a rise-dwell-fall-dwell cam?
keywords: double dwell, RDFD, motion program, segments, lift, cycloidal, start, first cam

Build one turn of the cam from segments under the motion program on the left:
press **Add segment** for each rise, dwell and fall, and give each its
duration β; a rise or fall also needs a lift h and a law. The durations must
add up to 360° and the follower must end where it started.

More: [The motion program](camlab.html#the-motion-program) and the lesson
[Your first cam](../learn/camlab-1-first-cam.html).

### What does the red ∞ arrow on a plot mean?
keywords: infinite, infinity, spike, jerk, fundamental law, discontinuity, jump, red arrow

The curve above it jumps there, so the next derivative is infinite. An
infinite acceleration or jerk breaks the fundamental law of cam design. Pick
a law that joins smoothly at that end; hover over a law to see what it does
at its ends.

More: [The cam and the plots](camlab.html#the-cam-and-the-plots).

### How do I check the pressure angle and the radius of curvature?
keywords: pressure angle, undercut, undercutting, radius of curvature, base circle, prime circle, cam size

Switch to **Advanced** and choose the **Size** plot. It shows the pressure
angle with its ±35° limit and the radius of curvature. The checks on the
right turn red when one fails; a larger prime circle lowers the pressure angle.

More: [The cam and the plots](camlab.html#the-cam-and-the-plots) and the lesson
[Sizing the cam](../learn/camlab-2-sizing.html).

### How do I 3-D print a cam or open it in CAD?
keywords: STL, STEP, DXF, SolidWorks, Inventor, Fusion 360, FreeCAD, slicer, print, export

Set the thickness, the shaft diameter and how the cam fixes to its shaft under
the part and mounting inputs. Then **Export**: **STL** for a slicer, **STEP**
for an editable solid, or **DXF** for a sketch.

More: [Part and mounting](camlab.html#part-and-mounting) and
[Export](camlab.html#export).
