# LinkLab user guide (v0.11.0)

LinkLab is a drafting table for linkages. You can draw a graphical construction
with a compass and straightedge, build a mechanism on top of it, and watch it
move, with its analysis alongside.

## Opening LinkLab

Double-click `LinkLab.html`. It opens in your web browser (Chrome, Edge or
Firefox) and works without an internet connection. Your last drawing is kept
in the browser and comes back the next time you open the file.

On the website, a link can open an example: mechsim.dev/app/?open=walking-leg
opens the walking leg. The drawing you had open before is one Undo away.

## The screen

- **Basic | Advanced** (top bar): LinkLab starts in **Basic**: every drawing
  tool, the Kinematics and Sheet tabs, the plots and the **Units** menu.
  **Advanced** adds the
  Forces, Balancing and Tolerance tabs, the force plots, link masses in Properties and
  the forces drawn on the mechanism. A drawing keeps its force settings in
  both modes; they show again in Advanced. LinkLab remembers the mode on
  each computer.
- **Tools** (left): drafting tools at the top, mechanism tools in the middle,
  and background-picture tools at the bottom. Each tool has a one-letter key.
- **Drawing sheet** (centre): scroll the wheel to zoom. Drag empty space, hold
  Space and drag, or use the middle mouse button to pan. Press **F** to fit
  the drawing in the window.
- **Hint** (bottom left): tells you what the current tool expects next. Its
  **Guide** button opens the tool's guide again; **−** shrinks it to the
  tool's name (**+** brings the text back).
- **Tool guides:** the first time you pick a tool, a card shows a short
  animation of the clicks and the steps in words. Close it with *Got it*.
  Switch guides off, open any of them, or show them all again from **Help**.
- **Properties** (floating card, top right of the drawing): appears when you select something; close it with × or Esc.
- **Side panel** (right), one tab at a time, chosen on the rail at the right
  edge: **Kinematics**, **Forces**, **Balancing**, **Tolerance** and **Sheet** (layers and display). Click the open tab, or the arrow beside its title, to hide
  the panel and give the drawing the full width; click any tab to bring it
  back. Forces, Balancing and Tolerance are shown in Advanced. A dot on Forces or
  Balancing means force analysis or counterweights are on. LinkLab remembers the tab and whether the panel was hidden. On a
  phone the panel starts hidden.
- **Motion bar** (bottom): play, step, the input value (θ₂ for a motor, the
  stroke s for an actuator), the **lengths lock** and speed.
- **Plots** (top bar): up to three plots against the input. Drag the
  drawer's top edge to make it taller (double-click the edge for the usual
  height); LinkLab remembers the height.

## Layers

| Layer | Holds |
|---|---|
| Background picture | a pasted screenshot, photo or scanned sketch |
| Construction | points, lines, construction lines, arcs, circles, dimensions |
| Outlines | shapes that move with a link (a gripper jaw, a door, a bucket) |
| Mechanism | ground pivots, joints, links, sliders |

Under **Sheet › Layers**, each layer can be **shown or hidden**, **locked** (it can't be selected, but
you can still snap to it) or **faded**.

## Graphical construction

Everything snaps to exact points. A red marker shows what you will snap to:
✕ intersection, □ end point, ○ centre, a large circle for a joint, and + for
a point on a curve.

**Compass (C).** The compass stays on the sheet like a real one.
- Drag the **needle** to move the whole compass. The radius is kept, so you
  can carry a length across the drawing.
- Drag the **pencil tip** to open or close the compass. It snaps, so placing
  the needle on one point and the pencil on another picks up that distance
  exactly.
- Drag the **knob** on top round to draw an arc. A full turn gives a circle.
- Click anywhere else to put the needle there.
- Type an exact radius in Properties, or use *Draw full circle*.

**Protractor (A).** A clear protractor that stays on the sheet.
- Drag the **centre mark** onto the vertex (it snaps).
- Drag the **round grip** to turn the baseline. It snaps so the baseline
  passes through a point; hold Shift for 15° steps.
- Hover to read the angle from the baseline. **Click** to draw a construction
  line through the centre at that angle (0.5° steps; Shift for 5°).
  **Alt + click** (Option on a Mac) marks a point on the rim instead.
- Set the size, a full 360° scale, or an exact baseline angle in Properties.

**Line (L)** draws a segment between two points. **Construction line (X)**
draws an endless line through two points. Hold **Shift** for 15° steps.
**Measure (M)** leaves a dimension showing the length and angle.
**Eraser (Z)** deletes drawings: click a point, line, arc, circle or
dimension, or drag across several (one drag is one undo step). It never
touches the mechanism; a line or circle a roll joint uses is kept.

## Building a mechanism

1. **Ground pivot (G):** click to place a fixed pivot. It snaps to
   intersections, so a pivot found from two arcs lands exactly on them.
   Click an existing joint to fix it to the ground (click again to free it).
   Click on the body of a link to pivot that link there, for a lever turning
   about its middle (hold Shift to place a separate pivot instead). Where two
   joints only sit on top of each other (two links that look joined but are
   not), clicking them joins them into one pin fixed to the ground.
