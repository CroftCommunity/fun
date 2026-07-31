# Match-3 parity — Track B2: wrapped-candy activation

**Status:** planning (2026-07-31). Parent: `plans/2026-07-30-match3-parity-roadmap.md`
(Track B / B2). Builds on B0 (`plans/2026-07-30-match3-b0-specials.md`, wrapped is
**created** from an L/T match) and B1 (`plans/2026-07-30-match3-b1-striped.md`, the
activation engine: `fires`/`blast_region`/`activate` set-union + chaining, and the
match/swap trigger split). B2 makes the wrapped candy **activate** — its canon
**double 3×3 explosion** — and re-locks the data the new scoring/legality shifts.

## Problem Statement

A wrapped candy created in B0 is inert: it sits on the board and clears like a plain
gem. Candy-Crush parity (roadmap D4: "wrapped → 3×3 double blast") needs it to
**explode in a 3×3 area, twice, with a settle in between**. B2 must make activation:

- **deterministic and ordered** — the two-step blast and its chain are re-derived
  identically at verify time (same `state_hash`), on every device;
- **the faithful double** — the reference wrapped stays on the board through its
  first explosion, candies fall in around it, then it explodes a second time and is
  consumed (owner decision 2026-07-31, see Reasoning);
- **triggerable two ways** (as striped): a wrapped **matched** in a line/LT fires as
  it clears (B2.1), and a wrapped **swapped** with a neighbour fires even with no
  line match — which makes the swap legal (B2.2);
- **chaining + cascading** — a blast that hits another special fires it (a chained
  wrapped does its own double); the expanded clear feeds gravity/refill and cascades;
- **winnable-daily preserving + honestly par'd** — activation shifts scoring and
  (B2.2) legality, so the committed packs regenerate (B0/B1 discipline) and stay
  winnable.

## Positioning

