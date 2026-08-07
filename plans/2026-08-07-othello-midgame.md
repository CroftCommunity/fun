# P9 Part B — Othello's midgame plateau: the one that costs strength

**Status:** drafted 2026-08-07, not started
**Repo:** `fun` (fun.croft.ing)
**Parent:** `plans/2026-08-07-midgame-latency-floor.md` — Phases 0–3, which fixed
Othello's endgame stall and Drop 4's opening, reverted checkers, and established
the measurement protocol this plan depends on.

---

## Problem Statement

Othello at Expert is the last and worst of the three, and it is the only one that
cannot be fixed for free.

| Othello Expert, after Phases 1–2 | value |
|---|---|
| worst single move | **1,901ms** (36 empties) |
| median move | **233ms** |
| moves over 400ms | **38%** |
| moves over 800ms | 24% |

Phase 1's transposition table took the worst move from 2,115ms to 1,743ms and
Phase 2 took the endgame stall out, but neither touched this. What remains is the
**midgame heuristic search** — the position class where Othello has the most legal
moves, no forcing captures to narrow the tree, and a horizon that reaches nothing
conclusive.

### Why this one is different from the two that are done

Drop 4 and checkers were latency problems with no strength question attached.
Othello is a **plateau, not a tail**:

```
  checkers   ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▂▃  0% over 400ms   → budget never bites, reverted
  drop 4     ▁▁▁▁▁▁▁▂▄▆███     20% over 400ms  → budget bites the opening only
  othello    ▃▄▅▆▇███████▇▆    38% over 400ms  → no cheap region to fall back on
                                median already 262ms
```

There is no budget that gives Othello a tap-like worst case without biting **a
third of its moves**. So this plan cannot promise both latency and unchanged
strength, and it should not pretend to. Its actual job is to **measure the trade
honestly and put the choice in front of the owner**, with a recommendation but
not a unilateral decision.

That framing is the deliverable. A number picked without the table would be the
same mistake as the `wins + draws >= 3` bar that passed on a collapse.

---

## Reasoning

### Why iterative deepening is the right mechanism here and was the wrong one for checkers

Phase 3 produced a rule the parent plan did not have:

> Iterative deepening is a net loss without best-move ordering, and a smaller net
> loss with it. It pays only where the budget bites often enough to recover the
> cost of re-searching depths `1..n-1`.

Measured: with best-move ordering, deepening costs **~14% more nodes** than a
direct search when the budget never fires. Checkers' budget fires on 0% of moves,
so that 14% was pure tax and checkers was reverted.

Othello's budget would fire on **38%** of moves, and on those it saves far more
than 14% — a depth-7 search that stops at depth 5 saves roughly an order of
magnitude. The arithmetic that condemned checkers acquits Othello. This is worth
stating because the two decisions look contradictory and are the same rule.

### Best-move ordering is a prerequisite, not an optimization

Phase 1 measured best-move ordering as worth **0.4%** inside a single fixed-depth
search and reverted it as speculative. Phase 3 measured it as worth the difference
between a 65% tax and a 14% tax across deepening iterations. It has to come back,
and this time a test can demand it: **deepening must not cost more than the direct
search it replaces**, asserted as a node count (the shape of
`deepening_costs_no_more_than_the_direct_search_it_replaces`, which is in the
checkers revert and can be lifted from git history rather than rewritten).

### The strength measurement protocol, which is the part most likely to go wrong

Phase 3 nearly shipped a false "collapse" finding. The protocol below is what it
cost to learn, and every clause is there because its absence produced a wrong
number:

1. **Randomise the opening.** `<Othello as Adversary>::initial(seed)` is the
   *standard* Othello opening for every seed — exactly the trap Drop 4 had. With
   zero sloppiness neither player draws from the RNG, so without random opening
   plies every game with the same first player is bit-identical and N games are
   really two. Othello has this bug waiting in exactly the same form.
2. **Include a control row.** A budget so large it never bites is the unbudgeted
   engine playing *itself*; whatever it scores is the noise floor. Drop 4's
   control was 14W-5D-11L, not 15-0-15, because random openings are not
   symmetric between seats. Without that row the table is uninterpretable.
3. **Alternate seats** across seeds.
4. **State the sample size next to the claim.** 30 games cannot resolve a small
   difference. "No measurable cost at 30 games" is honest; "no cost" is not.
5. **Do not use the harness baseline for this.** Othello's anchor grades 12 moves
   and skips 48 early; the budget bites in the midgame, which is largely skipped.
   The anchor is a regression detector, not a strength instrument.

### What must not change

