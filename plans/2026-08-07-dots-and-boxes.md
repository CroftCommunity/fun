# Dots and Boxes — the fourth adversarial game

status: **Pass 1 + Pass 2 complete.** Executing: Phases 1–10 are in (Phase 3a
dropped; Phase 4 run late, after Phase 8). Next: Phase 11.

owner decisions (2026-08-07): **3×3 boxes** (4×4 dots, 24 edges, 9 boxes) and the
**full §10 checklist** including the experimental WebGPU hybrid.

## Problem Statement

The shelf has three adversarial games (Drop 4, Othello, checkers) and a shared
stack behind them: `adversary_core::Adversary`, `adversary_solver`'s
class-preserving band + `NodeBudget`, the tutor, `hybrid-player.ts`, and the
game-agnostic scoring rig behind `GameOracle`. Checkers spent the rule-of-three
trigger on 2026-08-06, so the abstraction has a generality proof and the next
adversarial game no longer has to be one.

Dots and Boxes is the next game from discovery's 2026-06-21 catalog
(`discovery/alpha/thinking/app/ponds/games-pond-authoritative-list.md`, entry 6 —
"the most underrated pick on the list"). It is unbuilt, ungated (no P2P
dependency), trademark-clean (a folk game with a generic name), and it exercises
**two shapes none of the three shipped games have**:

1. **A move that does not pass the turn.** Completing the fourth side of a box
   scores it and the mover moves *again*. Every shipped game alternates strictly;
   Othello's pass is still a turn transfer. This is the first game where
   `side_to_move` genuinely is not a function of move parity.
2. **A value that is a score margin, not a win/draw/loss class.** Drop 4, Othello
   and checkers all produce a value the band buckets into three classes. Here the
   natural value is a **box differential**, and the class is derived from its
   sign — with **no draw reachable at all** on an odd box count.

Both are places the shared code could turn out to be secretly game-specific. If
it carries them, the abstraction is stronger than the checkers proof showed. If
it does not, the seams are worth finding now rather than at chess.

## Reasoning

### Why 3×3 boxes

24 edges, 9 boxes, ~24 moves — a one-minute game, the same tempo as Drop 4, and
the size where an exact endgame solve is plausibly reachable rather than
aspirational. The odd box count means **no draw is reachable**, which is a real
property worth asserting rather than a quirk to paper over.

4×4 (40 edges) was rejected for this build: it is far beyond an exact solve from
the opening, so the tutor would hedge for nearly the whole game, and the game runs
long enough to lose the shelf's one-minute character. A size picker was rejected
as multiplying the solver tuning, the tractability threshold, and the record
format by the number of sizes for no proof we do not already get from one.

**The size is not painted into a corner.** `ROWS`/`COLS` go into `state_hash` as
little-endian `u32` (the Drop 4 precedent), so adding a size later is additive and
does not re-lock any golden vector recorded now.

### Why the search value is a margin, and why the memo key is the edge set alone

The standard formulation, and the reason this game is cheap to search correctly:

```
negamax(edges) -> the best future box margin for the side to move
  for each free edge e:
      k = boxes that edge e completes
      if k > 0:  v = k + negamax(edges | e)     // mover keeps the turn
      else:      v =    -negamax(edges | e)     // turn passes, flip perspective
  return max v          terminal (all edges drawn) -> 0
```

**Who owns the already-completed boxes cannot affect future play** — it only
shifts the running score. So the future value depends on `edges` and nothing else,
and the memo key is the 24-bit edge mask with no score or side component. That
makes the table a **flat `Vec<i8>` of 2^24 entries — 16.7 MB — not a HashMap**,
which matters because it is the difference between a viable wasm allocation and an
unviable one.

The per-move value the band and tutor consume is then the **final** margin from
the mover's perspective: `(mover_boxes - opponent_boxes) + v`. Class is its sign.
`exact` is true iff the search that produced it completed without the budget
truncating it — never derived from the position.

### Why the honesty flag will still matter (and why Phase 0 exists before the solver)

A full solve from the empty board is roughly 2^24 subsets × ~12 children ≈ 200M
node expansions. That is seconds natively and plausibly tens of seconds in wasm —
**not a first move a browser can make.** So the expected shape is Othello's, not
Drop 4's: **heuristic depth-capped early, exact once the remaining edge count
drops below a measured `TRACTABLE_EDGES`**, with the tutor's wording bound to the
flag.

That is a prediction, and this repo's most expensive recent lesson (P9, the
midgame latency floor) is that predictions about search cost here are wrong more
often than they are right — five plan claims were refuted by their own
measurements on 2026-08-07. So **Phase 0 measures the knee before the solver is
designed around a number**, and the plan below deliberately does not commit to
`TRACTABLE_EDGES = 16` or to needing a heuristic at all. If the measurement says
the whole game is exact in budget, the heuristic path is deleted from Phase 3
rather than shipped unused.

### Alternatives considered and rejected

- **Wrap an existing implementation (Tier 2).** No candidate on the discovery
  catalog is a packaged Dots and Boxes that clears the inclusion filter, and the
  rules are far simpler than an integration — the exact condition the catalog
  gives for build-fresh.
- **Alpha-beta instead of a memoized plain negamax.** Alpha-beta values are
  window-relative, so they cannot be stored in a flat exact-value table without
  bound bookkeeping. The flat table is the reason the endgame is cheap; keep it
  exact-valued and spend the budget on move ordering instead.
- **Chain/loop decomposition** (the Berlekamp endgame theory that makes large
  boards tractable). Genuinely the right answer at 5×5 and a large amount of
  theory to get wrong. Out of scope at 24 edges.
- **Modelling the extra turn as a "null move" for the opponent.** Would keep
  strict alternation and let the move list stay parity-readable, at the cost of
  putting a fictional move in the verifiable record. Rejected: the record must
  describe what happened.

## Verified Assumptions

Each confirmed by reading the named file, not inferred.

- **`Adversary` does not assume alternation.** `side_to_move(pos: &Position)` is
  state-derived (`crates/adversary-core/src/lib.rs:95`). The trait needs no change
  for the extra-turn rule. The crate's *doc comment* says "the alternating move
  list of both sides" (`lib.rs:9`) — prose that becomes wrong with this game and
  is corrected in Phase 13.
- **The scoring rig does not assume alternation.** `runMatch` picks the player
  from the live board every iteration — `game.board().toMove === 1 ? a : b`
  (`src/harness/match-runner.ts:242`) — and `gradeSide` re-derives whose move it
  is during replay: `board.result === -1 && board.toMove === side`
  (`src/harness/scorer.ts:113`). Neither indexes by move parity. `match-runner.ts:72`
  carries the same "alternating moves" prose to correct.
- **A move is a plain number on the port.** `GameOracle.play(code: number)` /
  `legalMoves(): number[]` (`src/harness/game-oracle.ts`). An edge index `0..23`
  needs no packing — unlike checkers' 14-bit `(from, to, variant)`.
- **A level is `0..3` on the port**, each game owning its own top-level word
  (`game-oracle.ts`, the "two contracts" note).
- **`seed` may legitimately be unused by the rules.** Drop 4 does exactly this and
  documents it (`crates/drop4-core/RULES.md:52-56`); the seed instead seeds the
  opponent's difficulty RNG in the wasm (`crates/drop4-wasm/src/lib.rs:92`), which
  is how the tournament varies games (`baseSeed + i`, `tournament.ts:65`).
- **The band selector is generic over the move type** and deliberately excludes
  `capped_class` and `live_band` as per-game judgement
  (`crates/adversary-solver/src/lib.rs:18-27`). Our `class_of` (sign of a margin)
  is a legitimate instance.