2. **Link (K):** click from joint to joint. Each click adds a link, and you
   can keep clicking to build a chain. Press Esc or right-click to stop.
   Clicking on the body of another link (not on a joint) pins the new joint
   to that link, for example a coupler joined to the middle of a rocker.
3. **Point on link (J):** click a link to add a coupler point. Its path is
   traced. Click an existing joint that lies on another link to pin it to
   that link.
4. **Wheel (W):** click a centre (a ground pivot, a joint or empty space),
   then click to set the radius. Use wheels for rollers, friction drives and
   the pitch circles of gears.
5. **Slider, pin in slot (S):** click a joint, then what it slides along: a
   line, a construction line, **a link** (the joint slides in a slot along the
   link, as in the inverted slider-crank), or two points for a new fixed rail.
6. **Prismatic joint (T):** click the link that slides, then the link it
   slides in (or empty space for the ground), then the sliding direction (a
   line, two points, or Enter for the link's own centre line). Use it for
   pistons in cylinders, hydraulic rams, racks and blocks.
7. **Roll joint (O):** click two contours that roll on each other without
   slipping: wheels, circles or arcs, lines, or a link's centre line. It is a
   full joint (1 DOF).
8. **Roll + slip joint (Q):** the same, but the contact may slip, as with a
   cam and follower or real gear teeth. It is a half joint (2 DOF). You can
   switch a contact between the two in Properties.
9. **Linear actuator (U):** click where the cylinder is mounted (a joint, or
   empty space for a fixed mount on the ground), then the joint the rod end
   pushes. It becomes the input. Set its shortest and longest length in
   Properties. An actuator that is not the input keeps its length, like a
   locked strut.
10. **Input (D):** click a pivot or a link to put the motor there (at the
   link's pivot nearest the click, ground pivots first; where several links
   meet, choose which one it turns), or click a linear actuator or slider to
   drive the mechanism with it.
11. **Outline (B):** click corners, or press and drag to draw freehand. The
   shape moves with the link it is drawn on; you can change this in
   Properties.

The first link pinned to a ground pivot becomes the **input (link 2)**. Links
are numbered with the ground as link 1 and the input as link 2.

**Two joints on one spot.** A joint drawn on top of another one is a second,
separate joint: the links are not connected there, and the Kinematics panel
says so ("J3 and J6 are on the same spot but not joined"). Right-click
either joint and choose **Join with … (one pin)**, or drag one onto the
other with Select. A joint lying on a link it is not part of can be pinned
to it from the same menu (**Pin to link …**).

### Choosing the input and the output

Use the **Input tool (D)**, or in the Kinematics panel under **Input and output**:

- **Input** lists every way the mechanism can be driven: a motor at a ground
  pivot, a motor at any pin between two links (it turns one link relative to
  the other), a linear actuator, a slider pushed along its rail, or a link
  pushed along its prismatic joint. A selected link or actuator also has a
  *Make this the input* button in Properties.
- **Output** is the quantity to report: the angle of any link, the x or y of
  any joint or traced point, a slider's position, or an actuator's length.
  LinkLab picks a sensible one (the rocker of a fourbar, the slider of a
  slider-crank, the follower of a cam) until you choose.

**Quicker: right-click** a link, joint, actuator or slider on the drawing (on
a touch screen, press and hold). The menu lists the inputs and outputs that
belong to it, with a tick on the ones in use: *Motor here* on a ground pivot,
*Angle of link 3* on a link, *x / y* of a joint, *Drive with it* and *Its
length* on an actuator, *Push it along its rail* on a slider. It also has
Lock, Fixed to the ground, Trace its path and Delete. Esc closes it.

**Colours.** Each link gets a colour by its number, and each coupler curve
(traced point P1, P2, …) its own colour, matched in the plots. To choose a
colour, select the link (or the traced joint) and use *Colour* (or *Curve
colour*) in Properties. A colour you pick stays with that link or point,
and is saved in the file; *Automatic* goes back to LinkLab's choice.

The output is marked on the drawing, its value, velocity and acceleration
are shown with the velocity ratio (output / input), and the plots show it
against the input.

### Joint types at a glance

| Joint | Tool | Counted as | DOF it allows |
|---|---|---|---|
| Pin (revolute) | Link, Ground pivot | full joint, J₁ | 1 (rotation) |
| Sliding (prismatic) | Prismatic, Slider | full joint, J₁ | 1 (translation) |
| Pin in slot | Slider on a link | block + pin + slide | 2 |
| Rolling, no slip | Roll | full joint, J₁ | 1 |
| Rolling with slip | Roll + slip | half joint, J₂ | 2 |

Gears on fixed centres joined by a pure roll joint give Gruebler M = 0, but
they still turn: the contact is redundant. The Kinematics panel points this
out. This is why gear teeth are usually treated as a half joint.

## Running it

- **Enter** or ▶ plays the motion. LinkLab follows the mechanism along its
  whole path of motion, so a rocking input (a non-Grashof linkage, or a
  slider driving a crank) passes through its toggle positions: the input turns
  back while the mechanism flips between its open and crossed assembly, as a
  real one does with momentum. A linear actuator turns back at its stroke ends.
- **← →** step the input by 1°; hold Shift for 10°. Stepping stops exactly at
  a toggle position; press ▶ to carry on through it.
- Type θ₂, or drag the slider in the motion bar.
- **Drag any link** with the Select tool to move the mechanism by hand.
- **Drag a joint** to change the design (link lengths change). You can do this
  while the mechanism is moved; the edit is made at the position you see.
- **Move mechanism (H)** is a hand tool that only moves the mechanism. Dragging
  a link or a joint with it never changes the design.
- **Lengths lock** (padlock in the motion bar) locks the whole design, so a
  stray drag with Select moves the mechanism instead of stretching a link. A
  single link can be locked in Properties; its joints then can't be dragged
  to new places. Locked links show a small padlock.
- Click or drag on a plot to move the mechanism there. A rocking input plots
  as a closed loop (each input angle is reached twice, once per assembly);
  clicking picks the point of the curve you clicked.
- When a plot has several lines (joint forces, link angles, points), tick
  boxes under its menu show or hide each one.
- **Zoom a plot** with the mouse wheel: it zooms along the input axis about
  the pointer, and the vertical scale fits what is shown. Shift + wheel (or a
  sideways swipe) moves along; double-click puts both axes back to automatic.
- An angle on the x-axis has ticks every 15°, 30°, 45°, 60° or 90° (as many
  as the plot's width allows), or every so many degrees for all plots under
  *Sheet › Display › Angle axis ticks*.
- **Axes** (the button with the axis symbol, beside ⤢; *Axes…* in the large
  window): type where each axis starts and ends, and the tick spacing of
  each (for one plot). An empty box is automatic.
  The x-axis stays within the cycle; the y range stays while the plot shows
  the same quantity, so you can compare designs on one scale.
- **⤢** at a plot's top-right corner opens it large in a window. It follows
  the mechanism, can be zoomed on its own, and clicking it moves the
  mechanism too. Esc or *Close* closes it.
- The text on the plots follows **Sheet › Display › Text size**.
- **Preset** (beside the x-axis menu) sets all three plots for one topic:

  | Preset | Plots |
  |---|---|
  | Output motion | output, its velocity, its acceleration |
  | Link motion | link angles θ, angular velocities ω, angular accelerations α |
  | Transmission | output, velocity ratio, transmission angle μ |
  | Point path | point x, point y, point speed |
  | Forces (Advanced) | input torque, joint forces, shaking force |
  | Balancing (Advanced) | shaking force, shaking moment, input torque |
  | Energy (Advanced) | kinetic, potential and total energy; input torque; link ω |
  | Bearing loads (Advanced) | joint forces \|F\|, joint forces as a polar diagram, joint force direction ∠F |
  | Tolerance (Advanced) | error from pin clearance (play and under the load, knocks marked K), joint forces \|F\|, joint force direction ∠F |

  With counterweights in use, the shaking force, shaking moment and input
  torque plots also draw the curve **without** them (dashed grey), so one
  view shows what balancing gains and what it costs.
- The plots' x-axis can be **Input from 0°**, **Input from here** (the cycle
  starts at the position shown; move the mechanism and press *Start here* to
  start again from there) or **Time over one cycle** at the input speed (a
  rocking input's two assemblies then follow each other instead of
  overlapping).

### Toggle and stationary positions

- A **toggle position** is where the input reaches its limit and cannot drive
  the mechanism further (two links in line, e.g. the coupler and the rocker
  of a non-Grashof fourbar, or the crank and rod of a slider-crank driven by
  its slider).
- A **stationary position** is where the output is momentarily at rest at its
  extreme (e.g. the rocker of a crank-rocker at the end of its swing).

When *Mark toggle and stationary positions* is on (Kinematics › Input and
output, on by default):
- the drawing shows a dashed line through the links that are in line and a
  *toggle* or *stationary* tag, and the motion bar names the position;
- the plots mark them with **T** and **S**;
- the Kinematics panel lists the input values where they occur;
- **dragging the mechanism rests at them**: it stops there until you pull
  clearly further, then carries on. Dragging the input past its limit stops at
  the toggle.

At a toggle position a constant input speed would need unbounded velocities,
so the read-out shows no velocity or acceleration there.

## Kinematics panel

- **Mobility:** Gruebler's equation with your numbers, plus the actual degree
  of freedom found by the solver. When they differ, special geometry is the
  reason, which makes a good class discussion.
- **Fourbar / slider-crank:** link lengths, the Grashof condition and type.
- **Input and output:** the input (with its speed: ω and α for a motor, ṡ
  and s̈ for an actuator or slider), the stroke limits of an actuator, the
  output, and the output's value, velocity, acceleration and velocity ratio.
- **At θ₂ (or s):** θ, ω and α of each link; slider position, velocity and
  acceleration; velocity and acceleration of the selected or traced points.
- **Transmission angle:** the current value, plus its minimum and maximum over
  the motion.
- **Show the closed-form method:** the closed-form position, velocity and
  acceleration equations with the current numbers substituted, checked
  against LinkLab's general solver.

## Forces: statics and dynamics

The **Forces** panel (below Kinematics) is laid out in the order you work:
1. **Off / Static / Dynamic.**
2. **Masses:** gravity, material, thickness × width, and each link's m and
   I_G (click a row to select the link and type its own values).
3. **Loads:** the forces and torques you added (click a row to edit it).
4. **At this position:** the input torque T₁₂ (or force) with its largest
   value over the cycle, then every joint force.
5. **On the frame:** shaking force and moment, force on the frame, kinetic
   energy.

Choose:
- **Static — held still here:** the mechanism held at the position shown,
  against gravity and the forces you add. Gives the torque (or force) the
  input needs to hold it, and every joint force.
- **Dynamic — moving at the input speed:** the same, plus the inertia of every
  link at the input speed ω and acceleration α (inverse dynamics). Also gives
  the shaking force, shaking moment and kinetic energy.

**Mass of the links.** By default each link's mass, centre of mass and moment
of inertia come from its shape, cut from one material at one thickness and
width: a bar with round ends, a plate round its joints, a disc for a wheel,
or the outline you drew with the Outline tool. Materials:
- metals: steel, aluminium, brass;
- sheet: acrylic (laser cut), plywood;
- 3-D printing (solid): PLA, ABS, PETG, ASA, polycarbonate, nylon (PA12);
- **Custom density…**: type any density in kg/m³. For a printed part with
  less than full infill, use about the solid density × the infill fraction
  (a little more for the walls), or weigh the part and type its mass.

To type the values yourself (textbook problems), open the link's **mass
popup**: right-click the link and choose *Mass and centre of mass…*, click
its row in the Masses table, or press *Edit mass…* in Properties. Choose
*Typed values*, then enter:
- **m** in kg and **I_G** about the centre of mass in kg·m²;
- the centre of mass **G in the link's own frame**: measured from one of its
  joints, with x′ along the line to another joint (the line of centres).
  Type **r ∠ θ** (θ counter-clockwise from the line of
  centres), or **x′, y′** along and across; the two stay in step. Or press
  *Pick G on the drawing* and click the point.

A small drawing of the link in its own frame shows r, θ and G. Because G is
fixed to the link, it stays in place when the mechanism moves or the link's
lengths change. Centres of mass are marked ◐ on the drawing. The **Guide**
button in the popup, beside *Mass properties* and beside *Masses* shows the
steps.

**Forces and torques on links (E).** Click a link where a force acts; drag
while pressing to point it. Shift + click adds a torque. In Properties set
its size and direction (or Fx, Fy), whether it keeps its direction or turns
with the link, and how it changes over the cycle:
- *By a formula* — a factor such as `1 + 0.5*sin(theta)`, `pulse(theta, 0, 180)`
  or `step(t - 0.2)`. Variables: `theta` (input angle, °), `s` (input stroke,
  mm), `t` (time, s); `sin`, `cos`, `tan` in degrees; `sqrt`, `abs`, `min`,
  `max`, `exp`, `^`.
- *By a table* — two columns (input value, factor) pasted from Excel;
  straight lines in between.

To change a force or torque later, **double-click** it on the drawing (or
right-click it and choose *Edit force…*, or click its row in the Loads
table). The point where a force acts is given as r ∠ θ from one of the
link's joints, along the line to another joint, or picked on the drawing.

**Results.**
- Forces panel, *Largest over the cycle*: each joint force's largest size,
  its direction then, and the input angle where it happens; the largest of
  all is highlighted. Click a row to move the mechanism there. Near a toggle
  position the forces grow without limit at a constant input speed, so
  positions within 3° of one are left out (the panel says when).
- Forces panel: the input torque or force (and its largest value over the cycle),
  every joint force with its direction and its largest value, slider normal
  forces, actuator forces, shaking force and moment.
- Drawing: with nothing selected, the forces the ground puts on the
  mechanism and the input torque. **Select a link to see its free-body
  diagram**: the joint forces on it, its weight mg, the inertia force −ma
  (dashed) and couple −Iα, and the motor torque.
- Plots: input torque or force, joint forces, shaking force, shaking moment,
  kinetic energy, potential energy (gravity, measured from its lowest point)
  and the three energies together over the cycle.
- **Bearing loads** (plot preset): a joint force has a size and a direction.
  *Joint forces |F|* gives the size; *Joint force direction ∠F* gives the
  angle (0° to the right, counter-clockwise, drawn without jumps at 360°);
  the **polar diagram** gives both: the tip of each force arrow traced over
  the cycle, with the input angle marked along the first line and the arrow
  at the position shown. Point at a curve to read |F| and ∠F. Under each of
  the last two, choose **Directions fixed to the frame** (the load on a
  bearing in the ground) or **turning with link n** (the load as the pin of
  link n sees it, e.g. where on a crank's bushing it wears). Select a joint
  to plot that joint only, or a link to plot the forces on it.
- **Energy and torque:** with no applied loads, the motor torque is the slope
  of the total energy against the crank angle, T₁₂ = d(KE + PE)/dθ₂: uphill,
  the motor drives; downhill, it brakes. At half the speed KE is a quarter
  and PE is unchanged, so the torque falls by less than four times when the
  links have weight (the *Energy* preset shows all of this).
- Exports: the motion CSV gets force columns; the link parameters file gets
  each link's mass properties and the forces at the position shown.

Force names follow the usual textbook convention: **F₂₃** is the force of link 2
on link 3 (link 1 is the ground), and F₃₂ = −F₂₃. On a free-body diagram of
link 3 the forces read F₂₃, F₄₃, m₃g, −m₃a₃, −I₃α₃ and, on the input link,
T₁₂ (the motor torque of the ground on link 2). In the CSV the same force is
`F23`. When a link is selected, the joint-force plot shows the forces on that
link; when a joint is selected, the force at that joint. Two forces can trace
almost the same curve: on a link with no weight or load of its own between
two pins (a two-force member) the pin forces are equal and opposite, so their
sizes coincide; dashes tell the lines apart.
Gears on fixed centres are statically indeterminate (the contact is
redundant): the force split is then not unique and LinkLab shows the
smallest set, while the input torque is exact. At a toggle position a
constant input speed would need unbounded forces, so none are shown there.

## Balancing

A mechanism is **force balanced** when its total centre of mass stays still:
the shaking force on the frame is then zero at every position. The
**Balancing** tab of the side panel does this with
counterweights, using the masses set in the Forces panel.

1. **Total centre of mass:** how far it moves over the cycle. Tick *Show it*
   to mark G total and its path on the drawing.
2. **Force balance:**
   - A **fourbar** is balanced exactly (Berkof–Lowen) with a counterweight
     on the crank and one on the rocker; the coupler stays as designed. The table gives each m·R and its angle in
     the link's own frame (from the ground pivot towards the other pin,
     counter-clockwise). Type the radius R you want; the mass follows. Press
     *Add these counterweights*.
   - **Other mechanisms:** each link that turns about one ground pivot can
     get a counterweight that puts its own centre of mass on the pivot. This
     reduces the shaking force but does not remove it.
3. **Counterweights:** each one's mass, radius and angle. Untick *Use the
   counterweights* to compare without them (they are drawn dashed), or
   remove them all. A counterweight is a point mass on a rod from the pivot;
   it is added to the link's m, G and I_G everywhere (Forces panel, plots,
   free-body diagrams). Properties shows the link with and without it.
