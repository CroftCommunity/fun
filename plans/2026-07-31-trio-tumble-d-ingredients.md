# Match-3 parity — Track D: the Ingredients objective (drop-to-bottom)

**Status:** planning (2026-07-31). Parent: `plans/2026-07-30-trio-tumble-parity-roadmap.md`
(Track D — parity completeness). Owner-confirmed 2026-07-31 as the next Track D item
(the confirmation gate, like D3/D4). A fourth objective over the shared 8×8 engine,
alongside target-score, clear-blockers, and clear-jelly.

## Problem Statement

Candy-Crush's **Ingredients** mode drops objects to the bottom of the board: a few
non-gem **ingredient** tiles must fall to the bottom row and exit; you win when all
have been collected within the move budget. Unlike every prior objective, an
ingredient is a **genuinely new cell kind** — it is *not* a gem (never matches, can't
be swapped) but, *unlike* a blocker, it **falls with gravity**. So this objective adds
a new `Cell` variant and a new gravity behaviour, then reuses the proven mode template
(deal → solver + winnable pack → mode-aware binding → UI + how-to).

## Positioning

A generic of the Candy-Crush mechanic set. The behaviour mirrors the reference
(objects fall and exit the bottom). The **exit model** and **ingredient count** are the
generic's engineering knobs, documented revisable.

## Decisions (representation forks + canon-derived knobs)

- **Ingredient = a new `Cell::Ingredient` variant** (not an overlay). An ingredient
  occupies a cell exclusively, is not a gem, and falls — none of the existing kinds
  (gem / blocker / overlay) model that. Adding a `Cell` variant is compiler-guided
  (exhaustive matches) and **additive to the hash** (tag `0x03`): no board without an
  ingredient changes, so no pre-D vector re-locks. This is the honest model; an overlay
  cannot represent a non-gem falling object.
- **Exit = the bottom row.** An ingredient that gravity settles into `row = height-1`
  is collected (→ `Empty`, count++), then refill fills above it. The whole bottom row
  is an exit (generic; the reference sometimes uses specific exit columns — revisable).
- **Falls with gems, does not bound segments.** In gravity an ingredient is a *falling
  object* (like a gem, order-preserving), **not** a shelf (unlike a blocker). Blockers
  still bound gravity segments; ingredients ride inside them.
- **Never matches, never swaps.** `find_matches`/`same_gem` only see `Gem`, so an
  ingredient never matches; `swap_legal` already requires both endpoints be gems, so an
  ingredient can't be swapped — both hold with **no change** (the ingredient simply is
  not a `Gem`).
- **Deal:** a normal gem fill, then `INGREDIENTS` cells in the **top row** become
  ingredients (they must fall the full height); redraw if it leaves no legal move
  (mirror `deal_blockers`). Provisional knobs: `INGREDIENTS = 3`, `MOVE_BUDGET = 30`
  (tunable; the solver only keeps winnable seeds).
- **Collection is deterministic** (scan the bottom row after each step's gravity,
  before refill) and folds into state via the cell grid — no RNG.

## Reasoning

- **Reuse the mode template, add the one new mechanic.** blockers/jelly proved the
  template (core+rules+vectors → solver+pack → binding → UI). Ingredients is the same
  spine; the only genuinely new work is the `Cell::Ingredient` variant + falling +
  the exit/collect step. The solver/pack/binding/UI are structural copies.
- **Gravity generalization.** `apply_gravity_pinned` collects `is_gem()` cells and
  falls them; extend "falling" to `is_gem() || is_ingredient()` (an ingredient carries
  no special marker). A blocker still bounds segments; an ingredient does not.
- **`collect_ingredients(board) -> u32`** runs in `resolve_move` after each gravity,
  before refill: any ingredient in the bottom row clears (counted). Deterministic.
- **`ingredients_remaining`** is the win check (monotone non-increasing — refill makes
  only gems). `Mode::Ingredients` + a `TrioTumbleIngredients` outcome kind
  (`trio-tumble-ingredients`), a `board_view` ingredient mask, an ingredients-left HUD.

## Verified Assumptions

- `Cell` is a small enum matched in `board.rs` (`is_*`, `to_rows`, `from_rows`) and
  `engine.rs` (gravity, clear, refill, deal). Adding `Ingredient` is compiler-guided.
  Confirmed by reading `board.rs`.
- `apply_gravity_pinned` is the single gravity authority; generalizing "falling" there
  covers every caller. Confirmed.
- `swap_legal`/`find_matches` gate on `Cell::Gem`, so an ingredient is inert to
  matching/legality with no edit. Confirmed by reading `engine.rs`.
- The hash encodes cells inline with a tag byte; a new tag `0x03` is additive (no
  pre-existing board carries it). Confirmed by reading `hash.rs`.
- The blockers/jelly modes give a complete binding + UI + pack template to copy.
  Confirmed (they exist and are green).

## Documentation Impact

- `RULES.md` — Board model (the `Ingredient` cell), a **T5 — Ingredients** section
  (falls-not-shelf, bottom-row exit, collect step), hash tag `0x03`, the deal note.
