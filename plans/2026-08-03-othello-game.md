# P7 — Othello (Reversi): the second adversarial game — the generality proof

> Pass 1 (develop). A full Tier-1 Croft-native build of Othello: a determinism-first
> Rust core → wasm with a verifiable outcome, a **heuristic** Oracle (Othello is
> not solved from the opening; exact only in the deep endgame), and the same
> engine-grounded tutor + experimental hybrid opponent — reusing the
> **game-agnostic** TS harness (`ai-runtime.ts`, `hybrid-player.ts`) and the UI
> patterns Drop 4 established. The point is generality: a new game slots into the
> `Adversary` trait + the shared harness + the tutor interface. Repo: `fun`.

## Problem Statement

Drop 4 proved the shelf can host a two-player adversarial game with a computer
opponent, a verifiable outcome, an engine-grounded tutor, and an experimental
in-browser-LLM hybrid. But everything vault-adjacent — the `Adversary` trait, the
band/tutor machinery, the TS harness (`AIRuntime`/`HybridPlayer`), the UI shell —
was built *while* building Drop 4. Whether it **generalizes** to a second, quite
different game is unproven. Othello is the test: different board (8×8), different
move (place-and-flip, with forced passes), and — critically — **not a solved game**
(no cheap perfect oracle from the opening), so its engine is a *heuristic* one.

**Done here =** `/othello/` is a playable, tap-first Tier-1 game vs a strong
heuristic engine, with a verifiable `?r=` outcome, an engine-grounded tutor, and
the experimental WebGPU-gated hybrid opponent — built by implementing the
`Adversary` trait + a new `othello-solver`, and **reusing** `hybrid-player.ts` /
`ai-runtime.ts` unchanged and the Drop 4 UI patterns. The reuse that holds and the
reuse that doesn't are both documented as the generality finding.

## Reasoning

- **Othello is not solved from the opening → the Oracle is heuristic, exact only
  late.** Unlike Drop 4 (fully solvable), Othello's game value from the opening is
  unknown at reasonable cost. So `othello-solver` is an **alpha-beta search over a
  positional/mobility/corner/stability heuristic**, with an **exact full solve in
  the deep endgame** (≤ ~N empties, N fixed in Phase 0 by measuring what solves in
  a tap-budget). This is the *same shape* as Drop 4's exact-when-tractable /
  capped-otherwise switch — the honesty flag carries over as **`exact` (endgame) vs
  `heuristic` (earlier)**. The tutor's honest wording generalizes directly:
  "that threw the game — X held it" only when `exact`, "looks risky" when heuristic.

- **Reuse the game-agnostic layer; re-implement the game-specific core. Be honest
  about which is which.** What reuses *unchanged*: `src/harness/hybrid-player.ts`
  (`buildBand`/`HybridPlayer` — takes a band + facts, no Drop 4 coupling) and
  `src/harness/ai-runtime.ts` (`AIRuntime`/`WebLLMRuntime`). What reuses as a
  *pattern* (copied per-game TS, not shared code): the tutor panel, the
  experimental-toggle + availability probe, the result screen, the how-to. What is
  *new*: the Rust `othello-{core,solver,wasm}` (Othello rules ≠ Drop 4), and
  `othello-{wasm.ts,outcome.ts,howto.ts,ts}`. The generality proof is that the
  `Adversary` trait + the TS harness + the tutor's `{quality, exact}` interface are
  the seams a new game plugs into — not that game logic is shared.

