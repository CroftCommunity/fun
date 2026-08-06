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

- [x] ~~**The graded fraction is thin.**~~ **Partly done 2026-08-06** — the
  *tutor panel* now has its own budget, which is what the plan named as the lever.
  `TUTOR_DEPTH` is `Expert + 1` (was `Hard`, i.e. shallower than the opponent),
  measured in wasm: proven move values **2.2% → 4.9%**, worst call 46ms → 724ms.
  The panel is opened deliberately and now paints a reading state before it
  searches, so the cost is visible rather than a dead button.
  - The **tap path is unchanged at 46ms**: it reads a new `coach_json` export at
    `COACH_DEPTH` (the old depth). Splitting them is the whole point — before, the
    same call served both, so raising the panel's depth would have put 724ms on
    every move played with the tutor on. The ordering `COACH < TUTOR` and
    `TUTOR > Expert` are **compile-time** assertions, not tests.
  - [ ] **Still open: the harness grades at the coach depth, not an analysis
    depth.** `assess_json(code)` is what `checkers-oracle.ts` calls, and it is
    deliberately the cheap tap-path budget — so the recorded baseline is still
    4 graded of 163 plies, unchanged by this work. It is also *shallower than
    `oracle_best` plays* (`ORACLE_DEPTH` = Expert), which is incoherent for a
    surface whose job is grading: the grader should not be weaker than the player
    it grades. Pre-existing, not introduced here. The fix is a separate deep
    per-move export for the adapter; the cost is a slower `npm run baselines`.
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
