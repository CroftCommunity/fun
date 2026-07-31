# Match-3 parity — Track B5: the combo matrix (special + special by swap)

**Status:** planning (2026-07-31). Parent: `plans/2026-07-30-match3-parity-roadmap.md`
(Track B / B5). Builds on B0–B4 (the special overlay + creation + striped/wrapped/
colour-bomb/fish activation). B5 adds **combos**: swapping **two** specials together
produces an effect larger than firing each — the last big specials phase, and where
specials finally interact by design.

## Problem Statement

Candy-Crush parity (roadmap D4 / B5) needs the **combo matrix**. Today
`resolve_move`'s step-0 classification fires each swapped special **independently**
(`seed` / `bombs` / `swapped_fish`), so swapping a striped onto a wrapped just fires a
line and a 3×3 side by side. B5 must **detect that both swapped cells are specials**
and dispatch a single combined effect instead, per Candy-Crush canon:

- **striped + striped → a cross:** the full row **and** full column through the swap
  cell.
- **striped + wrapped → a thick cross:** a 3-wide row band **and** a 3-wide column
  band through the swap cell.
- **wrapped + wrapped → a 5×5 blast** around the swap cell.
- **colour bomb + striped → every gem of the partner's colour fires a striped:** the
  union of each such cell's full row + full column.
- **colour bomb + wrapped → every gem of the partner's colour fires a wrapped:** the
  union of each such cell's 3×3.
- **colour bomb + colour bomb → clear the entire board** (every gem cell).

…while staying deterministic (the combo is a new, verifiable surface folded into the
existing cascade), keeping modes winnable-daily + honestly par'd, and leaving the
single-special path (all of B0–B4, heavily vector-locked) **byte-identical**.

## Positioning

A generic of the match-3 / Candy-Crush mechanic set (roadmap "Positioning"): the combo
**behaviours** mirror the reference exactly. What is an **engineering** choice — how the
combo slots into the deterministic core, and how the "turn a colour into stripes then
fire" combos are realized — is decided on its merits (owner, 2026-07-31, below), since
the reference does not dictate an internal implementation.

## Decisions locked (owner, 2026-07-31)

Three engineering forks were surfaced and decided before build:

