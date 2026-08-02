# Align — touch feedback, button contrast, and move sensitivity (phase plan)

**Status:** 📋 IN PROGRESS — follow-up to the three-row touch pad (PR #20, merged).

## Problem Statement

Three issues with the new phone pad, from the player:

1. **No tactile feedback.** Presses feel dead — wants a haptic buzz, on by default.
2. **Icons are hard to read.** The glyphs (◄ ► ⟲ ⟳ ▼ ⤓ ⇄) are thin and the
   buttons low-contrast against the page; the pad should read more clearly.
3. **Left/right is too fast, and there's no way to tune it.** Holding a move
   button auto-shifts every 40 ms with no initial delay — a light hold rockets
   the piece across the well. Needs (a) a calmer default and (b) an adjustable
   sensitivity.

## Reasoning / design

- **Haptics.** `navigator.vibrate()` — a short buzz on every touch-control
  `pointerdown`, gated by a new **on-by-default** setting `fun-align-haptics`.
  Degrades silently where the API is absent (desktop, iOS Safari). A "Vibration"
  toggle joins the Align settings sheet. Also add a visual press cue
  (`:active` uses the semantic `--active` pair + a 1px depress) so feedback lands
  even without a vibration motor.
- **Contrast.** Bolder, larger glyphs (`font-weight: 700`) and a stronger border
  (`--ink-muted` beats the faint `--border`) — semantic tokens only, so the
  no-raw-hex + AA gate stays green.
- **Sensitivity.** Two changes to the hold-repeat on the left/right buttons:
  - add a fixed initial delay (DAS) before auto-repeat begins, so a tap is one
    clean cell and a hold waits a beat before sliding;
  - make the repeat interval driven by a new **Left/right speed** setting
    (`fun-align-move-speed`, an integer 1–10, default 5) mapped to ms by a pure
    `moveSpeedToMs` (1 → 250 ms slow … 10 → 50 ms fast; default 5 ≈ 161 ms, far
    calmer than the old 40 ms). Slider drag-right = faster, the intuitive sense.
  Soft-drop keeps its own snappy fixed cadence — the complaint is horizontal.

  Determinism unaffected: handling is input *timing*, not on the hashed path;
  each captured input is still tick-stamped, so every run stays verifiable.

## Verified assumptions

- `src/settings.ts` already has the bool + numeric persisted-setting pattern
  (`read`/`write`, `readNum`/`writeNum`, `resolveNumber`, `NumberSpec`) and the
  bubble aim sheet shows toggle+range rows — mirror both.
- `styles.css` is tokens-only (`tests/tokens.test.ts`); `rgb(… / …)` is allowed,
  raw hex is not. `--active`/`--active-ink` is the semantic pressed pair.
- The `align-board` guide shot clips `.al-game` (pad included) → regenerate it.
- Storage-backed accessors are e2e-tested (vitest localStorage shim is
  non-standard, per `tests/settings.test.ts`); only pure resolvers/maps get unit
  tests. So `moveSpeedToMs` gets a unit test; haptics/persistence get e2e.

## Phases

- **P1 RED (unit):** `moveSpeedToMs` mapping test in `tests/settings.test.ts`.
- **P2 GREEN (settings):** add `alignHapticsEnabled`/`setAlignHaptics`,
  `alignMoveSpeed`/`setAlignMoveSpeed` + `ALIGN_MOVE_SPEED_SPEC`, `moveSpeedToMs`.
- **P3 RED (e2e):** extend `tests/align.spec.ts` — a stubbed `navigator.vibrate`
  fires on a move tap (on by default) and stops when the toggle is off; the
  speed slider renders, persists across reload, and a slow setting yields fewer
  hold-repeats than a fast one.
- **P4 GREEN (front-end + CSS):** rework `touchButton` (opts: DAS + configurable
  repeat + haptic), wire the two settings into the sheet, add the contrast +
  press CSS.
- **P5:** axe light/dark + 360px fit stay green; regenerate `align-board.jpg`
  (only that shot); refresh how-to copy.
- **P6:** gate green → commit → PR → rebase → merge.
