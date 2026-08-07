# P9 — The midgame latency floor: node-budgeted iterative deepening, shared by all three adversarial games

**Status:** planned (2026-08-07)
**Repo:** `fun` (fun.croft.ing)
**Predecessor:** P8 (`plans/2026-08-04-checkers-game.md`) — which extracted
`crates/adversary-solver` and, in measuring it, exposed the floor this plan is about.

---

## Problem Statement

After each adversarial game's *endgame* cost was fixed, the worst single move in
every one of them is a **midgame heuristic search**, and no endgame constant
reaches it.

Measured in wasm 2026-08-06 (Node/V8 — the same engine the browser runs), worst
single top-level `live_move`:

| game | worst call | where |
|---|---|---|
| Othello | **~2,112ms** | 36 empties, Expert (depth 7) |
| Checkers | **~341ms** | 13–18 pieces, Expert (depth 8) |
| Drop 4 (capped path) | not yet measured | Perfect (depth 10) |

Othello's number is the one a player would notice: a tap that costs two seconds
does not read as an opponent thinking, it reads as a hung page.

Two properties make this a **cross-game thread** rather than two tuning tickets:

1. Two independent investigations, in codebases that share only a band selector,
   landed on the same shape of answer.
2. Both numbers were found only after removing a *different* pathology sitting in
   the same place — Othello re-deciding exact-vs-capped at every node (19.2s worst
   case before the fix), checkers' endgame bonus set eight times too generously.
   The floor was underneath each, invisible until the thing on top of it moved.

### What is explicitly not the lever

**Do not re-tune `TRACTABLE_EMPTIES` or `TRACTABLE_PIECES`.** Both are now measured
at their knee, and — this is the point — both sit *below* the midgame cost. Othello
at 12 empties costs 85ms against a 2,112ms midgame; checkers' endgame bonus costs
at most 103ms against 341ms. Turning either knob cannot reach the floor, and
turning it *down* would trade away proof rate for nothing. The measurements are in
each constant's own doc comment.

The two real levers:

- **Lower the top `Level` depths** (Othello Expert 7, checkers Expert 8, Drop 4
  Perfect 10) — bounds the tail by making the opponent worse everywhere, including
  in the cheap positions where the depth was free. Rejected as the primary answer:
  it pays for the worst case out of the average case.
- **Iterative deepening under a budget** — keep the depth where the position is
  cheap, bound the tail where it is not. This is the plan.

---

## Reasoning

### Why the budget is measured in nodes, not milliseconds

The TODO entry that raised this said *time*-bounded iterative deepening. It should
say **node**-bounded, and the difference is not cosmetic — a wall-clock bound would
make the *chosen move* a function of how fast the machine is, and three things in
this repo are built on that not being true:

1. **`tests/baselines.test.ts` re-runs the engine and asserts exact Reports.** Its
   own header records why wall-clock is the one Report field it does not assert:
   "it is the one number in a Report that is not deterministic, and pinning it
   would make this test fail on a busy laptop — which is how a regression anchor
   gets muted." A time bound would push exactly that nondeterminism *into*
   `wins` / `optimal` / `blunders`, which are the fields the anchor exists to pin.
   The regression anchor would have to be deleted or muted, and the shelf would
   lose the thing that told it six defects had shipped.
2. **`adversary-solver` treats seed-reproducibility as load-bearing** to the point
   of refusing to *draw* an unused random number
   (`zero_sloppiness_does_not_consume_the_rng`): "a deterministic level must
   produce the same game from the same seed." A time-bounded search breaks that
   property far more coarsely than an extra RNG draw would.
3. **The wasm modules are freestanding `extern "C"` with no host imports.** A
   clock means importing a JS `now()` into a module that currently has no host
   surface at all — and once the search consults the host, `native == wasm` stops
   being a claim a test can check. The only `std::time::Instant` anywhere in
   `crates/` today is inside `#[cfg(test)]` blocks, on the native side. That is
   not an accident.

A node budget keeps all three: it is deterministic, machine-independent, and
identical native and in wasm.

**This repo already does it this way.** Three crates bound a search, and none of
them consult a clock:

```
bubble-solver      find_win(seed, node_budget: u64)
color-sort-solver  find_win(state, node_budget: u64)
match3-solver      "within node_budget search nodes"
```

So the convention exists; the adversarial games are the ones that never adopted
it. This plan is less an invention than an alignment.

**The honest cost, stated plainly.** A node budget bounds *work*, not
*milliseconds*. A slow phone at a fixed budget is still slow — it is just
predictably, proportionally slow rather than pathologically slow. Nodes are a
proxy for time, and the proxy has to be calibrated by measurement (Phase 0) and
re-checked when the evaluation function changes, because a more expensive
heuristic makes each node cost more. That calibration is recorded next to the
constant, the same way `TRACTABLE_EMPTIES` and `TRACTABLE_PIECES` are.

Owner decision, 2026-08-07: node budget. Wall-clock was offered and declined.

### Why iterative deepening at all, rather than just a node-capped fixed depth

A node cap on a fixed-depth search has no answer for what to do when the cap
bites: the search is halfway through the root move list, some moves have depth-7
values and the rest have nothing. Returning that mixture is the classic iterative
deepening bug, and here it would be worse than a bug — the difficulty band
compares values *across* moves, and comparing a depth-7 value against a depth-2
one is meaningless. The band would pick the move that happened to be searched
shallowest, which is to say at random.

Iterative deepening gives the cap something safe to do: **discard the incomplete
iteration and return the last complete one.** Every value in the returned set came
from the same depth. That is the whole reason the driver exists, and it is the
first property to test.

### The seam — what is shared and what stays in the game

`adversary-solver`'s module doc is explicit about what it refuses to hold:
`capped_class` and `live_band` stay in the games because they are *judgement*.
Iterative deepening splits cleanly along the same line:

```
┌─ adversary-solver (shared, no game judgement) ──────────────┐
│  NodeBudget   a deterministic counter; charge() -> bool     │
│  deepen()     run depths 1..=max; keep the last COMPLETE    │
│               iteration; stop on exhaustion or max depth    │
└─────────────────────────────────────────────────────────────┘
                             │  the game supplies one closure:
                             ▼  "search the root to depth d, or abort"
┌─ othello / checkers / drop4 solver (the game's own) ────────┐
│  negamax(..., &mut NodeBudget) -> Option<...>               │
│    charges each node, returns None once the budget is out   │
│  the evaluation, the move ordering, the TT, `exact`         │
└─────────────────────────────────────────────────────────────┘
```

The driver never sees a board, a value, a class or a depth table. It sees
`u32 -> Option<Vec<(M, V)>>` and a counter. That keeps it on the right side of the
line the crate already drew.

**Why the budget must be checked inside the search, not between iterations.** The
pathology being fixed *is a single iteration*: Othello's 2.1s is one depth-7
search, not seven searches. A driver that only checks the budget between
iterations would let that one iteration run to completion and bound nothing. The
counter therefore has to be threaded down into `negamax`, and the abort has to
propagate out through the entire root move loop.

### The transposition table under abort — the subtle one

Checkers has a TT, and sharing it across iterations is what makes iterative
deepening nearly free there (entries record their own depth, so a shallow entry
cannot answer a deep query). But abort introduces a hazard that does not exist
without it:

> An aborted subtree returns a value derived from a truncated search. Storing that
> value in the TT writes a lie that outlives the iteration that produced it — and
> the next iteration, and the tutor, will read it as a real bound.

Worse for this repo specifically: `Scored::exact` is the honesty flag, and the
whole point of P8's search module docs is that the flag must never be set by a
value that does not trace to a real terminal. An aborted search has not proven
anything. So: **on abort, store nothing and claim nothing.** This gets its own
phase and its own test, because it is invisible in casual testing — the class is
usually right anyway, which is precisely the failure mode P8's module doc warns
about.

Othello has no TT, so it is the simpler first consumer and goes first.

### Root move ordering, and why it will move the baselines

Iterative deepening pays for itself only if each iteration's result orders the
next iteration's root moves best-first — without that, ID costs roughly double a
plain search rather than a few percent. So ordering carryover is part of the work,
not an optimization to defer.

