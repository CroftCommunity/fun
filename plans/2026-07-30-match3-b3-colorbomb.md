# Match-3 parity — Track B3: colour-bomb activation

**Status:** planning (2026-07-31). Parent: `plans/2026-07-30-match3-parity-roadmap.md`
(Track B / B3). Builds on B0 (`plans/2026-07-30-match3-b0-specials.md`, a colour
bomb is **created** from a line-5) and B1/B2 (the activation engine:
`fires_on_match`/`fires_on_swap`, `blast_region`, `activate`'s set-union + chaining,
the swap-seed in `resolve_move`). B3 makes the colour bomb **activate** — its canon
**swap-with-a-gem clears all of that colour** — and re-locks the data it shifts.

## Problem Statement

A colour bomb created in B0 is inert: it sits on the board and clears like a plain
gem. Candy-Crush parity (roadmap D4 / B3: "swap-with-gem clears all of that colour")
needs it to **detonate a colour** — when swapped with an adjacent gem, every gem of
that gem's colour on the board is cleared, and the colour bomb is consumed. B3 must
make activation:

- **deterministic and ordered** — the colour-clear and its chain are re-derived
  identically at verify time (same `state_hash`), on every device;
- **swap-triggered** — swapping a colour bomb with any adjacent gem is legal even
  with no line match; the **target colour is the gem it is swapped with**;
- **chaining + cascading** — clearing a colour sweeps up any striped/wrapped of that
  colour, which fire (a red striped caught in "clear all red" blasts its line); the
  expanded clear feeds gravity/refill and cascades;
- **winnable-daily preserving + honestly par'd** — activation shifts scoring and
  legality, so the committed packs regenerate (B0–B2 discipline) and stay winnable.

## Positioning