- **`NodeBudget` is nodes, never a clock**, because the baselines assert exact
  Reports and the wasm has no host time import (`adversary-solver/src/lib.rs:84-99`).
- **`deepen` is not automatically worth adopting** — measured +14% on checkers,
  −41% on Othello (`docs/BUILDING-GAMES.md` §10). Phase 12 measures ours.
- **Wiring points for a new game** are `src/registry.ts`, `src/how-to-registry.ts`,
  `GAME_PAGES` + the wasm copy step in `build.mjs`, and the `-p <game>-wasm` list
  in `tools/build-wasm.sh:19`. Confirmed by grepping `checkers` across all four.

**Explicitly unverified** (Phase 0 resolves): the cost of an exact solve at each
remaining-edge count; whether a heuristic eval is needed at all; the game value of
the empty 3×3 board; whether a 16.7 MB flat table allocates acceptably in wasm.

## Documentation Impact

- `crates/dots-core/RULES.md` — **new.** The core's contract (Phase 1).
- `docs/BUILDING-GAMES.md` §10 — the fourth reference implementation; the
  extra-turn shape and the margin-valued band; correct "two sides alternate" where
  it is now false. Phase 13.
- `docs/AI-PLAYERS.md` — a "generality: a fourth game" note covering the margin
  value and the no-draw class; the measured search-cost table. Phase 13.
- `crates/adversary-core/src/lib.rs:9` doc comment and
  `src/harness/match-runner.ts:72` — "alternating" prose, now false. Phase 13.
- `docs/HARNESS.md` → "Adding your game to the rig" — add dots as a worked
  example if the adapter needs anything the three do not. Phase 10.
- `TODO/dots.md` — **new** per-game backlog. `TODO/README.md` — move Dots and
  Boxes into shipped, and (the gap found on 2026-08-07) **add the pointer to the
  three discovery catalogs** the next-games list currently omits. Phase 13.
- `README.md` — grepped: it lists games; add the entry. Phase 13.
- `docs/STATE-OF-PLAY.md` — not touched. It is a dated snapshot, not a living doc;
  a new game does not retroactively change what was true on 2026-08-06.

## Concurrency Map

All phases sequential. Each phase reads what the prior wrote (core → solver →
wasm → front end → harness), and every phase after Phase 5 shares the same
`build.mjs` / `registry.ts` / `dist/` write-set, so no two are disjoint. The
Phase 0 spike is the only phase that could run beside anything, and nothing exists
yet for it to run beside.

## Phases

### Phase 0: Discovery — what does an exact solve actually cost?

**Goal:** Replace the plan's search-cost predictions with measurements before the
solver is designed around them.

**Discovery Exemption applies** — no TDD in this phase. Disposition per task
below.

**Changes:**
- [ ] Throwaway native spike (`spike/dots-solve/`, outside the workspace or a
  `#[ignore]`d test): edge indexing, box-completion, memoized negamax over a flat
  `Vec<i8>` keyed by the 24-bit mask. *Disposition: promote* — the recurrence and
  indexing are the real Phase 1/3 code; the harness around it is throwaway.
- [ ] Measure, from the empty board and from positions with 24/20/18/16/14/12
  free edges: nodes expanded, wall time, and peak table occupancy. Positions
  sampled by playing random legal openings from a fixed seed.
- [ ] Record the **game value of the empty board** (who wins 3×3 with perfect play,
  and by how much).
- [ ] Allocate the 16.7 MB table under `wasm32-unknown-unknown` and confirm it
  works, or find the ceiling.
- [ ] Write the numbers into this plan under a **Phase 0 findings** heading, and
  pick `TRACTABLE_EDGES` from the knee — the largest free-edge count whose worst
  measured solve is comfortably under the 400ms per-move target §10 uses.

**Call chain:** None — this phase ships no product code.

**Wiring test:** None (discovery). The gate is that the findings section exists
and names a `TRACTABLE_EDGES` with the measurement behind it.

**Depends on:** Nothing.

**Read-set:** `crates/adversary-solver/src/lib.rs`, `crates/drop4-solver/src/solver.rs`.

**Write-set:** `spike/dots-solve/**`, this plan doc.

**Shared-state contract:** No mutable state beyond the file write-set. Binds no
ports, starts no daemons, does not touch `Cargo.toml` (the spike is not a
workspace member).

**Risks:** The knee may be low enough (say ≤ 12 free edges) that the tutor hedges
for most of the game and the opponent leans on a heuristic that has not been
designed yet. That is a finding, not a failure — it sets Phase 3's shape. The
opposite risk is worse: assuming a heuristic is needed and shipping one that never
runs.

**Done when:**
1. **Behavioral:** The plan states, with numbers, what an exact solve costs at each
   remaining-edge count, whether a heuristic eval is needed, and what
   `TRACTABLE_EDGES` is.
2. **Verification:** `cargo run --release` in the spike prints the table; the
   findings section quotes it.

**Validation:** Broad. Measurements are the deliverable, and a wrong one here
propagates into every later phase. Take each measurement at more than one sampled
position and report the worst, not the median — the P9 lesson was that a single
top-level measurement hid an entire pathology.

### Phase 0 findings (measured 2026-08-07, `spike/dots-solve/`)

**The cost is analytic, not empirical.** Every subset of the free edges is
reachable from a position with `f` free edges, so a fully memoized solve expands
exactly `2^f - 1` nodes — the "worst of 8 sampled positions" column came back
identical to the median because there is no variance to sample. That is a stronger
statement than a measurement: the cost is a closed form.

| free edges | nodes | native (M4, release) |
|---|---|---|
| 24 (empty board) | 16,777,215 | 1,185 ms |
| 22 | 4,194,303 | 298 ms |
| 20 | 1,048,575 | 55 ms |
| 18 | 262,143 | 13 ms |
| 16 | 65,535 | 3.6 ms |
| 14 | 16,383 | 0.8 ms |

**The recurrence is validated against hand-derivable values**, which was the named
Phase 3 risk (a flipped sign yields a confidently anti-optimal engine). Asserted in
`spike/dots-solve/src/bin/validate.rs`:

| board | boxes | value (A − B) | check |
|---|---|---|---|
| 1×1 | 1 | **−1** (A 0 : B 1) | hand-derivable: four edges, strict alternation, so the *second* player takes the only box. Asserted. |
| 1×2 | 2 | 0 (A 1 : B 1) | |
| 2×2 | 4 | +2 (A 3 : B 1) | |
| 2×3 | 6 | −2 (A 2 : B 4) | |
| 3×3 | 9 | **−3** (A 3 : B 6) | matches the published result that 3×3 is a second-player win |

**Finding 1 — 3×3 is a second-player win, 6–3.** This is a design fact, not
trivia: **a human who opens against a perfect engine loses, always.** Drop 4 has
the opposite polarity, so the shelf's existing habit of putting the human on side A
would make Perfect unbeatable here by construction. Consequence for Phase 6: the
player **chooses who opens**, defaulting the human to **second** so that Perfect is
winnable. No core change — `Side::A` still opens and the record stays A-centric;
this is the front-end side assignment Drop 4's `RULES.md` already anticipates.

**Finding 2 — a baked opening book removes the heuristic entirely.** The plan
expected Othello's shape (heuristic early, exact in the endgame). Measurement says
we can do better: the gap between "affordable live" and "too slow" is only the
first few plies, and a **build-time** solve can bake them.

| layers baked (edges drawn) | positions | per-move value pack | live exact starts at |
|---|---|---|---|
| 0..=1 | 25 | 0.6 KB | 22 free — 298 ms native, too slow |
| **0..=3** | **2,325** | **≈ 49 KB** | **20 free — 55 ms native** |
| 0..=5 | 55,455 | ≈ 1.07 MB | 18 free — 13 ms native |