It has a consequence that must be said before it is discovered: **the recorded
baselines will change.** Two independent reasons — reordering changes tie-breaking
among equal-valued moves, and the budget, where it bites, returns a shallower
(different) value set. Both change which move gets chosen, which changes
`wins`/`optimal`/`preserving`.

`docs/HARNESS.md` says a moved baseline number is a finding, and that the one
legitimate reason to update is that the engine or the grader itself changed, with
the reason written next to the number. This is that case. The discipline is
preserved by writing the reason down (Phase 9), not by hoping the numbers hold.

**What must *not* change:** the class floor. `preserving` counts moves that did not
drop the win/draw/loss class, and a shallower search is still class-preserving
with respect to what it knows. A drop in `preserving` is not an expected
consequence of this change — it is a defect in it. Phase 9 checks that
specifically rather than accepting the whole diff.

### Why Drop 4 is in scope despite not having the problem

Drop 4's exact solver (`Solver::solve`) is a null-window search over the *value*,
not over depth, and it is fast — the floor is not there. But Drop 4's **capped**
path (`negamax_capped`, levels at depths 2/5/8/10) is structurally identical to
Othello's, and it is unmeasured. It goes third: after the mechanism has been
proven on the game with the worst problem and the game with the awkward TT, Drop 4
is the cheap consistency pass that stops the shelf having two answers to the same
question. If Phase 0 measures Drop 4's capped path as already inside budget, it
still adopts the driver — the point of a shared mechanism is that a future depth
bump cannot reintroduce the tail.

---

## Verified Assumptions

Checked against the code on 2026-08-07, not assumed:

1. **No production path consults a clock.** `grep` for `Instant`/`elapsed`/
   `SystemTime`/`performance` across `crates/*/src/*.rs` returns three hits, all
   inside `#[cfg(test)]` (`checkers-solver/src/search.rs:699`,
   `drop4-solver/src/live.rs:325`, `othello-solver/src/search.rs:303`). Adding a
   clock to a search would be a first, in both senses.
2. **`node_budget` is an existing repo idiom.** `bubble-solver::find_win`,
   `color-sort-solver::find_win` and `match3-solver` all take `node_budget: u64`.
3. **The baselines re-run the engine and assert exact counts.**
   `tests/baselines.test.ts` asserts `games/wins/draws/losses/scoredMoves/optimal/
   preserving/blunders/skippedEarly/abortedGames/llmMoves/fallbackMoves` and
   deliberately excludes wall-clock.
4. **Othello has no transposition table.** `othello-solver/src/search.rs` is a
   plain alpha-beta with static move ordering (`ordered_moves` sorts by
   `WEIGHTS`). So ID there re-searches from scratch each iteration and the
   ordering carryover matters more, not less.
5. **Checkers' TT is created per top-level call** —
   `move_scores` does `Table::new()` — so threading one table across ID iterations
   is a change in lifetime, not in sharing semantics across moves.
6. **Checkers already computes a depth adjustment at the root**
   (`budgeted_depth`, `TRACTABLE_PIECES` + `ENDGAME_BONUS`). The ID driver's
   `max_depth` must be the budgeted depth, not the nominal one, or the endgame
   bonus is silently lost.
7. **Othello decides its exact/capped `Mode` once at the root** (`mode_for`,
   fixed in `b566469`). ID must decide the mode from the root position **once**,
   outside the deepening loop — recomputing it per iteration would reintroduce the
   19s pathology by a new route.
8. **Both games' root searches use a full window per move** (`i32::MIN+1`,
   `i32::MAX-1`) precisely so root values are values and not bounds. The driver
   must not narrow it.
9. **`select_in_band` is untouched by this plan.** It consumes `&[(M, i32)]` and
   does not care where the values came from — which is the extraction working as
   intended.

### Assumption to be verified by measurement (Phase 0), not asserted here

- **That nodes are a usable proxy for milliseconds in wasm/V8** for these two
  evaluation functions, and stable enough that one constant per game is
  meaningful. If Phase 0 finds the nodes-per-ms rate varies by more than roughly
  2× across game phases, the calibration story needs revisiting before any
  constant is chosen. Recording the measured rate is part of Phase 0's output
  either way.

