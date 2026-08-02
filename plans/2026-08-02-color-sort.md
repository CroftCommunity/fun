# Color Sort — build plan

Tier-1 Croft-native water/ball/bolt sort puzzle. One deterministic engine, three
render skins, daily + endless modes. Build brief: the task description in this
session (grounded in Ito et al., arXiv:2202.09495).

Reference implementations read before writing: `twenty48-core`/`twenty48-wasm`
(cleanest core→wasm→pack slice), `align` (daily+free+modes+settings+share UI),
`bubble-solver`/`solitaire-solver` (build-time pack generator), `pond-outcome`,
`share.ts`.

## Problem

Ship a determinism-first sort puzzle that feels native to the shelf: tap-source →
tap-target with the core deciding legality, verifiable `pond-outcome` + `?r=`
share, a baked winnable-daily pack, three instant-swappable skins, colorblind
fruit icons, Free/Strict play, unlimited undo (Free), hint via solver, deadlock
detection, WCAG-AA in both themes, "How to play" guide, full gate green, deployed.

## Reasoning — reconciling the brief with shelf conventions

The brief is written in JS/TS terms (a JS engine, mulberry32, a Web Worker A*
solver, local-date seed strings). The shelf (CLAUDE.md, BUILDING-GAMES.md) is
**non-negotiably** Rust-core-first, determinism-critical, native==wasm, no floats
on the hashed path, TDD. Where they conflict, the shelf wins (CLAUDE.md overrides).
The equivalences the brief's *design* asks for are preserved; only the *mechanism*
moves to the shelf's idiom:

1. **Engine → Rust core, not JS.** `legalMoves/applyMove/isWon/isDeadlocked` become
   a pure `color-sort-core` crate (integer-only, golden vectors, `state_hash`).
   Water-move semantics everywhere; skins are pure rendering (equivalence theorem,
   Ito et al.). One engine shared by game, generator, solver, outcome-replay.

2. **PRNG → ChaCha20 `DetRng`, not mulberry32.** The shelf's shared determinism
   primitive (`crates/*/src/rng.rs`): `ChaCha20Rng::seed_from_u64`, `u32`-width
   draws for native==wasm parity, Fisher–Yates `shuffle`. The brief's "same seed →
   same deal forever" holds; `Math.random()` is never called.

3. **Seed strings → `dayIndexUTC` + baked pack.** The brief's
   `"color-sort:daily:"+YYYY-MM-DD` local-date scheme is replaced by the shelf's
   actual daily convention (checked: `share.ts::dayIndexUTC`, whole UTC days since
   epoch, indexed into a baked seed pack). This matches every other daily game
   (solitaire, bubble, 2048, align, wyrdle) so results are comparable and the
   rollover is consistent. Endless seeds are `endless_seed(level)` = a fixed hash
   of the level (no pack).

4. **Web Worker A* → build-time Rust solver + synchronous runtime solver.** The
   shelf has **no** Web Workers; solvers run at *build time* in Rust to certify a
   winnable-daily pack, and runtime hints call synchronously into wasm. Color-sort
   at `h=4` solves fast (budgeted DFS with canonical-state dedup + heuristic move
   ordering terminates in well under the brief's 200k-node / ~1s budget), so:
   - **Daily** deals come from a baked winnable-daily pack (`color-sort-solver`
     certifies each seed solvable and records `par`); zero runtime solve to start.
   - **Endless** deals generate at runtime in wasm (deterministic generator loop,
     solver-verified) — fast at the reached sizes; bounded by the node budget so it
     can never hang.
   - **Hint** solves from the current state synchronously in wasm.
   This is the shelf-native mechanism for the brief's "solver verifies deals /
   par / hint" and its "never jank" goal. A background worker is a possible
   fast-follow but is deliberately *not* introduced (it would be the repo's first,
   and is unnecessary at this puzzle size). The brief's A* is realized as a
   budgeted best-first/DFS search with the brief's exact heuristic (color-breaks +
   bottom-color surplus) as the move-ordering key and canonical (sorted-tube) state
   keys — same search idea, shelf-idiomatic shape.

5. **Solver optimality.** Par = length of the solver's returned line (brief §3);
   we do **not** claim shortest (NP-complete, brief §1). Honest "par" wording.

## The engine (brief §2, authoritative)

- State: `n+k` tubes, each a bottom→top stack of color ids `0..n-1`, capacity
  `h=4`. Daily: `n=10, k=2`. Endless ramps `n` by level, `k=2`.
- Legal pour `A→B`: `A≠B`, `A` non-empty, `B` not full, and (`B` empty or
  top(B)==top(A)).
- Pour quantity: maximal contiguous top-color run of `A`, truncated by `B`'s free
  space (partial pours are real).
- Win: every tube empty or full-monochrome.
- UI rulings (enforced in the *binding's* legal-move list so the core owns
  legality, per §4): locked full-monochrome tubes untappable; monochrome→empty
  blocked (vacuous); deadlock = no legal non-blocked pour and not won.