4. **Without and with the counterweights:** the largest shaking force,
   shaking moment, input torque and joint force over the cycle, moving at the
   input speed. Balancing the force usually raises the input torque and joint
   forces, and it leaves the shaking moment.
5. **Rotor balancing calculator:**
   - *Single plane:* masses m at radius R and angle θ; gives the correction
     m·R and angle, and its mass at the radius you choose.
   - *Two planes:* the same with each mass's distance l from plane A, and
     plane B at lB; gives the correction in each plane.
   - *Bearing forces:* forces F₁, F₂ measured at two bearings, with their
     phase angles and positions, and the speed in rpm (the fan example):
     m·R_B = (F₁l₁ + F₂l₂)/(lB ω²), m·R_A = (F₁ + F₂)/ω² − m·R_B.
   An end view draws each m·R as an arrow, with the corrections in red.
   **Before the correction**, at the speed you give: Σ m·R (and Σ m·R·l for
   two planes), the shaking force (and moment) it makes, and a graph of it
   against speed (it grows with the square of the speed).
   **Examples…** opens a car wheel (single plane: three heavy spots, a
   clip-on weight on the rim) and a shaft with three discs (statically
   balanced, Σ m·R = 0, but with a couple: two planes).
   Values use the units chosen in the **Units** menu. The
   calculator needs no drawing: it is in the Balancing tab on an empty sheet
   too.

