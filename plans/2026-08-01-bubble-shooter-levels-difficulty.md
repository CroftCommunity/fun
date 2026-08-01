# Bubble shooter — level tiers, ramping difficulty, descending rows, optional timer (phase plan)

**Status:** 🟢 **APPROVED — executing (owner OK 2026-08-01).** Branch
`claude/bubble-shooter-levels-difficulty-727jfc`. Adds a **leveled, ramping**
bubble-shooter mode on top of today's clear-the-board game: point-gated level
tiers, a classic Puzzle-Bobble **new-row-at-the-top** pressure mechanic, and an
**optional presentational timer** — all while keeping the shelf's verifiable
`(seed, angles)` → `state_hash` outcome intact.

**BS-Q1 resolved (owner, 2026-08-01):** canonical pressure is **shot-driven**
(reach the target before the descending stack crosses the deadline; inserts
trigger on shot/miss count, new rows from the seeded RNG folded into the hash —
so `(seed, angles)` replays exactly). The **timer is a presentational overlay**,
honestly labelled "not part of the verified result." No verified loss is ever
decided by a wall clock.

## Execution log

- **V1 (done, commit `615ba90`):** parity-offset `Board` + `insert_top_row`
  (single-row top insert = shift-down + parity flip; `parity_offset` defaults to 0
  so all prior behaviour/tests unchanged), `aim.rs` short-row indent keys on
  `(r + parity_offset)`. **Deviation:** `state_hash` is *not* changed — parity is a
  pure function of the insert count (from the move list), so replay reconstructs
  the identical board + hashes identical cells; folding it would needlessly change
  clear-board's pinned hashes/version. 5 new board tests; bubble-core/wasm/solver
  green.
- **V2 (done, commit `5b58298`):** `levels_mode` + `LevelGame`/`LevelConfig` —
  arcade scoring (`10·pop + 20·2^(n-1)` capped), per-level target/colours/cadence
  ramp, shot-driven seeded inserts, deadline loss; `BubbleLevels` outcome
  (`bubble-levels` v1, score + star grade). 8 levels tests.
- **V3 (done, commit in V3 batch):** greedy reachability sanity — good play reaches
  level 2 (earns `target_score(1)`) before the deadline across seeds, guarding the
  tuned curve. (Lighter than a clear-board pack — endless survival has no terminal
  win.)
- **V4 (done, commit `54bb087`):** levels wasm session + exports
  (`new_level_game`, `level_board_json`, `level_shoot`, `level_trajectory_json`,
  `level_last_shot_json`, `level_current_hash`, `level_outcome_json`, hint/assist)
  + typed wrapper + `cellCenterOff`. Compiles for wasm32; C-ABI test extended.
- **V5 (done, commit `d8995f0`):** leveled UI — mode toggle (Levels default /
  Classic), level HUD (level, score→target bar, "stack drops in"), parity-aware
  render, insert slide + deadline band, **optional presentational timer**, levels
  result (level + score + stars) + `?r=` re-verify (`verifyLevelRecord`).
  `tests/bubble-levels.spec.ts` (8) + classic `bubble.spec.ts` repointed at
  `?variant=classic`. Chromium e2e green (11 classic + 8 levels).
- **V6 (done):** how-to + guide-shots rewritten for levels/descending-rows/timer;
  BUILDING-GAMES §4 "pressure is move-derived, never wall-clock"; README + TODO +
  rebuild-plan pointer. Full gate below.

## Problem Statement

`/bubble/` today is a single clear-the-board board: aim → shoot → pop/drop,
score `popped + 2*dropped`, win by clearing the board within a 40-shot budget
(`clear_board_mode`), lose when the budget runs out. There is **no progression**
— every board is the same difficulty, points don't add up to anything, and there
is no rising pressure. The owner (2026-08-01) wants the two mechanics that make a
bubble shooter a *game* rather than a sandbox:

1. **Level tiers with a difficulty ramp.** Points must *add up to* levels; each
   level demands a target number of points, and clearing it advances to a harder
   level (more colours, faster pressure, higher target). An **optional timer**
   shows how long you have to reach the level's points target — desired as felt
   pressure, not necessarily a hard rule.
