# The browser AI-scoring harness (P6)

The objective measurement rig for the shelf's AI players. It plays games between
two players **in the browser**, over a shipped game's wasm, grades every move
against that wasm's own exact oracle, and aggregates a scorecard — the browser
mirror of the Rust `drop4-harness`. It is what turns claims like "the LLM adds
personality, not strength" and "the hybrid stays in-band (0 blunders)" into
repeatable numbers measured against the *actual shipped browser players*.

**It is game-agnostic** (P8 Phase 1–3). The rig drives a `GameOracle` — a
ten-member port in `src/harness/game-oracle.ts` — so it grades any game that
ships an adapter. Drop 4, Othello and checkers all do
(`src/games/<game>/<game>-oracle.ts`); adding one is one file, not a rig change —
checkers proved that literally, landing with an empty `git diff` on
`match-runner`/`scorer`/`tournament` (P8 Phase 15). Two contracts every adapter meets:

- **A move is the game's compact numeric wire code** — Drop 4 a column, Othello
  `0..63` to place and `64` to pass, checkers a packed `(from, to, variant)`.
  This is not a concession to the rig: it is already true of every shelf game,
  because it is what lets a `?r=` share be a plain JSON number array.
- **A level is `0..3`**, Easy to *that game's* top. The games' own `Level` unions
  disagree on the top member (Drop 4 `"Perfect"`, Othello `"Expert"`), so there is
  no shared string union to type it with. Code `3` means genuinely perfect play in
  Drop 4 and merely the deepest search in Othello — say "top level", not
  "Perfect".

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
  wasm-backed game through the `GameOracle` port — it names no game. Exercised in
  vitest with **deterministic** players (`EnginePlayer(3)`, `RandomPlayer(seed)`)
  loading the real wasm via the `globalThis.fetch` shim — the full rig runs on the
  CI gate, for Drop 4, Othello **and** checkers.
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
HARNESS_TRIAL_GAME=othello npm run harness:trial     # default: drop4
HARNESS_TRIAL_GAME=checkers npm run harness:trial
```

This is a standalone script (not a Playwright project): it serves the built app,
launches **system Chrome** against a real same-origin page (WebGPU needs a real
secure origin), imports the embedded `/vendor/harness.js`, and runs a
Hybrid-vs-Engine tournament over the real WebGPU model + wasm. It emits a
**staged diagnostic** (gpu-adapter → harness-loaded → model-load → first-move →
per-game tally → per-move ms) so a slow or hung run is legible and an implausible
Report is localizable. The model downloads once into a persistent `.webllm-cache`.

## Reading a Report

### Recorded engine-vs-engine baselines (CI, top level, 2 games, seed 0)

The regression anchors. Any change that touches a solver, a band, or the rig
should reproduce these **exactly** — they are seeded and deterministic — so a
diff here is a finding, not noise.

```
npm run baselines
```

That runs `tests/baselines.test.ts`, which **asserts** every deterministic field
against the numbers below and prints both Reports. Wall-clock is deliberately not
asserted — it is the one number in a Report that is not deterministic, and pinning
it would make the anchor fail on a busy laptop, which is how a regression anchor
gets muted.

It is **opt-in and not part of `npm run unit`**: the Othello run alone is ~110s,
because the exact endgame is genuinely expensive, and that does not belong on a
gate that runs every commit.

**If a number here moves, do not update it to match.** These are the seeded output
of a deterministic engine, so a change means the engine changed — find out why
first. (Phases 7/8 of the checkers plan compared against them across the
`adversary-solver` extraction; both reproduced unchanged.)

```
Engine(3) vs Engine(3)                                       [drop4]
  games 2 (0 aborted) | W-D-L 0-2-0 (win rate 0%)
  graded moves 16 (skipped 26 early) | optimal 16 · preserving 0 · blunders 0 (blunder rate 0.0%)
  cost 8018ms total (501.1ms/graded move)

Engine(3) vs Engine(3)                                     [othello]
  games 2 (0 aborted) | W-D-L 1-0-1 (win rate 50%)
  graded moves 10 (skipped 50 early) | optimal 10 · preserving 0 · blunders 0 (blunder rate 0.0%)
  cost 43736ms total (4373.6ms/graded move)

Engine(3) vs Engine(3)                                    [checkers]
  games 2 (0 aborted) | W-D-L 0-2-0 (win rate 0%)
  graded moves 4 (skipped 159 early) | optimal 4 · preserving 0 · blunders 0 (blunder rate 0.0%)
  cost 15043ms total (3760.8ms/graded move)
```

The three differ in the ways the *games* differ, which is the sanity check worth
making before trusting any number here:

- **Drop 4 draws twice** (`0-2-0`). Connect Four is solved and perfect play from
  the standard opening is a draw, so a decisive result at level 3 would mean the
  "Perfect" engine is not.
- **Othello is decisive** (`1-0-1`). It is not solved from the opening, so its top
  level is a deep search, not perfection — the honest-Oracle shape.
- **Othello skips far more** (50 vs 26) and costs ~9× more per graded move. A
  60-move game with an exact endgame at ≤10 empties grades a small tail of it, and
  each exact solve is expensive. `skippedEarly` is the honesty gate doing its job,
  not a defect.
- **Checkers draws twice and skips almost everything** (159 of 163 plies). Top-level
  self-play grinds to the 80-ply no-progress draw — the honest terminal when neither
  side can force a win — and checkers is `exact` only where the search *proves* a
  terminal, which in a long even game is a handful of plies at the end. A 2.5%
  graded fraction is the thinnest of the three by a wide margin, and it is the
  number to watch: if it ever reaches 0 the anchor has stopped measuring anything.

### All three games, side by side

Recorded 2026-08-06 — the same hybrid (`Qwen2.5-0.5B`) vs `Engine(3)`, 2 games
each, real WebGPU (apple/metal-3). Not baselines (a model is not deterministic);
a sanity check that the Reports differ in the ways the games do:

| game | W-D-L | graded | skipped | blunders | ms/graded move | aborted |
|---|---|---|---|---|---|---|
| drop4 | 0-1-1 | 8 | 20 | 0 | 820 | 0 |
| othello | 0-0-1 | 5 | 40 | 0 | 3619 | **1** |
| checkers | 0-0-2 | 5 | 46 | 0 | 3400 | 0 |

Checkers skips the most by far — 99 of 105 plies. That is the honesty gate, not a
defect: checkers is `exact` only where the search **proves** a terminal, and these
games ended before the endgame where proofs concentrate.

Since 2026-08-06 a hybrid Report also carries **where its moves came from**:

```
  chosen by model 51 · by engine fallback 0 (fallback rate 0.0%)
```

That line is the denominator for every claim above it. "0 blunders" from a player
that fell back on every move is the *engine's* achievement, and until this landed
the Report could not tell the two apart. It is printed only when there is a second
path to report, so engine-vs-engine Reports do not grow a line of zeroes.

The 0% above is not a formality: `HybridPlayer.pick` constrains the model's reply
with a JSON schema whose `move` is an enum of the band, so a well-formed reply is
in-band **by construction** and the fallback fires only on malformed output, a
runtime error, or an empty band. A high fallback rate therefore means the model is
failing to produce parseable JSON at all, which is worth knowing.

The Othello row's single **aborted** game was a real finding, not noise — the
hybrid meeting a forced pass, where the band is empty and the player returned
`null`. **Fixed 2026-08-06** in the shared players; the row is kept because it is
what the abort counter was added for, and before P8 Phase 2c a Report could not
tell you it had happened.

### A hybrid trial run

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
