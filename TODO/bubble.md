# TODO — bubble shooter

Status: **playable** at `/bubble/` — a real **aim-and-shoot** Bubble Shooter
(v2: aim an angle → fixed-point ray-cast/bounce landing → pop/drop, over a
winnable daily pack). Plan: `plans/2026-07-31-bubble-shooter-rebuild.md`
(rebuild; v1 `plans/2026-07-30-bubble-shooter.md` superseded). Standards:
`docs/BUILDING-GAMES.md`.

## Shipped (v2 — aim-and-shoot rebuild)
- [x] `bubble-core` `aim.rs`: quantized `Angle` + `resolve_shot` — fixed-point
      integer ray-cast with wall reflection over a committed direction table
      (no runtime trig on wasm32), snap to the nearest empty hex; flight `path`
      for the UI. Golden vectors (V0/V1).
- [x] `engine::shoot_angle` (resolve → place → pop ≥3 → drop; score = popped +
      2·dropped) + `state_hash`; the tap-target `shoot` kept as a legacy path.
- [x] `Game::play(Angle)` (infallible; `taken` budget counter); `impl
      pond_outcome::Game` `Move = Angle`, `VERSION = 2` — verifiable angle-line
      replay (V2).
- [x] `bubble-solver`: reachable-landing DFS → angle line; `angle_for_landing`;
      regenerated `games/bubble/daily-pack.json` (365 seeds, angle fixture),
      byte-identically regenerable (V3).
- [x] `bubble-wasm` + TS wrapper: `shoot(angle)`, `trajectory_json(angle)`,
      `geom_json`, `hint_angle`; embedded daily pack (V4/V5a).
- [x] Canvas aim UI: pointer/drag + ←/→ + slider aim, dotted trajectory preview
      (optional aim guide, on by default), rAF flight (reduced-motion snaps),
      reachable-aware hint, verification-forward result + `?r=` share,
      hints/settings, daily + free-play (V5).
- [x] "How to play" (aim-and-shoot) + guide-shots; unit (aim helpers, settings)
      + e2e (renders, landing-matches-core guardrail, keyboard aim/fire, aim-guide
      toggle, reduced-motion, fixture win + share round-trip, hints-off end, axe
      both themes, 360px) (V6).

## Follow-ups
- [ ] **Bank-shot polish.** The wall-bounce preview works; a stronger multi-bounce
      hint / trick-shot affordances could follow (still cosmetic — the angle is
      the move).
- [ ] **Ceiling advance variant.** Rows push down every N shots (arcade endless
      mode) — a separate objective, its own winnability story.
- [ ] **Specials.** Bomb bubble (clears a radius), rainbow bubble (matches any
      colour) — owner balance decisions; new golden vectors.
- [ ] **Score balance / stars.** v1 surfaces raw score, no stars. If a graded
      ladder is wanted, add per-seed thresholds (like match-3's par table).
- [ ] **Solver strength / speed.** The reachable-landing greedy DFS certifies
      ~20% of seeds winnable in the aim model (vs tap-anywhere); the per-node fan
      scan makes full-pack generation slow (~7 min). A stronger/faster solver
      (cheaper reachability, better ordering) would raise winnable density and
      speed the regen drill — not blocking (both are `#[ignore]`).
- [ ] **Versus / co-op.** A two-player bubble race is a P2P-pond item, gated on
      the transport like cribbage.
