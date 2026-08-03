# Drop 4 — playable game + hybrid AI build-out (localhost-first, frequent commits)

> Execution plan for the remaining Drop 4 work: a playable shelf game, the
> browser hybrid AI (select + narrate), tutoring, the scoring harness, and a
> second game for generality. Architecture + all Phase-0 findings live in
> `plans/2026-07-31-drop4-ai-harness.md` and `docs/AI-PLAYERS.md`; this plan is
> the **build sequence**. Optimised for **localhost design review between us**
> and **frequent commits**.

## Problem Statement

We have the deterministic spine (core, exact solver/oracle, harness scorer,
hybrid band + tutoring facts) and a wasm bridge, all committed. Nothing is yet
**playable in a browser**, and the LLM select/narrate layer isn't built. We want
to build it all out in small, browser-reviewable steps so design can be reviewed
and discussed on `localhost` as it lands, committing at every green point.

## Reasoning

- **Localhost-first ordering.** The fastest path to "click and see" is a playable
  board vs the classic engine — so that comes *before* the LLM layer. Each phase
  after ends with something new to look at on `localhost`.
- **Responsive engine is the true prerequisite.** The exact solver is minutes
  from the opening (Phase-0 finding), so live play needs a **depth-limited
  heuristic** opponent for move selection; the exact solver stays the **oracle**
  (scoring, tutoring, band ground-truth) used where tractable. This is P0.
- **The LLM is UX, not strength** (measured). So the shipped opponent is the
  engine; the LLM layer adds personality + explanation + tutoring on top, behind
  an "Experimental" label. Build the good product first, layer the experiment.
- **Commit cadence.** Every phase lists its commit points; commit at each green
  sub-step (repo standard), never batch. Each commit is a working checkpoint.
- **Design-review checkpoints.** Every phase from P1 on ends with a **Localhost
  review** block: the exact command + URL + what to look at + an explicit *pause
  for review/discussion* before the next phase.

## Verified Assumptions

- Built + committed: `adversary-core`, `drop4-core`, `drop4-solver` (exact
  oracle + `move_values`), `drop4-harness` (scorer + `hybrid::band`/`assess`),
  `drop4-wasm` (+ typed `src/games/drop4/drop4-wasm.ts`), `docs/AI-PLAYERS.md`.
- WebLLM + system Chrome + WebGPU work headless; structured output (grammar +
  JSON schema) confirmed on 0.5B. Bundled Chromium has no WebGPU — trials use
  **system Chrome**.
- The shelf's game contract: `GameModule { mount/unmount }` + `registry.ts`
  entry + `/<id>/` page in `build.mjs` `GAME_PAGES`; tap-first, core-decides-
  legality; verifiable outcome + `?r=`; how-to guide + `guide:shots`; tokens/
  WCAG-AA; gate = `npm run test` + `npm run e2e`. Reference: solitaire, and
  `docs/BUILDING-GAMES.md`.
- `npm run serve` builds + serves `dist/` on localhost (`tools/serve.mjs`);
  `npm run build:wasm` builds the wasm first.

## Documentation Impact

- `docs/AI-PLAYERS.md` — update as the LLM/tutor layer lands (P4/P5). 
- `docs/BUILDING-GAMES.md` — add §10 "adversarial two-player games" once the
  first one is playable (P1) + the shelf conventions it introduces.
- `README.md` — add Drop 4 to the shelf list + order (P1); note the AI opponent.
- `CLAUDE.md` (repo) — one line pointing at AI-PLAYERS.md (P1).
- `src/registry.ts`, `src/how-to-registry.ts`, `build.mjs` (`GAME_PAGES`),
  `tokens.css` — per-game wiring (P1); append-only.
- `TODO/drop4.md` — keep the checklist current each phase.

## Concurrency Map

All phases sequential — each builds on and is reviewed after the prior (the
whole point is localhost review between steps). P6 (scoring harness) and P7
(second game) are the only pair that *could* parallelize (disjoint files), but
they are kept sequential so review stays focused. No parallel sets.

## Phases

