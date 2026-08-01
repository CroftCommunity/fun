# Drop 4 — backlog

Authoritative plan: `plans/2026-07-31-drop4-ai-harness.md`. Standards:
`docs/BUILDING-GAMES.md`. This file is the running checkbox worklist.

## Done
- [x] Phase 1 — `adversary-core` (shared two-player trait) + `drop4-core`
  (rules, win/draw detection, state hash, `Adversary` + `pond_outcome::Game`,
  golden replay + tamper test). 13 tests green, clippy clean.

## Next
- [ ] Phase 2 — `drop4-solver`: perfect negamax-bitboard oracle (`best_move`,
  exact `evaluate`), difficulty `Level`s, test-set agreement.
- [ ] Phase 3 — `drop4-wasm` C-ABI + typed TS wrapper (rules + `oracle_*`).
- [ ] Phase 4 — TS harness: `Player` port, `MatchRunner`, classic + random players.
- [ ] Phase 5 — `AIRuntime` port + WebLLM adapter + `Scorer` + `Tournament` + trials.
- [ ] Phase 6 — `/drop4/` shelf game with selectable computer opponents.
- [ ] Phase 7 (optional) — second `AIRuntime` adapter (Gemini Nano / transformers.js).

## Later (own phase-plans)
- [ ] checkers (`checkers-core` + alpha-beta solver/oracle + shelf game).
- [ ] chess (vetted move-gen + Stockfish WASM oracle + shelf game).
