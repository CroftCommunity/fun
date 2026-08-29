# P6 — browser AI-scoring harness (match-runner · scorer · tournament)

> Pass 1 (develop). The objective **measurement rig** for the shelf's AI players:
> play games between two players in the browser, grade every move against the
> exact oracle, and aggregate legality / W-D-L / optimal-preserving-blunder / cost
> — the browser mirror of the Rust `drop4-harness`, consuming the shipped
> `AIRuntime` / `HybridPlayer` and the wasm oracle. Repo: `fun` (`fun.croft.ing`).

## Problem Statement

The shelf now has two AI players for Drop 4 — the classic engine (`live_move`) and
the experimental `HybridPlayer` (engine band + in-browser LLM pick) — but **no way
to measure them in the browser**. Claims like "the LLM adds personality, not
strength" and "the hybrid stays in-band (0 blunders)" are currently asserted from
the Rust-side harness and one-off `ai:trial` runs, not from a repeatable rig that
scores the *actual shipped browser players* over many games.

A Rust harness already exists and is the proven shape to mirror
(`crates/drop4-harness/src/lib.rs`): `Player` (Random / Greedy / Classic(Level)),
`run_match`, `Scorecard` (games / W-D-L / scored_moves / optimal / preserving /
blunders / skipped_early + `blunder_rate()`), `score_side` (grades each move via
the exact solver, **only** for endgame positions ≤ `SCORE_MAX_EMPTIES = 12`),
`Report`, `run_trial`. But it grades Rust `Player`s against the Rust solver — it
cannot exercise the *browser* `WebLLMRuntime` / `HybridPlayer` (which need WebGPU
and only run in a page).

**Done here =** a browser harness that (a) plays a game between any two
`Player`s over the shipped `drop4-wasm`, (b) grades each move via the wasm's own
exact oracle, (c) aggregates a `Scorecard`/`Report`, with the pure grading + run
logic on the CI gate (deterministic players + `MockRuntime`), and the real
LLM-vs-engine trial behind a standalone system-Chrome driver (not CI). No new game
logic; this consumes what P1–P3 shipped.

## Reasoning

- **Mirror the Rust harness, don't reinvent the metrics.** The Rust `Scorecard` /
  `score_side` / `Report` are the agreed measurement vocabulary (`docs/AI-PLAYERS.md`
  cites their findings). The browser harness reproduces the same shapes so results
  are comparable across the Rust and browser rigs. We are porting the *rig*, over
  a different substrate (the wasm + the TS players), not designing new metrics.

- **Grade via the wasm's exact oracle, gated by the `exact` flag.** The Rust
  `score_side` grades a move only when the position is cheaply solvable (≤ 12
  empties) so the verdict is *provably* exact. The browser already ships that
  honesty gate: `Drop4.assess(col)` / `tutor()` return `{quality, exact}`, where
  `exact` is true only in the tractable endgame (≤ `TRACTABLE_EMPTIES` = 16). So
  the browser scorer grades a move **iff `assess(col).exact` is true** (→
  optimal / preserving / blunder), else counts it `skipped_early`. This reuses the
  shipped exact|capped machinery rather than re-deriving a threshold. (Note the
  gate differs from Rust's 12 by empty-**count**: the wasm's exact region is ≤16,
  so the browser grades a few more endgame moves than the Rust rig — both are
  provably exact; the difference is documented, not hidden.)

- **Hexagonal split so the security/correctness logic is CI-testable.** The rig
  splits into a **pure scorer** (fold `{quality, exact}` verdicts → `Scorecard`;
  no wasm, no LLM — `node`/vitest units) and an **imperative runner** (drives a
  real `drop4-wasm` instance: alternate two `Player`s, record the move list). The
  runner is exercised in vitest by loading the real wasm with *deterministic*
  players (Random(seed) / Greedy / Engine(level)) — the same way the shelf's other
  unit suites load their wasm. The **LLM player** path (WebGPU) can't run under
  vitest, so a real hybrid-vs-engine trial lives in a standalone
  `tools/harness-trial.mjs` (system Chrome), mirroring the `ai:trial` driver — off
  the CI gate.

