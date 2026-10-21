# Machinery Lab — design guide

This guide sets out how LinkLab, CamLab and later tools should look, feel and
behave. Read it before adding a feature or changing the interface. When a
decision isn't covered here, choose what a mechanical engineer at a drafting
table would expect.

---

## 1. Who it is for and what it is

**Users:** third-year mechanical engineering students (50–60 a year) and their
instructor. They know Norton's notation and have drawn mechanisms by hand. They
are not software experts, they use the app under time pressure in a lab or at
home, and many will try it first on a laptop with a trackpad.

**What it is:** a **drafting table that moves**. The student draws exactly as
on paper, with compass, straightedge and protractor, and then the drawing
comes alive. Everything in the interface should support that one idea.

**What it is not:** a CAD package, a dashboard or a quiz. If a screen starts
to look like a SaaS admin panel, it has gone wrong.

---

## 2. Design principles (in priority order)

1. **The drawing is the interface.** Wherever possible, act directly on the
   sheet: drag the joint, drag the compass leg, drag the link. Panels are for
   reading results and typing exact numbers, never the only way to do
   something you can see.
2. **Instruments, not commands.** Drafting tools are physical objects that
   stay on the sheet (compass, protractor, later ruler and set square), with
   handles that behave like the real thing. A student who has used a real
   compass should not need the help page.
3. **Exact by default.** Snapping to intersections, ends and centres makes
   constructions precise. Every snap shows what it snapped to. Typed numbers
   are always available for the last 0.01 mm.
4. **Show the method, not only the answer.** Results come with the equation
   and the numbers substituted (Norton's notation, link numbering and sign
   conventions). The "glass box" is the point of the software.
5. **Nothing is lost.** Every change can be undone. Work is autosaved.
   Nothing is deleted without a visible action. Errors never wipe a drawing.
6. **Calm surface, loud mechanism.** The chrome (bars, panels, buttons) is
   quiet and neutral, so the mechanism, with its colours, motion and traced
   curves, is what the eye goes to.

---

## 3. Interaction rules

### 3.1 Direct manipulation
- **Hover tells, press acts.** Hovering over something you can grab changes
  the cursor (move, grab, crosshair) and shows its snap target. Nothing
  changes on hover alone.
- **Drag to change, click to choose.** Dragging edits geometry, and clicking
  selects or places. A drag shorter than 3 px counts as a click.
- **Two kinds of drag are always distinct:**
  - dragging a **joint** changes the **design** (lengths change);
  - dragging a **link** moves the **mechanism** (lengths stay the same).
  The cursor is different for each (move vs. grab).
- **Edit where you are.** When the mechanism has moved, an edit is made at the
  position on screen, so the drawing never jumps back without warning.

