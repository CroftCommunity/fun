# Can a fixed-point circle solver hold a Suika pile, and match across targets?

**Verdict: YES on D1–D4 and D6. D5 (feel) needs a person and is not answered here.**

Phase 0 of `plans/2026-08-28-1-plan-orchard-drop-tier1.md`. This spike exists to
settle whether Orchard Drop can carry a **Tier-1 verifiable outcome** on a
hand-rolled fixed-point solver, rather than needing Rapier (whose determinism is
measured but only on one wasm engine) or staying a Tier-2 wrap.

Format follows `discovery/alpha/experiments/rapier-determinism/RESULT.md`, so the
two are comparable.

## Results

| | Question | Verdict |
|---|---|---|
| D1 | Does a 30-fruit pile settle and stay settled? | **PASS** — 2,534-tick quiet run (need 600), nothing escapes, penetration converges to the slop |
| D2 | Is the fixed-point envelope adequate? | **PASS** — overflow has 3,560x headroom, `sqrt` is exact, the impulse divide loses 1 sub-unit in 6.5M |
| D3 | `native == wasm`? | **PASS** — 10/10 digests identical, both believability guards hold |
| D4 | Is replay fast enough for a one-tap re-verify? | **PASS to ~6 min of play**, fails beyond; linear at ~40 ms per 1,000 ticks |
| D5 | Does it feel like the Matter version? | **NOT ANSWERED** — a judgement gate. `pile.svg` is the artifact to judge against |
| D6 | Can a divergence be diagnosed? | **PASS** — bisect names tick 140 on a deliberately-broken build |

## D1 — the pile

```
  tick   max_speed  total_speed  penetration  escaped  pile_h
   400         765         1131       29/1000        0     588
   800         515          645       38/1000        0     592
  1200           0            0       29/1000        0     423
  3599           0            0       29/1000        0     423

  final penetration: 0.500 px, against a slop of 0.500 px
  longest quiet run: 2534 ticks (need 600)
```

**Warm starting is the whole result.** Without it — the first version — the pile
sank into itself at **23.4% penetration** and never went quiet (best run 81
ticks). Twelve Gauss-Seidel iterations starting from zero cannot propagate floor
support up through a 400px pile. Persisting each contact's accumulated impulse
across ticks took penetration to **2.6%** and the quiet run to 2,477 ticks in one
change. It is stored in a key-sorted `Vec`, not a `HashMap`: hash iteration order
is exactly the nondeterminism this crate exists to avoid.

### The plan's D1 criterion was wrong, and this is the correction

The plan asked for "no circle penetrates another by more than **1% of its
radius**." That bar is **unsatisfiable by construction**: the solver's slop is an
*absolute* distance, and the ladder spans 7.5:1 in radius. 1% of a cherry is
0.17px — below any usable slop. 1% of a watermelon is 1.28px — above it. One slop
cannot be under both.

The measured 0.500px is *2.9% of a cherry's radius* and *0.4% of a watermelon's*.
It is the same contact, correctly resolved, passing or failing depending on which
fruit you measure it against. **The honest criterion is "penetration converges to
the slop"**, which is what resting contact means in any Baumgarte solver, and
which `d1_penetration_rests_at_the_slop_not_below_one_percent_of_radius` now pins.

## D2 — precision, and the term that would have underflowed

Overflow was computed at plan time and confirmed here: `dist²` peaks at 2.59e15
against `i64::MAX` 9.22e18. The precision findings are the interesting half.

```
  cherry     inv_mass  60648 (0.9254)   watermelon inv_mass  1069 (0.0163)
  mass ratio 56.7:1
  sqrt_raw round-trip error over 1..900 px:  0 sub-units
  impulse divide at 56.7:1: recovers 6553599 of 6553600 (1 sub-unit lost)
```

**`inv_inertia` for a watermelon underflows to exactly zero at shift-16** — its
inertia is 3.29e10, so the reciprocal is 1.98e-6, below one sub-unit. A solver
that stored an inertia term would silently stop rotating the largest fruit.