Chosen: **bake layers 0..=3** (every position with at most 3 edges drawn),
live-solve exactly from 20 free edges down. 49 KB of baked data, and the build-time
generator is a 1.0 s full solve — byte-identically regenerable, which is exactly the
§3 "build-time solver certifies a pack" machinery already on the shelf.

Note the pack stores the value of **every legal move**, not just the best one: the
difficulty band buckets classes across moves and the tutor reports all of them, so
a best-move-only book (55 KB at depth 5) would not serve either.

**Finding 3 — the memo should be a compact per-move table, not a 16.8 MB flat
one.** The plan reasoned its way to a `Vec<i8>` of 2^24 entries because the key is
the 24-bit mask. Better: remap the root's `f` free edges onto bits `0..f` and index
by that compact submask, giving `2^f ≤ 2^20` entries — **1 MB, not 16.8 MB**, which
matters in wasm. The cost is that the table is only valid for one root, so it is
rebuilt each move rather than warmed across a game; that is *cheaper*, not dearer,
because the whole-game total is `2^20 + 2^19 + … ≈ 2^21` nodes ≈ 110 ms native,
against a single 16.8 MB allocation and clear.

**Consequences for the plan.** Phase 3 loses its heuristic path and gains a
build-time book generator (now Phase 3a). `TRACTABLE_EDGES` is settled at **20**
and is not a tuning knob — above it the book answers, below it the exact solve
does, so **`exact` is true for every position in shipped play**. Two honest
consequences of that, both handled rather than hidden:

- The tutor's hedging branch ("looks risky") becomes unreachable in play. It is
  still implemented and still tested, by testing the **wording function directly**
  with `exact: false` — the same prescription this plan already applies to
  `result_of`'s unreachable tie, and the one `CLAUDE.md`'s mutants guidance gives
  for a branch no real input can reach.
- Difficulty stops being a depth knob. All levels read exact values, so levels
  differ **only** by `preserve_class` and `sloppiness_pct`. `LiveBand.depth`
  becomes inert for this game — which is fine (`adversary-solver` documents that it
  never reads `depth` itself), but it must be said out loud rather than left as a
  field someone later assumes is doing something.

### Phase 3a: the build-time opening book — **DROPPED 2026-08-07, before execution**

Phase 0 finding 2 said a baked book was viable and better. Checking it against
the shelf's actual pack convention says otherwise, so it is dropped rather than
built. The measurement stands; the conclusion drawn from it was too narrow.

What the check found: **every baked pack on the shelf is a JSON
`pond_docformat` envelope**, and they are 1.7 KB (bubble) to 15.5 KB
(color-sort). The book needs per-move values, not just a best move, because the
difficulty band buckets classes across moves and the tutor reports all of them —
that is 49,152 values over 2,325 positions, about **64 KB binary and ~150 KB as
JSON numbers**. So adopting it means either 4–10× the largest existing pack
inside the wasm, or leaving the envelope convention for a bespoke binary format.

What it buys, measured precisely: exactness over the **first four plies only**
(`TRACTABLE_EDGES = 20` means the live exact solve takes over at 4 edges drawn).
And no box can be captured, or even reach three sides, inside four plies — so the
engine cannot lose material there. The cost of *not* having the book is a
theoretical parity edge, not a visible blunder.

Symmetry reduction would shrink it ~8× (the lattice has 8 dihedral symmetries,
2,325 → ~330 positions), which would make the size fine. That is real work with a
real trap — mapping a canonical best move back through the transform — for the
same four plies. Not worth it now; recorded in `TODO/dots.md` as the thing to do
**if** Phase 10's harness shows the opening is actually costing games.

So dots becomes **Othello-shaped after all**, which is also the better outcome for
the §10 checklist: `exact` genuinely varies, the tutor's hedging branch is
reachable by a real input, and the honesty gate is non-vacuous rather than a
formality. The three consequences Phase 0 drew from "exact everywhere" are
withdrawn — difficulty *is* a depth knob above 20 free edges, and `LiveBand.depth`
is live, not inert.

<details>
<summary>Original Phase 3a text, kept because the measurement is still the record</summary>

**Goal:** 49 KB of exact per-move values for the first four plies, regenerable
byte-identically.

**Changes:**
- [ ] A generator binary in `dots-solver` that runs the full 2^24 solve and emits
  the layers-0..=3 pack (every position with ≤3 edges drawn → the value of every
  legal move), wrapped in a `pond_docformat` envelope like the other packs.
- [ ] `games/dots/book.bin` (or equivalent), committed, embedded in the wasm.
- [ ] A test that regenerates the pack and asserts it is **byte-identical** to the
  committed one, so the book cannot silently drift from the solver.
- [ ] A test asserting the book's root value is `-3` and that following it four
  plies lands at 20 free edges — where the live solver takes over with no gap.

**Call chain:** `dots_solver::live::choose` → book lookup when ≤3 edges drawn →
otherwise the exact solve.

**Wiring test:** `book_and_live_solver_agree_at_the_seam` — for positions with
exactly 3 edges drawn, the book's per-move values must equal the live exact
solver's values for the same position. This is the one test that proves the two
halves are one engine rather than two.

**Depends on:** Phases 0, 1.

**Read-set:** `crates/pond-docformat/src/lib.rs`, `games/wyrdle/` (pack precedent).

**Write-set:** `crates/dots-solver/**`, `games/dots/**`, `build.mjs` (pack copy).

**Shared-state contract:** The generator writes one committed artifact; it is run
deliberately, not on the gate.

**Risks:** A pack that drifts from the solver is worse than no pack, because it
looks authoritative. The byte-identical regeneration test is the guard.

**Done when:**
1. **Behavioral:** The engine plays exact moves from the empty board with no
   heuristic, and regenerating the book reproduces the committed bytes.
2. **Verification:** `npm run test:rust` including the seam and regeneration tests.

**Validation:** Broad — this is the phase where an error is invisible and durable.

</details>

### Phase 1: `dots-core` — rules, hash, verifiable outcome

**Goal:** The deterministic rules as a value type, with the extra-turn rule and the
no-draw property both pinned by tests.

**Changes:**
- [ ] `crates/dots-core/` — `board.rs` (`Board { edges: u32, owners: [u8; 9],
  to_move: Side }`, edge indexing, box-completion), `game.rs` (`Adversary` +
  `pond_outcome::Game` impls), `hash.rs`, `RULES.md`.
- [ ] Edge indexing, fixed and documented: horizontal `H(r,c) = r*3 + c` for
  `r ∈ 0..=3, c ∈ 0..3` → `0..11`; vertical `V(r,c) = 12 + r*4 + c` for
  `r ∈ 0..3, c ∈ 0..=3` → `12..23`. Box `(r,c)` closes on `H(r,c)`, `H(r+1,c)`,
  `V(r,c)`, `V(r,c+1)`.
- [ ] `apply`: draw the edge, award every box it completes to the mover, and
  **pass the turn only when it completed none**.
- [ ] `result_of(boxes_a: u8, boxes_b: u8) -> MatchResult` as a **free pure
  function**, so the tie branch is reachable from a test even though 9 boxes
  cannot tie. (The mutants guidance in `CLAUDE.md`: an unreachable defensive
  branch cannot be verified in place.)
- [ ] `state_hash`: SHA-256 over `b"dots\x00"`, `ROWS` u32 LE, `COLS` u32 LE, the
  side-to-move byte, `edges` u32 LE, then the 9 owner bytes.
