# Align — Tier-1 build-fresh falling-block stacker (phase plan)

**Status:** ✅ **SHIPPED (v1) 2026-08-01 — playable at `/align/`.** Executed
TDD-first + committed: the deterministic tick-engine core (A1–A5,
`crates/align-core`), the wasm binding + daily pack (A6, `crates/align-wasm`), the
playable Canvas front end with verifiable result + `?r=` share (A7,
`src/games/align/`), and the how-to guide + executable IP gate + docs (A10).
Marathon + Sprint ship (state-terminal, fully verifiable); **Rush/Zen** (need the
stop-tick plumbed), **local records** (A8), and **audio/touch-gestures/a11y-palette/
PWA** (A9) are the tracked follow-ups in `TODO/align.md`. Gate green: cargo
test/fmt/clippy(-D warnings) for the align crates; typecheck · lint · 165 unit
(incl. the IP gate + how-to sync) · build; align e2e 8/8 (chromium). Deploy-ready
(pushed to the branch; not merged). — The original plan follows unchanged.

**Status (original):** 📋 **PLAN — not started.** This doc reconciles the supplied generic
8-phase "Align build plan" (a standalone Vite + Canvas project) with the shelf's
actual Tier-1 Croft-native standards (`docs/BUILDING-GAMES.md`): a determinism-first
Rust core → wasm, a verifiable `pond-outcome`, tap/keyboard-first input with the
core deciding legality, identity on `tokens.css`, shared settings, a "How to play"
guide, and the full gate. Target: `/align/` — an original guideline-compatible
falling-block stacker, the shelf's first real-time action Tier-1 game. Proposed
icon 🟪 (the violet signature piece; see A-Q1).

> Convention: `plans/YYYY-MM-DD-<slug>.md`, matching the repo (as 2048/bubble/wyrdle).
> The generic plan is preserved for reference; **where it conflicts with
> `docs/BUILDING-GAMES.md`, the standards doc wins** and this plan records the
> reconciliation.

## Problem Statement

The shelf's shipped Tier-1 games (solitaire, match-3, bubble, wyrdle, 2048) are all
turn-based or shot-based: every state transition is triggered by a discrete player
move, so `(seed, moves)` replay is trivially verifiable. **Align is real-time** — a
piece falls under gravity on a clock and locks after a delay whether or not the
player acts. A naïve implementation (the supplied plan's 60 Hz wall-clock TS
engine, floats on the fall path) cannot meet the shelf's two hardest invariants:
**native == wasm determinism** (§2) and **pressure/progression move-derived, never
wall-clock** (§4). The whole design problem is making a falling-block game
**replay byte-identically from its recorded inputs**, so it earns a verifiable
`pond-outcome` like every other Tier-1 game.

