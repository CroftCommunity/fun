# Othello (Reversi) — backlog

Authoritative plan: `plans/2026-08-03-othello-game.md`. Standards:
`docs/BUILDING-GAMES.md` §10 (AI opponents), `docs/AI-PLAYERS.md`. This file is
the running checkbox worklist. Othello is the shelf's **generality proof** — the
second adversarial game, reusing the harness + trait a first game established.

## Done
- [x] Phase 0 — discovery: rules reference (4 textbook opening moves {19,26,37,44},
  the d3 flip, forced pass, terminal-by-count) fixed as Phase 1 fixtures;
  `TRACTABLE_EMPTIES` gated to Phase 2 (wasm-measured); harness fit confirmed.
- [x] Phase 1 — `othello-core`: 8×8 board, place-and-flip over 8 directions,
  forced-pass (`legal_moves` → `[Pass]`), terminal-by-count, `Adversary` +
  `pond_outcome::Game`; `Move` serializes as a compact `u8` (0..63 place, 64 pass)
  so `?r=` is a plain number array. Replay round-trips forced passes.
- [x] Phase 2 — `othello-solver`: positional/mobility heuristic + alpha-beta with
  an **exact endgame solve** (cross-checked vs an independent minimax); difficulty
  band (class floor + sloppiness; the selector was duplicated per rule-of-three,
  and moved to `adversary-solver` 2026-08-05);
  engine-grounded tutor (`takes_corner` fact; capped mode never grades a Blunder).
- [x] Phase 3 — `othello-wasm`: C-ABI (play/pass/board/tutor/outcome…); tutor view
  is a structural superset of the shared TS `TutorFactMove` so `buildBand` reuses
  unchanged; `takesCorner` carried.
- [x] Phase 4 — typed `Othello` wrapper + `othello-outcome.ts` (verifiable `?r=`,
  passes replay via `PASS_CODE`).
- [x] Phase 5 — playable `/othello/` vs the engine, wired: tap-to-place-and-flip,
  forced-pass beats, difficulty + disc pickers, disc-count result + `?r=` share.
- [x] Phase 6 — the opt-in tutor (honest exact/heuristic wording, `coachFor` unit
  gate), the WebGPU-gated experimental local-AI opponent (persona **Rowan**,
  reusing `hybrid-player.ts`/`ai-runtime.ts` unchanged), the how-to + guide shots,
  and the docs (README, BUILDING-GAMES §10, AI-PLAYERS generality note).

## Open threads / later
- [x] **Extract a shared `adversary-solver` crate** — DONE 2026-08-05, when
  checkers became the third adversarial game. `select_in_band` + `LiveBand` moved
  verbatim and generic over the move type; `capped_class` and `live_band` stayed
  per-game (Othello's `capped_class` returns a constant `0`, Drop 4's classifies a
  horizon class — they are not the same function). Both shipped games reproduce
  their recorded harness baselines exactly across the migration.
- [x] ~~**The hybrid trial aborts games**~~ — **fixed 2026-08-06.** A 2-game
  `HARNESS_TRIAL_GAME=othello` run reported 1 aborted while drop4 and checkers
  aborted none. Cause: at a **forced pass** there is no placement to band, so
  `HybridAiPlayer.chooseMove` returned `null` — and `runMatch` reads a `null` from
  a live position as an abort. `RandomPlayer` and `GreedyPlayer` had the same
  shape (empty `legalMoves()` → `null`). All three now fall through to
  `liveMove`, which knows about the pass and returns `null` only at a true
  terminal; the fix is game-agnostic and a game without a pass is already terminal
  in that position. Re-run: **0 aborted, 8 graded** (was 5). Only visible at all
  because P8 Phase 2c added the abort counter.
- [x] ~~**"Takes a corner" band enrichment**~~ — **done 2026-08-06.**
  `TutorFactMove` (and the port's `OracleTutorMove`) gained an optional `idea`,
  and `buildBand` prefers it over the shared `ideaFor`, which only ever knew the
  two Drop-4 booleans. Othello supplies "takes a corner" on both paths — the UI
  band and the `othelloOracle` adapter, so the harness's hybrid narrates it too —
  and checkers supplies its capture count the same way. It is a **label, not a
  licence**: the band still excludes blunders, so an enthusiastic idea cannot
  promote an unsafe move (asserted).
- [x] ~~**Tune `TRACTABLE_EMPTIES` against in-wasm wall-clock.**~~ **Done
  2026-08-06 — and it found a bug, not a tuning problem.** Measuring the shipped
  setting (10) in wasm gave a worst `live_move` at Expert of **19,187ms**, with
  the spike sitting exactly at 17 empties = `TRACTABLE_EMPTIES + Expert.depth()`.
  Cause: `negamax` re-decided exact-vs-capped from *each node's* empty count, so a
  depth-7 capped search reached the boundary at its leaves and turned every one of
  them into a full solve-to-terminal. Lowering the constant only moved the spike
  (8 → 15 empties, 3275ms). The mode is now decided once at the root and carried
  down: **19,187ms → 2,112ms**, tutor worst 1,915ms → 119ms, proof rate unchanged.
  With the blowup gone the constant could then be *raised* 10 → **12** for free
  (+3.3pp proven reports, no latency change); 14 was measured too and rejected
  (the root solve reaches 738ms). The remaining worst call is the **midgame**
  heuristic (~2.1s at 36 empties) — the same conclusion checkers reached.
- [x] ~~**The midgame is Othello's latency floor (~2.1s at Expert).**~~ **Done
  2026-08-07** (P9, `plans/2026-08-07-othello-midgame.md`). **2,115ms → 753ms,
  and it cost nothing** — the values are byte-identical and all three baselines
  reproduce exactly.
  - A **transposition table** (Othello never had one; checkers has had one since
    it shipped) — 31% fewer nodes, 18% less wall clock.
  - **Iterative deepening with best-move ordering** carried between passes — a
    further 41% fewer nodes. Othello's static `WEIGHTS` ordering is a weak guess
    that a shallow pass easily beats, which is exactly why checkers saw the
    *opposite* (a 14% tax) and ships none of it.
  - **No node budget was set.** At 753ms with 0% of moves over 800ms, buying the
    remaining 28%-over-400ms costs strength a 40-game rig cannot price. Sweep and
    reasoning: the plan's Review Log, Phase B2. The machinery is plumbed and
    tested (`crates/othello-solver/tests/budget_sweep.rs`), so it is a one-line
    change if revisited — but fix the measurement first (400+ games, or a
    reference stronger than the same engine).
- [x] ~~**The endgame solve stalls the low levels.**~~ **Done 2026-08-07** (P9
  Phase 2). `Mode::Exact` ignored `depth`, so Easy paid Expert's bill: 510–580ms
  worst on a level whose median move is **0.1ms**. Now budgeted, with a
  whole-result fallback to a capped search and — the part that matters —
  `live::choose` reading the honesty flag from **what the search did** rather than
  from the empty count, which would otherwise have become a lie the moment a
  budget could cut the solve short.
- [ ] **Persona roster** — shared with Drop 4's tracked follow-on (`TODO/drop4.md`):
  a selectable roster of temperaments managed as external prompt files. Rowan is
  Othello's single persona today.
