# orchard-core — the rules

Orchard Drop's rules, over `pond-physics`. This document is the contract the
golden vectors lock; if a statement here changes, a vector re-locks and the
change is deliberate.

Everything numeric is transcribed from the vendored game
(`src/games/orchard-drop/vendor/index.html`) unless marked otherwise, so the
rebuilt game plays what the wrap played.

## The ladder

Eleven tiers. Bigger fruit **only ever appears by merging** — the rule the whole
game rests on.

| tier | fruit | radius px | merge score |
|---|---|---|---|
| 0 | cherry | 17 | 0 |
| 1 | strawberry | 25 | 1 |
| 2 | grape | 33 | 3 |
| 3 | dekopon | 41 | 6 |
| 4 | persimmon | 50 | 10 |
| 5 | apple | 60 | 15 |
| 6 | pear | 72 | 21 |
| 7 | peach | 85 | 28 |
| 8 | pineapple | 99 | 36 |
| 9 | melon | 113 | 45 |
| 10 | watermelon | 128 | 55 |

- **Only tiers 0–4 spawn from the top** (`DROPPABLE = 5`).
- The score is the **triangular number** `n(n+1)/2`, awarded on the merge that
  **creates** tier `n`. It is computed as that formula rather than read from a
  copied array, so a transcription slip cannot pass unnoticed.
- Creating a cherry scores nothing, because cherries are dropped rather than
  merged into existence.
- A tier past the ladder **panics**. That is a bug in the caller, and returning a
  default radius would hide it inside the physics, where it would surface as
  mysterious behaviour instead of a stack trace.

## Time is part of a move

Every other Tier-1 game on this shelf advances only when the player moves. Here
the world runs continuously and the player drops *when they choose*, so a move
is a `(time, place)` pair:

```rust
enum Move {
    Drop { tick: u32, x: i32 },
    Wait { tick: u32 },
}
```

**`Wait` is not padding.** A drop list alone cannot say *when a run ended*, and
in a physics game the end tick changes the final positions. Letting replay guess
— "run until settled", "run until game over" — would make an abandoned run
replay to a state the player never saw. The run's end is recorded, not inferred.

Replay is therefore a fold: advance to each move's tick, apply it, repeat. A
move that the core refuses is skipped rather than treated as an error — a record
may legitimately carry moves that became illegal when the run ended mid-list, and
replay's job is to reproduce the state, not to re-litigate inputs the core
already judged once.

## The wall-clock constants, converted once

The vendored game measured in milliseconds against a variable frame time. At
64 Hz those become tick counts, and **the rounding is a rule, not an artifact**:

| | ms | ticks at 64 Hz | rounded | direction |
|---|---|---|---|---|
| drop cooldown | 520 | 33.28 | **33** | down — a shorter cooldown is kinder |
| freshly-dropped grace | 1200 | 76.8 | **77** | up — a longer grace is kinder |
| over-the-line dwell | 900 | 57.6 | **58** | up — slower to end the run |

Every rounding goes the way that favours the player. That is a choice, and it is
written down so it stays one.

## Dropping

- The held fruit is released with its centre at `x`, spawning at `DROP_Y = 64`.
- **`x` is clamped, not refused** — into `[radius, 440 - radius]`. The UI aims
  with a finger; the core decides what an aim off the edge means.
- A drop before `last_drop + 33` is refused with `StillCoolingDown`. The boundary
  tick itself is **legal**.
- A move whose tick precedes the current tick is refused with
  `TickWentBackwards`.
- Any move after the run has ended is refused with `GameOver`.
- Dropping advances the queue: the previewed fruit becomes the held one, and a
  fresh tier is drawn. The preview is therefore honest — it is the fruit you will
  actually get.

## Merging

**The subtlest correctness requirement in the game.** When three same-tier fruit
touch in one tick, *which two merge* decides the whole rest of the run: the
survivor's position, the next contact, the score, every drop after it.

The vendored game resolved this incidentally, from Matter's internal pair order
plus a `Set` of already-merged ids — reproducible by accident, and not
reproducible at all across engines. Here it is a rule:

