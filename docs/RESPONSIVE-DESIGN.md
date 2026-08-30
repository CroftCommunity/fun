# fun.croft.ing — mobile & desktop layout playbook

How a game and the shared chrome should lay out across screen sizes, and the
**lessons log** we append to as we learn. `DESIGN.md` owns colour and identity;
this doc owns **layout, responsiveness, and touch**. `BUILDING-GAMES.md` §4b
("Centre the play surface") is the short normative rule; this is the fuller
reference plus the running record of what bit us, so the next game gets it right
from the start.

The goal: reach for this **before** building a new board, not after a screenshot
shows it broken.

## Principles

### 1. One centred play column is the default

A game mounts into the shared play area as a single centred column. Controls,
board, and any on-screen keys stack on one vertical axis, centred in the play
area — never hugging the left edge. Centre by default; deviate only with a
reason.

```
        play area
┌───────────────────────────┐
│      [ controls row ]      │   ← centred as a group
│      [   banner    ]       │
│      ┌───────────┐         │
│      │   board   │         │   ← board centred…
│      └───────────┘         │
│         ┌───┐              │
│      ┌──┤ ↑ ├──┐           │   … and the d-pad on the SAME
│      │ ←│ ↓ │→ │           │      centreline directly beneath it
│      └──┴───┴──┘           │
└───────────────────────────┘
```

Implement it as a wrapper the game owns (e.g. `.t48-game`):

```css
display: flex;
flex-direction: column;
align-items: center;
gap: 0.6rem;
max-width: 32rem;      /* keeps a comfy measure on desktop  */
margin: 0 auto;        /* centres the column in the play area */
padding-inline: 0.75rem;
```

### 1b. Reserved heights — nothing above the board changes height while you play

Since the game frame (2026-08-30, `docs/BUILDING-GAMES.md` §4c) the column in Principle 1
lives **inside the frame's stage**, and everything above it is a fixed-height band: game
bar 48px, meter row 56px, dock 72px. Text swaps inside slots that already have the room
(a seat's sub-label is a 12px line whether or not it has text); the meter count is fixed
for the life of the frame; anything transient — a toast, the AI's banter — is
`position: absolute` over the stage. The board's top edge is the same pixel from the first
move to the last, and each game's browser spec asserts it. A status line that must sit
below the board keeps a `min-height`, or it is a jump waiting to happen.

### 2. On-screen control keys must sit on the board's centreline

A directional d-pad or an on-screen keyboard only reads as belonging to the
board when it is centred **under** the board. A left board over a centred key
cluster looks broken (this was the original 2048 bug). Assert it in an E2E: the
board and the key cluster share a centre-x within a few pixels.

### 3. Watch the `inline-flex` centring trap

`margin-inline: auto` does **not** centre an `inline-flex` / `inline-block`
element — it is inline-level, so the auto margins collapse to zero. This is
exactly why the 2048 board (`display: inline-flex; margin: … auto`) sat left
while the block-level d-pad grid centred. Centre inline-level content via:

- the column wrapper (`align-items: center`), **or**
- `width: fit-content; margin-inline: auto` on a block-level element.

### 4. Touch targets and gestures

- On-screen keys are **≥ 44 px** hit area (the 2048 d-pad is 3rem ≈ 48px, and
  grows to 3.4rem on phones).
- Put `touch-action: manipulation` on tappable controls to drop the ~300ms tap
  delay / double-tap-zoom on mobile.
- The board surface that reads swipes uses `touch-action: none` so a swipe is a
  move, not a scroll.

### 5. Breakpoints

Phones are the common case; treat them as first-class, not a follow-up. Standard
widths in use:

| Width      | Meaning              | What changes |
|------------|----------------------|--------------|
| ≤ 430 px   | phone                | scale cells down, grow d-pad to a thumb target |
| ≤ 360 px   | small phone          | scale cells down again so a 4-wide board still fits |

Every board ships a **no-horizontal-overflow check at 360 px** (see
`tests/2048.spec.ts` "fits a narrow phone"). Do the fit math up front:
`cells × cell + gaps + padding + column padding ≤ viewport`.

### 6. The drawer / overlay pattern

The games drawer is the reference overlay. Rules that generalise to any slide-in
panel:

- Give it **two** ways to close beyond ESC: an explicit **close button** at the
  top of the panel, and **click-off**.
- Click-off is a full-viewport **scrim** element sitting *under* the panel
  (panel `z-index: 10`, scrim `z-index: 9`). A click on the scrim closes; a
  click on the panel does its normal thing.
- Because the scrim is under the panel, the tap-off area is only the strip
  **beside** the panel. On a phone the panel eats most of the width, so **dim
  the scrim** (`background: rgb(0 0 0 / 32%)`) — otherwise the off-area is
  invisible and users cannot tell they can tap to dismiss.

```
 drawer open (phone)          z-index
┌──────────────┬──────┐
│  panel        │dim   │   panel  = 10  (on top)
│  (games)      │scrim │   scrim  =  9  (tap here to close)
│  z-index 10   │ = 9  │   page   =  0
└──────────────┴──────┘
                 ▲ tap-off strip — must be visible (dimmed)
```

## Verification — prove layout in a real browser

jsdom has no layout engine, so centring and overflow are **not** testable in
vitest. Assert them with Playwright `boundingBox()` across **both** projects
(`chromium` and `mobile-webkit`):

- **Centreline:** `|boardCenterX − padCenterX| < 8` and the board's centre is the
  play area's centre (`< 24`).
- **No overflow:** `documentElement.scrollWidth ≤ clientWidth` at a 360 px
  viewport.
- Run axe in **both themes** after any layout change — a scrim, a new wrapper, or
  a moved control can introduce a contrast or landmark regression.

## Lessons log

### 2026-08-30 — the header wrapped, and the board jumped, on every phone

- **Symptom:** at 390px the shelf header was 110px on every game page (64px on home);
  Othello's board moved 24.8px on WebKit every time the engine took its turn; Wyrdle's
  rejected-word toast, Blockdoku's selection banner, Color Sort's deadlock card, Trio
  Tumble's campaign row and Drop 4's "thinking" span all pushed the board around mid-game.
- **Cause:** "How to play" + "↗" wrapped the header to a second row; every game stacked
  its own controls, HUD, banner and `<details>` in flow above the board, and each of them
  could change height. Nothing reserved space (Align's `.al-callout { min-height }` was the
  one exception).
- **Rule:** Principle 1b. The frame owns the bands and their heights; a game declares
  meters and verbs and renders only into the stage.
- **Measured on the first migration (Othello, 2026-08-30):** the sampler
  (`tests/helpers/board-top.ts`) read 24.8px per engine turn on WebKit before, 0 after —
  and caught two more on the way: the rail's stage was vertically centring (a status line
  growing *below* the board moved it 1.2px), and the end-of-game fanfare rendered above
  the final board (50–81px). Both fixed at the cause; both are now cases in
  `tests/othello.spec.ts`.