### P0: Responsive engine (live-play opponent)
**Goal:** the engine returns a move in <~100 ms from any position, so live play
is possible; the exact solver stays the oracle.
**Changes:**
- [ ] `drop4-solver` — a depth-limited negamax with a simple heuristic eval
  (open 2s/3s, centre weighting) for horizon nodes: `best_move_capped(board,
  max_depth)`; and `Level` maps to depth (Easy shallow → Hard deep) alongside
  the existing band/randomness. Exact `solve`/`move_values` unchanged (still the
  oracle).
- [ ] (optional) a tiny opening book (first ~4 plies) if the depth cap alone
  isn't snappy enough — measure first.
**Wiring test:** `best_move_capped` returns a legal move on the empty board in
<100 ms and never loses to a random player over N games; a bench asserts latency.
**Read/Write-set:** reads `drop4-core`; writes `crates/drop4-solver/src/*`.
**Done when:** `cargo test -p drop4-solver` green incl. a latency assertion; the
capped engine plays a full game from empty in well under a second total.
**Validation:** Moderate (unit + latency bench). **Commit:** 1 (capped engine).

### P1: Playable Drop 4 at `/drop4/` (classic opponent)
**Goal:** a real, tap-to-play Drop 4 game vs the (capped) engine, reachable on
localhost. Tier-1 shelf standards.
**Changes:**
- [ ] `src/games/drop4/drop4.ts` — `GameModule`: render the board (row 0 bottom),
  tap a column → core-driven legal glow → `Drop4.play`; the engine replies via
  `oracleBest`/capped; win/draw end screen (verification-forward) + `?r=` share.
- [ ] `src/games/drop4/drop4-howto.ts` + `how-to-registry.ts` entry.
- [ ] `src/registry.ts` entry (`status: "playable"`); `build.mjs` `GAME_PAGES`
  += "drop4" + the `drop4.wasm` copy (already added); `tokens.css` any new tokens.
- [ ] `docs/BUILDING-GAMES.md` §10 stub; `README.md` shelf entry; `CLAUDE.md` line.
**Call chain:** drawer registry → `drop4Module.mount` → `Drop4` wasm + capped
engine → end screen → `pond-outcome` `?r=`.
**Wiring test:** `tests/drop4.spec.ts` (Playwright) — navigate `/drop4/`, play a
full game to a result, assert the end screen + a re-verifying `?r=`; axe clean
both themes; centred board; no overflow at 360 px.
**Localhost review:** `npm run serve` → **http://localhost:8080/drop4/** → play a
full game vs the engine on desktop + phone width. **Pause for design review**
(board feel, colours, end screen, share) before P2.
**Write-set:** `src/games/drop4/**`, `src/registry.ts`, `src/how-to-registry.ts`,
`build.mjs`, `tokens.css`, `README.md`, `CLAUDE.md`, `docs/BUILDING-GAMES.md`,
`tests/drop4.spec.ts`, `assets/guide/drop4*`.
**Done when:** playable from the drawer + `/drop4/`; `npm run test` + `npm run
e2e` + `cargo test` green. **Validation:** Broad (full gate + manual play).
**Commits:** module+wiring; how-to+shots; docs. (3+)

### P2: Opponent picker (difficulty)
**Goal:** the player picks the opponent's strength; difficulty maps to the
engine's two knobs (class floor × band Δ / depth).
**Changes:**
- [ ] Picker UI (Easy / Medium / Hard / Perfect) in `drop4.ts`; map each to a
  `Level` (depth + band Δ + `ClassFloor`): Easy = wide Δ + `Any`; Hard = narrow
  Δ + `PreserveBestClass`; Perfect = Δ 0.
- [ ] Persist the choice via `src/settings.ts`.
**Wiring test:** e2e — selecting Easy vs Perfect changes observed play (Perfect
never loses from a winning start; Easy is beatable) over scripted games.
**Localhost review:** switch levels mid-session, feel the difference. **Pause.**
**Write-set:** `src/games/drop4/drop4.ts`, `src/settings.ts`, `tests/drop4.spec.ts`.
**Done when:** picker works end-to-end; gate green. **Commit:** 1.

