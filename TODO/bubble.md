# TODO — bubble shooter

Status: **playable** at `/bubble/` — a real **aim-and-shoot** Bubble Shooter.
Default mode is **Levels** (escalating, point-gated survival with a descending
top-row-insert stack + optional presentational timer); **Classic** (the toggle /
`?variant=classic`) is the original clear-the-board game over the winnable daily
pack. Plans: `plans/2026-07-31-bubble-shooter-rebuild.md` (aim rebuild),
`plans/2026-08-01-bubble-shooter-levels-difficulty.md` (levels). v1
`plans/2026-07-30-bubble-shooter.md` superseded. Standards:
`docs/BUILDING-GAMES.md`.

## Shipped (levels mode — tiers, ramp, descending rows, optional timer)
- [x] `board.rs` `parity_offset` + `insert_top_row` — a single-row top insert is a
      shift-down + parity flip (offset 0 default → clear-board unchanged); even
      height keeps the flat cell count invariant (V1).
- [x] `levels.rs` `LevelGame` + `LevelConfig` — arcade scoring (10/pop,
      `20·2^(n-1)` capped drop), per-level target/colours/cadence ramp, shot-driven
      seeded inserts, deadline loss; `BubbleLevels` outcome (`bubble-levels` v1,
      score + star grade), reachability sanity (V2/V3).
- [x] `bubble-wasm` levels session + exports (`new_level_game`, `level_board_json`,
      `level_shoot`, `level_trajectory_json`, `level_last_shot_json`,
      `level_current_hash`, `level_outcome_json`, hint/assist) + TS wrapper (V4).
- [x] Levels UI: mode toggle, level HUD (level, score→target progress, "stack drops
      in"), parity-aware render, insert slide + deadline band, **optional timer**
      (presentational — never a verified loss), levels result (level + score +
      stars) + `?r=` re-verify; e2e (V5).
- [x] How-to + guide-shots rewritten for levels + descending rows + timer;
      BUILDING-GAMES §4 "pressure is move-derived, never wall-clock" (V6).

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
- [x] **Ceiling advance variant.** Delivered as **levels mode** — rows push in at
      the top every N shots, the stack descends to a bottom deadline (see the
      levels section above).
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
