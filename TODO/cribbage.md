# TODO — cribbage

Status: **shipped 2026-08-29** — `/cribbage/`, against the engine, on one device.
Plan: `plans/2026-08-29-plan-cribbage-vs-engine.md` (all phases executed; the
Review Log records what each measured). Rules: `crates/cribbage-core/RULES.md`.

## Follow-ups (deferred out of the plan, in the order they were deferred)

- [ ] **Over-claim penalty** — manual counting ships (O1: a setting, off by
      default); an over-claim is corrected with no penalty. Whether it should cost
      points is a UX call nobody has asked for yet.
- [ ] **Monte-Carlo engine** — deal out the unknowns, play out, average. The right
      second engine if a good human beats Expert; the rig's ladder
      (`crates/cribbage-solver/tests/rig.rs`) is its baseline.
- [ ] **LLM-as-player trial** — the one game kind `docs/AI-PLAYERS.md` says an LLM
      might earn its keep as a *player*. Run it against the expectation engine at
      each level, with the peek check in place, before believing any result. The
      persona slot (`LOCAL_AI_PERSONA` in `cribbage.ts`) is wired and empty (O4).
- [ ] **Match play** — accumulate game values (1 / skunk 2 / double skunk 3,
      already in every record) to a target across games. Needs cross-game
      persistence the shelf does not have. (O2.)
- [ ] **Level tuning by measurement** — the bands in `cribbage-solver/src/live.rs`
      were set from Phase 0's ladder and checked for order by the rig (Hard >
      Medium 75%, Medium > Easy 80%, Expert > Hard 57% at 300 games). Nobody has
      asked whether Easy is *fun* yet.
- [ ] **P2P — two humans.** The original gate, now a follow-on plan: a
      browser-native transport (WebRTC / matchbox,
      `discovery/…/beta/cairn/iroh-app-pond-building-blocks.md`), a joint
      commit/reveal that produces the seed `GameState::new(seed)` already takes,
      and a `View`-only wire (each peer receives only its own view — which is why
      `View` exists now). Nothing in the single-device build assumes a peer needs
      the full state.