`tests/balance.test.js` checks these against worked examples: single- and
two-plane balancing, the fan, and a fourbar whose shaking force drops to
zero over the whole turn.

## Tolerance: pin clearance (beta)

The Tolerance tab is in **beta**: its results are estimates still being
checked against real mechanisms. Use them to compare designs and find the
pin to improve, not as a guarantee.

Every hole is a little larger than its pin: on 3D-printed parts by about
0.2–0.4 mm, on reamed holes with ground pins by a few hundredths of a
millimetre. So a real mechanism has **play**: the links can shift a little
and the output is not exactly where the drawing says. The **Tolerance** tab
(Advanced) answers three practical questions:

- **How far off can the output be?** (the play)
- **Where is it really, when it runs?** (under the load) and **where does it knock?**
- **Which pin is worth improving?**

### Setting it up

1. **Check:** the output (its angle for a link, its position along the rail
   for a slider), or any joint as a point.
2. **Pin clearance** (hole Ø − pin Ø): pick a typical value or type one.
   | Making | Clearance |
   |---|---|
   | 3D print (FDM) | about 0.3 mm |
   | Drilled, loose fit H11/c11 | about 0.15 mm |
   | Reamed, sliding fit H7/g6 | about 0.015 mm |
   | Ball bearing | about 0.01 mm |
   (for pins of about 6–10 mm). *Pins that differ* gives a pin its own
   clearance, e.g. a bearing at a ground pivot.
