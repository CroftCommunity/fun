# Plan — Mahjong: tile-matching solitaire, Tier-1

**Status:** Phases 0–6 COMPLETE (2026-08-30) — gate green, PR open, awaiting merge. Branch
`claude/mahjong`; worktree `CroftC/worktrees/mahjong/fun`. Follow-ons: D4 (themed tile
sets); an owed device pass on the Turtle at phone size `[device: android x2]`.

## Problem Statement

The shelf has no tile-matching game, and the owner asked for "full on mahjong" — the
Mahjong-Blast-shaped casual game: a 144-tile Turtle and smaller boards, tap a free tile then
its match, no timer, no ads, offline, a daily board everyone shares, a level ladder, undo,
hint, shuffle. The research brief (2026-08-30, 434 sources) settled the rules and the one
real build risk:

- **Rules are unambiguous.** 144 tiles = 3 suits × 9 × 4 (108) + winds 16 + dragons 12 +
  4 flowers + 4 seasons. A tile is **free** iff nothing lies on it (not even partially) and
  its left *or* right side touches no tile on the same layer. Suits and honours match
  identically; any flower matches any flower, any season any season.
- **A uniform shuffle is a bad deal.** Random play wins ~6% of Turtles; ~3% are unsolvable
  even with peeking (de Bondt, 10M boards). The correct generator is **reverse
  construction** — place matching pairs into positions that would be legal to remove,
  bottom-up — which yields a board with at least one solution (its own construction order).
  Solvability of an arbitrary position is NP-complete, so the shelf must not promise a
  solver *proves* every hint; it can promise every *deal* is winnable.

## Approach

A Tier-1 game in the shelf's standard shape (`docs/BUILDING-GAMES.md`), three crates and one
front-end directory:

```
crates/mahjong-core      tiles · match predicate · layouts (half-tile grid) · FREE predicate
                         · peel generator (deals winnable by construction) · Game (play / undo / shuffle)
                         · state_hash · pond_outcome::Game            + RULES.md, vectors/
crates/mahjong-solver    budgeted DFS win-finder from ANY position (hints; "proven" flag)
crates/mahjong-wasm      raw C-ABI + serde-JSON binding: holds one game, never panics
src/games/mahjong/       mahjong.ts (GameModule on the game frame) · mahjong-wasm.ts ·
                         mahjong-outcome.ts · mahjong-howto.ts · tiles.ts (SVG faces) ·
                         assets/{icon,splash}.jpg   (no daily pack — see Reasoning)
```

- **Layouts** are authored in code on a half-tile grid (`layout.rs`: `row`/`block` builders
  plus explicit half-offset slots — the KMahjongg idea, our own designs; its `.layout`s are
  GPL and we are AGPL, so reuse would have been legal, but five originals were cheaper than
  a parser). Ladder: `pond` 36 → `bridge`
  60 → `fortress` 88 → `steps` 112 → `turtle` 144 — the Turtle to the standard 5-layer
  shape (87 / 36 / 16 / 4 / 1, side tiles half-offset).
- **A deal is `(layout, seed)`**, packed into one JS-safe integer; the record carries only
  that plus the move list. Levels: `n` → layout by band, seed `FNV("mahjong-level-n")`;
  endless. Daily: `FNV("mahjong-daily-YYYY-MM-DD")` on the Turtle (no pack — see Reasoning).
- **A move is a pair of slot ids** (`a << 8 | b`) or **Shuffle** (`0x10000`) — shuffle
  re-deals the remaining tiles over the remaining slots by the same peel from the
  game's own RNG stream, so it is winnable-by-construction again *and* replays. Undo pops
  and replays. Hint, undo and shuffle all count as assistance.
- **Hint = the solver's next move when it finds a win within budget** (guaranteed not to
  doom the board), else the heuristic best legal match (maximise available moves), *labelled
  as unproven* in the status line. Honesty bound to the flag, as for the adversarial tutors.
- **Rendering**: DOM buttons absolutely positioned in a scaled board (`--mj-u` from a
  ResizeObserver on the stage), per-layer up-left offset with drawn right/bottom edges, painted
  bottom layer first. Every tile is a `<button>` with a spoken label ("Bamboo 5, free" /
  "blocked"); suits differ by shape, so no colour carries meaning alone. Faces are inline SVG
  drawn by `tiles.ts` (original art; Unicode's block is font-dependent and the Commons sets
  are CC-BY-SA/GPL — see § Reasoning).
- **Frame**: meters *left · matches · moves*; verbs Undo · Hint · New game… · Shuffle; setup
  = Levels / Daily; preferences = tile faces (Classic / Large print) and dim-blocked-tiles.

## Reasoning

