# Plan — the play surface: the board fills the stage, the door opens, one shape for hand controls

**Status:** **DRAFT — Pass 1, 2026-09-04.** Phases 1–3 are BUILT on `claude/play-surface` and
captured as mock F's Proposed frames (`fun@eb509fc`); phases 4–12 wait on decisions Q1–Q11 in
`mocks/f-play-surface.html` and on Passes 2–3 of this plan. **Phases 1–3 LANDED 2026-09-05**
(PR #79, owner: "I like most everything"; the Align and Loose Ends sketches revised to v2 on review).
Review Log at the foot. Plan filename carries no ordinal per `CroftC/.claude/TRACKING.md` § "Plan files".

Branch `claude/play-surface` (from `main@c4db11a`); worktree
`CroftC/worktrees/play-surface/fun`. Mock: `mocks/f-play-surface.html` v1, its captures in
`mocks/snaps/f-play-surface/` (`current.*` from `fun@aafe332`, `proposed.*` from the branch).

## Problem Statement

The game frame (2026-08-30, `plans/2026-08-30-plan-game-frame.md`) gave every game page one
structure — bands of fixed height around a stage the game owns — and stopped the board
moving. It said nothing about what the board does *inside* the stage, and the owner's
2026-09-04 screenshots of nineteen surfaces say what that left (verbatim, condensed): "no
play button, too far off bottom", "small game play board" (Othello, Drop 4, checkers, Dots,
2048, Blockdoku, Color Sort — "teeny tiny"), "so much negative space and it's just blah"
(Wyrdle), "orchard drop, small offcenter", "furrow tiny game play … horizontally oriented when
it would make more sense to be vertically on a phone", "these button controls on align really
need some pick me up", "bubbles looks pretty cheesy", "drop 4 … lackluster gameplay",
"checkers gameplay could use some pick me up", "cribbage … needs more animations and life",
"loose ends … just too easy to start", "change the music for mahjong … not country".

