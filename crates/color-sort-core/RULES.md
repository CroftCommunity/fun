# color-sort-core — rules & determinism contract

The deterministic heart of the `fun.croft.ing` Color Sort game (a water/ball/bolt
sort puzzle). Source of truth for tube state, move legality, the maximal-run pour,
win/deadlock, the deterministic deal, the packed outcome-seed encoding, and the
state hash. One engine serves every skin — ball and bolt are pure rendering of the
same water-move (the equivalence theorem, Ito et al. arXiv:2202.09495). The only
nondeterminism is the seeded deal shuffle, so a game replays exactly from
`(packed seed, moves)` and native == wasm.

## State — tubes of colour ids

`colors + empties` tubes in **fixed play order**; each tube is a stack of colour
ids `0..colors`, index `0` = bottom, capacity `cap = 4` (`h`) in every mode. Each
of the `colors` (`n`) colours appears exactly `cap` times; `empties` (`k`) tubes
start empty. Tube order is fixed for the life of a level, so the arrangement is
part of the state (the game/replay hash is over the tubes *in play order*; the
solver's dedup key sorts them because order is irrelevant to *solvability*).

## Move legality — the formal rule

A pour `from → to` is **legal** iff: `from ≠ to`, `from` is non-empty, `to` is not
full, and (`to` is empty **or** `top(to) == top(from)`). `legal_moves` enumerates
these; `apply_move` rejects any other pour (a tampered move in a record is a no-op
and diverges the hash).

## The pour — maximal top-colour run

A pour moves the **maximal contiguous top-colour run** of `from`, truncated by
`to`'s free space: `count = min(top_run(from), cap - len(to))`. Partial pours are
real — a run of 3 into 1 free slot moves exactly 1, leaving 2 on the source. One
pour = one move.

## UI rulings — legal-but-blocked (`ui_moves`)

On top of formal legality, the UI (and the solver, and deadlock detection) uses
`ui_moves`: a **locked** (full-and-monochrome) source is dropped entirely, and a
monochrome source into an **empty** tube is dropped (a *vacuous* pour). This is
sound for solving: pouring a monochrome run into an empty tube leaves the
order-agnostic canonical state **identical**, so it can never make progress. A
monochrome source onto a matching non-empty top stays allowed.

## Win / deadlock

`is_won` = every tube is empty or full-and-monochrome (locked). `is_deadlocked`
= not won and `ui_moves` is empty (no non-blocked pour remains) — O((n+k)²).
A deadlock can occur even with an empty tube present when only vacuous moves exist.

## The deal — deterministic

A deal is a seeded Fisher–Yates shuffle (ChaCha20 `DetRng`, `u32`-width draws for
native==wasm parity) of `[colour i × cap]` chunked into `colors` full tubes plus
`empties` empty tubes. The generator (in `color-sort-solver`) loops `attempt =
0,1,…`, rejecting **trivial** deals (any full tube already monochrome) and any
deal the solver cannot certify winnable within budget, returning the first
winnable attempt. The `attempt` is recorded so replay reconstructs the exact deal
with no solver.

## Packed outcome seed

`pond_outcome::replay` takes a single `u64` seed, so `(base, attempt, colors,
empties)` pack into one `u64` that stays under `2^53` (an exact JSON `Number`, so
the `?r=` share round-trips):

| bits    | field   | width |
|---------|---------|-------|
| 0..32   | base    | 32    |
| 32..44  | attempt | 12    |
| 44..49  | colors  | 5     |
| 49..52  | empties | 3     |

`cap` is always 4, not encoded.

## State hash

Lowercase-hex SHA-256 over: the domain tag `b"cs1\x00"`, `cap` + `colors` (bytes),
the tube count (`u32` LE), then each tube **in play order** as `(len byte, unit
bytes bottom→top)`. Fully determined by `(seed, moves)`; integer fields are
single bytes / `u32` LE → byte-identical on native and `wasm32`.

## Modes

- **Daily** (brief §5.1): fixed `n = 10, k = 2, h = 4`. Deals come from the
  solver-certified **winnable-daily pack** (`color-sort-daily-pack` `pond-docformat`
  envelope, `{ colors, empties, entries: [{base, attempt, par}], fixture }`),
  indexed by UTC day. Par is baked.
- **Endless** (brief §5.2): `k = 2`, `n` ramps by level
  (`endless::colors_for`); deals are generated + certified at runtime (fast — the
  heuristic-ordered search solves the largest size in a few ms).
