# bubble-core rules (Puzzle Bobble family) — the determinism + verifiability spec

This is the source of truth the engine implements verbatim. Same discipline as
`trio-tumble-core/RULES.md`: everything here is deterministic given a seed and a move
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

### Parity offset — so a new row can be pushed in at the top

The board carries an explicit **`parity_offset ∈ {0, 1}`**: row `r` is *full*
(`width` cells) when `(r + parity_offset)` is even, else *short* (`width - 1`). A
fresh board has offset `0` — the base layout above (even rows full). The offset is
what lets the descending-stack pressure (below) push a single new row in at the
top without disturbing the existing bubbles' geometry. `parity_offset` is **not**
folded into the state hash: it is a pure function of the number of top-inserts,
which is itself a deterministic function of the recorded move list, so replay
always reconstructs the identical board (cells laid out under the identical
parity) and hashes identical cells. Clear-board mode never inserts, so its offset
stays `0` and its hashes are unchanged.

## Descending pressure — top-row insertion (levels mode)

`Board::insert_top_row(new_top)` pushes a new row in at the top: it shifts every
row down one, **flips `parity_offset`**, and writes `new_top` into the new row 0.
Flipping the offset exactly cancels the `+1` index shift, so every existing bubble
keeps its full/short classification and its six-neighbour set — only a new top row
is added; the old bottom row's content is pushed off the fixed-height board (the
mechanical half of the deadline loss). A parity flip preserves the flat cell count
only when `height` is **even**, so the levels mode uses an even height; clear-board
mode (odd height) never inserts. The new row's colours come from a **seeded**
stream (folded into `draws`, exactly like the deal), and the insertion is triggered
on the **shot/miss count** — both deterministic functions of `(seed, moves)` — so
`(seed, angles)` still replays byte-identically. No wall-clock ever drives a state
transition.

## Levels mode — escalating, point-gated survival

`LevelGame` (`levels.rs`) is the second mode (clear-board is the first). Endless
survival on one continuous, descending board:

- **Scoring (arcade fidelity):** a shot scores `10 · popped + drop_score(dropped)`,
  where `drop_score(n) = 20 · 2^(n-1)` capped at `1_310_720` for `n ≥ 17`
  (`drop_score(0) = 0`). Big drops are the skill the targets reward.
- **Levels + ramp:** starting at level 1, when the per-level score meets
  `target_score(level)` the level advances (excess carries over), and the per-level
  knobs harden — more colours (`colors_at`, up to `MAX_COLORS`), a tighter insert
  cadence (`insert_cadence_at`, down to `CADENCE_FLOOR`), a higher target
  (`target_score_at`). All are pure functions of `level` on a [`LevelConfig`]
  (`LevelConfig::default_mode` reads `levels_mode`; tests/calibration vary it).
- **Pressure:** every `insert_cadence(level)` **shots** a new top row of seeded
  colours (the level's palette) is pushed in via `Board::insert_top_row`. The
  trigger is the shot count and the colours are a seeded stream (folded into
  `draws`), so replay reproduces every insert.
- **Deadline / loss:** the run ends (`is_lost`) when a bubble reaches the reserved
  bottom `DEADLINE_ROWS` — placed there by a shot or shifted there by an insert
  (or pushed off the bottom entirely). There is **no** terminal win (`is_won` is
  always false); the run's value is its cumulative score + highest level.
- **The timer is presentational.** `time_limit_secs_at(level)` is exposed for the
  UI's optional countdown only; it is **never** read by `play` and never decides a
  loss — a wall clock can't be reproduced by replay, so it can't back a verifiable
  outcome (`docs/BUILDING-GAMES.md` §9).

The state hash folds `MAX_COLORS` (stable palette metadata), the combined RNG
position (deal + launcher + insert streams), and the cumulative score. The
verifiable outcome is `BubbleLevels` (`KIND = "bubble-levels"`, `VERSION = 1`):
`replay(seed, angles)` reproduces the final hash + total score + a 0–3 star grade
of the highest level reached (`grade`).

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
ChaCha20 seeded from `seed` (the `trio-tumble-core` primitive); draws are counted and
folded into the state hash. Unlike Trio Tumble, a starting cluster of same-colour
bubbles is normal and allowed — the deal is a plain seeded fill.

## Aim — a quantized angle, fixed-point trajectory (v2)

The player **aims a quantized integer angle** (whole degrees in a legal fan;
`aim::fan()` → `10..=170`). `resolve_shot(board, Angle)` ray-casts the projectile
from the launcher (board-centre, below the last row) along that angle,
**reflecting off the side walls**, until it first contacts an occupied cell or
the ceiling, then snaps to the nearest empty hex cell (`aim.rs`).

Determinism without floats: `wasm32-unknown-unknown` has no runtime trig, so the
per-angle unit vectors are a **committed integer table** (`data/directions.json`,
regenerated by `tools/build-bubble-directions.mjs`), and the march is
fixed-point integer math (shift-16, sub-pixel units, `DIAM=256`/`RADIUS=128`,
`ROW_H=222`). So `(seed, angles)` replays byte-identically and native == wasm.
The returned `Landing.path` (launcher → wall bounces → stop, on-wall vertices)
is **presentational only** — the UI draws the aim preview and animates the flight
along it; it never touches the state hash. The core decides the landing; the UI
never invents physics (a v2 E2E asserts the animated landing == the resolved
landing).

> **v1 (superseded):** the shipped v1 used *tap-a-target-cell* (a
> `legal_targets` set) precisely to avoid continuous trajectories — a determinism
> tradeoff that discarded the real bubble-shooter feel. v2 keeps determinism
> *and* the real aim-and-shoot game via the quantized-angle + fixed-point model
> above. `legal_targets` remains only as a solver helper (reachable-cell search).

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