- **Combo plumbing = a `combo()` classifier feeding `activate`.** A pure
  `combo(a_kind, b_kind, colors_of_partner, center) -> Vec<Pos>` (the combo clear-set)
  is computed in `resolve_move` step-0 when both swapped cells are specials, and fed
  into `activate` as a **new input** (`combo_clear`), mirroring exactly how B3 threads
  `bombs` and B4 threads `fish_targets`. `activate` and the no-combo path stay
  byte-identical; the combo is an isolated determinism surface. Chosen over branching
  inside `activate` (which would grow the vector-locked single-special path's risk).
- **Colour-bomb transform = a direct equivalent clear-set.** bomb+striped / bomb+wrapped
  do **not** materialize intermediate special candies; the combo computes the union
  directly (each partner-colour cell's row+column for striped; each cell's 3×3 for
  wrapped). Deterministic, order-free, and outcome-identical to canon. A real firing
  special caught in the union still **chains** (it is scanned like a blast cell).
- **Fish combos deferred to a follow-up (B5.4/later).** B5 ships the six
  striped/wrapped/bomb combos. If **either** swapped cell is a `Fish`, there is **no
  combo** — the existing independent path runs (the fish draws its seeded target, the
  other special fires its blast), exactly today's behaviour. Fish combos get their own
  RNG-aware phase.

## Reasoning

- **Dispatch, don't rewrite.** The combo only triggers when both swapped cells hold a
  **non-fish** firing special. Everything else — every existing move, every B0–B4
  vector, every pack — takes the unchanged path. This is the same containment that let
  B1–B3 add activation without re-locking the pre-specials corpus: a new effect is
  *seeded* into `activate`, it does not restructure it.
- **The combo center is the destination cell `to`.** After the swap the two specials sit
  at `from` and `to`; the combo is centered on `to` (the moved candy's landing —
  Candy-Crush "at the moved candy", consistent with creation placement). Both `from` and
  `to` are consumed. Because `from`/`to` are orthogonally adjacent, the cross / thick
  cross / 5×5 centered on `to` always contains `from` too, so both specials clear.
- **Combos produce no survivor / re-blast.** Unlike a lone wrapped (which survives its
  first blast and is pinned — B2), a combo consumes **both** specials, so `activate`'s
  `pending` set stays empty for combos and there is no re-blast carry. This is why
  wrapped+wrapped is realized as a **single 5×5** clear (below), not a pinned double.
- **wrapped+wrapped = a single 5×5 (revisable realization).** Canon's wrapped+wrapped
  "explodes twice" catches candies that fall in between the two blasts. Our generic
  clears the 5×5 once — the honest, tractable, deterministic realization given both
  candies are consumed (no center survives to re-blast from). Flagged revisable
  pre-users, like B2's "survive+pin" and B4's fish-tier narrowing.
- **bomb+bomb clears every gem; blockers take one adjacency layer.** Consistent with
  every other blast in the engine (`blast_region`/`activate` never clear a blocker —
  `clear_cells` chips it by one layer via adjacency). "Clear the entire board" therefore
  means every `Gem` cell → `Empty`; a blocker surrounded by cleared gems loses its one
  layer. A recommended consistency call, not a canon question.
- **Chaining is free.** Feeding the combo clear-set through `activate` as blasted cells
  means any **real** firing special the combo sweeps up (a striped/wrapped elsewhere on
  the board, not the combo pair) fires via the existing chain queue — the same set-union
  the single-special blasts already use. Deterministic, order-independent.
- **Scoring stays flat:** +10 per gem cleared, +20 per blocker layer (T2). bomb+bomb
  scores the whole board; large but honest.
- **Pack re-lock is possible, not certain.** Combos do **not** change the deal
  (`fill_no_initial_match` is untouched) or swap **legality** (swapping a special was
  already legal via `fires_on_swap`, so swapping two specials was already legal). But
  they change the **outcome** (score) of a move that swaps two adjacent specials — so a
  reference/solver playout that ever picks such a swap shifts. Regenerate all three packs
  in the same commit as each rule change and **report** which moved (expect at most
  `par-pack`; blockers/jelly deals are unchanged, so their deal-derived JS fixtures stay
  put). Run the **full gate**, not just cargo.

## Verified Assumptions

- `resolve_move` step-0 already classifies each swapped special independently into
  `seed` / `bombs` / `swapped_fish` (engine.rs ~L1093). The combo dispatch is a branch
  there: if both `from` and `to` hold a non-fish firing special, compute the combo and
  skip the independent classification for those two cells. Confirmed by reading
  `resolve_move`.
- `activate` already takes seed inputs (`seed`, `reblast`, `bombs`, `fish_targets`) and
  expands them into `to_clear` with chaining. Adding a `combo_clear: &[Pos]` input that
  inserts each cell into `to_clear` and queues any firing special on it is a local,
  additive extension mirroring the `fish_targets` loop. Confirmed.
- Swapping two adjacent specials is **already legal** (`swap_legal` returns true if
  `fires_on_swap` holds on either endpoint), so no legality change is needed — only the
  outcome changes. Confirmed by reading `swap_legal`.
- No existing golden vector (01–14) swaps two specials, and the no-combo path is
  byte-identical, so **no pre-B5 vector re-locks**. New vectors (15+) cover the combos.
  Confirmed by scanning `vectors/`.
- `SpecialKind` needs **no new variant** — combos consume existing kinds and clear cells;
  the state-hash tag table is unchanged. Confirmed (board.rs / hash.rs).

## Documentation Impact

- `crates/match3-core/RULES.md` — a new **T1d — Combos (special + special by swap)**
  section: the dispatch rule (both non-fish specials → combo, else independent), the six
  combo clear-sets (center = `to`), the wrapped+wrapped single-5×5 and bomb+bomb
  blocker-adjacency realizations, chaining, and the fish-defer note. A pointer from T1c.
- `crates/match3-core/vectors/README.md` — the combo vectors (15+) and the "swap two
  pre-placed specials" authoring shape.
- `TODO/match3.md` + roadmap Track B — tick B5.
- `src/games/match3-howto.ts` + `docs/BUILDING-GAMES.md` — a combo how-to entry; note the
  combo determinism surface if it generalizes.

## Concurrency Map

Sequential. B5.2 reuses the `combo()` classifier + `combo_clear` plumbing from B5.1;
B5.3 needs both. Within a phase, RED→GREEN→REFACTOR per combo.

## Phases

### Phase 1 (B5.1) — striped/wrapped combos + the combo plumbing + re-lock
**Goal:** swapping two of {striped, wrapped} produces the canon combined blast via a
`combo()` classifier fed into `activate`; deterministic; the no-combo path byte-identical;
vectors locked; packs regenerated + reported.
**Changes:**
- [ ] `engine.rs` — `combo(a, b, center, board) -> Vec<Pos>` for the three
  striped/wrapped pairs (cross / thick cross / 5×5, clamped, blockers excluded like
  `blast_region`); `activate` gains a `combo_clear: &[Pos]` input (insert + chain any
  firing special); `resolve_move` step-0 detects "both non-fish specials" and routes them
  to `combo_clear`, skipping their independent classification.
- [ ] `RULES.md` — T1d (dispatch + the three clear-sets + center=`to` + chaining +
  wrapped+wrapped single-5×5 realization + fish-defer).
- [ ] `tests` — striped+striped clears the cross; striped+wrapped the thick cross;
  wrapped+wrapped the 5×5; a combo chains a third special it sweeps up; the two combo
  specials are consumed; **a single-special swap is unchanged** (guard); determinism
  (two replays match; the result is in the hash).
- [ ] golden vectors `15-combo-striped-cross`, `16-combo-striped-wrapped`,
  `17-combo-wrapped-5x5` (locked).
- [ ] regenerate all three packs; confirm 365 winnable + byte-identical drills; **report**
  which packs moved; re-derive any stale JS fixture / e2e seed the pack change perturbs
  (expect none — deal unchanged).
**Validation:** Rust gate + regen drills + **full** `npm run test` + `e2e`.
**Done when:** the three striped/wrapped combos fire the canon blast + chain; single-special
play unchanged; all gates green; packs winnable + regenerable + reported; vectors locked.

### Phase 2 (B5.2) — colour-bomb combos incl. bomb+bomb = clear board + re-lock
**Goal:** the three colour-bomb combos via the same plumbing (direct equivalent
clear-set); deterministic; packs re-locked.
**Changes:**
- [ ] `engine.rs` — extend `combo()`: bomb+striped = ∪ each partner-colour cell's
  row+column; bomb+wrapped = ∪ each partner-colour cell's 3×3; bomb+bomb = every gem cell.
  Partner colour = the non-bomb special's underlying colour (bomb+bomb ignores colour).
  Both combo cells consumed; blockers excluded from the clear-set (adjacency-chipped via
  `clear_cells`).
- [ ] `RULES.md` — T1d colour-bomb combos (the direct clear-sets, partner colour,
  bomb+bomb board-clear + blocker adjacency).
- [ ] `tests` — bomb+striped clears every row+column of the partner colour; bomb+wrapped
  every 3×3; bomb+bomb clears all gems (blocker chipped one layer, not nuked); chaining;
  determinism/hash.
- [ ] golden vectors `18-combo-bomb-striped`, `19-combo-bomb-wrapped`,
  `20-combo-bomb-bomb` (locked).
- [ ] regenerate packs; report; re-derive stale fixtures if any.
**Risks:** bomb+bomb clears the whole board → a big score; confirm the reference/solver
regen still asserts 365 winnable. Keep the no-combo path identical (pre-B5 vectors guard).
**Validation:** Broad — full gate + regen drills.
**Done when:** the three bomb combos fire per canon incl. board-clear; all gates green;
packs winnable + byte-identical-or-reported.

### Phase 3 (B5.3) — UI + how-to + docs
**Goal:** combos read clearly; how-to teaches "swap two specials to combine"; docs synced.
**Changes:**
- [ ] `src/games/match3-howto.ts` — a combo section (swap two specials → a bigger clear;
  bomb+bomb clears the board).
- [ ] `tests/match3.spec.ts` — e2e drives a combo (probe a seed whose greedy line makes
  two adjacent specials, or author via a fixed setup) + asserts a large score/clear; both
  projects incl. axe.
- [ ] roadmap + `TODO/match3.md` tick B5; regenerate guide shots if the combo renders a new
  visual (likely no new badge — combos use existing candies).
**Validation:** Moderate — full `npm run e2e` (both projects, incl. axe).
**Done when:** the combo is documented + e2e-driven; shots current; docs reflect reality.

## Open Questions

Resolved by the generic-of-Candy-Crush positioning + the owner decisions above:
- [CONFIRMED: classifier→activate] Combo plumbing (owner 2026-07-31).
- [CONFIRMED: direct clear-set] Colour-bomb transform (owner 2026-07-31).
- [CONFIRMED: defer] Fish combos → a later RNG-aware phase; fish+special falls back to
  independent firing (owner 2026-07-31).
- [CONFIRMED: single 5×5, revisable] wrapped+wrapped realization (no survivor to re-blast;
  revisable pre-users — the generic clears the 5×5 once). Flagged for review at B5.1.
- [CONFIRMED: clear gems + blocker adjacency, revisable] bomb+bomb blocker semantics
  (consistent with every other blast). Flagged for review at B5.2.
- [DEFERRED to B6] Specials-/combos-aware solver + par re-tune once the matrix lands.

## Review Log
### B5 complete — 2026-07-31
Shipped green + deployed: B5.1 `6206825` (striped/wrapped combos + the `combo()`→
`activate` plumbing), B5.2 `614d00f` (colour-bomb combos incl. bomb+bomb), B5.3 `<this>`
(how-to + combo e2e + docs). Final gate: cargo core+solver (incl. byte-identical regen
drills), npm test 96, e2e 122 (both projects incl. axe). Golden vectors 15–20 locked.
- **Containment held — no pre-B5 vector re-locked.** The combo path only triggers when
  both swapped cells are non-fish specials, and it *seeds* `activate` (a new
  `ComboEffect`) rather than restructuring it, so all of B0–B4 stayed byte-identical.
  The only churn was the **par pack**, twice: B5.1 and B5.2 each shifted the beam 3★ for
  the handful of seeds whose greedy/beam line swaps two adjacent specials (blockers/jelly
  deals unchanged → their packs + JS fixtures untouched, unlike B4).
- **`play()` returns a status, not a report.** The combo e2e measures the blast by its
  **score jump** (a cross ≈ 150 vs a plain match's 30), not a cleared-cell count — the
  wasm `play_swap` binding returns only a `MoveStatus`.
- **Seed 45 gives a natural two-adjacent-striped combo.** A throwaway probe over
  first-legal-move play found seed 45 brings two `StripedV` together by step 5 and holds
  them — the e2e plays to that state and fires the combo (the same "re-probe a magic seed"
  pattern B4 used for its special e2e tests).
- **Two realizations flagged revisable** (documented in RULES T1d, decided under the
  generic-of-Candy-Crush latitude): wrapped+wrapped is a single 5×5 (both consumed → no
  centre to pin/re-blast), and the colour-bomb transforms fire each colour cell once.
- **B6 (specials-/combos-aware solver + par re-tune) is next** — the packs currently keep
  specials optional in the winnability requirement; B6 teaches the solvers about specials
  and re-tunes the par ladder with the full matrix in hand.

### Pass 1 — 2026-07-31
Plan authored after surfacing the three engineering forks (combo plumbing, colour-bomb
transform representation, fish-combo scope) and the owner deciding all three toward the
containment-preserving option: a `combo()` classifier that *seeds* `activate` (never
restructures it), a direct equivalent clear-set (no materialized transient specials), and
deferring fish combos. Phased B5.1 (striped/wrapped) → B5.2 (colour-bomb incl. board-clear)
→ B5.3 (UI/how-to) so the plumbing lands once and the heaviest combo (bomb+bomb) is its own
green checkpoint. Two realization simplifications (wrapped+wrapped single-5×5; bomb+bomb
clears gems + chips blockers) are documented revisable-pre-users, mirroring B2/B4.
