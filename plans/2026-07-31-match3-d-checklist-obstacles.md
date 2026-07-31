# Match-3 parity — Track D completion: the Checklist objective + obstacle families

**Status:** planning (2026-07-31). Parent: `plans/2026-07-30-match3-parity-roadmap.md`
(Track D — parity completeness). Sibling: `plans/2026-07-31-match3-d-ingredients.md`
(the mode template this copies). Owner-confirmed 2026-07-31, with three design forks
resolved by the owner (see Decisions). This plan closes Track D: the last remaining
*objective* (order/mixed checklist) plus the *obstacle families* (meringue + licorice),
then records the deliberate out-of-scope boundary (timed / spreading-chocolate / meta).

## Problem Statement

Track D is "parity completeness, surfaced honestly." Two buckets remain:

1. **A fifth objective — the order/mixed CHECKLIST.** Candy-Crush's Order/Mixed mode
   gives a *heterogeneous checklist* of goals ("clear 15 red, make 2 striped candies,
   make 1 wrapped"), shown as a HUD tally, won when every item is ticked. It is the one
   remaining objective that adds a genuinely **distinct way to play**: you steer toward
   specific outcomes rather than maximising score or clearing a fixed board state.
2. **Obstacle families — meringue + licorice.** Two more obstacle tiles beyond the plain
   blocker: **meringue** (a durable multi-hit obstacle) and **licorice** (a single-hit
   one), delivered as *distinct, mechanically-separate tiles* in their own objective.

Everything must stay the shelf's non-negotiables: deterministic, re-verifiable, winnable-
daily, tap-first/accessible, and leave every existing mode + game green.

## Positioning

A generic of the Candy-Crush mechanic set (roadmap "Positioning"). The behaviours mirror
the reference; only branding differs. Where the reference does not prescribe an internal
representation, the engineering fork is surfaced and decided on merit — done below via the
owner-answered fork.

## Decisions (owner-answered forks, 2026-07-31)

The checklist's genuine design decisions were surfaced to the owner before build:

- **D-C1 — checklist category set = MIXED: clear a colour + make striped + make wrapped.**
  The canonical Candy-Crush mixed order and the most *distinct* play (hunt a colour AND
  build specials). Chosen over "specials-creation only" (colour-bomb creation is rare →
  fewer winnable seeds) and "colour-orders only" (plays closest to target-score). This
  needs **two new neutral per-step `StepReport` signals** — per-colour gems cleared and
  specials created — mirroring how `ingredients_collected` was added for Track D.
- **D-C2 — target generation = seed template + solver filter.** Each seed's target list is
  a fixed template scaled/coloured from the seed (target colour drawn from the seed; counts
  are tunable constants); the pack generator keeps only seeds the solver completes within
  budget. This is the **exact** existing winnable-daily-pack shape (pack = winnable seeds +
  one fixture), not a new per-seed-targets pack shape.
- **D-O1 — obstacles = meringue AND licorice as distinct, mechanically-separate tiles.**
  Chosen over "meringue enriches blockers / licorice = the existing blocker" and "skip".
  Realized as a **blocker-flavour overlay** (`Obstacle::{Licorice, Meringue}`, `None` =
  plain blocker), so the two are distinct tile kinds (own hash tags, own rendering, own
  deal) while both reuse the *proven* adjacency-clear blocker mechanic. Meringue is the
  genuinely-new-in-play piece: a **multi-layer** obstacle (2–3 layers) — the first time the
  layered-blocker code path (built in P1, only ever exercised by vectors) ships in a daily.
  They live in a **new `Mode::Obstacles`** ("clear the obstacles") so the existing clear-
  blockers mode stays byte-identical.

## Reasoning

- **Reuse the proven mode template** (blockers/jelly/ingredients): core state + rules +
  vectors → a `match3-solver` finder + committed winnable pack → a mode-aware binding
  (`Mode` variant + a distinct `pond-outcome` `kind`) → UI toggle + HUD + how-to + e2e.
  Do not invent a second pattern.
- **The checklist win is path-accumulated, not board-state.** Unlike blockers/jelly/
  ingredients (win = a function of the *current* board), a checklist is met by what has
  happened *across the run* (colours cleared, specials made). So the win check lives in
  **session/solver state**, fed by a `ChecklistProgress` accumulator that reads each
  `MoveReport`. The accumulator + the seed→targets template live in **`match3-core`** so
  the binding, the solver, and outcome replay all agree bit-for-bit.
- **The solver needs a progress-carrying DFS.** The shared `search` memoizes on
  `state_hash` and reads `won(&Game)` — correct only when the win is board-state.
  `find_checklist` carries `ChecklistProgress` through the DFS and memoizes on
  `(state_hash, progress)` (progress is monotone + small, so the state space stays bounded);
  move-ordering prefers moves that advance the checklist, then score.
- **Obstacles reuse the blocker machinery wholesale.** Licorice + meringue are
  `Cell::Blocker(layers)` carrying an obstacle-flavour marker, so `is_blocker()`,
  `blockers_remaining`, gravity (fixed shelves), `find_clear`-style search, and the
  adjacency-clear (T2) all *already* apply. The overlay only adds: rendering identity
  (stable even as meringue loses layers), the deal composition, and the hash section.
- **Additive hashing → no vector re-locks.** Both new signals are off the hashed path
  (`StepReport` is not hashed; it is a per-move report). The obstacle overlay appends a
  section to `state_hash` **only when a cell carries it**, after the special section — so
  every pre-obstacle board (all existing vectors, all other modes) hashes unchanged.

## Verified Assumptions

- `StepReport` is a runtime report, **not** serialized in golden vectors — the vector
  harness reads only `cleared` + `score_gained` from step 0 (`vectors.rs::replay`). So new
  `StepReport` fields re-lock nothing; only the one construction site in `resolve_move`
  and any test constructing a `StepReport` change. Confirmed by reading `vectors.rs`.
  Precedent: `ingredients_collected` was added the same way with no vector churn.
- The checklist uses a **normal gem deal** (`deal`) — no new `Cell`, unlike ingredients.
  Confirmed: the categories are clear-colour / make-striped / make-wrapped, all of which
  the plain gem engine already produces.
- `Cell::Blocker(u8)` already models multi-layer; `from_rows`/`to_rows` already encode
  layers as `A`–`Z`; T2 decrements exactly one layer per adjacent-match step; the hash
  encodes `Blocker(l) -> 0x02, l(u8)`. So meringue needs **no** new clearing/gravity/hash-
  tag work — only the flavour overlay + deal + render. Confirmed by reading `board.rs`,
  `engine.rs` (T2/T3), `hash.rs`/RULES.md.
- The binding plays moves via `play_swap`/`play_swap_traced` → `game.play_move`, discarding
  the `MoveReport`. For the checklist, capture that report and fold it into a session
  accumulator (only when `Mode::Checklist`). Confirmed by reading `match3-wasm/src/lib.rs`.
- The hash appends jelly then special sections, each only when present. An obstacle
  section appended after them (only when present) leaves jelly-only / special-only /
  gem-only boards unaffected. Confirmed by reading `hash.rs` + RULES "State hash".

## Documentation Impact

- `RULES.md` — a **T6 — Checklist** section (the mixed order: categories, the seed→targets
  template, path-accumulated win, the two neutral `StepReport` signals) and a **T7 —
  Obstacle families** section (licorice/meringue as flavoured blockers, the deal, the hash
  `o\x00` section + obstacle tags). Board model: note the obstacle flavour.
- `crates/match3-core/vectors/*` + README — a checklist vector (colour + specials tally)
  and an obstacles vector (meringue multi-hit + licorice single-hit).
- `docs/BUILDING-GAMES.md` — note the first *path-accumulated* objective if it generalizes.
- `TODO/match3.md` + roadmap Track D — tick the checklist + obstacle families **and record
  timed / spreading-chocolate / meta as deliberately out of scope, with reasons**.
- `src/games/match3-howto.ts` — the guide currently says "four objectives"; the checklist
  makes it five (plus the obstacles mode). Update the lede + objectives step.

## Phases

Each phase ships green (full gate) + commit + push (auto-deploys), reported. The two
deliverables are built in sequence: **Checklist (Phases 1–4)**, then **Obstacles
(Phases 5–8)**, then **Phase 9** (Track-D closeout: ticks + out-of-scope record).

### Phase 1 (checklist core) — targets template, progress accumulator, StepReport signals — DONE
- [x] `engine.rs` `StepReport` — add `gems_cleared_by_color: Vec<u32>` (per-colour gems
  truly cleared this step, excluding creation survivors) + `striped_created` /
  `wrapped_created` (`u32`). Populate in `resolve_move` (count colours over `activated`
  pre-clear minus `creations`; count creations by kind). No hash change.
- [ ] `lib.rs` `checklist_mode` constants (WIDTH/HEIGHT/COLORS=8/8/6, MOVE_BUDGET=30,
  COLOR_TARGET/STRIPED_TARGET/WRAPPED_TARGET tunable knobs).
- [x] new `checklist` module — `ChecklistTargets { color, color_count, striped, wrapped }`,
  `checklist_targets(seed, colors)` (colour from a seeded stream, counts from the
  constants), `ChecklistProgress { color_cleared, striped_made, wrapped_made }` with
  `apply(&mut self, &MoveReport, target_color)` and `met(&self, &ChecklistTargets)`.
- [x] `lib.rs` `checklist_mode` constants + module registration + re-exports.
- [x] `RULES.md` — T6 (checklist) + the two StepReport signals.
- [x] tests: per-colour tally sums to the cleared gem count; a line-4 bumps
  `striped_created` + tallies the colour; an L/T bumps `wrapped_created`; `apply`
  accumulates across steps and counts only the target colour; `met` ticks only when all
  three targets are reached.
- **No golden vector:** the checklist plays plain gems and its signals are off-hash report
  fields, so it adds nothing to `state_hash` — the existing corpus already locks the
  mechanics. (Deviation from the Pass-1 "vector 25" note; recorded in the Review Log.)

### Phase 2 (checklist solver + pack) — `find_checklist` + winnable-daily pack — DONE
- [x] `match3-solver` — `find_checklist(seed, node_budget)` (a progress-carrying DFS:
  memoize on `(state_hash, clamped progress)`, order by checklist-progress then score, `won`
  = `progress.met(targets)`); `generate_checklist_pack`; `checklist_pack_to_doc` (kind
  `match3-checklist-pack`). Committed `games/match3/checklist-pack.json` (365 seeds, fixture
  seed 3 / 2-move line) + the byte-identical regen drill (`#[ignore]`) + well-formed/
  spotcheck tests. Knobs 12/2/1 in budget 30 = 40/40 winnable in the probe (specials are the
  gating goal); pack generated in 0.55s (release).

### Phase 3 (checklist binding) — `Mode::Checklist` + outcome + board_view tallies — DONE
- [x] `match3-wasm` — `Mode::Checklist`; `new_checklist_game`; `Session` carries
  `checklist_targets` + a running `checklist_progress` folded in `play_swap` /
  `play_swap_traced` on a legal move; `won()` = `progress.met(targets)`; `board_view`
  exposes the target colour + the three (progress, target) pairs; `Match3Checklist`
  outcome (`match3-checklist`, replay re-accumulates progress); `outcome_json` arm.
- [x] `match3-wasm.ts` (`Mode` union, BoardView checklist fields, `newChecklistGame`),
  `match3-outcome.ts` (`CHECKLIST_KIND` + `verifyRecord` branch + verifier method).
- [x] a checklist verify-orchestration unit test (real wasm, seed-3 fixture): a completed
  checklist grades a verifiable `Won`, a tampered swap list is rejected.

### Phase 4 (checklist UI + how-to + e2e) — toggle, tally HUD, ?mode, shots — DONE
- [x] `match3.ts` — an "Orders" objective toggle, a **tally HUD** (the target colour's
  shape glyph + `n/target`, striped + `n/target`, wrapped + `n/target`, each ticked ✓ when
  met — non-colour cues), `?mode=checklist`, the `startGame` branch + `PACK_URL` +
  `packSeed`; a checklist result headline; `build.mjs` serves the pack; `styles.css`
  `.m3-checklist-hud`/`.m3-goal` + **`flex-wrap` on `.m3-objectives`** (the 5th button
  overflowed 360px otherwise).
- [x] `match3-howto.ts` — five objectives (lede + goal prose + objectives step + note).
- [x] `tests/match3.spec.ts` — the tally HUD + a verifiable win via the seed-3 fixture
  (both projects incl. axe) + the narrow-phone overflow sweep extended to checklist.
- [x] Guide shots regenerated for the new 5-button toggle (`match3-board`, `match3-select`);
  other games' shots reverted.
- [x] Deploy + live-smoke `?mode=checklist` on fun.croft.ing (standalone Playwright):
  targets colour-3 ×12 / striped ×2 / wrapped ×1; the seed-3 fixture wins (`isWon`), the
  result re-verifies ("Checklist complete in 2 swaps — verifiable"), zero page errors.

### Phase 5 (obstacles core) — flavour overlay, deal, hash section, vector — DONE
- [x] `board.rs` — `Obstacle { Licorice, Meringue }` + a parallel `obstacle` overlay (set
  only on a `Blocker`); `obstacle_at`/`set_obstacle`; `from_rows_with_obstacles` for vectors;
  `Obstacle::tag` (`Licorice 0x01 / Meringue 0x02`).
- [x] `hash.rs` — append `"o\x00" || per-cell obstacle_tag(u8)` only when a blocker is
  flavoured, after the special section. Gem/jelly/special-only boards unchanged (144 core
  tests + all golden vectors stayed green — no re-lock).
- [x] `engine.rs` — `deal_obstacles(seed, w, h, colors, licorice, meringue)`; `clear_cells`
  scrubs the flavour when a blocker clears.
- [x] `lib.rs` `obstacles_mode` (LICORICE=3, MERINGUE=3 @ 2–3 layers, MOVE_BUDGET=30); win =
  `blockers_remaining == 0` (both flavours are blockers — reused).
- [x] `RULES.md` — Board model (obstacle flavour) + T7 + the hash section.
- [x] tests (`tests/obstacles.rs`): meringue multi-hit / licorice single-hit; the deal places
  both with a legal move; the overlay scrubs on clear; no-obstacle board hashes unchanged;
  flavour distinguishes the hash; tags stable. Golden **vector 25** (`obstacle-clear`:
  licorice chipped by an adjacent match, score 50 = 30 gems + 20 layer; meringue untouched;
  locked hash) — the vector harness gained an `obstacle` grid.

### Phase 6 (obstacles solver + pack) — `find_obstacles` + winnable-daily pack — DONE
- [x] `match3-solver` — `find_obstacles` (reuses the board-state `search`, `won` =
  `blockers_remaining==0`, key = blocker layers removed — same as `find_clear`);
  `generate_obstacles_pack`; `obstacles_pack_to_doc` (`match3-obstacles-pack`). Committed
  `games/match3/obstacles-pack.json` (365 seeds, fixture seed 72 / 1-move line) + regen drill
  + well-formed/spotcheck. Probe: 40/40 winnable at 3/3 obstacles in budget 30 (~84ms/seed;
  lines 2–30, meringue's layers making some genuinely long).

### Phase 7 (obstacles binding) — `Mode::Obstacles` + outcome + board_view — DONE
- [x] `match3-wasm` — `Mode::Obstacles`; `new_obstacles_game`; `board_view` obstacle mask
  (per-cell kind `""`/`"licorice"`/`"meringue"` + `obstacle_layers` for meringue pips),
  reusing `blockers_remaining`/`blockers_total` for the counts (obstacles are blockers);
  `Match3Obstacles` outcome (`match3-obstacles`); `outcome_json` arm. TS wrapper
  (`newObstaclesGame` + BoardView fields), `OBSTACLES_KIND` + verify branch. An obstacles
  verify-orchestration unit test (real wasm, seed-72 fixture: a verifiable `Won` + tamper
  reject). Full gate: 144 npm unit + 180 e2e; fmt + clippy clean. UI toggle pending (Phase 8).

### Phase 8 (obstacles UI + how-to + e2e) — toggle, tiles, HUD, ?mode, shots — DONE
- [x] `match3.ts` — an "Obstacles" toggle; licorice + meringue tiles (meringue shows its
  remaining layer count as a non-colour durability cue, with a "N layers left" a11y label);
  an obstacles-left HUD (reusing `clearHud` with the blocker counts); `?mode=obstacles`; the
  pack branch; `styles.css` `.m3-licorice`/`.m3-meringue`; **`build.mjs` serves the pack**
  (the missing copy 404'd the board in e2e until added).
- [x] `match3-howto.ts` — six objectives (lede + goal prose + objectives step + note).
- [x] `tests/match3.spec.ts` — the obstacles HUD (+ axe, both projects) + a verifiable clear
  via the seed-72 fixture + the overflow sweep extended to obstacles.
- [x] Guide shots: `guide:shots` produced no match3 change (the 6-button toggle renders within
  the captured region); unrelated churn reverted.
- [ ] Deploy + live-smoke `?mode=obstacles` — after this push deploys.

### Phase 9 (Track-D closeout) — ticks + the honest out-of-scope boundary
- [ ] `TODO/match3.md` + `plans/2026-07-30-match3-parity-roadmap.md` — tick the checklist
  objective + the obstacle families; mark **Track D complete**.
- [ ] Record **deliberately out of scope, with reasons** (markdown-only, no gate):
  - **timed** — breaks the no-wall-clock verifiable model (a result must be a pure
    function of `(seed, moves)`; wall-clock is not replayable/verifiable).
  - **spreading chocolate / marmalade / locks / timed bombs** — buildable later as more
    obstacle families on the T7 overlay pattern, but not in this closeout.
  - **meta (boosters, lives, level maps, progression)** — contradicts the single-daily-
    board, account-less, server-less shelf (no accounts to hold lives/progression; no
    server to gate boosters). A deliberate boundary, not an omission.

## Open Questions / revisable knobs

- [KNOB] checklist counts (COLOR_TARGET / STRIPED_TARGET / WRAPPED_TARGET) + target-colour
  derivation — tuned at Phase 2 so a healthy seed fraction is winnable in budget 30.
- [KNOB] obstacles deal (LICORICE / MERINGUE counts, MERINGUE layer range) — tuned at
  Phase 6 for winnability.
- [DEFERRED, revisable] finer canon obstacle interactions (a direct special blast
  destroying a licorice outright; spreading/growth) — deferred like "direct blocker-eating
  by a fish" (B4). Meringue/licorice ship as adjacency-cleared flavoured blockers.

## Review Log
### Phase 8 (obstacles UI + how-to + e2e) complete — 2026-07-31
Green: clear-the-obstacles is playable at `?mode=obstacles` with an "Obstacles" toggle,
distinct licorice + meringue tiles (meringue renders its remaining layer count — a
non-colour durability cue + "N layers left" a11y label), an obstacles-left HUD, and a
verifiable-clear result. how-to updated to six objectives. Two e2e (HUD+axe + a seed-72
verifiable win), both projects; overflow sweep extended. **Bug caught by e2e:** the obstacles
pack had no `build.mjs` copy, so the board 404'd — added it; e2e then 184 green. Guide shots
unchanged. 144 npm unit + 184 e2e. Live-smoke pending the deploy.

### Phase 7 (obstacles binding) complete — 2026-07-31
Green + deployed: `Mode::Obstacles` + `new_obstacles_game`; `board_view` exposes a per-cell
obstacle kind + `obstacle_layers` (meringue pips), reusing `blockers_remaining`/
`blockers_total` for the counts (obstacles are blockers, so the win check + HUD counts are
free); `Match3Obstacles` outcome (`match3-obstacles`). TS wrapper + `OBSTACLES_KIND` + verify
branch; a real-wasm unit test round-trips the seed-72 fixture (Won + tamper-reject). 144 npm
unit + 180 e2e; fmt + clippy clean. UI toggle pending (Phase 8), so dormant in the UI.

### Phase 6 (obstacles solver + pack) complete — 2026-07-31
Green: `find_obstacles` reuses the board-state `search` (obstacles are blockers, so the
clear-blockers win check + layers-removed ordering apply directly — meringue's extra layers
just take more matches). `generate_obstacles_pack` + `obstacles_pack_to_doc`
(`match3-obstacles-pack`). Committed `obstacles-pack.json` (365 seeds, fixture seed 72 /
1-move big-cascade line). Probe: 40/40 winnable at 3+3 obstacles in budget 30. 18 solver
tests + regen drill byte-identical; fmt + clippy clean.

### Phase 5 (obstacles core) complete — 2026-07-31
Green: licorice + meringue ship as distinct, mechanically-separate obstacle tiles via a
blocker-flavour overlay (`Obstacle { Licorice, Meringue }`), additive to the hash (`o\x00`
section, only when a blocker is flavoured — after special) so no pre-obstacle vector
re-locked (144 core tests + all golden vectors green). Both clear by the proven adjacency
mechanic; meringue is durable (2–3 layers, the first shipped layered-blocker path in play),
licorice single-hit. `deal_obstacles` places both; `clear_cells` scrubs the flavour when a
blocker clears; `obstacles_mode` (3+3, budget 30) reuses `blockers_remaining` as the win.
Golden vector 25 (`obstacle-clear`) locks the licorice-chip (score 50) + the obstacle hash
section; the vector harness gained an `obstacle` grid. Finer canon interactions (blast
destroys licorice, spreading) deferred + recorded (T7). fmt + clippy clean.

### Phase 4 (checklist UI + how-to + e2e) complete — 2026-07-31
Green: the Orders (checklist) objective is playable at `?mode=checklist` with an "Orders"
toggle + a goal-tally HUD (colour shape-glyph + striped + wrapped, each `n/target` ticked ✓
when met — non-colour cues, `--ink` text so contrast holds). `startGame` fetches the pack;
a checklist result headline ("Checklist complete in N swaps — verifiable"). how-to updated to
five objectives; guide shots regenerated for the 5-button toggle. Two e2e (HUD+axe, a
verifiable seed-3 win) added, both projects. **Overflow fix:** the 5th toggle button
overflowed a 360px phone, so `.m3-objectives` gained `flex-wrap` (both the new sweep and the
pre-existing narrow-phone test caught it). Full gate: 142 npm unit + 180 e2e; earlier Rust
gate unchanged. Live-smoke pending the deploy.

### Phase 3 (checklist binding) complete — 2026-07-31
Green + deployed: the checklist mode is now reachable and verifiable. `Mode::Checklist` +
`new_checklist_game` (plain-gem deal, seed-derived targets); `Session` folds
`checklist_progress` from each legal move's report in `play_swap`/`play_swap_traced`
(no-op for other modes); `won()` = `progress.met(targets)`; `board_view` exposes the
target colour + the three (progress, target) pairs; `Match3Checklist` outcome
(`match3-checklist`, replay re-accumulates progress). TS wrapper (`newChecklistGame` +
BoardView fields), `CHECKLIST_KIND` + verify branch. A real-wasm unit test round-trips the
seed-3 fixture (Won + tamper-reject). Full gate: 137 core + 15 solver + npm 142 unit + 176
e2e; fmt + clippy clean. UI toggle still pending (Phase 4), so the mode is dormant in the UI.

### Phase 2 (checklist solver + pack) complete — 2026-07-31
Green: `find_checklist` is a dedicated progress-carrying DFS (the checklist win is
path-accumulated, so the shared board-state `search` doesn't apply) — memoized on
`(state_hash, clamped progress)`, move-ordered by checklist advance then score.
`generate_checklist_pack` + `checklist_pack_to_doc` (`match3-checklist-pack`) mirror the
other winnable-daily packs. Probe: 40/40 winnable at knobs 12/2/1 in budget 30 (~21ms/seed
debug); committed `checklist-pack.json` (365 seeds, fixture seed 3 / 2-move line) generated
in 0.55s release; regen drill byte-identical. 15 solver tests + fmt + clippy clean.

### Phase 1 (checklist core) complete — 2026-07-31
Green: `StepReport` gained two neutral off-hash signals (`gems_cleared_by_color`,
`striped_created` / `wrapped_created`), populated in `resolve_move` on the pre-clear board
(the truly-cleared gems minus creation survivors; creations counted by kind). A new
`match3_core::checklist` module holds `checklist_targets(seed, colors)` (seed-derived colour
+ tunable count knobs `COLOR_TARGET=12` / `STRIPED_TARGET=2` / `WRAPPED_TARGET=1`) and the
path-accumulating `ChecklistProgress` (`apply` reads the report; `met` checks all goals).
`checklist_mode` constants added. 137 core + 12 solver/wasm tests, fmt + clippy clean. The
mode is dormant until the binding wires it (Phase 3), mirroring how ingredients phase 1
deployed. **Deviation:** no golden vector 25 — the checklist adds no hashed state (plain-gem
deal; off-hash signals), so the existing corpus already anchors the mechanics.

### Pass 1 — 2026-07-31
Plan authored after the owner answered the three surfaced forks (D-C1 mixed categories,
D-C2 seed-template + solver-filter, D-O1 distinct meringue+licorice tiles). The checklist
is the proven mode template plus a **path-accumulated** win (a `ChecklistProgress`
accumulator in core, fed by two new neutral `StepReport` signals, shared by binding +
solver + replay). Obstacles reuse the blocker machinery wholesale via a flavour overlay
(meringue = the multi-layer durable tile, first shipped layered-blocker daily; licorice =
the single-hit tile), additive to the hash so nothing re-locks. Sequenced checklist
(1–4) → obstacles (5–8) → closeout (9), green + commit + push each phase.