---

## Phases

Each phase leaves the gate green and is committed at its green point. TDD
throughout: RED first, watched fail, then GREEN.

### Phase 0: Discovery — measure before designing

No production code. Reproduce and extend the 2026-08-06 numbers, in wasm.

- Confirm Othello ~2.1s at 36 empties and checkers ~341ms at 13–18 pieces on the
  current `main`. A number that does not reproduce is a finding that stops the
  plan.
- Instrument a node counter (a throwaway, or the real `NodeBudget` behind a
  feature — decide in the phase) and record, per game, per level: **nodes per
  top-level call** across a full game, and the derived **nodes/ms** in V8 wasm.
- Measure Drop 4's capped path at Perfect, which has never been measured.
- Record the distribution, not just the worst case: the budget should be set so
  the *typical* move is unaffected and only the tail is clipped. A budget that
  bites on the median move is a strength regression wearing a latency fix.

**Output:** a table in this plan's Review Log — per game, per level: median nodes,
p95, worst, and nodes/ms. Everything after this phase is calibrated against it.

### Phase 1: `NodeBudget` in `adversary-solver`

RED: a counter that starts with `n` and reports exhaustion after exactly `n`
charges; that an exhausted budget stays exhausted; that it is `Copy`-free
(threaded by `&mut`, one counter per top-level call, no interior mutability and no
globals — a global would make two concurrent searches interfere and would not be
deterministic under the harness).

Also test the unlimited case explicitly: the tutor and the graded-oracle paths may
want no budget at all, and "unlimited" must not be spelled `u64::MAX` at every call
site.

### Phase 2: `deepen()` in `adversary-solver`

The driver. RED first, and the tests are the specification:

- Returns the **last complete** iteration's result, never a partial one.
- An abort during iteration `d` returns iteration `d-1`'s result unchanged.
- An abort during iteration **1** returns `None` — there is no safe answer, and
  the caller (not this crate) decides what a game does with that. Document that
  the practical budget must never be small enough for this, and that the games
  guarantee it by construction.
- Runs `1..=max_depth` and stops at `max_depth` with budget to spare.
- Never mixes depths within one returned set — asserted directly, with a fake
  search that tags each value with the depth that produced it.
- Consumes no RNG and takes none. (The band consumes RNG *after* the values
  exist; deepening must not move the stream. Same reasoning as
  `zero_sloppiness_does_not_consume_the_rng`, and a mutation-visible property.)

Generic over `M` and over the value type, tested with a stand-in `Pick` type as
the crate's existing tests do — deliberately not any game's move type.

### Phase 3: Othello threads the budget through `negamax`

The simplest consumer (no TT). RED: a search under a tiny budget aborts and
reports it; under a generous budget it returns exactly what today's search
returns, node-for-node identical values.

That second test is the migration's safety net and should be written first: **the
unbudgeted path must not change.** Same values, same moves.

`Mode` continues to be decided once at the root, outside the loop (assumption 7).

### Phase 4: Othello adopts `deepen()` + root ordering carryover

`move_values` becomes: decide mode, then `deepen` with each iteration ordering its
root moves by the previous iteration's values (best-first), falling back to the
existing static `WEIGHTS` ordering for iteration 1.

RED: ordering carryover actually reduces nodes searched at a fixed depth (assert
the node count drops, which is the only non-vacuous way to test an optimization);
and the depth-`d` result with carryover equals the depth-`d` result without it,
except in tie-breaking — pin the tie-break rule explicitly rather than letting it
be whatever `max_by_key` happens to do.

### Phase 5: Othello's budget constant, calibrated

Set `OTHELLO_NODE_BUDGET` from Phase 0's measurements. Doc comment carries the
measurement table — the repo's convention that a latency number lives next to the
constant it justifies, so it travels with the code.

Verify in wasm: worst single `live_move` at Expert, and the proof/optimal rate,
before and after. **Target to state in advance:** worst call under ~400ms, with no
drop in the class floor. If the strength cost at that budget is unacceptable, the
budget moves and the reason is recorded — not the target quietly.

