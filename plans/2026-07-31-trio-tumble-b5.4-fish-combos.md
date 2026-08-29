# Match-3 parity — Track B5.4: fish combos

**Status:** planning (2026-07-31). Parent: `plans/2026-07-30-trio-tumble-b5-combos.md`
(the combo matrix). B5 shipped the striped/wrapped/bomb combos and **deferred fish
combos** (a fish + a special still fired independently). B5.4 closes that gap.

## Problem Statement

Swapping a **fish** with another special should combine, like every other special
pair (RULES.md T1d). Fish combos are the RNG-heavy corner of the matrix — a fish's
power is "swim to a seeded target and eat it" (B4), so a fish combo spawns **several
fish**, each drawing its own target, each carrying the partner's blast. B5.4 must:

- extend the combo dispatch so **both cells being specials** (now including fish)
  triggers a combo (today fish is excluded, so fish + special falls to the
  independent path);
- realize the fish combos deterministically, drawing the extra fish targets from the
  seeded `DetRng` in a **pinned order** folded into `draws`/`state_hash`;
- keep the no-combo path and all of B0–B6 byte-identical; re-lock only what the
  fish-combo change perturbs (expected: par pack, at most).

## Positioning

A generic of the Candy-Crush mechanic set. Fish-combo canon is version-fuzzy (the
reference spawns "a few" fish); the generic picks a fixed, deterministic realization
and documents it revisable pre-users, exactly as B5 did for wrapped+wrapped.

## Decisions (canon-derived + generic-realization latitude, all revisable)

- **N = 3 spawned fish** per fish combo (the commonly-cited reference count). A tunable
  balance knob. Capped at the number of available targets on a small board.
- **fish + fish → 3 fish, plain eat.** Each of the 3 fish draws a distinct target and
  eats it (clears it; a struck special chains). Both source fish consumed.
- **fish + striped → 3 fish, each a striped blast.** Each target additionally fires a
  line in the **partner striped's orientation** (all row for `StripedH`, all column for
  `StripedV`).
- **fish + wrapped → 3 fish, each a 3×3 blast.** Each target additionally fires a 3×3.
- **fish + colour bomb → clear every gem of the fish's colour** (a colour clear; the
  fish supplies the colour, the bomb clears it). Pure (no RNG) — computed in `combo()`
  like the other bomb combos. (Canon "all of the colour become fish" collapses to the
  same cleared set in the generic.)
- **Targets are drawn against the pre-clear board**, distinct (each draw excludes the
  fish sources and previously-chosen targets), in a pinned sequence — the same tier rule
  as B4 (`fish_target`: jellied cells first, else any gem), `rng.index` each. So the N
  draws fold into `draws`/`state_hash` deterministically.

## Reasoning

- **Fish combos can't use the pure `combo()` clear-set** — they consume RNG (target
  draws). So `resolve_move` (which owns `self.rng`) builds them: it detects a fish combo,
  draws the N targets, assembles the clear-set (sources + per-target blast), and wraps it
  in the existing `ComboEffect` fed to `activate`. `fish + bomb` is the exception — a pure
  colour clear with no RNG, so it stays in `combo()`.
- **Reuse the B5 plumbing.** The clear-set still flows through `activate` as a
  `ComboEffect` (sources marked fired, bystander specials chain) — no new activation
  surface, just a new *builder* for the fish case. `apply_gravity`/refill/cascade are
  unchanged.
- **Chaining is free.** A drawn target holding a real striped/wrapped chains via the
  existing queue; the spawned "fish" are not materialized specials (direct clear-set),
  matching the B5.2 colour-transform realization.
- **Determinism.** Integer `rng.index` draws in a fixed sequence; a stable, pinned target
  rule → bit-identical on every build target, like B4.

## Verified Assumptions

- `fish_target(board, pos, rng)` already picks a seeded target (jelly-tier then gem-tier,
  `rng.index`). B5.4 generalizes it to draw **N distinct** targets excluding a set.
  Confirmed by reading `engine.rs`.
- The combo dispatch (`classify_step0`/`is_combo_side`) currently **excludes** fish;
  moving the fish-combo build into `resolve_move` (where `self.rng` lives) lets fish join.
  Confirmed.
