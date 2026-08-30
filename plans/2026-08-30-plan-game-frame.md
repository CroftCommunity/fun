# Plan — the Game Frame: one structure for every game page, and a progress store

**Status:** Pass 1 (shape) — DRAFT 2026-08-30. Mocks landed on the branch
(`mocks/d-game-frame.html`, PR #45); owner decisions D1–D3 recorded; phases not started.

Branch `claude/game-panel`; worktree `CroftC/worktrees/game-panel/fun`.

## Problem Statement

The skin lift (2026-08-28) repainted the shelf and rebuilt the home page. It did not touch
a single game page, and the owner's read of the result (2026-08-30, verbatim): "when I look
at it on desktop I just don't see that much difference and I don't see like the interface
having like a pop to it". The previous mock hub already listed the two rows the lift left
unfixed — *Controls* ("13 identical pills in four rows above a 400px board") and *Desktop*
("Mobile, stretched").

Measured on `main@825a7fc`, 2026-08-30:

- **The header wraps on every game page.** At 390px the shelf header is **110px on a game
  page and 64px on home** — "How to play" and "↗" wrap to a second row before the game
  draws anything.
- **The board moves mid-game, for named reasons.** Above the board: the five versus games
  splice an `*-ai-say` paragraph in at index 1 when the AI has a line; Wyrdle's `.wy-toast`
  goes 0 → 1.5rem for 1.6s on every rejected guess; Blockdoku's `.bdk-banner` swaps between
  two sentences of different length on every select; Color Sort inserts a deadlock card;
  Trio Tumble's campaign nav row comes and goes with mode; Drop 4 appends a
  `.drop4-thinking` span that wraps the turn bar; every `▶ Settings` `<details>` opens in
  flow. Below the board `.furrow-status` and `.crib-status` have no `min-height` and
  collapse to zero. The owner's words: "the game board below it will like move 'cause it's
  getting bumped up and down and that's really confusing when you're trying to use your
  thumbs to play". Align is the one game that reserved height (`.al-callout { min-height }`).
- **No two games agree on their controls.** Solitaire: modes · Undo · Hint · Settings ·
  Moves. Othello: seats → Difficulty · You play · New game · Settings → a two-sentence
  banner. Trio Tumble: thirteen pills in four rows. Cribbage keeps its verbs inside the
  table. Loose Ends has a splash and an overlay HUD; nothing else has either.
- **Two sheet systems.** `src/settings-sheet.ts` (themed, tested, demo-driven) has one
  user — Bubble's aim sheet. Every other game hand-rolls a `<details>` of checkboxes with a
  copy-pasted helper. Twelve of sixteen games reuse solitaire's `.sol-controls` /
  `.sol-modes` / `.sol-status` classes by copy; four rolled their own.
- **No front door.** Every URL drops onto a live board with setup (opponent, difficulty,
  side, daily/free) as inline selects. Nothing says what the game is before the first move.
- **No progress.** `src/shelf.ts` records only which games were opened; there is no
  per-game in-progress state anywhere, so "Continue" cannot be honest.

## Approach

One shared component, `src/game-frame.ts`, that every game mounts into instead of the
bare play area. Five bands with **reserved heights**, one **control vocabulary**, a
**start screen** on every URL, and a **progress store** the start screen reads.

```
 PHONE (≤ 899px)                          DESKTOP (≥ 900px)
┌──────────────────────────────┐          ┌───────────────────────────────┬────────────┐
│ ① shelf bar        56px fixed│          │ ① shelf bar                   │            │
├──────────────────────────────┤          ├───────────────────────────────┤ ② name  ⋯  │
│ ② game bar   ‹ Othello  ⋯ 48 │          │                               │ ③ meters   │
├──────────────────────────────┤          │                               │            │
│ ③ meter row  (seats / score) │          │        ④ stage                │ ⑤ verbs    │
│                        56px  │          │    board fills the height     │            │
├──────────────────────────────┤          │                               │ setup      │
│ ④ stage — the board          │          │                               │ (read-only)│
│   owns the remaining height  │          │                               │            │
│   transient things overlay   │          │                               │ settings   │
├──────────────────────────────┤          │                               │ (inline)   │
│ ⑤ dock  ↶ Undo · ✦ Hint · ⟳ │          └───────────────────────────────┴────────────┘
│                        72px  │            the dock and the rail are ONE panel, reflowed
└──────────────────────────────┘
```

A game declares a spec once and never touches the chrome:

```ts
interface GameFrameSpec {
  title: string;                       // "Othello"
  mode?: string;                       // "Medium" · "Today's deal" · "Campaign · 3 of 6"
  meters: Meter[];                     // seats (versus) or stats (solo); fixed slots
  verbs: Verb[];                       // 3–5: Undo · Hint · New game… · Settings + at most one game verb
  setup: SetupRow[];                   // the New game card: shown on the start screen, read-only in the rail
  preferences: SettingRow[];           // the game's section of the settings sheet (common rows are the frame's)
  pitch: string;                       // the one line under the name on the poster
}
```

The six rules (the full argument is on the mock page):

1. **Reserved heights, or nothing at all.** Bands ①②③⑤ are fixed. Text swaps in slots
   that already have the room. Transients (toast, first-move hint, the AI's banter) are
   `position:absolute` over the stage. The board's top edge is the same pixel from the
   first move to the last.
2. **Thinking is a state, not a line.** The opponent's seat pulses; its sub-label reads
   "thinking…"; verbs disable.
3. **Three kinds of control, three homes.** Verbs → dock/rail. Setup → start screen and
   the New game sheet, read-only in the rail. Preferences → the settings sheet, common
   section first. A Difficulty select beside the board is setup wearing a verb's clothes.
4. **The instruction sentence is not a band.** Start screen + How to play + a one-time
   toast. It costs ~60px of every game's height today.
5. **Every URL opens on a start screen.** A poster on first land (the game's shipped
   `splash.jpg`, name, pitch, setup card, Play); a **continue card** when the store holds a
   game in progress (icon kept, summary line from the store, Continue / New game), drawn
   inside the already-painted frame so Continue is a fade, not a navigation. A `?r=` link
   shows the record card instead of either.
6. **One panel, two shapes.** Dock (phone) and rail (desktop) render the same spec; one
   breakpoint reflows it. A common preference mirrors it (D4). Full screen (⤢) is the
   Fullscreen API with the frame intact and the shelf bar gone (D5).

### The progress store — `src/progress.ts`

One `localStorage` key per game, `fun-progress-<id>`; the newest game wins, no history.

```
{ v: 1,
  status: "in-progress" | "finished",
  startedAt, updatedAt: ISO,
  setup:   { mode: "daily:2026-08-30" | "free", seed, ...gameSetup },
  record:  <the game's own serialised state — for Tier-1, the move list the outcome record already carries>,
  summary: { line: "Move 14 · you lead 9–4", meters: { … } } }   // shown WITHOUT loading the engine
```

Two optional members on `GameModule`: `snapshot(): Progress` (the frame decides *when* —
after every move; the game decides *what*) and `resume(p)`. A game without them gets the
start screen and never a continue card. The frame owns read/write, expiry (a daily entry
dies at local rollover), the summary on the card and in the rail, clearing on New game,
and `finished` when the result screen shows. The home page's "Continue" reads the same
store instead of the last-opened timestamp. Undo state is part of the record. `?r=` never
touches it. Storage denied → no card, never an error. The shape is validated on the way in.
Same envelope shape as `pond-docformat` so a synced/exported file is a format change later,
not a redesign — not built in this pass.

## Reasoning

- **Why a frame and not a restyle.** The complaints are structural — height changes,
  control placement, no front door. A skin restyles and restructures nothing (ADR-0001,
  forage's rule); the fix has to live above the skin. And twelve games already share one
  control row by copy, which is a frame that was never named.
- **Why reserved heights rather than "don't insert things".** A rule that says "don't" is
  re-broken by the next game. Fixed bands make insertion impossible in the chrome and
  visible in the stage; a browser test (Phase 0) makes it a red board.
- **Why setup leaves the board.** Changing Difficulty mid-game restarts the game in every
  versus module today; it was never a live control. Moving it to the New game card says
  what it does.
- **Why the store is small.** Determinism: every Tier-1 game is seed + moves, so resume is
  replay through the core the game already has — no second serialisation format.
- **Why phone and desktop together (D3).** They are one component with one breakpoint. Two
  passes would build the panel twice and drift.
- **Why five verbs.** Five labelled 44px targets is what 390px holds. The inventory found
  no game needing six; Cribbage's *Throw to crib* / *Go* and Bubble's *Fire* are the move
  itself and stay on the board.

## Verified assumptions

- Every game ships `src/games/<id>/assets/icon.jpg` (512²) and `splash.jpg` (portrait,
  1200 tall); Trio Tumble and Cribbage also ship `splash-landscape.jpg` (`ls`, 2026-08-30;
  `tests/art.test.ts` asserts the registry↔filesystem claim). An earlier draft of the mock
  said five games had no art — read from `mocks/README.md`, dated the day before the art
  landed. Corrected on the page.
- Header 110px vs 64px at 390px: Playwright `boundingClientRect` on `.chrome-header`,
  every game page, `main@825a7fc`.
- The board-jump causes: read from each module (`src/games/*`), file:line on the mock page.
- `renderSettingsSheet` has exactly one caller (`bubble-aim-settings.ts`): grep.
- `shelf.ts` has no per-game progress: its own module comment says so and the only
  `localStorage` keys are `fun-*` settings.

## Owner decisions

- **D1 (2026-08-30)** — build the progress store, reusable across games.
- **D2 (2026-08-30)** — poster on first land; a continue card, icon kept, on a return with
  a game in progress.
- **D3 (2026-08-30)** — phone and desktop are first-class together; mocks side by side;
  build them as one component.
- **D4 (2026-08-30)** — a common preference, **Controls on the left** ("reverse control
  sides"): the rail swaps to the left of the board on desktop; the dock's verbs run in
  reverse on a phone. One flag on the frame; games never know. Mock row 10.
- **D5 (2026-08-30)** — **full screen means full screen**: ⤢ requests the Fullscreen API
  (the tab on desktop, the display on a phone), the frame stays intact, only the shelf bar
  goes. Approach C (board-only, verbs behind ⋯) is rejected. iOS Safari grants no page
  fullscreen; there ⤢ explains and points at the PWA install rather than silently doing less.

## Phases

Each phase lands green (`npm run gate`), with its changelog entry under `[Unreleased]`,
guide shots regenerated for any game whose UI changed, **its documentation updated in the
same landing** (owner, 2026-08-30: "ensure we do a README and documentation update pass as
part of this work"), and a Review Log entry here. A phase whose docs still describe the old
control row is not done.

- **Phase 0 — lock the failure.** Two browser tests that are RED on `main`: (a) the shelf
  header is one row (≤ 64px) on every game page at 390px; (b) for Othello, Wyrdle,
  Blockdoku and Drop 4, the board's `boundingBox().y` at move 1 is unchanged after the
  engine moves / a word is rejected / a piece is selected / settings open. These stay as
  the frame's regression gate.
- **Phase 1 — the frame.** `src/game-frame.ts` + `GameFrameSpec`; bands ②③⑤; dock ↔ rail
  breakpoint; the settings sheet as a bottom sheet (phone) / inline (desktop) with a common
  section; `chrome.ts` hands How to play / ↗ to the frame. Unit-tested render; axe both
  palettes. No game migrated yet — the placeholder module proves it.
- **Phase 2 — the store and the start screen.** `src/progress.ts` (pure resolvers, validated
  shape, expiry); `snapshot`/`resume` on the contract; poster and continue card; `?r=`
  precedence; home page Continue reads the store.
- **Phase 3 — migrate by archetype.** Othello (versus: seats, thinking, setup), Solitaire
  (solo: modes, undo, meters), Trio Tumble (the worst case: objectives and campaign into
  setup). Each replaces its `.sol-controls` / turnbar / banner / `<details>` block with a
  spec; status text routes into seat sub-labels or toasts. The board and rules do not change.
- **Phase 4 — the rest.** Drop 4, Checkers, Dots, Furrow, Cribbage (phase verbs stay on the
  table), Bubble (aim bar stays below the board; its sheet becomes the game section), 2048,
  Align, Wyrdle, Blockdoku, Color Sort, Orchard Drop, Loose Ends (already splash-driven —
  adopt the frame's start screen, keep its overlay HUD as a stage overlay).
- **Phase 5 — full screen = the Fullscreen API (D5), the mirror preference (D4)**, and delete the dead per-game control CSS.
- **Phase 6 — the documentation pass, and the guide for the next game.** Runs alongside
  Phases 1–5 (each lands its own docs) and closes with a `docs-guardian` sweep:
  - **`docs/BUILDING-GAMES.md` gains a new normative section, "§4c The game frame —
    declaring your controls, and how the game will be shown"** (owner, 2026-08-30:
    "document for future games how to understand the controls panel and how the game will
    be represented"). It carries: the five bands and their fixed heights, with the diagram;
    the `GameFrameSpec` with every field explained and one worked example per archetype
    (versus, solo-daily, campaign); the three homes and the test for sorting a control
    into one ("does it act on the game in progress, decide the game before it starts, or
    outlive the game?"); the five-verb cap and the reserved verbs (Undo · Hint · New game… ·
    Settings) with their fixed order; what the start screen shows for this game and where
    the pitch, icon and splash come from; `snapshot`/`resume` and what a summary line must
    contain; what a game may put in the stage (its board, its phase verbs, absolutely
    positioned transients) and what it must not (anything in flow above the board); how
    "thinking", "goes again" and banter are expressed as seat state and toasts. Both
    new-game checklists gain the frame items.
  - `docs/RESPONSIVE-DESIGN.md`: Principle 1 ("one centred column") is superseded by the
    frame; add the reserved-heights rule and a lessons-log entry with the measured
    110px/64px header and the named board-jump causes.
  - `docs/DESIGN.md`: the frame's roles (bands, seats, verbs, toasts) and which tokens
    they take; `docs/adr/` gets an ADR recording that the frame sits above the skin and
    why (a skin restyles, the frame structures).
  - `README.md`: "The shelf and the drawer" describes the game page as the frame; the
    per-game paragraphs drop their control-row descriptions.
  - `docs/STATE-OF-PLAY.md`: a dated addendum. `mocks/README.md`: Direction D's row marks
    what shipped. `CLAUDE.md`: one line pointing at §4c under "The shelf model".
  - `TODO/README.md`: the "every game page's `<title>` is a slug" item closes with the
    game bar (the frame knows the title).

## Open questions

- Desktop poster art: the portrait splash as a left panel works (mock row 1); landscape
  reads better where one exists. Commission landscape for the rest, or accept portrait-left
  as the desktop rule?
- Does the rail collapse to the dock at a *height* breakpoint too (a short landscape phone)?
- Where does the AI's banter go on desktop — a bubble on its seat in the rail, or a stage
  toast like the phone? (Same rule 1 either way.)

## Review Log

- 2026-08-30 — D4 (controls on the left) and D5 (real full screen; C rejected) recorded from the owner's second reply; mock rows 9–10 updated.
- 2026-08-30 — Pass 1 drafted from the survey and the mocks; D1–D3 recorded from the owner's
  reply; assumptions verified as listed. Not yet reviewed.
