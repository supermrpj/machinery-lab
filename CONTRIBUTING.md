# Contributing

Thank you for helping. LinkLab and CamLab are teaching tools, so clear and
correct results matter more than new features.

## Reporting a problem

Open an issue on GitHub and include:

- the app and version (shown at the right of the top bar),
- the browser and device,
- what you did, what you expected and what happened,
- the design file (`.linklab.json` or `.camlab.json`) if you can share it.

For a wrong number, say where the right value comes from (a hand
calculation, a worked example, another program).

## Suggesting a change

1. Open an issue first for anything larger than a small fix, so we can
   agree on the approach.
2. Read `docs/DESIGN.md` before changing the interface and
   `docs/ARCHITECTURE.md` before changing the code layout.
3. Keep settings in the `CONFIG` section of the file or in the app's
   `config.js`, and keep the code readable.
4. Add or update tests, and run `npm test` and `npm run build` before you
   open a pull request.

By contributing, you agree that your contribution is licensed under the
GNU GPL v3 with the terms in `NOTICE.md`, like the rest of the project.
