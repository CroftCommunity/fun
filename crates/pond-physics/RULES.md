# pond-physics — the rules

The deterministic substrate under the shelf's physics games. This document is the
contract the golden vectors in `vectors.rs` lock; if a statement here changes, a
vector re-locks and the change is deliberate.

## What this crate is, and what it refuses to be

Discs against static axis-aligned boxes, under gravity, with friction. That is
the entire vocabulary.

**Not implemented, on purpose:** polygons, compound shapes, joints, springs,
motors, sleeping, islands, spatial hashing, continuous collision detection,
raycasting, triggers. The shelf's one physics game needs none of them, and each
would be a subsystem to get deterministically right for no measurable gain. A
future game that needs one should add it against tests, not find it already here
and untested.

The narrowness is not a limitation to apologise for — it is what makes the solver
small enough to be exactly specified, which is the property the whole crate
exists for.

## Determinism

**The claim:** a world built from the same bodies, stepped the same number of
times, produces a byte-identical `state_hash` on any target and in any process.

Four things make that true, and all four are load-bearing:

1. **No floats anywhere.** Shift-16 `i64` throughout (`fixed`), with `i128`
   widening inside `div` only. Integer arithmetic is exactly specified by the
   wasm standard; float transcendentals are not.
2. **No transcendental functions.** Discs need one integer square root and
   nothing else — no `sin`, `cos`, `atan2`, and no committed direction table
   either (this crate never aims by angle).
3. **Contacts resolve in a canonical order**, sorted by `(class, low id, high
   id)` — walls first, then bodies. Ids are the order, not array positions, so
   inserting or removing a body cannot reshuffle what remains.
4. **The warm-start cache is a key-sorted `Vec`**, never a `HashMap`. Hash
   iteration order is precisely the nondeterminism this crate exists to avoid.

**A/B roles follow id order, not array order.** For a body-body contact, A is
the lower-id body and the normal points from A to B. Keying by id while assigning
roles by index would leave the normal's *direction* dependent on insertion order
— a real bug, caught by `insertion_order_does_not_change_the_result` on its first
run.

## The timestep

`TICK_HZ = 64`, so `DT = 1/64` exactly.

A power of two is representable in binary; `1/60` is not, and would inject a
rounding error into every integration on the hashed path. The cost of the choice
is that a game's wall-clock constants convert to slightly different tick counts
than a 60 Hz assumption gives (520 ms is 33.28 ticks). That conversion is the
*game's* rule to make and write down, not something to round silently.

## The solver

Semi-implicit Euler, then sequential impulses with Baumgarte position
correction, then position integration. Per tick:

```
  v += gravity * dt                     for every body
  contacts = broadphase + narrowphase   O(N^2); N is a few dozen
  sort contacts by (class, low id, high id)
  warm start: apply each contact's impulse from last tick
  repeat `iterations` times:
      for each contact: solve normal, then tangent
  p += v * dt                           for every body
  cache this tick's impulses
```

### Two identities that delete most of an engine

For a **circle**, the contact-point offset `r` is parallel to the contact normal
`n`, so `cross(r, n) == 0`:

> **The normal impulse has no angular term.** `k_n = inv_m_a + inv_m_b`.

For a **uniform disc**, `I = m·r²/2`, so `r² · inv_I ≡ 2 · inv_m` — the radius
cancels:

> **The tangent effective mass is exactly `3 · k_n`.**

Together these mean the solver **never stores or divides by an inertia**. That is
not tidiness. At shift-16 a watermelon's `inv_inertia` is `1.98e-6`, which
**underflows to zero**, and a solver holding that field would silently stop
rotating the largest fruit. `Body::ang_response` carries the quantity that
survives — `2 · inv_mass / radius` — and
`inv_inertia_would_underflow_which_is_why_no_inertia_is_stored` stands guard over
the reasoning.

### Warm starting is what makes a pile stand up

Each contact's accumulated normal and tangent impulses carry into the next tick
and are applied before the iterations run, so the iterations refine a
nearly-correct answer rather than finding one from zero.

Measured both ways in the Phase 0 spike (`spike/orchard-physics/RESULT.md`, D1):

