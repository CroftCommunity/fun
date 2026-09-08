# looseends-core — rules & determinism contract

The deterministic heart of the `fun.croft.ing` Loose Ends game. Source of truth
for the arrow model, the FREE test, release, the seeded generator (solvable by
construction), level/daily sizing, the state hash, and the verifiable outcome.
Boards are generated purely from a seed — there are no level data files — and the
whole hashed path is integer-only, so native == wasm and a cleared board is a
verifiable `(packed_seed, release-order)` record.

## The board

A grid `W × H`, cell index `i = y*W + x`. Occupancy holds an arrow id or `-1`.

An **arrow** is a 4-connected, self-avoiding path of cells ordered **tail → head**
plus a unit head direction `dir = [dx, dy]` (the step from `cells[len-2]` onto the
head cell). Every arrow has at least two cells.

## FREE and release

An arrow is **FREE** iff the straight ray from `head + dir`, stepping by `dir`,
reaches the board edge with every visited cell empty (`-1`). A missing / already
released arrow is not FREE.

**Release** clears a FREE arrow's cells to `-1` immediately and decrements the
remaining count, so the next release sees the updated board (matching the game,
where occupancy frees the instant a slide starts). Releasing a non-FREE, unknown,
or already-gone arrow is a reported error — never a panic. Clearing every arrow is
a **win**.

## Locks — a locked arrow needs its key freed first (2026-09-08, plan `looseends-mechanic`)

A board may carry `(locked, key)` pairs. The locked arrow is **not FREE while its key
is still on the board**, ray clear or not, and unlocks the instant the key is released;
a pair naming an id that does not exist holds nothing. `is_free` is therefore two
clauses — `ray_clear` and no key held (`key_of`) — and `release`, `free_arrows`,
`greedy_solve` and the hint all go through it. `release` reports a **blocked ray before
a lock**: the ray is the visible fault, so that tap is a mistake; a tap on a locked arrow
with a clear ray is `Locked(key)` — information for the player (the UI flashes the key),
never a mistake and never a move. Locks are geometry, a function of the seed like the
arrows (levels 1–7 and every daily have none), and they **never
enter the state hash** — occupancy already says whether the key is present, so a board
with locks hashes exactly as the same board without (pinned by a test).

## The RNG — integer-exact port of the spec

`hash_str` is FNV-1a over a key's bytes (ASCII keys only). `Rng` carries the
spec's `mulberry32` as its raw `u32` output stream. Every generator use is either
`(rng()*n)|0` (= `((k as u64 * n) >> 32)`) or `rng()<0.5` (= `k < 2^31`), both
exact integer facts of the draw `k`, so no float ever touches the generation path
and the stream is byte-identical to the spec's JS reference.

## The generator — solvable by construction

Arrows are placed in **reverse solution order**. Each candidate is a seeded
self-avoiding random walk (50% bias to continue straight); it is accepted in
whichever orientation has an **exit ray clear of every placed arrow and of its own
body**. Because the ray is clear at placement, releasing arrows in reverse
placement order always succeeds — so **every board fully clears under a greedy
"release any FREE arrow" solver** (the solvability test is the proof, not a hope).
Up to 6 deterministic retries (the RNG stream continues) keep the attempt with the
most arrows; generation stops early at 85% of target. Fill lands at 70–100% of
target; level 1 lands exactly on target.

### The lock draw

After the retry wrapper has picked its attempt — so every arrow layout, and every
golden recorded before locks existed, is byte-identical — `cfg.locks` pairs are drawn
from the **same RNG stream**: a locked arrow among all but the last placed
(`below(n − 1)`), then a key among the arrows placed **after** it whose body touches
its body (`below(candidates)`), ascending candidate order. A draw with no candidate,
or on an arrow already locked, is skipped and the stream moves on; the draw is bounded
at `24 × locks`, so a board with nothing touching yields fewer locks rather than never
returning (the generator's count test says if any level does — none of 8–100 does).
One lock per arrow; a key may itself be locked by a later arrow (a chain), and it still
releases in reverse placement order. Goldens: the pairs for levels 8, 50 and 100.

## Sizing — level & daily

`daily_config(seed)` mirrors the spec's `dailyConfig` exactly. `level_config(n)`
(`n = 1..=100`) is the curve **rebased 2026-09-08** (mock F Q10): `w = 6 + 12t`,
`h = 8 + 18t`, `target = 10 + 58t`, `min_len = 3`, `max_len = 5 + round(7t)` — level 1
is ten arrows on 6×8 (a knot to read, not three arrows on a 5×6), the top of the
curve is where the spec put it (68 on 18×26). Both size with `f64` `Math.round`
(`floor(x + 0.5)` for the always-positive values here). `locks` (2026-09-08) is integer:
`0` through level 7, then `1 + floor((n − 8) · 7 / 92)` — one at level 8, eight at level
100; a daily has none. Sizing is a pure deterministic function and never enters the
state hash, so the hashed path stays integer-only. A record carries the **`Origin`**
(a mode bit plus the level number or the daily seed, `< 2^33`, an exact JS integer),
never a `Config`: replay regenerates the exact board — locks included — from that alone.
(This used to claim a `Config` packed into one `u64`; no such packing ever existed.)

## State hash

Lowercase-hex SHA-256 over: a domain tag `"loose\0"`, `W`, `H`, the count of
arrows still present, then the row-major occupancy (`i32` LE per cell). Integer,
little-endian ⇒ byte-identical native and `wasm32`. A cleared board hashes to one
fixed value per size.

## Verifiable outcome

`LooseEnds: pond_outcome::Game` with `Move = u32` (arrow id) and `KIND =
"looseends"`. `replay(packed_seed, moves)` regenerates the board and applies each
release (a tampered id is a no-op, so the hash diverges), then reports the final
hash + whether cleared. A clean solve is `Won` with no declared assistance.
Mistakes (blocked taps) and hints are UI-side and **not** in the move list — they
are declared metadata, graded for display by `score::{stars, score}` (`3★`
flawless, `2★` for one mistake-or-hint, else `1★`; score `max(300, 1500 -
300·mistakes - 200·hints)`).

## Golden vectors

`rng.rs`, `config.rs`, and `generate.rs` carry golden vectors captured from the
spec's exact JS reference: the FNV hashes, the `mulberry32(12345)` raw draws,
level 1 / level 50 full boards, and the arrow counts for all 100 levels; since
2026-09-08 also the lock pairs for levels 8, 50 and 100 (recorded from the generator)
and three `state_hash` vectors in `hash.rs`. The §12 acceptance tests
(`tests/acceptance.rs`) prove solvability (100 levels + 365 dailies — with the locks,
since the greedy solver goes through `is_free`), determinism, fill ≥ 70% (level 1
exact), and generation of all 100 levels in well under 3 s.

`vectors/*.json` is the cross-build corpus — `(level, releases) → state_hash` —
pinned natively by `tests/vectors.rs` and replayed inside `wasm32` by `crates/xbuild`
(`npm run test:xbuild`): level 8 fresh, level 8 through its key and then its lock, the
same with the lock tapped first (a no-op, so the same hash), and a greedy clear of
level 100 with its eight locks.
