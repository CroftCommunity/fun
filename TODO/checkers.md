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
  - [x] ~~**The harness grades at the coach depth, not an analysis depth.**~~
    **Done 2026-08-06.** `assess_json` now uses the analysis budget (the panel's),
    so the grader outranks every shipped level instead of sitting a ply below
    Expert. Recorded baseline moved 4 → 9 graded of 163 plies, and the run cost
    roughly doubled (~16s → ~32s) — the intended trade. The C-ABI test asserts it
    by *agreement*: `assess_json` and `tutor_json` must report the same `exact`
    for the same move, which the old wiring breaks on the first proof that lands
    between the two horizons.
- [x] ~~**The midgame is the latency floor, not the endgame.**~~ **Investigated
  and closed 2026-08-07 with no change** (P9 Phase 3). 13–18 pieces costs ~337ms
  worst-case under every setting of `TRACTABLE_PIECES`; do not re-tune the endgame
  knob for speed. But **checkers needs nothing here**, and this is the entry that
  says so:
  - **0% of checkers' moves exceed 400ms.** It is a true tail, not a plateau —
    unlike Othello (38% over 400ms) and Drop 4 (20%).
  - Iterative deepening under a node budget was built for checkers first, on the
    assumption it would be "provably free". It is a **12% tax**: 337ms → 494ms
    without best-move ordering, 377ms with it, because re-searching depths
    `1..n-1` is only repaid when the budget bites — and checkers' never does.
    Mandatory capture already orders its moves near-optimally, so a shallow pass
    has nothing to teach the next one.
  - **It was reverted in full.** If you are reading this because you noticed
    checkers lacks the `deepen` driver its two sibling games use: that is
    deliberate and measured. Re-adopting it needs a measurement showing checkers'
    distribution has changed, not a consistency argument. Full reasoning:
    `docs/AI-PLAYERS.md` → "When iterative deepening pays, and when it is a tax".
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
- [x] ~~**Banter can assert false board facts.**~~ **Done 2026-08-06** in the
  shared `src/harness/banter.ts`, as the entry said it should be. Re-measured on a
  real WebGPU run: 2 of 8 lines the model's own, 6 canned, and no line claiming a
  square or a position. Two that passed are vague rather than false ("Capture on
  move to win the game") — the rule targets checkable claims, not incoherence.
- [ ] **Board orientation is fixed** — row 0 (Side A / Black) at the top, both for
  the human and the engine. Conventional digital checkers puts your own men at the
  bottom. A view flip is a second geometry to keep correct; deliberately not done.

## Deferred by design (not defects)

- No 10×10 international draughts, no flying kings, no longest-capture rule. v1 is
  English draughts, chosen in the plan for its known reference material.
- No opening book and no endgame tablebase.
