# Dots and Boxes — rules (the core's contract)

Dots and Boxes is the shelf's **fourth** two-player adversarial game, after
Drop 4, Othello and checkers. It is a traditional folk game with a generic name,
so there is no trademark to route around.

## Board

- **3 × 3 boxes** on a **4 × 4 dot lattice** (`ROWS = 3`, `COLS = 3`, `BOXES = 9`).
- **24 edges** (`EDGES = 24`): `H_EDGES = (ROWS+1) * COLS = 12` horizontal and
  `V_EDGES = ROWS * (COLS+1) = 12` vertical.
- **Side A moves first** (the opening player).

### Edge numbering (the wire code)

A move is a single edge index `0..24`, which is also the number a `?r=` share
carries and the number the AI-scoring harness passes over the `GameOracle` port.
No packing is needed — unlike checkers, whose move is a jump chain.

```text
horizontal  H(r,c) = r*COLS + c              r in 0..=ROWS, c in 0..COLS   ->  0..11
vertical    V(r,c) = H_EDGES + r*(COLS+1) + c   r in 0..ROWS,  c in 0..=COLS -> 12..23
```

Box `(r, c)` — box-major index `r*COLS + c` — closes on `H(r,c)`, `H(r+1,c)`,
`V(r,c)`, `V(r,c+1)`. The empty board renders as:

```text
*  0  *  1  *  2  *
12    13    14    15
*  3  *  4  *  5  *
16    17    18    19
*  6  *  7  *  8  *
20    21    22    23
*  9  * 10  * 11  *
```

Drawn edges are stored as a `u32` bitmask, not a byte array: the search keys its
memo table on the mask directly, and a fixed-width integer keeps `usize` (whose
width differs between native and `wasm32`) off the hashed path.

## Moves

- A move is an **edge** `Edge(0..24)`. It is legal iff that edge is not already
  drawn.
- Applying a move draws the edge and **claims every box it completes** for the
  mover. One edge can complete **two** boxes at once — the shared edge between
  them — and both go to the mover.
- **A capture grants another move.** The turn passes **only** when the drawn edge
  completed no box.

That last rule is the thing this game brings to the shelf that no other
adversarial game here has: `side_to_move` is **not** a function of move parity.
The shared `adversary_core::Adversary` trait already allowed it (`side_to_move`
takes the position), and the scoring rig re-reads whose turn it is from the live
board on every iteration, so nothing shared had to change.

## Terminal

- The game ends when **every edge is drawn** — equivalently, when all nine boxes
  are claimed, since every edge borders at least one box.
- **Win:** the side owning more boxes. **Draw:** equal boxes.
- Nine boxes cannot split evenly, so **no draw is reachable in play**. The draw
  arm still exists, because the rule is about box counts and not about nine of
  them; it lives in the free function `result_of(boxes_a, boxes_b)` so a test can
  exercise it directly. An unreachable branch is one no test can verify in place.
- A side can be mathematically safe before the end (five of nine boxes), but play
  continues to the last edge, as standard play does. Stopping early would
  truncate the record.

## Game value

3 × 3 is a **second-player win, 6–3**, with perfect play — measured by an exact
solve (`plans/2026-08-07-dots-and-boxes.md` → Phase 0 findings) and cross-checked
against a hand-derivable 1 × 1 board, where four edges and strict alternation give
the second player the only box.

This is a design fact, not trivia: a human who **opens** against a perfect
opponent loses by construction. The shelf game therefore lets the player choose
who opens and puts the human second by default. `Side::A` still opens and the
record stays A-centric; the side assignment is the front end's, exactly as Drop 4
documents.

## State hash

Lowercase-hex SHA-256 over: the domain tag `b"dots\x00"`, `ROWS` and `COLS` as
little-endian `u32`, the side-to-move byte (`1`/`2`), the drawn-edge mask as a
little-endian `u32`, then the 9 box-owner bytes (`0` unowned, `1` A, `2` B).
Every integer field is little-endian, so the hash is **byte-identical on native
and `wasm32`** — the anchor for verifiable outcomes.

Hashing the dimensions as `u32` is what makes a future board size **additive**: a
3 × 3 board hashes exactly as it does today, so no golden vector recorded now
re-locks when a larger board is added.

The recorded empty-board hash is
`d936e0ed1e855da2c5e97ac257433e0603ea6e11b7bddff19e4dcd830a0dc103`. If it moves,
the wire format changed and every previously shared record stopped verifying —
so it moves only deliberately, with the reason written beside it.

## Verifiable outcome

`Dots` implements `adversary_core::Adversary` (the spine the harness and solver
are generic over) and `pond_outcome::Game`. A match record is `(seed, moves)` —
one list holding **both** sides' moves, in play order — which
`pond_outcome::verify` replays through this core and re-hashes, trusting no
stored field. A move that could not legally have been played is a no-op in
replay, so the hash diverges and verification fails.

**What the hash deliberately does not catch:** reordering two quiet opening moves
that close nothing. Those reach an identical position by a different route, so
they are a different *route*, not a forged *result*, and the hash is right to be
blind to them. What it must catch is a move that did not legally happen; both
cases are pinned by tests.

`Replayed::won` means "**Side A won**".

## Determinism note

`seed` is currently unused — every seed opens the standard empty lattice. It is
reserved for future start variants (a handicap opening, a larger board) without
changing the record format, the same posture Drop 4 takes. In the wasm binding the
seed drives the opponent's difficulty RNG, which is how the tournament varies
games.
