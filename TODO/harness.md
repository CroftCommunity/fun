# Browser AI-scoring harness (P6) — backlog

Not a game — the shared measurement rig for the shelf's AI players. Full guide:
`docs/HARNESS.md`. Plan: `plans/2026-08-03-browser-scoring-harness.md`. Standards
anchor: `docs/BUILDING-GAMES.md` §10.

## Done
- [x] `src/harness/{match-runner,scorer,tournament}.ts` — `Player` port,
  `runMatch` → verifiable `MatchRecord`, pure `Scorecard`/`foldVerdict`/`gradeSide`
  (exact-only grading gate), `runTournament` → `Report` with the graded-move
  denominator surfaced (the honesty gate).
- [x] CI proves the rig + the mock hybrid plug-in over the real wasm;
  `npm run harness:trial` measures the real WebGPU hybrid (staged diagnostic).

## Open threads
- [ ] **Generalize the rig to an injected game/oracle adapter.** Today it grades
  the shipped **Drop 4** players via `drop4-wasm` directly (the P6 open question
  chose Drop-4-specific for v1 — rule of three). Othello is now the second
  adversarial game with the same `assess`/`tutor` `{quality, exact}` surface, so
  the rule of three is met: extract a small `GameOracle` adapter (load wasm,
  `assess(move)`, `play`, `board`) so `match-runner`/`scorer`/`tournament` can
  grade **any** game's players, then add an Othello trial. Do this alongside the
  `adversary-solver` crate extraction (`TODO/othello.md`) — same rule-of-three moment.
- [ ] **Self-host the model weights + `model_lib` WASM.** The WebLLM *library* is
  embedded same-origin, but weights + the per-model `model_lib` WASM still stream
  from the MLC/HF CDN on first load (then cache). True offline + closing the
  `model_lib` code-from-CDN vector needs self-hosting ~1 GB — not viable on GitHub
  Pages. Shared with `TODO/drop4.md`'s larger-binary-hosting thread (decision +
  host TBD).
- [ ] **Report the practical-strength gap, not just tactical.** The rig grades
  against best-vs-perfect-play; a "trappy move" metric (maximizes a fallible
  opponent's error chance) is the one place an LLM could add strength
  (`docs/AI-PLAYERS.md` → "Why the LLM can't beat the engine"). Needs
  opponent-modeling; ADVISORY.
