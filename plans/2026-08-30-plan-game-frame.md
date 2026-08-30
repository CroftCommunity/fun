# Plan — the Game Frame: one structure for every game page, and a progress store

**Status:** Pass 1 + Pass 2 + **Pass 3 COMPLETE** (2026-08-30, fresh context). Six open
questions CONFIRMED by the owner 2026-08-30 ("accept all as recommended"); Pass 3 added
**Q7 and Q8**; both ADOPTED as recommended under the owner's blanket "go until all phases
are done, PR and merge when ready" (2026-08-30) — **Q7 (what a URL with query
parameters does once every bare URL opens on a start screen) gates Phase 5** and is the one
thing between this plan and execution: Phases 0–4 may start now. D5 was resolved during
planning (read-only, see Verified Assumptions) and is struck from Phase 0. Phases 1, 2, 3
and 5 carry sub-phases (1a/1b, 2a/2b, 3a/3b, 5a/5b) — each with its own Done-when and
wiring test — because each touched four or more files. Phases 0–4 COMPLETE (2026-08-30). Mocks
landed on `main` (`mocks/d-game-frame.html`, PR #45, `6c4dd9c`); owner decisions D1–D5
recorded.

Branch `claude/game-frame` (from `main@6c4dd9c`); worktree `CroftC/worktrees/game-panel/fun`.
Plan filename carries no ordinal per `CroftC/.claude/TRACKING.md` § "Plan files" (retired
2026-08-29), which overrides the phase-plan skill's `-N-` default.

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

Constraints: no backwards-compat shims (pre-1.0 repo rule); the board and every game's
rules are untouched; `npm run gate` stays green at every landing; each landing carries its
changelog entry and its doc updates.

## Approach

One shared component, `src/game-frame.ts`, that the chrome mounts for **every** game page
and that each game feeds a spec. Five bands with **reserved heights**, one **control
vocabulary**, a **start screen** on every URL, and a **progress store** the start screen
reads. Games migrate one at a time; an unmigrated game renders inside the frame's stage
exactly as it does today (its own controls above its board), so the header fix and the
start screen land for all eighteen pages at once and the per-game work is incremental.

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
  pitch: string;                       // the one line under the name on the poster
  meters: Meter[];                     // seats (versus) or stats (solo); fixed slots, text swaps in place
  verbs: Verb[];                       // ≤ 5: Undo · Hint · New game… · Settings + at most one game verb
  setup: SettingRow[];                 // the New game card; shown on the poster, read-only in the rail
  preferences: SettingRow[];           // the game's section of the settings sheet (common rows are the frame's)
}
```

The six rules (the full argument is on the mock page, `mocks/d-game-frame.html`):

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
   breakpoint reflows it. A common preference mirrors it — rail left, dock reversed (D4).
   Full screen (⤢) is the Fullscreen API with the frame intact and the shelf bar gone (D5).

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
- **Why the chrome mounts the frame for every game before any game migrates.** The
  alternative — each game opting in — leaves the 110px header on the seventeen unmigrated
  pages for weeks. Mounting the frame from `chrome.ts` (`boot()` → `mounted.mount(playArea,
  …)` becomes `mounted.mount(frame.stage, …)`) fixes the header everywhere in Phase 2 and
  gives the poster to every game in Phase 5, at the cost of one degraded state to design:
  a frame with no spec renders bands ② (title + ⋯ holding How to play / ↗) and ④ only.
- **Why reserved heights rather than "don't insert things".** A rule that says "don't" is
  re-broken by the next game. Fixed bands make insertion impossible in the chrome and
  visible in the stage; a browser test (Phase 6 onward, per game) makes it a red board.
- **Why setup leaves the board.** Changing Difficulty mid-game restarts the game in every
  versus module today (`othello.ts` "You play" select "restarts"); it was never a live
  control. Moving it to the New game card says what it does.
- **Why the store is small.** Determinism: every Tier-1 game is seed + moves, so resume is
  replay through the core the game already has — no second serialisation format.
- **Why phone and desktop together (D3).** They are one component with one breakpoint. Two
  passes would build the panel twice and drift.
- **Why five verbs.** Five labelled 44px targets is what 390px holds. The inventory found
  no game needing six; Cribbage's *Throw to crib* / *Go* and Bubble's *Fire* are the move
  itself and stay on the board.
- **Why one phase per game.** The phase-plan skill's hard rule: a phase touching four or
  more files is split. A migration touches the module, its spec, its how-to shots and the
  changelog — the ceiling. Sixteen phases is the honest count, not a long tail.
- **Rejected: approach C (board-only, verbs behind ⋯) as the default.** Undo and Hint two
  taps away is the wrong trade for normal play. Rejected for full screen too (D5): full
  screen is the Fullscreen API with the frame intact.
- **Rejected: a `data-ui-key` attribute for re-render survival.** `ui-state.ts` keys open
  panels by class on `<details>`; the frame's sheets are not `<details>` and are owned by
  the frame, not re-rendered by the game, so nothing new is needed there — the frame is
  outside `container.replaceChildren(...)`.

## Verified Assumptions

- Every game ships `src/games/<id>/assets/icon.jpg` (512²) and `splash.jpg` (portrait
  669×1200); Trio Tumble and Cribbage also ship `splash-landscape.jpg` — `ls`, `sips`
  2026-08-30; `tests/art.test.ts` asserts registry ↔ filesystem. (An earlier mock draft said
  five games had no art — read from `mocks/README.md`, dated the day before the art landed.)
- Header 110px (game page) vs 64px (home) at 390px: Playwright `getBoundingClientRect` on
  `.chrome-header`, every game page, `main@825a7fc`.
- The board-jump causes: read from each module under `src/games/*` (file:line on the mock
  page); `.furrow-status` / `.crib-status` lack `min-height` (`styles.css` L3805, L4430
  region); `.al-callout { min-height: 1.4rem }` (`styles.css` L2694).
- `renderSettingsSheet` has exactly one caller, `src/games/bubble/bubble-aim-settings.ts`
  (grep). It renders `toggle | range | choice` rows (`src/settings-sheet.ts` L1–180).
- `shelf.ts` has no per-game progress: its own module comment says so; the only
  `localStorage` keys are `fun-*` settings (`src/settings.ts` L8–24) and `fun-shelf-state`
  (`src/chrome.ts` L48).
- The chrome mounts a game with `mounted.mount(playArea, { mode })` (`src/chrome.ts`
  L289–290); `playArea` is `<main class="play-area" id="play-area">` (L259); the header
  appends `.how-to-link` and `.newtab` only on game pages (L244–253); full screen today is
  `root.classList.toggle("fullscreen")` (L337–341) with `body.fullscreen .chrome-header,
  .drawer { display:none }` (`styles.css` L204–209). `tests/chrome.test.ts` "full-screen
  preserves the same mounted instance" pins the no-remount behaviour.
- Every game renders via `container.replaceChildren(...)` (e.g. `othello.ts` L655); the
  versus games wrap it in `captureUiState`/`restoreUiState` (`ui-state.ts`).
- Each game's page is a static HTML with `<body data-game="<id>">` and `<title>Croft · fun
  — <id></title>` (`build.mjs` L42, L253); `TODO/README.md` L149 tracks the slug title.
- Browser specs drive games through `window.__<game>` handles (`__othello`, `__wyrdle`,
  `__blockdoku`, `__drop4`) and `?seed=7`; Othello/checkers/cribbage honour `?fast=1`
  (`tests/othello.spec.ts` L77). The `mobile-webkit` project is iPhone 13 (390×844).
- `home.ts` renders `.home-resume` from `model.resume` (L57, L105), tested by
  `tests/home.spec.ts` L56–62.
- Height budget on iPhone 13: 844 − (56 + 48 + 56 + 72) = 612px of stage; the largest
  phone board today is the felt at 366×420 and the 8×8 boards at 366×366 — fits with room.
  Not verified: a short landscape phone (see Open Questions).
- The music library: 17 tracks in `assets/audio/`, registered in `src/music.ts` `TRACKS`
  (L46–) with per-game defaults (L79–). Three new tracks sit in `~/Downloads/new/`
  (Porcelain Afternoon, The Last Cab Home, Tuesday Night Rainfall) and are **not** in
  `assets/new/` or the library yet — a side landing, not this plan (see below).

Added by Pass 3 (2026-08-30, read-only spot-checks of this worktree at `197275f` =
`origin/main`):

- **D5 is answered without a probe.** `build.mjs` imports nothing from `src/` — its 18
  page ids are a hard-coded literal, `GAME_PAGES` (`build.mjs` L17), pinned to `REGISTRY`
  by **no test** (grep `GAME_PAGES` in `tests/`: 0 hits). It already imports one plain-Node
  helper, `tools/skin-init.mjs` (L7), which reads `src/skins.ts` **as text** and throws when
  it parses nothing (`skin-init.mjs` L23); `tools/intake.mjs` L56 reads `src/registry.ts`
  the same way. `TODO/README.md` L149–158 prescribes exactly this mechanism for the title
  and warns that `gameAliases()` did it with an index-zip bug — "parse each entry as a
  unit". So the mechanism is: a `tools/registry-titles.mjs` that parses `src/registry.ts`
  as text into `{ id → displayName }`, imported by `build.mjs` for both `GAME_PAGES` and
  the `<title>`, unit-tested against the real `REGISTRY` (Phase 2b). No generated
  `registry.json` is needed.
- `tests/othello-tutor.test.ts` and `tests/othello-harness.test.ts` read **no DOM
  classes** — every `othello-` hit is an import path (`othello-harness`, `othello-oracle`,
  `othello-outcome`, `othello-wasm`); `querySelector`/`.othello-`: 0 hits. Phase 6's
  Pass-2 risk is retired. The DOM-class readers that DO break on a migration are
  `tests/<game>.spec.ts` (already in each phase) and **`tools/guide-shots.mjs`**, whose
  recipes click `.othello-tutor-explain`, `.sol-settings summary`, `.sol-hint`, `.sol-stuck`,
  `.crib-throw`, `.crib-go`, `.*-tutor-explain` (50 `goto`s, 22 distinct click selectors)
  — it is in every migration's write-set from Pass 3 on.
- `npm run guide:shots -- <name>` regenerates only shots whose name contains `<name>`
  (`tools/guide-shots.mjs` L963–970) — "Othello's shots only" is a supported invocation,
  not a `git add` discipline.
- `src/settings.ts` already exports the pure `resolveBool(stored, fallback)` (L27–31),
  tested in `tests/settings.test.ts` L109; Phase 3b's preference reuses it and tests only
  what is new (the key, the default, the accessor pair).
- **The start screen changes what every test lands on.** 299 `page.goto(` calls across the
  browser suite, 50 in `tools/guide-shots.mjs`, and `tests/a11y-matrix.spec.ts` L94 visits
  the **bare** `/${id}/` of every game × every skin — all of them expect a board. Rule 5 as
  written puts a poster there. Most specs pass `?seed=7` (some `?fast=1`); the a11y matrix,
  `home.spec.ts` L56–62 and a handful of others use bare URLs. This is **Q7**.
- Observability convention: six games log `console.debug("[<game>] mount seed=… mode=…")`
  at mount (`2048.ts` L410, `align.ts` L748, `color-sort.ts` L700/721, `drop4.ts` L856,
  `wyrdle.ts` L464); nothing in `src/` logs at `warn`/`error`. The frame and the store
  follow the same shape at `debug` (Phases 1a, 4, 5a, 22).
- `CHANGELOG.md` declares `Contexts: shelf · cribbage · furrow · dots · drop4 · blockdoku ·
  orchard · sinker · solitaire` (L8); workspace check 40 FLAGs an entry whose context is
  not declared. Each migration whose game is not yet listed (othello, trio-tumble, wyrdle,
  checkers, bubble, 2048, align, color-sort, looseends) adds its context on that line in
  the same landing.
- Browser wiring tests carry `{ tag: "@smoke" }` (19 spec files; `home.spec.ts` L24,
  `othello.spec.ts` L32) so `npm run smoke` runs them — the frame's wiring tests do too.
- `tests/chrome.test.ts` is jsdom (`vitest.config.ts`: `environment: "jsdom"`, with
  `tests/setup/webstorage.ts` repairing `localStorage`); jsdom has no
  `requestFullscreen`, so Phase 22's unit test installs one on
  `document.documentElement` and asserts the three cases named there.
- `docs/adr/0001-chrome-and-game-tokens.md` is the only ADR; `0002` is free.
- `styles.css` is 4741 lines; `.wrapped-banner` / `.wrapped-game-frame` (L162–200) are
  Tier-2 residue with no caller since 2026-08-29 — Phase 22's sweep, as planned.

## Side task (not a phase of this plan)

**Intake the three new tracks** from `~/Downloads/new/` via `assets/new/` + `npm run
intake -- --go`, register them in `src/music.ts` `TRACKS`, changelog `shelf:` entry. Owner,
2026-08-30: "let's not forget our new music tracks in new". Independent of the frame; lands
on its own branch first so the frame's phases never carry unrelated binary changes.

## Documentation Impact

Scheduled in the phase that makes the reference stale, not at the end.

- `docs/BUILDING-GAMES.md` — new **§4c "The game frame — declaring your controls, and how
  the game will be shown"**: bands + diagram, `GameFrameSpec` field by field, the
  sort-a-control test, the five-verb cap and reserved verbs, the start screen and where
  pitch/icon/splash come from, `snapshot`/`resume` and the summary line, what may go in the
  stage and what must not, how thinking / goes-again / banter are expressed. Written in
  **Phase 1** (bands, spec), extended in **Phase 3** (dock/rail, sheets), **Phase 4–5**
  (store, start screen), **Phase 6** (the versus worked example), **Phase 7** (solo),
  **Phase 8** (campaign). Both new-game checklists gain the frame items in **Phase 6**.
  §4 "Centre the play surface" is rewritten in **Phase 1** to say the frame centres the
  stage. §6 "Standard settings" gains the common section + "Controls on the left" in
  **Phase 3**. §10's turn-bar guidance points at seats in **Phase 6**.
- `docs/RESPONSIVE-DESIGN.md` — Principle 1 superseded by the frame; the reserved-heights
  rule; a lessons-log entry with the measured header and the named jump causes. **Phase 1**
  (rule), **Phase 6** (log entry with the first green stability test).
- `docs/DESIGN.md` — the frame's roles (bands, seats, verbs, toasts) and their tokens.
  **Phase 1**; the sheet tokens **Phase 3**.
- `docs/adr/0002-the-game-frame-sits-above-the-skin.md` — new ADR, **Phase 1**.
- `README.md` — "The shelf and the drawer" describes the game page as the frame (**Phase
  2**); per-game paragraphs drop control-row descriptions in each game's phase.
- `docs/STATE-OF-PLAY.md` — dated addendum, **Phase 22** (the closing phase).
- `mocks/README.md` — Direction D's row marks what shipped, **Phase 22**.
- `CLAUDE.md` — one line under "The shelf model" pointing at §4c, **Phase 1**.
- `TODO/README.md` — the slug-`<title>` item closes in **Phase 2b** (D5's answer: `build.mjs`
  reads the registry as text through `tools/registry-titles.mjs`, the mechanism the item
  itself prescribes).
- `CHANGELOG.md` — one `shelf:` entry per shelf phase, one `<game>:` entry per migration;
  a game not yet on the `Contexts:` line (L8) is added there in its own migration (check 40).
- `tools/guide-shots.mjs` — not a doc, but the shots are the how-to guide's pictures and
  its recipes click controls this plan removes; updated in **each game's phase** together
  with the regenerated shots (see Phase 6 and the 7–21 recipe).
- Grepped for references to files this plan **removes**: none are removed; per-game CSS
  blocks in `styles.css` are deleted per game phase and have no doc references (grep
  `sol-controls` in `docs/`: 0 hits).

## Concurrency Map

**All phases sequential.** Every phase writes `styles.css` (one stylesheet, by repo
convention) and every landing writes `CHANGELOG.md`; the hard rule forbids parallel sets
sharing a write-set entry. The sixteen game migrations are *logically* independent and
would parallelise if each game's CSS lived in `src/games/<id>/<id>.css` — surfaced as
ADVISORY open question Q4 rather than restructured here. Each phase runs in this worktree on
`claude/game-frame`; no phase invokes `git checkout` / `stash` / `rebase` in the shared
`fun/` checkout; the e2e web server binds :4180 only for the duration of `npm run e2e`.

Pass 3 re-checked the map after splitting Phases 1, 2, 3 and 5 into sub-phases: still
sequential. Every sub-phase pair shares `styles.css` or `CHANGELOG.md` except **5a ‖ 5b**
(5a: `game-frame.ts`, `chrome.ts`, `styles.css`; 5b: `shelf.ts`, `home.ts`) — 5b's only
overlap is `CHANGELOG.md`, and 5b's wiring test needs 5a's store-writing Play button to
exist, so it stays sequential by dependency, not by write-set. Flagged, not restructured.
Two more shared-state facts the map did not name: `npm run e2e` and `npm run smoke` both
bind :4180 with `reuseExistingServer: false`, so two phases' verifications cannot run at
once even from different worktrees; and `npm run guide:shots` writes `assets/guide/*.jpg`
for **every** game unless filtered — each migration filters to its own game.

## Phases

### Phase 0: Discovery

**Goal:** Resolve the five unknowns that later phases lean on, before sizing them.

- [x] **D1: Does the Fullscreen API work under Playwright, and what does `mobile-webkit`
  do with it?**
  - **Probe:** a throwaway spec calling `document.documentElement.requestFullscreen()` from
    a click handler on `/placeholder/`, in both projects; record `document.fullscreenElement`
    and any thrown error.
  - **Success criteria:** chromium enters fullscreen (or the test can `page.evaluate` a
    fake, recorded either way); webkit's behaviour recorded — it is expected to reject, and
    Phase 22 designs the fallback from the recorded error, not a guess.
  - **Disposition:** `throwaway`.
- [x] **D2: Does a 900px breakpoint hold the rail and a 520px board at 1000×680 with real
  fonts?** — the mock is CSS, the app has `styles.css`'s type scale.
  - **Probe:** mount the placeholder in a static HTML copy of the frame's bands with the
    app's `tokens.css` + `styles.css`, screenshot at 1000×680 and 900×600.
  - **Success criteria:** no rail overflow, board ≥ 480px at 1000×680; a number for the
    minimum width at which the rail must fold back into the dock.
  - **Disposition:** `keep-as-fixture` — the screenshots go into the plan's Review Log.
- [x] **D3: What does the frame's stage height budget do to the tallest phone boards?**
  - **Probe:** compute per game the board's rendered height at 390 wide via `boundingBox`
    on the existing pages; compare with 612px.
  - **Success criteria:** every board ≤ 612px, or a list of games that need the meter row
    to collapse (Bubble's aim bar and Wyrdle's keyboard are the candidates).
  - **Disposition:** `keep-as-fixture` (a table in the Review Log).
- [x] **D4: Can Othello's "thinking" beat be caught by a rAF sampler in a test, so the
  stability spec is not flaky?**
  - **Probe:** on `main`, inject a `requestAnimationFrame` sampler recording
    `min/max` of `.othello-board`'s `top` from before the human's click until
    `waitHumanOrOver`; run 10× in both projects.
  - **Success criteria:** the sampler sees ≥ 1 frame during the engine's move at Medium
    (no `?fast=1`) in 10/10 runs — then the spec is sound; otherwise the spec asserts on
    the DOM mutation (`.drop4-thinking`-style) instead of geometry.
  - **Disposition:** `promote` → the sampler becomes `tests/helpers/board-top.ts` in
    Phase 6, under TDD there.
- [x] **D5: Can `build.mjs` (plain Node, no TS) read each game's `displayName` for the
  page `<title>`?** — **RESOLVED during Pass 3 planning (2026-08-30), read-only.**
  `build.mjs` does not enumerate the registry at all: `GAME_PAGES` is a literal (L17), and
  the file imports one text-parsing helper already (`tools/skin-init.mjs`). Mechanism:
  `tools/registry-titles.mjs` parses `src/registry.ts` as text, entry by entry, into
  `{ id → displayName }`; `build.mjs` derives both `GAME_PAGES` and each `<title>` from it.
  Evidence and the index-zip warning in Verified Assumptions; executed in **Phase 2b**.
  - ~~**Probe:** check how `build.mjs` already enumerates the registry for its 19 pages
    (L250–260) and whether a JSON export of titles exists or is cheap.~~
  - **Disposition:** `throwaway` (nothing was written).

Pass 3 discipline notes for D1–D4, so each probe answers its question and nothing else:
- **D1** records three facts, not one: whether `requestFullscreen()` resolves, the
  **exact** error name/message when it rejects (Phase 22's toast test asserts on the
  recorded shape), and whether `fullscreenchange` fires under each project. A probe that
  only says "webkit rejects" leaves Phase 22 guessing again.
- **D2** must use the real `styles.css` type scale, not the mock's — the mock is what the
  question is about. Record the fold-back width as a number; Q2 and Phase 3a read it.
- **D3**'s table lists every game's board height at 390 wide, including Bubble's aim bar
  and Wyrdle's keyboard as part of "the board" — the question is what the stage must hold,
  not what the grid alone measures.
- **D4** is a flake study: 10/10 is the bar because the stability spec will run on CI with
  2 workers and a slower engine move; record the per-run frame count, not just pass/fail.

**Checkpoint (Phase 0):** the Verified Assumptions section carries a dated entry per
probe with a number, a screenshot path or an error string — not an adjective. Nothing is
committed except the plan doc's own update (`plans:` subject).


**Findings (executed 2026-08-30, worktree `game-panel`, `main@9d9a9bf`, local server on
:4180 serving `dist/` built against the shared wasm target):**

- **D1 — recorded.** Chromium (1280×800): `requestFullscreen()` from a click handler
  resolves, `document.fullscreenElement` = `HTML`, `fullscreenEnabled` = true. Playwright's
  `mobile-webkit` (iPhone 13 emulation): **there is no API at all** —
  `document.documentElement.requestFullscreen` is `undefined`, `webkitRequestFullscreen`
  is `undefined`, the call throws `TypeError: … is not a function`. So Phase 22's fallback
  is a **feature-detect** (`typeof el.requestFullscreen === "function" &&
  document.fullscreenEnabled`), not a try/catch on a rejection; the toast shows when the
  detect fails. (Q1 as adopted.)
- **D2 — the breakpoint holds.** The frame's rail markup with the app's real
  `tokens.css` + `styles.css` (16px base): rail 280px wide, `scrollWidth` 279, **no
  overflowing element** at 1000×680, 900×600, 820×600, 760×600; the board is 520px at 1000
  and 900, 500 at 820, 440 at 760. Rail content is 635px tall against 624 visible at 680
  high — the rail scrolls vertically by 11px with three settings rows; acceptable, and the
  rail is `overflow-y: auto` by design. **The 900px breakpoint stands**; the rail would
  need to fold below ~760 (board < 440), which 900 clears with margin. The numbers here are
  the fixture.
- **D3 — measured at 390 (iPhone 13, WebKit), largest element under `.play-area`:**

  | game | wrapper measured | height | ≤ 612? |
  |---|---|---|---|
  | solitaire | `.sol-board` | 316 | yes |
  | trio-tumble | `.m3-game` (incl. 4 rows of pills) | 709 | **no** |
  | bubble | `.bub-game` (incl. aim bar + fire) | 892 | **no** |
  | wyrdle | `.wy-grid` | 282 (keyboard separate) | yes |
  | 2048 | `.t48-game` (incl. d-pad) | 630 | **no** |
  | drop4 | `.drop4-game` (incl. options rows) | 633 | **no** |
  | othello | `.othello-game` | 570 | yes |
  | checkers | `.checkers-game` | 575 | yes |
  | dots | `.dots-game` | 478 | yes |
  | furrow | `.furrow-game` | 382 | yes |
  | align | `.al-game` (incl. touch pad) | 773 | **no** |
  | blockdoku | `.bdk-game` (board + tray) | 599 | yes |
  | looseends | `.le-home` | 404 | yes |
  | color-sort | `.cs-game` | 430 | yes |
  | orchard-drop | `.orch-surface` | 465 | yes |
  | cribbage | `.crib-game` | 533 | yes |

  Every "no" is a wrapper that today contains the controls the frame removes (pills,
  option rows) or an on-board input the frame keeps (2048's d-pad, Align's touch pad,
  Bubble's aim bar). **Candidates that must re-measure in their own phase:** Bubble (16),
  Align (18), 2048 (17) — the stage may need the meter row to collapse or the input to
  shrink; Trio Tumble and Drop 4 lose their rows and fit. Answers Q2's height half:
  portrait phones are fine; a landscape phone is Phase 3a's breakpoint question.
- **D4 — the sampler is sound, and it found the bug it exists for.** rAF sampler on
  `.othello-board` from the human's click until the engine's reply, 10 runs per project:
  chromium sees 56–59 frames per run, 52–53 of them during the engine's move, board top
  delta **0.00** (desktop does not move). `mobile-webkit` sees 33–35 frames, 27–28 during
  the engine's move, and the board top moves **24.8px on 10/10 runs** — the turn bar
  re-wraps when "Your move" becomes "The Engine to move". The stability spec asserts on
  geometry as planned; the sampler is promoted to `tests/helpers/board-top.ts` in Phase 6,
  and Phase 6's watch-it-fail step has its expected red number: 24.8.
- **D5** — resolved during Pass 3 (read-only); see Verified Assumptions.

**Done when:** D1–D4 recorded in Verified Assumptions with evidence (D5 already is);
Phases 1, 3, 6, 22 adjusted if any answer differs from the assumption they carry.

### Phase 1: The frame's bands, its spec, and the ADR

**Goal:** `renderGameFrame(spec, opts)` exists, renders bands ②③④⑤ with reserved heights,
and the placeholder game mounts through it.
**Changes:**
- [ ] `src/game-frame.ts` — `GameFrameSpec`, `Meter`, `Verb` types; `renderGameFrame()`
  returning `{ root, stage, update(spec), destroy() }`; band ③ renders seats
  (`kind:"seat"`: name, glyph, score, `sub`, `state: idle|active|thinking`) or stats
  (`kind:"stat"`: value, label); band ⑤ renders ≤ 5 verbs (throws on 6 — fail loud);
  no spec → bands ② and ④ only.
- [ ] `styles.css` — `.gf-*` rules: fixed heights (48/56/72), `.gf-seat .sub` always
  12px, `.gf-stage { position:relative; flex:1; min-height:0 }`, `.gf-toast`
  absolute; tokens only (the hex test).
- [ ] `tests/game-frame.test.ts` (vitest) — RED first: a spec with six verbs throws; a
  seat's sub-label element exists with empty text when `sub` is absent; `update()` with
  `state:"thinking"` toggles the class and swaps the text without changing
  `childElementCount`; no spec renders no meter and no dock.
- [ ] `src/games/placeholder.ts` — mounts through the frame with a one-verb, one-meter spec
  (the chrome exercise it exists for).
- [ ] `docs/BUILDING-GAMES.md` §4c (bands, spec), §4 rewrite; `docs/DESIGN.md` roles;
  `docs/RESPONSIVE-DESIGN.md` reserved-heights rule; `docs/adr/0002-…md`; `CLAUDE.md`
  pointer. (Doc files do not count toward the four-file rule; the code set is four — split
  point if Pass 3 insists: 1a `game-frame.ts` + unit test; 1b `styles.css` + placeholder +
  browser spec.)
**Call chain:** `/placeholder/` → `chrome.boot()` → `placeholderModule().mount()` →
`renderGameFrame(spec)` (Phase 2 moves the call into the chrome).
**Wiring test:** `tests/game-frame.spec.ts` "the placeholder mounts inside a frame":
`/placeholder/` shows `.gf-game-bar` and `.gf-stage` containing `.placeholder-game`.
**Depends on:** D2, D3.
**Read-set:** `src/contract.ts`, `src/settings-sheet.ts`, `src/games/placeholder.ts`.
**Write-set:** `src/game-frame.ts`, `styles.css`, `tests/game-frame.test.ts`,
`tests/game-frame.spec.ts`, `src/games/placeholder.ts`, docs listed.
**Shared-state contract:** writes only in this worktree; no git operations in `fun/`.
**Risks:** `styles.css` is 4.7k lines; a new block must not shadow `.sol-*`.
**Done when:** (behavioral) `/placeholder/` renders inside a frame with a game bar and a
one-verb dock; (verification) `npx playwright test tests/game-frame.spec.ts
--project=chromium --project=mobile-webkit` and `npm run unit -- game-frame` green.
**Validation:** narrow — tests, plus one screenshot at 390 in the Review Log.

**Pass 3 — the split applied (five files: three source, two tests; the rule counts
files, and the changes list above is what one head must hold).** The phase's shape
above stands as the description; execution runs it as two commits:

#### Phase 1a: the component and its stylesheet block
**Changes:** `src/game-frame.ts`, `styles.css` (`.gf-*`), `tests/game-frame.test.ts`.
**RED first, named cases (each is one `it`):**
- six verbs → throws; **five verbs → renders five** (the boundary, not just the
  overflow); zero verbs → no `.gf-dock` at all (rule 1: nothing, not an empty band). The
  thrown message names the game's `title` and lists the verbs, so a migration that
  overflows fails with the offending list in the stack, not "invalid spec".
- a seat with no `sub` still has a `.sub` element, empty; `update()` to
  `state:"thinking"` sets the class and `sub` text "thinking…" and `childElementCount` of
  band ③ is unchanged **before and after**; `update()` back to `idle` clears both.
- `update()` with a spec whose `meters.length` differs from the mounted one → throws
  (slots are fixed; a game that changes its meter count mid-game is the jump rule 1
  forbids, caught at the seam).
- no spec → `.gf-game-bar` and `.gf-stage` only; `.gf-meters` and `.gf-dock` absent.
- band heights: `.gf-game-bar`, `.gf-meters`, `.gf-dock` carry the reserved-height class
  hooks the CSS pins (jsdom has no layout — the **pixel** assertion is 1b's browser spec).
- `destroy()` empties the host and a second `destroy()` is a no-op.
**Observability:** `renderGameFrame` logs `console.debug("[frame] mount title=… verbs=n
meters=n")` once — the same shape as the six games' mount lines.
**Wiring test (1a):** the exported `renderGameFrame` is the only entry point that exists
before 1b; the unit test mounts it into a `.play-area` host and asserts the band order.
The product-level wiring test (`/placeholder/` in a frame) is RED from 1a's first commit
and GREEN at 1b's — 1a never lands without 1b following on the same branch.
**Done when:** `bash tools/check.sh gf-unit npm run unit -- game-frame` green and
`tests/tokens.test.ts` still green (no hex in the new block).
**Checkpoint:** commit `frame: the game frame component — bands, spec, reserved heights`.

#### Phase 1b: the placeholder mounts through it
**Changes:** `src/games/placeholder.ts`, `tests/game-frame.spec.ts` (new, `@smoke` on the
wiring test), the five doc files listed above.
**RED first:** the `/placeholder/` spec — both projects — asserting `.gf-game-bar` height
**48 ± 0**, `.gf-dock` **72 ± 0** at 390×844 via `boundingBox()`, and `.placeholder-game`
inside `.gf-stage`; plus the stage's top edge is identical before and after the
placeholder's one verb is clicked (the first reserved-height proof, cheap here).
**Wiring test:** the spec above.
**Done when:** `bash tools/check.sh gf-spec npx playwright test tests/game-frame.spec.ts
--project=chromium --project=mobile-webkit` green; `npm run smoke` green (the
placeholder's existing chrome tests still pass through the frame).
**Checkpoint:** commit `frame: the placeholder mounts inside the frame` + the docs; one
screenshot at 390 attached to the Review Log.

### Phase 2: The chrome mounts the frame for every game; the header stops wrapping

**Goal:** Every `/<id>/` page renders inside the frame; "How to play" and "↗" move into
the game bar's ⋯ menu; the shelf header is one row on every page.
**Changes:**
- [ ] `src/chrome.ts` — on a game page, build the frame with `{ title: displayName(entry) }`
  (no spec yet), mount the game into `frame.stage`; drop `.how-to-link` / `.newtab` from
  the header; the ⋯ menu holds them.
- [ ] `styles.css` — remove the header's game-page overflow; `.gf-menu`.
- [ ] `tests/game-frame.spec.ts` — RED first: for every playable game in `REGISTRY`, at
  390×844, `.chrome-header` height ≤ 64 (**this is the test that is red on `main` today**);
  the ⋯ menu contains a link to `/how-to/?game=<id>` and an `↗` with `target=_blank`.
- [ ] `tests/chrome.test.ts` — the game mounts into `.gf-stage`, not directly into
  `.play-area`; the how-to link is reachable.
- [ ] `build.mjs` — page `<title>` becomes the display name (D5); `TODO/README.md` item
  closes; `README.md` "The shelf and the drawer".
**Call chain:** `boot()` → `renderGameFrame` → `entry.load().mount(frame.stage, …)`.
**Wiring test:** the header-height test across all games; `tests/a11y-matrix.spec.ts`
stays green (every page × every skin, axe).
**Depends on:** Phase 1.
**Read-set:** `src/game-frame.ts`, `src/registry.ts`, `src/contract.ts`.
**Write-set:** `src/chrome.ts`, `styles.css`, `tests/game-frame.spec.ts`,
`tests/chrome.test.ts`, `build.mjs`, `README.md`, `TODO/README.md`, `CHANGELOG.md`.
**Shared-state contract:** as Phase 1.
**Risks:** games that measure `.play-area` (Align's stage sizing, Loose Ends' canvas) now
sit one level deeper — run `npm run smoke` after the mount change, not just this spec.
**Done when:** (behavioral) every game page's header is one row on a phone and every game
still plays; (verification) `npm run smoke` + `tests/game-frame.spec.ts`.
**Validation:** moderate — tests + open three games on the Samsung (`.claude/TESTBED.md`)
and confirm the header.

**Pass 3 — split applied (Pass 2 did not flag this phase, but it writes eight files and
the `<title>` work is independent of the mount change).**

#### Phase 2a: the chrome mounts the frame; the header stops wrapping
**Changes:** `src/chrome.ts`, `styles.css`, `tests/game-frame.spec.ts`,
`tests/chrome.test.ts`, `README.md`, `CHANGELOG.md`.
**RED first, named cases:**
- browser: for every `status:"playable"` entry in `REGISTRY`, at 390×844,
  `.chrome-header` `boundingBox().height` **≤ 64** — and the spec first asserts the
  header is **> 64 on at least one game page** when run against a build without the
  change (record that red run in the Review Log; a test that has never failed proves
  nothing about wrapping).
- browser: the ⋯ menu button has `aria-expanded`, opens on click and on Enter, closes on
  Escape and on click-off, and contains `a[href="/how-to/?game=<id>"]` and an `↗` with
  `target="_blank" rel="noopener"` — mirror the drawer's focus/ESC tests in
  `tests/chrome.test.ts` L34–72 rather than inventing a second pattern.
- jsdom: the game mounts into `.gf-stage` (`placeholderMountCount()` unchanged by a
  full-screen toggle — the existing "same instance" test L22 keeps passing); `.how-to-link`
  is **absent** from `.chrome-header` on a game page and the ⋯ menu holds it; on the home
  page there is **no** game bar (`gameId` empty → no frame).
**Observability:** none beyond 1a's mount line — the chrome change is structural.
**Wiring test:** the header-height test (`@smoke`).
**Done when:** `bash tools/check.sh smoke npm run smoke` green and
`tests/game-frame.spec.ts` green in both projects.
**Checkpoint:** commit `shelf: every game page renders inside the frame; the header is one
row`. Then the Samsung check named under Validation, before 2b.

#### Phase 2b: page titles from the registry (D5)
**Changes:** `tools/registry-titles.mjs` (new), `build.mjs`, `tests/page-titles.test.ts`
(new), `TODO/README.md`, `CHANGELOG.md`.
**RED first, named cases:**
- unit: `readRegistryTitles()` returns exactly `Object.fromEntries(REGISTRY.map(e => [e.id,
  displayName(e)]))` — every id, the same set (this is also the first test pinning
  `GAME_PAGES` to `REGISTRY`; it fails the day a game is registered without a page or
  vice versa); a registry text with **two** entries on one line still parses two (the
  index-zip regression named in `TODO/README.md`); an entry without `subtitle` yields
  `title` alone; a registry text that parses **zero** entries throws (the `skin-init.mjs`
  convention — an empty parse must not build 0 pages green).
- browser (`@smoke`): `page.title()` on `/trio-tumble/` is `Croft · fun — Trio Tumble:
  Jewel Drop` and on `/color-sort/` is `Croft · fun — Color Sort` — through the built
  page, not the parser.
**Wiring test:** the browser title assertion above.
**Done when:** `bash tools/check.sh titles npm run unit -- page-titles` and the two title
specs green; `TODO/README.md` item struck.
**Checkpoint:** commit `shelf: every game page's tab reads the game's name, not its slug`.

### Phase 3: Dock ↔ rail, the sheets, and "Controls on the left"

**Goal:** The frame's verbs and preferences render as a dock on phones and a rail on
desktop; Settings opens a bottom sheet (phone) / is inline (desktop); the New game sheet
renders `setup`; the mirror preference works.
**Changes:**
- [ ] `src/game-frame.ts` — rail layout at ≥ 900px (from D2); `openSheet("settings" |
  "setup")`; the common preference rows (Hints, Declare assistance, Sound, Vibration,
  Controls on the left) prepended to the game's `preferences`; `data-gf-side="left"`.
- [ ] `src/settings-sheet.ts` — `section` headings in the spec (additive).
- [ ] `src/settings.ts` — `controlsOnLeft()` / `setControlsOnLeft()` (`fun-controls-left`),
  pure resolver tested.
- [ ] `styles.css` — `.gf-rail`, `.gf-sheet`, `.gf-scrim`, mirror rules.
- [ ] `tests/game-frame.test.ts` — RED: the sheet renders common rows before game rows;
  toggling "Controls on the left" flips `data-gf-side`; `tests/settings.test.ts` —
  resolver edges (`"on"`, `"off"`, `null`, garbage).
- [ ] `tests/game-frame.spec.ts` — RED: at 1000×680 `.gf-rail` is visible and `.gf-dock`
  hidden; at 390 the reverse; with the preference on, the rail's `x` < the board's `x`.
- [ ] docs: §4c (dock/rail, sheets), §6 common section, `DESIGN.md` sheet tokens.
**Call chain:** frame verbs → `openSheet` → `renderSettingsSheet(...)`.
**Wiring test:** the placeholder declares one preference and one verb; the spec opens the
sheet from the dock and flips the mirror preference end-to-end.
**Depends on:** Phase 2, D2.
**Read-set:** `src/game-frame.ts`, `src/settings-sheet.ts`, `src/settings.ts`.
**Write-set:** `src/game-frame.ts`, `src/settings-sheet.ts`, `src/settings.ts`,
`styles.css` + tests + docs. *(Four source files — split if Pass 3 insists: 3a rail +
sheets, 3b mirror preference.)*
**Shared-state contract:** as Phase 1.
**Done when:** (behavioral) on the placeholder page, Settings opens a sheet on a phone and
is inline on desktop, and the preference mirrors both; (verification)
`tests/game-frame.spec.ts` both projects.
**Validation:** moderate — tests + a phone screenshot of the sheet in the Review Log.

**Pass 3 — split applied (four source files; the mirror preference is a separable
behaviour with its own store key).**

#### Phase 3a: dock ↔ rail, and the two sheets
**Changes:** `src/game-frame.ts`, `src/settings-sheet.ts` (`section` headings, additive),
`styles.css`, `tests/game-frame.test.ts`, `tests/game-frame.spec.ts`,
`tests/settings-sheet.test.ts` (existing suite gains the section cases), docs §4c
(dock/rail, sheets), `DESIGN.md` sheet tokens, `CHANGELOG.md`.
**RED first, named cases:**
- unit (`settings-sheet`): a spec with two sections renders two headings in order; a spec
  with **no** sections renders no heading element (Bubble's existing caller must not grow
  an empty `<h3>`); a section with zero rows is not rendered.
- unit (`game-frame`): the settings sheet's rows are `[...common, ...game.preferences]`
  with the common section **first**; a game with no `preferences` still gets the common
  section; `openSheet("setup")` renders `setup` rows and **not** `preferences`, and vice
  versa; a second `openSheet` while one is open replaces, never stacks (one `.gf-sheet`
  in the DOM).
- browser: at 1000×680 `.gf-rail` visible and `.gf-dock` hidden; at **899×680** the
  reverse (the breakpoint's edge, not just "phone" and "desktop"); at 390 the sheet opens
  as a bottom sheet with `role="dialog"` `aria-modal="true"`, focus moves inside, Escape
  and scrim-click close it and return focus to the verb that opened it; at 1000 the same
  Settings verb renders the rows **inline** in the rail and no `.gf-scrim` exists.
- `tests/a11y-matrix.spec.ts` stays green with the sheet open on one game — add the
  open-sheet state to the matrix's reachable states for `/placeholder/` only (the matrix
  reaches "mid-game, result, tutor" today; the sheet is a new state it cannot reach on its
  own).
**Observability:** `console.debug("[frame] sheet=settings|setup open")` — one line per
open, so a phone trace shows which sheet a stuck scrim belongs to.
**Wiring test:** the placeholder's one verb opens the settings sheet from the dock at 390
and inline at 1000 (`@smoke`).
**Done when:** `bash tools/check.sh gf-spec npx playwright test tests/game-frame.spec.ts
--project=chromium --project=mobile-webkit` green; `npm run unit -- settings-sheet
game-frame` green.
**Checkpoint:** commit `frame: dock on phones, rail on desktop; settings and new-game
sheets`; phone screenshot of the sheet in the Review Log.

#### Phase 3b: "Controls on the left"
**Changes:** `src/settings.ts` (`controlsOnLeft()` / `setControlsOnLeft()`, key
`fun-controls-left`, via the existing `resolveBool`), `src/game-frame.ts`
(`data-gf-side`), `styles.css` (mirror rules), `tests/settings.test.ts`,
`tests/game-frame.spec.ts`, docs §6, `CHANGELOG.md`.
**RED first, named cases:**
- unit: `controlsOnLeft()` is **false** with nothing stored, true after
  `setControlsOnLeft(true)`, false again after `setControlsOnLeft(false)`; a stored garbage
  value reads false; storage throwing → false, no throw (the settings module's stated
  degrade rule). Do **not** re-test `resolveBool`'s `"on"`/`"off"`/`null` — that suite
  exists (`tests/settings.test.ts` L109).
- browser: with the preference on, at 1000 the rail's `boundingBox().x` **<** the stage's
  `x`; off, **>**; at 390 the dock's verb order is **reversed** (first verb's `x` is the
  largest) — three assertions, because "mirror" means different things in the two shapes
  and a CSS rule that flips one but not the other survives a single check.
- the toggle lives in the common section of the settings sheet and takes effect **without
  a reload** (the sheet's `onChange` re-renders the panel).
**Wiring test:** the browser spec toggling the preference from the sheet and measuring
both shapes (`@smoke`).
**Done when:** `bash tools/check.sh gf-spec npx playwright test tests/game-frame.spec.ts
--project=chromium --project=mobile-webkit` green; `npm run unit -- settings` green.
**Checkpoint:** commit `frame: a "Controls on the left" preference mirrors the dock and the
rail`.

### Phase 4: The progress store

**Goal:** `src/progress.ts` reads, validates, writes, expires and clears one record per
game; `GameModule` gains optional `snapshot`/`resume`.
**Changes:**
- [ ] `src/progress.ts` — `Progress` type; `resolveProgress(raw: string | null, now:
  Date): Progress | null` (pure: rejects wrong `v`, wrong shape, expired daily);
  `readProgress(id)`, `writeProgress(id, p)`, `clearProgress(id)`; `summaryOf(p)`.
- [ ] `src/contract.ts` — `snapshot?(): Progress; resume?(p: Progress): void` on
  `GameModule`.
- [ ] `tests/progress.test.ts` — RED first, with edges: `v: 2` → null; a daily record from
  yesterday → null at today's local midnight + 1ms, kept at 23:59:59 the day it was made;
  `status:"finished"` kept (per Q6); malformed JSON → null; storage throwing →
  `readProgress` returns null and `writeProgress` does not throw.
**Call chain:** none from the entry point until Phase 5 — this phase is pure by design;
its entry-point wiring test is Phase 5's and is named there.
**Wiring test:** `tests/contract.test.ts` — a module with `snapshot` satisfies the
contract type (compile-time), and the placeholder's `snapshot()` round-trips through
`resolveProgress`.
**Depends on:** nothing (can precede Phase 3 if the rail work stalls).
**Read-set:** `src/contract.ts`, `src/shelf.ts` (the storage-wrapper pattern).
**Write-set:** `src/progress.ts`, `src/contract.ts`, `tests/progress.test.ts`,
`tests/contract.test.ts`, `docs/BUILDING-GAMES.md` §4c (store).
**Shared-state contract:** as Phase 1.
**Done when:** (behavioral) a record written today survives a reload and a daily record
from yesterday does not; (verification) `npm run unit -- progress`.
**Validation:** narrow — tests.

**Pass 3 additions:**
- **Write-set gains `src/games/placeholder.ts`.** The wiring test above round-trips "the
  placeholder's `snapshot()`" and Phase 5a's spec needs "one placeholder move" — so the
  placeholder gains a counter that a click increments, `snapshot()` carrying it and
  `resume(p)` restoring it, **here**, not in Phase 5. Four files is still the ceiling
  (three source + two tests, docs aside); no further split.
- **More edges for `resolveProgress`, each its own `it`:** `v: 1` accepted, `v: 0` and
  `v: 2` and `v: "1"` rejected; `status` outside the two literals rejected; a `free`
  record from last week **kept** (only daily expires); a daily record made at 23:59:59
  kept at 23:59:59.999 and dropped at 00:00:00.000 next day (both sides of the boundary,
  in the local zone the test fixes with a constructed `Date`); `summary.line` missing →
  rejected (the card would be blank); `record` of any shape accepted (opaque to the store).
- **Newest wins, no history:** `writeProgress` overwrites; a test writes two records and
  reads one, the second.
- **Observability:** a rejected record logs `console.debug("[progress] <id> rejected:
  <reason>")` with the reason `resolveProgress` returns alongside `null` — make the pure
  function return `{ ok: false, reason }` | `{ ok: true, progress }` so the reason is a
  tested value, not a string in a log call. Storage denial logs once at `debug`, never
  throws (the `settings.ts` degrade rule, quoted in the module comment).
- **Q8** (whether a rejected record is cleared on read) is decided before this phase's
  RED tests are written — the test list differs by one case.
- **Checkpoint:** commit `progress: a per-game progress store with expiry and validation`;
  `bash tools/check.sh progress npm run unit -- progress contract`.

### Phase 5: The start screen — poster, continue card, `?r=` precedence; home Continue

**Goal:** Every game URL opens on the poster (no progress) or the continue card (progress);
Play/Continue mounts the game; New game clears the store; `?r=` bypasses both; the home
page's Continue reads the store.
**Changes:**
- [ ] `src/game-frame.ts` — `renderStart({ entry, spec, progress })`; poster uses
  `/<id>/assets/splash.jpg`, card uses `icon.jpg`; Play → `onPlay(setup)`; Continue →
  `onResume(progress)`; the frame calls `module.snapshot()` after each `update()` and
  writes the store; marks `finished` when the game reports a result.
- [ ] `src/chrome.ts` — `?r=` present → mount directly (the record card is the game's);
  otherwise `renderStart`; on Play, mount + `writeProgress`.
- [ ] `src/shelf.ts` / `src/home.ts` — `resume` reads `readProgress` for a summary line;
  falls back to last-opened when no store entry.
- [ ] `styles.css` — `.gf-poster`, `.gf-continue`.
- [ ] `tests/game-frame.spec.ts` — RED: `/placeholder/` shows the poster with the art and a
  Play button; after Play + one placeholder "move", reload shows the continue card with
  the summary line; New game → poster; `/placeholder/?r=x` shows neither.
  `tests/home.spec.ts` — the resume card shows the summary line when progress exists.
**Call chain:** `boot()` → `renderStart` → Play → `mount` → `snapshot` → `writeProgress`.
**Wiring test:** the reload-shows-continue-card spec above.
**Depends on:** Phases 2, 4.
**Read-set:** `src/progress.ts`, `src/registry.ts`, `src/home.ts`.
**Write-set:** `src/game-frame.ts`, `src/chrome.ts`, `src/shelf.ts`, `src/home.ts`,
`styles.css` + tests. *(Five source files — split: 5a start screen [`game-frame.ts`,
`chrome.ts`, `styles.css`]; 5b home Continue [`shelf.ts`, `home.ts`].)*
**Shared-state contract:** as Phase 1.
**Done when:** (behavioral) opening any game URL shows a poster; leaving mid-game and
returning shows Continue; (verification) `tests/game-frame.spec.ts` + `tests/home.spec.ts`.
**Validation:** moderate — tests + the Samsung: open Othello, play two moves, kill the tab,
reopen, see the card.

**Pass 3 — split applied (five source files), and one gate: Q7 must be decided before
5a's RED tests are written**, because the answer changes which URLs show the poster and
therefore which of the 299 existing `goto`s, 50 shots recipes and the a11y matrix's bare
`/${id}/` visits land on a board. Measured, not estimated — see Verified Assumptions.

#### Phase 5a: the start screen
**Changes:** `src/game-frame.ts` (`renderStart`), `src/chrome.ts`, `styles.css`,
`tests/game-frame.spec.ts`, `tests/a11y-matrix.spec.ts`, `CHANGELOG.md`, docs §4c (start
screen).
**RED first, named cases:**
- `/placeholder/` (bare) shows `.gf-poster` with `img[src="/placeholder/assets/splash.jpg"]`
  (the placeholder ships no art today — **give it a splash and icon in this phase**, so
  the frame's own exercise game satisfies `tests/art.test.ts` in both directions), the
  name, the pitch, the setup card and a **Play** button; **no** `.placeholder-game` in the
  DOM until Play.
- Play → `.placeholder-game` mounts, the poster is gone, `readProgress("placeholder")` is
  non-null (Play writes); the poster-to-board transition does not move `.gf-stage`'s top.
- after Play + one click, `reload()` shows `.gf-continue` with `summary.line` text and
  **Continue / New game**; Continue mounts and `resume` restored the counter (the card's
  number and the board's number agree); New game shows the poster and
  `readProgress` is null.
- `/placeholder/?r=x` shows **neither** card and mounts directly (the `?r=` precedence).
- a record with `status:"finished"` shows the continue card in its "play again" form
  (Q6) — the card's primary button reads **New game**, not Continue.
- storage denied (`page.context()` with `localStorage` stubbed to throw in an
  `addInitScript`) → poster, no error overlay, no console `error`.
- the URL forms Q7 decides (`?seed=`, `?fast=`, `?daily=`…) do what Q7 says — one `it`
  per form, written after the decision.
- `tests/a11y-matrix.spec.ts`: the matrix visits every game's **poster** (bare URL) and
  its **board** (the Q7 form or a Play click) — both states, every skin; the poster is a
  new surface for axe and must not be the only one scanned.
**Observability:** `console.debug("[frame] start=poster|continue|record id=<id>
progress=<status|none>")` at every land — the one line a phone trace needs to explain
which card appeared and why.
**Wiring test:** reload-shows-continue-card (`@smoke`).
**Done when:** `bash tools/check.sh gf-spec npx playwright test tests/game-frame.spec.ts
--project=chromium --project=mobile-webkit` green **and** `bash tools/check.sh e2e npm run
e2e` green — the full suite, because this is the phase that changes what every URL shows.
**Checkpoint:** commit `frame: every game opens on a start screen — poster, or a continue
card from the store`; then the Samsung check under Validation.

#### Phase 5b: home Continue reads the store
**Changes:** `src/shelf.ts`, `src/home.ts`, `tests/home.spec.ts`, `tests/shelf.test.ts`
(the model's `resume` field), `CHANGELOG.md`.
**Decision recorded (not an open question):** `noteOpened` keeps firing at **land**, as
today (`chrome.ts` L291), not at Play — so "Last played" still means the last game
visited, and the store adds the summary line on top. The alternative (record at Play)
makes a poster visit invisible to the home page, which is a bigger change than this
phase wants.
**RED first, named cases:**
- unit (`buildShelfModel`): given a progress map with an in-progress entry, `resume`
  carries `{ id, title, line }`; with a store entry **and** a newer last-opened for a
  different game, the store entry wins (Continue is about unfinished games, not
  recency); with no store entry, `resume` is the last-opened without a line (today's
  behaviour, pinned); with an in-progress entry for a game **not in `REGISTRY`** (a
  removed game's stale key), it is ignored.
- browser: after playing one placeholder move, `/` shows `.home-resume` containing the
  summary line; after New game, it shows "Last played" without a line; `home.spec.ts` L56
  ("opening a game makes it the one you jump back into") keeps passing **unchanged** —
  it visits the bare `/othello/`, so under Q7's answer that visit still records an open.
**Wiring test:** the `/` summary-line spec (`@smoke`).
**Done when:** `bash tools/check.sh home npx playwright test tests/home.spec.ts
--project=chromium --project=mobile-webkit` and `npm run unit -- shelf` green.
**Checkpoint:** commit `shelf: home's Continue reads the progress store`.

### Phase 6: Othello migrates (the versus archetype) — and the first stability test

**Goal:** Othello declares a spec; its turn bar, option row, banner and `<details>` are
gone; thinking is a seat state; the board does not move.
**Changes:**
- [ ] `tests/helpers/board-top.ts` — the rAF sampler from D4 (promoted; TDD'd here: a unit
  test with a fake rAF).
- [ ] `tests/othello.spec.ts` — RED: `boardTopStable(page, ".othello-board", async () =>
  { click legal; await waitHumanOrOver })` reports `max - min < 1`; also after opening
  Settings and after the tutor toggles; existing assertions on `.othello-banner`,
  `.othello-turnbar`, `.othello-level` rewritten against `.gf-seat`, the New game sheet
  and the settings sheet.
- [ ] `src/games/othello/othello.ts` — `spec()` → `{ title, mode: level, pitch, meters:
  [seat you, seat engine], verbs: [Undo?, Hint, New game…, Settings], setup: [difficulty
  choice, side choice], preferences: [tutor, local-AI] }`; `frame.update(spec())` inside
  `render()`; `thinking` → seat state; `*-ai-say` → `frame.toast(line, { anchor: "seat:1"
  })` (Q3); banner removed (its sentence becomes `pitch` + a first-move toast);
  `snapshot()` / `resume()` over the move list.
- [ ] `styles.css` — delete `.othello-turnbar`, `.othello-controls`, `.othello-banner`,
  `.othello-settings` blocks.
- [ ] `src/games/othello/othello-howto.ts` copy + `npm run guide:shots` (Othello's shots
  only); `CHANGELOG.md`; `docs/BUILDING-GAMES.md` §4c worked example (versus), §10 seats,
  both checklists; `docs/RESPONSIVE-DESIGN.md` lessons-log entry.
**Call chain:** `/othello/` → frame → `othelloModule().mount(stage)` → `render()` →
`frame.update(spec())`.
**Wiring test:** the stability spec through `/othello/?seed=7`.
**Depends on:** Phases 3, 5, D4.
**Read-set:** `src/game-frame.ts`, `src/progress.ts`, `tests/othello-tutor.test.ts`,
`tests/othello-harness.test.ts`.
**Write-set:** `src/games/othello/othello.ts`, `styles.css`, `tests/othello.spec.ts`,
`tests/helpers/board-top.ts` (+ how-to, shots, changelog, docs).
**Shared-state contract:** as Phase 1.
**Risks:** `tests/othello-tutor.test.ts` and `othello-harness.test.ts` read DOM classes —
check before deleting any. *(Pass 3: checked — they do not; every `othello-` hit is an
import path. Risk retired. The real reader is `tools/guide-shots.mjs`, below.)*
**Done when:** (behavioral) Othello on a phone: the board's top edge is unchanged from move
1 through the engine's reply, a hint, a tutor toggle and the settings sheet; (verification)
`npx playwright test tests/othello.spec.ts` both projects.
**Validation:** broad for the first migration — tests + both phones, one full game each.

**Pass 3 additions (Phase 6 stays one phase: four source-ish files — `othello.ts`,
`styles.css`, `othello.spec.ts`, `board-top.ts` — with the how-to copy, shots recipe,
changelog and docs riding along as the migration's fixed tail; splitting the archetype
would split the recipe every later phase copies):**
- **Write-set gains `tools/guide-shots.mjs`** (the `othello-*` recipes click
  `.othello-tutor-explain` and wait on `.othello-board`; the tutor toggle they set through
  `localStorage` survives, the explain button must still exist in the stage) and
  `CHANGELOG.md`'s `Contexts:` line (adds `othello`).
- **The sampler's unit test (`tests/helpers/board-top.test.ts`), named cases:** zero
  frames sampled → `boardTopStable` **throws** ("no frames observed" — a sampler that saw
  nothing must not report stable; this is the D4 flake turned into a loud failure);
  one frame → reports that value as both min and max; tops `[100, 100.4, 100]` → stable
  under the `< 1` rule (sub-pixel is allowed); `[100, 101, 100]` → **not** stable (the
  boundary is 1px); the sampler stops when the awaited action resolves and takes no
  frame after.
- **Prove the stability spec can fail:** before migrating `othello.ts`, run the new spec
  against the unmigrated page and record the measured `max − min` in the Review Log (the
  `*-ai-say` splice and the banner swap are the expected movers). A stability test that
  was green on day one is the "check that grades an empty set" shape from
  `VERIFICATION.md`.
- **Stability triggers, each its own `it`:** the engine's reply at Medium (no `?fast=1`),
  a Hint, opening and closing Settings, toggling the tutor from the sheet, the AI's
  banter arriving (Q3's toast — anchored or stage, it must not be in flow), and a pass
  turn (`mustPass`, `othello.ts` L322 — the "no move — passing" sentence today lands in
  the status line).
- **Rewritten assertions, not deleted ones:** every existing `othello.spec.ts` assertion on
  `.othello-turnbar` / `.othello-level` / `.othello-banner` gets a named replacement
  (`.gf-seat[data-seat="engine"].thinking`, the setup sheet's difficulty choice, the
  first-move toast); the test count in the file does not go down. "the difficulty picker
  persists the chosen level" (L71) becomes "the New game sheet's difficulty choice
  persists" against the same `fun-othello-level` key.
- **`snapshot()`/`resume()` edges:** resume after 0 moves is the initial position;
  resume of a finished game shows the result screen, not a board; a snapshot taken
  mid-thinking (the engine's move pending) records the position **before** the engine's
  move — resume replays the human's last move and re-triggers the engine.
- **Checkpoint:** `bash tools/check.sh othello npx playwright test tests/othello.spec.ts
--project=chromium --project=mobile-webkit`; `npm run guide:shots -- othello`; `git add`
only `assets/guide/othello-*.jpg`; commit `othello: plays inside the game frame — seats,
verbs, a start screen, and a board that does not move`. Then both phones.

### Phases 7–21: one phase per game, the Phase 6 recipe

Same shape as Phase 6 — RED stability spec on the game's own trigger, spec declared,
per-game control/HUD/banner/`<details>` removed, CSS deleted, shots regenerated, changelog,
per-game README paragraph trimmed; same Read/Write-set shape with the game's own files;
sequential (Concurrency Map). Per-game deltas:

- **7 Solitaire** (solo archetype): `mode` = Today's deal / Free; meters Moves · In stock ·
  Home; verbs Undo · Hint · Auto · New deal…; `.sol-status` stays *below* the felt (it is
  reserved-height already). §4c worked example (solo).
- **8 Trio Tumble** (campaign archetype): objectives + campaign level → `setup`; Levels
  verb opens a setup sheet with the level grid; `.m3-beat` stays an overlay. §4c worked
  example (campaign).
- **9 Wyrdle**: `.wy-toast` → `frame.toast`; stability trigger = a rejected word.
- **10 Blockdoku**: `.bdk-banner` → a fixed-text meter slot or a toast; trigger =
  select/deselect.
- **11 Drop 4**: `.drop4-thinking` + `.drop4-ai-disclosure` → seat state + a preference
  hint; mark picker → setup.
- **12 Checkers**, **13 Dots** ("goes again" → seat sub-label), **14 Furrow**: as Othello.
- **15 Cribbage**: *Throw to crib* / *Go* stay in the table; peg-board mode and muggins →
  preferences; seats flip → setup; `.crib-status` gets its reserved height.
- **16 Bubble**: aim bar stays below the board; `bub-aim-settings` sheet → the game's
  preference section (the one existing `renderSettingsSheet` caller becomes the model);
  Levels/Classic → setup; the optional timer → a fixed meter slot.
- **17 2048**, **18 Align** (Sprint/Marathon → setup; move-speed/haptics → preferences),
  **19 Color Sort** (deadlock card → toast with Undo/Restart; skin/icons/strict →
  preferences), **20 Orchard Drop** (no controls today — gains only the frame's).
- **21 Loose Ends**: already splash-driven; its home becomes the frame's poster + a Levels
  setup sheet; the overlay HUD stays as a stage overlay.

**Pass 3 — the recipe's fixed tail, applied to every one of 7–21 (so each phase is
self-describing without re-reading Phase 6):**
1. **RED:** the game's stability spec on its named trigger, **run once against the
   unmigrated page with the measured movement recorded** in the Review Log; plus the
   named replacements for every assertion that reads a class the migration deletes.
2. **Write-set:** `src/games/<id>/<id>.ts`, `styles.css`, `tests/<id>.spec.ts`,
   `tools/guide-shots.mjs` (its `<id>-*` recipes — grep the file for the game's selectors
   **before** deleting a class), `src/games/<id>/<id>-howto.ts`, `assets/guide/<id>-*.jpg`
   (`npm run guide:shots -- <id>`; `git add` only those), `README.md` (the game's
   paragraph), `CHANGELOG.md` (entry + `Contexts:` line if the game is new there).
3. **Reserved-height check per game:** any `.<id>-status`-style element that the game
   keeps below the board gets a `min-height`, asserted by the stability spec's trigger
   (Furrow, Cribbage, Solitaire keep theirs).
4. **`snapshot`/`resume` edges** as Phase 6: zero moves, finished, mid-thinking where the
   game has an engine.
5. **Checkpoint:** `bash tools/check.sh <id> npx playwright test tests/<id>.spec.ts
   --project=chromium --project=mobile-webkit`; `bash tools/check.sh smoke npm run smoke`
   (the other games did not regress through the shared stylesheet); commit `<id>: plays
   inside the game frame — …`. **One migration per commit; a phase that is red at the
   end of the day is reverted, not left half-migrated on the branch** — the frame renders
   an unmigrated game as-is, so there is no half state to keep.
6. **Validation** is moderate from Phase 7 on (tests + one phone), not broad — Phase 6
   paid for the archetype's broad validation; Cribbage (15, hidden information, table
   verbs) and Loose Ends (21, canvas + HUD) go back to **broad**, both phones.

### Phase 22: Full screen means full screen (D5), and the closing sweep

**Goal:** ⤢ requests the Fullscreen API; the frame stays; the shelf bar goes; iOS gets an
honest message. Dead CSS gone; STATE-OF-PLAY addendum; `docs-guardian` sweep.
**Changes:**
- [ ] `src/chrome.ts` — `setFull(true)` → `requestFullscreen()` where supported; on
  rejection (from D1's recorded error) render the frame's toast "Full screen isn't
  available in this browser — install the app for it" with the PWA link (Q1);
  `fullscreenchange` syncs `aria-pressed`.
- [ ] `styles.css` — `body.fullscreen` hides `.chrome-header` only; remove `.wrapped-*`
  and every `.sol-controls` / `*-turnbar` / `*-banner` rule with no remaining caller
  (grep-gated: a unit test asserts no `.sol-controls` in `src/`).
- [ ] `tests/chrome.test.ts` — RED: `toggleFullscreen()` calls `requestFullscreen` when
  present and shows the toast when it throws; `tests/game-frame.spec.ts` (chromium) —
  `document.fullscreenElement` set after ⤢.
- [ ] `docs/STATE-OF-PLAY.md`, `mocks/README.md`, final `docs-guardian` run.
**Call chain:** header ⤢ → `setFull` → `requestFullscreen` / toast.
**Wiring test:** the chromium fullscreen spec.
**Depends on:** Phases 6–21, D1.
**Read-set:** `src/game-frame.ts`.
**Write-set:** `src/chrome.ts`, `styles.css`, `tests/chrome.test.ts`,
`tests/game-frame.spec.ts`, docs listed.
**Shared-state contract:** as Phase 1.
**Done when:** (behavioral) ⤢ fills the tab on desktop and the display on Android, and
says why not on iOS; (verification) `npm run gate`.
**Validation:** broad — both phones + a desktop browser, plus `docs-guardian`.

**Pass 3 additions:**
- **This phase hides no deferred doc work** (checked): `STATE-OF-PLAY.md`'s addendum and
  `mocks/README.md`'s "what shipped" row are closing records that can only be written
  when the migrations are done; every other doc is scheduled in the phase that makes it
  stale. The `docs-guardian` run is a sweep, not a schedule.
- **Unit cases for `toggleFullscreen()` in jsdom (which has no Fullscreen API — the test
  installs `document.documentElement.requestFullscreen` per case):** present and
  resolving → called once, no toast, `aria-pressed="true"`; present and **rejecting** with
  the error shape D1 recorded → the toast with Q1's copy, `aria-pressed` stays `"false"`,
  `body.fullscreen` **not** set; **absent** (`undefined`, the iOS shape) → the same toast
  without a thrown `TypeError`; a `fullscreenchange` event with `fullscreenElement` null
  (the user pressed Esc) → `aria-pressed="false"` and `body.fullscreen` removed — the
  state must follow the browser, not the button.
- **The "same instance" invariant survives:** `tests/chrome.test.ts` L22 keeps passing —
  `placeholderMountCount()` unchanged across a real fullscreen round-trip.
- **Dead-CSS gate as a real test:** `tests/dead-css.test.ts` lists the classes the
  migrations deleted (`.sol-controls`, `.sol-modes`, `*-turnbar`, `*-banner`,
  `.wrapped-*`) and asserts each appears in **neither** `src/` nor `styles.css`; it is
  written RED here (the `.wrapped-*` block is present today) and stays as the reachability
  guard for the next game.
- **Observability:** the rejection path logs `console.debug("[frame] fullscreen rejected:
  <name>: <message>")` so an iOS report can be matched to D1's recorded string.
- **Checkpoint:** `bash tools/check.sh gate npm run gate` — the whole declared gate,
  named — before the landing PR; the Review Log records the run's exit code and test
  counts, not "green".

## Open Questions

1. [CONFIRMED: PHASE-GATED (Phase 22)] **What should ⤢ do on iOS Safari, which grants
   no page fullscreen?** *Recommendation: the toast + a link to the PWA install (standalone
   display is the honest equivalent). Needs D1's recorded behaviour and the owner's OK on
   the copy.*
2. [CONFIRMED: PHASE-GATED (Phase 3)] **Is there a height breakpoint too — a short
   landscape phone where the rail should fold back to the dock, or the meter row
   collapse?** *D3 will produce the number; the decision is whether to design for
   landscape phones at all in this pass.*
3. [CONFIRMED: PHASE-GATED (Phase 6)] **Where does the AI's banter (`*-ai-say`) go — a
   bubble anchored to the opponent's seat, or a stage toast like every other transient?**
   *Recommendation: a seat-anchored bubble in the rail, a stage toast on the phone; both
   satisfy rule 1. The persona work (`docs/AI-PLAYERS.md`) cares about this.*
4. [CONFIRMED: ADVISORY] **Split `styles.css` into per-game files so Phases 7–21 can run
   in parallel worktrees?** *It would cut wall-clock substantially, but it changes the
   repo's one-stylesheet convention and `tests/tokens.test.ts`'s hex scan; recommend no
   for this pass — sequential migrations are a day each.*
5. [CONFIRMED: ADVISORY] **Desktop poster art: keep the portrait splash as a left panel
   (row 1 as drawn) or commission landscape for the fourteen games without one?** *Either
   is fine for the frame; it changes only `renderStart`'s CSS.*
6. [CONFIRMED: PHASE-GATED (Phase 4)] **Should the store keep `finished` records (so the
   card can say "Won yesterday · play again"), or only in-progress ones?**
   *Recommendation: keep `finished` until the next daily rollover, then drop — it costs
   nothing and makes the home page's Today strip honest.*

Added by Pass 3 (2026-08-30) — **not yet reviewed by the owner**:

7. [CONFIRMED: PHASE-GATED (Phase 5a) — ADOPTED as recommended under the owner's 2026-08-30 "go until all phases are done"; bare `/<id>/` is the front door, any query-parameterised URL is a deep link that mounts directly] **What does a game URL with query parameters
   open on, once every bare URL opens on a start screen?** Rule 5 says "every URL"; the
   plan already carves out `?r=`. Measured: 299 `page.goto(` calls in the browser suite,
   50 in `tools/guide-shots.mjs`, and `tests/a11y-matrix.spec.ts`'s bare `/${id}/` visit
   for every game × skin all expect a board on land; most specs pass `?seed=7`, some
   `?fast=1`, the daily links carry their own parameters. *Recommendation: a URL that
   names a game state (`?seed=`, `?fast=`, `?daily=`, any game-defined parameter) is a
   deep link and mounts directly, exactly as `?r=` does; only the bare `/<id>/` is the
   front door. It keeps the product rule where a person meets it (the shelf tile, the
   address bar, the home Continue card all produce bare URLs), leaves the 299 + 50
   existing navigations honest without a test-only seam, and the a11y matrix adds the
   poster as a second state rather than losing the board. The alternative — Play on every
   URL — costs an edit to every spec and recipe in Phase 5a, and the seam it needs
   (`?play=1`) is a state no player ever sees. Gates 5a because its RED tests differ by
   one `it` per URL form and the matrix change depends on it.*
8. [CONFIRMED: ADVISORY — ADOPTED as recommended under the same authorization: a rejected record is cleared and the reason logged at debug] **When `readProgress` rejects a stored record (wrong `v`,
   malformed), should it clear the key or leave it?** *Recommendation: clear it and log
   the reason at `debug` — a record that fails validation will fail on every land and
   blocks nothing (Play overwrites), but a stale `v: 1` record after a future `v: 2`
   would otherwise sit in storage forever. Resolvable while writing Phase 4's RED list;
   it changes one test case either way.*

## Review Log

### Phase 4 — executed 2026-08-30
- RED first (module absent), then green: `resolveProgress` returns a tagged result whose
  `reason` is the tested value (`version 2`, `status: paused`, `not JSON`, `nothing
  stored`, `not a record`, `no summary line`, `daily expired`); the rollover is tested at
  23:59:59.999 / 00:00:00.000 local; free never expires; finished is kept until rollover
  (Q6); a rejected record is cleared on read with its reason at debug (Q8); storage
  throwing → null / no-throw with one debug line each. `GameModule` gains optional
  `snapshot()` / `resume()`; the placeholder implements both (its counter is its record)
  and `tests/contract.test.ts` round-trips it through the resolver and back into a fresh
  mount. §4c gains the store section.
- Green: unit 56 across progress + contract + frame + chrome; typecheck; lint.

### Phase 3b — executed 2026-08-30
- RED first: 4 unit cases (the setting's off/on/off, garbage, storage-throws; the frame's
  `data-gf-side` + `setSide`) then the browser mirror case. `controlsOnLeft()` reuses
  `resolveBool` (not re-tested). One attribute on the frame's root drives both shapes:
  `row-reverse` on the dock, a swapped grid template for the rail. The toggle in the
  "Every game" section flips the frame live through `frame.setSide()` — no reload —
  measured in both shapes by the browser spec: rail x < stage x at 1000 with it on, the
  first dock verb's x the largest at 390.
- Green: unit 224, `tests/game-frame.spec.ts` 20/20 both engines, `npm run smoke` 50/50,
  typecheck, lint, hex scan. Docs: §6 gains the "Every game" section; §4c notes the flip.

### Phase 3a — executed 2026-08-30
- RED first: 12 unit cases failed (sections, sheets, the Settings verb, the cap); then the
  browser cases. Two design points settled in code rather than the plan's words: (1) the
  rail is the **same DOM** in a CSS grid (`data-gf-shape="rail"` at ≥ 900px from
  `matchMedia`), not a `.gf-rail` wrapper — so the 1a band-order test still holds and no
  `display: contents` is needed; the plan's ".gf-rail visible" assertion became "the dock's
  box is beside the stage at 1000, under it at 899". (2) **Settings is the frame's verb**:
  appended after the game's, so a game declares at most four (`MAX_GAME_VERBS`) and a
  declared `settings` id throws — the reserved-verb rule from §4c, enforced.
- What the tests caught: a touch tap on WebKit does not focus a button, so "return focus
  to the opener" needed the opener passed explicitly (`openSheet(kind, from)`); the rail
  panel's `<h3>` heads under a hidden `<h1>` failed axe `heading-order` → `<h2>`; the
  1b spec's "one verb" became "one verb plus Settings".
- Green: unit 30 (frame + sheet), `tests/game-frame.spec.ts` 18/18 both engines, `npm run
  smoke` 49/49 (the matrix gained the open-sheet and rail states on the placeholder),
  typecheck, lint, hex scan. Screenshots at 390 (sheet) and 1000 (rail) reviewed: the
  sheet's sections read "Every game → Hints · Declare assistance · Sound"; the rail shows
  the meter, the verb, and settings inline.

### Phase 2b — executed 2026-08-30
- RED first: `tests/page-titles.test.ts` failed to resolve `tools/registry-titles.mjs`;
  then one real red after the tool existed — `Object.keys` hoists the integer-like `"2048"`
  to the front, so the page list came out of registry order. Entries are now an ordered
  array (`readRegistryEntries`), titles an object derived from it.
- `build.mjs` reads both its page list and each page's name from the registry source;
  the hand-kept `GAME_PAGES` array is gone and the test pins the list to `REGISTRY` for the
  first time. `tests/game-frame.spec.ts` asserts the built tab titles through the page.
  `TODO/README.md` item struck. Typecheck needed `tools/registry-titles.d.mts`, the
  `skin-init` convention.

### Phase 2a — executed 2026-08-30
- RED first: three jsdom cases in `tests/chrome.test.ts` and the declare-on-first-update
  case in `tests/game-frame.test.ts` failed (2 failing, 23 passing); the browser header
  test's "red run" is Phase 0's measurement (110px on every game page) — the identical
  assertion, made before the change.
- The chrome now mounts `renderGameFrame(playArea, undefined, { title, menu })` for every
  game page and hands the game `services.frame`; a frame with no spec accepts its first
  `update()` as the declaration. The header's two links moved to the ⋯ menu.
- Three things the tests caught: (1) one row is **64.19px**, not 64 — the hairline; the
  threshold is 66 (two rows are 110); (2) `.gf-menu { display:flex }` beat the UA's
  `[hidden]` → `.gf-menu[hidden] { display:none }`; (3) the how-to page's "← Back to the
  game" reuses `.chrome-header .newtab`, which the header cleanup deleted — axe flagged
  the unstyled blue link on both dark skins; the rule is restored with a comment.
- Green: `tests/game-frame.spec.ts` 10/10 both engines; `npm run smoke` 45/45; typecheck,
  lint, hex scan. **Not done:** the Samsung check under Validation — no device session in
  this run; recorded as owed, to be done with Phase 5a's device check.

### Phase 1 — executed 2026-08-30 (1a `99dba07`, 1b this landing)
- 1a: `src/game-frame.ts` + `.gf-*` block + `tests/game-frame.test.ts` (17 cases, RED
  first: module absent → suite fails; then green). Lint, typecheck, hex scan green.
- 1b: `/placeholder/` mounts through the frame; `tests/game-frame.spec.ts` RED first (6
  failures, no frame on the page) then green on both engines: game bar **48**, meters
  **56**, dock **72** to the pixel at 390×844; pressing the one verb moves the stage by
  **0px**. `npm run smoke` found the one thing the unit tests could not: the primary verb
  used `--accent` as TEXT (2.44:1 on white, the exact trap `docs/DESIGN.md` records) —
  changed to `--active`, the graded pair; the a11y matrix is green again.
- Measured on the landed page at 390 (WebKit): header 0/110 (Phase 2 fixes it), game bar
  134/48, meters 182/56, stage 238/118, dock 356/72 — the stage is short because
  `.play-area` is not yet full-height; Phase 2 makes the frame fill the viewport.
- Docs landed in-phase: BUILDING-GAMES §4 rewritten + §4c added; DESIGN "The game frame's
  roles"; RESPONSIVE-DESIGN Principle 1b + a lessons-log entry; ADR-0002; CLAUDE.md
  pointer; CHANGELOG `shelf:` entry.

### Phase 0 — executed 2026-08-30
- D1–D4 run (findings under Phase 0). No assumption was invalidated; two were sharpened:
  Phase 22 uses a feature-detect rather than a rejection handler (D1), and Phases 16/17/18
  carry a re-measure step (D3). D4 gave Phase 6 its expected red value (24.8px on WebKit).

### Pass 3: Quality Gates — 2026-08-30
**TDD ordering:**
- Every phase already led with RED items; Pass 3 sharpened them into **named cases**
  with boundaries instead of single points: five-vs-six verbs and zero verbs (1a);
  header ≤ 64 **and** > 64 on the pre-change build (2a); 899 vs 1000 at the breakpoint,
  dialog semantics, one sheet at a time (3a); mirror measured in **both** shapes (3b);
  `v` 0/1/2/"1", the 23:59:59.999 / 00:00:00.000 daily edge, free records never expire,
  newest wins (4); poster / Play / reload / New game / `?r=` / finished / storage denied
  (5a); store-beats-recency and stale-key-ignored (5b); the sampler's zero-frame throw
  and the 1px boundary, six stability triggers, resume at 0 / finished / mid-thinking
  (6); the four fullscreen cases incl. Esc (22).
- Two "watch it fail" steps added where a green-on-day-one test would prove nothing: the
  header test against the unchanged build (2a) and every stability spec against the
  unmigrated page with the movement recorded (6, 7–21 recipe).
- Wiring tests now carry `@smoke` so `npm run smoke` runs them; every verification is
  wrapped in `bash tools/check.sh` (the repo's unpiped-verification rule).
- Phases 1, 3, 5 split as Pass 2 proposed (1a/1b, 3a/3b, 5a/5b), and Phase 2 too
  (2a/2b — eight files, and the `<title>` work is independent). Phase 6 deliberately
  **not** split: the archetype's recipe is what 7–21 copy. 1a's wiring test is the
  exported `renderGameFrame` (no product entry point exists before 1b) — recorded as such,
  with 1b required to follow on the same branch.
- Phase 4's write-set gains `src/games/placeholder.ts`: its `snapshot()` was named in
  Phase 4's wiring test and its "move" in Phase 5's spec, but no phase gave it either.
- `resolveProgress` returns a tagged result with a `reason`, so the rejection reason is a
  tested value that the log line prints — not an untested string.
**Observability:**
- The repo's one convention is `console.debug("[<game>] mount seed=…")` at mount, nothing
  at warn/error. The frame and the store follow it: `[frame] mount`, `[frame] sheet=…
  open`, `[frame] start=poster|continue|record …`, `[progress] <id> rejected: <reason>`,
  `[frame] fullscreen rejected: …`. Fail-loud stays where it belongs — the six-verb and
  meter-count-change throws name the game and the offending list.
**Debugging readiness:**
- A **Checkpoint** line per phase and sub-phase: the `check.sh` command, the commit
  subject (`scope: sentence`), what is attached to the Review Log (a screenshot, a
  measured number, an exit code). The 7–21 recipe adds "red at end of day is reverted,
  not left half-migrated" — the frame renders an unmigrated game as-is, so there is no
  half state worth keeping.
**Validation calibration:**
- 5a's verification raised from its own spec to the **full `npm run e2e`** — it is the
  phase that changes what every URL shows. 7–21 lowered from Phase 6's broad to
  moderate, except Cribbage and Loose Ends (back to broad). Phase 22's gate named
  (`npm run gate`) with exit code and counts recorded, not "green".
- Phase 0: **D5 resolved during planning** (read-only: `build.mjs` L17 hard-codes
  `GAME_PAGES`, imports `tools/skin-init.mjs`'s text-parse precedent; `TODO/README.md`
  prescribes the mechanism) — struck from Phase 0, executed as Phase 2b with a parser
  test that also pins `GAME_PAGES` to `REGISTRY` for the first time. D1–D4 kept, each
  with a note on what its record must contain (an error string, a width, a per-game
  table, per-run frame counts). Dispositions all declared (Pass 2 had them).
**Concurrency honesty:**
- Map confirmed after the splits: sequential. 5a ‖ 5b is the one disjoint pair
  (dependency, not write-set, keeps it sequential) — flagged. Two shared-state facts
  added: :4180 with `reuseExistingServer: false` serialises every browser verification
  across worktrees; `guide:shots` writes every game's JPEGs unless filtered.
**Discovery (if Phase 0 exists):**
- Reviewed above under Validation calibration. Nothing was executed.
**Coherence:**
- The plan still solves the measured problem (110px header, moving boards, no front door,
  no progress). One gap surfaced that Passes 1–2 did not see because it is a **test-suite
  consequence of rule 5**: 299 + 50 navigations and the a11y matrix land on bare or
  parameterised URLs and expect a board — **Q7**, gating 5a, with a recommendation.
  Q8 (clear a rejected record?) is ADVISORY. Phase 6's Pass-2 risk (unit tests reading
  DOM classes) checked and **retired**; the real reader (`tools/guide-shots.mjs`, 22
  click selectors) added to every migration's write-set. 5b records `noteOpened` stays
  at land as a decision with its reason.
- Project conventions checked: `scope: sentence` subjects in every checkpoint; changelog
  entry per landing plus the `Contexts:` line (workspace check 40) per new game context;
  `tokens.css`-only hex (1a's Done-when names `tests/tokens.test.ts`); shots regenerated
  per game with the filter the tool supports; `resolveBool` reused not re-tested; the
  sheet mirrors the drawer's dialog/focus/ESC tests instead of a second pattern.
**Documentation impact:**
- Every doc has a phase item; none deferred. Phase 22 checked: `STATE-OF-PLAY` and
  `mocks/README` are closing records, not deferred work. Added `tools/guide-shots.mjs`
  (the guide's pictures) to the impact list and the recipe. `TODO/README.md`'s line
  corrected to the D5 answer. Placeholder art (`splash.jpg`, `icon.jpg`) added in 5a so
  `tests/art.test.ts` holds in both directions.
**Confirmed ready:** **Phases 0–4: yes.** **Phase 5a onward: no until the owner confirms
Q7's severity and answer** (recommended: parameterised URLs are deep links). Q8 is
advisory. No BLOCKING items. Q1–Q6 unchanged, confirmed by the owner 2026-08-30.

- 2026-08-30 — owner confirmed all six open-question severities as recommended (4 PHASE-GATED, 2 ADVISORY); none BLOCKING.

### Pass 2: Gap Analysis — 2026-08-30
**Found:**
- The Pass-1 draft's "Phase 0 — lock the failure" mixed discovery with RED tests; under
  the skill, RED tests belong to the phase that turns them green. The header test moved to
  Phase 2, the stability tests to each game's phase (6–21); Phase 0 is discovery only.
- Mounting the frame from `chrome.ts` for every game (rather than per game) was implicit;
  now explicit in Approach, Reasoning and Phase 2, with the degraded no-spec state defined.
- `ui-state.ts` keys open panels on `<details>` by class; the frame's sheets are not
  `<details>` and live outside the game's `replaceChildren`, so nothing new is needed —
  recorded under Reasoning (rejected: `data-ui-key`).
- Games that size themselves against `.play-area` (Align, Loose Ends) sit one level deeper
  after Phase 2 — added to Phase 2 Risks with `npm run smoke` as the check.
- `tests/othello-tutor.test.ts` / `othello-harness.test.ts` read DOM classes Phase 6
  deletes — added to Phase 6 Risks.
- Phases 1, 3 and 5 each touch four+ source files — split points named inline (1a/1b,
  3a/3b, 5a/5b) for Pass 3 to confirm.
- The three new music tracks in `~/Downloads/new/` are not in the library; recorded as a
  side landing, deliberately outside this plan's phases.
**Concurrency:**
- Map confirmed: all sequential; `styles.css` and `CHANGELOG.md` in every write-set. The
  missed-parallelism candidate (per-game CSS files) is Q4, not restructured.
**Changed:**
- Phases renumbered 0–22; Documentation Impact redistributed into the phases that make
  each doc stale (the Pass-1 "Phase 6 docs pass" is dissolved; Phase 22 keeps only the
  closing sweep). Open questions tagged with recommended severities.
**Confirmed:**
- The six rules, the spec shape, the store shape, D1–D5 as decided; the plan still solves
  the measured problem at the top.

### Pass 1 — 2026-08-30
- Drafted from the survey (`mocks/d-game-frame.html` carries the diagnosis and the
  control inventory) and the owner's replies; D1–D3 (build the store; poster then continue
  card; phone and desktop together) and then D4 (controls on the left) and D5 (real full
  screen; approach C rejected) recorded; assumptions verified as listed.
