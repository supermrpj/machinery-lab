# LinkLab and CamLab

Free teaching software for **Mechanics of Machinery**. Draw a mechanism,
watch it move, and read the numbers. Both apps run in a web browser, with no
install and no login, and work offline.

**Website:** https://supermrpj.github.io/machinery-lab/ ·
**Open LinkLab:** https://supermrpj.github.io/machinery-lab/app/ ·
**Open CamLab:** https://supermrpj.github.io/machinery-lab/camlab/ ·
**Download the single files:** [LinkLab.html](https://supermrpj.github.io/machinery-lab/download/LinkLab.html), [CamLab.html](https://supermrpj.github.io/machinery-lab/download/CamLab.html)

| App | What it does | Version |
|---|---|---|
| **LinkLab** | Draw graphical constructions with compass, protractor and straightedge, draft planar linkages on top (pin, sliding, pin-in-slot, rolling and roll + slip joints) and watch them move. Motors, linear actuators and pushed sliders as inputs, any output plotted against the input; position, velocity and acceleration analysis; static and dynamic force analysis (joint forces, input torque, shaking forces); force balancing with counterweights and a rotor balancing calculator; tolerance study of pin clearance (play, error under the load, knocks, a magnifier on the drawing); bearing loads as polar diagrams; plot presets; animated tool guides; DXF export for SolidWorks and Inventor. Basic and Advanced modes. | 0.11.0 |
| **CamLab** | Disk cams with a translating roller or flat-faced follower, designed by the analytical method: motion laws from constant velocity to polynomials, the cam turning beside its SVAJ, pressure angle and curvature, force and torque plots; spring and follower jump; the part with its mounting (keyway, D-flat, hub with set screw, bolt circle) exported as STL for 3-D printing, STEP and DXF for CAD. The graphical method as a step-by-step tutorial. Basic and Advanced modes. | 0.3.0 |

## Using the apps

- **Online:** open the website and choose an app. After the first visit it
  also works without internet. On iPad, open it in Safari; Share › Add to
  Home Screen keeps it as an app.
- **As a file:** download `LinkLab.html` or `CamLab.html` from the website
  (or build them, below) and double-click it. One file, no installation, no
  internet. This is the easiest way to give the apps to a class.

Designs are saved as files on your own device; the apps send nothing
anywhere. Guides: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) (LinkLab) and
[`docs/CAMLAB_GUIDE.md`](docs/CAMLAB_GUIDE.md) (CamLab).

These are teaching aids. Check important results independently before using
them to design a real machine.

## Building from source

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install          # once: installs the build tool (esbuild)
npm run dev          # live development: http://localhost:5173/apps/linklab/
npm test             # run all automatic tests
npm run build        # dist/LinkLab.html, dist/CamLab.html and the website in dist/web/
```

The website is published from `dist/web/` by GitHub Actions
(`.github/workflows/pages.yml`) at every push to `main`.

## Folder layout

```
apps/
  linklab/
    index.html          page template (development + build)
    src/
      config.js         ALL adjustable settings (colours, snap distance, solver)
      main.js           start-up: wires everything together
      model/            the document: joints, links, drawings; undo; save/load
      kinematics/       solver, closed-form fourbar & slider-crank, mobility
      drawing/          canvas, view (pan/zoom), snapping, drawing tools
      ui/               panels, plots, styles
    tests/              automatic tests (run with npm test)
  camlab/
    src/
      config.js         settings: design rules, sampling, Basic/Advanced, colours
      model/            motion laws, program, cam geometry, dynamics, analysis
      export/           DXF R2000 spline, points, STL
      ui/               panels, views (graphical method, cam, SVAJ, size, forces)
    tests/              checks against worked examples, geometry, export
packages/
  core-math/            vectors, intersections, linear algebra (shared)
  plotting/             synced plots with a cursor, wheel zoom, open large (shared)
  ui-kit/               shared formatting, file helpers, Basic/Advanced switch
  cad-export/           DXF and ZIP writers, link outlines (shared)
validation/             textbook check cases (not shipped)
docs/                   user guides, design and architecture notes
site/                   the website's landing page, icons and pictures
tools/                  build, dev server, licence notices, set-owner
desktop/                Windows .exe wrapper (later)
dist/                   build output (not stored in git); dist/web is the website
```

## How the kinematics works

Every moving link has three unknowns (x, y, φ). Pins, ground pivots, sliders
and the input angle each add constraint equations Φ(q, θ) = 0, which are
solved by Newton–Raphson starting from the previous position, so the
mechanism stays in the same assembly (open or crossed). Velocity and
acceleration come from the linear equations J q̇ = ν and J q̈ = γ. This works
for any planar linkage that can be drawn, not only the fourbar.

Motion is followed along the mechanism's path in configuration space
(pseudo-arclength continuation, `kinematics/path.js`) rather than by stepping
the input angle, so the motion passes smoothly through toggle positions where
the input reaches its limit and the mechanism changes assembly. Toggle (input
limit) and stationary (output limit) positions are found where the rates of
the input and output change sign, and refined by a line search.

When the drawing is a fourbar or a slider-crank, LinkLab also evaluates
the closed-form equations. The tests check that both methods agree to
better than 10⁻⁸ over full cycles, in both assemblies.

## Documents

- `docs/USER_GUIDE.md` — how to use LinkLab
- `docs/CAMLAB_GUIDE.md` — how to use CamLab
- `docs/DESIGN.md` — design and interaction rules (read before changing the interface)
- `docs/ARCHITECTURE.md` — code layers; Windows / Mac / iPad, `.exe` and 3-D plans
- `CONTRIBUTING.md` — reporting problems and suggesting changes

## Credit and licence

LinkLab and CamLab were created by **Maroay P**. Copyright © 2026 Maroay P.

They are free software under the GNU General Public License, version 3
(`LICENSE`), with the additional terms in `NOTICE.md`: keep the credit line
and the link to this repository in the About box, mark a changed version as
changed, and give it a name of its own. Third-party components are listed in
`THIRD_PARTY_NOTICES.md`.

If you use the apps in teaching material or a paper, please cite them
(GitHub: **Cite this repository**, from `CITATION.cff`), for example:

```bibtex
@software{phlernjai2026linklab,
  author  = {Maroay P},
  title   = {LinkLab and CamLab: teaching software for Mechanics of Machinery},
  year    = {2026},
  url     = {https://github.com/supermrpj/machinery-lab},
  license = {GPL-3.0-only}
}
```

The workflow behind LinkLab, with a worked example and the classroom
experience, is described in: M. Phlernjai, "From Math to Motion: Interactive
Mechanism Design in Modern Workflows and Education," RESTCON 2026, Fukuoka,
Japan, Nov. 2026.

## Support

The apps are free and will stay free. If they help your teaching or study,
you can support the work through
[GitHub Sponsors](https://github.com/sponsors/supermrpj).
