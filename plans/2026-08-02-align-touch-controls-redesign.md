# Align — touch controls redesign (phase plan)

**Status:** 📋 IN PROGRESS — reworking the on-screen touch pad ergonomics.

## Problem Statement

The current Align touch pad (`.al-touch`) is a single wrapping row of seven
equal squares (⟲ ◄ ▼ ► ⟳ ⤓ ⇄). On a phone this reads as an undifferentiated
strip: the two most-used actions (move left/right) are the same size and weight
as everything else, the two rotate directions are split to opposite ends, and
nothing maps to where thumbs naturally rest. The user (playing on a phone at
`fun.croft.ing/align/`) asked for a layout with clear thumb zones and a good
distinction between button roles.

## Reasoning / desired design (from the user)

A vertically-stacked control block under the board, sized to the board width:

- **Row 1 — movement:** two wide buttons, 50% / 50% — **◄ Left** | **Right ►**.
  These are the primary actions and get the most surface. Auto-repeat on hold
  (DAS/ARR) as today.
- **Row 2 — rotate:** two buttons under their matching arrow — **⟲ (CCW)** under
  Left, **(CW) ⟳** under Right. This restores the second rotate direction on
  touch (the first sketch had a single rotate; the user course-corrected). No
  auto-repeat.
- **Row 3 — drop / hold:** three buttons in one row — **soft drop** (slow, one
  step per tap, auto-repeat on hold), **hard drop** (slam + lock), **Hold**
  (swap-aside). The earlier tap-vs-hold-timing idea for a single down button is
  dropped in favour of explicit separate buttons — the user's call, and it keeps
  the input model discrete (no wall-clock press-duration on the input path).

All the underlying `Action`s already exist in the core (`ShiftL`, `ShiftR`,
`RotCCW`, `RotCW`, `SoftStep`, `HardDrop`, `Hold`) — this is purely a front-end
+ CSS reshape. No core / determinism changes.

## Verified assumptions

- The core exposes every needed action — verified in `align-wasm.ts` (`Action`
  union) and used already in `buildStage()`.
- The `align-board` guide shot clips `.al-game` (the whole wrapper, pad
  included) — verified in `tools/guide-shots.mjs` — so the pad reshape changes
  the shot and it MUST be regenerated (`assets/guide/align-board.jpg`), per
  CLAUDE.md. A unit test (`tests/how-to.test.ts`) + e2e guard the reference.
- `tests/align.spec.ts` asserts `.al-touch` is visible and the narrow-phone
  no-overflow guard — both must keep passing (update the selector if the class
  changes; keep the no-overflow invariant).

## Phases

- **P1 — RED:** extend `tests/align.spec.ts` to assert the new structure:
  the movement row (two wide buttons), a rotate row (both directions), and a
  drop/hold row (soft, hard, hold) all present and wired through the core; keep
  the narrow-phone no-overflow guard. Watch it fail.
- **P2 — GREEN:** rebuild `buildStage()`'s pad as the three-row block; add the
  CSS (`.al-pad`, `.al-pad-move`, `.al-pad-rot`, `.al-pad-drop`, button
  modifiers) sized to the board width, theme-aware, AA, ≥44px touch targets.
- **P3 — a11y + fit:** axe clean light/dark; 360px-wide phone no horizontal
  overflow; keyboard path untouched.
- **P4 — guide shot + copy:** regenerate `assets/guide/align-board.jpg`; refresh
  the how-to controls copy if it describes the pad layout. `git add` only the
  align shot.
- **P5 — gate + commit:** typecheck · lint · unit · build · align e2e green;
  commit at the green point.