> Walk the contact list **in the order given**. Merge a pair when both bodies are
> the same tier and neither has already been consumed this tick.

`pond-physics` supplies that list already sorted canonically (walls first, then
by low id, high id), which is why `merge::resolve` does not sort it again — a
second sort would be a second, silently different opinion about order, and the
two would diverge the first time one changed.

Consequences worth stating:

- A chain of four same-tier fruit collapses to **two** merges, not one and not
  three: consuming a body blocks only the pairs that share it.
- Two disjoint pairs both merge in the same tick.
- A contact naming a body an earlier merge already removed is skipped, which is
  ordinary rather than exceptional.

When a merge resolves:

- Both fruit are removed and one of tier `n+1` appears at the **integer
  midpoint** of their centres. `i64::midpoint`, verified to round identically to
  `(a+b)/2` before it was adopted — this value is on the hashed path.
- The score gains `merge_score(n+1)`.
- **The new fruit gets no grace period.** It counts toward game-over
  immediately, matching the wrap's `nb.born = 0`. A merge high in the crate is
  supposed to be dangerous.
- **Two watermelons pop** for `POP_BONUS = 100` and create nothing. There is no
  twelfth tier.

## Game over

A fruit ends the run when it has been **settled above the danger line**
(`LINE_Y = 112`, measured to the fruit's top edge) for more than `DWELL_TICKS`
consecutive ticks.

- A fruit merely *falling* past the line is fine — every drop passes it on the
  way in. The dwell counter resets the moment a fruit is below the line again.
- A freshly dropped fruit is exempt for `GRACE_TICKS`. A **merged** fruit is not.

## The state hash

Lowercase-hex SHA-256 over a domain tag, then:

1. `pond_physics::hash::state_hash` of the world — positions, velocities, angles,
   radii, in id order, plus the tick.
2. The **score**. Two runs can reach the same board with different scores, and a
   record that could not tell them apart would be claiming the wrong thing.
3. The **RNG draw count**. An empty crate at the start and an empty crate after a
   drop-and-merge are different states: the stream has moved on.
4. The held tier, the previewed tier, the highest tier reached, the game-over
   flag.
5. Each fruit's id and tier, in id order.

## The verifiable outcome

The claim is **"on seed X this sequence of drops reached score S"** — the same
shape 2048 uses, because this is the same kind of game: an endless score-chase
rather than a puzzle with a solution.

`pond_outcome::Game` requires a `won: bool` and Orchard Drop has no terminal
victory. Rather than invent a condition, **`won` means a watermelon was grown**
(`max_tier >= 10`) — exactly the milestone the wrap's end screen already
celebrates. Score carries the real result.

## The daily pack

A seeded Fisher-Yates shuffle of a seed pool, truncated to a year, indexed by UTC
day and wrapping.

**No solver, and that is a claim rather than an omission.** Orchard Drop is never
unwinnable: the crate starts empty, every seed deals a droppable fruit, and there
is no deal that cannot be played. So the pack keeps the machinery the rest of the
shelf uses — a `pond-docformat` envelope, byte-identical regeneration — without
shipping an empty solver crate to look symmetric. Whether you grow a watermelon
is skill, not seed.

`every_daily_seed_is_playable` checks that claim across the whole year rather
than asserting it.

## Golden vectors

Five, each locking a widening slice:

| | scenario | what it locks |
|---|---|---|
| 01 | a fresh game | the seeded stream's first two draws, the empty state |
| 02 | one drop, settled | the physics seam |
| 03 | eight drops across the crate | the cooldown, the stream |
| 04 | twenty-four drops | the merge tie-break and the scoring |
| 05 | one column to overflow | the grace and the dwell |

Four believability guards sit beside them: the merge vector really climbed the
ladder, the game-over vector really ended, the fresh vector really is fresh, and
no two vectors reach the same state. A vector that hashes stably because nothing
happened proves nothing.

Regenerate with `ORCHARD_RECORD=1` — and only when a behaviour change is
*intended*. A vector updated to make a test pass has stopped being a vector.