- **`Player` is a small port, reused from the shipped surfaces.** A `Player` is
  `chooseMove(game) → Promise<number | null>`. Implementations wrap already-shipped
  code: `EnginePlayer(level)` → `Drop4.liveMove(level)`; `HybridAiPlayer(hybrid)` →
  `buildBand(game.tutor().moves)` + `HybridPlayer.pick`; `RandomPlayer(seed)` /
  `GreedyPlayer` are cheap trial baselines (mirror the Rust `Player::Random`/
  `Greedy`). No player re-implements rules — the wasm decides legality.

### Alternatives considered and rejected

- **Extend the Rust harness to call the browser LLM.** Rejected — the Rust rig
  can't reach WebGPU/`WebLLMRuntime`; the whole point is to measure the *browser*
  players as shipped.
- **A Playwright project for the trial.** Rejected (same as `ai:trial`) — it would
  drag the whole e2e suite under system Chrome and onto CI. Standalone driver.
- **Grade every move (not just exact-endgame).** Rejected — early-game "quality"
  is horizon-approximate (capped), so a "blunder rate" over capped verdicts is not
  provably a blunder rate. Grade only `exact` moves; count the rest `skipped_early`
  (exactly what the Rust rig does).
- **Re-derive the metrics.** Rejected — mirror the Rust `Scorecard`/`Report` for
  cross-rig comparability.

## Verified Assumptions

- **Rust harness shape** (read `crates/drop4-harness/src/lib.rs`): `Player` enum
  (`Random`/`Greedy`/`Classic(Level)`, `choose_move` at `:47`); `MatchRecord`
  (`:102`), `run_match` (`:112`); `Scorecard` (`:182`: games, wins, draws, losses,
  scored_moves, optimal, preserving, blunders, skipped_early) + `blunder_rate()`
  (`:205`); `classify` (`:158`, signum compare → Optimal/ResultPreserving/Blunder);
  `score_side` (`:216`, grades only `empties <= SCORE_MAX_EMPTIES`); `SCORE_MAX_EMPTIES
  = 12` (`:30`); `Report` (`:248`) + `render()`; `run_trial` (`:280`).
- **Shipped browser grading surface** (read `src/games/drop4/drop4-wasm.ts`):
  `Drop4.assess(col) → {col, value, bestValue, regret, quality, immediateWin,
  blocksOpponentWin, exact} | null`, `Drop4.tutor() → {moves, bestCol, exact}`,
  `Drop4.liveMove(level)`, `Drop4.oracleBest(level)`, `Drop4.play(col)`,
  `Drop4.board()`, `Drop4.currentHash()`, `Drop4.load()`. `quality` ∈
  `"optimal"|"resultPreserving"|"blunder"`.
- **Shipped TS players** (read `src/harness/{ai-runtime,hybrid-player}.ts`):
  `AIRuntime`/`MockRuntime`/`WebLLMRuntime`; `buildBand(moves)` → `BandMove[]`,
  `HybridPlayer.pick(band, {prompt,system})` → `{move, reason, source}`.
- **Test + tooling conventions** (read repo): vitest units in `tests/*.test.ts`
  (env `jsdom` — `vitest.config.ts:5`); Playwright e2e in `tests/*.spec.ts`;
  standalone drivers in `tools/*.mjs` (`ai-trial.mjs`, `guide-shots.mjs`,
  `serve.mjs`) launch system Chrome via `@playwright/test` `channel:"chrome"`. CI
  gate (`.github/workflows/deploy.yml`): `build:wasm → typecheck → lint → unit →
  build → Pages` — **no e2e, no GPU**.
- **How a unit test loads the real wasm** (read `tests/solitaire-unit.test.ts:22-33`,
  `tests/trio-tumble-unit.test.ts:12-17`) — **Pass 2, the concrete pattern P6 must use**:
  the suite runs `build:wasm` in `preunit` (so `target/wasm32-unknown-unknown/release/
  <game>_wasm.wasm` exists), then a test shims `globalThis.fetch` to return a
  `Response` over the on-disk bytes (`readFile`) and calls `Game.load()` (which
  `fetch`es `/drop4.wasm`), restoring `fetch` after. **`Drop4.load()` therefore
  works under vitest only with this shim** — the match-runner/scorer/tournament
  tests must wrap their `Drop4.load()` in it (path
  `target/wasm32-unknown-unknown/release/drop4_wasm.wasm`).
- **A "cost" metric needs a clock.** The Rust rig doesn't time moves; the browser
  rig can record `performance.now()` per move (engine µs vs LLM ~ms/s). Recorded
  as an optional `Scorecard` field, not a gate.