| | penetration | longest quiet run |
|---|---|---|
| without warm starting | **23.4%** of a cherry's radius | 81 ticks |
| with warm starting | 0.500 px — exactly the slop | 2,534 ticks |

Sequential impulses cannot propagate floor support up through a 400 px pile in
one tick's worth of iterations, and a pile is nothing but that propagation.

### Resting contact converges to the slop, not to zero

A Baumgarte solver holds resting bodies exactly `slop` deep. **Do not assert a
penetration bar as a percentage of radius:** the slop is an absolute distance and
the ladder spans 7.5:1, so 1% of a cherry (0.17 px) is below any usable slop
while 1% of a watermelon (1.28 px) is above it. One slop cannot be under both.
The honest bar is "penetration converges to the slop".

### `iterations` is set by the worst-conditioned pair, not by the pile

A 30-fruit pile is stable at every count from 12 to 64. A **watermelon resting on
a cherry** — 56.7:1 through a single contact — is not: at 12 it **limit-cycles
indefinitely** between 0.1 px and 3.75 px of penetration, which is the failure
mode that looks fine in a screenshot. It converges at 20 and stays converged.
`24` is 20 with margin.

`twelve_iterations_is_not_enough_which_is_what_set_the_constant` fails if that
ever stops being true, so the constant can be revisited downward with evidence.

## The fixed-point envelope

Computed, not assumed:

| quantity | value | limit |
|---|---|---|
| worst separation (440×640 crate) | 776.66 px = `5.09e7` | — |
| `dx² + dy²` raw square | `2.59e15` | `i64::MAX` `9.22e18` — **3,560× headroom** |
| `(r₁+r₂)²` at the ladder top | `2.82e14` | — |
| ladder mass ratio | 56.7 : 1 | — |
| `sqrt_raw` round-trip, 1–900 px | **exact** | — |
| `div` loss at the mass extreme | 1 sub-unit in 6,553,600 | — |

Overflow is not the risk at shift-16; precision in `div` is, and it was measured
rather than feared. `div` widens to `i128` because `a << 16` overflows `i64`
above `1.4e14`, which an accumulated impulse in a deep pile reaches.

## The state hash

Lowercase-hex SHA-256 over a domain tag, the tick, the body count, then each body
**in id order**: id, position, velocity, angle, angular velocity, radius. Every
integer little-endian.

- **Id order, not insertion order** — two worlds holding the same bodies are the
  same world however they were built.
- **The tick is hashed.** A settled pile is otherwise identical tick after tick,
  and a replay must still know where it is.
- **Angle is hashed**, though the solver never reads it. It is presentational to
  the *game* but accumulates from `ang_vel`, which the solver does read; hashing
  it makes the cross-build check sensitive to an angular divergence that would
  otherwise stay invisible.
- **Walls are not hashed.** They are fixed for the life of a world, and hashing
  them would re-lock every vector the first time a wall moves a pixel.

## Degenerate cases

- **Two centres in the same place** has no direction to separate along. `V2::normalize`
  returns `None` rather than choosing, and the solver picks straight up — so the
  decision lives where the context is, and nothing divides by zero.
- **A point inside a wall box** clamps to itself. Callers must recognise it for
  the same reason.
- **A contact between two static bodies** has `k_n == 0` and is skipped.

## Golden vectors

Five, in `tests/vectors.rs`, each locking a widening slice of the pipeline:

| | scenario | what it locks |
|---|---|---|
| 01 | free fall, 64 ticks | the integrator alone |
| 02 | one bounce to rest | restitution, rest threshold, slop |
| 03 | two bodies stacked | warm starting, at its simplest |
| 04 | watermelon on cherry | the ill-conditioned pair that set `iterations` |
| 05 | thirty fruit, 3,600 ticks | the whole pipeline under load |

Vector 05 carries a **believability guard** (`the_settle_vector_is_not_inert`):
thirty bodies present, the pile settled and standing, fruit at the crate floor,
penetration within the slop. A vector that hashes stably because nothing happened
proves nothing.

Regenerate with `POND_PHYSICS_RECORD=1` — and only when a behaviour change is
*intended*. A vector updated to make a test pass has stopped being a vector.
