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
- **Phase 0's transposition-table sizing was wrong by ~500×** and Phase 3 refuted
  it in place: 2,827 live entries at the threshold, not 1.65M, so the table is
  640 KB rather than ~10 MB.

## Open follow-ups

- [ ] **The live WebGPU hybrid trial has never been run.** `HARNESS_TRIAL_GAME=furrow
  npm run harness:trial` needs system Chrome and a one-time model download, which
  is an owner-machine task. What is proven on CI is the *gating* and the
  never-leave-the-band guarantee under a mock runtime — not the model. Do not
  describe Millet as measured. Dots is in the same position, so this is one item
  with two games in it (`TODO/dots.md`).
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
- [ ] **`eval`'s weights were never tuned.** `SIDE_SEED` 1, `EXTRA_TURN` 3,
  `CAPTURE` 2 are reasoned and policy-tested, not fitted. The heuristic decides
  ~70% of a game, so a self-play sweep over the three weights is the highest-value
  strength work available on this game — and `docs/AI-PLAYERS.md` → "Measuring the
  strength cost" has the protocol and its traps.