- **The band selector is generic-in-shape but lives in `drop4-solver` today.**
  `select_in_band` / `live_band` / the class-floor × sloppiness knobs are ~30 lines
  of game-agnostic logic currently in `drop4-solver::live`. For a *second* game the
  low-risk move is to **duplicate** the small selector into `othello-solver` rather
  than extract a shared crate now (rule of three — extracting on the 2nd consumer
  risks destabilizing shipped Drop 4 for a speculative abstraction). Extraction to
  a shared `adversary-solver` crate is a **named follow-on** once a 3rd game exists.
  (Open Question — owner's call.)

- **Tap-first, core decides legality, forced passes are the core's job.** Like
  Drop 4: tap a square, the core says whether it's a legal flipping move. Othello
  adds the **pass**: when the side to move has no legal move, `legal_moves` returns
  a single `Pass`; the UI auto-passes (with a visible "no move — pass" beat); the
  game ends when *both* sides have no move. The `Move` type is `Place(square) |
  Pass`, and the outcome's move list encodes passes so `(seed, moves)` replays
  exactly.

- **Verifiable outcome carries over.** `othello-core` implements `pond_outcome::Game`
  (as `drop4-core` does at `game.rs:171`); `othello-outcome.ts` mirrors
  `drop4-outcome.ts` (encode/verify a `?r=` share by replaying the move list to the
  `state_hash`). Result is by final disc count (`WinA`/`WinB`/`Draw`).

- **Build the whole vertical, wired, per the shelf gate.** No stubs: the game isn't
  done until it's reachable from `/othello/` through the drawer registry with a
  wiring e2e (BUILDING-GAMES §8), the wasm is in `build-wasm.sh` + `build.mjs`, and
  the how-to shot exists.

### Alternatives considered and rejected

- **Extract a shared `adversary-solver` crate now.** Rejected for v1 — rule of
  three; extracting on the 2nd consumer risks Drop 4. Duplicate the small selector;
  extract when a 3rd game lands (follow-on).
- **A perfect Othello solver.** Rejected — infeasible from the opening; a strong
  heuristic + exact endgame is the honest, shippable engine (and matches how real
  Othello engines work).
- **Skip the hybrid/tutor for game #2.** Rejected — exercising them is the *point*
  (generality); and they're mostly reuse.
- **checkers/chess instead** (the `TODO/drop4.md` "Later" list). Deferred — Othello
  is the cleanest generality proof (simple rules, heuristic engine, no move-gen
  library needed); chess needs a vetted move-gen + Stockfish-WASM oracle (heavier).

## Verified Assumptions

- **The `Adversary` trait** (read `crates/adversary-core/src/lib.rs`): `type
  Position: Clone`; `type Move: Copy + Serialize + DeserializeOwned + Eq`;
  `initial(seed)`, `side_to_move`, `legal_moves`, `apply`, `result` (→
  `Option<MatchResult>`), `state_hash`, `render_text`, `move_to_text`. `Side`
  (`A`/`B`, `.other()`), `MatchResult` (`WinA`/`WinB`/`Draw`, `.winner()`). An
  Othello `Move` enum `{Place(u8), Pass}` satisfies `Copy+Serialize+Deserialize+Eq`.
- **`pond_outcome::Game`** — `drop4-core` implements it (`crates/drop4-core/src/game.rs:171`)
  so a match replays `(seed, moves)` to a `state_hash`; `othello-core` mirrors that.
- **Template = Drop 4** (read): crates `drop4-{core,solver,wasm}`; front
  `src/games/drop4/{drop4.ts, drop4-wasm.ts, drop4-howto.ts, drop4-outcome.ts}`;
  the C-ABI binding shape (`new_game/play/board_json/legal_moves_json/current_hash/
  result_code/render_text/live_move/oracle_best/oracle_move_values_json/assess_json/
  tutor_json/mark_assistance/outcome_json` — `#[no_mangle] pub extern "C"`, one OUT
  buffer). `drop4-outcome.ts` (`encodeRecord`/`verifyRecord`/`Verifier`).
- **Registry + build wiring** (read): `src/registry.ts:35` registers a game
  (`{id, title, icon, status, load}`); `tools/build-wasm.sh:11` lists `-p
  <game>-wasm` crates; `build.mjs` `GAME_PAGES` (has a `cribbage` placeholder — add
  `othello`) + a `<game>.wasm` copy block. The drawer/settings/how-to renderer/
  result screen/`pond-*` substrate are shared, built once.
- **Reusable TS harness is game-agnostic** (read `src/harness/hybrid-player.ts`):
  `buildBand(moves: TutorFactMove[])` and `HybridPlayer.pick(band, {prompt})` take a
  plain band + `{quality, value, immediateWin, blocksOpponentWin}` facts — **no
  Drop 4 import**. `ai-runtime.ts` is fully generic. Both reuse unchanged.
- **[Pass 2] `TutorFactMove`'s per-move *facts* are Drop-4-flavored** (`immediateWin`,
  `blocksOpponentWin`) — Othello has no immediate 4-in-a-row win or single-square
  block, so those are always `false` there. `buildBand` still works (it filters by
  `quality` and sorts by `value`); its `ideaFor` just degrades to the
  quality-based idea ("your strongest line" / "stays safe") instead of "wins now" /
  "blocks their threat". So the reuse **holds unchanged**, with generic ideas — the
  optional "takes a corner" enrichment (a new fact or a game-supplied idea) is the
  ADVISORY open question, not required for v1.