### Phase 6: Checkers threads the budget — and does not poison the TT

The awkward consumer. Same two migration tests as Phase 3, plus the one this phase
exists for:

- **An aborted subtree writes nothing to the transposition table.** RED: run a
  search under a budget that aborts mid-tree, then assert the table contains no
  entry for any position whose search did not complete. Then: a subsequent full
  search from the same table produces the same values as one from a fresh table.
  The second assertion is the one that catches a partial-write regression that the
  first misses.
- **An aborted search sets `exact: false`.** Never "probably". Directly asserted.

`budgeted_depth`'s endgame bonus feeds `deepen`'s `max_depth` (assumption 6).

### Phase 7: Checkers adopts `deepen()`, ordering carryover, budget constant

As Phases 4 and 5, for checkers, with the TT now living across iterations (which
is what makes it cheap). Calibrate; record the table in the constant's doc
comment; verify in wasm.

### Phase 8: Drop 4's capped path adopts the driver

Third consumer, consistency pass. The exact solver (`Solver::solve`) is untouched
— it is a different algorithm solving a different problem and it is not slow. Scope
is `negamax_capped` / `move_values_capped` only, and this phase says so in a
comment so a later reader does not "finish the job."

### Phase 9: Re-record the baselines, with the reason

Run `npm run baselines`, read the diff **move by move for the first game** rather
than accepting it wholesale, and update `tests/baselines.test.ts` with the reason
written next to the numbers per `docs/HARNESS.md`.

Specifically checked, not merely observed:

- `preserving` must not drop. A class-floor regression is a defect in this work,
  not a consequence of it (see Reasoning).
- `abortedGames` must stay at its recorded value. A budget-aborted *search* is not
  an aborted *game*, and if the two get conflated the rig will silently start
  discarding games again — the exact defect fixed on 2026-08-06.
- `optimal` may move; if it drops materially, that is the strength cost of the
  budget and the budget is wrong, not the number.

### Phase 10: Mutation-test the new shared code

`cargo mutants --package adversary-solver -j 4`, per the repo's standing
expectation for a determinism-critical crate before its phase is called done.
Triage every survivor into equivalent mutant or real gap and record which.

Expect the known local patterns: a convenience API with no test caller, and a
delegating impl. The `deepen` driver is a small state machine, which is the shape
where a green suite most easily hides a hole.

### Phase 11: Docs — record what landed