- **[Phase 0 D2 — confirmed 2026-08-03]** An engine-vs-engine game drives to a
  terminal result **deterministically** over the real `drop4.wasm` under vitest
  (via the fetch-shim + `Drop4.load()`): Perfect-vs-Perfect from `newGame(0n)`
  played 42 moves to a **draw** (full board — the expected class-floor outcome),
  reproducing an identical `currentHash()` across two runs. **Calibration
  finding:** a full Perfect game is ~10 s in vitest (deep search × 42 plies + wasm
  load), so any test that drives full games must raise `testTimeout` (30 s used in
  the probe) and keep N small. Perfect-vs-Perfect is the deterministic driver that
  guarantees reaching the exact-grading endgame (a full board is entirely ≤16
  empties) with `blunders === 0` — so it is the natural Phase 1 wiring driver and
  Phase 3 tournament driver (N=2, raised timeout). `liveMove("Perfect")` returns
  `null` only at a terminal position; `play()` returns `"applied"` for every legal
  move. (Probe was `throwaway` per its disposition; removed.)

## Documentation Impact

- `docs/HARNESS.md` — **new** (Phase 4). The harness guide: what it measures, the
  `Player`/`Scorecard`/`Report` vocabulary, the exact-only grading gate (and the
  16-vs-12 reconciliation), how to run `npm run harness:trial`, how to read a
  Report. Cross-refs `docs/AI-PLAYERS.md`.
- `docs/AI-PLAYERS.md` — add a short "Measuring players (P6)" note + a pointer to
  `HARNESS.md`, and record the first browser-rig numbers once the trial runs
  (Phase 4).
- `docs/BUILDING-GAMES.md` §10 — one line: the scorer/tournament harness has
  landed; link `HARNESS.md` (Phase 4). (§10 currently says "filled in as it lands.")
- `package.json` — `harness:trial` script (Phase 4).
- `TODO/drop4.md` — check off P6 (Phase 4).
- Grepped: no existing `src/harness/{match-runner,scorer,tournament}.ts`,
  `tools/harness-trial.mjs`, or `docs/HARNESS.md` (all greenfield, confirmed).

## Concurrency Map

```
Sequential spine: Phase 0 → 1 (match-runner) → 2 (scorer) → 3 (tournament) → 4 (trial + docs)
```

All phases sequential. Reason: Phase 2's scorer grades the `MatchRecord`s Phase 1
produces; Phase 3's tournament aggregates Phase 2's `Scorecard`s; Phase 4's trial
drives the Phase 1–3 rig end-to-end. Each phase reads what the prior wrote. No
parallelism. Write-sets are disjoint per phase but the data dependency forbids
concurrency; not worth dispatching for a ~5-file feature.

## Phases

> **TDD ordering (all phases):** each phase's named test is written **RED first**
> and watched fail before the GREEN implementation (repo law — `CLAUDE.md`,
> `tdd-guardian`). Phase 0 is the Discovery Exemption.

### Phase 0: Discovery (grading parity)

**Goal:** Lock the one load-bearing decision — the browser grading gate — against
the Rust rig, so the scorer is faithful. Discovery Exemption (no TDD).

- [ ] **D1: Confirm the browser grading gate = `assess(col).exact`, and reconcile
  with Rust's `SCORE_MAX_EMPTIES=12`.**
  - **Probe:** Re-read `drop4-harness::score_side` + `SCORE_MAX_EMPTIES` and the
    wasm `assess` exact rule (`drop4-solver::tutor` `TRACTABLE_EMPTIES=16`). Confirm
    both classify by the same rule (value vs best; Optimal/Preserving/Blunder) and
    that grading on `exact` (≤16) is a strict superset of Rust's ≤12 — still all
    provably exact.
  - **Success criteria:** a written statement of the gate (`grade iff exact`,
    classes map 1:1 to Rust `classify`) + the documented 16-vs-12 note.
  - **Disposition:** `throwaway` (a reasoning artifact; folds into Verified
    Assumptions + `HARNESS.md`).