- **`preserving` must not drop.** A shallower search is still class-preserving
  with respect to what it knows. A drop there is a defect in this work, not a
  consequence of it.
- **The honesty flag stays bound to the search.** Phase 2 made
  `live::choose` read what the search did rather than the empty count. The
  midgame path is `Mode::Capped`, whose `capped_class` is a constant `0`, so the
  floor is already a no-op there — but the *exact* path must keep its Phase 2
  behaviour untouched, and a deepening driver bolted over both would be the
  obvious way to break it.
- **The oracle and tutor stay unbudgeted.** Budgeting the grader re-opens the P8
  defect where "optimal" became true by construction.

### Rejected: lowering Expert's depth

Depth 7 → 5 bounds the tail by making the opponent worse *everywhere*, including
in the 62% of positions where depth 7 was already affordable. Deepening under a
budget is the same lever applied only where it is needed. Keep depth 7 as the
ceiling.

### Rejected again: wall-clock

Unchanged from the parent plan, and now with more at stake: the baselines are
about to be re-recorded, and a wall-clock bound would make them unrecordable.

---

## Verified Assumptions

Established by Phases 0–3, not assumed:

1. Othello's TT exists, is per-top-level-call, stores `Mode::Exact` entries at
   `u32::MAX` depth, and changes no values (`Table::disabled()` asserts it).
2. `Table::nodes()` exists, so cost is directly assertable.
3. `move_values_honest` / `Valued` already separate the exact path from the capped
   one, so deepening can be added to the capped branch alone.
4. `deepen()` exists in `adversary-solver`, is mutation-audited, and its
   last-complete-iteration semantics are pinned by test.
5. `NodeBudget` latches exhaustion, and both games' searches already refuse to
   store truncated results in their tables.
6. Othello's per-level depths are 1/3/5/7 and the midgame cost is dominated by
   Expert; Hard's worst is now 236ms and already inside target.
7. `crates/drop4-solver/tests/budget_sweep.rs` is a working template for the
   sweep, including the control row and randomised openings.

### To be verified, not assumed

- **That deepening pays at Othello's bite rate.** The 14%-tax figure is checkers'.
  Othello's tree is wider and its TT hit rate different; the tax could be larger.
  Phase B1 measures it before anything is wired to a level.

---

## Phases

### Phase B0: Restore best-move ordering to Othello's table, and prove it pays

Re-add `best: Option<Move>` to `TtEntry` and `ordered_with`, both reverted in
Phase 1. RED first, with the node-count test lifted from the checkers attempt:
deepening must cost no more than the direct search. Expect this to fail before
ordering is restored, exactly as it did for checkers (74,508 vs 45,027 there).

Gate: values unchanged, asserted against `Table::disabled()` as Phase 1 does.

### Phase B1: Deepen the capped path only

`move_values_honest`'s capped branch becomes a `deepen()` call under a budget;
the exact branch keeps Phase 2's behaviour byte-for-byte. Report the depth reached
alongside `Valued.exact` — a level that promised 7 and delivered 5 should be able
to say so, and the tutor may eventually want to.

Measure the deepening tax at Othello's shape **before** choosing any budget. If it
exceeds roughly 25%, stop and reconsider: the mechanism may not survive Othello's
branching factor, and that is a finding, not a setback.

### Phase B2: The strength/latency table — **the deliverable**

An `#[ignore]`d sweep modelled on `budget_sweep.rs`, with all five protocol
clauses above. Budgets spanning roughly 100k to 4M nodes (the top row being the
never-bites control), reporting per budget:

- worst / median / p95 single `live_move` **in wasm**, not native;
- % of moves over 400ms;
- typical depth reached in the midgame;
- W-D-L against unbudgeted Expert over ≥40 varied-opening games;
- the exact-report rate, since a shallower midgame changes how often the tutor
  has something proven to say.

**This phase produces a table and stops.** No budget constant is chosen inside it.

### Phase B3: Owner picks the point on the curve

Bring the table back with a recommendation. The plausible answers, in advance, so
the choice is framed rather than sprung:

- **Bound it hard (~400ms).** Othello feels like the other two. Costs real
  strength on ~38% of moves; Expert becomes "strong" rather than "the strongest
  search we can run".
- **Bound it loosely (~800ms).** Halves the worst case, clips the 24% tail, keeps
  most of the strength.
- **Bound Expert only, leave Hard alone.** Hard is already 236ms. Makes the
  levels mean different things, which may be the honest reading of "Expert".
- **Do nothing and write it down.** A 1.9s worst move on the top difficulty of a
  turn-based board game is defensible. This option stays on the table until the
  measurements say otherwise, and it is not a failure of the plan.