It never comes up, because **circles-only removes the term entirely**:

1. For a circle the contact offset `r` is parallel to the normal `n`, so
   `cross(r, n) == 0` — the **normal impulse has no angular term at all**.
2. For a uniform disc `I = m·r²/2`, so `r² · inv_I = 2·inv_m` *identically* — the
   radius cancels. The **tangent effective mass is exactly `3·k_n`**.

So the solver never stores or divides by an inertia. This is not a
micro-optimisation; it is the difference between the largest fruit rotating and
not. `d2_inv_inertia_would_underflow_which_is_why_the_disc_identity_matters`
stands as the record, so anyone who later "tidies up" by adding an inertia field
back at shift-16 gets a failing test rather than a subtly dead watermelon.

### The iteration count was set by measurement, not taste

The 30-fruit pile is stable at **every** iteration count tried (12 through 64).
What sets the constant is the ill-conditioned pair — a watermelon resting on a
cherry, 56.7:1 through a single contact:

```
  iters   worst_pen (ticks 200-1200)   worst_speed   converged?
     12                      245872            94    NO  (limit cycle)
     20                       27700             0    yes
     32                       31998             0    yes
     96                       31999             0    yes
```

At 12 it **limit-cycles indefinitely** between 0.1px and 3.75px of penetration —
it does not diverge, it oscillates, which is the failure mode that looks fine in a
screenshot. At 20 it converges and stays converged; 32 and beyond buy nothing.
`ITERATIONS = 24` is 20 with margin. **No split impulses needed** — this was an
iteration-budget problem, not a solver-formulation problem, which is the cheaper
of the two answers and was not the expected one.

## D3 — `native == wasm`

```
                                wasm                  native
  scenario                      0x5009981db53e3f57    0x5009981db53e3f57   MATCH
  perturbed                     0xa3d2547c4f0d4a1c    0xa3d2547c4f0d4a1c   MATCH
  broken (reversed contacts)    0x69b5232eaa6edf66    0x69b5232eaa6edf66   MATCH
  + 7 tick checkpoints (1, 100, 400, 800, 1200, 2400, 3600)             all MATCH
```

Digest = FNV-1a-64 over the bit patterns of every body's `(x, y, angle)` — the
same construction the rapier spike used.

**Expected to pass, and that is the point.** wasm `i64` arithmetic is exactly
specified by the standard, so this check is a guard against *our* mistakes — an
unstable iteration order, a `usize` width leaking onto the hashed path — not
against the platform. Contrast the rapier spike, where the feature under test was
load-bearing and its absence genuinely diverged.

A matching digest proves nothing on its own, so both believability guards from
that spike are here and pass: **one sub-unit** of change to the first fruit's
spawn `x` moves the digest, and the scenario demonstrably does work (30 fruit, a
423px pile, fruit reaching the crate floor). A third guard — same digest across
two runs in one process — rules out global state masquerading as a platform result.

## D4 — replay cost, and a finding about long-lived instances

Cold, one call per fresh Node process, which is the shape a one-tap re-verify has:

```
   ticks   game length   cold wasm   ms/1k ticks
    3600     0.9 min        126 ms          35.5
    9000     2.3 min        342 ms          38.8
   18000     4.7 min        731 ms          44.3     <- the plan's 1000 ms bar
   36000     9.4 min       1491 ms          42.3
   57600    15.0 min       2339 ms          39.6
```

Linear at ~40 ms per 1,000 ticks. **The 1-second budget holds to about 24,000
ticks — a little over six minutes of play** — and a 15-minute game costs 2.3s,
which is the multi-second stall the plan called a design problem. Phase 5 should
carry the mitigation the plan already named (a checkpointed hash), and now has a
number to size it against.

**Measurement hazard worth recording:** the same 18,000-tick call measured
**1,206 ms**, then **797 ms**, then **731 ms** depending on how many calls
preceded it *in the same wasm instance*. It is not JIT warm-up — the fastest
number is the coldest one. Repeated replays in one long-lived instance degrade,
most likely allocator churn in a linear memory that never shrinks. Two
consequences: this spike measures in a fresh process per data point (spread
717–731 ms, tight), and **Phase 3's binding must not accumulate heap across
replays.**