This game is a **generic** of the match-3 / Candy-Crush mechanic set (acetaminophen
to Candy Crush's Tylenol — see the roadmap "Positioning" section): the mechanics
mirror the reference exactly, only the branding differs. So the wrapped's *behaviour*
is fixed by the reference (the double 3×3, wrapped visible between blasts); the only
open choices are genuine *engineering* forks — resolved below.

## Reasoning

- **The double is the reference; its realization was the fork (owner-decided
  2026-07-31).** The canon "3×3, twice, settle between" is not negotiable. What
  branched was how a deterministic engine realizes the second blast. Three
  realizations were surfaced:
  1. *Consume + ghost re-blast* — blast 1 clears the full 3×3 (wrapped included); a
     transient pending-centre re-blasts the same coordinates next step. Cleanest
     determinism, but the wrapped is **gone** from the board between blasts —
     diverges from the reference's visible behaviour.
  2. **Survive + pin in place (CHOSEN)** — blast 1 clears the 3×3 **minus the
     wrapped's own cell** (it survives); the wrapped is **pinned** through that one
     gravity step (candies fall in around it); on the next cascade step it fires
     again — this time consuming itself. **This mirrors the reference exactly** (the
     wrapped is visibly present between its two explosions). Cost: a transient pin in
     gravity's per-column segment logic + a re-blast seed threaded through the loop.
  3. *Single 3×3 now, double as follow-up* — defer the double. Rejected: the roadmap
     locks the double as B2's definition of done.
  Because the game is a faithful generic, the owner chose **(2)** — match the
  reference's on-screen behaviour.
- **Determinism of the pin + re-blast.** The pending re-blast set is **transient
  within a single `resolve_move`** (a `Vec<Pos>` of surviving-wrapped cells, in
  current-board coordinates). The pinned wrapped does **not** move during its
  survive-step gravity, so its cell is unchanged from the fire step to the re-blast
  step — the pending coordinates stay valid without any position tracking. Because it
  never persists across moves, it is **not** in `state_hash` (which is only taken on
  the settled board between moves); the loop simply re-derives it each step. Every
  step is a pure function of the board, so replay reproduces it bit-identically.
- **Chaining a wrapped does its own double.** If a blast (striped line or wrapped
  ring) hits another wrapped, that wrapped is *triggered*, not destroyed — it first-
  blasts its own ring this step (survives, pinned) and re-blasts next step, exactly as
  a directly-fired wrapped. So a chained wrapped is enqueued as a first-blast and
  joins the pending set. This is the reference's "wrapped set off by a chain still
  explodes twice".
- **Pinned wrapped are protected from a simultaneous clear.** A wrapped surviving its
  first blast must not be cleared by another blast's ring that overlaps its cell
  (else it could not re-blast). So the clear set has the pending set subtracted at the
  end — the same "just-created specials survive" protection B1 uses for creations,
  applied to survive-first-blast wrapped.
- **Pin = a one-step shelf in gravity.** The surviving wrapped acts like a temporary
  blocker for that single gravity pass: it splits its column into a segment above and
  a segment below, and it itself stays put (candies above settle onto it, candies
  below settle beneath it). This reproduces "candies fall in around the wrapped". It
  stays a `Gem`+`Wrapped` (not a real blocker) and is a shelf only for that one pass.
- **Two triggers, both reference-faithful, split by legality risk (B1's pattern):**
  - **Match-activation (B2.1)** — a wrapped in the matched set fires. Self-contained:
    only the clear/cascade changes; **swap legality is untouched** (the swap-fire
    predicate stays striped-only this phase, decoupled from the activation predicate).
  - **Swap-activation (B2.2)** — swapping a wrapped with any adjacent gem is legal
    even with no line match, and fires it. This changes `swap_legal`/`legal_swaps`/
    `has_legal_move` (new legal moves where a wrapped sits), rippling to
    reshuffle/deal/winnability — the riskier, determinism-sensitive half, its own
    phase after match-activation works (exactly the B1.1 vs B1.2 split).
- **Blast semantics (documented, revisable):** a wrapped's 3×3 is clamped to the
  board and **excludes blockers** from the clear (a blocker in the 3×3 takes one
  layer of adjacency damage via T2, like a match — mirroring the striped rule). The
  wrapped's own cell scrubs jelly only on the **second** blast (it is not cleared on
  the first). Scoring stays flat: +10 per gem cleared (each blast), +20 per blocker
  layer.
- **Mandatory re-lock, again.** Activation changes match outcomes and (B2.2) swap
  legality, so `reference_score`/`_beam`/`random_score` and the solver diverge →
  regenerate `games/match3/{par,blockers,jelly}-pack.json` **in the same commit** as
  each rule change (B0/B1's lesson). **Run the full gate (`npm run test` +
  `npm run e2e`), not just `cargo test`** — the pack regen leaves hardcoded e2e/unit
  fixtures stale, which the Rust gate alone misses (B0.4 lesson).

## Verified Assumptions

- Activation lives in `activate` + `resolve_move` (`crates/match3-core/src/engine.rs`),
  which already computes `creations_for` and threads swap + step index (B0.3/B1). The
  wrapped double slots in there: `activate` gains a `pending` return, `resolve_move`
  threads a `reblast_seed` and uses a pinned gravity on the survive step. Confirmed by
  reading `engine.rs`.
- `blast_region` currently returns a striped line; a `Wrapped` arm returns the clamped
  3×3 (blockers excluded), reusing the same `Vec<Pos>` shape. Confirmed (B1).
- `fires` gates activation seeding; `swap_legal` has a separate `if fires(..)` clause
  (added B1.2). B2.1 **decouples** these: an activation predicate (striped + wrapped)
  drives `activate`/chaining, a swap-fire predicate (striped only in B2.1, + wrapped in
  B2.2) drives `swap_legal`. Confirmed by reading `swap_legal`.
- `apply_gravity` is per-column-segment with blocker boundaries; a pin set adds
  boundaries without moving the pinned gem. Its public signature is used by tests +
  `specials.rs`, so the pinned variant is additive (`apply_gravity` delegates to it
  with an empty pin set). Confirmed by reading `apply_gravity`.
- Golden-vector schema has an optional `special` grid (vectors 04–09); the `Vector`
  replay + `print_final_hashes` lock flow is unchanged. Pack generators/drills + the
  e2e/unit fixtures behave as in B0.3/B1. Confirmed.

## Documentation Impact

- `crates/match3-core/RULES.md` — extend **T1c — Activation** with the wrapped double:
  the 3×3 blast region, first-blast-excludes-self + pin + re-blast, chaining a wrapped
  (its own double), pending-set protection, blocker/jelly interaction; the B0 "wrapped
  activation is B2" forward-reference resolves here.
- `crates/match3-core/vectors/README.md` — note the wrapped double in the step-0
  expectations (a matched wrapped clears its ring at step 0; the centre + a re-blast
  land on the next step).
- `TODO/match3.md` + roadmap Track B — tick B2.
- `docs/BUILDING-GAMES.md` — only if a new reusable pattern emerges (the pin is match-3
  specific; likely just a determinism note).

## Concurrency Map

All phases sequential — each writes `engine.rs` + `RULES.md`, and B2.2/B2.3 depend on
the double-blast core B2.1 builds. No parallel set.

## Phases

### Phase 1 (B2.1) — match-activation + double-blast core + pack re-lock
**Goal:** a wrapped candy cleared by a match fires its 3×3, survives, is pinned through
gravity, and re-blasts (consumed) next cascade step; chaining a wrapped does its own
double; deterministic; packs re-locked. Swap legality unchanged this phase.
**Changes:**
- [ ] `engine.rs` — `blast_region` `Wrapped` arm = clamped 3×3, blockers excluded;
  an activation predicate incl. `Wrapped`; `activate` returns `{ clear, pending }`:
  a first-blast wrapped clears its ring (not self) and joins `pending`; a re-blast
  wrapped (seeded from the previous step) clears the full 3×3 (self consumed); the
  clear set has `pending` subtracted (protection); chaining a wrapped enqueues a
  first-blast.
- [ ] `engine.rs` — `apply_gravity_pinned(board, &pinned)` (pinned cells are one-pass
  shelves); `apply_gravity` delegates with an empty set. `resolve_move` threads a
  `reblast_seed` (init empty, set to `act.pending` each step), pins `act.pending` on
  that step's gravity, and does not `break` while a re-blast is pending.
- [ ] `RULES.md` — T1c wrapped double (region, survive/pin/re-blast, chain, protection,
  blocker/jelly).
- [ ] `tests/specials.rs` — a matched wrapped clears its 8-ring at step 0 and its
  centre survives; the re-blast clears the 3×3 on the next step (final board); a
  pinned wrapped stays put through gravity while neighbours fall; a blast chaining
  into a wrapped fires both doubles; a just-created wrapped is not fired; blocker/jelly
  in the 3×3 behave.
- [ ] golden vectors `10-wrapped-activate`, `11-wrapped-chain` (locked).
- [ ] regenerate the three packs; confirm 365 winnable + byte-identical drills; update
  any stale e2e/unit fixtures.
**Call chain:** `Game::play_move` → `resolve_move` → `activate` (+ `apply_gravity_pinned`).
**Wiring test:** `golden_vectors` over `10`/`11`; a `play_move` test asserting a matched
wrapped emptied its ring then (re-blast) its centre.
**Read/Write-set:** engine.rs, RULES.md, tests, vectors/10–11, games/match3/*.json.
**Validation:** Broad — Rust gate + regen drills + **full** `npm run test` + `e2e`.
**Done when:** matched wrapped fires the double + chains + cascades deterministically;
all three gates green; packs winnable + byte-identical.

### Phase 2 (B2.2) — swap-activation (legal without a match) + pack re-lock
**Goal:** swapping a wrapped with any adjacent gem is legal and fires its double.
**Changes:**
- [ ] `engine.rs` — the swap-fire predicate now includes `Wrapped`; `swap_legal` true
  when either swapped cell holds a wrapped; `resolve_move` seeds a first-blast from a
  swapped wrapped that formed no line match; `legal_swaps`/`has_legal_move` follow.
  Keep the no-special path byte-identical.
- [ ] `RULES.md` — T1c swap-trigger clause covers wrapped; the legality change noted.
- [ ] tests — swapping a wrapped into a non-matching spot fires it + is legal;
  `legal_swaps` includes wrapped swaps; a board dead for plain gems but holding a
  wrapped is not "dead".
- [ ] golden vector `12-wrapped-swap-activate` (locked); regenerate packs.
**Risks:** the legality change re-locks packs and can shift winnability (a wrapped is
always swappable). Log any seed that drops. Keep the plain-gem path identical (guarded
by the untouched pre-specials vectors).
**Validation:** Broad — full gate + regen drills.
**Done when:** swap-to-fire works + is legal, plain-gem play unchanged, all gates green,
packs winnable + byte-identical.

### Phase 3 (B2.3) — UI + how-to + guide shots
**Goal:** the double reads clearly; how-to describes the wrapped power.
**Changes:**
- [ ] `src/games/match3*.ts` — the traced animation already steps through the two-blast
  cascade (the re-blast is just another cascade step); confirm the settled render is
  correct. Optionally a brief blast flash (reduced-motion-safe). Update the how-to: a
  wrapped candy clears a 3×3, twice; make one with an L/T match; fire it by matching or
  swapping it.
- [ ] e2e — drive a wrapped activation and assert the 3×3 emptied (both blasts).
- [ ] regenerate guide shots if the visuals changed.
**Validation:** Moderate — full `npm run e2e` (both projects, incl. axe).
**Done when:** the double is visible + documented; e2e green; shots current.

## Open Questions

Resolved by the generic-of-Candy-Crush positioning + the owner's B2 decision:
- [CONFIRMED: survive + pin] **Double-blast realization** — the wrapped survives its
  first 3×3, is pinned in place through the settle, and re-blasts (consumed) next step;
  mirrors the reference's visible behaviour (owner 2026-07-31).
- [CONFIRMED: include] **Swap-activation in B2** — yes (B2.2); swapping a wrapped is a
  primary way to fire it. Its own phase for the legality risk.
- [CONFIRMED: double] **Chained wrapped** — a wrapped set off by another blast does its
  own full double (first-blast + pin + re-blast), not a single blast.
- [CONFIRMED: protect] **Pinned wrapped hit by a simultaneous blast** — survives (the
  pending set is subtracted from the clear); special-by-swap combos are B5.

## Review Log
### Pass 1 — 2026-07-31
Plan authored from deep B1 context (same files/patterns as B1.1/B1.2). Owner surfaced
the double-blast realization as an engineering fork and chose "survive + pin in place"
to mirror the reference (the game is a faithful generic — see the roadmap Positioning
section). Key carried-forward lesson baked into the rule-changing phases: regenerate
packs in-commit and run the **full** gate, not just cargo. New determinism note: the
pending re-blast set is transient within `resolve_move` (never in `state_hash`); the
pin keeps the wrapped's coordinates stable so no position tracking is needed.