This game is a **generic** of the match-3 / Candy-Crush mechanic set (roadmap
"Positioning" — acetaminophen to Candy Crush's Tylenol): mechanics mirror the
reference, only branding differs. So the colour bomb's *behaviour* is fixed by the
reference (swap → clear one colour, colourless/unmatchable); the open choices are the
genuine *engineering* forks resolved below.

## Reasoning

- **Trigger is swap-only (the key difference from striped/wrapped).** A reference
  colour bomb is **colourless** — it is not matched by colour and is not fired by a
  line match. Its canonical (and only, in B3) activation is being **swapped** with an
  adjacent gem; the target colour is that gem's colour. So B3 adds `ColorBomb` to
  `fires_on_swap` (legality + the swap seed) but **not** to `fires_on_match` — a
  colour bomb caught in a line match just clears as a gem, it does not detonate.
  - **Representation note (a resolved fork).** Our colour bomb is a `Gem(color)` +
    `ColorBomb` overlay (B0), so it carries an underlying colour — an implementation
    artifact of keeping the match core byte-identical, **not** a play colour. It is
    *possible* (though rare) for that underlying colour to fall into a line match; per
    "colour bombs are colourless" we treat that as an ordinary clear (no detonation).
    Documented as revisable pre-users.
- **Activation is a colour-predicate clear, not a `blast_region`.** Striped/wrapped
  blast a fixed set of positions; a colour bomb clears **every cell holding
  `Gem(target)`** plus its own cell (consumed). So `activate` gains a `bombs:
  &[(Pos, u8)]` input (each firing colour bomb + its target colour), handled
  distinctly from the position-based striped/wrapped queue.
- **Target colour = the swapped gem's colour.** In `resolve_move`, when a step-0 swap
  moves a colour bomb, the target is the colour of the **other** swapped cell
  (post-swap) — i.e. the gem the bomb traded places with. A colour bomb swapped with
  a **special** (another bomb, or a striped/wrapped) is a **combo** (B5): B3 uses the
  other cell's *underlying* colour and fires the bomb only (no combo semantics),
  deferring the true combo matrix.
- **Chaining is one-directional in B3.** A colour bomb's colour-clear sweeps up
  striped/wrapped of that colour → they fire (enqueued into the existing
  striped/wrapped queue, so a wrapped does its double, a striped its line, chaining
  onward). But a colour bomb **caught in another blast or colour-clear** does *not*
  detonate in B3 (it just clears) — a colour bomb fires only from the swap seed. This
  bounds B3: colour-bomb-set-off-by-a-blast and bomb+bomb/bomb+special are B5 combo
  territory. Documented; deferred.
- **No survivor, no pin.** Unlike a wrapped, a colour bomb is consumed on its single
  activation — no pending re-blast, no pinned gravity. Its cleared cells feed normal
  gravity/refill.
- **Scoring stays flat:** +10 per gem cleared (a colour-clear can be ~8–12 gems — a
  big but flat score), +20 per blocker layer. Blockers are never `Gem(target)`, so
  they are untouched by the colour-clear (a blocker adjacent to a cleared gem still
  takes its one layer via T2).
- **Mandatory re-lock, again.** Activation changes swap legality (a colour bomb is
  swappable) and match outcomes, so the solver + `reference_score` diverge →
  regenerate `games/match3/{par,blockers,jelly}-pack.json` **in the same commit** as
  the rule change (B0–B2's lesson). **Run the full gate (`npm run test` +
  `npm run e2e`), not just `cargo test`** — the pack regen can leave hardcoded JS
  fixtures stale (B0.4 lesson).

## Verified Assumptions

- A colour bomb is a `Gem(color)` + `ColorBomb` overlay, created at a line-5's
  dominant cell with the component's colour (`creations_for`, B0). Confirmed by
  reading `engine.rs` + vector 06.
- `fires_on_match` (striped + wrapped) and `fires_on_swap` (striped + wrapped) are
  separate predicates (B2.1). Adding `ColorBomb` to `fires_on_swap` only affects
  legality + the swap seed; leaving it out of `fires_on_match` keeps a matched colour
  bomb inert. Confirmed by reading the predicates.
- `activate` already returns `{ clear, pending }` and drains a striped/wrapped queue
  with chaining; a `bombs` input adds colour cells + chains firing specials into that
  same queue. Confirmed.
- `resolve_move` computes the step-0 swap seed from `[from, to]` filtered by
  `fires_on_swap`; splitting a swapped colour bomb into a `(pos, target)` `bombs`
  list (target = the other cell's colour) is a local change there. Confirmed.
- Pack generators/drills + the e2e/unit fixtures behave as in B0–B2. Confirmed.

## Documentation Impact

- `crates/match3-core/RULES.md` — extend **T1c — Activation** with the colour bomb:
  swap-only trigger, target = the swapped gem's colour, colour-predicate clear +
  consume, one-directional chaining (sweeps up specials of that colour), and the
  "colourless / not match-fired / combos are B5" notes.
- `crates/match3-core/vectors/README.md` — note the colour-bomb vector (swap →
  clear-all-of-a-colour at step 0).
- `TODO/match3.md` + roadmap Track B — tick B3.
- `docs/BUILDING-GAMES.md` — only if a new reusable pattern emerges (unlikely).

## Concurrency Map

All phases sequential — B3.2 depends on the B3.1 core. No parallel set.

## Phases

### Phase 1 (B3.1) — swap-activation core + legality + pack re-lock
**Goal:** swapping a colour bomb with a gem is legal and clears every gem of that
gem's colour (bomb consumed), chaining through specials of that colour, cascading,
deterministic; packs re-locked.
**Changes:**
- [ ] `engine.rs` — `fires_on_swap` += `ColorBomb`; `swap_legal` true when either
  swapped cell is a colour bomb. `resolve_move` step-0: classify a swapped colour
  bomb into `bombs: Vec<(Pos, u8)>` (target = the other swapped cell's gem colour),
  keeping striped/wrapped in `seed`. `activate` gains a `bombs` param: for each, add
  the bomb's cell + all `Gem(target)` cells to the clear set, and enqueue any
  firing (striped/wrapped) special among them so it chains. A colour bomb fires only
  from `bombs` (not matched, not chained) in B3.
- [ ] `RULES.md` — T1c colour-bomb clause (swap-only, target colour, colour-clear,
  chaining, colourless/combos-are-B5).
- [ ] `tests/specials.rs` — swapping a colour bomb clears all of the swapped gem's
  colour + is legal; the bomb is consumed; a striped of that colour caught in the
  clear fires its line (chain); a matched colour bomb does *not* detonate (clears as
  a gem); `legal_swaps` includes the colour-bomb swap.
- [ ] golden vector `13-colorbomb-swap-activate` (locked).
- [ ] regenerate the three packs; confirm 365 winnable + byte-identical drills;
  update any stale JS fixtures.
**Call chain:** `Game::play_move` → `resolve_move` → `activate` (bombs branch).
**Wiring test:** `golden_vectors` over `13`; a `play_move` test asserting a
colour-bomb swap emptied every cell of the target colour.
**Read/Write-set:** engine.rs, RULES.md, tests, vectors/13, games/match3/*.json.
**Validation:** Broad — Rust gate + regen drills + **full** `npm run test` + `e2e`.
**Done when:** colour-bomb swap clears the colour + chains + cascades
deterministically; all three gates green; packs winnable + byte-identical.

### Phase 2 (B3.2) — UI + how-to + docs
**Goal:** the colour detonation reads clearly; how-to describes the power.
**Changes:**
- [ ] `src/games/match3-howto.ts` — the colour bomb now has its power: swap it with
  any gem to clear every gem of that colour. (Colour bomb was the last "power
  arriving" special; after B3 all three single specials are live — fish is B4.)
- [ ] `tests/match3.spec.ts` — greedy-play a deterministic deal until a colour bomb
  is on the board, swap it, assert the score jumps (the colour-clear reaching the UI).
- [ ] roadmap Track B + `TODO/match3.md` — tick B3.
- [ ] regenerate guide shots only if the visuals changed (no new special kind; likely
  none).
**Validation:** Moderate — full `npm run e2e` (both projects, incl. axe).
**Done when:** the colour detonation is visible + documented; e2e green; shots current.

## Open Questions

Resolved by the generic-of-Candy-Crush positioning:
- [CONFIRMED: swap-only] **Trigger** — a colour bomb detonates only when swapped (it
  is colourless, so it is not match-fired); target = the swapped gem's colour.
- [CONFIRMED: no] **Does a matched colour bomb detonate?** No — its underlying colour
  is a representation artifact; a coincidental line match clears it as a gem. Revisable.
- [CONFIRMED: defer] **Colour bomb caught in a blast / bomb+bomb / bomb+special** —
  deferred to B5 (the combo matrix). In B3 a colour bomb fires only from the swap
  seed; caught in a clear it is just consumed.
- [CONFIRMED: swept] **Specials of the target colour** — a striped/wrapped of that
  colour caught in the colour-clear fires (chains) via the existing queue.

## Review Log
### B3 complete — 2026-07-31
Shipped green + deployed: B3.1 `c51fbcc` (swap-activation core + legality + par
re-lock + vector 06 re-lock), B3.2 `<this>` (how-to + e2e + docs). Final gate:
cargo 96, npm test 87, e2e 104 (both projects, incl. axe); golden vector 13 locked.
- **Vector 06 re-locked (expected).** Making the colour bomb swappable turned its
  created-colour-bomb final board from "dead → reshuffled" into "live → no
  reshuffle", so vector 06's final hash moved (step-0 unchanged). Same shape as
  B1.2's reshuffle re-lock — a legality change rippling to the deadlock check.
- **Colour bomb is the first colour-predicate special.** Its activation is not a
  positional `blast_region` but "clear all `Gem(target)`", so `activate` grew a
  `bombs` input rather than a `blast_region` arm, and it is swap-only (colourless →
  excluded from `fires_on_match`). The `bombs` list is transient (swap-seeded per
  move), so no `state_hash` surface.
- **Only par moved (again).** Both the legality change and the colour-clear left the
  blockers/jelly fixture lines byte-identical; only the par table shifted.
- **B4 (fish: a 2×2-square match + seeded `DetRng` targeting) is next** — it changes
  what counts as a *match* and a *legal swap*, so it is the heaviest special phase.

### Pass 1 — 2026-07-31
Plan authored from deep B1/B2 context (same files/patterns). The colour bomb is the
first special whose activation is a **colour predicate**, not a position `blast_region`
— so `activate` gains a `bombs` input rather than a new `blast_region` arm, and the
trigger is swap-only (it is colourless, so it is not added to `fires_on_match`).
Scope bounded to swap-activation (the roadmap's B3 definition); colour-bomb-in-a-blast
and the bomb+bomb/bomb+special combos are B5.