- [ ] Golden vectors: a recorded corpus of `(moves → hash)` including a full game.
- [ ] `[lints] workspace = true` in the manifest (pedantic tier, per `CLAUDE.md`).

**Call chain:** `pond_outcome::verify::<Dots>(&record)` → `Dots::replay` →
`legal_edges` / `apply_move` → `state_hash`.

**Wiring test:** `match_record_verifies_and_tamper_is_detected` — build a real
finished game via `attest::<Dots>`, assert `verify` is ok, then mutate one move and
assert it fails. This goes through the `pond_outcome` entry point, not the internal
helpers. RED before the impls exist.

**Depends on:** Phase 0 (edge indexing and the completion predicate are promoted
from the spike).

**Read-set:** `crates/drop4-core/src/{game,board,hash}.rs`, `RULES.md`,
`crates/adversary-core/src/lib.rs`, `crates/pond-outcome/src/lib.rs`.

**Write-set:** `crates/dots-core/**`, root `Cargo.toml` (workspace members).

**Shared-state contract:** No mutable state beyond the write-set. Adds a workspace
member, so `Cargo.lock` changes.

**Risks:** The extra-turn rule is easy to get subtly wrong (multi-box moves: one
edge can close **two** boxes at once — the shared-edge case — and must award both
and still keep the turn). Explicit test.

**Done when:**
1. **Behavioral:** A finished 3×3 game replays through `pond_outcome::verify` to
   the same hash and the correct winner, and a tampered move list fails.
2. **Verification:** `npm run test:rust` green (`cargo fmt --check`, `clippy -D
   warnings`, `cargo test --workspace --release`).

**Validation:** Moderate. Tests plus a hand-played game whose box counts are
checked against a board drawn on paper — the completion predicate is the kind of
code that is wrong and self-consistently wrong.

### Phase 2: native == wasm cross-build

**Goal:** Prove the hash is byte-identical on both targets before anything depends
on it.

**Changes:**
- [ ] Enrol `dots-core` in the `xbuild` cross-build determinism check, following
  the existing games' pattern.

**Call chain:** `xbuild` harness → `dots_core::state_hash` on native and on
`wasm32-unknown-unknown` → byte comparison.

**Wiring test:** The cross-build test itself, RED (or absent) before enrolment,
green after, over the Phase 1 golden vectors.

**Depends on:** Phase 1.

**Read-set:** `crates/xbuild/**`, Phase 1's vectors.

**Write-set:** `crates/xbuild/**` (registration), possibly `tools/build-wasm.sh`.

**Shared-state contract:** Invokes `cargo` for a second target; no other ambient
state.

**Risks:** A `usize`-width leak into the hashed path is the classic failure and is
exactly what this catches. `edges: u32` and the u32 LE dims are chosen to avoid it.

**Done when:**
1. **Behavioral:** The same move list hashes identically native and wasm.
2. **Verification:** the cross-build check green inside `npm run test:rust`.

**Validation:** Narrow. The test *is* the claim.

### Phase 3: `dots-solver` — Oracle, band, tutor

**Goal:** A strong deterministic opponent whose every claim carries an honest
`exact`.

**Changes:**
- [ ] Memoized negamax over a **compact per-root submask table** (`2^f ≤ 2^20`
  entries, Phase 0 finding 3), exact for every position with ≤ 20 free edges,
  budgeted with `adversary_solver::NodeBudget` as a backstop, **never returning a
  partial iteration** and never storing a truncated search in the table.
- [ ] A **heuristic depth-capped** path above `TRACTABLE_EDGES` (Phase 3a dropped,
  so this is back): eval = box margin, plus credit for boxes already at three
  sides (the mover claims those), with per-level depth. Move ordering: capturing
  moves first, then edges that do not create a third side.
- [ ] Cross-check the exact search against the Phase 0 spike, which is an
  independently written implementation of the same recurrence: an unlimited-budget
  solve of the empty board must return **−3**, and a 1×1 board's must return −1.
  Two implementations agreeing on a non-obvious value is stronger evidence than
  either one's unit tests.
- [ ] `class_of(final_margin)` = sign; `capped_class` per the game's own judgement
  (kept out of `adversary-solver`, per that crate's stated boundary).
- [ ] `live_move(level)` over `LiveBand` per level — Easy/Medium/Hard/Perfect,
  numbers tuned in Phase 12, not guessed here.
- [ ] `tutor::assess` → `{ value, regret, quality, exact }` per legal move, plus a
  game-specific `idea` string (e.g. "closes two boxes", "hands over a chain",
  "the safe edge"), so the shared banter fallback is not the only thing the
  persona can say.
- [ ] **Separate budgets for `coach` and `tutor`** (the checkers lesson): the
  per-move coach runs on every tap and must be cheap; the deliberately-opened
  panel may search deeper.

**Call chain:** `dots_solver::live::choose(&board, level, &mut rng)` →
`select_in_band` → `negamax`; `tutor::assess(&board, depth)` → `negamax`.

**Wiring test:** `dots_solver_never_throws_a_won_position` — from a set of seeded
positions where the exact value is a win for the mover, assert Hard/Perfect's
chosen move preserves the winning class. It runs through `choose`, the shipped
entry point, not the raw search.

**Depends on:** Phases 0, 1.

**Read-set:** `crates/adversary-solver/src/lib.rs`, `crates/checkers-solver/src/{search,tutor,live}.rs`, `crates/dots-core/**`.

**Write-set:** `crates/dots-solver/**`, root `Cargo.toml`.

**Shared-state contract:** None beyond the write-set. The RNG is passed in, never
ambient — and must stay untouched at zero sloppiness (the `select_in_band`
invariant).

**Risks:** (a) Deriving `exact` from the position rather than from whether the
search completed — the named trap in §10. (b) The extra-turn recursion inverting a
sign: a capture keeps the perspective, a non-capture flips it, and getting that
backwards produces a plausible-looking engine that plays anti-optimally. Pin with a
position whose correct value is hand-derivable.

**Done when:**
1. **Behavioral:** At Perfect, the engine never drops from a winning class to a
   losing one, and every tutor fact's `exact` matches whether its search completed.
2. **Verification:** `npm run test:rust` green including the wiring test.

**Validation:** Moderate-to-broad. Tests, plus a played game against the engine at
Perfect to confirm it exhibits the double-cross (declining the last two boxes of a
chain to keep control). If it never does, the search or the sign handling is wrong
in a way unit tests on small positions will not show.

### Phase 4: mutation-test the core and the solver

**Goal:** Find where a green suite is hiding a hole, before the phase is called
done.

**Changes:**
- [ ] `cargo mutants --package dots-core -j 4`, then `--package dots-solver`.
- [ ] Triage **every** survivor into *equivalent mutant* or *real gap*, record
  which in this plan, and close the real gaps with tests.

**Call chain:** N/A — an audit over the existing chain.

**Wiring test:** N/A. The gate is the recorded triage.

**Depends on:** Phases 1, 3.

**Read-set / Write-set:** `crates/dots-{core,solver}/**` (tests added), this plan.

**Shared-state contract:** Writes `mutants.out/`; already git-ignored.

**Risks:** Chasing the score instead of reading the survivors, which buys
assertions that pin implementation detail. The three recurring real gaps here are
known in advance (`CLAUDE.md`): a trait impl that only delegates, convenience API
with no test caller, and `render_text` asserted only by `contains`.

**Done when:**
1. **Behavioral:** Every survivor is classified in writing, and no *real gap*
   remains open.
2. **Verification:** the recorded triage plus `npm run test:rust` green.

**Validation:** Moderate.

### Phase 4 execution notes (2026-08-07) — run late, after Phases 5–8

This phase was skipped when the plan reached it and run afterwards. That is worth
saying plainly: the binding and the whole front end were built on a core whose
suite had holes in it. None of the holes turned out to reach the shipped path,
but that was luck, not the process working.

**`dots-core`: 193 mutants, 13 survivors → 7.** Six were real gaps, all closed
with tests:

| Survivor | Why the suite missed it |
|---|---|
| `board.rs:108` `<<`→`>>` | the "already drawn" guard in `completed_boxes`; nothing called it on a drawn edge, so re-offering a closing edge would have reported the box again — and a non-zero return *is* the extra-turn signal |
| `game.rs:65` `<`→`<=` | the bounds guard in `apply_move`; an off-board edge number could set a phantom bit 24 and produce a hash the honest game cannot reach |
| `game.rs:140,164×2` | `render_text`'s **drawn-edge** and **box-owner** branches. The empty-lattice golden never enters either, and the only other test used `contains` — the recurring `render_text` gap `CLAUDE.md` names in advance |

The seven that remain are **equivalent mutants**: `box_mask`'s three `|`→`^` (the
four bits are distinct), `build_edge_boxes`'s `<`→`<=` (no box mask has bit 24
set, so the extra iteration writes nothing), `completed_boxes`'s `|`→`^` after
the guard proved the bit clear, `is_drawn`'s `<`→`<=` (bit 24 is never set), and
`render_text`'s `W = 6 * COLS + 2` → `* 2`, which only widens a row buffer whose
trailing spaces are trimmed.

