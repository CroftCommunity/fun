# Plan — the Game Frame: one structure for every game page, and a progress store

**Status:** Pass 1 + Pass 2 COMPLETE (2026-08-30); Pass 3 (quality gates, fresh context)
pending; open questions awaiting the owner's severity confirmation. No phase started. Mocks
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
- `TODO/README.md` — the slug-`<title>` item closes in **Phase 2** (the game bar knows the
  title; the `build.mjs` mechanism is D5's answer).
- `CHANGELOG.md` — one `shelf:` entry per shelf phase, one `<game>:` entry per migration.
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

## Phases

### Phase 0: Discovery

**Goal:** Resolve the five unknowns that later phases lean on, before sizing them.

- [ ] **D1: Does the Fullscreen API work under Playwright, and what does `mobile-webkit`
  do with it?**
  - **Probe:** a throwaway spec calling `document.documentElement.requestFullscreen()` from
    a click handler on `/placeholder/`, in both projects; record `document.fullscreenElement`
    and any thrown error.
  - **Success criteria:** chromium enters fullscreen (or the test can `page.evaluate` a
    fake, recorded either way); webkit's behaviour recorded — it is expected to reject, and
    Phase 22 designs the fallback from the recorded error, not a guess.
  - **Disposition:** `throwaway`.
- [ ] **D2: Does a 900px breakpoint hold the rail and a 520px board at 1000×680 with real
  fonts?** — the mock is CSS, the app has `styles.css`'s type scale.
  - **Probe:** mount the placeholder in a static HTML copy of the frame's bands with the
    app's `tokens.css` + `styles.css`, screenshot at 1000×680 and 900×600.
  - **Success criteria:** no rail overflow, board ≥ 480px at 1000×680; a number for the
    minimum width at which the rail must fold back into the dock.
  - **Disposition:** `keep-as-fixture` — the screenshots go into the plan's Review Log.
- [ ] **D3: What does the frame's stage height budget do to the tallest phone boards?**
  - **Probe:** compute per game the board's rendered height at 390 wide via `boundingBox`
    on the existing pages; compare with 612px.
  - **Success criteria:** every board ≤ 612px, or a list of games that need the meter row
    to collapse (Bubble's aim bar and Wyrdle's keyboard are the candidates).
  - **Disposition:** `keep-as-fixture` (a table in the Review Log).
- [ ] **D4: Can Othello's "thinking" beat be caught by a rAF sampler in a test, so the
  stability spec is not flaky?**
  - **Probe:** on `main`, inject a `requestAnimationFrame` sampler recording
    `min/max` of `.othello-board`'s `top` from before the human's click until
    `waitHumanOrOver`; run 10× in both projects.
  - **Success criteria:** the sampler sees ≥ 1 frame during the engine's move at Medium
    (no `?fast=1`) in 10/10 runs — then the spec is sound; otherwise the spec asserts on
    the DOM mutation (`.drop4-thinking`-style) instead of geometry.
  - **Disposition:** `promote` → the sampler becomes `tests/helpers/board-top.ts` in
    Phase 6, under TDD there.
- [ ] **D5: Can `build.mjs` (plain Node, no TS) read each game's `displayName` for the
  page `<title>`?**
  - **Probe:** check how `build.mjs` already enumerates the registry for its 19 pages
    (L250–260) and whether a JSON export of titles exists or is cheap.
  - **Success criteria:** a one-line mechanism named, or "needs a generated
    `registry.json`" recorded.
  - **Disposition:** `throwaway`.

**Done when:** D1–D5 recorded in Verified Assumptions with evidence; Phases 1, 3, 6, 22
adjusted if any answer differs from the assumption they carry.

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
check before deleting any.
**Done when:** (behavioral) Othello on a phone: the board's top edge is unchanged from move
1 through the engine's reply, a hint, a tutor toggle and the settings sheet; (verification)
`npx playwright test tests/othello.spec.ts` both projects.
**Validation:** broad for the first migration — tests + both phones, one full game each.

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

## Open Questions

1. [RECOMMENDED: PHASE-GATED (Phase 22)] **What should ⤢ do on iOS Safari, which grants
   no page fullscreen?** *Recommendation: the toast + a link to the PWA install (standalone
   display is the honest equivalent). Needs D1's recorded behaviour and the owner's OK on
   the copy.*
2. [RECOMMENDED: PHASE-GATED (Phase 3)] **Is there a height breakpoint too — a short
   landscape phone where the rail should fold back to the dock, or the meter row
   collapse?** *D3 will produce the number; the decision is whether to design for
   landscape phones at all in this pass.*
3. [RECOMMENDED: PHASE-GATED (Phase 6)] **Where does the AI's banter (`*-ai-say`) go — a
   bubble anchored to the opponent's seat, or a stage toast like every other transient?**
   *Recommendation: a seat-anchored bubble in the rail, a stage toast on the phone; both
   satisfy rule 1. The persona work (`docs/AI-PLAYERS.md`) cares about this.*
4. [RECOMMENDED: ADVISORY] **Split `styles.css` into per-game files so Phases 7–21 can run
   in parallel worktrees?** *It would cut wall-clock substantially, but it changes the
   repo's one-stylesheet convention and `tests/tokens.test.ts`'s hex scan; recommend no
   for this pass — sequential migrations are a day each.*
5. [RECOMMENDED: ADVISORY] **Desktop poster art: keep the portrait splash as a left panel
   (row 1 as drawn) or commission landscape for the fourteen games without one?** *Either
   is fine for the frame; it changes only `renderStart`'s CSS.*
6. [RECOMMENDED: PHASE-GATED (Phase 4)] **Should the store keep `finished` records (so the
   card can say "Won yesterday · play again"), or only in-progress ones?**
   *Recommendation: keep `finished` until the next daily rollover, then drop — it costs
   nothing and makes the home page's Today strip honest.*

## Review Log

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
