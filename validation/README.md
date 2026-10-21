# Validation against the textbook

This folder holds check cases taken from worked examples in Norton,
*Design of Machinery*. They are used only for testing and are never shipped
in the apps. Each case cites the example number; the book's text and figures
are not copied.

## Adding a case

Create a JSON file in `cases/`, for example `cases/fourbar-ex-4-1.json`:

```json
{
  "source": "Norton 5th ed., Example 4-1",
  "type": "fourbar",
  "input": { "a": 40, "b": 120, "c": 80, "d": 100, "theta2_deg": 40, "omega2": 25, "alpha2": 15 },
  "expect": { "open": { "theta3_deg": 0, "theta4_deg": 0 } },
  "tolerance": { "angle_deg": 0.01, "relative": 1e-3 }
}
```

Fill `expect` with the book's answers, then run:

```bash
npm run validate
```

Supported `type` values: `fourbar`, `slider-crank`. Expected fields
(all optional): `theta3_deg`, `theta4_deg`, `omega3`, `omega4`, `alpha3`,
`alpha4`, `d`, `vd`, `ad`, under `open` and/or `crossed`.

## Status

No textbook cases have been entered yet. The engine is currently verified by
the automatic tests in `apps/linklab/tests/`, which check the general solver
against Norton's closed-form equations and against finite differences.
