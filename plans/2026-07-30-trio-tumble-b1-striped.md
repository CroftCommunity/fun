# Match-3 parity — Track B1: striped-candy activation

**Status:** planning (2026-07-30). Parent: `plans/2026-07-30-trio-tumble-parity-roadmap.md`
(Track B / B1). Builds on B0 (`plans/2026-07-30-trio-tumble-b0-specials.md`): striped
candies are already **created** (line-4 → `StripedH`/`StripedV`) and rendered;
B1 makes them **activate** — fire their line blast — and re-locks the data the
new scoring/legality shifts.

## Problem Statement

A striped candy created in B0 is inert: it sits on the board and clears like a
plain gem. Candy-Crush parity needs it to **blast** — when triggered, a striped
candy clears its whole row (`StripedH`) or column (`StripedV`), and that blast
can hit other specials, chaining. B1 must make activation:

- **deterministic and ordered** — the blast set and its chain are re-derived
  identically at verify time (same `state_hash`), on every device;
- **triggerable two ways** (Candy Crush): a striped candy **matched** in a
  line-3+ fires as it clears, and a striped candy **swapped** with a neighbour
  fires even when the swap forms no line match (which makes the swap legal);
- **cascading** — blast → clear → gravity → refill → possibly more matches,
  through the existing loop;
- **winnable-daily preserving + honestly par'd** — activation shifts scoring and
  legality, so the committed packs regenerate (as in B0.3) and stay winnable.

## Reasoning

- **Blast orientation (finalising B0 Q4, revisable pre-users):** `StripedH`
  (from a horizontal match) clears its **row**; `StripedV` clears its **column**
  — stripe orientation = clear orientation, the intuitive reading, already
  documented in `RULES.md`. Candy-Crush lore is genuinely split on this and it is
  a free knob (no users), so we keep the internally-consistent choice and note it
  revisable rather than assert a canon we cannot verify.
- **Two triggers, both Candy-Crush-faithful** ("do whatever Candy Crush does"):
  - **Match-activation** (B1.1): a striped candy that is part of the matched set
    (being cleared by a line match) fires. Self-contained — only the clear/cascade
    step changes; swap legality is untouched.
  - **Swap-activation** (B1.2): swapping a striped candy with any adjacent gem is
    **legal even with no line match**, and fires the striped. This changes
    `swap_legal`/`legal_swaps`/`has_legal_move` (new legal moves appear where a
    special sits), which ripples to reshuffle/deal/winnability — the riskier,
    determinism-sensitive half, so it is its own phase after match-activation
    works.
- **Chaining via BFS** (deterministic): activation expands the cleared set. A
  blast cell that holds another (not-yet-fired, non-just-created) special fires
  too, enqueued and drained in a fixed order (scan order of discovery). This
  terminates (each special fires at most once) and is device-independent.
- **Just-created specials are protected.** A special created *this step* (B0's
  survivors) is not cleared or fired by a simultaneous blast — it survives to be
  used later. This avoids the create-then-destroy paradox and keeps creation and
  activation composable. (Special-meets-special *by swap* is the combo matrix, B5;
  B1 does not do combos.)
- **Blast semantics (documented, flat, revisable):** a striped blast clears every
  gem/special cell in its line to `Empty` (chaining as above); a blocker in the
  line takes **one** layer of damage (the blast "hits" it, mirroring T2's
  at-most-one-per-step); jelly under a blasted gem cell scrubs one layer. Scoring
  stays flat: +10 per gem cleared (incl. blast-cleared), +20 per blocker layer.
- **Mandatory re-lock, again.** Activation changes match outcomes and (B1.2) swap
  legality, so `reference_score`/`_beam`/`random_score` and the solver diverge →
  regenerate `games/trio-tumble/{par,blockers,jelly}-pack.json` in the same commit as
  each rule change (B0's lesson). **Run the full gate (`npm run test` +
  `npm run e2e`), not just `cargo test`, before committing a pack re-lock** — B0.4
  showed the Rust gate alone misses stale hardcoded e2e/unit fixtures.

## Verified Assumptions

- Creation + the cascade loop live in `resolve_move`
  (`crates/trio-tumble-core/src/engine.rs`), which already computes `creations_for`
  before `clear_cells` and threads the swap + step index (B0.3). Activation slots
  in there.
- `clear_cells` counts gems/blocker-layers/jelly from a cell set; a striped blast
  is "more cells in the set", so activation is largely "expand the set before
  clearing" + protect creation cells. Confirmed by reading `engine.rs` (B0 work).
- Specials are a `Gem(color)` + `special` overlay; `special_at`/`set_special`
  exist; the blast reads `special_at` to find its own orientation and to detect
  chain targets. Confirmed (B0.1).
- Pack generators/drills + the e2e/unit fixtures behave exactly as in B0.3/B0.4
  (same files, same commands).

## Documentation Impact

- `crates/trio-tumble-core/RULES.md` — a new **T1c — Activation** section (trigger
  rules, blast region, chaining order, creation-protection, blocker/jelly
  interaction); the B0 "activation is B1+" forward-references resolve to it.
- `crates/trio-tumble-core/vectors/README.md` — note activation in the step-0
  expectations (a matched striped clears its whole line at step 0).
- `TODO/trio-tumble.md` + roadmap Track B — tick B1.
- `docs/BUILDING-GAMES.md` — only if a new reusable pattern emerges (likely not).

## Concurrency Map

All phases sequential — each writes `engine.rs` + `RULES.md` and the later
phases depend on the activation engine the earlier ones build. No parallel set.