- `ComboEffect { clear, sources }` + `activate`'s combo handling already clear a source
  set and chain bystanders — reusable for fish combos verbatim. Confirmed (B5).

## Documentation Impact

- `RULES.md` T1d — a "fish combos" subsection (the four fish rows, N=3, the pinned target
  draw order, fish+bomb colour clear).
- `vectors/README.md` — the fish-combo vectors.
- `TODO/trio-tumble.md` + roadmap Track B — note fish combos done (the last combo gap).
- `src/games/trio-tumble-howto.ts` — a line on fish combos.

## Phases

### Phase 1 (B5.4a) — core + vectors + re-lock
- [ ] `engine.rs` — `fish_combo_targets(board, exclude, rng, n)` (N distinct seeded
  targets); extend `combo()` for **fish + bomb** (colour clear); a `resolve_move`
  fish-combo branch that draws targets and builds the `ComboEffect` for
  fish+fish/striped/wrapped; extend the dispatch so both-specials (incl. fish) is a combo.
- [ ] `RULES.md` T1d fish combos + hash note (draws advance).
- [ ] `tests/combos.rs` — fish+fish eats 3 distinct targets; fish+striped fires 3 lines;
  fish+wrapped 3 blasts; fish+bomb clears the fish colour; deterministic (two replays
  match; folds into hash); fish + plain gem is still the independent B4 path (guard).
- [ ] golden vectors `21`–`24` (fish combos), locked.
- [ ] regenerate packs; report which moved; full Rust gate.

### Phase 2 (B5.4b) — how-to + e2e + docs
- [ ] `match3-howto.ts` — fish combos line.
- [ ] `tests/match3.spec.ts` — drive a fish combo (probe a seed) + assert a big clear.
- [ ] roadmap + `TODO/trio-tumble.md`; regenerate guide shots if visual (no new badge — none
  expected). Full `npm run test` + `e2e`.

## Open Questions

- [CONFIRMED: N=3, revisable] spawned-fish count (canon-derived).
- [CONFIRMED: colour clear, revisable] fish + colour bomb.
- [CONFIRMED: pre-clear board, distinct, pinned tier] target draw order.
- [DEFERRED] a fish combo *chaining into another fish combo* stays a plain chain (a
  struck fish just clears; only a swapped/matched fish draws a target) — consistent with
  B4's "a fish caught in a blast just clears".

## Review Log
### B5.4 complete — 2026-07-31
Shipped green: core (dispatch now includes fish; `fish_combo_clear` draws N=3 distinct
targets via a generalized `fish_target_excluding`; `combo()` gained the fish+bomb colour
clear) + how-to + a fish-combo e2e + docs. Golden vectors 21–23 (recorded step0, like the
B4 fish). Full gate: cargo core+solver (incl. byte-identical par drill), npm 107, e2e 138.
- **Reused the B5 `ComboEffect` plumbing.** The only structural change: fish combos need
  RNG (target draws), so `classify_step0` took a `&mut DetRng` and the fish path draws
  there; pure combos (incl. fish+bomb) still come from `combo()`. `activate` unchanged.
- **The B5.1 "does-not-combo-yet" guard test was deleted** — it documented the deferral,
  now false; superseded by the real fish-combo tests (log outcomes, not the journey).
- **Par re-locked, moved both ways.** The specials-exploiting 3★ player now routes fish
  into combos, so its beam re-prunes: 3★ rose on 117 seeds and fell on 71 (mean +88 vs
  B6.2), all within the invariant (specials ≥ beam ≥ greedy; tiers strictly increasing).
- **N=3 spawned fish** is the one canon-derived magic number — a tunable knob, handed to
  Track C alongside the `special_potential` weights. Fish-combo-into-fish-combo chaining
  stays a plain clear (a struck fish just clears), consistent with B4.
- The combo matrix is now **complete** (striped/wrapped/bomb/fish). Track B is fully done.

### Pass 1 — 2026-07-31
Plan authored to close the one deferred combo. The crux is that fish combos consume RNG
(target draws), so unlike the B5 pure `combo()` they are built in `resolve_move` and fed
through the existing `ComboEffect`. N=3 + the fish-combo realizations are canon-derived and
documented revisable, consistent with the wrapped+wrapped / colour-transform latitude.