3. For the load, turn on the force analysis: **Forces › Static** (gravity
   and your loads) or **Dynamic** (also the inertia at the input speed).

### Reading the results

- **Play here: ±0.17°** — the most the output can be off at this position,
  with every pin at its worst side at once. For an angle, the panel also
  gives the distance at the tip of the link.
- **Under the load: −0.15° (clockwise)** — where it actually is. Under load
  each pin is pushed against one side of its hole (the side away from the
  push), so the output sits at one edge of its play, not just anywhere in it.
- **Largest play** over the cycle, and where (*Go there*).
- **Knocks** — where the force at a pin passes zero and turns round. The
  pin then crosses its hole and hits the far side: the output jumps (by up
  to twice its play) and the joint knocks. Each knock is listed with its
  input angle, the jump and the pins that cross (*Go*). Knocks happen where
  the joint force polar diagram passes near its centre (see Bearing loads).
- **Which pin to improve** — each pin's share of the play. In one closed
  loop (a fourbar, a slider-crank) with the same clearance at every pin,
  every pin counts the same; the share matters when pins differ or in
  mechanisms with more loops.

### On the drawing

- **Magnifier** (on at first, while the Tolerance tab is open): a round
  window beside the checked point, magnified so the play can be seen, with
  its own scale bar.
  - A point: the shaded zone is where it can be at this position; the
    centre is its ideal place; the dot is where it is, as the dashed drawing
    has it: where your push sends it, else where the load puts it, else with
    every pin at its worst side. The scale bar gives the size.
  - An angle or a slider: a round scale either side of zero; the shaded band
    is the play here, written under it ("play ±0.59°", the panel's "Play
    here"). The marker is where it is, labelled "push", "load" (the panel's
    "Under the load") or "worst" (every pin at its worst side).
  - How many times it knocks is written under the window; the list is in
    the panel.
