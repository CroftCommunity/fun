# TODO — bubble shooter

Status: **playable** at `/bubble/` (v1: clear-the-board-in-N-shots with a
guaranteed-winnable daily pack and a surfaced pop/drop score). Plan:
`plans/2026-07-30-bubble-shooter.md`. Standards: `docs/BUILDING-GAMES.md`.

## Shipped (v1)
- [x] `bubble-core`: staggered hex board + six-neighbour adjacency, seeded deal,
      `shoot` (place → pop connected ≥3 → drop floating; score = popped +
      2·dropped), `state_hash`, golden vectors (B1/B2).
- [x] `Game` wrapper: present-on-board deterministic launcher colours, shot
      budget, surfaced score; `impl pond_outcome::Game` — verifiable replay (B3).
- [x] `bubble-solver` + `games/bubble/daily-pack.json`: 365 winnable seeds + a
      fixture clear line; byte-identically regenerable (B4).
- [x] `bubble-wasm` binding + typed TS wrapper; embedded daily pack (B5).
- [x] Board UI: tap a glowing landing cell to shoot (core decides legality),
      launcher + score/shots-left HUD, verification-forward result + `?r=` share,
      hints/settings, daily + free-play (`?seed=`); registry `playable` (B6).
- [x] "How to play" guide + guide-shots; unit + e2e (renders, glow==core, tap
      spends a shot, illegal-tap guardrail, fixture win + share round-trip,
      hints-off end, axe both themes, 360px) (B7).

## Follow-ups
- [ ] **Aim preview / bank shots.** A trajectory preview + wall-bounce aiming as
      a fast-follow — must NOT break the quantised tap-target `state_hash`
      (preview only; the move stays the target cell).
- [ ] **Ceiling advance variant.** Rows push down every N shots (arcade endless
      mode) — a separate objective, its own winnability story.
- [ ] **Specials.** Bomb bubble (clears a radius), rainbow bubble (matches any
      colour) — owner balance decisions; new golden vectors.
- [ ] **Score balance / stars.** v1 surfaces raw score, no stars. If a graded
      ladder is wanted, add per-seed thresholds (like match-3's par table).
- [ ] **Solver strength.** The greedy DFS certifies ~45% of seeds winnable; a
      stronger solver would raise the winnable density (smaller `max_seeds`
      scan) — not needed while generation is fast.
- [ ] **Versus / co-op.** A two-player bubble race is a P2P-pond item, gated on
      the transport like cribbage.
