# Architecture, and how it grows

This explains how the code is layered, and how the same code will grow into
desktop apps (`.exe`, Mac), iPad and 3-D linkages without a rewrite.

## 1. Layers

```
┌──────────────────────────────────────────────────────────────────┐
│ ui/            panels, dialogs, plots          (DOM)             │
│ drawing/       canvas renderer, tools, snapping, instruments     │
│ export/        DXF / ZIP / CSV builders        (no DOM)          │
├──────────────────────────────────────────────────────────────────┤
│ model/         document, history, simulation, files (no DOM)     │
│ kinematics/    constraint system, solver, Norton closed forms    │
├──────────────────────────────────────────────────────────────────┤
│ packages/core-math   vectors, geometry, linear algebra           │
│ packages/cad-export  DXF writer, ZIP writer, link outlines       │
│ packages/plotting    charts                                      │
│ packages/ui-kit      DOM helpers, formatting, PLATFORM SEAM      │
└──────────────────────────────────────────────────────────────────┘
```

Rules:
- **Lower layers never import higher ones.** The kinematics and model run in
  Node (that is how the tests run) and know nothing about the screen.
- **All contact with the operating system goes through
  `packages/ui-kit/src/files.js`** (save, open, download, local storage).
  That file is the *platform seam*: a desktop or iPad wrapper replaces it,
  and nothing else changes.
- **Units:** mm, radians internally, and degrees only at the interface.

## 2. Platforms: Windows, Mac and iPad

The apps are web apps written in standard JavaScript, so the same code runs on
every platform. How each one gets it:

| Platform | Now (v0.x) | Later |
|---|---|---|
| Windows | `LinkLab.html`, opened in Edge or Chrome | `.exe` installer (Tauri) |
| macOS | `LinkLab.html`, opened in Safari or Chrome | `.app` / `.dmg` (Tauri) |
| iPad | the hosted web version, opened in Safari and added to the Home Screen | App Store app (Tauri 2 iOS), if wanted |
| Chromebook, Linux, Android tablets | `LinkLab.html` or the hosted version | — |

What makes this work:
- **Pointer events everywhere.** Mouse, pen (Apple Pencil, Surface pen) and
  touch use the same code. Two fingers pan and pinch-zoom. Hit targets are
  sized for fingers.
- **Ctrl or ⌘.** Shortcuts accept both; Alt and Option are the same key.
- **No browser-specific features.** The code needs Safari 16 / iPadOS 16 or
  newer, or a current Chrome, Edge or Firefox.
- **Files.** Saving uses a download (on iPad it goes to the Files app), and
  opening uses the standard file picker. Desktop wrappers will swap in native
  Save/Open dialogs through the platform seam.

**iPad note:** iPadOS will not run an `.html` file opened from the Files
app, so iPad users need the hosted version (for example on GitHub Pages).
Hosting also lets us add a web-app manifest and offline cache (a "PWA"), so
LinkLab installs on the Home Screen and works offline.

## 3. The `.exe` (and Mac app) path

[Tauri](https://tauri.app) wraps the built page in a small native window that
uses the operating system's own web engine (WebView2 on Windows, WebKit on
macOS and iOS). The installer is about 10 MB. Steps, when needed:

1. `desktop/` gets a Tauri project that loads `dist/LinkLab.html`.
2. A `files.tauri.js` version of the platform seam provides native Save/Open.
3. The build adds `npm run build:desktop`, producing `LinkLab-setup.exe` and
   `LinkLab.dmg`.
4. Tauri's licence notices (MIT / Apache-2.0) go into
   `THIRD_PARTY_NOTICES.md`.

Code signing (so Windows and macOS don't warn "unknown publisher") needs a
certificate, about US$100–300 a year. Without one, the installer still works
after the user clicks through the warning.

## 4. The 3-D path

The planar solver was written so that it generalises:

| Planar now | 3-D later |
|---|---|
| 3 coordinates per body (x, y, φ) | 7 per body (x, y, z + a unit quaternion) |
| constraint objects with `rows`, `eval`, `gamma` | same interface, 3-D versions |
| revolute, prismatic, pin-in-slot, roll, roll + slip | + spherical, universal, cylindrical, screw |
| Gruebler: M = 3(L−1) − 2J₁ − J₂ | Kutzbach: M = 6(L−1) − Σ(6 − fᵢ) |
| canvas 2-D renderer | WebGL renderer (three.js, MIT licence) |
| DXF export | STEP export of parts, and native SolidWorks / Inventor macros for assemblies |

The solver itself (Newton–Raphson with damping, J q̇ = ν, J q̈ = γ) and the
numeric DOF check from the Jacobian rank do not change. The 3-D app will be a
new app in `apps/` that reuses `packages/` and the solver pattern.

## 5. CAD interchange

| Need | Format | Status |
|---|---|---|
| Link parts → SolidWorks / Inventor sketch | DXF R12 (one per link) | done |
| Layout of the mechanism | DXF R12 with layers | done |
| Coupler curve → CAD curve | X Y Z text (SolidWorks *Curve Through XYZ Points*) | done |
| Motion data → Excel | CSV | done |
| Solid parts | STEP AP214 (extruded links) | planned |
| Assembly with mates | SolidWorks VBA macro / Inventor iLogic rule generated from the model | planned (exploratory) |