- **The play on the drawing** (always, while the Tolerance tab is open): each
  hole as a ring with its pin where the load puts it (or at its worst side
  with forces off), and the mechanism shifted so (dashed), all drawn larger
  (*Play drawn*: automatic, or a size you choose). A key in the panel says
  what each mark is.
- **Move it by hand:** while the Tolerance tab is open, dragging a link or
  joint moves it as you would wiggle a real loose linkage. The motor holds
  the input, so the links move only within their play. Choose under *When
  you drag*:
  - **Follow the mouse (smooth)**, at first: the point you grab follows the
    mouse (drawn at the same size as the play) until the pins reach the
    sides of their holes, so you see the backlash take up gradually;
  - **Push to the walls (extremes)**: every pin goes straight to the side of
    its hole that the push loads it against, as a firm push gives.
  The panel gives where the checked output is (*Pushed by hand*). It stays
  there until you drag again or move the input (timeline or Play). A plain
  click on a link still opens its Properties.
- A joint joins two links; its zone is measured on the first of them, as the
  magnifier says (*J3 on link 2*). With the motor holding the crank, a point
  on the crank moves only with the crank's own pivot pin.
- Next to a dead centre (a limit position of the input) the play is
  estimated linearly only where that holds; the few positions right at the
  limit are left out, and the panel says how many.

### Plots

The *Tolerance* preset shows the error from pin clearance (the play either
way, dashed, and the error under the load), the joint forces |F| and the
joint force directions ∠F. Knocks are marked **K**: they line up with the
places where a joint force drops to almost zero and its direction turns
round quickly.

### What to do about it

- **Play:** give the pins with the largest share less clearance (a reamed
  hole, a bushing, a bearing).
- **Knocks:** a knock goes only if the force at that pin never turns round:
  a spring that keeps the links loaded one way, a different speed, or
  different masses. Balancing moves the knocks but seldom removes them.
- Keep the accurate part of the motion away from the knocks.

### More (optional)

- **Hole position error:** each hole may also be off its drawn place,
  within a circle of the radius given. It adds to the play (it does not
  move with the load).