**`dots-solver`: 142 mutants, 24 survivors → 6.** The interesting ones:

- **The whole depth-capped search could return a constant** (9 mutants across
  `capped`) and every test passed. `capped` runs in two regimes: above
  `TRACTABLE_EDGES`, where — as its own doc says — no box can reach three sides,
  so every value is flat and a constant genuinely is equivalent; and *below* the
  threshold when the exact solve exhausts its budget, where it has real work to
  do. Every existing test drove the flat regime. The new test drives the second,
  and compares two moves that **both pass the turn**, so the difference comes
  from the recursion rather than from the sign flip in `move_values_capped`.
- **A test that measured a delta the mutation preserved.** The first attempt at
  pinning the standing margin (`search.rs:171`, `mine - theirs` → `+`) compared
  a position holding boxes against the same lattice without them. The mutation
  shifts *both* by the same amount, so the difference was identical and the test
  proved nothing. Re-written to assert an absolute value.
- `heuristic`'s "boxes about to fall" term was asserted only by sign, so both of
  its arithmetic mutants lived. Now pinned to the tenth.
- `tutor.rs`: only the *positive* majority case was tested, so `settles_the_game`
  could return `true` for everything and `MAJORITY` could be miscomputed; and
  `quality`'s class comparison could be negated, because a real position rarely
  offers a same-class-but-worse move and a class-dropping one at once. Both are
  now tested where the policy lives.

Five of the six remaining are equivalent (`i8::MIN + 1` → `* 1`, both below every
reachable value; three `|`→`^` on bits the code has just proved clear; `v > best`
→ `>=`, which picks a different tie of the same value).

**The sixth is the tool being wrong.** `search.rs:223` `||`→`&&` was reported
MISSED in all three runs. Applying it by hand fails **five** tests in the debug
profile and one in release, against a green baseline in both. So it is caught;
the report is not. Worth knowing before treating a survivor list as ground truth.

### Phase 5: `dots-wasm` — the C-ABI binding

**Goal:** The browser can hold a game, play edges, and read the engine's facts —
and the module never panics.

**Changes:**
- [ ] `crates/dots-wasm/`: `new_game(seed_lo, seed_hi)`, `play(edge) -> status`,
  `board_json`, `legal_moves_json`, `live_move(level)`, `assess_json(edge)`,
  `coach_json(edge)`, `tutor_json()`, `render_text`, `outcome_json`,
  `verify_json`, `mark_assistance`.
- [ ] `board_json` carries what the UI needs: drawn edges, box owners, both box
  counts, side to move, result, and **whether the last move granted another turn**
  (so the UI can say so).
- [ ] Every fallible path returns a status code or an empty buffer. No `unwrap` on
  a production path.
- [ ] Register in `tools/build-wasm.sh` and the `build.mjs` copy step.

**Call chain:** `dist/dots.wasm` exports → `dots_solver` / `dots_core`.

**Wiring test:** A Rust-side test that drives the exported functions in sequence
(new game → legal moves → play → board json → outcome) and asserts an illegal
`play` is a rejected no-op rather than a panic.

**Depends on:** Phases 1, 3.

**Read-set:** `crates/checkers-wasm/src/lib.rs` (the closest shape), `build.mjs`, `tools/build-wasm.sh`.

**Write-set:** `crates/dots-wasm/**`, `tools/build-wasm.sh`, `build.mjs`, root `Cargo.toml`.

**Shared-state contract:** The module holds a global mutable game state (the
established pattern). `build.mjs` and `build-wasm.sh` are shared files touched at
their wiring points only.

**Risks:** A 16.7 MB table allocated eagerly on `new_game` would make every page
load expensive; allocate it lazily on the first exact solve.

**Done when:**
1. **Behavioral:** `npm run build:wasm` produces `dist/dots.wasm`, and a driven
   sequence of exports plays a full game and emits a verifiable record.
2. **Verification:** `npm run test:rust` + `npm run build:wasm` green.

**Validation:** Moderate.

### Phase 6: the front end — playable at `/dots/`

**Goal:** A person can play Dots and Boxes in a browser, and the URL is shareable.

**Changes:**
- [ ] `src/games/dots/dots-wasm.ts` — typed wrapper.
- [ ] `src/games/dots/dots.ts` — the `GameModule`: an SVG/CSS dot lattice with
  **tappable edge targets** (generous hit areas, not hairlines), core-driven glow
  on legal edges, box fill on capture, a turn bar naming both sides with the
  opponent's identity, a visible "goes again" beat when a capture keeps the turn,
  and the opponent's chosen edge highlighted after it moves.
- [ ] `src/games/dots/dots-outcome.ts` — the `pond-outcome` record, the
  verification-forward end screen, and the deflated re-verifying `?r=` share.
- [ ] Wire `src/registry.ts` (`id: "dots"`, title `Dots and Boxes`, glyph `▦`,
  `status: "playable"`) and `GAME_PAGES` in `build.mjs`.

**Call chain:** `/dots/` page → `registry.ts` entry → `dotsModule.mount` →
`dots-wasm.ts` → `dist/dots.wasm`.

**Wiring test:** `tests/dots.spec.ts` — Playwright, loads `/dots/`, taps a legal
edge and asserts it is drawn; taps an **illegal** target and asserts nothing
changes (the §4 guardrail against rules leaking into the UI); plays a scripted
game to a win and round-trips the `?r=` share, asserting it re-verifies on open.

**Depends on:** Phase 5.

**Read-set:** `src/games/checkers/*.ts` (pattern), `src/contract.ts`, `src/registry.ts`.

**Write-set:** `src/games/dots/**`, `src/registry.ts`, `build.mjs`, `tests/dots.spec.ts`.

**Shared-state contract:** `registry.ts` and `build.mjs` are shared; append-only
edits at the wiring points. Playwright binds a local port during the test run.

**Risks:** Edge hit-targets on a phone are the whole interaction and the easiest
thing to get wrong — a 24-edge lattice at 360 px gives each edge very little room.
Budget real time here and check on a narrow viewport during the phase, not after.