2. **Descending stack / new rows at the top.** As play continues, new rows are
   pushed in at the top (the canonical Puzzle Bobble / Bust-a-Move pressure), the
   stack marches toward a bottom deadline, and you lose when it crosses.

The attached research doc (Puzzle Bobble / Bust-a-Move complete mechanics) is the
reference for row-insertion, matching/dropping, scoring, the descending-ceiling
vs new-row-at-top pressure models, level structure, and the win/lose conditions.
This plan builds the **hybrid** the research names: arcade shooting/matching/
dropping + arcade descending pressure realised as *top-row insertion* (rembound/
Frozen Bubble lineage) + saga-style point-gated levels with star-ish targets.

Goal: `/bubble/` becomes a leveled, escalating bubble shooter that still meets
every `docs/BUILDING-GAMES.md` Tier-1 standard — deterministic Rust core → wasm,
a **verifiable outcome** replayable from `(seed, angles)`, honestly represented.

## Reasoning

### The one hard constraint: pressure must be *shot-driven*, not *time-driven*

The shelf's differentiator is the verifiable outcome: a finished game replays
byte-identically from `(seed, angles)` against the `state_hash`
(`bubble-core/RULES.md`, `CLAUDE.md` "Tier 1"). Every state transition therefore
has to be a deterministic function of the seed and the recorded moves.

- **Row insertion is fine** — trigger it on the **shot count** (or the running
  miss count), both pure functions of the recorded angle list, and fill each new
  row from the **seeded `DetRng` stream** (draws folded into the hash, exactly as
  the deal is). Replay reproduces every insert. ✅ deterministic + verifiable.
