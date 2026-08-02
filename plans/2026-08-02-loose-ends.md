# Loose Ends — arrow-release puzzle (Tier-1)

An arrow-release / "tap-away" puzzle. A grid is filled with snake-shaped arrows;
tapping a **FREE** arrow (its exit ray to the board edge is clear) releases it
with a train-style slide. Tapping a **BLOCKED** arrow costs a droplet (3 per
level). Clear every arrow to win. 100-level campaign + a daily calendar, all
procedurally generated from deterministic seeds.

## Problem

The shelf wants a Croft-native (Tier-1) game whose whole point is
"tap-first, the core decides legality" — Loose Ends is exactly that: the core
owns the FREE/BLOCKED decision and the release, the UI only renders and taps.
Everything is generated from a seed (no level data files), so it must be
deterministic native==wasm and verifiable by move-list replay.

The supplied spec (task `CLAUDE.md`) is written in JS with a float RNG
(FNV-1a + mulberry32). The shelf mandates a determinism-first Rust core with no
floats on the hashed path. These are reconciled below, not chosen between.

## Reasoning

- **Tier-1, not a self-contained `index.html`.** The spec's default deliverable
  is a standalone page, but "deploy to fun.croft.ing" means it lives on the
  shelf, reachable at `/looseends/` through the drawer registry, with a Rust
  core, a how-to, and the full gate (BUILDING-GAMES §1, §8; project CLAUDE.md
  "built means wired means tested"). The game's mechanics map cleanly onto the
  Tier-1 contract:
  - *tap-first, core decides legality* (§4): FREE test lives in the core; a tap
    on a BLOCKED arrow is a no-op (a lost droplet is UI-side lives, not a rules
    change).
  - *verifiable outcome* (§3): the move list is the ordered ids of released
    arrows; replay re-derives the final `state_hash` and win. A clean solve
    (no mistakes/hints) is `Won` + no assistance.
- **RNG: port mulberry32 integer-exact.** mulberry32 returns `k / 2^32` with `k`
  a `u32`. Every use in the generator is `(rng()*N)|0` or `rng() < 0.5`. Both are
  exact integer facts of `k`: `(rng()*N)|0 == ((k as u64 * N) >> 32)` (since
  `k*N < 2^36 < 2^53`, the float product is exact) and `rng() < 0.5 ⟺ k < 2^31`.
  So the core keeps the `u32` state and never touches a float on the generation
  path — native==wasm by construction, and byte-identical to the spec's JS
  reference. FNV-1a string hash ports directly (`u32` wrapping mul).
- **Level/daily config sizing uses f64**, exactly mirroring the spec's
  `Math.round(a + b*t)`. IEEE-754 `+ - * /` are bit-identical on native and
  `wasm32`, and `Math.round(x)` for our always-positive values is
  `floor(x + 0.5)`. Config is a pure deterministic function of `n` / seed; it
  never enters `state_hash`, so this does not violate "no floats on the hashed
  path" (the hashed path is generation + release, which are integer-exact).
- **Solvable by construction** (spec §4): arrows are placed in reverse solution
  order, each new arrow's exit ray required clear of everything placed *and* of
  its own body, so releasing in reverse placement order always succeeds. The
  greedy solver in the solvability test is the proof, not the generator's hope.
- **Screens live inside the module.** The shelf gives the game one mount point;
  Home / Level-select / Daily-calendar / Game / modals are internal views the
  module swaps within its container (like a mini-router), so the game is fully
  self-contained under `src/games/looseends/`.

## Verified assumptions

- `pond-outcome::Game` needs `replay(seed, moves) -> Replayed` and a `KIND` /
  `VERSION`; `attest`/`verify`/`to_doc` are shared (read `crates/pond-outcome`).
  Loose Ends is graded (stars/score), so `Replayed::scored` carries them.
- The raw C-ABI binding pattern (held `STATE`, `OUT` buffer, `out_len`,
  `set_out`, never-panic) is copied from `twenty48-wasm` (read in full).
- `build.mjs` needs `looseends` in `GAME_PAGES`; `tools/build-wasm.sh` needs
  `-p looseends-wasm`; `build.mjs` copies `crates/.../looseends_wasm.wasm` to
  `dist/looseends.wasm` (mirror the 2048 wiring — verified in build.mjs).
- Determinism seed values are `u32` (FNV-1a output); the C-ABI takes a `u32`
  seed and a `u32` level number.

## Phases (commit at each green point)

1. **Core RED→GREEN.** `crates/looseends-core`: `rng` (FNV-1a + integer
   mulberry32) → `board` (occupancy, FREE test, release) → `generate` → `config`
   → `hash` → `Game` impl. Tests first: RNG golden vectors vs the JS reference,
   then the four §12 acceptance tests as Rust tests (solvability over all 100
   levels + ≥52 dailies, determinism byte-identical, fill ≥70%/level-1 exact,
   perf <3 s), plus FREE/release unit tests. `cargo test`, `fmt`, `clippy`.
2. **wasm binding.** `crates/looseends-wasm` raw C-ABI; wire `build-wasm.sh`,
   `Cargo.toml`, `build.mjs`. Cross-build (`xbuild` parity if applicable).
3. **TS module.** `looseends-wasm.ts` wrapper; `looseends.ts` GameModule — canvas
   render + train slide, pointer tap/pan/pinch/wheel, HUD droplets + hint,
   internal views, win/fail modals, persistence, themed canvas via tokens.
4. **Wire + guide.** registry entry, how-to data + registry, append `tokens.css`,
   wiring test through `/looseends/`, unit + e2e, `guide:shots`. Full gate green.
5. **Ship.** Commit each green step; push `claude/loose-ends-game-uspvk3`.