### P3: `AIRuntime` port + WebLLM adapter
**Goal:** a browser LLM runtime behind one interface, with structured output;
a dev page to sanity-check it (no game yet).
**Changes:**
- [ ] `src/harness/ai-runtime.ts` — `AIRuntime` (`generate(prompt, {schema? |
  grammar?}) -> string`, `fingerprint()`), `MockRuntime` (deterministic, for
  tests), `WebLLMRuntime` (pinned model; `response_format` schema/grammar).
- [ ] `src/harness/dev-ai.ts` + a `/ai-dev/` page (or a `tools/ai-dev.mjs`
  Playwright driver) to load a model and run a structured prompt.
**Wiring test:** vitest with `MockRuntime` (deterministic); plus a manual
localhost load of `WebLLMRuntime` returning a schema-valid object.
**Localhost review:** open the dev page → model loads → returns a typed object.
**Pause** (model choice, latency, download UX). 
**Write-set:** `src/harness/*.ts`, a dev page, `tests/ai-runtime.test.ts`.
**Done when:** MockRuntime tests green; WebLLMRuntime returns schema-valid output
on localhost. **Validation:** Broad (mock on gate + real on localhost). **Commit:** 1.

### P4: `HybridPlayer` (band → LLM select + reason) as an opponent
**Goal:** the shippable experimental opponent — engine band + LLM pick + spoken
reason — selectable behind an "Experimental: local AI" toggle.
**Changes:**
- [ ] `src/harness/hybrid-player.ts` — build the band from `Drop4.oracleMoveValues`
  (+ the `hybrid` knobs), prompt the `AIRuntime` for `{pick∈band, reason}` under a
  schema, return the move + reason (fallback to engine top on failure).
- [ ] Wire "Experimental: local AI" into the P2 picker; show the LLM's reason /
  banter beside the move; a first-use size-disclosure (model download).
**Wiring test:** e2e (system Chrome) — pick the LLM opponent, it plays legal
in-band moves to a result and surfaces a reason; MockRuntime unit test for the
band→prompt→pick→move path.
**Localhost review:** **play a full game vs the local-AI opponent, read its
explanations.** The big design-review checkpoint (personality, latency, feel).
**Pause.**
**Write-set:** `src/harness/hybrid-player.ts`, `src/games/drop4/drop4.ts`,
`docs/AI-PLAYERS.md`, tests.
**Done when:** playable vs the hybrid on localhost; gate green (hybrid path
mocked on CI, real on localhost). **Commits:** hybrid-player; UI wire. (2)

### P5: Tutor mode
**Goal:** engine-grounded coaching — explain options, flag the human's blunders,
hint — narrated by the LLM over `hybrid::assess`.
**Changes:**
- [ ] A tutor panel: "explain my options" (assess the band), "was that a blunder"
  (assess the last human move), a hint (a class-preserving band move + why).
  The LLM verbalises `assess`/`band` facts (correct by construction).
**Wiring test:** e2e — after a human blunder, the tutor reports the class drop
(ground truth from the oracle) with an explanation.
**Localhost review:** play with the tutor on; make a deliberate blunder, read the
coaching. **Pause.**
**Write-set:** `src/games/drop4/drop4.ts` (+ a tutor module), `docs/AI-PLAYERS.md`.
**Done when:** tutor works on localhost; gate green. **Commit:** 1.

### P6: Browser scoring harness / trial driver
**Goal:** formalise the Phase-0 scratchpad experiments into a committed trial
driver + scorecard (legality, W/D/L, optimal/blunder vs oracle, cost).
**Changes:**
- [ ] `src/harness/{match-runner,scorer,tournament}.ts` (TS mirror of the Rust
  scorer) + `tools/harness-trial.mjs` (Playwright, system Chrome) + `npm run
  harness:trial`; `docs/HARNESS.md` (or fold into AI-PLAYERS.md).
**Wiring test:** `LLMPlayer(MockRuntime)` scored deterministically on the gate; a
recorded real `harness:trial` report artifact (not on CI).
**Localhost review:** run `npm run harness:trial`, read the scorecard. **Pause.**
**Write-set:** `src/harness/*.ts`, `tools/harness-trial.mjs`, `package.json`, docs.
**Done when:** mock-scored on the gate + a real trial report. **Commit:** 1-2.

