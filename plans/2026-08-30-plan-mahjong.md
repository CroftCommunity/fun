# Plan — Mahjong: tile-matching solitaire, Tier-1

**Status:** Phases 0–6 IN PROGRESS (2026-08-30). Branch `claude/mahjong`; worktree
`CroftC/worktrees/mahjong/fun`.

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
                         · reverse-construction generator · Game (play / undo / shuffle)
                         · state_hash · pond_outcome::Game            + RULES.md, vectors/
crates/mahjong-solver    budgeted DFS win-finder from ANY position (hints; "proven" flag)
                         · the daily pack (seed schedule + fixture line; see Reasoning)
crates/mahjong-wasm      raw C-ABI + serde-JSON binding: holds one game, never panics
src/games/mahjong/       mahjong.ts (GameModule on the game frame) · mahjong-wasm.ts ·
                         mahjong-outcome.ts · mahjong-howto.ts · tiles.ts (SVG faces) ·
                         assets/{icon,splash}.jpg
games/mahjong/           daily-pack.json
```

- **Layouts** are authored in a half-tile ASCII grid (the KMahjongg idea, our own files —
  its `.layout`s are GPL and we are AGPL, so reuse would be legal; they are re-authored
  anyway because the format here carries offsets differently). Ladder: `pond` 36 → `bridge`
  60 → `fortress` 88 → `steps` 112 → `turtle` 144 — the Turtle to the standard 5-layer
  shape (87 / 36 / 16 / 4 / 1, side tiles half-offset).
- **A deal is `(layout, seed)`**, packed into one JS-safe integer; the record carries only
  that plus the move list. Levels: `n` → layout by band, seed `FNV("mahjong-level-n")`;
  endless. Daily: the pack's seed for the UTC day, on the Turtle.
- **A move is a pair of slot ids** (`a << 8 | b`) or **Shuffle** (`0x10000`) — shuffle
  re-deals the remaining tiles over the remaining slots by reverse construction from the
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
every remaining-slot subset in linear time, with the winning line as a by-product. The cost
is care in the placement step: a slot with tiles on both sides can never be added, so the
generator refuses a placement that would leave such a gap, requires a slot's support to be
present before it, and retries the attempt from the continuing RNG stream on the rare dead
end. The retry rate is measured in the tests, not assumed.

**Why the pack has no solver in its winnability path (§3 of BUILDING-GAMES).** Every deal is
winnable by construction, so the daily pack is the trivially-winnable shape: a deterministic
seed schedule plus a fixture line, byte-identically regenerable. The solver crate exists for
*hints* and difficulty, and the plan says so rather than shipping a solver "for symmetry".

**Why the solver is budgeted and hints carry a `proven` flag.** Position solvability is
NP-complete with peeking; a budgeted DFS with memoisation on the present-tile bitset and
"four free of a kind → take them" pruning finds wins fast on most positions and gives up on
the rest. A hint from a found line cannot doom the board; a heuristic hint might, and the UI
must not say otherwise.

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
| 2 | `mahjong-solver`: budgeted win-finder + pack | solver clears a level-1 board and the Turtle from its start within budget; pack committed + regen drill |
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