### 3.2 Tools and modes
- One tool is active at a time, shown in ink on the tool strip, and named in
  the hint bar along with what it expects next ("Click the other end of the
  link…").
- Multi-step tools show a **live preview** of the next result (a ghost link,
  an arc being swept, a rail being laid) in the preview blue.
- **Esc** always goes back one step, then to Select. **Right-click** ends a
  chain. A tool never traps the user.
- Every tool has a single-letter key, shown on its button.

### 3.3 Instruments (compass, protractor, …)
- Each instrument stays on the sheet while its tool is active and keeps its
  setting (radius, angle) between uses, like a real one on a desk.
- Each handle has a single job, and its shape shows that job:
  | Handle | Look | Job |
  |---|---|---|
  | needle / centre | steel point, ring | move the instrument |
  | pencil tip | graphite lead | change the radius |
  | knob / grip | knurled cap | turn: draw an arc, or rotate |
  | rim | scale edge | mark a point or draw a ray at the angle |
- Instruments are drawn **realistically** (brushed steel, clear plastic with
  printed scales), in the spirit of GeoEnzo, because their realism is what
  makes them self-explanatory. They are semi-transparent, so the drawing under
  them stays readable.
- Every instrument shows its live reading next to it (`r = 40.00`, `57.5°`)
  and has exact entry fields in Properties.

### 3.4 Snapping
- Priority: joint → intersection → end/centre/point → on a curve → grid (off
  by default).
- The marker shape tells you the kind of snap: ✕ intersection, □ end point,
  ◯ centre or joint, △ midpoint, + on a curve. It is drawn in the snap red.
- Snapping is suggested, never forced: the marker appears **before** the
  click, so the user can always see what will happen.

### 3.5 Feedback and timing
- Every input gives visible feedback within one frame. Solving a pose must
  stay under about 4 ms for normal mechanisms; anything slower is computed
  once (the cycle sweep) and cached.
- Messages ("toasts") are short, in plain language, and say what happened and
  what to do: *"Limit position reached: the input cannot turn further this
  way."* They disappear by themselves. Use one blocking dialog at most, and
  only for destroying work.
- Problems are explained in the Analysis panel, never just as a red X:
  *"The mechanism has 2 degrees of freedom. It needs exactly 1 to be driven by
  one input."*

### 3.6 Motion
- Motion carries meaning: the mechanism moving, an arc being drawn, a cursor
  following the plots, and the short looping demos in the tool guides (which
  show exactly which clicks to make). Decorative animation (fades, bounces,
  slide-ins) is not used.
- Respect `prefers-reduced-motion` for interface transitions. The mechanism
  itself still moves, because that is the content. Guide demos show a still
  picture and play once when clicked.
- The mechanism moves along its real path of motion: through toggle
  positions it flips assembly smoothly, never jumps or chatters. Special
  positions (toggle, stationary) are named on the drawing, in the motion bar
  and on the plots, and a drag rests at them.
- Plots, the angle readout and the drawing always show the **same instant**.
  Clicking a plot moves the mechanism there.

### 3.7 Keyboard, mouse, pen, touch
- Everything works with a mouse alone. Keys are shortcuts, never the only
  way.
- Pointer events only (no mouse-only handlers), so pen and touch work. Hit
  targets on the sheet are at least 11 px, and buttons at least 32 px.
- Wheel to zoom about the cursor; Space-drag, middle-drag or empty-space drag
  to pan; **F** to fit.

---

## 4. Visual language

### 4.1 Concept
Two layers with two moods:

- **The chrome** (top bar, tool strip, panels, buttons, dialogs, guide cards)
  is **neubrutalist**: thick ink outlines, hard offset shadows, flat yellow,
  red and blue, no gradients and no blur. It is loud on purpose, so every
  control looks like something you can press. This section is how LinkLab
  adapts the neubrutalist style.
- **The drawing sheet** stays a quiet sheet of pale drafting vellum with
  graphite construction lines, coloured inked links and steel instruments.
  The mechanism must be the most colourful thing on screen, so the chrome
  never bleeds onto the sheet.

What we take from the neubrutalism source, and what we change:

| Source says | LinkLab does | Why |
|---|---|---|
| 3 px black borders, 4 px offset shadow | 2 px on controls, 3 px on panels, cards and dialogs; shadows 2–5 px | dense tool UI; 3 px on every small button is too heavy |
| `#000000` neutral | ink `#1D1D1F` | the source's own "no pure black" rule |
| 0 or 8 px corners | 4 px everywhere | one radius; crisp but not hostile |
| uppercase label captions | sentence case | our rule in §4.3 and §6 |
| entry animations, staggered lists | none | §3.6: motion only where it means something |
| hover: colour shift and shadow | buttons lift 1 px with a bigger shadow, press flat on click | tactile feedback, not decoration |

### 4.2 Colour tokens
Defined once in `styles.css` (`:root`) for the chrome and `config.js`
(`THEME`, `LINK_COLORS`) for the drawing. Never hard-code a colour elsewhere.

Chrome:

| Token | Value | Use |
|---|---|---|
| `--ink` | `#1D1D1F` | text, borders, shadows |
| `--yellow` | `#FFEB3B` | top bar, active tool, primary buttons, dialog and guide headers |
| `--red` | `#FF5252` | warnings, limit chip, error toast, close-button hover |
| `--blue` | `#2196F3` | focus ring, keyboard focus, input focus |
| `--surface` | `#FFFFFF` | buttons, inputs, cards |
| `--panel` | `#FFFDF2` | side panel, tool strip, timeline |
| `--panel-2` | `#FFF8D6` | tips, table headers, output read-out |

Drawing sheet (unchanged by the restyle):

| Token | Value | Use |
|---|---|---|
| paper | `#F4F5F1` | drawing sheet |
| ink | `#1D2433` | joints, outlines |
| graphite | `#4E5562` | construction lines |
| select / preview | `#1E5BD7` | selection, tool previews |
| snap | `#D1462F` | snap markers only |
| trace | `#0F6F7C` | coupler curves |
| output | `#7A3E9D` | the chosen output marker and output plots |
| link colours | validated 8-colour set | link n, and the same link in every plot |

Rules:
- **A link keeps its colour everywhere**: on the drawing, in the tables and in
  the plots. Colour is never the only cue, because every link also shows its
  Norton number.
- Yellow means "this is the thing you can press, or the thing that is on".
  Red is reserved for snapping and warnings, and blue for selection, previews
  and focus. None of them is used for decoration.
- The link colour set passes colour-blind separation checks. Re-run the
  validator if it changes.

### 4.3 Typography
- The system UI font (Segoe UI on Windows), plus Leelawadee UI / Noto Sans
  Thai for Thai text. This keeps the app offline with no font files.
- Numbers use tabular figures and a real minus sign (−). Angles have a degree
  sign, and lengths always show their unit.
- Use Norton's symbols in readouts: θ₂, ω₃, α₄, μ, with subscripts as real
  Unicode subscripts.
- Use sentence case everywhere. Don't use all-caps labels.

### 4.4 Shape and space
- One radius (4 px). Elevation is a hard ink shadow, never a blur: 2 px on
  buttons, 3 px on the hint and prompts, 5 px on guide cards, 8 px on dialogs.
  Panels themselves are flat and separated by ink rules.
- A pressed control loses its shadow and moves into it (the active tool, the
  locked padlock, a button being clicked).
- Use a 4 px spacing grid. Panels are dense but not cramped, because
  engineers like information.
- Mechanism drawing conventions follow the textbook: a ground pivot is a
  triangle with hatching, a slider is a block on a hatched rail, joints are
  open circles, and link numbers are in circles.

---

## 5. Words

- Write from the student's point of view, in plain verbs: *Draw full circle*,
  *Make this the input*, *Set scale from a known length*.
- An action keeps the same name through the whole flow: the button *Save*
  leads to the message *Saved as …*.
- Use textbook terms where the textbook has them (Grashof, transmission angle,
  toggle position, coupler curve) and plain words everywhere else.
- Each tool has a guide card (`ui/guides.js`): numbered clicks in the order
  the student makes them, and at most one tip. It appears the first time the
  tool is chosen and can be reopened from the hint bar.
- Hints say what to do next, not what the tool is: *"Click the joint that
  should slide"*, not *"Slider tool active"*.
- Don't use exclamation marks, filler or apologies.

---

## 6. Things we never do (the "AI slop" list)

If a change matches any of these, it is wrong:

1. **Card soup:** results chopped into identical rounded cards with soft grey
   shadows and gradient washes.
2. **Fake dashboards:** big hero numbers with tiny labels for things that are
   really table rows.
3. **Emoji or decorative icons** in buttons, headings or messages.
4. **Template chrome:** all-caps eyebrow labels over every section, `A · B · C`
   meta strings, or `→` on every link.
5. **Default palettes:** purple-to-blue gradients, neon-on-black, or the
   generic cream-and-terracotta "AI" look.
6. **Modal wizards** for things that can be done directly on the drawing.
7. **Hidden state:** values that change without a visible cause, tools that
   act on something off-screen, or a mode you can't see.
8. **Vague messages:** "Something went wrong", "Invalid input", or a bare red
   border.
9. **Duplicate controls** that do the same thing in two places with different
   names.
10. **Decorative motion:** sections fading or sliding in, bouncing buttons, or
    hover animations on everything.
11. **Lorem-ipsum thinking:** placeholder text, example values with no units,
    or "Feature coming soon" buttons.
12. **Dual-axis charts.** Use one quantity per chart, with small multiples
    side by side.

---

## 7. Accessibility floor

- Text contrast at least 4.5:1, and controls at least 3:1, against their
  background.
- Every button has an accessible name. Toggle buttons expose `aria-pressed`.
- Visible focus ring (`:focus-visible`) on everything focusable.
- Never rely on colour alone (link numbers, snap marker shapes, text tags
  such as "Grashof").
- The layout works from 1366×768 laptops up. Tablets work, and phones can
  view and play.

---

## 8. Checklist for every new feature

Before merging, check that:

- [ ] It can be done by direct manipulation on the drawing (or there is a
      good reason why not).
- [ ] The hint bar says what to do at every step, and Esc backs out.
- [ ] A new tool has a guide entry (steps, and a demo if the clicks are not obvious).
- [ ] It is undoable in one step, and autosave picks it up.
- [ ] Numbers show units, Norton symbols and real minus signs.
- [ ] Colours come from the tokens, and nothing on the "never" list appears.
- [ ] It works with mouse, keyboard shortcut and pen.
- [ ] There is a test for the maths and a browser check (screenshot) for the
      interface.
- [ ] The user guide and changelog are updated.
