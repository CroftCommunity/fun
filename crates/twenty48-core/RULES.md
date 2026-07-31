# twenty48-core — rules & determinism contract

The deterministic heart of the `fun.croft.ing` 2048 game. Source of truth for
the move/merge rules, the seeded-spawn contract, the exponent encoding, win/stuck,
the state hash, and the daily-pack contract. The only randomness is the post-move
tile spawn, drawn from a seeded stream, so a game replays exactly from
`(seed, directions)` and native == wasm.

## Tiles — exponent encoding

A cell holds `0` (empty) or an exponent `v` meaning the tile value `2^v`
(`1`=2 … `11`=2048). Storing exponents keeps the whole hashed path integer-only.
The default board is 4×4 (`mode::WIDTH`/`HEIGHT`).

## The move — slide + merge

A move is one of four `Direction`s. All tiles slide as far as they can in that
direction; two equal tiles that collide **merge** into one tile of the next
exponent. Per line, in travel order: compact (drop gaps), then merge equal
adjacent pairs **once each** (a tile created by a merge does not merge again the
same move), then re-pad. A move that changes nothing is **illegal** (`changed =
false`) — no spawn, no record. `score_gain` for a move is the sum of the *values*
(`2^(v+1)`) of the tiles created by its merges. Canonical (exponents):

| line | dir | result | gain |
|------|-----|--------|------|
| `[1,1,1,1]` | Left | `[2,2,0,0]` | 8 |
| `[1,1,2,0]` | Left | `[2,2,0,0]` | 4 (merge-once) |
| `[0,1,0,2]` | Left | `[1,2,0,0]` | 0 |

## The spawn — seeded

After every move that changes the board, one tile spawns: a `2` (exponent 1) with
p≈0.9, else a `4` (exponent 2), at a uniformly-chosen empty cell. Draw order is
**position then value** from a seeded `ChaCha20` `DetRng` (`index(len)` samples a
width-stable `u32` range). A new game deals `mode::START_TILES` (2) spawns. Every
draw is counted; the count folds into the hash, so replay reproduces the exact
spawn stream.

## Win / stuck

`won` = any tile reaches exponent `mode::WIN_EXP` (11 = 2048). The game is
**stuck** when the board is full and no direction changes it (`is_full &&
!has_any_move`). Reaching 2048 flags the win; ending on stuck (or the player's
"I'm done") produces a verifiable score record.

## State hash

Lowercase-hex SHA-256 over: the domain tag `b"t48\x00"`, width + height (`u32`
LE), the RNG draw count (`u64` LE — binds the spawn-stream position), the score
(`u64` LE), then the row-major cell exponents. Fully determined by `(seed,
directions)`; integer LE fields → byte-identical on native and `wasm32`.

## Daily-pack contract (see `pack.rs`)

The daily schedule is a `pond-docformat` envelope (`kind = "2048-daily-pack"`,
version 1) holding `{ seeds, fixture }`: a deterministic seeded shuffle of a seed
range (a year of non-repeating dailies) plus one `fixture` (seed + a short legal
direction line) for replay tests. **No solver** — every seed is playable (a
non-full board always has a legal move), so there is no winnability search; the
pack is purely the daily seed rotation. Whether you reach 2048 is skill, not seed.
