# Drop 4 — rules (the core's contract)

Drop 4 is Four-in-a-Row (Connect-Four mechanics; trademark-safe name). It is the
shelf's first **two-player adversarial** game: two sides alternate, the outcome
is win / loss / draw, and a finished match is verifiable by replaying its move
list.

## Board

- **7 columns × 6 rows** (`WIDTH = 7`, `HEIGHT = 6`, `CELLS = 42`).
- Cells are a flat `[u8; 42]`, index `row * WIDTH + col`, **row 0 = bottom**.
  `0` = empty, `1` = Side A, `2` = Side B. Discs stack from the bottom with no
  gaps, so a column's disc count is also the row its next drop lands on.
- **Side A moves first** (the opening player).

## Moves

- A move is a **column** `Col(0..7)`. It is legal iff the column is not full
  **and** the match is not already over.
- Applying a move drops a disc of the side-to-move onto the lowest empty row of
  that column and passes the turn. `apply` assumes the move is legal — callers
  pick from `legal_moves` / the wasm boundary and the harness enforce legality
  first.

## Terminal

- **Win:** four of one side's discs in a line — horizontal, vertical, or either
  diagonal. The scan checks the four directions →, ↑, ↗, ↘ from every cell.
- **Draw:** the board is full with no line.
- A terminal position has **no legal moves** (`legal_moves` is empty).

## State hash

Lowercase-hex SHA-256 over: the domain tag `b"drop4\x00"`, `WIDTH` and `HEIGHT`
as little-endian `u32`, the side-to-move byte (`1`/`2`), then the 42 cell bytes.
Every integer field is little-endian, so the hash is **byte-identical on native
and `wasm32`** — the anchor for verifiable outcomes.

## Verifiable outcome

`Drop4` implements `adversary_core::Adversary` (the reusable spine the harness
and solver are generic over) and `pond_outcome::Game`. A match record is
`(seed, moves)` — the alternating move list of **both** sides — which
`pond_outcome::verify` replays through this core and re-hashes, trusting no
stored field. A tampered move (illegal, or after the match ended) is a no-op in
replay, so the hash diverges and verification fails.

`Replayed::won` is defined here as "**Side A won**". The shelf game assigns the
human to a known side and interprets accordingly; the AI-scoring harness reads
`result()` directly, not `won`.

## Determinism note

`seed` is currently unused (every seed opens the standard empty board); it is
reserved for future start variants (handicaps, rotated openings) without
changing the record format.
