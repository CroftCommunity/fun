# TODO — cribbage

Status: **planned, un-gated (2026-08-29).** Plan:
`plans/2026-08-29-plan-cribbage-vs-engine.md` — cribbage **against the computer
opponent, on one device**. Registry tile is `status: "soon"` until Phase 6 flips it.

## Why the gate came off

The gate (P2P transport + fair-reveal) existed because two *untrusted peers* need a
shuffle and a cut neither can rig. Against a local engine there is no second party: the
deck is a seed and the record replays, exactly as in solitaire. What the gate protected is
still owed to the two-human version — see "Follow-ups → P2P".

What did **not** transfer is the shelf's versus stack (`adversary-core`, the class band,
the minimax tutor, the `GameOracle` rig): it is perfect-information by contract, and
cribbage is hidden-information + stochastic. The plan's "Reasoning" says what is reused
(the Tier-1 pattern, `pond-outcome`) and what is new (an expectation engine over a
per-seat `View` that provably never peeks).

## Follow-ups (deferred out of the plan, in the order they were deferred)

- [ ] **Over-claim penalty** — manual counting ships in the plan (O1: a setting, off by
      default); whether an over-claim should cost points is left as a Phase 8 UX call.
- [ ] **Monte-Carlo engine** — deal out the unknowns, play out, average. The right second
      engine if measurement shows Expert is beatable by a good human; the plan's Phase 0
      ladder is its baseline. (Plan → "Alternatives considered".)
- [ ] **LLM-as-player trial** — the one game kind `docs/AI-PLAYERS.md` says an LLM might
      earn its keep as a *player*. Run it against the expectation engine at each level,
      with the peek-sensitivity check in place, before believing any result. Persona name
      reserved for this. (Plan O4.)
- [ ] **Match play** — accumulate game values (1 / skunk 2 / double skunk 3, already in
      every record) to a target across games. Needs cross-game persistence the shelf
      does not have. (Plan O2.)
- [ ] **P2P — two humans.** The original gate, now a follow-on plan: a browser-native
      transport (WebRTC / matchbox, `discovery/…/beta/cairn/iroh-app-pond-building-blocks.md`),
      a joint commit/reveal that produces the seed `GameState::new(seed)` already takes,
      and a `View`-only wire (each peer receives only its own view — which is why the
      plan builds `View` now). Nothing in the single-device build may assume a peer
      needs the full state.
