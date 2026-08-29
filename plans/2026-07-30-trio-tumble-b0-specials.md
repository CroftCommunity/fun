# Match-3 parity — Track B0: special-gem model + shape detection

**Status:** planning (Pass 1+2 done, 2026-07-30). Parent program:
`plans/2026-07-30-trio-tumble-parity-roadmap.md` (Track B / B0). Core rules:
`crates/trio-tumble-core/RULES.md`. Standards: `docs/BUILDING-GAMES.md`.

This plan decomposes the roadmap's single **B0** phase into TDD-sized,
green-per-commit sub-phases. B0 is the foundation of the specials long pole:
the special-gem representation, shape detection/classification, deterministic
creation-placement, the `state_hash` extension, and re-locked data. **No
activation** — a created special is inert (it still matches/falls/clears as its
colour); its blast lands in B1–B4.

## Problem Statement

match-3 today models only plain gems, single-layer blockers, and a jelly
overlay. Candy-Crush parity needs **special gems** — striped (from a line-4),
wrapped (from an L/T), colour-bomb (from a line-5), and the 2×2 fish — created
when a match forms a qualifying shape. B0 must:

1. Represent a special gem in the core so it is part of the verifiable
   fingerprint (`state_hash`), identically on every device, forever.
2. Classify a match into its shape (line-3 / line-4 / L-or-T / line-5), which
   the current `find_matches` (a flat set of cells, no run structure) cannot do.
3. Create the corresponding special at a **deterministic** placement cell when a
   qualifying match resolves, clearing the rest of the match normally.
4. Extend `state_hash` so a special is folded in **only when present** — a
   gem-only board must hash exactly as it does today (the jelly precedent), so
   existing golden vectors do not re-lock.
5. Keep every existing mode green: target-score, clear-the-blockers,
   clear-the-jelly, and solitaire, plus both e2e projects.

**Constraints:** determinism is the anchor (new state → hash → RULES.md →
re-locked/explained data); the board UI never decides legality/win; the binding
never panics; `pond-outcome` stays additive; commit + push per stable point
(auto-deploys to `fun.croft.ing`); docs stay in sync.

**Blast-radius fact (verified, see Verified Assumptions):** creating a special
changes the outcome of any 4+/L/T match (one matched cell survives as a special
instead of clearing → score −10 on that match and a divergent post-cascade
board). That shifts `reference_score` / `reference_score_beam` / `random_score`,
so the committed **par table** (and, via replay divergence, likely the
blockers/jelly packs) must be **regenerated** under the new rules. This is the
"hash churn" risk the roadmap flagged, and it is mandatory work in B0, not B6.

## Reasoning

### Representation: a parallel special-overlay layer (not a `Cell` variant)

The roadmap leaves this open ("`Cell` gains special kinds, or a parallel special
layer"). **Recommendation: a parallel overlay**, mirroring jelly:
`Board` gains a `special: Vec<SpecialKind>` grid (default `None`), where a
special candy is a normal `Cell::Gem(color)` whose overlay marks it striped /
wrapped / colour-bomb / fish.

Why the overlay wins for this codebase:

- **A special *is* its colour for movement, matching, and legality.** In Candy
  Crush a striped candy of colour 3 still matches other 3s, is swappable, and
  falls. Keeping the base cell `Gem(color)` means `find_matches`, `same_gem`,
  `swap_legal`, `legal_swaps`, `has_legal_move`, and `reshuffle_if_dead` stay
  **byte-identical with zero edits** — the determinism-critical match/legality
  path is untouched. This is the single biggest risk reducer: those functions
  are exactly where a subtle change becomes a cross-device determinism bug.
- **Reuses the proven jelly pattern** the codebase already reasons in: an
  overlay grid, hashed append-only-when-present, authored via a
  `from_rows_with_*` helper, exposed in `BoardView` as a parallel grid, rendered
  as a backing/badge in the UI. Less novel surface.
- **Hash cleanliness.** Same "append a section only when some cell carries it"
  rule as jelly (`RULES.md` "State hash"): a gem-only board emits no special
  section and hashes identically → existing vectors need no re-lock.

Why not the `Cell::Special { color, kind }` variant: it is more "Rust-idiomatic"
(illegal states unrepresentable — a special can never accidentally be a blocker)
but it forces edits to every determinism-critical match/legality/gravity site
(`same_gem` must treat `Special(x)` as colour `x`; `is_gem` must include
specials so they fall and are swappable; the gravity/reshuffle filters change).
Each edit is a chance to change what counts as a match or a legal swap and thus
break determinism. The overlay confines change to clear / gravity-carry /
creation / hash / rendering and leaves the match/legality core alone. The
overlay's one weakness — it can *represent* a marker on a non-gem cell (illegal
state) — is contained by a single invariant: the marker is set only where the
cell is a `Gem`, and is zeroed on clear/refill (asserted in tests).

