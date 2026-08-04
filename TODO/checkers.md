# Checkers (Draughts) — concept, not started

The proposed **third** adversarial game, and the one that triggers the shared
`adversary-solver` extraction (rule of three: Drop 4, Othello, Checkers). Tier-1
Croft-native. No plan yet — this file is the scoping note; write a `phase-plan`
before building.

## Why this next
- **Exercises the whole adversarial stack a third time**, which is the trigger to
  extract the duplicated band selector (`select_in_band` / `live_band` / class-floor
  × sloppiness) from `drop4-solver` + `othello-solver` into a shared
  `crates/adversary-solver` (see `TODO/othello.md`, `TODO/harness.md`).
- **A genuinely different move space** — multi-step jumps, forced captures,
  promotion to king — stresses the `Adversary` trait harder than Othello did
  (Othello's move was a single square; a checkers move is a piece + a jump chain).
  Good generality signal: if the trait + harness + hybrid carry to *this*, the
  abstraction is real.
- **Reuses the honest-Oracle shape.** 8×8 English draughts is effectively solved
  (a draw under perfect play), but a full solve is far out of a tap budget, so the
  Oracle is heuristic (material + king + mobility + back-rank) with an **exact
  endgame** — the same exact/heuristic honesty flag Othello established.

## What reuses vs what is new
- **Reuse unchanged:** `adversary-core`, `ai-runtime.ts`, `hybrid-player.ts` (the
  tutor view must be a `TutorFactMove` superset — carry `immediateWin`/
  `blocksOpponentWin` as `false`, add a checkers one-ply fact, e.g. `crowns` or
  `captures`), and the (generalized) browser harness.
- **Reuse as a pattern:** the tutor panel, the WebGPU toggle + probe, the result
  screen, the how-to (copy the Othello TS).
- **New:** `crates/checkers-{core,solver,wasm}` + `src/games/checkers/*`. The
  `Move` type is a **jump chain** (start square + ordered landing squares), which
  must serialize compactly for `?r=` and forbid illegal partial chains — the main
  new design work vs Othello's single-square placement.

## Open design questions (resolve in the phase-plan)
- [ ] Ruleset: English draughts (8×8, men move/capture forward, flying kings off?)
  vs international (10×10, flying kings). Recommend **English 8×8** for v1 (simpler,
  matches the shelf's board scale, a known near-solved reference for tests).
- [ ] Forced-capture rule (mandatory capture, and longest-capture variants) — pick
  one, encode it in `legal_moves`, and make it a D1 discovery fixture like
  Othello's opening moves.
- [ ] Multi-jump `Move` encoding + the tutor/band over jump chains (the band is
  over full moves, so a "move" is a whole chain — confirm `buildBand` still fits).
- [ ] `TRACTABLE_EMPTIES`-equivalent for the exact endgame (few pieces), measured
  in wasm (the Othello D2 lesson).