### P7: Second game for generality (Othello)
**Goal:** prove the harness generalises — a new `Adversary` + `Oracle` reuse the
band/assess/hybrid/scorer/UI shell with no changes to them. Othello (simple
rules, heuristic oracle) is the cheapest second game.
**Changes:** `crates/othello-core` (+ `-solver` heuristic oracle, `-wasm`),
`src/games/othello/` (module + wrapper + how-to), registry/build wiring. Reuses
`src/harness/*`, `hybrid`, the UI shell, the picker, tutor.
**Wiring test:** `/othello/` playable vs engine + the hybrid opponent; the
harness scores it via the same code.
**Localhost review:** play Othello vs engine and vs local-AI. **Pause.**
**Done when:** Othello playable + scored through the shared harness; gate green.
Each sub-crate is its own commit; **this phase gets its own phase-plan** (it is a
full game build) — this entry is the pointer.

### P8: Multi-game + context-tuning comparison (the research)
**Goal:** run the hybrid + context-variant sweep across Drop 4 + Othello (+ later
chess/checkers), scored by each game's oracle; measure where LLM within-band
selection or context sensitivity differs. Prior: ≈ random-in-band until frontier
scale — this tests it. Consider adding one **imperfect-information** game as the
real contrast (where an LLM can add strategic value).
**Done when:** a comparison report across games/contexts. Its own phase-plan.

## Open Questions

- [RECOMMENDED: PHASE-GATED (P0)] Depth cap vs opening book for live speed?
  *Recommendation: depth-capped heuristic first (least code, works everywhere);
  add a small book only if the opening still feels sluggish.*
- [RECOMMENDED: PHASE-GATED (P4)] Ship the local-AI opponent to everyone, or keep
  it behind a dev/experimental flag? *Recommendation: experimental toggle with a
  download-size disclosure; the classic engine is the default.*
- [RECOMMENDED: PHASE-GATED (P7)] Othello vs checkers as the second game?
  *Recommendation: Othello — simpler rules, and a different board shape stresses
  the abstraction more than another drop/stack game.*
- [RECOMMENDED: ADVISORY] localhost port — `tools/serve.mjs` default (confirm at P1).

## Review Log
### Execution — P1 + localhost-review refinements (2026-08-03)
P0 (responsive `live` engine) and P1 (playable `/drop4/`) built TDD-first and
committed: `live_move` wasm export + `liveMove` wrapper; honest assistance
(`mark_assistance` + `outcome_json(declare)`); the `drop4.ts` GameModule; full
wiring + `tests/drop4.spec.ts`; how-to + guide shots; docs.

The localhost design review then drove a refinement round (still P1-scope, plus
the P2 difficulty picker folded in at the owner's request):
- **Interaction/identity:** the *whole column* is the drop target (so "tap a
  column" is literal) with a distinct glowing drop-arrow header; a **turn bar**
  gives the opponent an identity — **"The Engine 🤖"** — and shows whose turn /
  "thinking…"; the engine's last move is **ringed** so it is visible.
- **Choices (persisted):** a **difficulty picker** (Easy/Medium/Hard/Perfect →
  `Level`) — this is **P2's picker, landed early** — and a **mark chooser** (play
  as ✕ or ○, colour follows the mark). Both persist via `src/settings.ts`
  (`resolveLevel`/`resolveMark` + `drop4Level`/`drop4Mark`).
- **Endgame:** on a win the four is highlighted with a brief fanfare, held a
  beat, then the result screen — which now shows the **final board with the
  winning line** (also makes the four self-evident, resolving a "looks like <4"
  confusion; win detection was already exact/golden-vectored).

Remaining P2 work (not the picker): map difficulty to the **class-floor × band-Δ**
two-knob model (`PreserveBestClass` never-throws level) rather than the `live`
engine's depth+ε knobs. P3+ (AIRuntime/hybrid/tutor) unchanged.

### Pass 1 — 2026-08-03
Build-out sequence for the remaining Drop 4 work, ordered localhost-first with a
review checkpoint + commit cadence per phase. P0 responsive engine (prereq) →
P1 playable → P2 picker → P3 AIRuntime → P4 hybrid opponent → P5 tutor → P6
scoring harness → P7 second game (own plan) → P8 multi-game research (own plan).
Grounded in the committed spine + `docs/AI-PLAYERS.md`.