- **[Pass 2] Wasm-in-vitest load pattern** (read `tests/solitaire-unit.test.ts:22-33`,
  `match3-unit.test.ts:12-17`): `preunit` builds the wasm, then a unit test shims
  `globalThis.fetch` to serve `target/wasm32-unknown-unknown/release/<game>_wasm.wasm`
  via `readFile` and calls `Game.load()`. Phase 4's `othello-unit.test.ts` uses this
  (path `…/othello_wasm.wasm`) — `Othello.load()` won't resolve `fetch` under jsdom
  otherwise.
- **The tutor/hybrid UI is Drop-4-specific TS** (read `src/games/drop4/drop4.ts`):
  the tutor panel, the availability probe (`navigator.gpu` non-fallback), the
  experimental toggle + disclosure, the LLM narration — a **pattern to copy**, not
  shared code.
- **Othello facts to confirm in Phase 0** (NOT yet verified — discovery): the exact
  legal-move/flip/pass/terminal rules encoded correctly; the heuristic Oracle's
  strength + the empty-count at which an exact endgame solve fits a tap budget; that
  `hybrid-player.ts` plugs in structurally unchanged. These are Phase 0 D-items, not
  assumptions.

## Documentation Impact

- `src/games/othello/othello-howto.ts` + `tools/guide-shots.mjs` +
  `assets/guide/othello-*.jpg` — new how-to + guide shots (Phase 6; stage only
  othello shots per the guide-shot discipline).
- `docs/BUILDING-GAMES.md` — the "New-game checklist (Tier-1)" is the spec followed;
  add Othello as a second §10 reference alongside Drop 4 (Phase 6). Note the
  heuristic-Oracle variation (exact-endgame vs heuristic-earlier) as a documented
  generalization of §10's "exact when tractable."
- `docs/AI-PLAYERS.md` — a "generality: Othello" note — what reused unchanged
  (harness), what was patterned (UI), what was new (core/solver/tutor), and the
  heuristic-vs-exact honesty flag (Phase 6).
- `README.md` — add Othello to the shelf list + a short section (Phase 5/6).
- `src/registry.ts`, `tools/build-wasm.sh`, `build.mjs` — register `othello` +
  build/copy its wasm (Phase 3/5, the phase that makes it reachable).
