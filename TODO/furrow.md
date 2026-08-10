# Furrow (mancala) — shipped 2026-08-10

`/furrow/` is the shelf's **fifth** adversarial game, and the first built to
*inherit* the shared abstraction rather than to prove or to stress it. Built to
`plans/2026-08-07-mancala.md`, whose per-phase execution notes hold every
measurement that contradicted the plan — and there were more of those here than in
any game before it. This file is the running worklist of what was deferred.

## What shipped

- `crates/furrow-{core,solver,wasm}` — Kalah at 6 pits × 4 seeds: sow
  counterclockwise skipping the opponent's store, an extra turn on your own
  store, capture into an empty own pit, and a **sweep** when a side empties.
- **Exact from 16 seeds in play down**, a depth-capped heuristic above it, with
  `exact` derived from whether the search reached terminals and never from the
  position.
- `src/games/furrow/{furrow,furrow-wasm,furrow-outcome,furrow-oracle,furrow-howto}.ts`
  — playable at `/furrow/`, opt-in tutor, hints that declare themselves as
  assistance, WebGPU-gated experimental opponent (persona **Millet**), verifiable
  `?r=` share, guide.
- Grades through the AI-scoring harness with **no rig change**, and anchors a
  recorded baseline in `tests/baselines.test.ts`.

## Measured, so nobody re-derives it

- **Latency is a non-problem.** 0% of moves over 400 ms at *every* level; the
  worst move in the game is 89 ms. Two different worst cases: the cheap levels'
  is the first exact solve with a cold table, Expert's is the **opening**.
- **Iterative deepening is rejected**, and not by analogy with dots. Over 960
  plies the capped search's budget truncated a move list **zero times**, so
  `deepen` has no incomplete iteration to rescue. The plan's prior — narrow
  branching plus a deep midgame — was about the shape of the game; the answer was
  about the size of the budget.
- **27% of a side's moves are graded** by the harness, between checkers' 5% and
  dots' 83%. Read that number *with* any blunder count, always — see below.
- **The blunder count cannot tell this game's levels apart.** Easy loses
  **0-0-12** to Expert and records **zero blunders**, as does Expert. Written up
  in `docs/HARNESS.md`.
- **The heuristic's weights were swept and kept.** 16 rows × 40 games; no
  candidate beat the shipped `(1, 3, 2)`. The scale control `(2,6,4)` **failed**,
  which is the useful part: it proved `side_seed` is the term that denominates the
  heuristic in seeds so it can be added to a real margin, not a free parameter.
- **Phase 0's transposition-table sizing was wrong by ~500×** and Phase 3 refuted
  it in place: 2,827 live entries at the threshold, not 1.65M, so the table is
  640 KB rather than ~10 MB.

## Open follow-ups

- [x] ~~**The live WebGPU hybrid trial has never been run.**~~ **Run 2026-08-10**
  on system Chrome (Apple/Metal-3), 8 games vs Expert, Qwen2.5-0.5B. Millet is now
  measured, and the result changed shipped copy:

  | | value |
  |---|---|
  | W-D-L vs Expert | **1-0-7 (13%)** — the engine itself draws 50% |
  | fallback rate | **10.9%** (12 of 110 model calls unusable) |
  | cost | **~1,483 ms per graded move**, against the engine's 7.8 ms median |
  | blunders | 0 over 23 graded moves — and see below |

  **The disclosure was overclaiming.** It said "it never plays a losing move (the
  engine's band decides)", copied from dots, where it is true because 3×3 is
  solved from four plies in. Here ~70% of a game is above the exact threshold, so
  the band is the engine's *judgement* rather than a proof, and the model
  measurably loses inside it. The copy now states the download size, that Millet
  plays weaker than the engine, and why. Written up in `docs/AI-PLAYERS.md` →
  "The band's guarantee is only as strong as the exact fraction".
- [ ] **Persona roster** — Millet is inlined in `furrow.ts`, as Chip, Rowan, Alder
  and Bramble are in their games. Part of the cross-game roster thread
  (`TODO/README.md`).
- [ ] **A board-size or seed-count picker is deliberately absent.** `PITS` and
  `SEEDS` are hashed as little-endian `u32`, so adding a variant later is additive
  and re-locks no golden vector — but it multiplies the solver tuning, the
  tractability threshold and the band by the number of variants, and a bigger
  board pushes the exact threshold further out of reach of a browser.
- [ ] **The first-player advantage is unmeasured.** The literature reports
  Kalah(6,4) as a first-player win by retrograde analysis; nothing here reproduces
  that and nothing relies on it. The human opens by default because no seat is
  known to be losing — unlike dots, where the seat *is* known and the default
  exists to protect the player.
- [x] ~~**`eval`'s weights were never tuned.**~~ **Swept 2026-08-10**
  (`crates/furrow-solver/tests/weight_sweep.rs`, 16 rows × 40 games). **No
  candidate beat the shipped `(1, 3, 2)`; nothing was adopted.** What the sweep
  did establish: both non-seed terms are load-bearing (dropping the extra-turn
  term costs ~11 points, the capture term ~15), the shipped values sit in a **flat
  basin** (`extra_turn` 2–5 and `capture` 1–4 are indistinguishable at n=40), and
  **`side_seed` is a unit rather than a knob** — the heuristic is added to real
  seed counts, so it must be denominated in seeds, and moving it off 1 costs
  33 points. Re-open only with ~400 games/row, and only with a reason to think a
  3-point difference is there to find.
