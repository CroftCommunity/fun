# Blockdoku core — rules & determinism contract

The deterministic, headless engine behind `/blockdoku/`. Ported clean-room from
the original AGPL game (`github.com/chasemp/blockdoku`, mirrored read-only at
`reference/original/`); every rule below is verified against that source. This doc
is the spec the crate implements and the golden vectors lock.

> Status: **B1–B4 shipped** — board + catalog + clearing + hash (B1), frozen
> scoring (B2), difficulty + seeded deal (B3), the game state machine with
> `(seed, moves)` replay (B4). The wasm binding + `pond-outcome` envelope land in
> B5; magic-block mechanics are a fast-follow (plan §"Wild/magic mechanics").

## Board

- **9×9** grid, `board[row][col]`, rows top→bottom, cols left→right.
- A cell is plain occupancy: `0` empty / `1` filled. **Colour is cosmetic** and
  lives only in the UI — it never touches this crate or the hash.
- **3×3 boxes** are indexed `0..9` row-major: `box = (row/3)*3 + (col/3)`.

## Pieces & placement

- A piece is a catalog shape ([`shapes::ShapeDef`]) — a rectangular bit-matrix of
  filled offsets, taken verbatim from the original (see "Catalog").
- A placement anchors the shape's top-left at `(row, col)`. It is **legal** iff the
  shape fits fully in bounds **and** every filled offset lands on an empty cell.
- **No rotation** in v1: pieces are placed in their dealt orientation (the original
  supports rotation; deferred — see the plan's Open Questions).
- `placements(shape)` / `legal_moves` enumerate legal anchors in **row-major
  canonical order** — the exact order the UI glows and the outcome replay expects.

## Clearing — simultaneous union

After a placement, every fully-occupied **row**, **column**, and **3×3 box** is
detected **from the board as-is** (detection never mutates mid-scan), then all are
cleared as a **union**: a cell belonging to two cleared regions (e.g. a row and a
box) is emptied exactly once. The count of cleared regions (`rows + cols + boxes`)
is the **combo count** that scoring consumes.

## Catalog (generated, never hand-edited)

53 shapes, extracted verbatim by `tools/extract-blockdoku-shapes.mjs` into
`src/shapes_gen.rs`:

- **8 standard** — `single, line2, line3, l2x2, l3x2, t3x2, square2x2, z3x2`; the
  always-dealable base pool.
- **38 wild** (`Tier::Wild`) — exotic geometries (pentominoes, crosses, hollows,
  hexominoes, …). Pure shapes with a points value; **no special mechanic**.
- **7 magic** (`Tier::Magic`) — `wildSingle/wildLine2/wildL` (line-clear),
  `bombSingle/bombLine2` (bomb), `lightningSingle` (lightning), `ghostSingle`
  (ghost). Their special mechanics are **opt-in, off by default**, and land as a
  fast-follow (plan §"Wild/magic mechanics"); v1 treats them as unused catalog
  entries.

The catalog is locked by count (8/38/7) and a content hash in `tests/catalog.rs`,
so an accidental edit or regeneration drift is caught.

## Scoring — B2 (frozen constants)

Ported 1:1 from the original `scoring.js`; frozen (change only with explicit human
approval): placement = shape's `points`; row/col clear = **15** each; 3×3 box
clear = **20** each; combo ladder (per cleared region `i=2..N` in one placement) =
`+10, +15, +15, +50, +100…`; streak bonus over consecutive combo events =
`<2→0, 2..10→streak*10, 11+→100+(streak-10)*100`. Each component is
`floor(component × difficulty_multiplier)` independently (easy 1.5 / normal 1.0 /
hard 0.8 / expert 0.5). *(Implemented in B2.)*

## Deal & difficulty — B3

Difficulty presets (easy/normal/hard/expert) filter the dealable pool by an
allowed-shape list + a bounding-box size range; the deal composes a tray of 3 via
the ported wild/magic frequency accumulators, drawn from the seeded RNG. All
randomness comes from [`rng::DetRng`] (seeded `ChaCha20`, `u32` index boundary) in
a canonical, golden-vector-locked draw order. *(Implemented in B3.)*

## State hash — the verifiable anchor

`hash::state_hash(board, draws, score)` = lowercase-hex SHA-256 over: domain tag
`b"bdk\0"`, board size (`u32` LE), `draws` (`u64` LE, the RNG-stream position),
`score` (`u64` LE), then the row-major occupancy bytes. **Integer-only**, so the
hash is byte-identical on native and `wasm32`. The encoding is **additive**
(§2 overlay pattern): future per-cell facets (magic-block state) append only when
present, so pre-facet golden vectors never re-lock.

## Determinism invariants

- A run replays byte-identically from `(seed, moves)` → same `state_hash`, score,
  and game-over point, native and wasm.
- **No floats on the hashed path** — placement, clearing, scoring, and the deal are
  all integer.
- The only entropy is the seeded deal; there is no wall-clock, no OS randomness.
