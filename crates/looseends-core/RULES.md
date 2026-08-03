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

## Sizing — level & daily

`level_config(n)` (`n = 1..=100`) and `daily_config(seed)` mirror the spec's
`levelConfig` / `dailyConfig` exactly, sizing with `f64` `Math.round` (`floor(x +
0.5)` for the always-positive values here). Sizing is a pure deterministic
function and never enters the state hash, so the hashed path stays integer-only.
A `Config` packs into one `u64` (`seed:32, w:5, h:5, target:7, min_len:3,
max_len:4`) so an outcome record regenerates its exact board from the seed alone.

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
level 1 / level 50 full boards, and the arrow counts for all 100 levels. The
§12 acceptance tests (`tests/acceptance.rs`) prove solvability (100 levels + 365
dailies), determinism, fill ≥ 70% (level 1 exact), and generation of all 100
levels in well under 3 s.
