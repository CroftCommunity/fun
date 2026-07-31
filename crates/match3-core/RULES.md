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
   the not-yet set. **Superseded by Track B0** (`plans/2026-07-30-match3-parity-roadmap.md`): the special
   overlay is being introduced phase-by-phase — see "Special candies (overlay)" below. Fish (2×2) is B4.
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
- A **settled** board has no `Empty` cells (every non-blocker cell holds a `Gem`) **and no match** —
  which, from B4, includes no **2×2 square** (the deal's fill forbids the colour that would complete a 2×2,
  and the deadlock reshuffle's "no rest-matches" reads `find_matches`, so a settled board never starts with
  a free fish).
- **Jelly** is a separate per-cell overlay (`layers >= 0`, `0` = none) that sits *under* the cells. It is
  orthogonal to `Gem`/`Blocker`/`Empty`, never moves with gems or gravity, and never affects swap legality.
  A match that clears a cell scrubs **one** jelly layer beneath it (`clear_cells` reports
  `jelly_layers_removed`). The clear-the-jelly objective is met when no jelly remains. Jelly can only be
  removed, so the count is monotone non-increasing under play.

### Special candies (overlay) — Track B0

A **special candy** is a `Gem(color)` carrying a marker in a separate per-cell overlay (`special`, `None` =
plain). It is created when a match forms a qualifying shape (the classification + creation tie-break tables
are added with the shape-detection phases, B0.3–B0.4); its *activation* (the blast) lands later (B1–B4).
The kinds (B0): `StripedH`, `StripedV` (from a line-4), `Wrapped` (from an L/T), `ColorBomb` (from a line-5).
The 2×2 **fish** is deferred to B4 (it needs a new *match* definition, not just a sub-classification of
existing line matches).

Key invariant — **a special is its colour to the match/legality core.** Because the base cell stays
`Gem(color)`, match detection (T1), swap legality, `legal_swaps`, `has_legal_move`, and the deadlock
reshuffle see only the colour and are **byte-identical** to the pre-specials engine. The overlay governs
only: clear (the marker is scrubbed when the cell clears), gravity (unlike jelly, the marker **moves with
its gem** — a special candy falls), hashing (below), rendering, and activation. The overlay marks a cell
**only where it holds a `Gem`**, and is cleared on clear/refill — it never marks a hole or a blocker. (The
clear/gravity clauses are specified in T2/T3 as they are implemented in B0.2.)

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
4. **Deadlock reshuffle.** After the cascade settles, if the board has **no legal swap**, reshuffle:
   deterministically permute the gem cells (a Fisher-Yates shuffle consuming `rng` draws in order,
   **blockers stay fixed**; a gem's **special marker travels with it**, so a shuffled special candy stays
   in sync with its gem) into a board that has a legal swap and no rest-matches, retrying up to 64
   times. A board that already has a legal swap is left untouched and consumes **no draws**, so a
   still-live move is byte-identical to the pre-reshuffle engine. Because the reshuffle lives here (not
   in the UI) and folds into the state hash, `Match3::replay` — which just re-applies `play_move` — is
   reproduced exactly, so the outcome stays verifiable. The reshuffle is unit-tested in
   `tests/reshuffle.rs`; on the shipped 8×8/6 deal a post-move deadlock is astronomically rare, so no
   golden vector's final board is deadlocked (adding the reshuffle changed no locked hash).

## Tie-break tables (the fully-specified, cross-build-stable order)

These exist so a native build and a wasm build produce **bit-identical** traces. Anything ambiguous here is
a determinism bug.

### T1 — Match detection

- A **match** is a maximal run of ≥ 3 cells holding `Gem` of the **same** colour, contiguous within a single
  row (horizontal) or single column (vertical), **or** a **2×2 square** of four `Gem` cells all the same
  colour (B4, Option A — a 2×2 is a first-class match, so it makes a swap legal, clears, and is avoided by
  the deal, all from the one `find_matches` authority).
- `Blocker` and `Empty` cells break runs and are never part of a match; a 2×2 square is likewise only ever
  four gems.
- The set of matched cells is the **union** of all horizontal and vertical runs **and every 2×2 square's
  four cells**. A cell shared by intersecting runs / squares appears **once**. Because the result is a set,
  detection order does not affect the outcome — but the canonical scan is rows top→bottom, then columns
  left→right, then 2×2 squares by top-left anchor (rows top→bottom, cols left→right).

### T1b — Shape classification + special creation (B0.3)

