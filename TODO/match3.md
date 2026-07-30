# TODO — match-3

Status: **playable** at `/match3/` (v1: Candy-Crush target-score-in-moves with
star thresholds). Plan: `plans/2026-07-30-match3-playable.md`. Standards:
`docs/BUILDING-GAMES.md`.

## Shipped (v1)
- [x] `match3-core` deal generator (seeded, no initial matches, ≥1 legal swap).
- [x] `match3-wasm` binding + TS wrapper; `pond-outcome` score/stars extension.
- [x] Board UI: tap-a-gem → tap an adjacent gem to swap (core decides legality;
      legal swaps glow), score/swaps-left/stars/targets HUD, cascade re-render,
      verifiable result screen (stars + score + re-verify + `?r=` share).
- [x] Shared settings (hints / declare-assistance) + a "How to play" guide.
- [x] Daily board (date-seed) + free-play (`?seed=`); registry `playable`.
- [x] Tests: unit (share, verify vs real wasm, result screen) + e2e (mechanics,
      target-score run, share round-trip, axe both themes, 360px fit).

## Follow-ups
- [ ] **Tune star thresholds** — currently flat (500/1000/1600) for every board,
      so luck varies. Estimate a per-deal par (a build-time greedy/solver pass)
      to make it fair; or keep flat and just retune the numbers.
- [ ] **Variant objectives** (deferred balance decisions): clear-the-blockers /
      jelly / ingredients — the engine already models blockers.
- [ ] **Specials** (striped / wrapped / colour-bomb) and bigger cascades.
- [ ] **Drag-to-swap** as a fast-follow (tap stays the accessible floor).
- [ ] **Win cascade / clear animation** (currently an instant re-render).
- [ ] Reshuffle when a board deadlocks mid-run (rare; today the round just ends).
