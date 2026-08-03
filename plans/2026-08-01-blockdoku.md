# Blockdoku — Tier-1 build-fresh 9×9 block-sudoku (phase plan)

**Status:** 📋 **PLAN — in progress.** This doc reconciles a supplied generic
8-phase "blockdoku-next" plan (a standalone Vite + vanilla-JS PWA, engine in
`src/engine/*.js`, deploy to `fun.croft.io`) with this shelf's actual Tier-1
Croft-native standards (`docs/BUILDING-GAMES.md`): a determinism-first **Rust core
→ wasm**, a verifiable `pond-outcome`, tap/keyboard-first input with the **core
deciding legality**, identity on `tokens.css`, shared settings, a "How to play"
guide, and the full gate. Target: `/blockdoku/` on `fun.croft.ing`. Proposed icon
🟦.

> Convention: `plans/YYYY-MM-DD-<slug>.md`, matching the repo (as align/2048/
> bubble/wyrdle). The supplied plan + its `CLAUDE.md` are preserved as behavioral
> intent; **where they conflict with `docs/BUILDING-GAMES.md`, the standards doc
> wins** and this plan records the reconciliation. The original AGPL game is
> cloned read-only to `reference/original/` (gitignored, never imported) as the
> behavioral source of truth per the shelf rule "check the reference before
> guessing".

## Problem Statement

Blockdoku (original: `github.com/chasemp/blockdoku`, AGPL-3.0, live at
`blockdoku.523.life`) is a 9×9 block-sudoku: a tray of three polyomino pieces is
dealt; the player places pieces onto the grid; completing any full **row**,
**column**, or **3×3 box** clears it; the tray refills when emptied; the game ends
when no tray piece fits anywhere. It is **endless score-attack — there is no win
state** (you play for score until stuck).

The supplied kit specifies a pure-JS engine + Vite UI as a *separate* project.
The user's decision is to **adapt it into this shelf as a Tier-1 Croft-native
game** instead. That means the endless-score-attack, grid-based, seeded-deal shape
of **2048** (already shipped here) is the structural precedent for the outcome
model, and **solitaire/align** are the precedent for wiring. The design problem is
therefore not "how to build blockdoku" (the rules are well understood) but **how
to make it meet the shelf's invariants**:

1. **Determinism, native == wasm (§2).** The original deals pieces with
   `Math.random()` in several places (piece pick, standard-fill, final shuffle).
   The port must draw every random decision from a single seeded `ChaCha20`
   stream through the shared `DetRng` (with the `usize`→`u32` boundary), so a run
   replays byte-identically from `(seed, moves)` and hashes the same on native and
   `wasm32`. The *logic* of the original deal (difficulty pools, the wild/magic
   frequency accumulator, the overlap toggle) is ported faithfully; the exact draw
   *sequence* is re-anchored to our seeded stream and locked with golden vectors.
2. **Verifiable outcome (§3), 2048-style.** A finished run emits a `pond-outcome`
   `Record { kind:"blockdoku", seed, moves, move_count, final_hash, result, score,
   assistance }` where `result ∈ {Lost, Stuck, Abandoned}` (no `Won` — endless).
   `verify` re-replays `(seed, moves)`, re-derives the board hash **and the score**,
   and trusts no stored field. A `?r=` share carries the deflated record and
   re-verifies before display.
3. **Tap-first, core-decides-legality (§4).** Tap a tray piece → the core's
   `legal_moves()` glows exactly the legal anchor cells → tap one to place. An
   illegal tap changes nothing. The UI never re-implements placement legality.
4. **No floats on the hashed path.** Scoring is all integer. The difficulty
   multiplier is applied as an integer floor **per component** (see B2), never as a
   float accumulated into state.

## Reasoning

### Why 2048 is the model, not solitaire

Solitaire/align have a **win** and (align) a solver-certified winnable daily pack.
Blockdoku, like 2048, is **always playable and never "won"** — every deal is
placeable (we further *guarantee* it, see B3), and the challenge is the score you
reach before you're stuck. So, per §3's "trivially winnable / no solver" reasoning
generalized to score-attack: **blockdoku ships the daily-pack machinery (a
`pond-docformat` seed schedule indexed by UTC day) but no solver crate** — there
is no win-state to certify, only a deterministic seed to share a leaderboard-style
score against. The verifiable claim is 2048's: "on seed X, this move sequence
reached score S and ended Stuck/Lost." `crates/twenty48-core` +
`src/games/2048/*` are the files to mirror for outcome/pack/verify/share.

