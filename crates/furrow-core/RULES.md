# Furrow — rules (the core's contract)

Furrow is the shelf's **fifth** two-player adversarial game, after Drop 4,
Othello, checkers and Dots and Boxes. It is mancala, played in the variant
usually called Kalah: two rows of six pits, one store each, four seeds a pit.

**On the names.** "Mancala" names a *family*, not a game, and every other rebuilt
game on this shelf carries its own name — so this one is **Furrow**, a crofting
word that also describes the board. "Kalah" is avoided deliberately: it was a
commercial trademark. The rules below are the traditional ones, which carry no
such encumbrance.

## Board

- **6 pits a side** (`PITS = 6`), **4 seeds a pit** (`SEEDS = 4`), so 48 seeds
  (`TOTAL_SEEDS`) and 14 cells (`CELLS`).
- **Side A moves first** (the opening player). A's store is cell 6, B's is 13.

### Cell numbering (the wire code)

A move is a single cell index, which is also the number a `?r=` share carries and
the number the AI-scoring harness passes over the `GameOracle` port. A store is
never a legal move, so codes 6 and 13 never appear in an honest record.

```text
       12  11  10   9   8   7      <- B's pits (B's row reads right-to-left here)
   13                          6   <- 13 is B's store, 6 is A's store
        0   1   2   3   4   5      <- A's pits
```

Two properties of this layout carry weight elsewhere:

- **Opposite pits sum to 12** (`0<->12`, `1<->11`, … `5<->7`), which makes the
  capture rule one subtraction rather than a lookup table.
- **Seeds in play only ever decrease.** A seed that enters a store never leaves
  it, so `Board::in_play()` is a monotone non-increasing measure of how much game
  is left. That is the property the solver's tractability threshold rests on, and
  the one checkers lacks — which is why checkers' honesty flag had to mean
  "a terminal was proven" instead.

Counts are `u8` and the whole board is `Copy`, so a search branches by cloning
fourteen bytes. No `usize` reaches the hashed path.

## Moves

- A move is a **pit** `Pit(0..CELLS)`. It is legal iff it belongs to the side to
  move and holds at least one seed.
- Applying it lifts **every** seed from that pit and drops them one at a time
  going up the numbering, wrapping at the end and **skipping the opponent's
  store**. So the cycle a mover walks is thirteen cells long, not fourteen.
- One of three things then happens, and exactly one:
  1. the last seed landed in the mover's **own store** — the mover **moves
     again**;
  2. the last seed landed in an **empty pit on the mover's own side** whose
     **facing pit is non-empty** — the mover takes both piles into their store;
  3. neither — the turn passes.

This is the second game on the shelf where **`side_to_move` is not a function of
move parity**. Dots and Boxes introduced that shape and proved the shared spine
carries it (`adversary_core::Adversary::side_to_move` takes the position). Here
it is **inherited, not introduced** — nothing shared needed changing, which is
what makes the dots result a property of the abstraction rather than luck.

Phase 0 measured extra-turn chains at **1.17 moves per turn on average, and up to
five** — real, but usually short.

### Three rule decisions this core makes

Mancala has no single canonical rule set, so these are decisions, recorded with
their reasons rather than left implicit:

1. **A capture requires the facing pit to be non-empty.** Landing your last seed
   in your own empty pit when the pit facing it is also empty banks nothing; the
   seed stays where it landed. The permissive variant (bank the lone seed anyway)
   shifts the game's balance measurably, and it makes the capture rule two rules.
2. **The grand slam is allowed.** A capture that leaves the opponent with no
   seeds at all is legal and stands. Some rule sets forbid it, or make it forfeit
   the captured seeds; both are special cases carved out to avoid an outcome the
   sweep already resolves cleanly — the opponent has no move, the game ends, and
   the mover sweeps their own side. The permissive rule is the simpler one and
   needs no exception.
3. **The sweep goes to the side that still has seeds.** When either side runs out
   of seeds the game ends immediately and every seed still in a pit goes to the
   store of the side whose pit it is in — which, at a terminal, is one side. The
   alternative (the *mover* takes everything regardless of side) is the rule some
   published variants use; it rewards being the one who emptied first, which
   inverts the incentive the rest of the game builds.