## D5 — feel: NOT ANSWERED

D5 is a judgement gate and needs a person. What exists to judge:

- **`pile.svg`** — six frames (ticks 200, 500, 900, 1400, 2000, 3600) in the
  vendored game's palette, each fruit drawn with a radius line so **rotation is
  visible**. Rotation is the specific thing D5 asks about ("does fruit *roll* off
  a pile the way it does now").
- The live wrap at `/orchard-drop/` to compare against. **This comparison is only
  possible before Phase 4**, which deletes the vendor bundle.

What can be said without judgement: fruit do rotate and the rotations vary across
the pile, so rolling is happening rather than absent. Whether it *reads* right is
not something this spike can assert.

## What this does NOT establish

- **One wasm engine.** Node 22 (V8) only. Unlike the rapier result this is
  low-risk — integer arithmetic is exactly specified where float transcendentals
  are not — but "low-risk" is not "measured." iOS Safari (JavaScriptCore) is
  untested, and `fun`'s e2e gate is chromium-only, so it would not catch a JSC
  difference either.
- **One machine.** aarch64 Darwin. No x86_64 native build was tested.
- **No merging.** The spike simulates fruit falling and stacking. Merge resolution
  — including the three-body tie-break the plan flags as the subtle correctness
  requirement — is Phase 2 and is not exercised here.
- **Constants are not ported, they are chosen.** Gravity is 1000 px/s² at 64 Hz,
  picked to fall convincingly, not derived from Matter's `gravity.y = 1.35 ×
  gravity.scale 0.001` at a millisecond `dt`. Restitution, friction and density
  are read across from the vendor file, but they act inside a different solver.
  Re-deriving the feel constants is real Phase 1/4 work and D5 is where it lands.
- **Body count is fixed at 30.** A real game merges, so the count moves. The D4
  cost is `O(N²)` in the broadphase and roughly linear in contacts.

## A design note that came out of the spike

**The timestep is 1/64 s, not 1/60.** A power-of-two `dt` is exact in binary;
`1/60` is not, so it would inject a rounding error into every integration on the
hashed path. It costs nothing and removes an error source. The consequence is that
the vendored game's wall-clock constants convert to slightly different tick counts
than a 60 Hz assumption would give (520 ms cooldown → 33.28 ticks, so 33), which
Phase 2 should quantise deliberately rather than by accident.

## Provenance

| | |
|---|---|
| rustc / cargo | 1.97.1 (the repo pin; resolved via `rustup which`) |
| native target | aarch64-apple-darwin |
| wasm target | wasm32-unknown-unknown, run under Node v22.23.2 |
| dependencies | **none** — the crate has an empty `[dependencies]` |
| date | 2026-08-28 |

## Reproducing

```
cd spike/orchard-physics
export PATH="$(dirname "$(rustup which cargo)"):$PATH"   # Homebrew's cargo has no wasm std

cargo test --release                                      # the 11 pinned findings
cargo run --release --bin measure                         # D1, D2, D4 native
cargo run --release --bin sweep                           # the iteration-count sweep
cargo run --release --bin digests > native-digests.json   # native goldens
cargo build --release --target wasm32-unknown-unknown
node verify.mjs                                           # D3, D6, D4 warm
node cold-replay.mjs 18000                                # D4 cold (the honest number)
cargo run --release --bin snapshot > pile.svg             # the D5 artifact
```

## Disposition

Per the plan: `fixed.rs` and `world.rs` are **`promote`** — they become
`crates/pond-physics` in Phase 1, under TDD there, with these findings as the
starting vectors. Everything else (`scenario.rs`, the four bins, `verify.mjs`,
`cold-replay.mjs`) is **`throwaway`**, except `verify.mjs`'s bisect, which is
`promote` into the Phase 6 cross-check.

**This crate is deliberately not a workspace member** and must not enter the Rust
gate — same posture as `spike/dots-solve`.