Beyond the flat match set (T1), a match's **shape** decides which special candy
it creates. `find_runs` returns the maximal same-colour runs of ≥3 (rows first,
top→bottom/left→right; then columns, left→right/top→bottom) — the *union* of run
cells is exactly `find_matches`, so the clear set is unchanged. Runs sharing a
cell form a **component**; each component creates **at most one** special, by
this priority:

| Component shape | Special | Priority |
|---|---|---|
| a run of length ≥5 | `ColorBomb` | 1 (highest) |
| both a horizontal and a vertical run (L/T) | `Wrapped` | 2 |
| a single run of length 4 | `StripedH` (horizontal) / `StripedV` (vertical) | 3 |
| a **pure 2×2 square** (no ≥3 line run through it) | `Fish` (B4) | 4 |
| a single run of length 3 | none (plain clear) | — |

**Fish (B4) is below every line shape.** A `Fish` is created only from a **pure**
2×2 — one whose four cells lie in **no** ≥3 line run — so a 2×2 that is part of a
longer line (a 2×3/3×2/L is a line component) makes that line's special, not a fish.
Pure squares are pairwise disjoint (any overlap would form a line run), so each
makes exactly one fish. Placement: the **swapped candy** (`to`, else `from`) if it
is one of the four cells, else the square's **top-left** cell (earliest row-major).

**Creation placement (tie-break table).** The special spawns on one cell of the
component; the other matched cells clear normally (so a 4-run scores 3 cleared
gems, not 4 — the survivor is *transformed*, not cleared). The placement cell:

1. **Step 0 (the swap-triggered step):** if the swapped candy (`to`, else
   `from`) lies in the candidate set, spawn there (Candy-Crush "at the moved
   candy"). Candidates are the **junction cells** (shared by ≥2 runs) for
   `Wrapped`, else the **dominant run's cells** (the longest; ties keep the
   earlier in scan order).
2. **Otherwise (cascade steps, or no swapped candy in the set):** the anchor —
   the earliest (row, col) junction for `Wrapped`, else the dominant run's
   **median** cell (`cells[len/2]` in scan order).