**Done when:**
1. **Behavioral:** Navigating to `/dots/` plays a full game against the engine,
   captures boxes with the extra turn, ends with a verifiable record, and the
   share link re-verifies.
2. **Verification:** `npx playwright test tests/dots.spec.ts` green.

**Validation:** Broad. Tests plus actually playing it, in both chrome modes and at
360 px. Per the workspace note, the Chrome extension is disabled here — use
Playwright for the real-browser pass.

### Phase 6 execution notes (2026-08-07)

Playable at `/dots/`. `npm run test` and the full Playwright suite green (357
unit, 427 e2e), plus a real-browser pass in both themes at 900 px and 360 px.

Three things worth recording:

- **The lattice arithmetic became its own pure module.** The plan named two front-end
  files; there are three. `dots-lattice.ts` is the H/V/box numbering as a pure
  function, pinned by a unit test against the diagram in `RULES.md`, because it is
  the one piece of board arithmetic the UI cannot get from the core — and an
  off-by-one there would draw a legal move in the wrong place while every rules
  test stayed green. Everything else (legality, capture, score, the extra turn)
  is read from the binding.
- **The legal-move hint may not share a player's colour.** The first pass gave
  legal edges the same brass as Side A's drawn edges at lower opacity, and the
  screenshot pass showed a board where drawn and drawable edges were not reliably
  distinguishable — the one thing this board must never be ambiguous about. Hints
  are now neutral and thin; drawn edges are saturated and thicker, so the two
  differ by weight as well as colour. Found by looking at it, not by a test.
- **A settings pair landed early.** `dotsLevel` / `dotsSeat` are in `src/settings.ts`
  now rather than in Phase 8, because a playable game needs a difficulty and a
  seat. The seat defaults to **second**: 3×3 is a second-player win, so opening
  against Perfect loses by construction, and defaulting the human into that seat
  would be the shelf teaching a false lesson about the game. Phase 8 still owns
  hints, declare-assistance and the tutor panel.

The e2e also pins a **24 px minimum** on every edge target at 360 px — the phase's
named risk, checked rather than asserted to be fine.

### Phase 7: identity, tokens, accessibility

**Goal:** It looks like it belongs on the shelf and clears the bar in both themes.

**Changes:**
- [ ] Append `dots`-scoped tokens to `tokens.css` (the only file with raw hex),
  with the WCAG ratios recorded beside them; the two players' box fills must be
  distinguishable by **more than colour** (a mark or hatch), as the match-3 gems
  are.
- [ ] Centred single-column layout per §4 and `docs/RESPONSIVE-DESIGN.md`.
- [ ] axe on the board in light and dark; no horizontal overflow at 360 px.

**Call chain:** `/dots/` → shared chrome → `tokens.css` vars.

**Wiring test:** Extend `tests/dots.spec.ts` with the axe run in both themes and
the 360 px overflow assertion; `tests/tokens.test.ts` recomputes the new ratios.

**Depends on:** Phase 6.

**Read-set:** `tokens.css`, `styles.css`, `docs/DESIGN.md`, `docs/RESPONSIVE-DESIGN.md`.

**Write-set:** `tokens.css`, `styles.css`, `src/games/dots/**`, `tests/dots.spec.ts`.

**Shared-state contract:** `tokens.css` / `styles.css` are shared, append-only.

**Risks:** A hex literal leaking into `styles.css` (a unit test forbids it).

**Done when:**
1. **Behavioral:** The board is legible and axe-clean in both themes at both
   widths, and the two sides are distinguishable without colour.
2. **Verification:** `npm run unit` + `npx playwright test tests/dots.spec.ts`.

**Validation:** Moderate.

### Phase 7 execution notes (2026-08-07)

The identity is **graph paper**: a paper surface with an ink lattice, one
saturated colour per side carrying both that side's drawn edges and its claimed
boxes, and a hint colour that belongs to neither. Five tokens per theme in
`tokens.css` with their ratios recorded; `tests/tokens.test.ts` recomputes four
pairs per theme. axe runs on the board in **both** themes, and the claimed-box
mark is asserted, so the two sides differ by shape as well as hue.

Two decisions the screenshots made, neither of which a test would have:

- **The hint may not wear a player's colour** (carried over from Phase 6, and the
  reason `--dots-hint` exists as its own token rather than reusing `--accent`).
- **The last-move ring is an offset outline, not a glow.** A filled 3 px glow in
  a third colour covers the thin bar it is marking — and the point of marking the
  opponent's edge is to see *whose* it was. Ink outline, 2 px offset, side colour
  still visible inside.

The theme inverts cleanly because the box mark is painted in the **paper**
colour: paper is light and the fills dark in light mode, and the reverse in dark,
so one token pair covers the mark's contrast in both.

### Phase 8: standard settings, hints, and the tutor panel

**Goal:** The shared assistance model, and a coach that cannot lie.

**Changes:**
- [ ] Wire `src/settings.ts`: hints on by default (a hint points at a good legal
  edge **and explains it**, and counts as assistance); declare-assistance on;
  hints-off flips the control to "I'm stuck", which ends the game and reports
  honestly whether a legal edge remained.
- [ ] Opt-in tutor panel (off by default) reading `tutor_json`, painting its
  reading state **before** the deep search starts (the checkers lesson: a
  blocking search makes the button look dead).
- [ ] Wording bound to `exact`: "that threw the game" only when exact, "looks
  risky" otherwise.

**Call chain:** panel button → `dots-wasm.ts.tutor()` → `tutor_json` →
`dots_solver::tutor::assess`.

**Wiring test:** `tests/dots-tutor.test.ts` — a `coachFor`-style unit test over
both a proven and an unproven position asserting the wording flips with the flag;
plus an E2E that opens the panel and asserts a fact renders.

**Depends on:** Phases 5, 6.

**Read-set:** `src/settings.ts`, `src/games/checkers/checkers.ts` (panel pattern).

**Write-set:** `src/games/dots/**`, `tests/dots-tutor.test.ts`, `tests/dots.spec.ts`.

**Shared-state contract:** `settings.ts` is shared and read-only here; settings
persist to `localStorage` (note the Node-version `localStorage` hazard in
`CLAUDE.md` — run the pinned Node 22).

**Risks:** Letting the panel's deep budget serve the per-tap coach, putting the
panel's cost on every tap. Two exports exist for exactly this reason.

**Done when:**
1. **Behavioral:** Hints work and mark assistance; hints-off ends the game with an
   honest report; the panel never claims a proof it does not have.
2. **Verification:** `npm run unit` + the dots E2E green.

**Validation:** Moderate.

### Phase 8 execution notes (2026-08-07)

Hints on by default, declare-assistance on, an opt-in tutor panel, and a coach
whose sentence comes from Rust. 8 new unit tests (`tests/dots-tutor.test.ts`) and
4 new E2E.

- **The wording stays in Rust.** `coachFor` in TypeScript never composes a verdict
  — it carries `coach_line`'s sentence verbatim and appends only a pointer to a
  better edge, hedged by the same `exact` flag ("held it" vs "may be stronger").
  The UI cannot word a heuristic as a proof because it does not own the words.
- **The coach names a place, not a number.** The board never shows edge numbers,
  so "edge 13" would be unfindable; the pointer reads "the vertical edge, row 1,
  column 2", from the same pure `edgeLabel` the accessible names use.
- **Two exports, two costs.** The per-tap path calls `assess` (COACH_DEPTH) and
  only asks for the best edge when the move was not optimal — so an optimal move
  costs one shallow search and the panel's depth never lands on a tap.
- **The panel paints before it searches.** `note.textContent = "Reading ahead…"`
  then a zero-delay timeout, because the deep search blocks the main thread and
  the button otherwise looks dead — the checkers lesson, applied rather than
  re-learned.