### The board and hash

- 9×9 grid, `board[row][col]`, rows top→bottom, cols left→right. Cells are plain
  occupancy (`0` empty / `1` filled) — **colour is cosmetic and off the hash**.
- 3×3 boxes indexed 0–8 row-major (`box = boxRow*3 + boxCol`).
- Completed-region detection: a row/col is complete when all 9 cells filled; a box
  when all 9 of its cells filled. **All regions completed by a single placement
  clear simultaneously as a union** (a cell shared by a cleared row and box is
  cleared once); this matters for scoring counts and is characterized against the
  reference.
- `state_hash` mirrors `twenty48-core/src/hash.rs`: domain tag `b"bdk\x00"`, board
  dims, `draws` (RNG position), `score`, then row-major cells. Integer-only,
  little-endian → byte-identical native/wasm. Additive per §2 "overlay pattern" so
  later facets (magic-block state, if added) don't re-lock existing vectors.

### The shape catalog — 53 shapes, generated, never hand-edited

Extracted **verbatim** from `reference/original/src/js/game/blocks.js`
`defineBlockShapes()`: **8 standard**, **38 wild** (`isWild`, exotic geometries,
no special mechanic — pure shapes with a points value), **7 magic** (`isMagic`:
`wildSingle/wildLine2/wildL` lineClear, `bombSingle/bombLine2` bomb, `lightning
Single` lightning, `ghostSingle` ghost). Each carries `key`, `name`, a bit-matrix,
`points`, `tier`, and (magic only) `magicType`. Per the kit rule "`shapes.json` is
generated data, never hand-edited": a small extraction tool
(`tools/extract-blockdoku-shapes.mjs`) reads the reference `blocks.js` and emits
`crates/blockdoku-core/src/shapes_gen.rs` (a `const` catalog); a golden test locks
the catalog by count (8/38/7) and a catalog hash. The wasm build never parses JSON
at runtime — the catalog is compiled in.

### Scoring — the frozen subset (verified against the reference)

The reference's *current* scoring stack is richer than we port (it adds speed
bonuses, a multiplier-chain manager, pattern detection, empty-grid + level
bonuses). The kit deliberately freezes a **clean subset**, and that subset matches
the reference's core arithmetic **exactly** (verified in
`reference/.../game/scoring.js`):

| Component | Value | Reference anchor |
|---|---|---|
| Placement | the shape's own `points` | `blocks.js` per-shape `points` |
| Row/Column clear | **15** each | `basePoints.line = 15` |
| 3×3 box clear | **20** each | `basePoints.square = 20` |
| Combo bonus (per clear `i=2..N` in one placement) | `+10` (2nd), `+15` (3rd,4th), `+50` (5th), `+100` (6th+) | `calculateComboBonus` |
| Streak bonus (consecutive combo events) | `<2 → 0`; `2..10 → streak*10`; `11+ → 100+(streak-10)*100` | `calculateStreakBonus` |
| Difficulty multiplier | easy 1.5 · normal 1.0 · hard 0.8 · expert 0.5 | `difficulty-manager.js` |

**Every component is `floor(component * multiplier)` independently** (line, square,
combo, streak, placement each floored), matching `Math.floor` per-component in the
reference. A **combo event** = a single placement clearing **2+ total regions**
(rows+cols+boxes); `streak` increments per combo event and **resets on a placement
that clears nothing**. Exact combo/streak *event* semantics (the `combo` vs
`streakCount` reset rules) are characterized 1:1 from `scoring.js` and locked with
golden vectors — memory of this summary is not trusted (per kit rule).

> **Decision (2026-08-01):** placement points = the shape's `points` field
> (single=1, line2=2, …). The reference's *live* `basePoints.single=0.5` + speed
> machinery is **not** ported — it is outside the kit's frozen subset. Recorded in
> the Decisions Log.

### Difficulty — the presets and the `square3x3` trap

Exact presets from `reference/.../difficulty/difficulty-manager.js`:

| Preset | blockSizeRange | allowedShapes | multiplier | hints | moveLimit |
|---|---|---|---|---|---|
| easy | `[2,4]` | `[square2x2, square3x3, l2x2, line2, line3]` | 1.5 | on | — |
| normal | `[1,5]` | `all` | 1.0 | off | — |
| hard | `[1,3]` | `[single, line2, line3, l2x2, t3x2, z3x2]` | 0.8 | off | — |
| expert | `[1,4]` | `all` | 0.5 | off | 50 |

`resolvePool(difficulty)` applies the allowed-list (standard+wild filtered by it;
**magic always kept**, only size-filtered — faithful to `generateRandomBlocks`)
then the size-range filter (`max(rows,cols) ∈ [min,max]`). **Known trap:** easy's
list names `square3x3`, which is **not** in the catalog (latent bug in the
original). Resolution (Decisions Log): **drop unknown allowed-list keys silently
(no console/DOM — core purity)**; easy's effective pool becomes
`{square2x2, l2x2, line2, line3}`. A test documents this.

### The deal, seeded — and the placeability guarantee

`deal(count=3)` ports `generateRandomBlocks`: per-set magic/wild target counts via
the fractional **accumulators** (`p = freq/10`, `float = p*count`, `n =
floor(float + acc)`, carry the remainder), the low-freq cap (`<5` → ≤1 wild/set),
the **overlap round-robin toggle** when magic+wild exceed the slot count, the
standard-fill (dup-avoiding), and the final shuffle — all drawn from `DetRng`
instead of `Math.random`, in a **canonical documented draw order** locked by
golden vectors. Frequencies default 0 (wild/magic off) → deals are pure standard,
so a frequency-0 run contains zero wild/magic pieces across many seeded deals.

> **Decision (carried from the kit):** `deal` guarantees ≥1 placeable piece per
> tray by default (the original does not); toggle `guarantee_placeable` (default
> on). Implemented by re-rolling the set when the seeded deal is unplaceable on the
> current board, bounded, deterministically.

## Phases (each ends RED→GREEN, committed at green; co-author trailer required)

Ordered to the shelf's build sequence (core → wasm → front-end → guide/gate), the
way align (A1–A10) did.

- [ ] **B0 — plan + reference (this commit).** Plan doc; reference clone gitignored;
  toolchain (wasm target, deps) confirmed. **Gate:** doc committed; `reference/` in
  `.gitignore`; `git status` clean.

- [ ] **B1 — core: board, shapes, placement, clearing.** `crates/blockdoku-core`
  scaffold (mirror `twenty48-core`): `board.rs` (9×9, occupancy, box indexing),
  `shapes_gen.rs` (extracted catalog) + `tools/extract-blockdoku-shapes.mjs`,
  placement legality, simultaneous row/col/box union-clear, `has_any_placement`,
  `rng.rs` (reuse `DetRng`), `hash.rs`, `RULES.md`. **Gate:** `cargo test -p
  blockdoku-core` green; catalog test asserts 8/38/7=53 + locked catalog hash;
  clearing tests cover a shared-cell row∩box union; no floats on the hashed path.

- [ ] **B2 — core: scoring (frozen constants + golden vectors).** `scoring.rs`:
  placement/line/square/combo/streak per the table, per-component floor by
  multiplier; combo/streak event semantics characterized from `scoring.js`. **Gate:**
  `cargo test` green incl. golden vectors for: a hard-mode score flooring at 0.8×,
  a 2-region combo (+10), a 6-region combo (+…+100), and a streak of 3 (+30).

- [ ] **B3 — core: difficulty + deal.** `difficulty.rs` (four presets, `resolve
  _pool`, `square3x3` drop) + `deal` (accumulator port, overlap toggle, low-freq
  cap, seeded via `DetRng`, `guarantee_placeable`). **Gate:** `cargo test` green;
  frequency-0 deals contain zero wild/magic across 1000 seeded deals; same
  seed+options → identical deal sequence; all four presets + the `square3x3`
  resolution covered.

