# Mahjong solitaire — the rules this engine implements

Sources: the GNOME Mahjongg and xmahjongg documentation, de Bondt's "Computational
complexity of Mahjong Solitaire" (arXiv:1203.6559), and the 2026-08-30 research brief in
`plans/2026-08-30-plan-mahjong.md`. Where implementations differ, this file says which
reading is ours and the tests in `tests/` pin it.

## The set

144 tiles over 42 faces (`tiles.rs`): three suits — dots, bamboo, characters — of ranks 1–9
in four copies (108); four winds and three dragons in four copies (28); four flowers and
four seasons, one each (8). Face ids are dense `0..42` in that order so a board serialises
as bytes.

## Matching

Two tiles match when their faces are identical, **or** both are flowers, **or** both are
seasons. Those two wild classes are the only non-identity matches; a flower never matches a
season.

## The board

A layout is a set of slots on a **half-tile grid**: a tile at `(x, y, z)` covers
`x..x+2 × y..y+2` on layer `z`. Half units are what let a tile straddle two rows (the
Turtle's three side tiles at `y = 7`) or rest on four (its head at `(13, 7, 4)`). Slots are
numbered in `(z, y, x)` order, so a slot id is stable for a layout and a move is a pair of
ids. Five layouts ship (`layout.rs`): Pond 36 · Bridge 60 · Fortress 88 · Steps 112 · Turtle
144, the Turtle to the standard 87 / 36 / 16 / 4 / 1.

## FREE

A tile is free when **nothing lies on it — not even partially** — and **at least one of its
long sides touches no tile on its own layer**. "On it" is any overlap of footprints one
layer up (the head covers all four crown tiles though it overlaps each by a quarter).
"Touches" is a same-layer tile whose footprint shares any vertical extent and abuts the side
(`x' + 2 == x` on the left, `x + 2 == x'` on the right); a tile on the layer below never
blocks a side. Both readings follow de Bondt and xmahjongg.

## A move

A move removes a **free matching pair**; the legal pairs of a position are exactly the free
tiles paired by the match rule. The **shuffle** is also a move: it re-deals the faces of the
tiles still on the board over their own slots (never moving a slot), drawing from the
game's RNG stream, so it replays. Undo is not a move — it is the record minus its last
entry, replayed.

## Deals are winnable by construction

A deal is built by **peeling** (`generate.rs`): with every slot occupied and no faces yet,
repeatedly remove two currently-free slots at random until none remain; that removal order
is a winning line, and the `i`-th removed pair takes the `i`-th of the shuffled face pairs.
The same peel over the present slots of a part-played board is the shuffle, and it is
winnable for the same reason. A peel dead-ends only when fewer than two slots are free while
some remain (the last two stacked, say); the attempt restarts on the continuing stream —
measured at 22 restarts per 300 Turtle seeds, pinned by test. A first design that placed
pairs forward failed on half of all Turtles, because any hole between two placed tiles on a
row is unfillable, not only a one-slot hole; the peel has no such rule to get wrong.

## Determinism and the record

The RNG is FNV-1a for keys and `mulberry32` carried as `u32` (`rng.rs`); nothing on the
hashed path touches a float. `state_hash` is SHA-256 over a domain tag, the layout id and
size, the count remaining, and per slot the face id or `0xFF` when removed. A record is the
packed origin (`layout << 32 | seed`) and the move list; replay regenerates the deal, applies
each move as the game would (an illegal one is a no-op, so a tampered list diverges), and
re-derives the hash and whether the board cleared.

## What the engine does not decide

Whether a *position* the player has reached still clears. Every deal does; the player leaves
its line at once, and position solvability is NP-complete with peeking. `mahjong-solver`
answers within a budget and says when it is only guessing.
