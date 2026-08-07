# Drop 4 — backlog

Authoritative plan: `plans/2026-07-31-drop4-ai-harness.md`. Standards:
`docs/BUILDING-GAMES.md`. This file is the running checkbox worklist.

## Done
- [x] Phase 1 — `adversary-core` (shared two-player trait) + `drop4-core`
  (rules, win/draw detection, state hash, `Adversary` + `pond_outcome::Game`,
  golden replay + tamper test). 13 tests green, clippy clean.
- [x] Phase 2 — `drop4-solver`: bitboard negamax perfect solver + exact oracle
  (`solve`/`evaluate`/`best_move`), reusable `Solver` w/ array TT, difficulty
  `Level`s. Fast gate cross-checked vs an independent Python solve; full-from-
  empty proofs `#[ignore]`d. clippy clean.
- [x] Phase 4 (Rust-first) — `drop4-harness`: pluggable `Player`
  (Random/Greedy/Classic), `run_match` → verifiable `MatchRecord`, exact-oracle
  `classify` (optimal/preserving/blunder), `run_trial` → `Scorecard`. **First
  trial runs** (`cargo run -p drop4-harness --example trial`): Greedy 98% vs
  Random; Random-v-Random exercises the oracle scorer (33% endgame blunder rate).

## Done (cont.)
- [x] Phase 3 — `drop4-wasm` C-ABI binding (rules: legal/play/board/hash/result/
  render; oracle: `oracle_best(level)` + `oracle_move_values_json` for the band;
  `outcome_json`) + typed `src/games/drop4/drop4-wasm.ts` wrapper. Compiles to a
  ~113 KB wasm, cabi test + solver `move_values` test green, clippy/tsc/eslint
  clean, wired into build-wasm.sh + build.mjs. **Speed caveat:** exact oracle is
  endgame-fast but slow from the opening — live play needs an opening book or
  depth cap (follow-up); until then, call the oracle from book/endgame positions.