- **A wall-clock timer is *not* verifiable.** Real elapsed time can't be
  reproduced from `(seed, angles)`, and any client-asserted timestamp is
  forgeable — so a *time-out loss* cannot be a verified outcome without abandoning
  the replay guarantee (and BUILDING-GAMES §9's "no faked verifiable outcome").
  **Resolution (recommended, see BS-Q1):** the **canonical, verified** pressure is
  shot-driven (reach the target before the descending stack crosses the deadline);
  the **timer is an optional, presentational challenge overlay** — it displays a
  countdown and adds urgency, but running out of clock is a *personal* fail, not
  part of the shared/verified record. This honours the owner's "optional timer …
  is desired" while keeping the outcome honest. The verified record certifies
  *what you did* (level reached, score, replayable), never *how fast a clock ran*.

### Additive new mode, not a rewrite

Today's `clear_board_mode` + its winnable-daily pack + its v3 outcome are a
complete, shipped, verifiable game. Rather than mutate it, add a **second mode**,
`levels_mode`, with its own wrapper and its own `pond_outcome::Game` impl
(`KIND = "bubble-levels"`). `/bubble/` gains a mode toggle (Levels as the new
default experience, Classic = today's clear-board kept intact). This keeps
isolation clean (mostly new files, RED-first), leaves the clear-board pack and
shares valid, and lets the two modes diverge on scoring/objective without
back-compat friction.

### The core change that makes top-row insertion faithful: an explicit parity offset

Today `Board` derives hex parity implicitly from the row index: even rows full
(`width`), odd rows short (`width-1`), and `neighbors()` picks its diagonal
offsets from `r % 2`. Inserting a row at the top shifts every row's index by one,
which would flip every row's full/short classification — an 8-bubble row can't
become a 7-slot row. The fix is the rembound `rowoffset` trick: give `Board` an
explicit **`parity_offset ∈ {0,1}`** and compute parity as `(r + parity_offset)
% 2` everywhere (`row_len`, `index`, `neighbors`, the aim resolver's short-row
half-cell indent, and the hash). Then a single-row top insert is:

> shift all rows down by one **and flip `parity_offset`**.

Flipping the offset exactly cancels the +1 index shift, so every existing
bubble keeps its full/short classification and its geometry — only the new top
row is added, and the content shifted off the bottom deadline row is what
triggers the loss. `parity_offset` defaults to `0`, so **all existing behaviour
and every existing test is unchanged** (verified: current parity == `(r + 0) %
2`). This is the single load-bearing core change; it's well-contained and fully
TDD-able. (A simpler fallback — insert rows *in full+short pairs* so parity never
flips and `Board` needs no new field — is captured as BS-Q2; it's less faithful
on cadence granularity but zero-refactor.)

### Reuse everything below the aim/insert layer

The staggered-hex `Board`, six-neighbour adjacency, the connected-cluster **pop
(≥3)**, the ceiling-connectivity **drop**, the fixed-point `resolve_shot` aim/
landing resolver, the `DetRng` launcher stream, the `pond-outcome` binding, and
the whole wasm C-ABI + canvas UI all carry over. What's new sits *around* them:
a parity-aware board (V1), a level/score/insert wrapper (V2), a reachability
sanity check replacing the clear-pack (V3), levels wasm exports (V4), the leveled
UI + optional timer (V5).

### Scoring that makes targets meaningful

Today's `popped + 2*dropped` yields tiny numbers (a good shot ≈ 3–8). Point-gated
levels want scores that *feel* like points and reward the arcade's soul — big
drops. **Recommended (BS-Q3):** levels-mode scoring = **10 per popped bubble** +
the arcade **dropped series `20·2^(n-1)` capped at n=17 (1,310,720)**, computed in
the wrapper from `ShotReport`'s cell lists (so `engine.rs` and clear-board mode
are untouched). This is the research's arcade-fidelity option and makes "drop a
big cluster" the skill the targets reward. The score is hashed, so levels-mode
gets its own outcome `VERSION` (starts at 1 for the new `KIND`).

## Verified Assumptions

- **`Board` parity is implicit today** (`board.rs`): `row_len(width, r)` and
  `neighbors` key on `r % 2`; there is no offset field. Adding `parity_offset`
  defaulting to `0` preserves `(r + 0) % 2 == r % 2`, so the existing
  `row_len_alternates…`, `interior_*_row_cell_has_six_neighbours`, and corner
  tests hold unchanged. (Read 2026-08-01.)
- **`state_hash` is integer-only** (`hash.rs`, folded from `board.rs`): width,
  height, colors, draws, score, then cells. Folding `parity_offset` (a `u32`) is
  a trivial, native==wasm-safe addition; it changes the hash for a shifted board
  (correct) and bumps outcome versions (deliberate). (Read via RULES.md §"State
  hash" 2026-08-01.)
- **The aim resolver keys on parity for the short-row indent** (`aim.rs`,
  `ROW_H=222`, `DIAM=256`, committed `directions.json`): `cell_center` /
  `resolve_shot` must switch their half-cell x-offset from `r % 2` to
  `(r + parity_offset) % 2`. The fixed-point march itself is unaffected. A V0
  spike confirms landings stay correct after an insert. (Read `aim.rs` surface +
  `geom_json` in `bubble-wasm` 2026-08-01.)
- **`ShotReport` already carries per-cell pop/drop lists** with colours
  (`engine.rs`), so the wrapper can compute arcade scoring (`10*popped`,
  `20·2^(n-1)` drop) **without touching `engine::apply_shot`** (whose `score_gain`
  stays `popped + 2*dropped` for clear-board mode). (Read 2026-08-01.)
- **`pond_outcome::Game` supports two impls in one crate** and a `stars` field on
  `Replayed`/the record (`pond-outcome/src/lib.rs`: `Replayed{final_hash, won,
  score, stars}`, `scored(...)` ctor). Levels mode can surface `stars` = level
  reached bucket, or leave it `None` and put level in the payload. (Read
  2026-08-01.)
- **The repo already has a saga-style objective pattern** to mirror: match-3's
  `checklist.rs` (`ChecklistTargets`/`ChecklistProgress`, seed-derived template,
  path-accumulated, solver-certified) and `target_score_mode`. Levels-mode's
  per-level target + ramp curves follow the same "deterministic template of the
  seed/level, tunable knob constants, solver/reachability-certified" shape. (Read
  2026-08-01.)
- **The wasm binding is single-`static mut` session + JSON-over-out-buffer, never
  panics** (`bubble-wasm/src/lib.rs`); adding levels-mode exports follows the
  existing `board_json`/`shoot`/`outcome_json` pattern. (Read 2026-08-01.)
- **The UI is a self-contained canvas module** (`bubble.ts`) drawing in the core's
  sub-pixel space with a HUD, result screen, `?r=` share, settings, hints; a mode
  toggle + level HUD + insert animation + optional timer slot in without
  restructuring. (Read 2026-08-01.)
- **The row-insertion + miss-counter reference mechanics** (rembound `addBubbles`
  copies each row down then fills row 0 from present colours; a `rowoffset` parity
  flag; "new row after N misses", N≈5 decrementing; lose when a tile enters the
  reserved bottom row) are documented in the attached research and match the
  parity-offset design above. (Rembound's own page 403'd on fetch 2026-08-01; the
  attached research quotes it, and the design is grounded in it — a V0 task
  re-confirms the exact constants against a reachable reference before baking
  them.)

## Documentation Impact

- `crates/bubble-core/RULES.md` — add a **"Parity offset"** note to Board
  geometry (`(r + parity_offset)`), a **"Descending pressure — top-row insertion"**
  section (shift-down + parity flip + seeded new row + deadline loss), a
  **"Levels mode"** section (target curve, ramp, scoring, the shot-driven trigger,
  the timer's presentational-only status), and fold `parity_offset` into the
  state-hash spec. Phases: V1, V2.
- `docs/BUILDING-GAMES.md` — §4 (determinism): add the principle **"pressure and
  progression must be move-derived, never wall-clock; a timer may inform the
  player but never the verified outcome."** Phase: V6.
- `README.md` — rewrite the Bubble line (leveled, descending rows, optional
  timer). `TODO/bubble.md` — mark levels done, add follow-ups (per-level special
  bubbles, two-player transfer, daily-level-challenge). Phase: V6.
- `src/games/bubble/bubble-howto.ts` + `tools/guide-shots.mjs` shots — rewrite the
  how-to for aim-and-shoot **+ levels + descending rows + the optional timer
  toggle**; regenerate `assets/guide/bubble*.jpg` (guide:shots) — `git add` only
  the bubble shots, `git checkout --` the rest (CLAUDE.md guide-shots guard).
  Phase: V6.
- `src/registry.ts` / `src/how-to-registry.ts` — bubble id unchanged; how-to
  content updated. Phase: V6.
- `plans/2026-07-31-bubble-shooter-rebuild.md` — add a "followed by" pointer to
  this plan. Phase: V6.

## Concurrency Map

Sequential spine: **V0 → V1 → V2 → V3 → V4 → V5 → V6.** Each phase reads what the
prior wrote (V1's `parity_offset` board underlies V2's insert wrapper, which V4
exposes and V5 renders). No parallel set — the changes chain through the same few
files. Bubble-owned paths are ours end-to-end: `crates/bubble-{core,solver,wasm}`,
`src/games/bubble/*`, `games/bubble/*`, `tests/bubble*.spec.ts`,
`assets/guide/bubble*`. Shared-file touch surface (merge-time only): `README.md`,
`docs/BUILDING-GAMES.md`, `TODO/bubble.md`, `Cargo.lock`, and (if the mode toggle
needs it) `src/registry.ts` / `src/how-to-registry.ts`. No `git
checkout/stash/rebase` outside the working branch; writes confined to the repo +
scratchpad. Work on `claude/bubble-shooter-levels-difficulty-727jfc`.

## Phases

### Phase V0 — Discovery: parity-offset insertion, timer decision, difficulty curve
**Goal:** de-risk the three real unknowns — the parity-flip insertion geometry,
the timer/verifiability reconciliation, and a difficulty curve that's reachable
and feels right — before building on them.
**Discovery tasks:**
- [ ] **BS-D1: Parity-offset board + single-row insert spike.** Prototype
  `parity_offset` on a scratch `Board` copy and an `insert_top_row` = shift-down +
  flip. **Success:** after an insert, every previously-placed bubble keeps its
  full/short row length and its six-neighbour set; two runs produce an identical
  post-insert `state_hash` (with the offset folded in); a landing resolved by
  `resolve_shot` before vs after an insert stays on a legal empty adjacent cell
  (short-row indent keyed on `(r+offset)`). Disposition: `promote` (becomes V1).
- [ ] **BS-D2: Deadline + shift-off geometry.** Confirm fixed-height shift-down:
  content pushed off the reserved bottom deadline row(s) is exactly the loss
  trigger; no content is dropped silently above the deadline. Decide the deadline
  row count (1 vs 2) and the reserved-row rendering. Disposition: `promote`.
- [ ] **BS-D3: Timer/verifiability reconciliation (owner).** Confirm BS-Q1: the
  canonical pressure is shot-driven; the timer is presentational-only and not a
  verified loss. Pin the row-insert **trigger** (fixed-cadence-every-N-shots vs
  N-misses decrementing) and the **N**. Disposition: decision recorded in Verified
  Assumptions + RULES.md.
- [ ] **BS-D4: Difficulty curve.** Choose `target_score(L)`, `colors(L)` (ramp
  3→8), `insert_cadence(L)` (decreasing), `start_rows(L)`, and (presentational)
  `time_limit(L)`. **Success:** a greedy/`hint_angle`-driven probe shows each of
  the first ~10 levels' targets is *reachable* before forced deadline (targets
  aren't impossible), and the ramp reads as steadily harder. Disposition:
  `promote` (constants → V2 `levels_mode`).
**Done when:** a reproducible parity-offset insert (native==wasm hash), a
recorded timer decision, and a reachable difficulty curve exist. **Discovery
Exemption applies** (spikes may run ahead of tests; promoted code re-enters TDD).
**Validation:** Moderate — reproducibility table + a felt curve probe.

### Phase V1 — core: parity-offset `Board` + `insert_top_row`
**Goal:** the board can carry an explicit parity and accept a deterministic
single-row top insert, with the hash and aim resolver following the offset.
**Changes:**
- [ ] `board.rs` — add `parity_offset: usize` (0/1); route `row_len`, `index`,
  `neighbors` through `(r + parity_offset)`; a `with_parity` ctor + `flip_parity`.
  Default 0 preserves all current behaviour.
- [ ] `engine.rs` — `insert_top_row(board, new_row: &[u8]) -> InsertReport {
  crossed_deadline: bool }`: shift every row down one, flip parity, write the new
  row 0 from `new_row`, report whether occupied content crossed the reserved
  deadline row.
- [ ] `hash.rs` / RULES.md — fold `parity_offset` into `state_hash`; document the
  parity offset + the insertion op.
- [ ] `aim.rs` — switch the short-row half-cell indent in `cell_center` /
  `resolve_shot` from `r % 2` to `(r + parity_offset) % 2`.
**Wiring test (RED first):** `board.rs::insert_preserves_geometry` — after an
insert, a pinned bubble's `row_len` classification and `neighbors` set are
unchanged; `engine.rs::insert_crossing_deadline_reports_loss`.
**Test edges:** offset=0 reproduces every existing neighbour/row_len golden;
offset=1 short row is the *even* rows; a resolved landing after an insert is empty
+ adjacent; two inserts return parity to 0 with identical geometry; hash differs
before/after an insert and is run-stable.
**Depends on:** V0.
**Read-set:** `crates/bubble-core/src/{board,engine,aim,hash,lib}.rs`, RULES.md.
**Write-set:** same.
**Observability:** `insert_top_row` never panics; a malformed new-row length is
clamped/documented, not a panic.
**Done when:** insert preserves geometry + reports deadline crossings; every prior
`bubble-core` test still green; `cargo test -p bubble-core` + fmt + clippy clean.
**Validation:** Narrow — golden + unit over the pure board/insert layer.

### Phase V2 — core: `levels_mode` wrapper + verifiable outcome
**Goal:** the leveled play-loop — score, per-level target, level advance,
shot-driven seeded inserts, deadline loss — with a replayable outcome.
**Changes:**
- [ ] `lib.rs` — `pub mod levels_mode` with the V0 curve constants + pure ramp
  functions (`target_score`, `colors`, `insert_cadence`, `start_rows`,
  `time_limit_secs`), each a deterministic function of `level`.
- [ ] `game.rs` (or new `levels.rs`) — `LevelGame`: board + `DetRng` launcher +
  `level` + `level_score` + `total_score` + `shots_since_insert`. `play(angle)`:
  shoot → arcade score (`10*popped + Σ 20·2^(n-1)` drop, capped) from
  `ShotReport` → advance `shots_since_insert`; when it hits `insert_cadence(level)`
  fire `insert_top_row` with a **seeded** new row (colours from present-on-board,
  arcade rule) and check deadline loss; when `level_score >= target_score(level)`
  advance the level (bump params, reset `level_score`/counter, optional re-seed of
  fresh rows). `is_lost` = deadline crossed. Endless: no terminal "win" — the
  outcome is *level reached + total score*.
- [ ] `impl pond_outcome::Game for BubbleLevels` — `Move = Angle`,
  `KIND = "bubble-levels"`, `VERSION = 1`; `replay(seed, angles)` reproduces
  level/score/hash; `Replayed{ won:false, score:Some(total), stars:Some(level-bucket)}`
  (or level in payload — see BS-Q4).
**Wiring test (RED first):** `levels.rs::reaching_target_advances_level` — a
scripted angle line that earns `target_score(1)` flips `level` to 2 and resets the
per-level counter; `insert_fires_on_cadence`; `deadline_crossing_is_lost`;
`replay_roundtrips` (attest→verify ok, tampered angle diverges).
**Test edges:** a big drop scores the exponential cap; an insert that crosses the
deadline ends the run; level advance re-seeds deterministically; replay of a
multi-level line reproduces the exact final level+score+hash.
**Depends on:** V1.
**Write-set:** `crates/bubble-core/src/{lib,game/levels,hash}.rs`, RULES.md,
`tests/golden.rs`.
**Done when:** a scripted multi-level game attests + re-verifies (tamper fails),
scores by the arcade formula, and inserts/loses on the deadline; `cargo test -p
bubble-core -p pond-outcome` green.
**Validation:** Narrow-to-Moderate — wiring + unit + a golden multi-level line.

### Phase V3 — reachability sanity (replaces the clear-pack for levels mode)
**Goal:** keep level targets *honest* — provably reachable, not a full clear pack.
**Changes:**
- [ ] `crates/bubble-solver` — a `level_reachable(level, seed, budget)` check: a
  budgeted greedy/DFS (reusing `reachable_landings`) that confirms `target_score(L)`
  is achievable from a fresh level-`L` start board within the pre-deadline shot
  window. A generator that walks a seed stream and (optionally) bakes a small
  **daily-level-challenge** seed pack (a nice fixed starting seed per day), or, if
  none is needed, just a test asserting the first ~N levels are reachable.
- [ ] regenerate/emit any baked asset **byte-identically** (regen drill), or add a
  reachability unit test only (no asset).
**Wiring test (RED first):** `solver.rs::early_levels_reachable` — levels 1..N all
pass `level_reachable` within budget; if a pack is baked,
`pack_regen_byte_identical`.
**Depends on:** V1, V2.
**Write-set:** `crates/bubble-solver/**`, maybe `games/bubble/level-pack.json`.
**Observability:** the generator logs scanned/reachable/unreachable per level; an
unreachable target is logged, not silently accepted (targets get retuned).
**Done when:** the first ~N levels certify reachable; any baked pack regenerates
byte-identically; `cargo test -p bubble-solver` green.
**Validation:** Moderate — wiring + reachability sanity (+ regen if a pack ships).

### Phase V4 — bubble-wasm: levels-mode exports
**Goal:** the browser can drive leveled play and read level/insert/timer state.
**Changes:**
- [ ] `bubble-wasm/src/lib.rs` — a levels session variant (or a mode flag on
  `Session`): `new_level_game(seed)`, `level_state_json` (level, levelScore,
  totalScore, target, colors, shotsToInsert, deadlineRow, timeLimitSecs,
  lost), `shoot(angle)` folding the auto-insert + level-advance, `last_shot_json`
  extended with an optional `insertedRow`/`shiftedDown` flag for the animation,
  `outcome_json` → a `bubble-levels` v1 record. Reuse `geom_json` /
  `trajectory_json`. Never panics.
- [ ] `src/games/bubble/bubble-wasm.ts` — typed wrappers: `newLevelGame`,
  `levelState()`, extended `lastShot()`.
**Wiring test (RED first):** native C-ABI test — `new_level_game` →
`level_state_json` parses → `shoot` advances score/level/insert → `outcome_json`
parses to a `bubble-levels` v1 record. (Follows the existing one-`static mut`
single-test rule in `bubble-wasm`.)
**Depends on:** V2, V3.
**Write-set:** `crates/bubble-wasm/src/lib.rs`,
`src/games/bubble/bubble-wasm.ts`, `Cargo.lock`.
**Done when:** `npm run build:wasm` builds; the C-ABI test + `cargo test
--workspace` green; a Node smoke plays a level line and reads a `bubble-levels`
record.
**Validation:** Moderate — wiring + build + smoke.

### Phase V5 — UI: leveled play, descending-row animation, optional timer
**Goal:** `/bubble/` is a leveled, escalating shooter with an optional timer.
**Changes:**
- [ ] `src/games/bubble/bubble.ts` — a **mode toggle** (Levels default / Classic =
  today's clear-board); a **level HUD** (level number, a score→target progress
  bar, "shots until the stack drops," current colours); an **optional timer**
  (settings toggle, off by default; a countdown showing `time_limit(level)`,
  honestly labelled "practice clock — not part of the verified result"; expiring
  is a soft nudge, never a verified loss — per BS-Q1); the **top-row insertion
  animation** (whole stack slides down one row, new row fades in at the ceiling)
  and a **deadline-proximity warning** (the reserved bottom row glows as bubbles
  near it); a **level-up transition**; result screen = highest level + total
  score, verifiable, `?r=` share. Reduced-motion snaps every animation.
- [ ] `tokens.css` / `styles.css` — level HUD, progress bar, timer, deadline glow,
  insert slide.
- [ ] `tests/bubble-levels.spec.ts` — e2e through `/bubble/`: reach a target →
  level advances; fire the cadence-th shot → a row inserts (stack shifts, board
  taller/denser); drive to a deadline crossing → verifiable result + `?r=`
  round-trip; the timer toggle shows/hides the countdown and never changes the
  outcome; the landing-matches-core guardrail still holds; axe both themes; 360px;
  reduced-motion snaps.
**Wiring test (RED first):** e2e — earning the level-1 target advances the HUD to
level 2 (RED until the mode + HUD are wired).
**Depends on:** V4.
**Write-set:** `src/games/bubble/bubble.ts`, `tokens.css`, `styles.css`,
`tests/bubble-levels.spec.ts`.
**Done when:** a stranger opens `/bubble/`, plays leveled mode, watches rows push
in and the stack march down, levels up on hitting targets, optionally races a
timer, and on a deadline crossing sees a verifiable highest-level+score result +
share; Classic mode still works; `npm run test` + `npm run e2e` green.
**Validation:** Broad — e2e + manual play (ramp + insert feel) + axe + 360px +
reduced-motion + landing-matches-core guardrail + share round-trip + timer-is-
cosmetic assertion.

### Phase V6 — how-to, docs, guide shots, gate
**Goal:** leveled bubble is a first-class shelf game; gate green.
**Changes:**
- [ ] `bubble-howto.ts` — rewrite for aim-and-shoot **+ levels + descending rows +
  the optional timer**; `npm run build:wasm && npm run build && npm run
  guide:shots`; `git add` only `assets/guide/bubble*.jpg`, `git checkout --` the
  rest (CLAUDE.md guard).
- [ ] `docs/BUILDING-GAMES.md` §4 principle (move-derived pressure, cosmetic
  timer); `README.md`; `TODO/bubble.md`; the rebuild-plan "followed by" pointer.
- [ ] full gate: `cargo test --workspace` + fmt + clippy; `npm run test` + `npm
  run e2e`.
**Depends on:** V5.
**Done when:** the drawer launches leveled bubble, the how-to shows levels +
descending rows + the timer toggle with fresh shots; full gate green; deploy-ready
(don't push/PR beyond the working branch unless asked).
**Validation:** Broad — full gate + local serve smoke.

## Open Questions

- **[BLOCKING — resolve in V0/BS-D3] BS-Q1 — the timer vs the verifiable outcome.**
  Recommended: **shot-driven canonical pressure + an optional, presentational
  timer** that never decides the verified result (a wall clock can't be replayed
  from `(seed, angles)` and any client time is forgeable, so a time-out loss can't
  be a *verifiable* outcome — BUILDING-GAMES §9 "no faked verifiable outcome").
  The timer is a felt-pressure overlay the player can switch on; the shared record
  certifies level + score, replayable. *If the owner wants time to be a real fail
  condition,* the honest alternative is a **separately-labelled unverified
  time-attack** variant (records elapsed time as a self-declared, non-replay-
  certified stat) — kept visibly distinct from the verified record. Decide before
  V2 fixes the outcome shape.
- **[RECOMMENDED — V0/BS-D3] BS-Q2 — insert trigger + single-row-vs-pair.**
  Recommended: **fixed cadence, every N shots** (simplest deterministic rule; the
  research's `shooter-bubble.com` model) with **single-row insertion via the
  parity offset** (V1). Alternatives: the **decrementing miss-counter** (5→4→3→…,
  bubbleshooter.net, ramps within a level) — also deterministic (miss = a
  non-popping shot, a pure function of the line); and **insert full+short *pairs***
  (no `Board` parity field needed — a zero-refactor fallback if V1 slips, at
  coarser cadence). Pick the trigger + N in V0; the pair fallback is a safety
  valve.
- **[RECOMMENDED — V0/BS-D4] BS-Q3 — scoring model.** Recommended: **arcade
  fidelity** (10/popped + `20·2^(n-1)` capped drop) so targets reward big drops.
  Alternative: **casual** (10/popped, drop = 2× or flat 50, per-level combo
  multiplier, leftover as bonus). Either is wrapper-only; clear-board mode's
  `popped + 2*dropped` is untouched. Decide with the difficulty curve.
- **[RECOMMENDED — V2] BS-Q4 — level in `stars` vs payload; endless vs finite.**
  Recommended: **endless escalating** (no final win; outcome = highest level +
  total score), with `level` in the outcome payload and `stars` optionally a
  coarse level bucket. Alternative: a **finite N-level campaign** with a real
  terminal win (needs a clear-style winnable check per level in V3). Endless
  matches the arcade survival soul and the owner's "difficulty increase" framing.
- **[RECOMMENDED — V5] BS-Q5 — Levels as default, Classic retained.**
  Recommended: `/bubble/` opens in **Levels** mode with a toggle to **Classic**
  (today's clear-board, pack + v3 shares intact). Alternative: keep clear-board
  default and add Levels behind the toggle. Owner product call.

No further blocking questions; BS-Q1 is the one that must be answered before V2.

## Review Log

- **2026-08-01 Pass 1+2+3 (combined).** Built from the shipped aim-and-shoot bubble
  (`clear_board_mode`, `bubble` v3 outcome) + the owner's ask (level tiers, a
  points→levels ramp, descending top-row insertion, an optional timer) + the
  attached Puzzle Bobble / Bust-a-Move research. Core decisions: (1) an **additive
  `levels_mode`** beside clear-board, its own `bubble-levels` outcome, so the
  shipped pack/shares stay valid; (2) pressure is **shot-driven** (row insertion on
  a shot/miss count, seeded rows folded into the hash) so replay stays verifiable,
  and the **timer is presentational-only** (BS-Q1, the one blocking decision —
  wall-clock can't be a verifiable loss); (3) the load-bearing core change is an
  explicit **`parity_offset`** on `Board` (default 0 → all existing tests
  unchanged) that makes faithful single-row top insertion a shift-down + parity
  flip, with an insert-in-pairs zero-refactor fallback (BS-Q2); (4) **arcade
  scoring** in the wrapper so targets reward big drops without touching
  `engine.rs`/clear-board. Pass-2: write-sets are bubble-owned; shared files are
  merge-time only (README/BUILDING-GAMES/TODO/Cargo.lock/registry); every phase
  leads RED at its entry point. Pass-3: TDD ordering (parity board → wrapper →
  reachability → wasm → UI → docs); typed/no-panic core + wasm; mutation edges
  (offset=0 goldens, offset=1 geometry, deadline crossing, exponential drop cap,
  replay tamper, timer-is-cosmetic); validation calibrated (V0 Moderate, V1/V2
  Narrow, V3/V4 Moderate, V5/V6 Broad); guide-shots + BUILDING-GAMES §4 scheduled
  in V6. **Awaiting owner review before executing V0** — chiefly BS-Q1 (timer vs
  verifiable outcome).