- `state_hash`: SHA-256, domain tag `b"cs1\x00"`, `h`, `n`, `k`, then each tube as
  `(len, bytes…)`. Tube order is fixed for the life of a level, so the hash is over
  tubes **in play order** (not sorted) — the *solver's* dedup key sorts tubes, but
  the game/replay hash must pin the actual arrangement.

## Phases (each ends green + committed)

- **P0 — plan** (this doc).
- **P1 — `color-sort-core`** (TDD): `rng.rs` (DetRng+shuffle), `tube.rs`/`board.rs`
  (State), `engine.rs` (legal_moves/apply_pour/is_won/is_deadlocked, maximal-run
  pour), `generate.rs` (deterministic deal), `hash.rs`, `game.rs` (play-loop +
  undo + `pond_outcome::Game` for `ColorSort`), golden vectors, `RULES.md`. Tests:
  brief §10.1–5,7 (pour quantity, legality, UI rulings, win/deadlock, determinism
  snapshot, skin-invariance is a UI test but core exposes stable state).
- **P2 — `color-sort-solver`** (TDD): budgeted best-first DFS, canonical sorted-tube
  keys, color-breaks heuristic; `find_win(state,budget)`, `par` for a deal,
  `generate_pack(master, count, budget, …)`, `pack_to_doc` (`kind =
  "color-sort-daily-pack"`). Generator test writes `games/color-sort/daily-pack.json`
  (n=10,k=2,h=4, one year of certified-winnable deals + par + a fixture solution);
  byte-identical regen test. Brief §10.6 (solves trivial, flags unsolvable
  `k=0` interleave, par==line length).
- **P3 — `color-sort-wasm` + `color-sort-wasm.ts`**: raw C-ABI, holds one session,
  never panics. Exports: `new_daily(day)/new_endless(level)/new_seed(seed,n,k)`,
  `board_json` (tubes + locked + legal-target mask + won + deadlocked + par +
  moves), `legal_targets_for(src)`, `pour(from,to)`, `undo`, `restart`, `hint`
  (from→to or none/unsolvable), `mark_assistance`, `current_hash`, `outcome_json`,
  `daily_seed`/`daily_par`, plus a verifier path. Typed TS wrapper.
- **P4 — `src/games/color-sort/color-sort.ts` GameModule** + `color-sort-outcome.ts`
  + `color-sort-howto.ts`: tap→tap with core legal-target glow; water/ball/bolt
  skins (DOM, CSS transitions, one-pour = m-unit animation, one move); fruit icons
  (defaults per skin); Free(undo)/Strict; hint/undo/restart/deadlock banner; daily
  (par + share line) / endless (level ramp + "Next level"); win celebration;
  keyboard operable; centred responsive layout; `?r=` share + shared-view.
- **P5 — wiring**: `registry.ts` (`status:"playable"`, `/color-sort/` URL),
  `how-to-registry.ts`, append-only `tokens.css` hues + WCAG rows, `styles.css`
  (semantic tokens only), `build.mjs` (GAME_PAGES + wasm copy + pack copy),
  `build-wasm.sh` (`-p color-sort-wasm`), `settings.ts` (skin/icons/free-strict),
  workspace `Cargo.toml` members + dep.
- **P6 — gate + deploy**: unit + e2e (incl. axe + tap-legality guardrail + skin
  invariance), `guide:shots`, `cargo test --workspace` + `fmt` + `clippy pedantic`,
  `npm run test` + `npm run e2e`. Commit each green point. Push to
  `claude/color-sort-puzzle-nzhf74`.

## Verified assumptions

- **Toolchain**: `cargo 1.94.1`, `wasm32-unknown-unknown` target installed
  (added this session); `node v22`. Confirmed.
- **Daily convention** is `dayIndexUTC` (UTC days since epoch) → baked pack seed,
  not local-date strings. Confirmed by reading `share.ts` + every daily game.
- **No Web Workers exist**; solvers are build-time Rust; runtime hints are
  synchronous wasm. Confirmed by grepping `src/`.
- **PRNG** is ChaCha20 `DetRng` per-crate (copy-adapt), not a shared crate.
  Confirmed. `u32`-width draws are mandatory for native==wasm.
- **Pack** = `pond-docformat` `{seeds,fixture}` (+ `par`/certified line for a
  solver-gated game) committed as `games/<id>/daily-pack.json`, embedded via
  `include_bytes!`, generated by an `#[ignore]`d generator test with a
  byte-identical regen test. Confirmed (2048/bubble).
- **Outcome** = implement `pond_outcome::Game` (`type Move`, `KIND`, `VERSION`,
  `replay`); `attest`/`verify`/`to_doc` come free. Share via `share.ts` unchanged.
  Confirmed.
- **UI**: module = `{mount,unmount}`, loads game + verifier wasm, handles
  `?r=`/`?seed=`/daily, reuses `sol-result` result styling, shared `settings.ts`
  toggles, `el()` helper, exposes an E2E `window.__` hook. Confirmed (align).

## Out of scope (brief §11)

Mystery/hidden-layer mode, power-ups, level skips, monetization, accounts, servers.
Don't preclude mystery mode; don't build for it.