- **"I'm done" reports what was left.** With hints off the control ends the match
  and says how many edges were still undrawn; the record is `Abandoned` and still
  verifies. Nothing pretends the game finished.

### Phase 9: "How to play"

**Goal:** A guide that explains the interaction model first and cannot show a UI
that no longer exists.

**Changes:**
- [ ] `src/games/dots/dots-howto.ts` — pure data blocks; lead with "tap an edge",
  then the extra-turn rule, then chains and the double-cross (the one idea that
  makes the game deep), then the verifiable record.
- [ ] Register in `src/how-to-registry.ts`; run `npm run guide:shots` and commit
  **only** the dots shots (other games' JPEGs re-encode run-to-run).

**Call chain:** `/how-to/?game=dots` → `how-to-page.ts` → `how-to-registry.ts` →
`DOTS_GUIDE` → `renderGuide`.

**Wiring test:** `tests/how-to.test.ts` fails on a named-but-missing shot;
`tests/how-to.spec.ts` asserts every guide image loads, TOC count == entry count,
and axe clean.

**Depends on:** Phases 6, 7, 8 (the UI must be final before shots).

**Read-set:** `src/how-to.ts`, `src/how-to-registry.ts`, `tools/guide-shots.mjs`.

**Write-set:** `src/games/dots/dots-howto.ts`, `src/how-to-registry.ts`, `assets/guide/dots-*.jpg`.

**Shared-state contract:** `guide:shots` rebuilds **every** game's shots — stage
only the dots ones and `git checkout --` the rest.

**Risks:** Committing unrelated re-encoded JPEGs.

**Done when:**
1. **Behavioral:** The header link opens a guide whose screenshots match the
   shipped board.
2. **Verification:** `npm run unit` + `npx playwright test tests/how-to.spec.ts`.

**Validation:** Narrow.

### Phase 9 execution notes (2026-08-07)

Six entries, four shots, registered and passing the guard (a named-but-missing
shot fails `tests/how-to.test.ts`). The guide leads with the tap, then the extra
turn, then the idea that actually makes the game — that the skill is running out
of safe lines **second**, and that a Perfect engine declining boxes is the
double-cross, not a mistake.

Two things the shots changed, both found by looking at the output:

- **The final board was pinned to the left of a wide slab of paper.** Inside
  `.dots-game` a flex column centres it; on the result screen it is a block child
  and stretched. `width: max-content; margin-inline: auto` on `.dots-board` fixes
  it wherever the board is placed. No test would have caught this — the board was
  the right size and the right colour, just in the wrong place.
- **The first tutor shot proved nothing.** The recipe stopped after the engine's
  opening line, so every listed option read "safe: leaves no box on three sides"
  — a truthful screenshot of a boring position, illustrating a section about the
  *difference* between safe and giving. Seven plies in, the list shows both, and
  the panel says "Solved from here", which is the honest wording at that depth.

Also corrected: the result shot comes from a `?r=` link, so it is a spectator's
view and reads "Second player won 6–3" rather than naming The Engine. The alt
text now says what the image says.

### Phase 10: plug into the AI-scoring harness

**Goal:** "The engine never blunders" becomes a number rather than a claim.

**Changes:**
- [ ] `src/games/dots/dots-oracle.ts` — the `GameOracle` adapter (an edge index is
  already a wire code, so this should be close to a pass-through).
- [ ] Trial wiring in `src/harness/harness-trial-entry.ts`.
- [ ] `tests/dots-harness.test.ts` — the CI proof, with all three non-vacuity
  assertions per `docs/HARNESS.md`.
- [ ] A recorded anchor in `tests/baselines.test.ts`.

**Call chain:** `runTournament` → `runMatch` → `dotsOracle` → `dots-wasm.ts` →
wasm.

**Wiring test:** `tests/dots-harness.test.ts` — grades a real engine-vs-engine
match through the rig and asserts the graded-move count is non-zero, the game did
not abort, and a deliberately weakened player scores worse than the strong one.

**Depends on:** Phases 5, 6.

**Read-set:** `src/harness/**`, `docs/HARNESS.md`, `src/games/checkers/checkers-oracle.ts`.

**Write-set:** `src/games/dots/dots-oracle.ts`, `src/harness/harness-trial-entry.ts`, `tests/dots-harness.test.ts`, `tests/baselines.test.ts`.

**Shared-state contract:** `harness-trial-entry.ts` and `baselines.test.ts` are
shared, append-only. `npm run baselines` is opt-in, not on the gate.

**Risks:** The named trap — reading "15/15 optimal, 0 blunders" as "still as
strong" when the rig only grades provably-exact positions, so a change biting
early reports silence. Say what fraction of moves were graded, every time.

**Done when:**
1. **Behavioral:** `npm run baselines` reproduces a recorded dots Report exactly,
   and CI grades dots with no rig edit.
2. **Verification:** `npm run unit` (the harness test) + `npm run baselines`.

**Validation:** Broad.

### Phase 10 execution notes (2026-08-07)

The rig needed **no edit** — `git diff` touches no file under `src/harness/`
except the trial entry's per-game wiring. The adapter is the thinnest on the
shelf: an edge index is already the wire code, so every member is a pass-through
or a two-field projection.

The two shapes this game was supposed to stress turned out not to reach the rig
at all, and that is the result rather than an anticlimax. `runMatch` reads
`toMove` from the live board each iteration, so a capture's extra move needs
nothing; and the scorer grades on `quality`, so a margin-valued search is
invisible to it. Both are now asserted through the port rather than assumed.

**Measured, 4 games, top level vs top level:** 40 graded moves, 8 skipped early,
0 blunders, 6.2 ms per graded move. **83% of a side's moves are graded** — the
inverse of checkers' 9-of-163, and for a stateable reason: dots is *solved* from
four edges in, so `exact` is true almost everywhere, while checkers' `exact`
means a terminal was proven. Same rig, same honesty gate, opposite denominators.
Easy vs top over the same seeds: 28 graded, 2 blunders (7.1%), and Easy loses
every game — so the rig can tell the levels apart, which is the comparison a
class floor alone would not give.

**The baseline anchor reads 1-0-1, and that is a forced result, not a balanced
one.** 3×3 is a second-player win, so whoever opens loses; the rig alternates who
opens each game, so two forced losses render as one win and one loss. A draw
would be the finding — nine boxes cannot split.

### Phase 11: the experimental hybrid opponent

**Goal:** Personality without ceding strength, degrading to the engine on any
failure.

**Changes:**
- [ ] Reuse `hybrid-player.ts` / `ai-runtime.ts` / `banter.ts` **unchanged**.
- [ ] Supply the game's `idea` in **both** places that build a band (the game
  module and `dots-oracle.ts`) so the UI opponent and the harness hybrid say the
  same thing.
- [ ] A persona for the opponent, consistent with Chip / Rowan / Alder.
- [ ] WebGPU-gated toggle (real, non-fallback adapter only) + up-front download
  disclosure; the engine stays the default.
- [ ] CI proof with `MockRuntime`.

**Call chain:** toggle on → `HybridPlayer.pick` → `buildBand(tutorFacts)` →
`AIRuntime` → fall back to top-of-band on any failure.

**Wiring test:** A unit test with `MockRuntime` asserting a malformed / out-of-band
/ throwing model response yields the engine's top-of-band move, driven through
`HybridPlayer.pick`.

**Depends on:** Phases 3, 6, 10.

**Read-set:** `src/harness/{hybrid-player,ai-runtime,banter}.ts`.