- **Random builds:** with no load to decide, pins sit at random sides. *Run*
  tries many builds (solved exactly) and gives the largest and the RMS
  (typical) deviation, with the play for comparison.

### How it is worked out

For small clearances the error is linear: a gap u at a pin moves the
output by M·u. The play adds up the largest each gap can do,
Σ (c/2)|M|. Under the load the gap at each pin is u = −(c/2)·F/|F|, with F the
force on the link from the one it is pinned to, and the error is Σ M·u.
Only pins are studied; sliders, gears and rolling contacts are taken as
exact. `tests/tolerance.test.js` checks it:
- a lone crank moves by exactly half the clearance, and sags by half the
  clearance under its own weight;
- one load alone: the point it acts on gives way along the load by exactly
  the play in that direction, and P·δ = Σ (c/2)|F| (virtual work);
- the full solver with every pin pushed as worked out puts the output
  where the linear sums say (within 1 %), for the play and under the load;
- a fourbar with a rocker balanced on its pivot knocks exactly where the
  rocker's angular acceleration is zero, by about twice its play.

## Background picture

Paste a screenshot (**Ctrl+V**), drop a picture on the window, or use *Load
picture* in Properties with the Background tool (I) selected. To make it true
size, use **Set scale (R)**: click both ends of a known length, then type the
real length.

## Export to CAD (SolidWorks, Inventor, Fusion 360, AutoCAD)

**Export** in the top bar. Set the link width and pin hole diameter, then
choose:
- **Parts for CAD (.zip):** one DXF sketch per link, in the link's own frame
  (first joint at the origin, x along the link), with pin holes (also at a
  traced coupler point, for a pen), ready to extrude. It also contains a frame
  drawing with the ground pivots (and the ground link, if drawn), each traced
  path as an X Y Z point file, and a README with link lengths, joint positions
  (J1, J2, …) and actuator strokes for mating.
  - SolidWorks: open the DXF, then *Import to a new part as 2D sketch* (mm),
    then Extrude. For paths: *Insert › Curve › Curve Through XYZ Points*.
  - Inventor: start a 2D sketch, then *Insert › ACAD*, choose the DXF (mm),
    then Extrude.
- **Layout drawing (.dxf):** the whole mechanism at its current position,
  with links, pin holes, centre lines, sliders, linear actuators, outlines,
  construction and paths on separate layers.
- **Picture (.png)**.

## Export for 3-D printing (STL)

**Export** in the top bar, under *For 3-D printing (STL)*. LinkLab makes one
STL file per link and one for the base, ready for a slicer. Each part lies
flat as printed and needs no supports, and the parts fit together as drawn.
The links are the link width set above and as thick as in Forces (the mass
model uses the same sizes). Pin joints only for now: no sliders, gears, cams
or linear actuators, and at most two parts at a joint.

- **Joints:**
  - *Snap-fit, pins printed on the links*: a hollow pin with four slots and a
    ridge is printed on the lower part; the part above has a hole with a
    recess, and clicks onto it. No hardware.
  - *Snap-fit, separate pins on a sheet*: every part gets plain holes; the
    pins print lying down on a bar (Pins.stl), side by side, each held by a
    thin tab you twist off. A pin has a countersunk head at one end and two
    springy fingers with a ridge at the other; push it through the joint
    until it clicks. Printed lying down, the layers run along the pin, so it
    is stronger than a pin printed standing up. Each pin is as long as its
    joint needs; the README lists which goes where.
  - *Holes for pins or rivets*: plain holes for pins, rivets or bolts of the
    pin hole diameter.
- **Clearance:** hole diameter minus pin diameter. Printed holes usually come
  out a little small, so print the **Fit test** first: four test pieces with
  clearances of 0.2 to 0.5 mm (and a bar of pins for snap-fit). Enter the
  clearance of the piece that clicks in and turns freely without wobbling.
- **Base:** *Flat* lies on the table; *Stand* has a straight bottom edge and
  stands upright in two printed stands. A pen refill in a traced point draws
  the path on paper taped to the base, at full size.

- **Counterweights from Balancing** (shown when the drawing has them): the
  link gets an arm with a round pad, and a steel stack is bolted to it: a
  countersunk bolt, large washers and a nut. The printed arm counts towards
  the balance, and for a fourbar the need is worked out again from the
  printed coupler (with its holes, pins and knob), so the stack makes up
  only the rest. The README gives the bolt, the number of washers and the
  mass to weigh the stack to. Set the material in Forces to the plastic you
  print before balancing, and print the links solid (100 % infill): the
  masses assume solid parts.

LinkLab stacks the links in layers above the base. Links joined at a joint
are in different layers, and links in the same layer never touch over the
whole cycle. A pin that skips a layer stands on a boss, kept clear of the
links between. A knob for turning the crank goes half way along the crank,
or on top of the crank pin when another link passes over the crank. A
counterweight stack stands above its link, or hangs below it; then the links
stand higher above the base to make room. The
README in the zip lists the layers, the print settings and the order to put
the parts together.