Measured on `main@c4db11a` (the numbers are in the mock's first table):

- **Play is clipped.** The poster's body is a flex child of `.gf-start` (`overflow: hidden`);
  Trio Tumble's nine setup options at 390×844 put Play's bottom at **881px** on an 844px
  frame. Dots and chess clip on a phone too. The game cannot be started from the front door.
- **Boards size from the viewport's width, never the stage.** Every grid's cell is
  `clamp(<floor>, <n>vw, <cap>)`: Othello's caps at 2.6rem, so a **960×796** desktop stage
  holds a **363×363** board (46%). Color Sort's tube is 46px on a desktop — the phone's size.
  Checkers at 390 is 309 of 366px. The stage's *height* was never an input, which is why the
  phone captures are "itty-bitty" under a tall empty stage.
- **The Orchard crate sat at the left edge** (centre 237 in a stage centred at 500). Cause: a
  stray `=======` conflict marker above `.orch-surface` from the 2026-08-30 rebase made the
  selector invalid; the centring rule never applied. The brace-balance test in
  `tests/dead-css.test.ts` could not see a marker with no braces.
- **Two games' hand controls are unbranded stacks.** 2048's d-pad is always shown though
  swipes work; Align has seven buttons in three rows of different widths under a well that
  loses ~150px of height to them.
- **Furrow cannot reflow** (a mancala row that wraps is not a row), so at 390 it scrolls and
  the stores clip; it has no upright layout.
- **The versus boards have one animation between them** (Drop 4's win pop). A capture, a
  king, a flip of four, a closed box, a pegged fifteen-two look like an ordinary move.
- **Loose Ends' curve starts at nothing to read:** `target = 3 + 65·t` gives level 1 three
  arrows on a 5×6; Easy ends at 12.
- **Mahjong names no track** (`src/music.ts` `BY_GAME`), so it plays the shelf's bed;
  Cribbage names the same bed.
- Found on the way: 2048's first-move toast ran from −60 to 450px on a 390px phone
  (`white-space: nowrap`); a board that fills the stage puts the toast over its bottom row.

Constraints: the frame's rule 1 (nothing above the board changes height while you play) and
its band heights stay; a skin restyles and restructures nothing (ADR-0001/0002), so anything
game-shaped here is game-owned; the board tokens stay unskinnable; every 360px rule holds;
`npm run gate` green at every landing; the how-to shots regenerate for any game whose look
changes (project `CLAUDE.md`).

## Approach

Three built-and-captured phases first, because they are the systemic half and each is one
rule with a spec; then the decisions the sketches ask, each its own phase with its own claims.

1. **The door (built).** `.gf-poster .gf-start-body` is the scroller (`max-height: 100%;
   overflow-y: auto`), Play is `position: sticky; bottom: 0` at its foot, and
   `scroll-padding-bottom` lands a focused option above it. One CSS change, every game.
2. **The fill (built).** `.gf-stage { container: stage / size; --room-w: 100cqw;
   --room-h: calc(100cqh - 3rem) }` — the room a board may fill, less a lane for the toast.
   Each grid reads it: `--oth-cell: clamp(1.7rem, calc((min(var(--room-w), var(--room-h)) -
   2.5rem) / 8), 6rem)` and its siblings (checkers, chess, Drop 4 with a width-or-height
   `min`, Dots with `--dots-n` set inline by the module, 2048 and Wyrdle and Blockdoku with
   their control's height reserved, Color Sort's unit on a desktop only, the Orchard crate).
   Floors keep the 360px rules; ceilings keep a disc a disc. The phone media-query overrides
   that pinned cells (2048 ×2, Wyrdle, Blockdoku) are retired — their floors cover them.
3. **Transients (built).** The toast wraps inside the stage; the lane above.
4. **The rest of the fill.** The same rule, one game per commit: Furrow (across — proposal 6
   covers upright), Bubble (its canvas flexes; the tap floor is the check), Align's well,
   cribbage's table, Mahjong's layout, solitaire, Trio Tumble, Loose Ends' HUD; and the
   result screens' small boards (`.othello-final` etc.) stay as they are.
5. **Compact setup rows (Q6).** A `choice` row with ≤3 options renders as a segmented control
   in `settings-sheet.ts`, so chess and Trio Tumble posters fit a phone without scrolling.
6. **A ground per game (Q2).** `GameFrameSpec.ground?: string` → the frame sets
   `--stage-ground` on `.gf-stage`; each game's tint lives in `tokens.css`'s GAME-OWNED region
   (a radial tint of its board colour at 12–22% with a vignette). ADR-0003 records that the
   ground is the game's, not the skin's. Graded for contrast where text sits on it (the toast
   is on `--surface`, so nothing text-shaped sits on the ground today).
7. **One shape for hand controls (Q3, Q4).** A common preference row *On-screen controls:
   Auto / On / Off* (`settings.ts`, Auto = `(pointer: coarse)`); a shared `src/pad.ts` the frame
   renders over the stage in two layouts — d-pad (2048) and split (Align: move left, turn and
   drop right, 64px targets, translucent, haptic on press); 2048 drops its own pad; Align
   drops `.al-touch` and gains tap-to-rotate and swipe-down on the well.
8. **Furrow upright (Q5).** `.furrow-board[data-orient="upright"]`: the rows become columns,
   the stores go top and bottom, your column on the right sowing upward; a preference *Board:
   Auto / Across / Upright*, Auto from the stage's aspect. The core's pit order does not
   change — only the DOM's reading order and the CSS grid.
9. **Beats on the versus boards (Q11).** `src/beats.ts`: WAAPI beats — drop, flips in
   sequence, slide, shrink-out, line pulse, score tick, one word — reduced-motion collapses
   each to its last frame; a voice per beat in the synth under Sound. Drop 4, Othello,
   checkers, chess, Dots, Furrow, cribbage call it from the move the core resolved, the way
   Color Sort's pour does. Each game's board-top sampler test stays green (beats overlay).
10. **Pieces (Q7, Q8).** Bubble: six emoji in glass bubbles (shape distinct per colour — the
    tokens test's pairing is kept), a launcher showing loaded and next, drag-to-aim; chess: a
    `pack` preference (`Classic`, `Bold`), a wooden frame with coordinates outside the
    squares, a shadow, the last-move ring.
11. **Loose Ends' curve (Q10).** `level_config`: `target = 10 + 58·t`, `w = 6 + 12·t`,
    `h = 8 + 18·t`, `min_len = 3 + …`, `max_len = 5 + …`; golden vectors and the solvability
    test re-recorded; the daily config left alone. A second mechanic is a research plan of
    its own, not this one.
12. **Music (Q9).** Two lines in `BY_GAME` once picked; `tests/music*.test.ts` pins them.

## Reasoning

- **Why a size container and not a media query.** The stage's size is what a board can
  use, and it differs from the viewport by the bands, the rail and the padding — a phone's
  stage is 366×572 inside a 390×844 viewport, a desktop's 960×796 inside 1280×900. A `vw`
  rule can never see the height. `cqw`/`cqh` resolve where the variable is *used*, so one
  declaration on the stage gives every board the same room and the toast lane is one
  subtraction. Containment changes nothing above the stage: its size comes from the frame's
  flex/grid, never its content (measured: the band heights test still passes to the pixel).
- **Why a lane rather than moving the toast.** The frame's rule is that transients overlay
  the stage and never move the board; a toast above the board would cover the top row
  instead. Reserving 3rem at the foot keeps the rule and keeps the hint readable.
- **Why sticky Play and not a shorter card.** Sticky is the general fix — any card of any
  height — and lands the same day; compact rows (phase 5) are an improvement on top of it,
  not a substitute, because a future game may have ten options.
- **Why sketches for 4–12.** MOCKS.md P1: a drawing is a sketch while a direction is being
  chosen; the owner asked to "look at some mocks together and figure out a way forward". The
  built half is where a drawing would have added nothing (the rule is the pixels); the drawn
  half is where the decision is the point (which pad layout, which fruit, which curve).
- **Why the ground is game-owned.** ADR-0001 split the vocabulary so a skin restyles chrome
  and never a board; the ground is the room around the board, judged with it, and a skin
  repainting it would re-grade every game. The frame only exposes the hook.
- **Why the beats are one module.** Six versus games and cribbage each doing their own
  animation is the drift the frame was built to end (no two games agreed on their controls;
  no two would agree on their beats). One vocabulary, one reduced-motion policy, one sound
  map.
- **Why the Loose Ends curve moves before any new mechanic.** The genre's own players
  describe the fun as reading a dense knot that resolves in order, with difficulty from
  structure rather than a clock (sources below); level 1 with three arrows has no knot.
  Density is a config change with the generator already solvable-by-construction; a new
  mechanic is core work with its own determinism tests and belongs to its own plan.

Sources for the genre read (2026-09-04): MWM's Arrows Away listing on "reading the flow";
Arroway's design notes on difficulty rising through structure, not speed; Capermint's
breakdown of the genre's differentiators (minimal chrome, a calibrated curve);
plays.org's Tap Away 3D review on the tutorial objects giving way to complex shapes.

## Verified Assumptions

- `container-type: size` on `.gf-stage` does not change the bands: `tests/game-frame.spec.ts`
  "the bands are the reserved heights, to the pixel" passes on both engines after the change.
- cq units in an unregistered custom property resolve on the *using* element against its
  nearest size container — verified by the fill spec (the boards read `--room-h` declared on
  the stage and size to the stage, not the viewport).
- The Color Sort mock's E2.3 (48px tubes at 390) still holds — the phone media queries keep
  mock E's numbers; only the desktop unit grows (`tests/color-sort-mock.spec.ts` green on
  both engines).
- The existing "fits a narrow phone" specs (2048, Wyrdle, Blockdoku, Dots, Othello, checkers,
  chess, Drop 4) pass at 360px — the floors are the old phone sizes.
- The affected games' full specs (Othello, checkers, chess, Drop 4, Dots, 2048, Wyrdle,
  Blockdoku, Color Sort + mock, Orchard, frame, Trio Tumble, a11y matrix) pass on both
  engines: 524/526, the two WebKit failures (color-sort-mock E5.2, E5.3) pass alone and are
  the known load flake (memory: 7-worker gate stalls WebKit navigation).
- Loose Ends `level_config(1)` = `{w: 5, h: 6, target: 3, min_len: 2, max_len: 4}` — read from
  `crates/looseends-core/src/config.rs`, not from the screenshot.
- `BY_GAME` has no `mahjong` entry and `cribbage: "morning-miles"` — read from `src/music.ts`.

## Documentation Impact

- `docs/RESPONSIVE-DESIGN.md`: Principle 1c (a board sizes from the stage) and a lessons-log
  entry for the conflict marker. Done on the branch.
- `CHANGELOG.md`: a `## 2026-09` section with the shelf, orchard, 2048 entries. Done.
- `mocks/README.md`, `mocks/index.html`: mock F listed. Done.
- `docs/BUILDING-GAMES.md` §4b: point at Principle 1c (phase 4, when every game is on it).
- `docs/adr/0003-…`: the ground is game-owned (phase 6).
- `CroftC/.claude/MOCKS.md`: the `--tag current|proposed` shape (both sets from the tool in one
  directory) is worth a line under rule 3 once a second mock uses it.

## Phases

### Phase 1: The door — BUILT
Done-when: F1.1, F1.2 green on both engines. **Executed 2026-09-04** (`e4d36ca`).

### Phase 2: The fill for eight grids, Color Sort, the Orchard crate — BUILT
Done-when: F2.1–F2.4 green; the affected games' specs green; conflict markers refused.
**Executed 2026-09-04** (`e4d36ca`).

### Phase 3: The toast lane and the wrap — BUILT
Done-when: F2.5, F3.1 green. **Executed 2026-09-04** (`4418f19`).

### Phase 4: The rest of the fill (Furrow across, Bubble, Align, cribbage, Mahjong, solitaire, Trio Tumble, Loose Ends HUD)
One game per commit; each adds its row to the F2.1/F2.2 tables with its own surface
selectors. Done-when: every game on the rule, `docs/BUILDING-GAMES.md` §4b updated.

### Phase 5: Compact setup rows (Q6)
### Phase 6: A ground per game (Q2) + ADR-0003
### Phase 7: One shape for hand controls (Q3, Q4) — the preference, `src/pad.ts`, 2048, Align
### Phase 8: Furrow upright (Q5)
### Phase 9: Beats on the versus boards (Q11) — `src/beats.ts`, then one game per commit
### Phase 10: Pieces (Q7, Q8) — Bubble emoji + launcher; chess packs + presence
Q7 DECIDED 2026-09-05: the fruit set. Q8 open — the chess half waits on it.

**Phase 10a — Bubble's fruit (Pass 2, 2026-09-05).** `src/games/bubble/bubble-pieces.ts` is the
table (glyph + name per colour index, in the palette's `--gem-N` order: 🍎 apple, 🫐
blueberries, 🥝 kiwi, 🍇 grapes, 🍊 orange, 🍋 lemon); the canvas draws a glass bubble (tint,
rim, highlight) with the fruit inside, a launcher ring under the loaded piece and a dashed
on-deck ring; the HUD chips show the fruit and name it for a screen reader; the how-to copy
names the fruit and its shots regenerate. Done-when: `tests/bubble-pieces.test.ts` (the table
as data), the wiring test's launcher assertions (`tests/bubble.spec.ts`, structure) green on
both engines; `assets/guide/bubble-*.jpg` regenerated; mock F v4 carries a Shipped capture
of the board beside proposal 8. No core change: colours are indices, and the core never knew
a shape.
### Phase 11: Loose Ends' curve (Q10)
### Phase 12: Music (Q9)
Mahjong → Porch Light Nocturne DECIDED and landed 2026-09-05 (`tests/appearance.test.ts` pins
it). Cribbage's pick still open; the phase closes when it lands.

Phases 5–12 get their Done-when, wiring test and claims in Pass 2, after the decisions.

## Open Questions

Q1–Q11 are in the mock's decisions table with a recommendation each; the plan repeats none.

## Review Log

### Decisions — 2026-09-05 (owner)
- Mock F v2 approved ("I like most everything"); phases 1–3 landed, PR #79, `0b98217`.
- Q7: Bubble's pieces are the **fruit** emoji set. Q9: **Mahjong → Porch Light Nocturne**
  (one line in `BY_GAME`, landed with this entry); Cribbage's track still to pick.

### Pass 1 — 2026-09-04
- Reconstructed: `main@c4db11a`, clean; two peer worktrees (feature-manifest, mocks-handoff)
  on CroftC, none on fun. New worktree `worktrees/play-surface/fun`.
- `tools/mock-snaps.mjs` extended to every game (`all`, `--out`, `--tag`); 80 Current
  captures taken, then pruned to the 26 the mock shows (a full set is 39MB).
- The three systemic defects root-caused and fixed under RED→GREEN
  (`tests/play-surface.spec.ts`, 8 specs × 2 engines); the conflict marker found by the
  Orchard probe and refused by `tests/dead-css.test.ts`.
- Mock F v1 drawn; seven sketches; eleven decisions asked.
- Gate: unit 899 passed; full browser suite 876/877 on both engines — the one red was REAL
  (mobile-webkit, Blockdoku's drag): the wrapped toast at `left: 50%` could only be half the
  stage wide, stacked five lines and covered the tray. Fixed (`eb509fc`: auto-margin
  centring), the affected specs re-run green on both engines, Proposed re-captured. Rust gate
  green (no Rust changed; run anyway).
