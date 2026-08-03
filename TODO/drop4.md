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

## Next
- [ ] Phase 5 — **TS harness**: `AIRuntime` port + WebLLM adapter (pinned model)
  + `LLMPlayer` + `Scorer` mirroring the Rust one + Playwright trial driver.
  This is the on-device-LLM trial (needs a browser/WebGPU). Phase 0 D1/D2
  (model choice, headless WebGPU) run here.
- [ ] Phase 6 — `/drop4/` shelf game with selectable computer opponents
  (difficulty Levels; optional "Experimental: local AI" toggle).
- [ ] Phase 7 (optional) — second `AIRuntime` adapter (Gemini Nano / transformers.js).

## Later (own phase-plans)
- [ ] checkers (`checkers-core` + alpha-beta solver/oracle + shelf game).
- [ ] chess (vetted move-gen + Stockfish WASM oracle + shelf game).