- [ ] **D2: Confirm a `Player` can drive moves over a `Drop4` wasm instance under
  vitest.**
  - **Probe:** In a scratch vitest, `await Drop4.load()`, alternate
    `liveMove(level)` for both sides to a terminal `board().result`, assert the
    move count is sane and the terminal hash is stable across two runs (determinism).
  - **Success criteria:** an engine-vs-engine game plays to a result deterministically
    over the real wasm in vitest.
  - **Disposition:** `throwaway` (the pattern promotes into Phase 1's wiring test).

**Done when:** D1 fixes the grading gate; D2 confirms the runner substrate. Update
Verified Assumptions.
**Validation:** Discovery — evidence recorded, no tests.

### Phase 1: `Player` port + match-runner

**Goal:** Play a full game between two `Player`s over a `drop4-wasm` instance and
return a `MatchRecord` (seed, per-side move list, result, terminal hash).
**Changes:**
- [ ] `src/harness/match-runner.ts` — `Player` interface (`chooseMove(view) →
  Promise<number|null>`, `label`), the `EnginePlayer(level)` / `RandomPlayer(seed)`
  / `GreedyPlayer` baselines (wrap `Drop4.liveMove` / legal-move picks — no rule
  re-impl), and `runMatch(game, a, b, seed) → MatchRecord` (alternate until
  `board().result !== -1`, record each side's moves + timings).
- [ ] `tests/match-runner.test.ts` — RED first: an **engine-vs-engine** game over
  the real wasm plays to a terminal result; the record's `(seed, moves)` replays
  through a fresh `Drop4` to the **same terminal hash** (the wiring proof), and
  every recorded move was legal.
**Call chain:** `runMatch` → `Player.chooseMove` → `Drop4.liveMove`/legal pick →
`Drop4.play` → `Drop4.board()`.
**Wiring test:** `tests/match-runner.test.ts` — drives a full game through the real
wasm (not a mock) and asserts terminal-hash replay. This proves the runner is live
against the shipped core. **Loads the wasm via the `globalThis.fetch` shim +
`Drop4.load()` (the `solitaire-unit.test.ts:24-33` pattern, path
`target/wasm32-unknown-unknown/release/drop4_wasm.wasm`)** — the runner takes an
already-loaded `Drop4`, so the shim lives in the test, not the runner.
**Depends on:** Phase 0.
**Read-set:** `src/games/drop4/drop4-wasm.ts`. **Write-set:**
`src/harness/match-runner.ts`, `tests/match-runner.test.ts`.
**Shared-state contract:** loads the real `drop4.wasm` in vitest (built by
`preunit`); no ports, no ambient state beyond the wasm module instance.
**Risks:** a `Player` that returns an illegal/`null` move must be handled (skip /
end) — the wasm `play` rejects illegal, so `runMatch` must detect a no-op and not
loop forever; the test includes a player that returns an illegal column once.
**Done when:** (1) Behavioral: two players play a full Drop 4 game over the wasm and
the result replays to a verifiable hash. (2) Verification: `npx vitest run
tests/match-runner.test.ts` (loads the real wasm, exercises the full game).
**Validation:** Moderate — wiring test over the real wasm + unit coverage of the
illegal-move guard.

### Phase 2: pure scorer

**Goal:** Grade a `MatchRecord` and fold per-move verdicts into a `Scorecard`
mirroring the Rust one.
**Changes:**
- [ ] `src/harness/scorer.ts` — `Scorecard` (games, wins, draws, losses,
  scored_moves, optimal, preserving, blunders, skipped_early) + `blunderRate()`;
  a **pure** `foldVerdict(card, {quality, exact}) → Scorecard`; and
  `gradeSide(record, verifier: Drop4, side) → Scorecard` that replays the record
  through a fresh `Drop4`, calls `assess(col)` at each of `side`'s moves, and folds
  — grading iff `exact`, else `skipped_early` (the D1 gate).
- [ ] `tests/scorer.test.ts` — RED first, **mutation-resistant** on the grading
  boundaries (not one happy point): `foldVerdict` counts optimal/preserving/blunder
  to the right buckets and `skipped_early` when `exact=false`; `blunderRate` = 0
  when `scored_moves=0` and `blunders/scored_moves` otherwise (assert 0/12→0.0 and
  a known ratio); and a `gradeSide` over a **scripted short endgame** (built via
  `Drop4.play`) where a deliberately thrown win is counted a `blunder` and the
  optimal reply an `optimal` — proving the wasm-grading path, not just the fold.
**Call chain:** (Phase 3) `runTournament` → `gradeSide` → `Drop4.assess` (replayed).
**Wiring test:** the `gradeSide` case in `tests/scorer.test.ts` drives real wasm
grading over a played-out record; the fold is unit-pinned. (Full rig wiring is
Phase 3.)
**Depends on:** Phase 1.
**Read-set:** `src/harness/match-runner.ts`, `src/games/drop4/drop4-wasm.ts`.
**Write-set:** `src/harness/scorer.ts`, `tests/scorer.test.ts`.
**Shared-state contract:** loads `drop4.wasm` in vitest; no other ambient state.
**Risks:** the exact-only gate means a short opening game may grade **zero** moves
(`skipped_early` all) — the test must reach an endgame (play deep) so at least one
move is graded, else it proves nothing.
**Done when:** (1) Behavioral: a played record yields a `Scorecard` whose graded
moves are classified exactly as the oracle sees them, capped/early moves skipped.
(2) Verification: `npx vitest run tests/scorer.test.ts`.
**Validation:** Moderate — pure-fold units + a real-wasm `gradeSide` endgame case.

### Phase 3: tournament + aggregate report

**Goal:** Run N games of A-vs-B (alternating who opens), aggregate a `Report`.
**Changes:**
- [ ] `src/harness/tournament.ts` — `runTournament(gameFactory, a, b, {games,
  baseSeed}) → Report` (matchup label, side-A `Scorecard`, `render()` one-block
  text), alternating the opening side per game (seeded, deterministic).
- [ ] **[Pass 3 — observability/honesty gate]** `render()` must surface
  `scored_moves` and `skipped_early` **adjacent to** `blunders`/`blunderRate` in
  the one-block text (e.g. `blunders 0 / scored 3 (skipped-early 41)`). The
  exact-only gate means a short or opening-heavy game can grade **zero** moves, so
  a bare "blunders: 0" headline is meaningless without its denominator — the
  render must make "0 blunders over 0 graded" impossible to misread as "clean."
  Pin this in `tests/tournament.test.ts`: assert the rendered block contains the
  `scored_moves` count, not just the blunder count.
- [ ] `tests/tournament.test.ts` — RED first: an **engine-vs-engine** tournament of
  a few games (real wasm) returns a `Report` where `wins+draws+losses === games`,
  every move across every game was legal, and — since Perfect-vs-Perfect never
  throws — `blunders === 0` over graded moves (the class-floor invariant, a
  security-load-bearing assertion for the rig's own correctness).
**Call chain:** `runTournament` → `runMatch` (Phase 1) → `gradeSide` (Phase 2).
**Wiring test:** `tests/tournament.test.ts` — the full rig end-to-end on CI with
deterministic engine players over the real wasm.
**Depends on:** Phases 1, 2.
**Read-set:** `src/harness/{match-runner,scorer}.ts`, `drop4-wasm.ts`.
**Write-set:** `src/harness/tournament.ts`, `tests/tournament.test.ts`.
**Shared-state contract:** `drop4.wasm` in vitest; deterministic seeds; no ports.
**Risks:** N games × deep grading can be slow in vitest — keep N small (e.g. 4) and
levels that terminate quickly; the trial (Phase 4) is where large N runs.
**Done when:** (1) Behavioral: a full A-vs-B tournament produces an aggregate Report
with consistent W/D/L and a blunder rate. (2) Verification: `npx vitest run
tests/tournament.test.ts`.
**Validation:** Broad — the full rig on CI (deterministic players); the LLM player
is Phase 4.

### Phase 4: standalone trial driver + docs

**Goal:** Measure the **real** browser players (incl. the WebGPU `HybridPlayer`)
and write the harness guide.
**Changes:**
- [ ] `tools/harness-trial.mjs` — a standalone system-Chrome driver (mirrors
  `ai-trial.mjs`: serve, `channel:"chrome"`, persistent `.webllm-cache`, real
  origin, embedded `/vendor/webllm.js`). Runs `runTournament` with
  `HybridAiPlayer` (a `Player` wrapping `buildBand`+`HybridPlayer`+`WebLLMRuntime`)
  vs `EnginePlayer`, prints the `Report`. Not a Playwright project; not on CI.
  **[Pass 3 — observability gate]** emit a **staged diagnostic** to stdout as the
  run proceeds (model-load done → first move produced → per-game W/D/L tally →
  per-move ms), mirroring `ai-trial.mjs`'s staged logging. An LLM move is ~seconds
  and the model download is large; without staged progress a slow or hung run is
  indistinguishable from a crash. The stages are also the debugging surface when a
  trial produces an implausible Report (e.g. a stage that never prints localizes
  the stall to model-load vs first-move vs a specific game).
- [ ] `src/harness/match-runner.ts` — add `HybridAiPlayer` (band from
  `game.tutor().moves` → `HybridPlayer.pick`; falls back to engine on lock/failure).
  *(Small addition to Phase 1's file — kept here because it needs the runtime the
  trial wires.)*
- [ ] `docs/HARNESS.md` + `package.json` (`harness:trial`) + `docs/AI-PLAYERS.md`
  note + `docs/BUILDING-GAMES.md` §10 line + `TODO/drop4.md` (P6 ✓). *(Committed as
  green sub-steps: tool+player; docs.)*
**Call chain:** `harness:trial` → `runTournament(HybridAiPlayer, EnginePlayer)` →
the Phase 1–3 rig over system Chrome + embedded WebLLM.
**Wiring test:** `MockRuntime`-backed `HybridAiPlayer` in `tests/tournament.test.ts`
(CI: proves the hybrid player plugs into the rig and stays in-band → `blunders===0`
over graded moves). The real WebGPU run is `npm run harness:trial` (recorded
transcript, not CI).
**Depends on:** Phases 1–3, and the shipped `WebLLMRuntime`/`HybridPlayer`.
**Read-set:** `src/harness/{tournament,scorer,ai-runtime,hybrid-player}.ts`.
**Write-set:** `tools/harness-trial.mjs`, `src/harness/match-runner.ts`,
`docs/HARNESS.md`, `package.json`, `docs/AI-PLAYERS.md`, `docs/BUILDING-GAMES.md`,
`TODO/drop4.md`. *(>3 files → committed in green sub-steps: player+tool; then docs.)*
**Shared-state contract:** the trial launches system Chrome + binds serve port 4180
+ model-CDN egress + browser model cache — only on the explicit `harness:trial` run;
CI touches none of it.
**Risks:** a long tournament re-downloads nothing (persistent cache) but each LLM
move is ~s — keep the trial's N modest; the point is a real in-band/blunder-rate
number, not a benchmark.
**Done when:** (1) Behavioral: `npm run harness:trial` prints a Report for
Hybrid-vs-Engine on real WebGPU (legal 100%, blunders over graded moves ≈ 0,
LLM ms/move recorded); the CI `MockRuntime` hybrid case proves the plug-in.
(2) Verification: `npx vitest run tests/tournament.test.ts` (gate) + a recorded
`harness:trial` transcript (localhost).
**Validation:** Broad — mock on the gate; the real hybrid measured by the trial +
the recorded Report folded into `docs/AI-PLAYERS.md`.

## Open Questions

- [RECOMMENDED: ADVISORY] Record a per-move **cost** (ms) in the `Scorecard`
  (engine µs vs LLM ms/s)? *Recommend yes — it's the cheapest way to show "the LLM
  is slower, not stronger," which is the harness's headline finding; a nullable
  field, not a gate.*
- [RECOMMENDED: ADVISORY] Grading gate = the wasm `exact` flag (≤16 empties) vs
  matching Rust's ≤12 exactly. *Recommend the `exact` flag — it reuses shipped,
  honest machinery and is a strict superset (still provably exact); document the
  16-vs-12 difference in `HARNESS.md`.*
- [RECOMMENDED: PHASE-GATED (Phase 4)] Is P6 Drop-4-specific or generic now?
  *Recommend Drop-4-specific for v1 (it grades via `drop4-wasm`'s oracle); generalize
  to an injected game/oracle adapter only when P7 (Othello) needs the same rig —
  rule of three. Flag at Phase 4 so the file shape doesn't over-abstract early.*

## Review Log

### Pass 1 — 2026-08-03
Authored from firsthand reads of `drop4-harness/src/lib.rs` (the Rust rig to
mirror — `Player`/`run_match`/`Scorecard`/`score_side`/`SCORE_MAX_EMPTIES=12`/
`Report`/`run_trial`), the shipped `src/harness/{ai-runtime,hybrid-player}.ts` and
`src/games/drop4/drop4-wasm.ts` (`assess`/`tutor`/`liveMove` — the grading +
player surfaces), and the repo's vitest/e2e/tools conventions + CI gate. Hexagonal
split: pure scorer + wasm-driving runner on CI (deterministic players), the WebGPU
hybrid trial behind a standalone system-Chrome driver off CI. Grades only
provably-exact endgame moves via the shipped `exact` flag (mirrors the Rust
≤12-empties gate). Phases: 0 grading-parity discovery → 1 match-runner → 2 pure
scorer → 3 tournament → 4 trial + docs. 3 open questions, all ADVISORY/PHASE-GATED
(no BLOCKING).

### Pass 2: Gap Analysis — 2026-08-03
**Found:**
- **Wasm-in-vitest load pattern was assumed, not specified (the biggest factual
  risk).** `Drop4.load()` uses `fetch("/drop4.wasm")`, which does not resolve in
  the vitest `jsdom` env by itself. Read `tests/solitaire-unit.test.ts:22-33` +
  `trio-tumble-unit.test.ts`: the real pattern is a `globalThis.fetch` shim serving the
  on-disk `target/.../<game>_wasm.wasm` via `readFile`, with `preunit` building the
  wasm first. Added this to Verified Assumptions and to Phase 1's wiring test so the
  executor uses the shim (path `…/drop4_wasm.wasm`) rather than discovering the fetch
  gap mid-phase. Phases 2/3 inherit it (they take an already-loaded `Drop4`).
**Concurrency:** map confirmed — all sequential (each phase consumes the prior's
data). Phase 4 adds `HybridAiPlayer` to Phase 1's `match-runner.ts` (a second write
to that file), but sequentially, so no conflict; noted in Phase 4's write-set.
**Changed:** added the fetch-shim load pattern to Verified Assumptions + Phase 1
wiring test. No phase reordering.
**Confirmed:** the Rust-harness shapes to mirror (`Player`/`Scorecard`/`score_side`/
`SCORE_MAX_EMPTIES=12`/`Report`/`run_trial`) and the shipped grading surface
(`assess`/`tutor` `{quality, exact}`) both check out against the source; the
exact-only grading gate via the shipped `exact` flag is faithful to the Rust ≤12
rule (strict superset, documented). No BLOCKING items surfaced.

### Pass 3: Quality Gates — 2026-08-03
Applied the quality gates as additive extensions (no restructuring). The plan
enters Pass 3 strong: TDD ordering is stated per phase (RED-first header) and
Phase 0 is a clean Discovery Exemption; validation is genuinely calibrated
(Phase 1/2 Moderate, Phase 3/4 Broad — not a reflexive "tests suffice"); the
Concurrency Map is honest (all-sequential with the data-dependency reason, and
Phase 4's second write to `match-runner.ts` is called out as sequential); the
wiring tests reach the real substrate every phase (real-wasm replay in Phase 1,
real-wasm `gradeSide` in Phase 2, full-rig end-to-end in Phase 3, `MockRuntime`
hybrid-in-rig on CI + a real WebGPU trial in Phase 4). Documentation Impact is
complete and greenfield-verified (HARNESS.md new; AI-PLAYERS/BUILDING-GAMES §10/
package.json/TODO scheduled in Phase 4, the phase that makes them stale).

**Two gates added (both observability/honesty, the class of gap Pass 3 exists
to catch — the metrics rig's own output must not lie):**
- **Report `render()` must print the denominator.** Added to Phase 3: the
  one-block render surfaces `scored_moves`/`skipped_early` adjacent to
  `blunders`, and `tests/tournament.test.ts` asserts it. The exact-only grading
  gate can legitimately grade **zero** moves in a short game, so a bare
  "blunders: 0" is the plan's own documented honesty trap — the render now makes
  "0 over 0 graded" impossible to misread as "clean." This is the harness
  grading *itself* honestly.
- **`harness-trial.mjs` staged diagnostic.** Added to Phase 4: staged stdout
  (model-load → first-move → per-game tally → per-move ms), mirroring
  `ai-trial.mjs`. A multi-second-per-move LLM run over a large model download is
  otherwise indistinguishable from a hang, and the stages localize a stall or an
  implausible Report to a specific phase of the run.

**Entry-point note (not a defect):** the harness is a library + a trial script,
not a drawer-registered game, so its "entry point" is the vitest suites + `npm
run harness:trial`, not a `/<id>/` URL. The wiring tests correctly target that
surface; §8's URL-reachability gate does not apply to a measurement tool.
**Validation calibration:** confirmed appropriate as written; no changes.
**Open questions:** unchanged — 3, all ADVISORY/PHASE-GATED, no BLOCKING. Ready
for execution (Phase 0 first).