- [ ] **B4 — core: game state machine + moves + outcome.** `game.rs`: `GameState`
  (board, tray, score, combo/streak, seed, draws, `result`), `enum Move`
  (`Place { piece_slot, row, col }`), `enum MoveError`, `play_move` (place → clear →
  score → refill-when-empty → game-over-when-no-fit), `legal_moves` (canonical
  order: for the selected/each tray slot, anchors row-major), `undo`. `impl Game for
  Blockdoku` (`pond-outcome`), `state_hash` folds score. **Gate:** `cargo test`
  green; golden vector: play N moves → replay `(seed,moves)` re-derives hash+score;
  game-over asserted when tray has no fit; illegal move leaves state unchanged.

- [ ] **B5 — wasm binding.** `crates/blockdoku-wasm` (mirror `twenty48-wasm`): raw
  C-ABI, held `Session`, `OUT` buffer, `new_game(lo,hi)`, `board_json`,
  `tray_json`, `legal_moves_json`, `play_place(slot,row,col)` (0/1/2 status),
  `current_hash`, `is_over`, `undo`, `mark_assistance`, `outcome_json`. Never
  panics. `run.sh` + `check.mjs`. Add `-p blockdoku-wasm` to `tools/build-wasm.sh`;
  add crates to root `Cargo.toml` members + `[workspace.dependencies]`. **Gate:**
  `npm run build:wasm` emits `blockdoku_wasm.wasm`; `check.mjs` asserts deal shape,
  hash == native golden vector, illegal-move rejection, outcome envelope.

- [ ] **B6 — front-end: GameModule + UI + wiring.** `src/games/blockdoku/`:
  `blockdoku-wasm.ts` (typed wrapper, `load("/blockdoku.wasm")`, bigint seed
  split), `blockdoku.ts` (`mount/unmount`, centred column, board+tray render, HUD:
  score/best/combo/streak/difficulty, **tap piece → glow core legal anchors → tap
  to place**, `?seed`/`?r=`, `window.__blockdoku` hook, keyboard: arrows move a
  cursor, 1/2/3 select tray, Enter place, U undo). Register in `registry.ts`
  (`{id:"blockdoku",title,icon:"🟦",status:"playable",load}`), add `"blockdoku"` to
  `build.mjs` `GAME_PAGES` + wasm copy, append `tokens.css` tokens (no raw hex in
  components). **Gate:** typecheck·lint·unit·build green; `tests/blockdoku.spec.ts`
  reachability through `/blockdoku/?seed=0` + legality-glow assertion + axe both
  themes; bump `tests/drawer.spec.ts` count.

- [ ] **B7 — settings, hints, undo (shared).** Wire shared settings (Enable hints,
  Declare assistance); **hints-off → "I'm stuck"** ends + reports whether a legal
  move remained; `bestHint` (prefers the placement completing the most regions,
  tie-break row then col) counts as assistance; undo via core, sets assistance.
  Best-score-per-difficulty persistence via the existing storage layer. **Gate:**
  unit tests for hint selection + assistance flagging; e2e for hints-off end path.

- [ ] **B8 — verifiable end screen + `?r=` share.** `blockdoku-outcome.ts` (mirror
  `2048-outcome.ts`): `encode/decodeRecord` (deflated base64url via `share.ts`),
  `dailySeed`, `verifyRecord` (replay + re-derive hash **and score**). Verification-
  forward game-over screen: final score, seed, record, moves-to-end, one-tap
  re-verify, deflated `?r=` share whose open path re-verifies before display.
  **Gate:** unit round-trip: play→serialize `?r=`→decode→re-verify ok; tampered
  score fails verify.

- [ ] **B9 — daily pack (no solver).** `games/blockdoku/daily-pack.json`
  (`pond-docformat` seed schedule, byte-identically regenerable, embedded/served),
  UTC-day indexed; `build.mjs` copy. Document (RULES + plan) that it is
  score-attack with **no solver** (no win-state to certify). **Gate:** pack test:
  deterministic regeneration; `dailySeed` indexing wraps correctly.

- [ ] **B10 — how-to guide + shots + docs + full gate.** `blockdoku-howto.ts`
  (lead with the interaction model: tap-to-select, tap-to-place; how clears work;
  difficulty; wild/magic if shipped), register in `how-to-registry.ts`; add shots
  to `tools/guide-shots.mjs`; run `build:wasm && build && guide:shots`, commit only
  blockdoku JPEGs. Note the new game in `README.md`/`docs/BUILDING-GAMES.md` if a
  general lesson emerged. **Gate:** `tests/how-to.test.ts` (shots exist) +
  `tests/how-to.spec.ts` green; **full gate**: `cargo test --workspace`, `fmt
  --check`, `clippy` (pedantic, `-D warnings`) for blockdoku crates; `npm run test`;
  `npm run e2e` blockdoku + how-to specs; runtime sane.