Objective (the game): a 10-wide × 20-visible field (+ hidden buffer), seven 4-cell
pieces with SRS-compatible kicks, a 7-bag randomizer, hold, a 5-piece preview, a
ghost, hard/soft drop, ~0.5 s lock delay with move-reset (cap 15), guideline
scoring (Single/Double/Triple/**Align**, T-spins, back-to-back, combo, perfect
clear), the guideline gravity curve (the "Worlds" formula from the reference report),
and fixed-goal leveling. Modes: Marathon,
Sprint 40, Rush, Zen. A 4-line clear is branded an **Align**.

Objective (the shelf): `/align/` meets every standard in `docs/BUILDING-GAMES.md`
+ the New-game checklist, and passes an **IP gate** (no "tetris"/"-tris"/trademarked
glossary anywhere; no guideline shape-to-colour mapping).

## Reasoning

### The determinism reconciliation (the core idea)

- **The core is a fixed-timestep tick engine, not a wall-clock loop.** The Rust
  core exposes `tick()` that advances the simulation exactly **1/60 s of integer
  time** and consumes any input events stamped at that tick. Gravity, lock delay,
  entry/clear delays, DAS/ARR auto-repeat cadence, and Rush's time budget are all
  counted in **integer ticks**. There are **no floats on the hashed path**.
- **The recorded artifact is a tick-stamped input stream.** A run's move list is
  `Vec<InputEvent { tick: u32, action: Action }>` where `Action` is a small enum of
  **atomic** effects — `ShiftL · ShiftR · RotCW · RotCCW · Rot180 · SoftStep ·
  HardDrop · Hold` (one horizontal cell, one rotation, one soft-drop cell). Replay
  re-runs the tick loop, applying gravity every tick and consuming events at their
  stamped tick, and re-derives the same `state_hash`, score, and line count. This is
  the **exact precedent the bubble shooter's levels mode already set** — its module
  doc says "no wall clock ever drives a state transition ... replays byte-identically
  from `(seed, angles)`." Align swaps "angles/shot-count" for "tick-stamped atomic
  actions"; the property is identical.
- **The wall clock is presentation-only.** The render loop uses a real-time
  accumulator to decide *how many* `tick()` calls to make this frame (identical feel
  across refresh rates, per the generic plan) and to *stamp* captured keystrokes with
  the current sim tick. What is recorded and hashed is the tick stream, not elapsed
  seconds. This mirrors bubble's cosmetic rAF flight animation: the clock informs the
  player and drives presentation, but **never decides the verified outcome** (§4).
- **Handling (DAS/ARR/SDF) lives entirely in the input layer and stays off the
  hashed path.** The player's handling settings translate raw key holds into the
  stream of **atomic** `Action`s at capture time (a held Right becomes ShiftL/ShiftR
  events at DAS/ARR cadence; a held soft-drop becomes SoftStep events at SDF cadence).
  Because the *resolved* atomic events are what get recorded, **replay is independent
  of the viewer's handling** — a shared `?r=` reproduces the exact shifts that
  happened, whatever the opener's ARR is. Handling is thus a pure input-layer /
  presentation concern (user-configurable, persisted), never a core rule.
- **The gravity curve becomes an integer lookup table.** The guideline "Worlds"
  formula `secondsPerRow = (0.8 − (level−1)·0.007)^(level−1)` is a float; it is **precomputed
  at build time into a const `TICKS_PER_ROW[level]`** table (levels 1..=20, each the
  formula rounded to whole ticks, floored to instant/20G by ~level 20). The core reads
  the table; no float ever runs on the hashed path. Spot-values are golden-pinned
  (levels 1/10/14/19).
- **The RNG is the proven `DetRng`.** 7-bag = Fisher-Yates (seeded ChaCha20
  `DetRng`, `usize`→`u32` at the boundary so native == wasm) shuffling one of each of
  the seven pieces per bag, draws folded into the hash. Optional `firstPieceNotSZO`
  flag. This is the same primitive as bubble/match-3/2048.

### Verifiability, input model, modes

- **Verifiable outcome, no solver.** `impl pond_outcome::Game for Align`
  (`Move = InputEvent`, `KIND = "align"`): `replay(seed, events)` ticks the engine to
  the mode's terminal condition and returns `Replayed::scored(final_hash, won, score,
  stars)`. Like 2048/wyrdle, **every seed is playable** (a fresh board always accepts
  the spawned piece) — reaching a Marathon goal is *skill*, not seed — so the daily
  "pack" is a deterministic **seed schedule + a short fixture input line**, with **no
  winnability solver**. `verify` re-replays; a tampered event or hash fails.
- **Terminal conditions are all replay-derivable.** Marathon = goal line count
  reached (Won) or top-out (Lost); Sprint = 40 lines cleared (the metric is the
  **tick count** = time); Rush = a fixed **tick budget** (2:00 → 7200 ticks — the
  countdown the player sees is presentational, the verified end is the tick count);
  Zen = endless until the player emits a recorded `Quit`, or a buffer-overflow that
  Zen resolves by trimming rather than ending. The record carries `end_tick` + the
  terminal reason so `verify` ticks to the exact end.
- **Tap/keyboard-first floor — the bubble precedent for a "continuous" game.** §4's
  tap-a-source→tap-a-destination does not fit a real-time stacker, exactly as it did
  not fit the aim-and-shoot bubble shooter. Align follows bubble's resolution: the
  **accessible floor is keyboard-operable discrete controls** (←/→ shift, Up/Z rotate,
  Space hard-drop, Down soft-drop, C hold) **plus on-screen control buttons** for
  touch that map to the *same atomic actions*. The core still decides legality: a
  shift into a wall or a blocked rotation is a **no-op the core rejects** (the UI just
  forwards atomic actions), and an E2E asserts an illegal shift changes nothing — the
  §4 guardrail against rules leaking into the UI.
- **Game isolation.** Align owns `crates/align-core`, `crates/align-wasm`,
  `src/games/align/`, `games/align/` (the daily seed-pack). `align` is a valid Rust
  crate name (no digit-leading problem 2048 had). It touches shared files only at
  wiring points (registry, how-to-registry, `tokens.css`, `build.mjs`,
  `tools/build-wasm.sh`, `Cargo.toml`, README, the chrome/drawer count tests).

### IP posture (folded into the gate, not just prose)

The shelf already reasons about IP for build-fresh games (see `TODO/digger.md`:
mechanics are uncopyrightable, expression is not). Align inherits the supplied
plan's non-negotiables and makes them a **test**: a unit/gate test greps the built
output + sources for `tetris`/`-tris` (case-insensitive), the trademarked glossary
("tetrimino", "matrix"), and the guideline shape-to-colour hexes, and fails on any
hit. The palette is the plan's original mapping (violet I / coral O / teal T / gold
S / sky Z / rose J / green L), deliberately *not* the guideline mapping; letters
stay internal shape ids only. A 4-line clear is an **Align**, never a "tetris".

## Verified Assumptions

- **`DetRng` is copy-ready** (`crates/bubble-core/src/rng.rs`, read 2026-08-01):
  ChaCha20 from a `u64`, `index(len)` samples a fixed-width `u32` range (native==wasm
  stable) and counts draws for the hash. 7-bag Fisher-Yates is a direct application.
- **`pond_outcome::Game` fits a tick-stamped move** (`crates/pond-outcome/src/lib.rs`,
  read 2026-08-01): `type Move: Serialize + DeserializeOwned + Clone` — an
  `InputEvent { tick: u32, action: Action }` qualifies. `Replayed::scored(final_hash,
  won, score, stars)` surfaces a score + stars; `Record<M>.score/stars` are
  `Option`, `attest`/`verify`/`to_doc`/`from_doc` are generic over `M`. **No
  pond-outcome change needed.**
- **The move-derived-pressure precedent is real and documented**
  (`crates/bubble-core/src/levels.rs`, read 2026-08-01): its module doc explicitly
  bases a verifiable escalating-difficulty run on a move-count trigger with a
  presentational-only timer. Align's tick-driven gravity/pressure is the same
  contract; `docs/BUILDING-GAMES.md` §4 already ratifies it ("pressure and
  progression must be move-derived, never wall-clock").
- **The C-ABI wasm shape to mirror** (`crates/twenty48-wasm/src/lib.rs`, read
  2026-08-01): `#[no_mangle] extern "C"` exports `new_game(lo,hi)`, `board_json`,
  `current_hash`, `move_(u32)->u32`, `hint`, `mark_assistance`, `outcome_json(u32)`,
  `daily_seed(u32)`, `out_len` over a `ptr`/`len` buffer; never panics (each fallible
  path → status code / empty buffer). Align adds `tick()`, `input(action:u32)->u32`,
  and mode/HUD reads on the same pattern.
- **The full Tier-1 template is the freshly-shipped 2048** (`plans/2026-07-31-2048.md`,
  `crates/twenty48-{core,wasm}`, `src/games/2048/`, `games/2048/daily-pack.json`) plus
  **bubble** for seeded-RNG + score-surfaced results + the continuous-input floor.
  Both read 2026-08-01. Shared wiring points are known and enumerated below.
- **Clean IP baseline** (grep 2026-08-01): the repo currently contains **zero**
  "tetris" references in code/docs; `align` collides with nothing (only an entry in
  wyrdle's `allowed.txt` word list, unrelated). The frontend-design skill exists at
  `/mnt/skills/public/frontend-design/SKILL.md` for A7's visual identity pass.

## Documentation Impact

- `crates/align-core/RULES.md` — **new**: board/buffer dims, piece + rotation-state
  offset data, 7-bag contract, the **tick model** (what one tick advances, integer
  timing table, lock-delay/move-reset, entry/clear delays), the atomic `Action` set +
  tick-stamped record, kick tables, scoring + T-spin (3-corner) + B2B/combo/perfect
  clear rules, the gravity table + leveling, the mode terminal conditions, and the
  hash encoding. Grows across A1–A5 with the code.
- `docs/BUILDING-GAMES.md` — add a short note under §4 that the tick-stamped-input
  model is the sanctioned pattern for a **real-time** Tier-1 game (as bubble added the
  continuous-input note), with Align as its reference. Confirm the checklist fits.
  Phase A10.
- `README.md` — Align in the shelf order + the crate/data map + an Align section. A10.
- `TODO/align.md` — **new**: deferred follow-ups (180° default binding, Jstris-feel
  lock preset, extra modes cheese/survival, colour-ramp niceties, the deferred Battle
  mode). Seeded in A0 as a stub, filled in A10.
- `src/registry.ts`, `src/how-to-registry.ts` — Align entries (A7 registry so the
  E2E drives a real `/align/`; A10 how-to). `tests/chrome.test.ts` +
  `tests/drawer.spec.ts` counts. A7.

## Concurrency Map

Sequential spine: **A0 → A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8 → A9 → A10.** Each
phase reads what the prior wrote; the core phases (A1–A5) are a strict dependency
chain (rotation needs pieces; input needs rotation; scoring needs input+lock;
modes+pack need scoring). A6 (wasm) needs the whole core; A7–A9 are front-end on top
of A6; A10 is docs+gate. No parallel set within the spine. If run in an isolated
worktree (recommended, as 2048 did — `worktrees/fun/align` off `origin/main`, branch
`claude/align-game-build-plan`), the only cross-session shared-file merge surface is
`Cargo.toml`, `build.mjs`, `tools/build-wasm.sh`, `src/registry.ts`,
`src/how-to-registry.ts`, `README.md`, `tokens.css`, `docs/BUILDING-GAMES.md`, and
`tests/{chrome.test,drawer.spec,tokens.test}.ts` — merge-time only. Isolation
invariants: no `git checkout/stash/rebase` in the main `fun/` worktree; writes only
under the worktree + scratchpad; bind no ports beyond the ephemeral test server.

## Phases

> Every phase is TDD-first: the listed wiring test is **RED at the real entry point**
> before any production code, then GREEN. Commit at each green point (co-author
> trailer per CLAUDE.md). Maps the supplied generic plan's Phase 0–8 into the shelf
> spine; the mapping is noted per phase.

### Phase A0 — scaffold + identity (generic Phase 0, re-cast into the monorepo)
**Goal:** Align exists as empty-but-wired crates + identity tokens **inside the
existing repo** — *not* a new Vite project (the shelf already has the build, chrome,
router-free `/id/` URLs, Vitest/Playwright/ESLint). The generic "one config object"
becomes core consts + a `ModeConfig`; identity colours become `tokens.css` tokens.
**Changes:**
- [ ] `crates/align-core/Cargo.toml` + `src/lib.rs` (`#![warn(missing_docs)]`, empty
  re-exports) as a workspace member; deps mirror bubble-core (rand, rand_chacha,
  serde, serde_json, sha2, hex, thiserror).
- [ ] `tokens.css` — `--align-piece-i/o/t/s/z/j/l` (the plan's original hexes),
  board/grid/ghost tokens; every text/UI pair AA in both themes, asserted by
  `tests/tokens.test.ts`. **Deliberately not** the guideline mapping.
- [ ] `TODO/align.md` stub; a first `crates/align-core/RULES.md` skeleton stating the
  IP posture + the tick-model thesis.
**Wiring test:** `tokens.test.ts` covers the new Align tokens (AA both themes) — RED
until the tokens exist. `cargo build -p align-core` compiles the empty crate.
**Done when:** crate builds; tokens AA-clean both themes; `npm run test` green.
**Validation:** Narrow.

### Phase A1 — core: board, pieces, 7-bag, gravity, lock, hash (generic Phase 1)
**Goal:** the deterministic skeleton — a 10×(20+buffer) board, seven pieces with four
rotation states as offset data, seeded 7-bag spawning, one-tick gravity, immediate
lock (delay lands in A3), line clear + shift-down, top-out, and a `state_hash`;
golden-pinned; a `from_cells` test ctor. Internal row 0 at the bottom.
**Changes:**
- [ ] `src/rng.rs` (`DetRng`, copy bubble-core), `src/board.rs` (grid, `from_cells`,
  `occupied`, `clear_full_rows`, `is_topped_out`), `src/piece.rs` (the seven shapes ×
  four states as offset tables; SRS spawn positions — I/O centred, others rounded
  left, J/L/T flat-side-down, in the buffer), `src/bag.rs` (Fisher-Yates 7-bag,
  `firstPieceNotSZO` flag), `src/gravity.rs` (drop one row / detect grounded),
  `src/hash.rs` (`state_hash` = tag + dims + bag draws + board cells + active piece,
  LE u32).
- [ ] `tests/golden.rs` — bag guarantees (each piece once per 7; ≤12-piece max wait
  across bag boundaries); spawn positions per piece; a full row clears exactly and
  rows above shift; both top-out conditions; **identical seeds ⇒ identical games**
  (an RNG off-by-one flips the hash); a pinned `state_hash`.
**Test edges:** the 12-wait bound at a bag boundary; a clear of non-contiguous full
rows; a lock entirely above the visible field = top-out; spawn overlap = top-out.
**Depends on:** A0. **Read-set:** `crates/bubble-core/src/{rng,board,hash}.rs`.
**Done when:** crafted boards behave per goldens; `cargo test -p align-core` + fmt +
clippy clean. **Validation:** Narrow.

### Phase A2 — core: SRS rotation + wall kicks (generic Phase 2)
**Goal:** five-test kick rotation for J/L/S/T/Z (shared table) and I (own table); O is
a no-op; 180° via a documented sequence/own table. Record on the piece **whether the
last successful action was a rotation** and **which kick-test index succeeded** (both
needed for A4 T-spin detection).
**Changes:**
- [ ] `src/rotation.rs` — `RotState {0,R,2,L}`, the two kick tables verbatim from the
  plan (offsets (x,y), +x right/+y up), `try_rotate(dir) -> Option<Applied{kick_index}>`
  applying the first non-colliding test; all-fail ⇒ silent no-op leaving the piece
  unchanged. Fields `last_action_was_rotation: bool`, `last_kick_index: u8`.
- [ ] extend `tests/golden.rs` — each transition applies the correct first-passing
  offset in constructed boards; a T-spin-double cavity rotates the T in; the
  T-spin-triple kick (test 5) is reachable; a fully-blocked rotation is a no-op.
**Depends on:** A1. **Done when:** kick scenarios match the tables; `cargo test -p
align-core` green. **Validation:** Narrow (pure functions over crafted boards).

### Phase A3 — core: tick engine, atomic input, hold, lock delay (generic Phase 3, mechanics only)
**Goal:** the heart — the fixed-timestep `tick()` driver, the atomic `Action` set, the
tick-stamped record, hold (one slot, locked until the current piece locks), soft/hard
drop, and lock delay (500 ms = 30 ticks, **move-reset** capped at 15; falling a row
restores the budget; hard drop bypasses it). **Handling stays in the front-end (A7)**
— the core consumes already-atomic actions.
**Changes:**
- [ ] `src/action.rs` — `Action { ShiftL, ShiftR, RotCW, RotCCW, Rot180, SoftStep,
  HardDrop, Hold }`; `InputEvent { tick: u32, action: Action }`.
- [ ] `src/engine.rs` — `Engine` holding board, active piece, bag, `DetRng`,
  `tick: u32`, lock-delay state (`grounded_since`, `reset_count`), `hold` + `hold_used`,
  `moves: Vec<InputEvent>`. `tick()` advances one integer tick: apply gravity per the
  A4 table (A3 uses a fixed test rate), run the lock-delay timer, spawn on lock/clear.
  `input(action) -> InputResult` applies an atomic action **through the core's legality
  check** (illegal shift/rotate = recorded-nothing no-op), pushing accepted events with
  the current tick. Hard drop drops-to-floor + locks immediately (no delay). Hold swaps
  + respawns, locked out until lock.
- [ ] `RULES.md` — the tick contract + lock-delay/move-reset spec + hold rules.
- [ ] `tests/engine.rs` — 30-tick lock at floor; a shift/rotate resets the timer; the
  **15-reset cap** enforced (16th does not reset); a lower row restores the budget;
  hard drop bypasses delay; soft drop (finite rate) does **not** auto-lock; hold
  lock-out; an illegal action is a no-op with no recorded event and unchanged hash.
**Depends on:** A2. **Observability:** `InputResult`/`MoveError` typed (`thiserror`);
never panics. **Done when:** tick/lock/hold/drop behave per spec; `cargo test -p
align-core` green. **Validation:** Moderate (tick-resolution timing + wiring).

### Phase A4 — core: scoring, T-spins, gravity curve, leveling, `pond-outcome` (generic Phase 5)
**Goal:** the full guideline scoring + the integer gravity table + fixed-goal leveling,
then the verifiable binding — a run is `attest`/`verify`-able from `(seed, events)`.
**Changes:**
- [ ] `src/scoring.rs` — the plan's point table (Single 100·L … Align 800·L,
  T-spin/mini rows, soft 1/cell, hard 2/cell); **back-to-back** ×1.5 (difficult =
  Align or line-clearing T-spin; a no-line T-spin keeps the chain, a plain
  Single/Double/Triple breaks it); **combo** 50·combo·L; **perfect clear** bonuses
  (800/1200/1800·L S/D/T, 2000·L Align, 3200·L B2B-Align).
- [ ] `src/tspin.rs` — 3-corner rule (locking piece is a T; last successful action was
  a rotation; ≥3 of the 4 diagonal corners of the 3×3 box occupied — walls/floor
  count). Both front corners + ≥1 back = full; else Mini; **kick-index 5 upgrades to
  full** regardless of corners.
- [ ] `src/gravity.rs` — `TICKS_PER_ROW[1..=20]` **precomputed from the guideline
  "Worlds" formula** at build time (const table; floored to instant/20G near level 20); wire
  into `tick()`. Fixed-goal leveling: 10 lines/level, Marathon cap 15, selectable
  start level.
- [ ] `impl pond_outcome::Game for Align` (`Move = InputEvent`, `KIND = "align"`,
  `VERSION = 1`): `replay(seed, events)` ticks to the mode terminal and returns
  `Replayed::scored(final_hash, won, score, stars)`.
- [ ] `RULES.md` extend; `tests/scoring.rs` + `tests/golden.rs`.
**Test edges:** every scoring row; the four T-spin cases (full / mini / kick-5 upgrade
/ rotation-last requirement — a shifted-in T is **not** a T-spin); B2B keep-vs-break;
combo counting; perfect-clear detection; gravity spot-values at levels 1/10/14/19
(pinned); a scripted line `attest`→`verify` ok (tampered event **and** tampered hash
fail); score + stars surfaced.
**Depends on:** A3. **Read-set:** `crates/pond-outcome/src/lib.rs`,
`crates/bubble-core/src/{game,levels}.rs`. **Done when:** the whole scoring model is
golden-pinned and a scripted run re-verifies; `cargo test -p align-core -p
pond-outcome` green. **Validation:** Broad (the mechanically richest phase).

### Phase A5 — core: modes + daily seed-pack (generic Phase 6, engine side)
**Goal:** the four modes on one engine via `ModeConfig`, and a deterministic daily
seed-pack (no solver, like 2048/wyrdle) + a fixture replay line.
**Changes:**
- [ ] `src/mode.rs` — `ModeConfig` (Marathon 1→15 / 150 lines + endless toggle;
  Sprint 40 lines, fixed low gravity, metric = tick count; Rush = 7200-tick budget;
  Zen = endless, buffer-overflow trims instead of ending). Terminal conditions +
  `end_tick`/reason recorded so `verify` ticks to the exact end.
- [ ] `src/pack.rs` — `Pack { seeds, fixture: {seed, events} }`; `generate_pack`
  = inline `splitmix64` Fisher-Yates over a seed range (the wyrdle/2048 pattern, no
  build-time `rand`); fixture = a short legal tick-stamped line replayed to a
  verifiable non-panicking state. `pond_docformat::write("align-daily-pack", 1, ..)`.
- [ ] `games/align/daily-pack.json` (committed); `tests/pack.rs` (committed pack
  well-formed + unique seeds + fixture replays + changes the board; `#[ignore]`
  generator + byte-identical-regen drill); `tests/mode.rs` (each mode's terminal is
  replay-derivable; Rush ends at tick 7200 exactly; a presentational timer never
  changes the hash).
**Depends on:** A4. **Done when:** modes terminate deterministically; committed pack
regenerates byte-identically; `cargo test -p align-core` green. **Validation:**
Moderate.

### Phase A6 — align-wasm C-ABI + typed TS wrapper (generic Phase 1–5 → browser)
**Goal:** the browser holds an `Engine`; daily reads the pack; **never panics**.
**Changes:**
- [ ] `crates/align-wasm/{Cargo.toml, src/lib.rs}` — raw C-ABI (mirror
  twenty48/bubble-wasm): `new_game(lo, hi, mode, start_level, flags)`; `tick()`;
  `input(action: u32) -> u32` (0 applied / 1 illegal / 2 ignored-locked); `board_json`
  (cells, active piece, ghost landing, hold, next-5, HUD: score/level/lines/combo/b2b,
  last-clear callout, tick); `current_hash`; `is_over` + terminal reason; `hint()`;
  `mark_assistance`; `outcome_json(declare)`; `daily_seed(day)`; `out_len`.
  `include_bytes!` the pack.
- [ ] `src/games/align/align-wasm.ts` — typed wrapper (`BoardView`, `Action` union,
  `newGame`, `tick`, `input`, `board`, `hash`, `over`, `hint`, `outcome`, `dailySeed`).
- [ ] `Cargo.toml` (member), `build.mjs` (copy `/align.wasm` + pack + `GAME_PAGES`),
  `tools/build-wasm.sh` (`-p align-wasm`), `Cargo.lock`.
**Wiring test:** `lib.rs::tests::cabi_new_tick_input_outcome` (native rlib): new_game →
board parses → `tick()` advances → a legal `input` applies + an illegal one returns 1
with unchanged hash → `outcome_json` parses to a `kind:"align"` envelope →
`daily_seed(0)` from the pack. RED first.
**Depends on:** A5. **Done when:** `npm run build:wasm` builds `/align.wasm`; C-ABI test
+ `cargo test --workspace` green; a JS smoke instantiates, ticks, and plays.
**Validation:** Moderate.

### Phase A7 — renderer, HUD, ghost, previews, input+handling, result, share, registry (generic Phase 4)
**Goal:** a playable, accessible, verification-forward `/align/`. **Read the
frontend-design skill first** (`/mnt/skills/public/frontend-design/SKILL.md`) and give
Align a distinctive identity — the look is the IP moat and must not resemble official
trade dress. Centre the play surface (§4 layout).
**Changes:**
- [ ] `src/games/align/align-outcome.ts` — pure verify/share (mirror
  2048/wyrdle-outcome): `Record { kind, seed, mode, events, end_tick, score, ... }`,
  `verifyRecord` (replay events → hash + score + lines), encode/decode a **deflated**
  `?r=` (a long Marathon run is thousands of events — deflation is mandatory to keep it
  a portable URL), whose open path **re-verifies before display**.
- [ ] `src/render/` — Canvas 2D at a fixed logical resolution scaled to fit; crisp
  cells, subtle grid, a sliver of the first buffer row; **ghost** (translucent
  hard-drop landing, toggleable); **next-5** in spawn orientation; **hold box** with
  lock-out dimming; short line-clear flash (≤200 ms, reduced-motion aware).
- [ ] `src/input/` — keyboard defaults (the plan's mapping) + full rebinding, and the
  **handling layer** (DAS 133 / ARR 10 / SDF 20× defaults, DAS-cancel), persisted to
  `localStorage`, that resolves held keys into the core's **atomic actions**. Touch
  buttons land in A9.
- [ ] `src/games/align/align.ts` — the `GameModule`: mounts the renderer + input +
  the fixed-timestep accumulator loop that drives `tick()` and stamps events; HUD
  (score/level/lines/timer + clear callouts: "Double", "Align", "T-Spin",
  "Back-to-Back", combo). Top-out/goal/quit → verification-forward result (score, seed,
  hash, re-verify, `?r=`). Daily + free-play (`?seed=`) + shared (`?r=`). Hints
  on-by-default (suggest a placement; assistance) + shared settings; hints-off →
  "I'm stuck" ends + reports.
- [ ] `tokens.css`/`styles.css` (semantic tokens only; hex-in-styles test stays
  green); `src/registry.ts` (+ `chrome.test`/`drawer.spec` counts); a `window.__align`
  E2E hook; `tests/align.spec.ts` (render + HUD; a shift/rotate/drop plays; the
  **illegal-shift-into-wall no-op guardrail**; the fixture replays to a verifiable
  result + `?r=` round-trip; hints-off "I'm stuck" ends; axe both themes; 360px fit).
**Depends on:** A6. **Done when:** a stranger opens `/align/`, plays a full game
keyboard-only through menus, tops out/finishes, and gets a verifiable record with
re-verify + `?r=`; 60 fps on a mid laptop; the look reads as its own game. `npm run
test` + `npm run e2e` green. **Validation:** Broad (e2e + manual + axe + 360px +
guardrail + share round-trip).

### Phase A8 — modes UI + local records (generic Phase 6, front-end side)
**Goal:** the four modes selectable, each with an after-run result + persisted local
records, and **instant retry** (< 1 s — what makes Sprint sticky).
**Changes:**
- [ ] mode-select menu; per-mode result screens (Sprint shows time + live pace; Rush
  shows the presentational countdown; Marathon shows score/level; Zen is calm/endless).
- [ ] `localStorage` records per mode: best score/time + date + per-run stats (pieces,
  PPS, lines, max combo, T-spins, Aligns). Local-only, no server (shelf stance).
- [ ] `tests/align-modes.spec.ts` — each mode completes; records persist across reload;
  retry re-arms in < 1 s.
**Depends on:** A7. **Done when:** all four modes complete; records persist; instant
retry. **Validation:** Broad.

### Phase A9 — audio, touch, accessibility, PWA (generic Phase 7)
**Goal:** the polish/reach pass.
**Changes:**
- [ ] Original SFX (move/rotate/lock/clear-tiers/hold/level-up/top-out) + original
  ambient music via WebAudio; volume sliders + mute; **audio unlocked on first
  interaction**. Assets under `src/games/align/` (game-isolated). Provenance recorded.
- [ ] Touch controls: on-screen shift/rotate/hold/drop buttons (the **tap floor**) +
  gestures (swipe shift with swipe-DAS, swipe-down soft, flick-down hard). One-handed
  playable; ≥44 px targets; `touch-action: manipulation`.
- [ ] Accessibility: colorblind-safe alternate palette + per-piece **patterns** option
  (never colour-alone), reduced-motion mode, high-contrast board; settings
  export/import as JSON.
- [ ] PWA manifest + icon (installable from fun.croft.ing); offline via service worker
  (all modes client-side).
- [ ] `tests/align-a11y.spec.ts` + a real-phone playtest note in `CHANGELOG.md`.
**Depends on:** A8. **Done when:** Lighthouse PWA installable, playable offline,
one-handed on a phone, palettes switch live, axe clean. **Validation:** Broad.

### Phase A10 — how-to, IP gate, docs, full gate, deploy-ready (generic Phase 0 IP checklist + wrap-up)
**Goal:** Align is a first-class shelf game; the full gate incl. the **IP gate** is
green.
**Changes:**
- [ ] `src/games/align/align-howto.ts` (pure data; **lead with the interaction
  model** — "do I tap or use keys?") + `src/how-to-registry.ts` + `npm run guide:shots`
  (`align-board`, `align-align`/`align-result`). Regenerate shots after A7/A9 visual
  changes; `git add` only Align's shots.
- [ ] **IP gate** `tests/align-ip.test.ts` — greps sources + built `dist/` for
  `tetris`/`-tris`, the trademarked glossary, and the guideline shape-to-colour hexes;
  fails on any hit. Confirms title/meta/OG say "Align". (The plan's pre-deploy IP
  checklist, made executable.)
- [ ] `README.md` (shelf order + crate/data map + an Align section),
  `docs/BUILDING-GAMES.md` (the §4 real-time note + checklist confirm), `TODO/align.md`
  filled.
- [ ] full gate: `cargo test --workspace` + fmt + clippy; `npm run test` + `npm run
  e2e`; a local-serve smoke.
**Depends on:** A9. **Done when:** the drawer lists Align playable, launches it, links
its how-to (with shots); the IP gate + full gate are green; deploy-ready (**not pushed
unless asked**). **Validation:** Broad (full gate + IP gate + serve smoke).

## Deferred — Battle (generic Phase 8)

Out of scope, **gated exactly as cribbage is**. Garbage attack, queue+cancellation,
matchmaking, and cheat resistance need the shelf's P2P transport + a fair primitive
(the iroh/WebRTC work `TODO/cribbage.md` is blocked on). Not a phase to start until
single-player Align ships and the transport exists. When it does, the community
(Jstris/Friends) garbage attack table (from the reference material) is the default,
configurable — recorded here so the value survives, not built now.

## Open Questions

- [RECOMMENDED: ADVISORY] **A-Q1 — icon.** Recommended **🟪** (the violet I-piece,
  ties to the palette, distinctive vs a generic block). Alternatives 🧱/🟦. *Advisory.*
- [RECOMMENDED: ADVISORY] **A-Q2 — line-clear timing in the core.** Recommended: keep
  clear resolution **instantaneous in the core** (lock→detect→clear→shift→spawn in one
  tick) with the ≤200 ms flash **purely cosmetic** in the UI (does not advance the
  sim), matching the plan's "play never feels blocked". If a faithful clear-freeze is
  wanted later, add a fixed integer `clear_delay_ticks` to `ModeConfig` (still
  deterministic). *Advisory — start instantaneous.*
- [RECOMMENDED: ADVISORY] **A-Q3 — record granularity.** Recommended: record
  **resolved atomic actions** (handling-independent replay; a `?r=` reproduces the
  exact shifts whatever the opener's ARR). The alternative (raw key events + handling
  in the record) makes replay handling-dependent and bloats the record. *Advisory —
  atomic actions.*
- [RECOMMENDED: ADVISORY] **A-Q4 — 180° rotation.** Recommended: implement the mechanic
  in A2 (own/sequence table) but leave it **unbound by default** (a rebindable extra),
  since it is not in the plan's default keymap. *Advisory.*

No BLOCKING questions — the core determinism model (tick engine + tick-stamped atomic
record + integer gravity table) is settled and grounded in the bubble-levels
precedent + `docs/BUILDING-GAMES.md` §4. A1 can start on approval.

## Review Log

- **2026-08-01 Pass 1+2+3 (combined).** Built by reconciling the supplied generic
  8-phase build plan against `docs/BUILDING-GAMES.md`, grounded in firsthand reads
  (2026-08-01) of `bubble-core/{rng,levels}.rs`, `pond-outcome/lib.rs`, and
  `twenty48-wasm/lib.rs`. Central decision: a **fixed-timestep integer tick engine**
  whose recorded artifact is a **tick-stamped atomic-action stream**, making a
  real-time stacker replay byte-identically (native==wasm, no floats on the hashed
  path) — the same move-derived-pressure contract bubble's levels mode already ships,
  ratified by §4. Handling (DAS/ARR/SDF) resolved to the input layer so replay is
  handling-independent (A-Q3). Gravity float-formula precomputed to an integer table.
  Verifiable via `pond_outcome::Game` with `Move = InputEvent` (**no pond-outcome
  change** — trait confirmed generic over `Move`, `Replayed::scored` fits). No solver
  (every seed playable, like 2048/wyrdle) → seed-schedule pack + fixture. Tap/keyboard
  floor follows the bubble continuous-input precedent (§4). IP guardrails made an
  **executable gate** (A10), not just prose (clean baseline confirmed: zero "tetris"
  in-repo). Pass-2 gap checks: write-sets isolated to Align's four directories except
  the enumerated shared wiring files; every phase leads RED at its real entry point;
  the wall-clock-terminal risk (Rush 2:00, Zen) resolved to tick-budget/recorded-quit
  so all terminals are replay-derivable. Pass-3 gates: TDD ordering per phase; typed
  errors, no panics; mutation-resistant edges (RNG off-by-one flips hash, 15-reset cap,
  kick-5 T-spin upgrade, rotation-last requirement, illegal-move no-op, tamper fails);
  validation calibrated (A1/A2 Narrow, A3/A5/A6 Moderate, A4/A7/A8/A9/A10 Broad); docs
  sit in their phase. Confirmed ready — A1 can start on approval.