Append dated entries as we learn. Keep each to the symptom, the cause, and the
rule it produced.

### 2026-07-31 — 2048 board left-aligned under a centred d-pad

- **Symptom:** the board hugged the left edge while the arrow pad, HUD, and
  banner were centred, so the directional keys looked unrelated to the board.
- **Cause:** `.t48-board` was `display: inline-flex` with `margin: … auto`;
  auto margins do not centre inline-level elements (Principle 3).
- **Rule:** wrap the whole game in a centred flex column (Principle 1); assert
  the board/d-pad centreline in an E2E (Principle 2).

### 2026-07-31 — Trio Tumble board left-aligned on desktop (the inline-flex trap, again)

- **Symptom:** the Trio Tumble board, HUD, and controls hugged the left edge on
  desktop, leaving the whole right half of the play area empty (board centre-x
  ~217px vs a 512px play-area centre — a ~295px offset). Mobile was incidentally
  fine because the board nearly fills a narrow viewport.
- **Cause:** Trio Tumble mounted its three children (controls, board, status) **directly**
  into `.play-area` with no centred column wrapper, and `.m3-board` is
  `display: inline-flex` — an inline-level element, so it sits left and auto margins
  do nothing (Principle 3). Every other game already had a wrapper (`.t48-game`);
  Trio Tumble was the one that never got one.
- **Rule:** wrap the whole game in a centred flex column (Principle 1) — added
  `.m3-game` (mirrors `.t48-game`: `flex-direction: column; align-items: center;
  max-width: 32rem; margin: 0 auto`) and render into it, with
  `.m3-game .sol-controls { justify-content: center }`. Locked with an E2E asserting
  `|boardCenterX − playAreaCenterX| < 24` in both projects. Reinforces the standing
  rule: a new board **starts** inside its centred column, never bare in `.play-area`.

### 2026-07-31 — drawer would not recollapse

- **Symptom:** the games drawer had no close button and did not close when
  clicking outside it.
- **Cause:** there was only the header toggle and ESC; no in-panel close and no
  click-off surface.
- **Rule:** the overlay pattern in Principle 6 — close button + scrim. Added a
  dim to the scrim after the phone case showed the tap-off strip was invisible
  and Playwright's centre-click on the scrim landed on the panel.