- `TODO/drop4.md` (or a new `TODO/othello.md`) — track P7 (Phase 6). *(Decide at
  Phase 0: reuse drop4's TODO section or a new file — Open Question.)*
- Grepped: no `crates/othello-*`, no `src/games/othello/`, no `othello` in
  `registry.ts`/`build-wasm.sh`/`build.mjs` (greenfield, confirmed 2026-08-03).

## Concurrency Map

```
Sequential spine: 0 → 1 (core) → 2 (solver) → 3 (wasm) → 4 (wrapper+outcome)
                  → 5 (playable game, wired) → 6 (tutor+hybrid+docs+shot)
```

All phases sequential — each consumes the prior crate/layer (solver needs the
core; wasm needs the solver; the wrapper needs the wasm exports; the game needs the
wrapper; the tutor/hybrid need the game). **Opt-in parallel candidate within
Phase 2**: the heuristic eval/search (2a) and the band/tutor (2b) are disjoint
files but 2b consumes 2a's `move_values`, so sequential. Vault-style parallelism
is not worth it at this size; default **sequential**. (Sub-phase a/b splits below
keep every unit ≤ ~4 files per the hard rule.)

## Phases

> **TDD ordering (all phases):** every phase writes its named test **RED first**
> and watches it fail before GREEN (repo law; `tdd-guardian`, `rust-enforcer`).
> Phase 0 is the Discovery Exemption. Rust cores are determinism-critical: no
> floats on the hashed path, `usize`→`u32` at hash/RNG boundaries so native==wasm.

### Phase 0: Discovery (rules · engine · reuse fit)

**Goal:** De-risk the three real unknowns before committing the vertical. Discovery
Exemption (spikes produce knowledge, not shipped code).

- [ ] **D1: Encode Othello rules correctly — legal moves, flips, forced pass,
  terminal.** *Probe:* a throwaway Rust spike: from the standard 4-disc opening,
  enumerate legal moves for both sides, apply a known opening line (e.g. the
  "perpendicular" opening), assert the flipped discs match a hand-verified
  reference; construct a no-legal-move position and confirm it yields exactly
  `[Pass]`; construct a both-sides-stuck position and confirm `result` is `Some`.
  *Success:* flips + pass + terminal match a reference on ≥3 positions. *Disposition:*
  `keep-as-fixture` — the reference positions become `othello-core` unit fixtures.
- [ ] **D2: Heuristic Oracle strength + the exact-endgame empty-count.** *Probe:* a
  spike alpha-beta over a corner/mobility heuristic; measure (a) it beats a random
  player convincingly over 20 games, and (b) the largest empty-count whose *exact*
  full solve returns in a tap budget (~≤100 ms) — that fixes `TRACTABLE_EMPTIES`
  for Othello. *Success:* a heuristic that clearly beats random + a measured exact
  threshold N. *Disposition:* `promote` — the eval + threshold inform Phase 2
  (`othello-solver`); TDD applies to the promoted code there, not the spike.
- [ ] **D3: Does the game-agnostic TS harness plug in unchanged?** *Probe:* read
  `hybrid-player.ts` `buildBand`/`TutorFactMove` and confirm an Othello tutor report
  (per-move `{col→square, value, quality, immediateWin→completes-nothing (always
  false in Othello), blocksOpponentWin→(n/a)}`) fits the interface, or note the
  minimal field rename needed (Othello has no "immediate win" — the move facts are
  quality/value + maybe "takes a corner"). *Success:* a written mapping of Othello
  facts → `TutorFactMove` (reuse as-is, or a named tiny adjustment). *Disposition:*
  `throwaway` (a reasoning artifact → Reasoning + Phase 6).

**Done when:** D1 rules verified, D2 fixes the heuristic + endgame threshold, D3
confirms harness fit (or names the minimal seam change). Update Verified Assumptions;
adjust later phases if a probe invalidates an assumption.
**Validation:** Discovery — evidence recorded, no tests.

### Phase 1: `othello-core` — rules + verifiable outcome
*(Split to honor the 4-file rule.)*
#### 1a — board, moves, flips, pass, result (the `Adversary` rules)
**Changes:** `crates/othello-core/{Cargo.toml, src/lib.rs, src/board.rs, src/game.rs}`
— `Board` (8×8 flat cells + side), `Move {Place(u8), Pass}`, `legal_moves` (flip
scan; `[Pass]` when none), `apply` (place + flip in 8 directions), `result` (both
stuck → disc-count `MatchResult`), `Side`/`Adversary` impl (`initial`,
`side_to_move`, `legal_moves`, `apply`, `result`, `render_text`, `move_to_text`).
**Wiring test:** `cargo test -p othello-core` using the D1 reference fixtures —
the opening line flips exactly the reference discs; a stuck position yields
`[Pass]`; a both-stuck position is terminal with the right winner. RED first.
**Depends on:** Phase 0. **Read-set:** `crates/adversary-core`. **Write-set:** the
new `othello-core` files. **Shared-state:** none beyond files.
**Done when:** (1) Othello rules (flip/pass/terminal) are correct against fixtures.
(2) `cargo test -p othello-core`. **Validation:** Moderate — rule fixtures + clippy/fmt.

#### 1b — `state_hash` + `pond_outcome::Game` (replay/verify)
**Changes:** `crates/othello-core/src/{hash.rs, game.rs}` — `state_hash` (board+side,
integer LE, no floats), `impl pond_outcome::Game for Othello` so `(seed, moves)`
(passes included) replays to the hash.
**Wiring test:** `cargo test -p othello-core` — a played move list (with at least
one forced `Pass`) replays from `initial(seed)` to an identical `state_hash`; a
tampered move list diverges. RED first.
**Depends on:** 1a. **Write-set:** `othello-core/src/{hash,game}.rs` + tests.
**Done when:** (1) A match with passes replays to a verifiable hash. (2)
`cargo test -p othello-core`. **Validation:** Moderate — replay + tamper unit.

### Phase 2: `othello-solver` — heuristic Oracle + band + tutor
*(Split; mirrors `drop4-solver` shape with a heuristic Oracle.)*
#### 2a — heuristic eval + alpha-beta + exact endgame + `move_values`
**Changes:** `crates/othello-solver/{Cargo.toml, src/lib.rs, src/eval.rs,
src/search.rs}` — positional/mobility/corner/stability `eval`, alpha-beta
`best_move`/`move_values` (heuristic depth-capped; **exact** full solve ≤ the D2
`TRACTABLE_EMPTIES`), difficulty `Level` (Easy…Expert), `choose(level, rng)`.
**Wiring test:** `cargo test -p othello-solver` — on a D2 endgame fixture the exact
solve ranks the disc-maximizing line highest; the heuristic beats a random policy
over seeded games (deterministic); takes a corner when free. RED first.
**Depends on:** Phase 1. **Write-set:** the new `othello-solver` files.
**Done when:** (1) A strong heuristic move + exact-endgame values. (2) `cargo test
-p othello-solver`. **Validation:** Moderate — eval/endgame units + clippy/fmt.

#### 2b — band selector + `tutor::assess` (reuse the shape, duplicate the selector)
**Changes:** `crates/othello-solver/src/{live.rs, tutor.rs}` — `live_band`/
`select_in_band` (duplicated ~30-line generic selector, per the rule-of-three
decision) + `tutor::assess(board, oracle) → TutorReport` (per-move value/regret/
quality Optimal|ResultPreserving|Blunder, `exact` iff ≤ `TRACTABLE_EMPTIES`, and
Othello one-ply facts: `takes_corner`, no `immediate_win`). Mirrors
`drop4-solver::tutor`.
**Wiring test:** `cargo test -p othello-solver` — exact-mode grades a corner-taking
line Optimal and a corner-giving-away move a Blunder on a D2 fixture; heuristic-mode
sets `exact=false`; the 3 quality branches pinned (incl. ResultPreserving), and the
exact|heuristic boundary named by empty-count (mutation-resistant). RED first.
**Depends on:** 2a. **Write-set:** `othello-solver/src/{live,tutor}.rs` + tests.
**Done when:** (1) Engine-grounded tutor facts + a class-preserving band. (2)
`cargo test -p othello-solver`. **Validation:** Moderate — quality-boundary +
band units.

### Phase 3: `othello-wasm` — C-ABI binding
**Changes:** `crates/othello-wasm/{Cargo.toml, src/lib.rs}` — mirror `drop4-wasm`:
one held session + OUT buffer; `new_game/play/board_json/legal_moves_json/
current_hash/result_code/render_text/live_move/oracle_best/oracle_move_values_json/
assess_json/tutor_json/mark_assistance/outcome_json`. **[Pass 2] Encode `Pass`
explicitly:** a dedicated `pass()` C-ABI export (clearer than overloading
`play(square)` with a sentinel), and `legal_moves_json` signals when `[Pass]` is
the only option so the UI can auto-pass; the `Move {Place(u8), Pass}` serializes
into the outcome move list so `(seed, moves)` replays passes exactly. Never panics.
`tools/build-wasm.sh` (+`-p othello-wasm`) + `build.mjs` (copy `othello.wasm`).
**Wiring test:** `cargo test -p othello-wasm` — a single stateful cabi test
(global session): play a reachable opening, `assess_json`/`tutor_json` report the
facts + `exact` flag; a forced-pass position is reflected; `outcome_json` is a
verifiable envelope. RED first. *(Fold into one test — global `STATE` races across
parallel tests, the Drop 4 lesson.)*
**Depends on:** Phase 2. **Write-set:** `othello-wasm/*`, `tools/build-wasm.sh`,
`build.mjs`. **Shared-state:** the build scripts (one-line additions; no overlap
with other games' copy blocks).
**Done when:** (1) JS can drive Othello + read board/tutor/outcome over the C-ABI;
`othello.wasm` builds + copies. (2) `cargo test -p othello-wasm` + `npm run
build:wasm`. **Validation:** Moderate — cabi wiring test + build.

### Phase 4: typed wrapper + verifiable outcome (TS)
**Changes:** `src/games/othello/othello-wasm.ts` (typed `Othello` wrapper mirroring
`Drop4`: `board/legalMoves/play/liveMove/oracleBest/oracleMoveValues/assess/tutor/
outcome`, `MoveAssessment`/`TutorReport` types) + `src/games/othello/othello-outcome.ts`
(mirror `drop4-outcome.ts`: `encodeRecord`/`verifyRecord`/`Verifier`).
**Wiring test:** `tests/othello-unit.test.ts` — load the real `othello.wasm`, play a
short game (incl. a pass), `verifyRecord` re-derives the terminal hash; `assess`/
`tutor` shapes typecheck + return sane facts. RED first.
**Depends on:** Phase 3. **Write-set:** `othello-wasm.ts`, `othello-outcome.ts`,
`tests/othello-unit.test.ts`. **Shared-state:** loads `othello.wasm` in vitest.
**Done when:** (1) Typed JS access + a verifiable outcome round-trip. (2) `npx
vitest run tests/othello-unit.test.ts` + `npx tsc --noEmit`. **Validation:**
Moderate — wasm-backed unit + typecheck.

### Phase 5: playable `/othello/` vs the engine (wired)
**Changes:** `src/games/othello/othello.ts` (the `GameModule`: 8×8 board render,
tap-a-square with core-decided legality + legal-target glow, forced-pass beat, the
engine reply via `liveMove(level)`, difficulty picker + disc chooser, winning-count
result screen with the verifiable `?r=` share — the Drop 4 module pattern) +
`src/registry.ts` (register `othello`, `status:"playable"`) + `styles.css` (othello
board styles, append-only semantic tokens) + `build.mjs` `GAME_PAGES` (+`othello`).
**Wiring test:** `tests/othello.spec.ts` — `/othello/` renders the 8×8 board + turn
bar; a tap places a disc and flips, the engine replies; a forced pass is shown; a
full game reaches a terminal result whose `?r=` re-verifies; axe clean; centred +
narrow-phone fit. RED before the module is registered. *(Wiring through the real
`/othello/` URL — the shelf's §8 gate.)*
**Depends on:** Phase 4. **Write-set:** `othello.ts`, `registry.ts`, `styles.css`,
`build.mjs`. *(4 files — the registry/build edits are one-liners; if it grows, split
the module from the wiring.)*
**Shared-state:** e2e binds serve port 4180; registry/build are shared one-line edits.
**Done when:** (1) A full Othello game is playable at `/othello/` vs the engine, with
flips, forced passes, and a verifiable result. (2) `npm run test` + `npm run e2e`
(the othello e2e). **Validation:** Broad — full gate + manual play; ships to everyone.

### Phase 6: tutor + experimental hybrid + docs + shot
**Changes:** `src/games/othello/othello.ts` — the tutor panel (Explain my options /
blunder flag / why-hint from `tutor()`, honest `exact|heuristic` wording) and the
WebGPU-gated **"Experimental: local AI opponent"** toggle (availability probe →
`buildBand(othello.tutor().moves)` → `HybridPlayer(WebLLMRuntime)` → reason display,
disclosure, engine fallback) — **reusing `hybrid-player.ts`/`ai-runtime.ts`
unchanged**, patterning the Drop 4 UI. Plus `othello-howto.ts` + a regenerated
`othello` guide shot; `docs/AI-PLAYERS.md` (generality note) + `docs/BUILDING-GAMES.md`
§10 (Othello reference) + `README.md` + `TODO` (P7 ✓). *(Committed as green
sub-steps: tutor UI+e2e; hybrid toggle+e2e; how-to+shot; docs.)*
**Wiring test:** `tests/othello.spec.ts` extended — the tutor flags a blunder
end-to-end (honest wording), "Explain my options" lists ≥2 band moves; the
experimental toggle is hidden without a real WebGPU adapter and appears (faked
adapter) with a disclosure. Real hybrid play validated by an `ai:trial`-style run
against `/othello/` on system Chrome (reuse the driver with an origin arg).
**Depends on:** Phase 5, and the shipped `hybrid-player.ts`/`ai-runtime.ts`.
**Write-set:** `othello.ts`, `othello-howto.ts`, `tools/guide-shots.mjs`,
`assets/guide/othello-*.jpg`, `docs/AI-PLAYERS.md`, `docs/BUILDING-GAMES.md`,
`README.md`, the TODO. *(>3 → green sub-steps.)*
**Shared-state:** `guide:shots` rebuilds all shots — **stage only othello shots**;
WebGPU toggle only on user opt-in.
**Done when:** (1) `/othello/` has the engine-grounded tutor and the experimental
hybrid opponent, reusing the harness unchanged; docs record what generalized. (2)
`npm run test` + `npm run e2e` + a recorded othello `ai:trial`. **Validation:**
Broad — full gate + manual play + the real hybrid trial.

## Open Questions

- [RECOMMENDED: BLOCKING] Othello rules encoding (flips/pass/terminal) — resolved by
  Phase 0 D1 against reference positions. *Rationale: every later phase builds on a
  correct core; a wrong flip rule invalidates the whole vertical. Must pass D1 first.*
- [RECOMMENDED: PHASE-GATED (Phase 2)] The exact-endgame `TRACTABLE_EMPTIES` for
  Othello — resolved by Phase 0 D2 (measure what solves in a tap budget). *Rationale:
  fixes the exact|heuristic boundary the tutor + scorer honesty depends on.*
- [RECOMMENDED: PHASE-GATED (Phase 2)] Duplicate the band selector into
  `othello-solver` vs extract a shared `adversary-solver` crate. *Recommend
  duplicate for v1 (rule of three; don't destabilize shipped Drop 4); extract when a
  3rd game lands.*
- [RECOMMENDED: ADVISORY] Heuristic strength target for the shipped engine (how good
  is "Expert"?). *Recommend "clearly beats a strong club amateur"; not a solved
  oracle — Othello is unsolved. Measured via the P6 harness once both land.*
- [RECOMMENDED: ADVISORY] `TutorFactMove` fit — Othello has no "immediate win"
  (wins are by final count). *Recommend reuse the interface as-is with
  `immediateWin:false` + add a `takesCorner` idea in the game-side band copy, or a
  tiny optional field; confirmed by Phase 0 D3.*
- [RECOMMENDED: ADVISORY] Track P7 in `TODO/drop4.md` vs a new `TODO/othello.md`.
  *Recommend a new `TODO/othello.md` — it's a distinct game.*

## Review Log

### Pass 1 — 2026-08-03
Authored from firsthand reads of `crates/adversary-core/src/lib.rs` (the `Adversary`
trait Othello must implement), `crates/drop4-{core,solver,wasm}` + `src/games/drop4/*`
(the vertical template + the C-ABI shape), `src/registry.ts`/`tools/build-wasm.sh`/
`build.mjs` (game wiring), and `src/harness/{hybrid-player,ai-runtime}.ts` (the
game-agnostic harness that reuses unchanged). Central reasoning: Othello is
**unsolved from the opening**, so its Oracle is a heuristic alpha-beta with an exact
deep-endgame solve — the same exact|capped honesty shape as Drop 4, renamed
exact|heuristic; the reuse is real for the TS harness + patterned for the UI, and
**new** for the Rust core/solver/tutor — that split *is* the generality finding.
Band selector duplicated (not extracted) per rule-of-three. Phases: 0 discovery
(rules/engine/reuse) → 1 core (rules+outcome) → 2 solver (heuristic+band+tutor) →
3 wasm → 4 wrapper+outcome → 5 playable-wired → 6 tutor+hybrid+docs+shot; sub-phases
keep each unit ≤ ~4 files. 6 open questions (1 BLOCKING = D1 rules, 2 PHASE-GATED,
3 ADVISORY).

### Pass 2: Gap Analysis — 2026-08-03
**Found:**
- **`TutorFactMove` reuse is real but its *facts* are Drop-4-flavored.**
  `immediateWin`/`blocksOpponentWin` don't exist in Othello (wins are by final
  count). Verified `hybrid-player.ts`: `buildBand` filters by `quality` + sorts by
  `value`, so it reuses **unchanged**; only `ideaFor`'s labels degrade to
  quality-based ("your strongest line") instead of "wins now"/"blocks". Recorded
  as a Verified Assumption; the "takes a corner" enrichment stays the ADVISORY
  open question. The "reuse the harness unchanged" claim holds — sharpened to note
  the graceful degradation rather than overclaiming identical ideas.
- **Wasm-in-vitest load pattern was assumed, not specified.** Same gap as P6:
  `Othello.load()` uses `fetch`, which needs the `globalThis.fetch` shim under
  jsdom (`solitaire-unit.test.ts:22-33`). Added to Verified Assumptions so Phase
  4's `othello-unit.test.ts` uses it (path `…/othello_wasm.wasm`).
- **`Pass` encoding in the C-ABI was under-specified.** Sharpened Phase 3: a
  dedicated `pass()` export (not a `play` sentinel), `legal_moves_json` signals a
  forced pass, and `Move {Place, Pass}` serializes into the outcome list so replay
  handles passes — closing the "how does a pass round-trip through `?r=`" gap.
**Concurrency:** map confirmed — all sequential (each layer consumes the prior
crate/wrapper). The internal Phase 2 a/b split is sequential (2b consumes 2a's
`move_values`). `build.mjs` is written in both Phase 3 (wasm copy) and Phase 5
(GAME_PAGES) — sequential, no conflict; noted. No missed parallelism.
**Changed:** added the `TutorFactMove`-degradation + fetch-shim Verified
Assumptions; sharpened Phase 3's `Pass` encoding. No phase reordering.
**Confirmed:** the `Adversary` trait + `pond_outcome::Game` (drop4-core `game.rs:171`)
are the correct seams; the drop4 crate/front/registry/build wiring is the right
template; the heuristic-Oracle-with-exact-endgame shape mirrors `drop4-solver`'s
exact|capped honesty (renamed exact|heuristic). BLOCKING D1 (rules) stands for
execution (needs the Phase 0 spike). No new BLOCKING items.
