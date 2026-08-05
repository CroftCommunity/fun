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
- [x] **Generalize the rig to an injected game/oracle adapter.** Done in P8
  Phases 1–3 (`plans/2026-08-04-checkers-game.md`). `src/harness/game-oracle.ts`
  is a ten-member port; each game ships `src/games/<game>/<game>-oracle.ts`.
  `match-runner`/`scorer`/`tournament` name no game. **Othello now grades on CI**
  (`tests/othello-harness.test.ts`) and `HARNESS_TRIAL_GAME=othello npm run
  harness:trial` runs the real trial. The proof it generalized: grading a second
  game required **zero** diff to the three rig files — asserted by the phase gate,
  not assumed.
  - Gained along the way: `MatchRecord.abortReason` + `Report.abortedGames`, so a
    tournament that grades nothing says so instead of rendering a clean
    `W-D-L 0-0-0`. Othello made this necessary — a mishandled forced pass aborts.
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