This is an architecture decision worth recording — invoke the **adr** agent
during Phase 1 to write it up (the plan references the ADR).

### Shape classification needs run structure

`find_matches` returns the flat *union* of matched cells (correct for the clear
step, and it must stay that way). Classification needs to know *which cells form
which run* and whether two runs intersect. B0 adds a **run-structured** detector
(`find_runs` → the maximal horizontal and vertical runs of ≥3) built from the
same scan, and a `classify` step over runs. `find_matches`'s existing flat
output is preserved unchanged (it can even be re-expressed as the union of
`find_runs`, but only if that is proven byte-identical — see Phase 0 D2;
otherwise leave `find_matches` alone and add `find_runs` alongside).

Shape rules (finalised in RULES.md; provisional here, tunable pre-users):

- **line-3** → plain (no special; clears as today).
- **line-4** (a single run of exactly 4) → **striped**, oriented by the run:
  a horizontal run → `StripedH`, a vertical run → `StripedV`. (Blast direction
  is defined in B1; B0 only fixes the two distinct hashable identities.)
- **L/T** (a horizontal run ≥3 and a vertical run ≥3 sharing a cell) → **wrapped**.
- **line-5** (a single run of ≥5) → **colour-bomb**.
- **2×2 square** → **fish**: **deferred to B4** (see Open Questions Q2). A 2×2
  block is *not* a line match under current rules; recognising it changes
  `find_matches` and `swap_legal` (new legal moves appear) and the deal/reshuffle
  match-avoidance — far more invasive than sub-classifying existing line matches.
  It belongs with the fish work in B4, with its own vectors and winnability
  re-check.

**Shape priority when a matched component qualifies as more than one shape**
(e.g. a 5-run that also has a perpendicular 3 through it): **colour-bomb (≥5) >
wrapped (L/T) > striped (line-4) > plain (line-3)**. At most one special is
created per connected matched component. Documented in RULES.md.

### Deterministic creation placement

Candy Crush spawns the special at the candy the player *moved*. Our
`resolve_move` knows the swap `(from,to)`; after the swap the moved gems sit at
`to` and `from`. Placement rule (RULES.md tie-break table, provisional):

- **Step 0 (swap-triggered):** if a swapped endpoint (`from` or `to`) lies in the
  qualifying component, the special spawns there; if both do (rare), prefer `to`
  (the drop target), else the earliest in (row, col) order.
- **Cascade steps (>0) or no swapped endpoint in the component:** spawn at the
  component's deterministic anchor — for a single run, its **median cell**
  (`cells[len/2]` in scan order); for an L/T, the **intersection cell**. Ties
  resolve to the earliest (row, col).

The placement cell keeps its colour and gains the special marker; the *other*
matched cells clear to `Empty` as today. `clear_cells` returns the created
special(s) so `resolve_move` can apply them after the clear.

### Why creation-without-activation is a coherent shippable slice

Roadmap D4/B0 decided this ordering. A created special that does nothing yet is
a legitimate TDD increment: it appears on the board, is rendered with an
accessible label, is hashed, and survives replay; B1 immediately makes striped
blast. Shipping it inert to `fun.croft.ing` between B0 and B1 is acceptable — it
reads as "a shiny candy" until its power lands. (Open Question Q3.)

### The mandatory data regeneration

Because creation changes 4+/L/T match outcomes, the committed
`games/trio-tumble/{par-pack,blockers-pack,jelly-pack}.json` no longer match what the
engine produces on replay. The solver already replays via `play_move`, so it
picks up creation automatically — **no solver code change is needed for B0**
(specials-aware *strategy* is B6). We only **regenerate** the three packs under
the new rules, re-lock them, and confirm winnability holds (logging any seed
that drops out — no silent truncation). Par changes in place (D5, no users,
`TrioTumble::VERSION` stays 1).

