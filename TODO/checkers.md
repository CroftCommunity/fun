# Checkers (English draughts) — shipped 2026-08-06

`/checkers/` is the shelf's **third** adversarial game and the one that triggered
the shared `crates/adversary-solver` extraction (rule of three: Drop 4, Othello,
checkers). Built to `plans/2026-08-04-checkers-game.md`, whose Review Log holds
the per-phase execution record — including every measurement that contradicted the
plan. This file is the running worklist of what was deferred.

## What shipped

- `crates/checkers-{core,solver,wasm}` — English draughts on 8×8: mandatory
  capture, multi-jump chains, crowning (which ends the move), and the standard
  tournament **no-progress draw** (40 moves a side with no capture and no man
  advanced) — adopted because codified draughts has no terminating draw rule a
  deterministic core can use. The counter is part of the hashed state.
- The move is a **jump chain**, packed as `(from, to, variant)` into a 14-bit
  code — the shelf's first move code above a `u8`, and the first that is not a
  destination square. `variant` disambiguates chains sharing an origin and
  destination (measured max 3 over 2.25M positions).
- `src/games/checkers/{checkers,checkers-wasm,checkers-outcome,checkers-oracle,
  checkers-howto}.ts` — playable at `/checkers/`, tutor panel, WebGPU-gated
  experimental opponent (persona **Alder**), verifiable `?r=` share, guide.
- Grades through the AI-scoring harness with **no rig change**
  (`HARNESS_TRIAL_GAME=checkers npm run harness:trial`).

## Open follow-ups

- [ ] **The graded fraction is thin.** Checkers is `exact` only where the search
  proves a terminal, so the tutor and the harness grade a small share of plies
  (Phase 11 measured ~11% over engine self-play; the Phase 15 hybrid trial graded
  6 of 105). The lever, if it is worth pulling, is a **separate, larger search
  budget for the tutor path** — a panel opening can afford what a move cannot —
  **not** a bigger budget for the opponent, and **not** `TRACTABLE_PIECES` (see
  next item).
- [ ] **The midgame is the latency floor, not the endgame.** 13–18 pieces costs
  ~341ms worst-case in wasm under every setting of `TRACTABLE_PIECES`, which is
  the opposite of what the plan assumed. Anything that wants checkers faster has
  to look at midgame depth. Do not re-tune the endgame knob for speed.
- [ ] **`MoveClass::Blunder` is close to unreachable in practice** — it needs *both* the
  played move's value and the best move's to be proven, and a 300-position sweep
  produced no such pairing. A zero-blunder assertion over a checkers tournament is
  therefore close to vacuous; the honest measures are `scoredMoves` and the class
  floor. Worth revisiting if the tutor budget above changes.
- [x] ~~**No recorded harness baseline for checkers.**~~ **Done 2026-08-06.**
  `tests/baselines.test.ts` now anchors all three games; checkers records
  `0-2-0, graded 4, skipped 159` and adds ~16s to the opt-in `npm run baselines`.
  Both games draw at top-level self-play (the 80-ply no-progress rule), and the
  graded fraction is 2.5% — the number to watch is `scoredMoves`, since a 0 there
  means the anchor has stopped measuring anything.
- [ ] **Persona roster** — Alder is inlined in `checkers.ts`, as Chip is in Drop 4
  and Rowan in Othello. Part of the cross-game roster thread (`TODO/README.md`).
- [ ] **Banter can assert false board facts.** Observed in the Phase 14 WebGPU run:
  a 0.5B model ignored "never analysis" and described a capture that did not
  exist. The move stays engine-safe (the band decides), and `exact` is not
  involved, so this is cosmetic — but the fix belongs in the **shared** banter
  filter (`cleanBanter` checks only length, in every game), not per game.
- [ ] **Board orientation is fixed** — row 0 (Side A / Black) at the top, both for
  the human and the engine. Conventional digital checkers puts your own men at the
  bottom. A view flip is a second geometry to keep correct; deliberately not done.

## Deferred by design (not defects)

- No 10×10 international draughts, no flying kings, no longest-capture rule. v1 is
  English draughts, chosen in the plan for its known reference material.
- No opening book and no endgame tablebase.