The created special's colour is the component's (or square's) gem colour.
Blast/activation of a created special is in T1c (striped B1, wrapped B2, colour
bomb B3, fish B4).

### T1c — Activation (striped B1, wrapped B2, colour bomb B3, fish B4)

A special candy **fires** its blast when it is cleared by a match (or swapped).
Before the clear (T2), the matched set is expanded by activation:

- **Trigger:** a special fires when (a) it is in the matched set
  (match-activation: striped, wrapped, fish), or (b) it is **swapped** with an
  adjacent gem — the swap is legal even with no line match, and fires the special
  from its post-swap cell (swap-activation: striped B1.2, wrapped B2.2, colour bomb
  B3, fish B4.2). Swapping carries the special marker with its gem. Swapping two
  specials is the combo matrix (B5) — B1/B2/B3/B4 fire each independently.
  - **The colour bomb is swap-only.** It is **colourless** (its overlay sits on a
    `Gem` only because the match core stays byte-identical — the underlying colour
    is a representation artifact, not a play colour), so it is **never match-fired**:
    a colour bomb caught in a line match just clears as a gem. It fires only when
    **swapped** (B3), and a colour-clear that sweeps up another colour bomb does not
    detonate it (that, and swapping two specials, is the B5 combo matrix). Revisable
    pre-users.
- **Blast region:**
  - **Striped:** `StripedH` clears its entire **row**, `StripedV` its entire
    **column** (orientation = stripe direction; revisable pre-users).
  - **Wrapped:** the **3×3 block** around its cell, clamped to the board.
  - **Colour bomb:** not a positional region — it clears **every cell holding a gem
    of the target colour** (the colour of the gem it was swapped with) plus its own
    cell (consumed). A striped/wrapped of that colour caught in the clear **fires**
    (chains) — e.g. detonating "all red" sets off a red striped's line.
  - **Fish (B4.2):** not a positional region — a fired fish **swims to one target
    cell and eats it** (plus its own cell, consumed). The target is chosen by a
    **seeded, pinned** rule: from the highest non-empty tier — (1) a **jellied**
    cell, else (2) any other **gem** — pick `rng.index(candidates.len())` over the
    candidates in **row-major** order (the fish's own cell excluded). The target is
    always a gem, so it clears via T2 (scrubbing its jelly, chipping adjacent
    blockers); a striped/wrapped target **chains**. Direct blocker-eating is a
    revisable follow-up. **A fish fires only when matched or swapped** (drawing its
    target in `resolve_move`); a fish merely caught in another special's blast just
    clears (no target). Multiple fired fish draw in scan order, **before that step's
    refill**, so the draw order is fixed and folds into `draws`/`state_hash` — the
    first activation that consumes RNG. (Fish + special / fish + fish by swap are the
    B5 combo matrix.)
  - A **blocker** in a blast region is *not* cleared — it takes one layer of
    adjacency damage via T2 like any match. (A blocker is never `Gem(target)`, so a
    colour detonation leaves it standing, minus its one adjacency layer.)
- **Wrapped = a double 3×3 (the canon "explodes twice").** A wrapped's blast
  happens in two stages so it faithfully mirrors the reference:
  1. **First blast** (the step it is triggered): clears the 3×3 **minus its own
     centre** — the wrapped candy **survives**. It is **pinned** through that
     step's gravity (T3): candies fall in *around* it while it holds its cell.
  2. **Second blast** (the next cascade step): the pinned wrapped fires again,
     clearing the **full 3×3 including its own cell** — it is now consumed. It
     produces no third blast.
  The pending re-blast is a transient carry within the one `play_move` resolution;
  because the wrapped is pinned it does not move, so the re-blast fires from the
  same cell. This carry is **not** part of `state_hash` (the hash is only taken on
  the settled board between moves) — every cascade step is still a pure function of
  the board, so replay reproduces the double bit-identically.
- **Chaining:** if a blast cell holds another firing special, that special fires
  too (a chained wrapped does its own full double — first blast, pin, re-blast).
  Resolution is a deterministic set-union (each cell fires at most once; the result
  is order-independent), so it reproduces identically on every device.
- **Survivors are protected.** A wrapped surviving its first blast is subtracted
  from the clear set, so a simultaneous blast (e.g. a striped's line sweeping
  through it) cannot destroy it before its re-blast. This is the same protection a
  **just-created special** (T1b) gets — it is restored after the clear, so a
  simultaneous blast over its cell does not destroy it (transformed, not cleared).
  Special-meets-special *by swap* is the combo matrix (B5); B1/B2 do no combos.
- **Scoring/jelly/cascade:** blast-cleared gems score +10 each (flat, T2); jelly
  under a blasted cell scrubs one layer (a wrapped's own centre scrubs jelly only
  on the **second** blast, since it is not cleared on the first); the expanded
  clear feeds gravity/refill and can cascade like any step.

### T1d — Combos (special + special by swap, Track B5)

Swapping **two specials** together produces a single combined blast larger than
firing each — the combo matrix. Detection + dispatch (step 0 only):

- **Dispatch rule.** If **both** swapped cells hold a **non-fish** firing special
  (`StripedH`, `StripedV`, `Wrapped`, `ColorBomb`), the swap is a **combo**: both
  specials are **consumed** (they do not fire individually) and the combined blast
  is computed instead. If either cell is a **fish**, there is **no combo** — the
  existing independent path runs (each special fires on its own; fish combos are a
  deferred follow-up). A single special swapped with a plain gem is likewise not a
  combo (it fires alone — B1.2/B2.2/B3/B4.2).
- **Combo centre = the destination cell `to`.** The blast is centred on `to` (the
  moved candy's landing — the same "at the moved candy" convention as creation).
  Because `from`/`to` are orthogonally adjacent, a cross / thick cross / 5×5 centred
  on `to` always contains `from` too, so both specials clear.
- **The striped/wrapped combos (B5.1)** — blockers excluded from every region (a
  blocker in the region takes one adjacency layer via T2, like any blast):

  | Combo | Blast |
  |---|---|
  | striped + striped | the **full row** ∪ **full column** through `to` (a cross) |
  | striped + wrapped | a **3-wide row band** ∪ **3-wide column band** through `to` (a thick cross, clamped) |
  | wrapped + wrapped | the **5×5 block** around `to` (clamped) |

  (`StripedH`/`StripedV` are both "striped" for combos — orientation is irrelevant.)
- **The colour-bomb combos (B5.2)** — bomb + striped turns **every gem of the
  partner's colour** into a striped (∪ each such cell's row + column); bomb + wrapped
  into a wrapped (∪ each 3×3); **bomb + bomb clears the entire board**. Computed as a
  **direct equivalent clear-set** (not by materializing intermediate specials).
- **Realization note (revisable pre-users).** wrapped + wrapped is a **single** 5×5
  clear — both specials are consumed, so there is no surviving centre to pin +
  re-blast (unlike a lone wrapped's canon double, T1c).
- **Chaining.** A **real** firing special the combo blast sweeps up (a striped /
  wrapped elsewhere on the board — **not** the two combo sources) fires too, via the
  same set-union chain queue the single-special blasts use (T1c). Deterministic and
  order-independent. The two combo sources are marked fired first, so they never
  fire individually.
- **No creation on a combo step.** A combo spawns no new special (both sources are
  consumed); creation (T1b) is suppressed for a combo's step.
- **Scoring/cascade:** flat T2 (+10/gem, +20/blocker layer); the combined clear
  feeds gravity/refill and cascades like any step. A combo consumes both specials,
  so it produces no `pending`/re-blast of its own (a **chained** wrapped bystander
  still does its own double).

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
- **Special overlay (B0.2):** a cleared cell's `special` marker is **scrubbed**
  with the gem (an `Empty` hole carries no marker). Activation of a *matched*
  special (its blast) is B1+; B0 creation, which spawns a special on a survivor
  cell of a qualifying match, is applied after the clear (B0.3–B0.4).

### T3 — Gravity (blockers are fixed shelves)

- Applied **per column**, columns processed left→right (column order cannot affect the result, but is fixed
  for auditability).
- Each column is partitioned into **segments** by its blocker cells: a segment is a maximal contiguous run
  of non-blocker cells bounded by blockers and/or the grid edges. Blockers never move.
- Within a segment, all `Gem` cells fall to the **bottom** of that segment, preserving their relative order;
  the `Empty` cells collect at the **top** of the segment.
- **Special overlay (B0.2):** a gem's `special` marker falls **with it** — the
  overlay moves in lockstep with its gem (a special candy falls), unlike jelly,
  which never moves. Vacated holes carry no marker. (Jelly stays fixed under the
  cell; only the gem-attached special layer moves.)

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
        || IF any cell is jellied:     "j\x00" || for each cell: jelly_layers(u8)
        || IF any cell has a special:  "s\x00" || for each cell: special_tag(u8)
```

where `special_tag` is `0x00` (no special), `0x01` `StripedH`, `0x02` `StripedV`, `0x03` `Wrapped`,
`0x04` `ColorBomb`, `0x05` `Fish` (never renumber a shipped tag — it is part of the fingerprint).

Both overlay sections are appended **only when some cell carries** that overlay, so a gem-only board hashes
exactly as it did before the overlays existed — every pre-jelly / pre-specials golden vector stays valid
without a re-lock. The order is fixed: cells, then the jelly section (if any), then the special section (if
any), so a jelly-only board is unaffected by the special section and vice-versa.

Replaying `(seed, initial board, moves)` MUST reproduce the identical `state_hash` on every run and on every
build target. That is the property P8 (score verification) and the follow-chain leaderboard later depend on.

## Golden-vector corpus

`vectors/*.json`. Each vector is a hand-authored input plus the hand-computable expectations; the recorded
`final_state_hash` is a regression + cross-build determinism anchor (locked once the engine is green — it is
a recorded output, by construction not hand-derivable). Schema in `vectors/README.md`.

## Per-deal par (the star thresholds) & versioning

Target-score star thresholds come from a **player ladder** — three deterministic players of increasing
strength — so stars mean "you played as well as a {weak, competent, strong} solver":

- **1★ = `random_score`** — a random-legal-move player (a gentle floor most players pass).
- **2★ = `reference_score`** — the greedy best-swap playout (competent play).
- **3★ = `reference_score_beam` (beam-8)** — a less-myopic beam that provably scores ≥ greedy
  (strong-but-attainable). Deeper beams (16/32/64) keep climbing — there is no cheap near-optimal
  ceiling — so they stay as headroom / the "100% reference", never a star bar.

The strong player is too slow to run live at verify time, so `par_tiers(seed)` (in `match3-solver`) is
computed **offline** into a committed table (`games/match3/par-pack.json`, kind `match3-par-pack`), which
the binding **embeds** (`include_bytes!`) and looks up. Daily target-score seeds are in the table; a
free-play / `?seed=` board off the table falls back to the cheap live greedy tiers (30/60/90% of
`reference_score`) — a pure function of the seed, so play-time and verify-time still agree.

**Par is a rules version.** `verify` re-derives targets from the seed, so changing the ladder, the table,
or the fallback re-grades every past record. With no users the par may change in place (`Match3::VERSION`
stays 1); once records exist in the wild, any par change is a `VERSION` bump that keeps the old par for
old-version records (read the version from the `pond-docformat` envelope). Do not change par silently.

## Out of P1 (explicit not-yet set)

Special tiles (**now being added in Track B0** — see "Special candies (overlay)" above);
cascade multipliers and par bands; level generation (P4); saves and share codes (their
compatibility-matrix sustainment is P10); the P2 version-and-unknown-field document policy; anything
network / iroh / resolver. P1 is a pure, headless, deterministic core.