**Why reverse construction and not shuffle + solver-filter.** A random Turtle is winnable
often enough that a filter would work, but the filter is a full solver run per seed (the
hard cases take de Bondt's solver a day), and it says nothing about the *smaller* boards or
about shuffle-on-stuck. Reverse construction gives a winnable board for every layout and
every remaining-slot subset in linear time, with the winning line as a by-product.

**Why the construction is a peel, not a placement (learned 2026-08-30).** The first cut
placed pairs forward into empty slots under two rules — support first, and never leave a
one-slot gap between placed tiles — and dead-ended on **half of all Turtles**. Instrumenting
the dead ends showed why: *any* hole between two placed tiles on a row is unfillable (its
last slot would be touched on both sides), not only a one-slot one, and the end of the walk
routinely left a row tail whose only addable slot could not take its neighbour as a
partner. The industry's framing is the fix: **peel** the full layout — remove random pairs
of currently-free slots until none remain — and let that order be the deal. Nothing to get
wrong about holes, because a peel only ever removes what is free. Measured restart rate: 22
per 300 Turtle seeds, pinned by test.

**Why there is no daily pack (§3 of BUILDING-GAMES, the Loose Ends precedent).** Every deal
is winnable by construction, so the daily needs no certified seed list: the daily seed is
`FNV("mahjong-daily-YYYY-MM-DD")` on the Turtle, derived identically in the core and the TS
wrapper, and the fixture line lives in the golden vectors (`02-pond-cleared`). The solver
crate exists for *hints*, and the plan says so rather than shipping a pack "for symmetry".

**Why the solver is budgeted and hints carry a `proven` flag.** Position solvability is
NP-complete with peeking; a budgeted DFS with memoisation on the present-tile bitset and
"every remaining tile of a class is free → take them" pruning finds wins fast on most
positions and gives up on the rest. A hint from a found line cannot doom the board; a
heuristic hint might, and the UI must not say otherwise. **Measured (release, fresh
Turtles):** most seeds clear in ~60 nodes; a few sink millions into one wrong early branch
(seed 5 unsolved at 3M). De Bondt's remedy — random restarts with growing caps and the
dead-position memo carried across — took seed 5 to 557k and the rest to ≤ 56k. Found on the
way: a position abandoned for *budget* was being memoised as dead; only an exhausted subtree
is. The wasm hint budget is 15k nodes, so a hard position falls back to the heuristic and
says so.

**Why original SVG faces.** The repo is AGPL, so GPL/CC-BY-SA art is legally reusable, but
vendoring 42 SVGs from KDE/Commons buys attribution obligations, a dependency to drift-check,
and faces drawn for 96px desktop tiles. Drawing them in TypeScript (dots, sticks, numerals,
wind/dragon characters) keeps the faces resolution-independent, themeable, and ours. The one
font dependency — CJK glyphs for characters/winds/dragons — is a system font on every target
platform; the Large-print set uses Latin abbreviations and needs none.

**Why not a canvas.** Loose Ends draws on a canvas because it pans and zooms; a mahjong board
is at most 30 × 16 half-units and fits a phone at 12–13px per half-unit. DOM buttons give
free focus order, labels, hit-testing (the browser resolves the topmost element) and axe
coverage.

## Verified assumptions

- `pond_outcome::Game` takes a `u64` seed; a `(layout u8, seed u32)` packed as
  `layout << 32 | seed` is < 2^40, an exact JS integer (looseends packs the same way).
- The frame allows at most four game verbs (Undo · Hint · New game · Shuffle is four).
- `record.ts`'s `InProgress.moves` is `[number, number][]`; a shuffle is stored as `[-1, -1]`
  and `resolveRecord` does not validate move shape (read 2026-08-30).
- The Turtle count: 84 (rows 12/8/10/12/12/10/8/12) + 3 side tiles = 87; + 36 + 16 + 4 + 1
  = 144. Asserted by a layout test.

## Phases

| # | Phase | Proves |
|---|---|---|
| 0 | Plan, worktree, FEATURE.md | this doc |
| 1 | `mahjong-core`: tiles + match, layouts + FREE, generator, Game, hash, outcome | Rust gate green; every generated board replays its construction line to a clear; RULES.md + vectors |
| 2 | `mahjong-solver`: budgeted win-finder | solver clears a level-1 board and six fresh Turtles within 1M nodes; hint honesty bound to `proven` |
| 3 | `mahjong-wasm` + `xbuild` enrolment | C-ABI never panics; native == wasm on the vectors |
| 4 | Front end: module, frame spec, tiles.ts, outcome/share, how-to, registry, styles, tokens | wiring e2e (`@smoke`), core-decides-legality e2e, full solve → verified win → `?r=` re-verifies, board-top stability, axe both themes, 360px |
| 5 | Art (icon/splash), guide shots, CHANGELOG, README, TODO | `art.test.ts`, `how-to.test.ts` green |
| 6 | Full gate, PR | `npm run gate` green; PR open, ask before merge |

## Decisions

- D1 — Shuffle is a recorded move and counts as assistance. A rescue, not a free action.
- D2 — Hint honesty: "proven" only when the solver found a full line from this position.
- D3 — The daily is always the Turtle; levels ramp through the five layouts and then cycle.
- D4 — Themed tile sets (cats, seasons, pandas — the Mahjong Blast skins) are a follow-on;
  this plan ships Classic + Large print.

## Review Log

- 2026-08-30 — plan written from the research brief; phases begin.
- 2026-08-30 — Phase 1–3 landed: the generator became a peel (see Reasoning), the solver
  gained restarts, the daily pack was dropped for the Loose Ends shape. Rust gate green.
- 2026-08-30 — Phases 4–6: front end on the frame (fork), `npm run gate` PASS (unit 818,
  browser 819 on both engines), Rust gate + cross-build re-run PASS on the final tree.
  **Mutation audit of `mahjong-core`:** first run reported 40 missed and was FALSE — four
  parallel workers sharing one `CARGO_TARGET_DIR` ran each other's stale test binaries (a
  hand-applied survivor was caught by the existing test). Re-run with per-worker target
  dirs: 37 missed → closed `matches_for`, `is_stuck`, bamboo ranks, layout names, the
  greedy hint against a brute force, the RNG pinned to the JS `mulberry32` stream; dropped
  the peel-unused `Layout::below` and `Rng::state`. Final: **277 caught, 3 survivors, all
  equivalent** — `|`→`^` in `Origin::to_packed` and `Move::pair` (disjoint bit fields) and
  `Layout::is_empty → false` (no shipped layout is empty).
