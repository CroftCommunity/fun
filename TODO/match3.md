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
- [x] **Per-deal star targets** — thresholds now scale to a deterministic greedy
      reference score for the seed (40/66/100%), re-derived at verify time so
      shared score/stars are trustless. No shipped par table needed.
- [ ] **Tune the reference/fractions** — greedy is a rough par; a stronger
      reference (beam/lookahead) or retuned fractions would sharpen fairness.
- [ ] **Variant objectives** (deferred balance decisions): clear-the-blockers /
      jelly / ingredients — the engine already models blockers.
- [ ] **Specials** (striped / wrapped / colour-bomb) and bigger cascades.
- [ ] **Drag-to-swap** as a fast-follow (tap stays the accessible floor).
- [ ] **Win cascade / clear animation** (currently an instant re-render).
- [ ] Reshuffle when a board deadlocks mid-run (rare; today the round just ends).
