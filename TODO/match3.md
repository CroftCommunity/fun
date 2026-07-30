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
- [x] **Drag-to-swap** — drop on an adjacent gem swaps via the same core-decided
      resolution as tap; tap stays the accessible floor.
- [x] **Win cascade + score-gain flash** — a gem cascade on a ≥1★ result
      (reduced-motion-aware) and a score bump when a swap scores.

Round-2 follow-ups (plan: `plans/2026-07-30-match3-followups.md`):
- [x] **Full step-by-step cascade animation** — additive `Game::play_move_traced`
      emits a board snapshot per phase (same RNG → byte-identical final
      `state_hash`, golden vectors untouched); `play_swap_traced` exposes the
      frames as JSON; the UI steps through clear→fall→refill (reduced-motion skips
      to settled; input gated during the animation).

Deferred (each is a real chunk or an owner call, not a quick polish):
- [ ] **Reshuffle on a mid-run deadlock** — to stay verifiable it must live in
      the core's move resolution (so replay reshuffles identically), which
      touches the golden-vector determinism anchor. Rare on 8×8/6.
- [ ] **Variant objectives** (clear-the-blockers / jelly / ingredients) and
      **specials** (striped / wrapped / colour-bomb) — new modes + balance
      decisions reserved for the owner.
- [ ] **Tune the reference/fractions** — greedy is a rough par; a stronger
      reference (beam/lookahead) or retuned fractions, best driven by real play.