## Phases

### Phase 1 (B1.1) — match-activation core + pack re-lock
**Goal:** a striped candy cleared by a line match fires its row/column blast,
chaining through other specials, cascading, deterministic; packs re-locked.
**Changes:**
- [ ] `engine.rs` — an `activate(board, matched, protected) -> BTreeSet<Pos>`
  that BFS-expands the matched set by striped blast regions (row/col), chaining
  on specials, skipping `protected` (just-created) cells; wire it into
  `resolve_move` between `creations_for` and `clear_cells` (clear the expanded
  set; creations still restored + protected; scoring over the expanded gem count).
- [ ] `RULES.md` — T1c Activation (match trigger, blast region, chain order,
  protection, blocker/jelly).
- [ ] `tests/specials.rs` / `shapes.rs` — a matched striped clears its whole line;
  a blast chaining into a second striped fires both; a just-created special is not
  blasted; blocker/jelly-in-blast behave.
- [ ] golden vectors `08-striped-activate-row`, `09-striped-chain` (locked).
- [ ] regenerate the three packs; confirm 365 winnable + byte-identical drills.
**Call chain:** `Game::play_move` → `resolve_move` → `activate` → `clear_cells`.
**Wiring test:** `golden_vectors` over `08`/`09`; a `play_move` test asserting a
matched striped emptied its row.
**Read/Write-set:** engine.rs, RULES.md, tests, vectors/08–09, games/trio-tumble/*.json.
**Validation:** Broad — Rust gate + regen drills + **full** `npm run test`+`e2e`.
**Done when:** matched striped fires + chains + cascades deterministically; all
three gates green (cargo, npm test, e2e); packs winnable + byte-identical.

### Phase 2 (B1.2) — swap-activation (legal without a match) + pack re-lock
**Goal:** swapping a striped with any adjacent gem is legal and fires it.
**Changes:**
- [ ] `engine.rs` — `swap_legal` also true when either swapped cell holds a
  special (the swap fires it); `resolve_move` detects a swapped special that
  formed no line match and seeds activation from it; `legal_swaps`/`has_legal_move`
  follow automatically. Keep the no-special path byte-identical.
- [ ] `RULES.md` — T1c swap-trigger clause + the legality change.
- [ ] tests — swapping a striped into a non-matching spot fires it + is legal;
  `legal_swaps` includes special swaps; a board that is dead for plain gems but
  has a special is not "dead".
- [ ] golden vector `10-striped-swap-activate` (locked); regenerate packs.
**Risks:** legality change re-locks packs and can shift winnability a lot (a
special is always swappable). Log any seed that drops. This is the determinism-
sensitive phase — keep the plain-gem path identical (guarded by the untouched
pre-specials vectors).
**Validation:** Broad — full gate + regen drills.
**Done when:** swap-to-fire works + is legal, plain-gem play unchanged, all gates
green, packs winnable + byte-identical.

### Phase 3 (B1.3) — UI + how-to + guide shots
**Goal:** activation reads clearly in the UI; how-to describes the striped power.
**Changes:**
- [ ] `src/games/trio-tumble*.ts` — the traced animation already steps through the
  post-blast frames (the blast is just a bigger clear); confirm the settled render
  is correct. Optionally a brief blast flash (reduced-motion-safe). Update the
  how-to: a striped candy clears its row/column; make one by matching four; fire
  it by matching or swapping it.
- [ ] e2e — drive a striped activation and assert the row/column emptied.
- [ ] regenerate guide shots if the visuals changed.
**Validation:** Moderate — full `npm run e2e` (both projects, incl. axe).
**Done when:** activation is visible + documented; e2e green; shots current.

## Open Questions

Resolved by "do whatever Candy Crush does" + the no-users free-knob latitude:
- [CONFIRMED: row/col by stripe] **Blast orientation** — `StripedH`→row,
  `StripedV`→column (as B0 documented); revisable pre-users.
- [CONFIRMED: include] **Swap-activation in B1** — yes (B1.2); Candy Crush's main
  way to use a striped is to swap it. Kept as its own phase for the legality risk.
- [CONFIRMED: protect] **Just-created special hit by a simultaneous blast** —
  survives (not fired/cleared this step); special-by-swap combos are B5.

## Review Log
### B1 complete — 2026-07-30
Shipped green + deployed: B1.1 `96e600e` (match-activation + packs), B1.2
`519ee0b` (swap-activation + reshuffle desync fix + vector re-locks), B1.3
`<this commit>` (how-to + e2e + docs). Final gate: cargo 117, npm test 84, e2e 84
(both projects, incl. axe), regen drills byte-identical.
- **Bug found during B1.2 (worth remembering):** the swap and `reshuffle_if_dead`
  both permuted gems without carrying the `special` overlay — a latent desync
  shipped in B0 (only caught because swap-activation changed vector 04's
  reshuffle path). The B0.3 integration test checked the *pre-gravity* frame, so
  it missed the post-reshuffle desync. Lesson: for overlay state, assert the
  *settled* board, and any op that moves gems (swap, gravity, reshuffle) must
  move the overlay in lockstep.
- **B2 (wrapped 3×3 activation) is next.**

### Pass 1 — 2026-07-30
Plan authored from deep B0 context (no separate gap pass needed — same files,
same patterns as B0.3/B0.4). Key carried-forward lesson baked into every rule-
changing phase: regenerate packs in-commit and run the **full** gate, not just
cargo.