## Verified Assumptions

- **Existing golden vectors are line-3 only.** `vectors/01` (`step0_cleared` = 3
  cells) and `vectors/03` (3 cells, +50 = 3 gems + 1 blocker layer) are line-3
  matches. Line-3 → plain (unchanged), and gem-only/jelly boards keep their hash
  → **01 and 03 need no re-lock.** `vectors/02` is illegal-move (no clear).
  Confirmed by reading the three JSON files.
- **Pack tests will break without regeneration.** `committed_par_pack_is_wellformed`
  (`crates/trio-tumble-solver/tests/solver.rs:278`) asserts
  `e.tiers == par_tiers(e.seed)` for the first 3 entries; `par_tiers`
  (`trio-tumble-solver/src/lib.rs:245`) replays via `reference_score`/`_beam`/`random_score`,
  which change once creation changes 4+/L/T match outcomes → the committed tiers
  mismatch the recompute → RED. The blockers/jelly `committed_*_is_wellformed`
  tests replay the fixture line and assert the objective (`blockers_remaining==0`
  / `jelly_remaining==0`); a recorded swap may become illegal after the board
  diverges at the first 4-match → fixture line may fail to clear → RED (to be
  quantified in Phase 0 D1). All confirmed by reading the solver + tests.
- **The overlay keeps match/legality byte-identical.** `find_matches`
  (`engine.rs:45`), `same_gem` (`:84`), `swap_legal` (`:195`), `legal_swaps`,
  `has_legal_move`, `reshuffle_if_dead` operate only on `Cell::Gem` colour; a
  special whose base cell stays `Gem(color)` is invisible to them. Confirmed by
  reading `engine.rs`.
- **Hash extension pattern exists.** `state_hash` (`hash.rs:8`) already appends a
  jelly section only when `board.jelly().iter().any(|&l| l > 0)`; the special
  section follows the same shape.
- **Board authoring/rendering seams exist.** `from_rows_with_jelly`
  (`board.rs:153`), `BoardView.jelly` (`trio-tumble-wasm/src/lib.rs:277`),
  jelly rendering in `src/games/trio-tumble.ts` — all direct precedents for the
  special overlay's authoring, view, and render.

## Documentation Impact

- `crates/trio-tumble-core/RULES.md` — **Phases 1–5.** Board model (special overlay),
  the shape-classification tie-break table (T1 extension: run structure +
  shape + priority), the creation-placement tie-break table, and the `state_hash`
  special section. Each rules change lands in the phase that implements it.
- `crates/trio-tumble-core/vectors/README.md` — **Phase 3.** Document the special
  authoring grid + any new expectation fields (created specials).
- `docs/BUILDING-GAMES.md` — **Phase 6.** Note the special-overlay pattern as a
  reusable "new board state" example (hash-append + view + render + authoring).
- `TODO/trio-tumble.md` — **Phase 7.** Tick B0; record the representation decision,
  the 2×2/fish→B4 deferral, and the pack regeneration.
- `plans/2026-07-30-trio-tumble-parity-roadmap.md` — **Phase 7.** Update the Track B
  header/status to reflect B0 done and the 2×2→B4 move.
