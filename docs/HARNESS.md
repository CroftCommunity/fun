# The browser AI-scoring harness (P6)

The objective measurement rig for the shelf's AI players. It plays games between
two players **in the browser**, over the shipped `drop4-wasm`, grades every move
against the wasm's own exact oracle, and aggregates a scorecard — the browser
mirror of the Rust `drop4-harness`. It is what turns claims like "the LLM adds
personality, not strength" and "the hybrid stays in-band (0 blunders)" into
repeatable numbers measured against the *actual shipped browser players*.

The full AI rationale lives in `docs/AI-PLAYERS.md`; this doc is the harness's
own guide.

## What it measures

For a matchup of two `Player`s over N games it reports, for the player under
test: games, W-D-L, and — over the moves it can grade **exactly** —
`optimal · resultPreserving · blunder`, the blunder rate, and the per-move cost
(ms). A **blunder** is a move that provably drops the win/draw/loss class (throws
a win, or a draw into a loss); it is the load-bearing metric, because the whole
hybrid design rests on "the band is class-preserving, so the LLM can never
blunder."

## The vocabulary

Mirrors the Rust `drop4-harness` so the two rigs' numbers are comparable.

- **`Player`** (`src/harness/match-runner.ts`) — `chooseMove(game) => Promise<number | null>`.
  Implementations wrap already-shipped code, re-implementing no rules (the wasm
  decides legality):
  - `EnginePlayer(level)` → `Drop4.liveMove(level)` (the classic engine).
  - `HybridAiPlayer(hybrid)` → `buildBand(game.tutor().moves)` + `HybridPlayer.pick`
    (the experimental band + in-browser-LLM opponent).
  - `RandomPlayer(seed)` / `GreedyPlayer` — cheap, deterministic trial baselines.
- **`MatchRecord`** — `{seed, moves, result, hash, aborted, timings}`. Replaying
  `(seed, moves)` through a fresh `Drop4` reproduces `hash` — a verifiable match
  regardless of who chose each move. An illegal/`null` move **aborts** the match
  (records `aborted: true`) rather than looping forever.
- **`Scorecard`** (`src/harness/scorer.ts`) — games, W-D-L, `scoredMoves`,
  `optimal`, `preserving`, `blunders`, `skippedEarly`, `moveMsTotal`, plus
  `blunderRate()`.
- **`Report`** (`src/harness/tournament.ts`) — a matchup label + the aggregate
  scorecard, with `renderReport()` for a one-block text.

## The exact-only grading gate (and the 16-vs-12 reconciliation)

A move is graded **iff the wasm reports its assessment is `exact`** — i.e. the
position is in the tractable endgame. `foldVerdict` routes an exact verdict to
its quality bucket; a non-exact verdict is counted `skippedEarly` and **never**
blended into the quality numbers. Grading a horizon-approximate (capped) verdict
would report a "blunder rate" that isn't provably a blunder rate; the gate keeps
every graded verdict provably correct.

The browser gate is the wasm's `exact` flag (≤ `TRACTABLE_EMPTIES` = 16 empties);
the Rust rig uses ≤ `SCORE_MAX_EMPTIES` = 12. The browser region is a **strict
superset** — it grades a few more endgame moves — but every graded verdict is
still provably exact. Both rigs are honest; the difference is documented here,
not hidden.

## The hexagonal split — what runs on CI, what doesn't

- **Pure scorer** (`scorer.ts`): folds `{quality, exact}` verdicts into a
  scorecard. No wasm, no LLM. Fully unit-tested.
- **Imperative runner** (`match-runner.ts`, `tournament.ts`): drives a real
  `drop4-wasm` instance. Exercised in vitest with **deterministic** players
  (`EnginePlayer("Perfect")`, `RandomPlayer(seed)`) loading the real wasm via the
  `globalThis.fetch` shim — the full rig runs on the CI gate.
- **The WebGPU hybrid** can't run under vitest (no `navigator.gpu`), so the CI
  test proves the plug-in with a `MockRuntime`, and the *real* Hybrid-vs-Engine
  trial lives in a standalone system-Chrome driver, **off CI**.

CI tests: `tests/match-runner.test.ts`, `tests/scorer.test.ts`,
`tests/tournament.test.ts` (all wasm-backed; full Perfect games run ~10 s, so
they set a raised per-test timeout and keep N small).

## Running the real trial

```
npm run harness:trial
HARNESS_TRIAL_GAMES=4 HARNESS_TRIAL_MODEL=Qwen2.5-0.5B-Instruct-q4f16_1-MLC npm run harness:trial
```

This is a standalone script (not a Playwright project): it serves the built app,
launches **system Chrome** against a real same-origin page (WebGPU needs a real
secure origin), imports the embedded `/vendor/harness.js`, and runs a
Hybrid-vs-Engine tournament over the real WebGPU model + wasm. It emits a
**staged diagnostic** (gpu-adapter → harness-loaded → model-load → first-move →
per-game tally → per-move ms) so a slow or hung run is legible and an implausible
Report is localizable. The model downloads once into a persistent `.webllm-cache`.

## Reading a Report

A recorded run (`Qwen2.5-0.5B` hybrid vs the Perfect engine, 2 games, real
WebGPU, apple/metal-3):

```
Hybrid(Qwen2.5-0.5B-Instruct-q4f16_1-MLC) vs Engine(Perfect)
  games 2 | W-D-L 0-0-2 (win rate 0%)
  graded moves 7 (skipped 26 early) | optimal 6 · preserving 1 · blunders 0 (blunder rate 0.0%)
  cost 7910ms total (1130.1ms/graded move)
```

How to read it — this is the harness's whole thesis on one line:

- **W-D-L 0-0-2** — the hybrid lost both to the Perfect engine. The LLM adds no
  strength.
- **blunders 0 over 7 graded moves** — and yet it never threw the game-theoretic
  class. Legality and class-preservation are by construction (the band is the
  never-blunder set; the LLM only reorders within it). Note the **denominator**
  is always shown: "0 blunders" is meaningless without the graded-move count, and
  the exact-only gate can grade zero moves in a short game.
- **~1130 ms/graded move** — the LLM is slow, not strong. Contrast the engine's
  sub-millisecond move.

Conclusion, in numbers: the engine is the player; the LLM is the face.