- `crates/trio-tumble-core/vectors/*` + README — an ingredient authoring char + vectors.
- `docs/BUILDING-GAMES.md` — note the first *falling non-gem* cell if it generalizes.
- `TODO/trio-tumble.md` + roadmap Track D — tick Ingredients.

## Phases

### Phase 1 (core) — `Cell::Ingredient`, falling gravity, exit/collect, deal, vectors
- [ ] `board.rs` — `Cell::Ingredient`, `is_ingredient()`, a `from_rows`/`to_rows` char
  (`*`), exhaustive matches updated.
- [ ] `hash.rs` — `Ingredient -> 0x03`.
- [ ] `engine.rs` — gravity falls ingredients (order-preserving, not a shelf);
  `collect_ingredients`; `deal_ingredients`; `ingredients_remaining`; `resolve_move`
  collects after each gravity, before refill.
- [ ] `RULES.md` — Board model + T5 + hash tag + deal.
- [ ] `tests` — an ingredient falls when gems below it clear; it exits at the bottom
  (counted); it never matches / can't be swapped; the deal places `INGREDIENTS` at the
  top with a legal move; a gem-only board still hashes unchanged (no re-lock).
- [ ] golden vectors: an ingredient-drop scenario (recorded step0 + hash).

### Phase 2 (solver + pack) — `find_ingredients` + winnable-daily pack
- [ ] `trio-tumble-solver` — `find_ingredients` (budgeted DFS, progress = ingredients
  collected, reusing `search`); `generate_ingredients_pack`; committed
  `games/trio-tumble/ingredients-pack.json` + regeneration drill (365 winnable, byte-identical).

### Phase 3 (binding) — `Mode::Ingredients` + outcome + board_view
- [ ] `trio-tumble-wasm` + `trio-tumble-wasm.ts` — `new_ingredients_game`, `TrioTumbleIngredients`
  outcome kind (`trio-tumble-ingredients`), `board_view` ingredient mask + remaining/total.

### Phase 4 (UI + how-to) — toggle, render, HUD, e2e, shots
- [ ] `trio-tumble.ts` — objective toggle entry, ingredient tile render + a11y label, an
  ingredients-left HUD, a verifiable clear result; `?mode=ingredients`.
- [ ] `trio-tumble-howto.ts` — the ingredients objective.
- [ ] `tests/trio-tumble.spec.ts` — e2e drives an ingredient drop + a verifiable clear (both
  projects incl. axe); guide shots if a new tile visual.
- [ ] roadmap + `TODO/trio-tumble.md` tick Ingredients.

Each phase: green + commit; the whole objective is the Track-D boundary.

## Open Questions

- [CONFIRMED: Cell::Ingredient] representation (the only honest model for a non-gem
  falling object; additive hash tag).
- [CONFIRMED: bottom-row exit, revisable] exit model.
- [CONFIRMED: INGREDIENTS=3 / MOVE_BUDGET=30, tunable] deal knobs.
- [DEFERRED] specific exit columns, ingredient variety, ingredient + specials
  interactions beyond "a blast that clears beneath it drops it".

## Review Log
### Ingredients complete — 2026-07-31
Shipped green + deployed across four phases: core (`5cc1c3e`), solver+pack (`6addc95`),
binding + UI (this commit). The objective is playable at `?mode=ingredients`,
winnable-daily (365-seed pack, fixture seed 144), verifiable (`trio-tumble-ingredients`
outcome kind, re-verify + share), and accessible (ingredient tiles carry a non-colour
a11y label; axe-clean). Full gate: cargo core+solver+wasm green (incl. the byte-identical
regen drill), npm test 107, e2e 142 (both projects incl. axe), golden vector 24.
- **The one new mechanic was a falling non-gem cell.** `Cell::Ingredient` — inert to
  matching/legality (they gate on `Cell::Gem`, so no edit there), falls in gravity
  (generalized "falling" = gem-or-ingredient; a blocker still bounds segments), and
  exits via `collect_ingredients` after each step's gravity. The hash tag `0x03` is
  additive, so no pre-ingredient vector re-locked.
- **Everything else was the proven mode template.** `find_ingredients` reused the shared
  budgeted DFS (progress = ingredients collected, so `StepReport` gained a per-step
  `ingredients_collected` field); the binding/outcome/UI are structural copies of
  blockers/jelly. The wasm `Cell` match was already `_`-safe, so phase 1 deployed with the
  mode dormant until the binding wired it.
- **INGREDIENTS=3 / MOVE_BUDGET=30** are tunable knobs; the solver only keeps winnable
  seeds. The fixture drops all three in two swaps via cascades.
- Live-smoke against fun.croft.ing after deploy.
- Next Track D items (order/mixed checklist; obstacle families) await owner confirmation;
  timed is flagged a poor fit for the no-wall-clock verifiable model.

### Pass 1 — 2026-07-31
Plan authored after owner confirmed Ingredients as the next Track D item. The one new
mechanic is a falling non-gem cell (`Cell::Ingredient`) — everything else is the proven
blockers/jelly mode template. Additive hash tag (no re-lock); the deal/solver/binding/UI
are structural copies. Phased core → solver+pack → binding → UI, green + commit each.