A fourth thing that is **not** a decision, because Kalah has no exception for it:
a lap of thirteen seeds returns the last seed to the pit it was lifted from,
which the lift emptied — so it **captures**. The Phase 0 spike caught this by
disagreeing with the author's expectation, and it is pinned as its own test
(`a_thirteen_seed_lap_returns_to_the_pit_it_left_and_captures_there`) because it
is exactly the rule a re-implementation gets wrong quietly.

## Terminal

- The game ends when **either side has no seeds** in their pits.
- The other side then **sweeps**: every seed still in a pit goes to that pit's
  owner's store. `apply_move` applies the sweep itself, so a terminal position is
  always canonical — both sides empty, the stores holding the final score, and
  `legal_moves` returning nothing.
- **Win:** the side with more seeds in their store. **Draw:** 24–24.

**The sweep is the shelf's first end-of-game transformation.** The final score is
not what accumulated during play, and a caller that read the stores mid-sweep
would read the wrong winner — which is why `result` sweeps a position it is
handed rather than trusting it to have been swept already.

**Every result class is reachable.** Forty-eight seeds can split evenly, so
unlike dots — where nine boxes could not split, and the draw arm existed only for
a free function to test — the draw here is a real outcome of real play.

## Game value

**Unknown, and deliberately not claimed.** Phase 0 tried to solve the opening and
did not: 10M nodes exhausted in 7.0 s, 100M in 498 s, neither reaching a value.
The cost is worse than linear — 10× the nodes cost 71× the time, because the memo
stops fitting cache long before it stops fitting memory.

The literature reports Kalah(6,4) as a first-player win. **That is not reproduced
here and is not relied on anywhere**: the published solve used retrograde analysis
and endgame databases, which is a different technique from anything this game
ships. The endgame *does* fall to an exact solve, and Phase 0 put the knee at
**16 seeds in play** (1.65M distinct positions, 315 ms) against 18 (11.2M,
3.5 s) — a 6.8× jump in one step.

So this game ships with **`Expert` as its top level, not `Perfect`** — the Othello
and checkers shape. Roughly 70% of a game sits above the exact threshold, so the
tutor hedges outside the endgame and says so.

## State hash

Lowercase-hex SHA-256 over: the domain tag `b"furrow\x00"`, `PITS` and `SEEDS` as
little-endian `u32`, the side-to-move byte (`1`/`2`), then the 14 seed counts in
cell order. Every integer field is little-endian, so the hash is **byte-identical
on native and `wasm32`** — the anchor for verifiable outcomes.

Hashing the shape as `u32` is what makes a future variant **additive**: a 6 × 4
board hashes exactly as it does today, so no golden vector recorded now re-locks
when a different seed count is added.

The counts are hashed **cell by cell**, not summarised. That matters more here
than in any other core on the shelf: one move writes to as many as thirteen
cells, so an encoding that collapsed a row would call a whole family of distinct
positions the same one.

The recorded opening hash is
`d7e6907aed394dc49fc51c19cb7262c13458fb0a89c6c748ff2959223bbc26d8`. If it moves,
the wire format changed and every previously shared record stopped verifying — so
it moves only deliberately, with the reason written beside it.

## Verifiable outcome

`Furrow` implements `adversary_core::Adversary` (the spine the harness and solver
are generic over) and `pond_outcome::Game`. A match record is `(seed, moves)` —
one list holding **both** sides' moves, in play order, which is **not**
alternating — and `pond_outcome::verify` replays it through this core and
re-hashes, trusting no stored field. A move that could not legally have been
played is a no-op in replay, so the hash diverges and verification fails. Both
shapes of tamper are pinned: a store claimed as a move, and the opponent's pit
claimed as the mover's.

**Replay correctness here depends on a loop**, which no other core on this shelf
can say. A sow is up to thirteen writes from one move code, so "the hash matched"
has to mean all fourteen counts matched — and the golden vectors check exactly
that, one of them driven deliberately through extra-turn chains and captures
because those are the paths most likely to diverge between native and wasm.

`Replayed::won` means "**Side A won**".

## Determinism note

`seed` is currently unused — every seed opens the standard 6 × 4 position. It is
reserved for future start variants (a different seed count, a handicap) without
changing the record format, the same posture Drop 4 and dots take. In the wasm
binding the seed drives the opponent's difficulty RNG, which is how the tournament
varies games.