- ADR (new, `docs/adr/` or the project's ADR location — grep first) — **Phase 1.**
  Record the overlay-vs-variant representation decision.
- Grep result: `grep -ri "special" docs/ crates/*/RULES.md` to be run in Phase 0
  D1 to catch any stale "specials: none" statements (RULES.md P1 scope §2 says
  "Specials in v1: none" — that line must be updated in Phase 1).

## Concurrency Map

All phases sequential. Each phase reads what the prior wrote: the core model
(P1) underlies core ops (P2), which underlie classification+creation (P3, P4),
which the binding/UI surface (P5), and which the packs replay against (P6);
docs (P7) reflect the finished state. Phase 0 discovery precedes all. No
parallel set is safe here — every phase writes to `RULES.md` and most write
`engine.rs` or shared test files, so write-sets overlap by construction.

## Phases

### Phase 0 — Discovery (blast-radius + detection preservation)

**Goal:** Confirm the downstream effects firsthand before touching the core, so
the pack-regeneration and vector-re-lock scope is evidence-based, not inferred.

- [ ] **D1: Exactly which committed data breaks, and does winnability survive?**
  - **Probe:** On a scratch branch (or a throwaway experiment), add minimal
    line-4→striped creation to `resolve_move`, then run
    `cargo test -p trio-tumble-solver` and `cargo test -p trio-tumble-core`. Record which
    tests go RED. Then, for the blockers/jelly packs, replay all 365 fixture/seed
    lines under the new rules and count how many still meet the objective.
    Also `grep -rin "special" crates/*/RULES.md docs/` for stale statements.
  - **Success criteria:** A concrete list of RED tests; a count of
    still-winnable seeds per pack (and the IDs of any that drop out); the list of
    stale doc lines. Disposition below.
  - **Disposition:** `throwaway` — the scratch creation edit is discarded; only
    the findings + the RED-test list feed the plan.
- [ ] **D2: Can `find_matches`'s flat output be preserved while adding run
      structure?**
  - **Probe:** Prototype `find_runs` (maximal H then V runs ≥3) and assert its
    unioned cells equal `find_matches` on the existing `tie_breaks.rs` cases +
    a handful of L/T/line-5 boards.
  - **Success criteria:** Union(find_runs) == find_matches on every case, or a
    documented divergence that forces leaving `find_matches` untouched and
    layering `find_runs` beside it.
  - **Disposition:** `keep-as-fixture` — the prototype becomes the Phase 3 tests.
- [ ] **D3: Placement determinism sanity.** Hand-work 3–4 boards (a horizontal
      4 formed by a swap; a cascade 4; an L; a 5) and confirm the placement rule
      yields a single unambiguous cell each. Adjust the RULES tie-break wording
      if any case is ambiguous.
  - **Disposition:** `keep-as-fixture` — becomes Phase 3/4 vectors.

**Done when:** D1's RED list + winnability counts are recorded here (updating
Verified Assumptions), D2 resolves the `find_matches` approach, D3 confirms the
placement rule is unambiguous. Phase 0 may restructure later phases if a probe
surprises us (e.g. many seeds drop out → a winnability-preservation sub-phase).
**Discovery Exemption applies** (no TDD/commit-per-item on the scratch probe).

### Phase 1 — Special overlay model + hash + authoring (invisible)

