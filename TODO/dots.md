# Dots and Boxes — shipped 2026-08-07

`/dots/` is the shelf's **fourth** adversarial game, and the first built *after*
the rule-of-three trigger was spent — so it was built to use the shared
abstraction rather than to prove it. Built to
`plans/2026-08-07-dots-and-boxes.md`, whose per-phase execution notes hold every
measurement that contradicted the plan. This file is the running worklist of what
was deferred.

## What shipped

- `crates/dots-{core,solver,wasm}` — 3×3 boxes on a 4×4 dot lattice: 24 edges,
  9 boxes, and the rule no other shelf game has — **closing a box claims it and
  the mover moves again**, so `side_to_move` is a function of the position and
  never of the move index.
- **The value is a box margin**, not a win/draw/loss class; the class is its sign
  (`class_of` is `value.signum()`). Nine boxes cannot split, so **no draw is
  reachable**, and the draw arm lives in a free function a test can reach.
- **3×3 is a second-player win, 6–3**, measured by an exact solve and cross-checked
  against an independently written Phase 0 spike. The shipped UI therefore seats
  the human **second by default**.
- Exact from 20 free edges down (a flat `Vec<i8>` memo over the edge mask, ~1.05M
  nodes); a depth-capped search above that, which is provably value-flat where it
  runs (see below).
- `src/games/dots/{dots,dots-wasm,dots-outcome,dots-lattice,dots-oracle,
  dots-howto}.ts` — playable at `/dots/`, opt-in tutor panel, hints that declare
  themselves as assistance, WebGPU-gated experimental opponent (persona
  **Bramble**), verifiable `?r=` share, guide.
- Grades through the AI-scoring harness with **no rig change**
  (`HARNESS_TRIAL_GAME=dots npm run harness:trial`), and anchors a recorded
  baseline in `tests/baselines.test.ts`.

## Measured, so nobody re-derives it

- **Latency is a non-problem here.** Worst `live_move` is 66–68 ms at *every*
  level, and it is always the same move: the first exact solve, at exactly
  `TRACTABLE_EDGES` free edges, with a cold memo table. Median 0.0–0.3 ms, 0% of
  moves over 400 ms. The exact path ignores level, so Easy costs what Perfect
  costs.
- **Iterative deepening is rejected, and not by analogy.** Where the capped search
  runs (the first four plies), no box can reach three sides, so measured at depths
  1/2/4/6/8 the set of distinct move values is `{0}` — one value. Depth 8 spends
  200–340 ms to return what depth 1 returns in 0.0 ms. Re-adopting `deepen` needs a
  measurement showing that changed (a larger board would), not a consistency
  argument with Othello.
- **83% of a side's moves are graded** by the harness (40 graded, 8 skipped over 4
  games), against checkers' 9 of 163. Same rig, same honesty gate: dots is *solved*
  from four plies in, checkers' `exact` means a terminal was proven.

## Open follow-ups

- [x] ~~**The live WebGPU hybrid trial has never been run.**~~ **Run 2026-08-10**
  on system Chrome (Apple/Metal-3), 8 games vs Perfect, Qwen2.5-0.5B: **4-0-4
  (50%)**, fallback rate **1.2%**, median **222 ms** a move, 0 blunders over 69
  graded moves. Bramble is **indistinguishable from the engine** — which is what
  the band guarantee is supposed to buy, and here it genuinely does, because dots
  is solved from four plies in so 81% of its moves are proven.

  Its 1.2% fallback rate hides the same decoder defect furrow's 10.9% made
  obvious — dots' one malformed reply is also `{` followed by whitespace. The
  shared retry now in `HybridPlayer` covers it.

  Worth keeping next to it: the *same* rig gives Furrow's hybrid **1-0-7**, for
  the same reason in reverse (21% exact). Dots' disclosure copy is accurate;
  Furrow's had to be corrected. See `docs/AI-PLAYERS.md` → "The band's guarantee
  is only as strong as the exact fraction". `HARNESS_TRIAL_GAME=dots
  npm run harness:trial` needs system Chrome and a one-time model download, which
  is an owner-machine task. What is proven on CI is the *gating* and the
  never-leave-the-band guarantee under a mock runtime — not the model. Do not
  describe Bramble as measured until this runs.
- [ ] **Persona roster** — Bramble is inlined in `dots.ts`, as Chip, Rowan and
  Alder are in their games. Part of the cross-game roster thread
  (`TODO/README.md`).
- [ ] **A board-size picker is deliberately absent.** `ROWS`/`COLS` are hashed as
  little-endian `u32`, so adding 4×4 later is additive and re-locks no golden
  vector — but it multiplies the solver tuning, the tractability threshold and the
  band by the number of sizes, and 4×4 (40 edges) is far beyond an exact solve
  from the opening, so its tutor would hedge for most of the game. If it is ever
  added, the chain/loop (Berlekamp) endgame decomposition becomes the right
  answer and this becomes a real project rather than a constant change.
- [ ] **The tutor panel's list resets on every re-render**, so playing a move
  clears the options it just explained. Othello and checkers behave the same way;
  it is a shared pattern worth fixing once rather than per game.
- [ ] **Phase 4 (mutation testing) was run late** — after Phases 5–8, not before
  them. Eleven real gaps were closed and none had reached the shipped path, but
  that was luck. The recurring survivors to expect next time are recorded in
  the plan's Phase 4 notes; one of them is `cargo mutants` itself misreporting a
  caught mutant as MISSED across three runs.