- `TODO/README.md` — strike the cross-game thread, with the outcome and the
  measured numbers (the file's existing convention for a closed thread).
- `TODO/othello.md`, `TODO/checkers.md`, `TODO/drop4.md` — per-game notes.
- `docs/AI-PLAYERS.md` — the budget is now part of how strength is set; a reader
  tuning a level needs to know the depth is a *ceiling*, not a promise.
- `docs/BUILDING-GAMES.md` §10 — a new adversarial game gets the driver for free
  and supplies a budget constant; say so in the checklist.
- `docs/STATE-OF-PLAY.md` — a new dated snapshot section, or a successor file.
- The constants' own doc comments (Phases 5, 7) — done in-phase, listed here so
  the docs pass does not duplicate them.

---

## Not in this run

- **Wall-clock bounding anywhere**, including as an outer guard in the browser
  layer. Offered and declined 2026-08-07; if the node budget turns out not to
  bound the felt latency on real hardware, that is the follow-up, and it belongs
  outside the hashed and graded paths.
- **Re-tuning `TRACTABLE_EMPTIES` / `TRACTABLE_PIECES`.** Both are at their
  measured knee and neither reaches the floor. Stated in the Problem Statement so
  it is a decision, not an omission.
- **Lowering the top `Level` depths.** The driver makes the depth a ceiling rather
  than a fixed cost, which is the better version of the same lever.
- **Aspiration windows / MTD(f) / a proper PV table.** Real further gains, and all
  of them are changes to *how each game searches* rather than to the shared
  driver. Once `deepen` exists they can be added per game without touching it.
  Deliberately not bundled: this plan's claim is that the tail is bounded, and
  three simultaneous search changes would make a moved baseline unattributable.
- **The persona roster** and **CI job timeouts** — separate open items, unrelated.

---

## Open Questions

1. **One budget constant per game, or per level?** A single per-game budget is
   simpler and makes Easy inherit a tail bound it does not need. Per-level lets
   Expert spend more than Easy, which is arguably what a difficulty level *means*.
   Decide from Phase 0's distribution — specifically whether the low levels ever
   approach the budget at all. Leaning: one per game, because the low levels are
   depth-bounded well below it and a second table is a second thing to keep true.
2. **Should the tutor share the opponent's budget?** The tutor already searches at
   its own depth (`TUTOR_DEPTH`, `COACH_DEPTH`) and a panel opening can afford what
   a tap cannot — checkers' `TRACTABLE_PIECES` doc already anticipates exactly this
   asymmetry. Leaning: a separate, larger tutor budget, decided in Phase 5 once the
   opponent's is calibrated.
3. **Does the graded oracle path get a budget at all?** `ORACLE_DEPTH` exists to
   outrank the player it grades (fixed in `1bc3b29`). Budgeting the grader risks
   re-weakening it below the player — the P8 defect where "optimal" became true by
   construction. Leaning strongly: **no budget on the oracle path**, and a test
   that pins that.

---

## Review Log

### Phase 0 — Discovery (2026-08-07)

Probe: self-play through the built wasm in Node/V8, timing every top-level
`live_move` and recording the position size it was made at. Othello 2 seeds (61
plies each), checkers and Drop 4 3 seeds. Machine: darwin/arm64, Node 22.23.2.

**Two probe defects found before any number was trusted**, both worth recording
because each produced a plausible-looking wrong answer:

1. `board_json`'s `cells` is row-major **nested** (`Vec<Vec<u8>>`), so a flat
   `.filter()` counted zero pieces and every sample was labelled `@0`.
2. A wasm `u32` arrives in JS as a **signed** i32, so `MOVE_PASS` (`0xFFFFFFFE`)
   and `MOVE_OVER` (`0xFFFFFFFF`) came back as `-2`/`-1` and compared equal to
   nothing. The pass path never fired, `play(-2)` was rejected, the status was
   ignored, and the loop spun to its 200-iteration cap — reporting "200 moves"
   for a game that has 61. The first Othello run still reported a 2100ms worst
   call, which is the right number by luck, from a run that was measuring
   garbage.

The lesson is the same one the six defects of 2026-08-06 taught: a number that
matches the number you expected is not thereby verified.

#### Worst single `live_move`, by game and level

| level | checkers | Drop 4 | Othello |
|---|---|---|---|
| 0 Easy | 0.6ms | 0.3ms | **965ms** |
| 1 Medium | 15ms | 1.9ms | 314ms |
| 2 Hard | 61ms | 99ms | 1,422ms |
| 3 Expert/Perfect | **337ms** | **914ms** | **2,115ms** |

#### Distribution at the top level

| | median | p95 | worst | worst at | >200ms | >400ms |
|---|---|---|---|---|---|---|
| checkers | 42ms | 127ms | 337ms | 18 pieces | 4% | **0%** |
| Drop 4 | 29ms | 803ms | 914ms | 9 filled | 36% | 20% |
| Othello | **262ms** | 1,452ms | 2,115ms | 36 empties | **57%** | **38%** |

#### What reproduced

- Othello **2,115ms at 36 empties** — the recorded ~2.1s, exactly, position and all.
- Checkers **337ms at 18 pieces** — the recorded ~341ms at 13–18 pieces.

The Problem Statement's premise stands. Three of its consequences do not.

#### Finding 1 — "bound the tail" is true for checkers only

This plan asserted the budget "should be set so the *typical* move is unaffected
and only the tail is clipped," and that a budget biting the median is "a strength
regression wearing a latency fix." Measured:

- **Checkers is a true tail** — 4% over 200ms, **0% over 400ms**. A budget clips
  the tail and nothing else, exactly as the plan assumed.
- **Othello is a plateau, not a tail.** Its *median* is 262ms and 38% of all moves
  exceed 400ms. There is no budget that delivers a tap-like worst case without
  biting a third of Othello's moves.

So for Othello the framing has to change: this is **not** a free latency fix, it
is a strength/latency trade, and it has to be argued and measured as one. The
plan cannot both promise ~400ms and promise no strength change. Which of the two
gives is an owner decision, informed by Finding 3.

#### Finding 2 — Othello's Easy is slower than its Medium, and that is the worst player-facing defect here

Othello's per-level curve is **non-monotonic**: Easy 965ms, Medium 314ms. Every
other game's curve is clean and monotonic.

Cause: at levels 0–2 Othello's worst call is at **12 empties** — `TRACTABLE_EMPTIES`
— not in the midgame. `Mode::Exact` **ignores `depth` and searches to a terminal**,
so the endgame solve costs the same at Easy (depth 1) as at Expert (depth 7). At
Expert the 2.1s midgame hides it. At Easy nothing hides it.

The beginner setting therefore has the second-worst latency in the game, on the
level whose players are least likely to tolerate a pause and most likely to be on
a weak device. `TRACTABLE_EMPTIES`'s doc comment records "move worst 2114ms" and
attributes it to the midgame — true at Expert, and the reason this was missed:
**every previous measurement was taken at Expert.**

This is a second, independent problem from the one the plan was written for. It is
not addressed by iterative deepening on the capped path, because the exact solve
is not a capped search.

#### Finding 3 — Othello has no transposition table, and checkers does

Assumption 4, recorded before measuring, now looks like the lead rather than a
footnote. Checkers searches **deeper** (Expert depth 8 vs Othello's 7) and is
**6× faster** (337ms vs 2,115ms). It has a transposition table; Othello has plain
alpha-beta with static `WEIGHTS` ordering and no table at all.

That reframes the whole Othello problem:

> Othello may not be slow because its midgame is inherently expensive. It may be
> slow because its search is missing the optimization checkers already has.

A table is a **cheaper** search at identical strength. A budget is a **weaker**
search. Trying them in that order is obviously right, and this plan had them in
the wrong order because it was written from the TODO's framing rather than from a
measurement. If a table brings Othello's worst call down near checkers', the
strength trade in Finding 1 may not need to be made at all.

#### Revised phasing

The original Phases 1–11 are superseded. Replacement, most-informative-first:

- **Phase 1 (new): Othello gets a transposition table.** Test-first, modelled on
  `checkers-solver`'s, including its `Bound`/window discipline. Pure speed at
  identical strength — the move values must be **unchanged**, which is a directly
  assertable property and the strongest possible regression test. Re-measure.
  This phase may reduce or eliminate the need for the rest of the Othello work,
  and it is the only phase here that costs nothing in strength.
- **Phase 2 (new): bound Othello's exact endgame solve** (Finding 2). Includes the
  honesty-flag hazard below, which is a correctness bug independent of latency.
- **Phases 3+:** `NodeBudget`, `deepen()`, and the per-game adoption, as originally
  written — but with checkers first (a true tail, 0% over 400ms, the case where
  the mechanism is provably free) and Othello last, once Phases 1–2 have said how
  much is left to solve.

#### A correctness hazard found while reading, not yet a phase of its own

`othello-solver/src/live.rs::choose` derives the honesty flag from the position,
not from the search:

```rust
let exact = empties <= crate::search::TRACTABLE_EMPTIES;
let values = move_values(board, band.depth);
let class_of = if exact { i32::signum } else { capped_class };
```

`exact` is a function of `empties` **alone**. Today that is sound, because at or
below `TRACTABLE_EMPTIES` the search really does solve to a terminal. The moment
any budget can abort that solve, the values stop being proven while `class_of`
still says `i32::signum` — the class floor would then claim to preserve a *known*
class from *heuristic* values. That is precisely the flag-becomes-a-lie failure
mode `checkers-solver/src/search.rs`'s module docs are built to prevent, arriving
in Othello by a different door.

So any budget on the exact path must make the flag follow the **search**, not the
empty count. Folded into Phase 2.