**Goal:** `Board` can hold specials and they are in the fingerprint; gem-only
boards hash unchanged. No gameplay change yet.
**Changes:**
- [ ] `crates/trio-tumble-core/src/board.rs` — a `SpecialKind` enum
  (`StripedH, StripedV, Wrapped, ColorBomb` — **no `Fish` yet**, that's B4) and a
  `special: Vec<Option<SpecialKind>>` grid with `special()`, `special_at`,
  `set_special`; `from_rows_with_specials(rows, special_rows)` authoring (chars:
  `.`=none, `H`/`V`=striped, `W`=wrapped, `C`=colour-bomb).
- [ ] `crates/trio-tumble-core/src/hash.rs` — append `s\x00` + one tag byte per cell
  **only when** any special is present (jelly pattern).
- [ ] `crates/trio-tumble-core/RULES.md` — board model gains the special overlay; the
  P1-scope "Specials in v1: none" line is updated to point here; the state-hash
  spec gains the special section.
- [ ] `crates/trio-tumble-core/tests/specials.rs` (new) — gem-only board hash ==
  pre-special hash (regression against a hard-coded known hash); a board with a
  special hashes deterministically and differently; authoring round-trips.
**Call chain:** `Game::state_hash` → `hash::state_hash` → reads `board.special()`.
The authoring helper + `state_hash` are exercised directly by the new tests.
**Wiring test:** `specials.rs::special_present_changes_hash_deterministically` and
`::gem_only_hash_is_unchanged` run through `state_hash` (the verify-path anchor).
**Depends on:** Phase 0.
**Read-set:** board.rs, hash.rs, vectors (for the unchanged-hash regression).
**Write-set:** board.rs, hash.rs, RULES.md, tests/specials.rs.
**Shared-state contract:** no shared mutable state beyond the file write-set.
**Risks:** getting the "append only when present" guard wrong would re-lock every
vector — the gem-only regression test is the guard.
**Done when:**
1. **Behavioral:** the core can hold and hash a special; every pre-existing
   vector still passes with no edit.
2. **Verification:** `cargo test -p trio-tumble-core` green (incl. the new
   `specials.rs` and the untouched `golden_vectors.rs`).
**Validation:** Narrow — wiring + unit tests sufficient.

### Phase 2 — Core ops preserve the overlay (clear / gravity / refill)

**Goal:** The special marker moves with its gem under gravity, is zeroed when its
cell clears, and is never produced by refill. Still no creation.
**Changes:**
- [ ] `crates/trio-tumble-core/src/engine.rs` — `clear_cells` zeros `special_at` on
  each cleared cell (like the jelly scrub); `apply_gravity` carries the marker
  with its gem (collect `(Cell, Option<SpecialKind>)` pairs per segment, repack
  both together so they cannot desync); `refill` leaves markers `None` (holes
  already carry `None` after gravity).
- [ ] `crates/trio-tumble-core/RULES.md` — note specials fall/clear with their gem.
- [ ] `crates/trio-tumble-core/tests/specials.rs` — a special falls with its gem
  (single-column gravity case); a cleared special's marker → `None`; refill
  produces no specials; a full `play_move` over a hand-placed inert special keeps
  it consistent and re-verifies (hash stable across two replays).
**Call chain:** `Game::play_move` → `resolve_move` → `clear_cells` / `apply_gravity`
/ `refill`, all now overlay-aware.
**Wiring test:** `specials.rs::inert_special_survives_a_cascade_move` drives
`Game::play_move` and asserts the special's position/kind after gravity+refill.
**Depends on:** Phase 1.
**Read-set:** engine.rs, board.rs.
**Write-set:** engine.rs, RULES.md, tests/specials.rs.
**Shared-state contract:** none beyond the write-set.
**Risks:** gravity desync (marker and gem diverge). Mitigation: repack as pairs,
never two separate passes; the fall test catches it.
**Done when:**
1. **Behavioral:** a special placed on the board moves, clears, and re-verifies
   exactly like a gem carrying a badge.
2. **Verification:** `cargo test -p trio-tumble-core` green.
**Validation:** Narrow — wiring + unit tests.

### Phase 3 — Run detection + line-4 → striped creation (wired)

**Goal:** A line-4 match, in real play, leaves a striped gem at the deterministic
placement; the rest clears; score reflects 3 cleared, not 4.
**Changes:**
- [ ] `crates/trio-tumble-core/src/engine.rs` (or new `src/shapes.rs`) — `find_runs`
  (maximal H then V runs ≥3, each carrying its cells + orientation); a
  `classify`/`creations_for` step returning, per qualifying component, a
  `(SpecialKind, placement: Pos)`; for Phase 3 only the **line-4 → striped**
  rule is *acted on* (others classified + unit-tested, consumed in Phase 4).
- [ ] `resolve_move` clear step — after `clear_cells`, apply the created
  specials via `set_special` at their placement cells (which were cleared to
  `Empty`, then set back to `Gem(color)` + marker). Thread the swap `(from,to)`
  and cascade-step index into placement.
- [ ] `crates/trio-tumble-core/RULES.md` — T1 extension (run structure), the
  shape-priority table, the line-4 rule + orientation, the creation-placement
  tie-break table.
- [ ] `crates/trio-tumble-core/vectors/04-striped-from-line4.json` (new, hash locked)
  + `crates/trio-tumble-core/tests/specials.rs` / `shapes.rs` cases: swap-formed
  horizontal 4 → `StripedH` at the swapped cell; vertical 4 → `StripedV`;
  cascade-formed 4 → median placement; score = 3×10.
**Call chain:** `Game::play_move` → `resolve_move` → `find_runs` → `creations_for`
→ `set_special`. The vector replay + the play tests exercise the whole chain.
**Wiring test:** `golden_vectors.rs` over `04-striped-from-line4.json` (the
striped gem is present in the final board and the final hash is locked) — RED
before Phase 3, GREEN after.
**Depends on:** Phase 2.
**Read-set:** engine.rs, board.rs.
**Write-set:** engine.rs (+ maybe shapes.rs), RULES.md, tests/specials.rs (or
shapes.rs), vectors/04-*.json.
**Shared-state contract:** none beyond the write-set.
**Risks:** placement ambiguity (Phase 0 D3 mitigates); `find_matches` output
accidentally changing (Phase 0 D2 mitigates — keep the flat detector's output
identical). This phase touches ~4 files — at the split limit; if `shapes.rs`
plus tests plus vectors plus RULES pushes past comfort, split the pure
`find_runs`/`classify` (unit-tested in isolation via the D2 fixtures) from the
`resolve_move` wiring into 3a/3b, keeping each ≤4 files.
**Done when:**
1. **Behavioral:** playing a swap that forms a 4-run leaves exactly one striped
   gem of the right orientation at the placement cell, on the live engine.
2. **Verification:** `cargo test -p trio-tumble-core` green incl. `04` locked.
**Validation:** Moderate — wiring + unit + a manual `cargo test` trace read of a
4-run playout to confirm placement, before committing.

### Phase 4 — Wrapped (L/T) + colour-bomb (line-5) creation + priority

**Goal:** L/T matches create wrapped, line-5 create colour-bomb, and the shape
priority resolves overlaps deterministically.
**Changes:**
- [ ] `crates/trio-tumble-core/src/engine.rs` / `shapes.rs` — act on the L/T and
  line-5 classifications; apply the priority order (≥5 > L/T > 4 > 3) so a
  component that qualifies as several yields one special.
- [ ] `crates/trio-tumble-core/RULES.md` — finalise the L/T and line-5 rules + the
  worked priority examples.
- [ ] vectors `05-wrapped-from-LT.json`, `06-colorbomb-from-line5.json`,
  `07-priority-overlap.json` (hashes locked) + `tests/specials.rs`/`shapes.rs`.
**Call chain:** same as Phase 3, now covering wrapped/colour-bomb.
**Wiring test:** `golden_vectors.rs` over `05`/`06`/`07`.
**Depends on:** Phase 3.
**Read-set / Write-set:** engine.rs (+shapes.rs), RULES.md, tests, vectors/05–07.
**Shared-state contract:** none beyond the write-set.
**Risks:** L/T detection (intersection of an H and a V run) edge cases (e.g. a
plus shape, double-T). Cover them as explicit vectors.
**Done when:**
1. **Behavioral:** L/T → wrapped, line-5 → colour-bomb, overlaps → the priority
   special, all on the live engine.
2. **Verification:** `cargo test -p trio-tumble-core` green incl. `05`–`07`.
**Validation:** Moderate — wiring + unit + trace read of the priority case.

### Phase 5 — Surface specials to the binding + UI (deployed, visible)

**Goal:** Specials render on `/trio-tumble/` with an accessible label and are in the
board view; nothing panics; axe-clean; both e2e projects green.
**Changes (split into 5a core-surface, 5b UI to respect the 4-file rule):**
- [ ] **5a** `crates/trio-tumble-wasm/src/lib.rs` — `BoardView` gains a `specials`
  grid (row-major, `""`/`"striped-h"`/`"striped-v"`/`"wrapped"`/`"color-bomb"`),
  populated from `board.special()`; never panics. Binding unit/e2e-facing JSON
  test.
- [ ] **5b** `src/games/trio-tumble.ts` — render the overlay as a badge/backing on the
  gem tile with a text/aria label (not colour-only — a11y); reduced-motion-safe;
  `src/games/trio-tumble-howto.ts` gains a "special candies" note.
- [ ] e2e: `tests/e2e/` — a spec asserting a striped gem renders with its label
  after a scripted 4-match (chromium + mobile-webkit); axe stays clean.
- [ ] `npm run build:wasm && npm run build && npm run guide:shots` → commit shots.
**Call chain:** `board_json` → `board_view` → `BoardView.specials` → `trio-tumble.ts`
render.
**Wiring test:** the e2e spec that forms a 4-match and asserts the labelled
striped tile in the DOM (through the real wasm binding).
**Depends on:** Phase 4.
**Read-set:** trio-tumble-wasm/src/lib.rs, src/games/trio-tumble.ts, trio-tumble-howto.ts.
**Write-set:** 5a → trio-tumble-wasm/src/lib.rs (+ a wasm test); 5b → trio-tumble.ts,
trio-tumble-howto.ts, tests/e2e/*, guide shots.
**Shared-state contract:** none beyond the write-set (build artifacts are
regenerated, not hand-edited).
**Risks:** colour-only affordance (a11y fail) — mitigate with a text/aria label
and a shape badge. `npm run e2e` needs `npx playwright install webkit` first.
**Done when:**
1. **Behavioral:** on the live build a 4-match shows a labelled striped candy.
2. **Verification:** `npm run test` + `npm run e2e` (both projects, incl. axe)
   green; guide shots regenerated.
**Validation:** Broad — wiring + unit + `npm run serve` manual check + both e2e
projects + axe.

### Phase 6 — Regenerate + re-lock the committed packs (mandatory data)

**Goal:** The committed par/blockers/jelly packs match the engine under the new
creation rules; winnability holds (or drops are logged, not hidden).
**Changes:**
- [ ] Run the `#[ignore]` generators (`generate_par_pack_file`,
  `generate_blockers_pack`, `generate_jelly_pack_file`) to rewrite
  `games/trio-tumble/{par-pack,blockers-pack,jelly-pack}.json`.
- [ ] Run the `#[ignore]` regeneration drills to confirm byte-identical
  reproduction; run the fast `committed_*_is_wellformed` tests to confirm green.
- [ ] If any daily seed is no longer winnable within budget, `log` it in the
  commit message and (if needed) widen the search per Phase 0 D1 findings — **no
  silent truncation** of the 365-seed count.
- [ ] Re-embed: the par table is `include_bytes!`-embedded in the wasm
  (`trio-tumble-wasm/src/lib.rs:48`); rebuild the wasm so the embedded table matches.
**Call chain:** generators → committed JSON → `par_table()` / pack readers →
binding + solver tests.
**Wiring test:** `committed_par_pack_is_wellformed`,
`committed_pack_is_wellformed`, `committed_jelly_pack_is_wellformed` all green
against the regenerated files; `npm run test` (which builds the wasm embedding
the new par table) green.
**Depends on:** Phases 3–4 (the rule changes that shift the data) and Phase 5
(the wasm build).
**Read-set:** trio-tumble-solver/src + tests, games/trio-tumble/*.json, trio-tumble-wasm/src.
**Write-set:** games/trio-tumble/par-pack.json, blockers-pack.json, jelly-pack.json
(regenerated); no source logic change expected.
**Shared-state contract:** none beyond the write-set.
**Risks:** a seed dropping out of winnability (surface it, don't hide it); the
regen being slow (release build, `#[ignore]`). This is the dedicated re-lock
commit the roadmap's "hash churn" mitigation prescribes.
**Done when:**
1. **Behavioral:** daily boards + par reflect the specials-creation rules and
   remain winnable/gradable; verify is still a pure lookup.
2. **Verification:** `cargo test --workspace` + the regen drills + `npm run test`
   green; regenerated JSON is byte-identical on a second regen.
**Validation:** Broad — the regen drills + full workspace + wasm build.

### Phase 7 — Docs sync + roadmap update

**Goal:** Docs reflect B0 reality; the roadmap/backlog record decisions.
**Changes:**
- [ ] `TODO/trio-tumble.md` — tick B0; record the overlay decision, 2×2/fish→B4,
  the pack regeneration.
- [ ] `plans/2026-07-30-trio-tumble-parity-roadmap.md` — Track B header: B0 done,
  2×2/fish moved into B4.
- [ ] `docs/BUILDING-GAMES.md` — the special-overlay "new board state" pattern.
- [ ] Confirm `RULES.md` is internally consistent end to end.
**Depends on:** Phases 1–6.
**Read-set / Write-set:** the four docs above.
**Shared-state contract:** docs only.
**Done when:** docs match the shipped behaviour; `grep` finds no stale
"specials: none" claims.
**Validation:** Narrow — doc review.

## Open Questions

All resolved 2026-07-30 by the owner directive **"do whatever Candy Crush
does"** — resolve ambiguous game-behaviour questions by fidelity to Candy Crush
canon rather than re-asking.

- [CONFIRMED: overlay] **Q1 — Representation.** Resolved to the **parallel
  special-overlay layer.** Rationale under the directive: in Candy Crush a
  special *is* a coloured candy with a power — it matches by colour, is
  swappable, and falls like any candy. Modelling it as `Cell::Gem(color)` + a
  marker is the faithful representation, and it is also the lowest determinism
  risk (match/legality core untouched).
- [CONFIRMED: defer to B4] **Q2 — 2×2 fish.** The fish stays fully in scope; the
  2×2 square is built in **B4** (its own phase), not B0. Deferral is a build-order
  choice only — final Candy-Crush parity is identical. B0 = line-3/4/5 + L/T.
- [CONFIRMED: ship inert] **Q3 — Ship inert specials between B0/B1.** Yes, per the
  roadmap's creation-before-activation ordering; a striped candy reads as a shiny
  candy until B1 gives it a blast.
- [CONFIRMED: Candy Crush orientation] **Q4 — Striped orientation.** Adopt the
  Candy Crush convention (a horizontal match → a row-clearing striped candy, a
  vertical match → a column-clearing one). B0 fixes the two distinct hashable
  identities (`StripedH` / `StripedV`); the blast direction is finalised in B1
  where activation is observable.

## Review Log

### B0 complete — 2026-07-30
All phases shipped, green, and deployed to `fun.croft.ing`:
- Phase 1 `ab7c9f4` (overlay model + hash + authoring), Phase 2 `3dab6e2`
  (clear/gravity carry), Phase 3 `ca75ee7` (run detection + line-derived creation
  + pack re-lock, byte-identical drills pass), Phase 4 `179cafd` (binding + UI
  render + the docs/roadmap sync in this commit's follow-up).
- **Fallout caught by the full gate (not the Rust gate):** the B0.3 pack regen
  left two hardcoded fixtures stale (the old seed-30 `[4,4,5,4]` blockers clear no
  longer clears once a 4-match makes a special) — the blockers unit test and e2e
  now use the new committed fixture (seed 19, `[5,5,6,5]`). Lesson: a pack regen
  must be validated against `npm run test` + `npm run e2e`, not just
  `cargo test --workspace`; run the full gate before committing a rule change.
- 2×2 fish confirmed deferred to B4; **B1 (striped activation) is next.**
- Final gate: cargo 111, npm test 84, e2e 82 (both projects, incl. axe),
  clippy + fmt clean, guide shots regenerated.

### Execution restructure — 2026-07-30 (during Phase 3)
**Found:** the committed packs are coupled to the engine's scoring/clearing
rules, so **any commit that changes those rules must regenerate the packs in the
same commit** to keep the gate green — a "code now, regenerate later" split would
leave an intermediate RED commit (violating commit-per-stable-point). This
collapses the original Phase 3 (line-4) + Phase 4 (L/T, line-5) + Phase 6
(regenerate) into a tighter shape:
- **Phase 3 (revised):** run detection + **all** line-derived creation
  (striped / wrapped / colour-bomb, with shape priority) **+ regenerate & re-lock
  the three packs**, one green commit. Combining the shapes means a single
  (slow) regeneration instead of two.
- **Phase 4 (revised, was 5):** surface to binding + UI (deployed, visible).
- **Phase 5 (revised, was 7):** docs sync + roadmap update.
The classification is cohesive (run-length → kind), so combining the shapes is
also cleaner than an intermediate where a line-5 makes no special.
**Confirmed (Phases 1–2 shipped):** the overlay keeps match/legality
byte-identical (94→98 passed, existing vectors un-re-locked); commits `ab7c9f4`
(B0.1), `3dab6e2` (B0.2).

### Pass 1+2 — 2026-07-30 (combined, exploration fresh)
**Found (gap analysis, verified against code):**
- Creating specials shifts `par_tiers` → `committed_par_pack_is_wellformed`
  goes RED; blockers/jelly fixture replays may diverge to illegal moves → RED.
  Added **Phase 6** (mandatory pack regeneration) and Phase 0 **D1** to quantify.
  This was not in the roadmap's B0 (which defers *solver strategy* to B6, but the
  *data* must be re-locked in B0 regardless).
- `find_matches` returns a flat set with no run structure; classification needs
  runs. Added `find_runs` + Phase 0 **D2** to prove the flat output is preserved.
- 2×2 fish is not a line match → recognising it changes legality; pulled out of
  B0 into B4 (Q2) rather than smuggling a match-definition change into B0.
- Shape-priority ambiguity (a component qualifying as several shapes) → added an
  explicit priority table and vector `07`.
- Phase 3 is at the 4-file split limit; noted the 3a/3b fallback split.
**Concurrency:** All phases sequential (write-sets overlap on `RULES.md`/`engine.rs`);
map confirmed, no parallel set is safe.
**Confirmed:**
- The overlay representation keeps match/legality byte-identical (read `engine.rs`).
- Existing vectors 01/03 are line-3 → no re-lock (read the JSON).
- The jelly hash/authoring/view/render seams are direct precedents for specials.
