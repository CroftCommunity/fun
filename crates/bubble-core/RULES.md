# bubble-core rules (Puzzle Bobble family) — the determinism + verifiability spec

This is the source of truth the engine implements verbatim. Same discipline as
`match3-core/RULES.md`: everything here is deterministic given a seed and a move
list, so a finished game is verifiable by replay against the state hash.

## Board geometry — a staggered hex grid

The board is `height` rows of a pointy-top offset hex packing:

- **Even rows** (`r % 2 == 0`) are **full**: `width` cells, columns `0..width`.
- **Odd rows** (`r % 2 == 1`) are **short**: `width - 1` cells, columns
  `0..width-1`, conceptually shifted right by half a cell.

Cells are stored in one flat `Vec<Cell>` in row-major order (row 0 first). The
flat index of `(row, col)` is `sum(row_len(0..row)) + col`, where
`row_len(r) = width` for even `r` and `width - 1` for odd `r`.

Each `Cell` is `Empty` or `Bubble(color)` where `color` is a `u8` in `0..colors`.

## Adjacency — six neighbours

A cell has up to six neighbours: two in-row (`c-1`, `c+1`) and two on each of the
rows above and below. The diagonal column offsets depend on row parity:

- from an **even** (full) row: diagonal neighbours are at columns `c-1` and `c`;
- from an **odd** (short) row: diagonal neighbours are at columns `c` and `c+1`.

Every candidate is kept only if it lies within the target row's bounds. This is
the single adjacency relation used for both cluster-pop and floating-drop.

## The deal — a seeded starting board

`deal(seed, width, height, rows_filled, colors)` fills the top `rows_filled`
rows with `Bubble(rng.index(colors))` and leaves the rest `Empty`. The RNG is
ChaCha20 seeded from `seed` (the `match3-core` primitive); draws are counted and
folded into the state hash. Unlike match-3, a starting cluster of same-colour
bubbles is normal and allowed — the deal is a plain seeded fill.

## Aim — tap a target, no continuous physics

The engine never simulates a continuous trajectory (floats would break
native==wasm determinism). Instead the player **taps a target cell**, and a shot
is legal iff the target is a **reachable landing cell**:

- the cell is `Empty`, **and**
- it is in the top row, **or** it is adjacent (six-neighbour) to a `Bubble`.

`legal_targets(board)` returns exactly these cells. This is the tap-first,
core-decides-legality floor: the UI glows exactly `legal_targets` and never
decides legality itself.

## The shot — place, pop, drop

`shoot(board, target, color)` (target must be a legal landing cell):

1. **Place** `Bubble(color)` at `target`.
2. **Pop:** find the six-neighbour connected cluster of cells with the same
   `color` as the placed bubble, including the placed cell. If the cluster size
   is **≥ 3**, set every cell in it to `Empty`; otherwise nothing pops.
3. **Drop:** any bubble no longer connected to the **top row** through a path of
   filled cells is "floating" and is set to `Empty`. (Compute the set reachable
   from any filled top-row cell over filled six-neighbours; every filled cell not
   in that set drops.)

`score` increases by `popped + 2 * dropped` (dropped bubbles are worth double, as
in the arcade family). Popping is only triggered by the placed colour; a shot
that pops nothing still consumes the placed bubble and a shot.

The objective (`clear-the-board` vs `target-score`) and the shot budget live one
layer up (the `Game` wrapper / the wasm binding), not in these rules.

## State hash — the verifiable-outcome anchor

`state_hash(board, colors, draws, score)` = lowercase-hex SHA-256 over:

```
b"bub\x00"
width  (u32 le) · height (u32 le) · colors (u32 le)
draws  (u64 le) · score  (u64 le)
for each cell in flat order: Empty -> [0x00]; Bubble(c) -> [0x01, c]
```

Replaying `(seed, shots)` through the engine and re-hashing reproduces this
string exactly; that identity is the pond's verifiable outcome.