**Write-set:** `src/games/dots/{dots.ts,dots-oracle.ts}`, `tests/dots-harness.test.ts`.

**Shared-state contract:** None new. The real runtime lazy-imports the same-origin
`/vendor/webllm.js`; no CDN serves code.

**Risks:** The real-WebGPU trial (`HARNESS_TRIAL_GAME=dots npm run harness:trial`)
runs off CI on system Chrome. **I can wire and prove the mock path; the live
WebGPU run needs the owner's machine.** Say so rather than implying it was
verified.

**Done when:**
1. **Behavioral:** With the toggle on and a mock runtime, the opponent plays legal
   in-band moves and falls back cleanly on every failure mode; banter carries no
   board claims.
2. **Verification:** `npm run unit`; the live trial reported separately and
   labelled as owner-run.

**Validation:** Moderate on CI, and explicitly incomplete until the live trial runs.

### Phase 12: measure the latency, at every level

**Goal:** Know this game's search cost before claiming anything about it, and
decide deepening by measurement rather than by copying another game.

**Changes:**
- [ ] Measure `live_move` per level: **median, p95, worst, and the fraction over
  400 ms** — at *every* level, not just the top (the Othello endgame stall hid for
  months behind a top-level-only measurement).
- [ ] Measure with and without `adversary_solver::deepen` and adopt it **only if
  it pays here** (+14% on checkers, −41% on Othello).
- [ ] Record the numbers in the constants' own doc comments so they travel with the
  code they justify, and summarise in this plan.

**Call chain:** N/A — measurement over Phase 3/5's chain.

**Wiring test:** N/A. The gate is recorded numbers per level.

**Depends on:** Phases 3, 5, 10.

**Read-set:** `crates/dots-solver/**`, `docs/AI-PLAYERS.md` → "Search cost".

**Write-set:** `crates/dots-solver/**` (doc comments, possibly tuning), this plan.

**Shared-state contract:** None.

**Risks:** Tuning `TRACTABLE_EDGES` for speed. Both of Othello's and checkers'
thresholds sit at their measured knee and §10 says explicitly not to move them for
latency; the same discipline applies to ours.

**Done when:**
1. **Behavioral:** Every level's worst `live_move` is known and stated, and the
   deepening decision has a measurement behind it either way.
2. **Verification:** the recorded per-level table, reproduced by re-running.

**Validation:** Broad — this phase *is* validation.

### Phase 13: documentation

**Goal:** The next game's author finds the lessons where they will look, not in
this plan.

**Changes:**
- [ ] `docs/BUILDING-GAMES.md` §10 — dots as the fourth reference implementation;
  the extra-turn shape; the margin-valued band; correct the "two sides alternate"
  wording.
- [ ] `docs/AI-PLAYERS.md` — the fourth-game generality note and the measured
  search-cost row.
- [ ] Fix the now-false "alternating" prose in `crates/adversary-core/src/lib.rs:9`
  and `src/harness/match-runner.ts:72`.
- [ ] `TODO/dots.md` (new) + `TODO/README.md`: dots into shipped, **and the pointer
  to the three discovery catalogs** the next-games list currently omits.
- [ ] `README.md` game list.

**Call chain:** N/A.

**Wiring test:** N/A. Doc-only; the gate is that each named file is edited.

**Depends on:** Phases 1–12 (the lessons must exist first).

**Read-set / Write-set:** the files listed.

**Shared-state contract:** None.

**Risks:** This is the most-skipped phase in any plan. It is scheduled after the
work rather than inside it only because it records measured findings; if the
schedule slips, this phase does not get dropped.

**Done when:**
1. **Behavioral:** A reader of `docs/BUILDING-GAMES.md` §10 alone learns that a
   move need not pass the turn and that a band value can be a margin.
2. **Verification:** `npm run unit` (doc-referencing tests) green.

**Validation:** Narrow.

### Phase 14: gate and deploy

**Goal:** Live at `fun.croft.ing/dots/`, behind the full gate.

**Changes:**
- [ ] `npm run gate` locally (Rust + typecheck + lint + unit + build + e2e).
- [ ] Commit at each green point along the way (no batching); push; confirm the
  three CI jobs and `deploy` all succeed.
- [ ] Smoke-test the live site: play a game through the deployed wasm with no
  console errors.

**Call chain:** `git push` → GitHub Actions `build` ‖ `rust` ‖ `e2e` → `deploy`
(needs all three, guarded to `refs/heads/main`).

**Wiring test:** The live smoke test — the deployed `/dots/` plays a real game.

**Depends on:** All prior phases.

**Read-set:** `.github/workflows/deploy.yml`, `.claude/CI-PATTERN.md`.

**Write-set:** none new (a push).

**Shared-state contract:** Pushes to `main` and publishes to GitHub Pages — the
one outward-facing action in this plan. **Ask before pushing** (`CLAUDE.md`:
don't push unless asked).

**Risks:** A green local gate and a red CI one, from a toolchain difference. Both
toolchains are pinned and both CI jobs read the pins, so this should not happen —
but Homebrew's clippy shadowing rustup has caused it three times, so run the gate
through `npm run test:rust`, never bare `cargo clippy`.

**Done when:**
1. **Behavioral:** `fun.croft.ing/dots/` serves a playable game.
2. **Verification:** the CI run is green on all four jobs, and a live play-through
   produces no console errors.

**Validation:** Broad.

## Open Questions

- [RECOMMENDED: PHASE-GATED — Phase 3] Does the game need a heuristic eval at all,
  or is the whole 24-edge game exact within budget? *Phase 0 answers it with a
  measurement; the plan deliberately does not assume either.*
- [RECOMMENDED: ADVISORY] The opponent's persona name (Chip / Rowan / Alder are
  taken). *Cosmetic; propose one in Phase 11 and let the owner veto.*
- [RECOMMENDED: ADVISORY] Should a later "Large" 4×4 variant be a tracked
  follow-up in `TODO/dots.md`? *The hash already carries the dims, so it stays
  additive either way.*
- [RECOMMENDED: BLOCKING — Phase 14] Push and deploy to `main`? *Outward-facing
  and `CLAUDE.md` says don't push unless asked. The owner asked for "build and
  deploy", which reads as authorization — confirm at the phase rather than assume
  it covers a force-push or a branch decision.*

## Review Log

- **Pass 1 (2026-08-07)** — Built from the §10 checklist, the checkers plan's
  shape, and discovery's catalog entry. Owner decided board size (3×3) and scope
  (full §10) before drafting.
- **Pass 2 (2026-08-07)** — Gap analysis against the codebase. Found and fixed:
  (a) the extra-turn rule needs no `Adversary` change but **does** falsify doc
  comments in two shared files — added to Documentation Impact and Phase 13 rather
  than left to be discovered; (b) the rig was **verified** turn-agnostic by
  reading `match-runner.ts:242` and `scorer.ts:113` instead of being assumed, which
  removed a Phase 0 probe; (c) the `MatchResult::Draw` branch is unreachable at 9
  boxes, so Phase 1 extracts `result_of` as a free function a test can reach —
  the mutants guidance's prescription for an unverifiable defensive branch;
  (d) the memo key is the edge mask **alone** (box ownership cannot affect future
  play), which turns the table from an unviable HashMap into a 16.7 MB flat `Vec`,
  and that in turn is what makes an exact endgame plausible — this belonged in
  Reasoning, not discovered in Phase 3; (e) Phase 0 was promoted from optional to
  required, because the plan's own search-cost estimate is exactly the kind of
  claim P9 refuted five times on 2026-08-07; (f) the guide-shots staging hazard
  and the shared-file append-only constraints were made explicit in the phases
  that touch them.
