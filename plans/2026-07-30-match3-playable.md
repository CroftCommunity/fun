# Playable match-3 — the second game on the shelf

**Status:** ✅ **SHIPPED (v1) 2026-07-30.** `/match3/` is playable: an 8×8 / 6-colour
board, tap-a-gem→tap-adjacent to swap (core-driven legal-swap glow), a 20-swap
budget graded into 0–3 stars at flat 500/1000/1600 thresholds, a verifiable
score+stars record with re-verify + `?r=` share, daily (date-seed) + free-play,
hints/settings, and a How-to-play guide. Gate green: Rust 56 + fmt + clippy;
vitest 78 / Playwright 31 (axe both themes). Follow-ups (par tuning, variants,
specials, drag) tracked in `TODO/match3.md`. Objective decided with the owner:
**Candy-Crush-style target-score-in-moves with star thresholds**, flat to start.

---

## Problem Statement

`match3-core` is a green **mechanics engine** (swap → find-matches → clear →
gravity → refill → cascade, score = gems×10 + blocker-layers×20, `state_hash`),
but it is not a playable game:

1. **No objective.** No win/goal; the master plan reserved par/levels/specials
   as owner balance decisions.
2. **No starting deal.** Boards are built from char grids (`from_rows`); there is
   no seeded random deal, and a naive fill can contain free matches or have no
   legal move.
3. **No browser binding / UI.** `match3-wasm` is a stub; nothing renders.
4. **The verifiable-outcome substrate is win-oriented.** `pond-outcome`'s
   `Record`/`Outcome` model a binary win (solitaire); a score-based game needs a
   score in the record.

Goal: `/match3/` is a real, verifiable, accessible game meeting every standard in
`docs/BUILDING-GAMES.md`.

## Reasoning / decisions (owner-confirmed direction)

- **Objective = target score within N moves, graded by stars** — the Candy
  Crush reference default. You get a fixed **move budget**; when it runs out the
  score is tallied into **0–3 stars** at thresholds; a run "passes" (`Won`) at
  ≥1★. This maps cleanly to the pond's verifiable outcome: replay the swaps →
  re-derive the score → re-award the stars; nothing is trusted.
- **Flat thresholds for v1**, not a per-deal par. A fair per-deal target needs a
  solver/estimator (the winnable-daily-pack problem); the owner chose to **avoid
  the solver** for v1. Thresholds are provisional consts, tunable later. This
  also means **any deal is playable** → no winnable-pack needed, so the daily is
  just a date-derived seed.
- **Gems only, no blockers, v1.** Blockers/ingredients/jelly are variant
  objectives (deferred). Board **8×8, 6 colours** (a clean, standard size).
  **Move budget 20.**
- **The deal must be honest:** a settled board (no free matches at t=0) with **at
  least one legal swap**, generated deterministically from the seed. This is new
  determinism-critical core code → red-first, with a golden vector.
- **Interaction = tap-a-gem then an adjacent gem to swap** (the shelf's
  tap-source→tap-target floor). The core decides legality (`swap_legal` /
  the legal-swaps list); the UI only highlights and calls `play`.
- **Score in the verifiable record:** extend `pond-outcome` minimally and
  additively (`Replayed`/`Record` gain optional `score`/`stars`; an
  `Outcome::Lost` for a completed run under target). Solitaire leaves them
  `None` — no behaviour change.

## Phases

- **M1 — core deal generator.** `match3-core`: `deal(seed, w, h, colors) ->
  Board` (settled, no initial matches, ≥1 legal swap) + `legal_swaps(board)` /
  `has_legal_move`. Red-first; a golden vector pins a seed's deal.
- **M2 — pond-outcome score/stars.** Additive `score`/`stars` on
  `Replayed`+`Record`; `Outcome::Lost`; `attest` threads them; `verify`
  unchanged (re-derives hash+won). Solitaire stays green.
- **M3 — match3-wasm binding + TS wrapper.** Raw C-ABI, holds Game + swap list:
  `new_game`, `board_json`, `legal_moves_json`, `play_swap(r1,c1,r2,c2)`,
  `score`, `moves_left`, `current_hash`, `is_won`, `outcome_json`. Never panics.
  `build:wasm` builds it; `build.mjs` serves `/match3.wasm`.
- **M4 — board UI (`match3.ts`).** 8×8 gem grid (6 accessible gem tokens in
  `tokens.css`, AA in both themes), tap-to-swap with core-driven legal-swap
  glow, score/moves-left/target/stars HUD, cascade re-render, moves-out →
  verifiable result screen (stars + score + record + re-verify + share), hints
  (a legal swap) + shared settings, daily (date-seed) + free-play (`?seed=`).
- **M5 — guide, registry, tests, deploy.** `match3-howto.ts` + registry +
  guide-shots; flip `registry.ts` to `playable`; unit + e2e (mechanics,
  target-score win, share round-trip, axe both themes, 360px fit);
  README/BUILDING-GAMES/TODO updates; full gate + deploy.

## Definition of done

A stranger opens `/match3/`, gets the daily 8×8 deal, swaps adjacent gems (legal
swaps glow; the core decides), watches cascades score up against a move budget,
and on moves-out sees a **verifiable score + stars** record with re-verify +
share. Free-play + `?seed=` + hints + settings + a How-to-play guide all work;
gate green (Rust + unit + e2e incl. axe both themes); committed + pushed +
deployed.

## Not in this slice
Blockers/jelly/ingredients objectives; per-deal par via solver; specials
(striped/wrapped/color-bomb); a winnable/target daily pack; drag-to-swap
(fast-follow — tap is the floor).