### Wild/magic mechanics — scope note

The **38 wild shapes are pure geometry** (a points value + a matrix) and ship as
part of the catalog/deal from B1/B3 — they add no board-state facet. The **7 magic
blocks carry special clear mechanics** (lineClear / bomb-3×3 / lightning-row+col /
ghost-overlap-once) that mutate clearing and interact with scoring and the hash.
They are **opt-in and off by default** in every preset. To keep the determinism-
critical core clean and golden vectors stable, magic mechanics are **sequenced last
and may land as a fast-follow (B4.5 / `TODO/blockdoku.md`)** using the §2 overlay
pattern (an additive per-cell facet so pre-magic vectors don't re-lock) rather than
gating v1. v1 = standard + wild tiers, full scoring, verifiable score-attack.

## Verified Assumptions

- **Scoring constants** (line 15 / square 20 / combo ladder / streak formula /
  per-component floor) — verified in `reference/.../game/scoring.js`
  (`basePoints`, `calculateComboBonus` L~880, `calculateStreakBonus` L915).
- **Shape catalog** = 53 (8 standard + 38 wild + 7 magic), verified by reading
  `blocks.js` `defineBlockShapes()` in full.
- **Difficulty presets** incl. the non-existent `square3x3` in easy's list —
  verified in `difficulty-manager.js` (L16–63).
- **Deal accumulator/overlap/cap logic** — verified in `generateRandomBlocks`
  (`blocks.js` L627–813).
- **Endless / no-win** — the original has no win condition; game ends when no tray
  piece fits. → 2048 outcome model, no solver.
- **Shelf wiring** (crate layout, registry/build/how-to/test points, drawer count
  bump, `DetRng` u32 boundary, `state_hash` shape) — mapped from
  `twenty48-*`/solitaire/align and `docs/BUILDING-GAMES.md`.

## Open Questions (non-blocking; sensible defaults chosen)

1. **Icon** — proposed 🟦 (blue square, the standard block colour). Change if it
   collides visually with 2048's tile in the drawer.
2. **Magic mechanics in v1?** Default: **no** (fast-follow). Flip if desired.
3. **Rotation** — the original supports block rotation (`rotateBlock`). The kit's
   tray model deals fixed-orientation pieces; default **no in-tray rotation** for
   v1 (simpler legality glow), tracked as a possible follow-up.

## Decisions Log

- **2026-08-01:** Adapt the supplied JS kit into the shelf as a **Tier-1 Rust-core
  → wasm** game (user decision), not a standalone Vite PWA. Where the kit's
  `CLAUDE.md`/plan conflict with `docs/BUILDING-GAMES.md`, the standards win.
- **2026-08-01:** Outcome model = **2048** (endless score-attack, verifiable
  `(seed,moves)→score`, `result ∈ {Lost,Stuck,Abandoned}`), **no solver crate** (no
  win-state to certify).
- **2026-08-01:** Placement points = the shape's `points` field; the reference's
  live `basePoints.single=0.5` + speed/multiplier-chain/pattern machinery is **not**
  ported (outside the kit's frozen subset).
- **2026-08-01:** `square3x3` in easy's `allowedShapes` is dropped silently (no
  console/DOM — core purity); easy's effective pool = `{square2x2,l2x2,line2,line3}`.
- **2026-08-01:** The original's `Math.random` deal is re-anchored to the seeded
  `DetRng` stream in a canonical, golden-vector-locked draw order; the deal *logic*
  (accumulators/overlap/cap) is ported faithfully, the exact draw *sequence* is not
  (it can't be — and determinism/replay require a single seeded stream).
- **2026-08-01:** `deal` guarantees ≥1 placeable piece per tray by default (kit
  deviation); toggle `guarantee_placeable`.
- **2026-08-01:** Magic-block special mechanics are opt-in, off by default, and
  sequenced as a fast-follow via the §2 additive overlay pattern; v1 ships standard
  + wild tiers.