### Phase B4: Land the choice

Constant with its measurement table in the doc comment; re-record the baselines
with the reason; check `preserving` did not drop and `abortedGames` did not move.

### Phase B5: Docs and close-out

`TODO/README.md`'s cross-game thread (which this completes or consciously leaves
open), `TODO/othello.md`, `docs/AI-PLAYERS.md` (the named depth is a ceiling, not
a promise), `docs/BUILDING-GAMES.md` §10, and a `STATE-OF-PLAY.md` successor.

Include the checkers non-adoption. A future reader will otherwise "notice" that
checkers is missing the driver and helpfully add it back.

---

## Not in this run

- **Checkers.** Measured, rejected, reverted. Do not re-adopt without a
  measurement showing its distribution has changed.
- **Aspiration windows / MTD(f) / a real PV table.** Genuine further gains and all
  per-game search changes. Bundling them would make a moved baseline
  unattributable — the parent plan's reasoning, unchanged.
- **Re-tuning `TRACTABLE_EMPTIES`.** At its measured knee, and below the midgame
  cost. Phase 2's budget is the endgame lever now.
- **A wall-clock outer guard.** Still the follow-up if node budgets prove
  insufficient on real hardware, and still outside the hashed and graded paths.

---

## Open Questions

1. **Does the budget apply per level, or only to Expert?** Hard is 236ms and
   needs nothing. A single constant is simpler; an Expert-only budget says
   something truer about what the levels mean. Decide from B2's table.
2. **Should the tutor's exact-report rate constrain the budget?** A shallower
   midgame means fewer proven tutor facts. If B2 shows the rate falling
   materially, that is an argument for the looser bound that the latency numbers
   alone would not make.
3. **Is 40 games enough?** Drop 4's 30 could not resolve a small difference and
   the plan said so. If Othello's control row is as uneven, the table may need
   100+ games — which is affordable off-CI and should be run rather than
   estimated.

---

## Review Log

### Phases B0–B1 — deepening the midgame (2026-08-07)

**The plan's central premise was wrong, in the good direction.** It said Othello
was "the one that cannot be fixed for free" and that its job was to price a
strength/latency trade. Deepening turned out to be a **speed win at identical
values**, and most of the gap closed before any budget existed.

| midgame nodes, 36 empties, Expert | |
|---|---|
| direct search | 526,877 |
| deepening, no best-move ordering | 746,143 (**+41% tax**) |
| deepening + best-move ordering | **311,902 (−41%)** |

In wasm, Othello Expert:

| | before B0 | after B1 |
|---|---|---|
| worst | 1,901ms | **753ms** |
| median | 234ms | 180ms |
| p95 | 1,243ms | 667ms |
| >800ms | 24% | **0%** |
| >400ms | 38% | 28% |

All three baselines reproduce exactly — the values did not change, only their
cost. Othello's own baseline run fell from 48.5s to 31.4s.

#### Why this is the opposite of checkers, and the same rule

Phase 3 measured deepening on checkers as a 14% tax and reverted it. Here it is a
41% saving. The difference is entirely **how good the existing move ordering
was**:

- Checkers orders by capture length, and mandatory capture does most of the work
  already. A shallow pass has little to add, so re-searching `1..n-1` is close to
  pure overhead.
- Othello orders by a static corner/edge weight table, which is a weak guess. A
  shallow pass's actual best move is far better, and the improved cutoffs more
  than repay the re-search.

So the rule from Phase 3 stands and gains a second clause: deepening pays where
the budget bites often **or where the static move ordering is poor**. Othello has
both; checkers has neither.

#### The Phase 1 revert was right, and this does not contradict it

Best-move ordering measured 0.4% in Phase 1 and was reverted as speculative code.
That measurement was correct: inside one fixed-depth search there are almost no
re-visits to order. Deepening is what *creates* the re-visits. The ordering
belonged with the driver, which is exactly where the Phase 1 note said to put it.

#### What this does to Phase B3's options

The framing in B3 was written against a 1,901ms worst case. It is now 753ms, and
"bound it loosely (~800ms)" has effectively been achieved **for free**. The live
question is narrower than the plan anticipated:

- **Do nothing more.** 753ms worst, 0% over 800ms, no strength cost anywhere.
- **Bound at ~400ms.** Would still bite 28% of moves and now has to justify
  itself against a much better baseline than the one that motivated it.

B2's table is still worth having, because "is the remaining 28% worth buying" is
a real question — but it is now a question about polish rather than about a
defect.

_(B2 onward: to be filled in. Phases 0–3 of the parent produced four corrections
and this phase produced a fifth; assume more.)_