## Done (cont.)
- [x] `docs/AI-PLAYERS.md` — the standing guide: engine = strength/difficulty,
  LLM = legality/personality/explanation/tutoring; ports; players; prompt
  architecture; structured output; difficulty (two knobs); the game-theory
  rationale (LLM can't out-play a solved game; where LLMs do add value); all
  measured findings.
- [x] Hybrid engine-side (`drop4-harness::hybrid`) — `band(floor, Δ)` (difficulty
  as class floor × within-class regret; `PreserveBestClass` never throws the
  game), `assess(move)` + `is_immediate_win`/`blocks_opponent_win` (engine-
  grounded tutoring facts the LLM narrates). Verified against the exact oracle.

## Done (cont.) — build-out plan `plans/2026-08-03-drop4-playable-and-hybrid-buildout.md`
- [x] P0 — responsive live engine (`drop4-solver::live` — `best_move_capped`/
  `choose_capped`; depth-capped negamax + heuristic, fast from any position).
- [x] P1 — **playable `/drop4/` vs the (capped) engine.** `live_move` wasm export
  + `liveMove` wrapper; honest assistance in the outcome record (`mark_assistance`
  + `outcome_json(declare)`); `src/games/drop4/drop4.ts` GameModule (tap a column,
  core-driven legal glow, engine replies at Medium, verification-forward end
  screen + `?r=` share, standard settings); registry/how-to/build/tokens wiring;
  `tests/drop4.spec.ts` (16 e2e incl. axe + 360px + centred). Difficulty fixed at
  Medium (the picker is P2). Localhost-review checkpoint.

## Done (cont.) — P1 localhost-review refinements (2026-08-03)
- [x] Whole-column drop target + distinct glowing drop-arrow header; banner copy
  matches ("tap a column").
- [x] Opponent identity — **"The Engine 🤖"** turn bar (whose turn / thinking);
  the engine's last move is ringed (`.just-played`) so it is visible.
- [x] **Difficulty picker** Easy/Medium/Hard/Perfect (P2's picker, landed early)
  + **mark chooser** (play as ✕/○, colour follows). Both persisted via
  `settings.ts` (`resolveLevel`/`resolveMark`, `drop4Level`/`drop4Mark`).
- [x] Winning-four highlight + brief fanfare before the result; the result screen
  shows the **final board with the winning line**.

- [x] P2 difficulty model — **class floor × within-class sloppiness**
  (`live::{live_band, select_in_band}`, `wasm::live_move`): Easy/Medium = `Any`
  (beatable); Hard/Perfect = `PreserveBestClass` (never throws), Perfect = 0
  sloppiness. Values exact when tractable (≤16 empties, provably never-throws)
  else depth-capped (never throws a horizon-visible loss). Retired the old
  ε-random-over-all-legal. Follow-up: opening book for provably-perfect-from-open.

## Done (cont.) — deterministic tutor (2026-08-03, `plans/2026-08-03-drop4-ai-tutor-layer.md`)
- [x] **Tutor P5 (deterministic, no LLM/GPU) — shipped, CI-gated.**
  - 1a: `drop4-solver::tutor::assess` → per-move quality/regret/one-ply facts +
    `exact|capped` flag (switch at `TRACTABLE_EMPTIES`); wasm `assess_json`/
    `tutor_json`; typed `Drop4.assess()`/`tutor()`. No `drop4-harness` dep added.
  - 1b: on-by-default `/drop4/` tutor panel — "Explain my options" (the
    class-preserving band with an idea each), blunder flag (assessed before the
    tap, surfaced after the engine replies), why-hint; honest `exact|capped`
    wording ("threw the game" only when exact, "looks risky" when capped).
  - 1c: how-to entry + `drop4-tutor` guide shot; docs (`AI-PLAYERS.md`,
    `BUILDING-GAMES.md` §10, `README.md`).
  - LLM *narration* of these facts is deferred to the hybrid phase (below).

## Done (cont.) — AIRuntime port (2026-08-03, `plans/2026-08-03-drop4-ai-tutor-layer.md` Phase 2)
- [x] **P3 `AIRuntime` port — shipped (mock CI-gated, real runtime embedded).**
  `src/harness/ai-runtime.ts`: `AIRuntime` interface, deterministic `MockRuntime`
  (CI), and `WebLLMRuntime` running a real in-browser model on WebGPU. Per the
  no-CDN-for-code / offline-PWA constraint, `@mlc-ai/web-llm` is **embedded** —
  `build.mjs` bundles it to a same-origin `/vendor/webllm.js`, dynamic-imported
  lazily (app.js unchanged; CI never loads it). Structured output via
  `response_format` json_object+schema (hand-written schema, no zod). Validated
  by `npm run ai:trial` (standalone system-Chrome driver, staged diagnostic) —
  firsthand: 0.5B loaded ~7.6s, schema-valid `{move∈enum, reason}` ~0.4s.
  Follow-on: self-host weights + `model_lib` WASM for full offline.

## Done (cont.) — HybridPlayer opponent (2026-08-03, `plans/2026-08-03-drop4-ai-tutor-layer.md` Phase 3)
- [x] **P4 `HybridPlayer` — shipped (experimental, toggle-gated).**
  `src/harness/hybrid-player.ts`: engine builds a never-throw band, the LLM picks
  in-band under a schema + speaks a reason, ANY failure falls back to the engine
  top-of-band (`source: llm|fallback`). In `/drop4/`: a separate "Experimental:
  local AI opponent" toggle offered only with a real (non-fallback) WebGPU
  adapter, an up-front download disclosure, the spoken reason beside the move, and
  LLM narration of the tutor's options when on. CI: MockRuntime (in-band /
  malformed / out-of-band paths). Real: `AI_TRIAL_MODE=hybrid npm run ai:trial`
  (system Chrome) — firsthand: legal move + "To move: O. Your opening is strong."

- [x] **P6 — browser AI-scoring harness** (`plans/2026-08-03-browser-scoring-harness.md`,
  `docs/HARNESS.md`). `src/harness/{match-runner,scorer,tournament}.ts` mirror the
  Rust `drop4-harness` over the browser substrate (shipped `drop4-wasm` + TS
  players): `Player`/`MatchRecord`/`Scorecard`/`Report`, grading a move iff the
  wasm reports it `exact` (≤16 empties). Pure scorer + wasm runner on the CI gate
  (deterministic players + `MockRuntime`); the real WebGPU Hybrid-vs-Engine trial
  is `npm run harness:trial` (system Chrome, staged diagnostic, off CI). First
  live numbers: 0.5B hybrid **0-0-2** vs Perfect, **0 blunders / 7 graded**,
  ~1130 ms/move — no strength, in-band by construction, slow.

## Next
- [ ] Phase 5 — **TS harness (browser select + narrate)**: `AIRuntime` port +
  WebLLM adapter (pinned model)
  + `LLMPlayer` + `Scorer` mirroring the Rust one + Playwright trial driver.
  This is the on-device-LLM trial (needs a browser/WebGPU). Phase 0 D1/D2
  (model choice, headless WebGPU) run here.
- [ ] Phase 6 — `/drop4/` shelf game with selectable computer opponents
  (difficulty Levels; optional "Experimental: local AI" toggle).
- [ ] Phase 7 (optional) — second `AIRuntime` adapter (Gemini Nano / transformers.js).

## Open threads
- [ ] **Persona roster + externalized persona prompts (multi-opponent, refinable).**
  Direction (owner, 2026-08-03): broaden the single "Chip" local-AI persona into a
  **selectable roster** of characters with different temperaments (e.g. Chip, a
  "Felicia" equivalent, …) the player chooses. And **stop inlining prompts** —
  manage each persona's prompt text as **external text files** (not TS string
  literals) so they refine independently and diffs stay clean/sane.
  - **Target shape:** a persona = a small data record `{ id, name, avatar,
    systemPromptFile, situationHints, fallbackLines }` loaded from text assets
    (e.g. `src/games/drop4/personas/<id>.{md,json}`), a registry the picker lists,
    and one "active persona" the game threads through. Adding "Felicia" becomes a
    new file + a registry line — not edits scattered through `drop4.ts`.
  - **Chip's current touch points to centralize** (`src/games/drop4/drop4.ts`,
    approx. lines — will drift, re-grep `LOCAL_AI_PERSONA|HYBRID_SYSTEM|Situation|
    FALLBACK_LINE|SITUATION_HINT|opponentIdentity|hybridPrompt|cleanBanter` before
    refactoring):
    - `LOCAL_AI_PERSONA = { name:"Chip", avatar:"😎" }` (~:69) — the identity record.
    - `HYBRID_SYSTEM` (~:74) — the persona system prompt (→ external file).
    - `SITUATION_HINT` (~:390) + `FALLBACK_LINE` (~:398) — per-situation prompt
      hints + in-character canned lines (→ external, per persona).
    - `readSituation` (~:383) — situation classifier (persona-agnostic; stays).
    - `hybridPrompt` (~:408) / `cleanBanter` (~:421) — assemble the prompt / gate the
      quip (persona-agnostic mechanics; consume the active persona's text).
    - `opponentIdentity()` (~:299), the turn-bar name (~:514), the `.drop4-ai-say`
      prefix (~:790), the "thinking"/warming-up status (~:359,:430,:434) — all read
      the active persona's `{name, avatar}`.
  - **Not now** — a tracked follow-on; the single-Chip version is shipped.
- [ ] **Larger-binary hosting (self-host the LLM model + `model_lib` WASM).** The
  local-AI opponent embeds the WebLLM *library* same-origin, but the model
  **weights + per-model `model_lib` WASM** still stream from the MLC/HF CDN on
  first load (then cache). For true offline + closing the `model_lib`
  code-from-CDN vector we'd self-host those, but ~1 GB is not viable on GitHub
  Pages — needs a different binary host. Tracked as an open thread (decision +
  host TBD). See `plans/2026-08-03-drop4-ai-tutor-layer.md` (Phase 0 D2 caveat).

- [x] ~~**The capped live path had never been measured.**~~ **Done 2026-08-07**
  (P9 Phase 3). It was the slowest of the three games after Othello: **914ms worst
  with 20% of moves over 400ms**, and — unlike Othello and checkers — the cost was
  in the **opening**, the widest part of the tree at Perfect's depth 10, before
  any column fills. Now **158ms, 0% over 400ms**, via iterative deepening under
  `LIVE_NODE_BUDGET` (250,000 nodes).
  - Strength was measured directly, because the harness anchor **cannot** settle
    it: the anchor grades only the tractable endgame and this bites in the
    opening. Budgeted Perfect vs unbudgeted Perfect over 30 varied-opening games
    sits inside the noise of a never-bites control.
  - The trap that nearly produced a false "collapse" finding, worth knowing before
    writing any such test: `Drop4::initial(seed)` returns the **same empty board
    for every seed**, and at zero sloppiness neither player draws from the RNG —
    so without random opening plies, "8 games" is 2 games repeated four times.
    Rig: `crates/drop4-solver/tests/budget_sweep.rs`.
  - The exact solver (≤ `TRACTABLE_EMPTIES`) is deliberately **not** budgeted: its
    class floor is `i32::signum` over proven values, and budgeting it would open
    the honesty hole P9 Phase 2 closed in Othello.

## Later — next adversarial games (moved to the shelf slate)

The next adversarial games are tracked in the shelf-wide slate, not here, so they
don't drift as a parallel list: see `TODO/README.md` → "Next games" and
`TODO/checkers.md`. In short: **checkers** next (the 3rd adversarial game; `adversary-solver` was
extracted ahead of it and Drop 4 migrated onto it 2026-08-05 — this crate no
longer carries its own `select_in_band`/`LiveBand`), then **chess** (heavier — vetted move-gen + Stockfish-WASM
oracle, gated on larger-binary hosting).
