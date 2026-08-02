# Bubble — aim controls redesign + a reusable settings sheet (phase plan)

**Status:** 📋 IN PROGRESS — restyling the aim bar and adding a legible,
demo-driven aim-controls settings menu, scaffolded for reuse across the shelf.

## Problem Statement

Playing bubble on a phone (`fun.croft.ing/bubble/`), the user likes the
slider-bar aiming but wants the ergonomics and legibility improved:

1. The aim slider is small and un-themed; the **thumb is too small** to grab
   reliably with a finger.
2. The **Fire button** should be the **full width of the slider**, sitting
   directly **below** it, so the label + slider + Fire are **all on screen at
   once** — your finger slides back and forth and Fire is right there.
3. An **optional "fire on release"** mode (off by default): drag the slider and
   let go to fire, no button press.
4. Aiming responsiveness is **heavily device-dependent** ("no perfect default").
   The player needs a way to **quantify and hone** the feel. Per the user, this
   is *three* tunables — **snap step, swipe gain, release settle** — presented as
   a small **menu with an in-place live demo per setting** so you can feel what
   you're setting. This is a bigger menu than the shelf has built before, so it
   should be **scaffolded as a reusable, legible panel** (portal-wide), not
   bubble-only one-offs.

## Reasoning / desired design

### Reusable scaffold — `src/settings-sheet.ts`

A pure-DOM, framework-free `renderSettingsSheet(spec)` that lays out a titled
panel of setting **rows**. Each row = a control (toggle **or** range with a live
value readout) + label + one-line hint + an optional **live demo slot**. Changing
a control calls the row's `onChange` **and** `demo.update(value)` so the demo
reacts in place. Consistent, theme-aware, AA, ≥44px targets, keyboard-navigable.
Other games build a menu by passing a spec — that's the "legible in the whole
portal" ask. Classes: `.sheet`, `.sheet-row`, `.sheet-toggle`, `.sheet-range`,
`.sheet-value`, `.sheet-hint`, `.sheet-demo`.

### The aim bar (always visible, below the board)

`.bub-aimbar` becomes a **column**:
- Row: **Aim** label · range slider (flex) · live angle readout (`115°`).
- **Fire** button — **full width**, accent-filled, prominent.
- `⚙ Aim & controls` disclosure → the settings sheet.

Bigger, themed slider thumb (~30px, `--accent`) + a taller touch track.

### The four aim settings (persisted, in `src/settings.ts`)

- **Fire on release** (bool, **off**). On: releasing the slider fires (after the
  settle window); off: press Fire. The board tap-to-fire path is unchanged.
- **Snap step** (number °, default **1**, range 1–5). Aim snaps to multiples of
  the step anchored on 90° (straight up always hittable). Bigger = calmer on a
  jittery touchscreen.
- **Swipe gain** (number °/full-swipe, default **full fan** = absolute). Lower =
  the slider covers a narrower band around your current aim for fine control,
  recentering between grabs so you can still walk to the extremes. At the default
  it is exactly today's absolute fan slider.
- **Release settle** (number ms, default **150**, range 0–400). With fire-on-
  release: after you lift, wait this long; re-grabbing cancels. Tunes accidental
  fires. Only meaningful when fire-on-release is on.

Each gets a compact live demo in the sheet.

## Verified assumptions

- The aim slider is a native `input[type=range].bub-aim`; `renderAimBar()`
  (`src/games/bubble/bubble.ts`) builds it; CSS at `styles.css:898`. Verified.
- The `bubble-board` guide shot clips `.bub-game` (includes the aim bar) —
  `tools/guide-shots.mjs` — so the aim-bar reshape changes the shot and it MUST
  be regenerated (`assets/guide/bubble-board.jpg`), per CLAUDE.md. `git add` only
  the bubble shot; `git checkout --` the rest.
- `tests/bubble.spec.ts` asserts `.bub-aim` / `.bub-fire` visible, the slider
  drives the angle within the fan, keyboard aim/fire, reduced-motion, narrow-
  phone no-overflow, axe light/dark. The default (full gain, step 1) keeps the
  slider an absolute fan input so these keep passing; the fan-invariant test is
  updated to the new model where needed.
- No Rust/core/determinism changes — pure front-end + CSS. Shots resolve exactly
  as before (aim tuning only changes *how an angle is chosen*, never the physics).
- Settings persistence is bool-only today; add a pure `resolveNumber` beside
  `resolveBool` (unit-tested) + numeric accessors.

## Phases (TDD; commit at each green point)

- **P1 — settings (RED→GREEN):** `resolveNumber` pure resolver + numeric/bool
  accessors in `settings.ts`; unit test first.
- **P2 — aim math (RED→GREEN):** `snapAngle`, `aimBand`, band↔angle mapping in
  `bubble-aim.ts`; unit tests first (fan clamps, edges, round-trips, default-gain
  = absolute).
- **P3 — aim bar restyle + wiring (RED→GREEN):** column layout, full-width Fire,
  bigger themed thumb, live readout; wire snap/gain/fire-on-release/settle into
  the slider. e2e: full-width Fire, fire-on-release default-off then on, snap,
  fan invariant, keyboard unchanged, reduced-motion, narrow-phone, axe.
- **P4 — settings sheet + demos (RED→GREEN):** `settings-sheet.ts` scaffold +
  bubble "Aim & controls" sheet with a live demo per row; CSS. e2e: rows +
  demos render, toggling persists, demo reacts.
- **P5 — how-to + guide shot:** refresh the aim/fire how-to copy; regenerate
  `assets/guide/bubble-board.jpg` (bubble shot only).
- **P6 — gate + commit + push:** typecheck · lint · unit · build · bubble e2e ·
  axe green; commit per phase; push to `claude/slider-aiming-controls-ui-9c2hil`.