## Export for further analysis (acceleration, dynamics)

Set the input to the position you want (type θ₂ or s in the motion bar), then
**Export › For further analysis**:

- **Link parameters (.csv):** one file for Excel with labelled tables:
  - *Joints:* name, textbook label (O2, A, B, O4 for a fourbar), x, y, and
    the velocity and acceleration of each joint.
  - *Links:* link number (ground = 1), joints, length, angle, ω and α. The
    angle is measured from the link's *from* joint to its *to* joint (a ground
    pivot or the motor pivot is always the *from* joint).
  - *Link geometry:* each joint in the link's own frame (origin at *from*, u
    towards *to*, v 90° counter-clockwise). Use it to place centres of mass
    for dynamics.
  - *Distances:* every joint-to-joint distance on each link (plates have
    more than one).
  - *Connections:* pins, sliders (with position, velocity and acceleration),
    prismatic, roll and roll + slip joints, and actuators.
- **Link parameters (.json):** the same data for MATLAB (`jsondecode`),
  Python (`json.load`) or your own programs.
- **Motion data (.csv):** every joint and link over the whole cycle.

Joints are named J1, J2, … in every export. Turn on **Names** in the top bar
to see the names on the drawing; Properties also shows the name of the
selected joint.

## Touch screens and iPad

Drag with one finger as you would with the mouse. Two fingers pan and
pinch-zoom. Press and hold a link or joint for its menu (the right-click
menu). On iPad, use the hosted web version in Safari (iPadOS does not run
HTML files from the Files app).

## Saving, opening and clearing

- **Save (Ctrl+S or ⌘S):** in Chrome and Edge the first Save asks where to
  keep the file and what to call it; after that Save writes to the same file
  without asking. In Safari, on iPad and in Firefox the file goes to your
  Downloads folder each time.
- **Save as (Ctrl+Shift+S):** save a copy under a new name or in another
  folder; later saves go to the new file.
- **Open (Ctrl+O):** open a `.linklab.json` file (or drop it on the window).
  Save then writes back to the file you opened.
- **Clear:** clear everything, or only the mechanism, the construction or the
  background picture. A clear is one step: **Ctrl+Z** brings it back. A circle
  or line that a roll joint uses is kept when you clear the construction.
- **New:** start a new, untitled drawing.

LinkLab also keeps your last drawing in the browser and brings it back the
next time you open it.

## Units and grid

The **Units** menu in the top bar (Basic and Advanced) sets every unit at
once:
- SI (mm): mm, N, N·m, kg, kg·m²
- SI (m): m, N, N·m, kg, kg·m²
- US (in): in, lb, lb·in, blob (lb·s²/in), lb·in·s²
- US (ft): ft, lb, lb·ft, slug, slug·ft²

Its last entry, **Units and grid…**, opens a window where **Length, Force,
Torque, Mass** and **Moment of inertia** can each be chosen on their own
(for example kN, N·mm, g, lbm, kg·mm²; the menu then reads *Custom*), with
the grid settings below.

Everything shown and typed uses these units: coordinates, lengths,
Properties, the mass and force popups, Kinematics, Forces, free-body labels,
plots, the motion bar and the CSV/JSON exports (column names carry the
unit). The values themselves never change, so switching units back and forth
changes nothing, and the choice is saved with the drawing. It is not an
undo step: **Ctrl+Z** leaves it as it is, as it does the lengths lock, the
output, the input speed, the drawing's name and the layers. A textbook
problem in US units can be typed exactly as given. DXF files for CAD are
always in mm.
- **Grid spacing:** automatic (follows the zoom) or a fixed spacing in your
  unit. Every fifth line (fourth for inches) is darker.
- **Snap to grid lines:** points snap to the grid as well as to geometry.
  (Both are in the **Units and grid…** window.)

## Display: text and arrow size, arrow colours

Under **Sheet › Display**:
- **Text size** (100 to 200 %): every label and value on the drawing, link
  numbers, joint names, the input/output tags, and the text on the plots.
- **Arrow size** (100 to 250 %): the length, width and head of force, load
  and torque arrows.
- **Angle axis ticks** on the plots: automatic (15°, 30°, 45°, 60° or 90°,
  as the width allows) or every 15°, 30°, 45°, 60° or 90°.
- **Colours** of the arrows: applied forces and torques; in Advanced also
  joint forces, weight and inertia, and the input torque. ↺ goes back to the
  default colour.
- **Back to normal** resets all of them.

For a projector, try 150 %. These settings stay on the computer; they are not
saved in the drawing, so files look the same for everyone else. Labels move
up or down to keep clear of each other as they grow.

Angles are in degrees, counter-clockwise from +x. ω is in rad/s and α in
rad/s²; velocities and accelerations of points are in your unit per second
(and per second squared).
