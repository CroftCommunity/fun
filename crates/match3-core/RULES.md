# Match-3 (candy-crush-style) — P1 rules document + tie-break tables

**Status:** P1 (the determinism foundation). This is the *first* deliverable of the per-pond build
discipline (`beta/croft/build-order-and-ponds-roadmap.md` → "Per-pond build discipline"): the rules
document and the golden-vector corpus come *before* the engine, and the engine is grown red-first against
them. The property P1 exists to establish is **verifiable outcomes**: a `(seed, initial board, move list)`
triple fully determines every subsequent state, and replaying the move list reproduces the same
**state hash**.

Source narrative: `alpha/seeds/transcripts/raw/croft-games-pond-roadmap-browser-p2p-phased-build-2026-07-22.md`
(the P1 blocking decisions + run brief).

## P1 scope (the three blocking decisions, as decided)

1. **Language:** Rust → wasm. Chosen for the native-plus-wasm cross-build determinism test the guide calls
   "essentially free," and to match the existing Cargo workspaces under `alpha/Proofs/`.
2. **Specials in v1:** none. Plain match-3 only. All special tiles (striped / wrapped / colour-bomb) are in
   the not-yet set.
3. **One representative blocker:** yes — one **layered blocker** tile, so the layered-cell code path is
   exercised by something real in P1.

Deliberately **not** decided here (owner balance decisions, surfaced not resolved): cascade score
multipliers, per-level par bands, the special-tile set. P1 uses the simplest defensible scoring so no
balance decision is smuggled in.

## Board model

- The board is a `width × height` grid of cells, addressed `(row, col)` with `row = 0` at the **top**.
  Gravity pulls toward larger `row`.
- A cell is one of:
  - `Gem(color)` — a movable coloured tile. `color` is `0..colors` (v1: `colors = 6`).
  - `Blocker { layers }` — a fixed, non-movable, non-matchable tile with `layers >= 1` remaining.
  - `Empty` — a transient hole that exists only mid-resolution (between clear and refill).
- A **settled** board has no `Empty` cells: every non-blocker cell holds a `Gem`.

## The deterministic RNG

- One `ChaCha20Rng` seeded from the game's `u64` seed (the same determinism primitive as
  `alpha/Proofs/lineage-groups/.../rng.rs`). Refill colours are the only consumer.
- A colour is drawn as `rng.index(colors)` (uniform in `0..colors`).
- The number of draws consumed is tracked (`draws`) and folded into the state hash, so RNG position is part
  of verifiable state.

## The turn: `play_move(from, to)`

A move swaps two cells. Resolution order:

1. **Legality.** The move is legal iff **all** hold; otherwise it is rejected and the board is unchanged:
   - `from` and `to` are orthogonally adjacent (Manhattan distance 1);
   - both `from` and `to` are `Gem` cells (you cannot swap a blocker or a hole);
   - performing the swap yields a board with **at least one match** (see below).
2. **Swap.** Exchange the two gems.
3. **Resolve to stable** (the cascade loop): repeat until a step finds no matches —
   a. find all matches; if none, stop;
   b. clear + score (and decrement adjacent blockers);
   c. gravity;
   d. refill.
   Each iteration is one **cascade step**; step 0 is the one triggered directly by the swap.

## Tie-break tables (the fully-specified, cross-build-stable order)

These exist so a native build and a wasm build produce **bit-identical** traces. Anything ambiguous here is
a determinism bug.

### T1 — Match detection

- A **match** is a maximal run of ≥ 3 cells holding `Gem` of the **same** colour, contiguous within a single
  row (horizontal) or single column (vertical).
- `Blocker` and `Empty` cells break runs and are never part of a match.
- The set of matched cells is the **union** of all horizontal and vertical runs. A cell shared by an
  intersecting horizontal and vertical run appears **once**. Because the result is a set, detection order
  does not affect the outcome — but the canonical scan is rows top→bottom, then columns left→right.

### T2 — Clear + scoring

- All matched cells become `Empty` **simultaneously** (one set, not sequential).
- **Blocker damage:** a blocker loses **exactly one** layer this step if **at least one** matched cell is
  orthogonally adjacent to it — regardless of how many matched cells are adjacent (at-most-one-layer-per-step
  is the rule, so damage is independent of match count and order). A blocker reaching `0` layers becomes
  `Empty` in the same step.
- **Score (P1, deliberately flat — no cascade multiplier):**
  - `+10` per gem cleared;
  - `+20` per blocker layer removed.
  - Score is accumulated across all cascade steps of the move.

### T3 — Gravity (blockers are fixed shelves)

- Applied **per column**, columns processed left→right (column order cannot affect the result, but is fixed
  for auditability).
- Each column is partitioned into **segments** by its blocker cells: a segment is a maximal contiguous run
  of non-blocker cells bounded by blockers and/or the grid edges. Blockers never move.
- Within a segment, all `Gem` cells fall to the **bottom** of that segment, preserving their relative order;
  the `Empty` cells collect at the **top** of the segment.

### T4 — Refill

- Only `Empty` cells are filled; `Blocker` cells are untouched.
- **Draw order** (this fixes which RNG value lands where): columns left→right; within a column, segments
  top→bottom; within a segment, the `Empty` cells top→bottom. Each `Empty` cell consumes the next
  `rng.index(colors)`.
- After refill the board is settled (no `Empty`), and the cascade loop re-checks for matches (T1).

## State hash (the verifiable-outcome anchor)

`state_hash` = lowercase hex of `SHA-256` over the canonical encoding:

```
"m3\x00" || width(u32 LE) || height(u32 LE) || colors(u32 LE)
        || draws(u64 LE) || score(u64 LE)
        || for each cell in row-major order: one tag byte
             Empty        -> 0x00
             Gem(c)       -> 0x01, c(u8)
             Blocker(l)   -> 0x02, l(u8)
```

Replaying `(seed, initial board, moves)` MUST reproduce the identical `state_hash` on every run and on every
build target. That is the property P8 (score verification) and the follow-chain leaderboard later depend on.

## Golden-vector corpus

`vectors/*.json`. Each vector is a hand-authored input plus the hand-computable expectations; the recorded
`final_state_hash` is a regression + cross-build determinism anchor (locked once the engine is green — it is
a recorded output, by construction not hand-derivable). Schema in `vectors/README.md`.

## Out of P1 (explicit not-yet set)

Special tiles; cascade multipliers and par bands; level generation (P4); saves and share codes (their
compatibility-matrix sustainment is P10); the P2 version-and-unknown-field document policy; anything
network / iroh / resolver. P1 is a pure, headless, deterministic core.
