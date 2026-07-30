# Bubble shooter — Tier-1 build-fresh (phase plan)

**Status:** ✅ **SHIPPED 2026-07-30 — all phases B1–B7 executed TDD-first +
committed.** Bubble is playable at `/bubble/`: clear-the-board-in-N-shots over a
guaranteed-winnable daily pack, tap-target aim with core-decided legal-target
glow, a verification-forward result + `?r=` share, hints/settings, a How-to
guide. Full gate green (cargo `--workspace` 42 suites + fmt + clippy; 87 unit;
94 e2e / 2 expected skips). Deploy-ready (not pushed). Commits: B1 `839bca8`,
B2 `40d4045`, B3 `77b0d6d`, B4 `e8c3d1d`, B5 `21e55bf`, B6 `2e876a1`, B7
`8956507`. Owner decisions folded (winnable-pack solver; surface score, no
stars; per-game directory). Plan file: `plans/2026-07-30-bubble-shooter.md`.

> Convention note: this repo keeps plans as `plans/YYYY-MM-DD-<slug>.md`, so this
> file keeps that name rather than the skill's `N-plan-` scheme (skill: "match
> the existing convention").

## Problem Statement

`fun.croft.ing` is a two-tier game shelf (COHESION §62). Tier 1 = Croft-native,
build-fresh, **determinism-first + verifiable outcome**; solitaire and match-3
ship. The bubble shooter is the next Tier-1 game — **build-fresh, not a wrap** of
Frozen Bubble, to keep the verifiable-outcome magic (a provable, shareable
score/clear) and a clean license. It is **single-player and ungated**, so it can
land ahead of the P2P-gated cribbage. Objective (owner):
**clear-the-board-in-N-shots**, with a **guaranteed-winnable daily pack** and a
surfaced pop/drop **score** (no stars for v1).

Goal: `/bubble/` is a real, verifiable, accessible game meeting every standard in
`docs/BUILDING-GAMES.md`.

## Reasoning

- **Build fresh, not wrap.** Frozen Bubble is GPL/Perl-lineage with GPL/CC-BY-SA
  art; the mechanic is simple enough that building is ≤ the cost of a wrap + the
  Tier-2 containment harness, and building is the *only* path that yields a
  verifiable outcome + our own identity. (Owner-confirmed.)
- **Tap-target aim, not continuous physics.** Continuous trajectories use floats,
  which break the native==wasm `state_hash`. The player **taps a target cell**;
  the core decides reachability. A shot's move is a small integer `Pos`, so
  `(seed, targets)` replays exactly — determinism and the tap-first accessibility
  floor agree.
- **Deterministic launcher colours.** Each shot's colour derives from
  `(seed, shot_index)` via the same ChaCha20 stream, so replay re-derives every
  colour; the move list is only the targets. Lives in a `Game` wrapper (B3).
- **Objective = clear-the-board-in-N-shots (owner).** Win = board empty within N
  shots; a completed run that doesn't clear is `Outcome::Lost` (verifiable by
  replay). Score (pop/drop) is surfaced as a secondary metric (owner, B3-Q2); no
  stars for v1.
- **Winnable-pack solver (owner, B3-Q1).** Because the launcher colour sequence
  is fixed per seed, an arbitrary deal may be unclearable — frustrating. So,
  unlike match-3's flat-threshold call, bubble ships a **guaranteed-winnable
  daily pack**: a build-time solver certifies each daily seed is clearable within
  N shots and bakes the pack (mirroring solitaire's winnable-daily pack). This is
  a distinct phase (B4).
- **Game isolation (owner, 2026-07-30).** Each game owns a self-contained
  directory; shared shelf infra stays shared (BUILDING-GAMES "Game isolation").
  Bubble's front end lives under `src/games/bubble/`; its crates are
  `crates/bubble-{core,wasm,solver}`; its data is `games/bubble/`. Migrating the
  existing solitaire/match-3 TS into per-game dirs is a separate owner-gated pass
  (Q-ISO).

## Verified Assumptions

- **`pond-outcome` needs no additive change for score-without-stars.**
  `crates/pond-outcome/src/lib.rs`: `Replayed`'s fields (`final_hash`, `won`,
  `score: Option<u64>`, `stars: Option<u8>`) are all `pub`, so B3 constructs
  `Replayed { score: Some(s), stars: None, .. }` directly. `Outcome::{Won,Lost}`
  + `Record`'s `skip_serializing_if` optional `score` cover clear-the-board.
  (Read 2026-07-30.)
- **match3-wasm gives the exact C-ABI shape to mirror** (`new_game(lo,hi)`,
  `board_json`, `legal_moves_json`, `current_hash`, `score`, `moves_left`,
  `is_won`, `play_swap->u32`, `mark_assistance`, `outcome_json(declare)`,
  `out_len`, `target_daily_seed(u32)`); raw C-ABI + serde-JSON out-buffer, never
  panics. (Read 2026-07-30.)
- **B1/B2 core is green** (hex geometry+adjacency, seeded `deal`, `state_hash`,
  `legal_targets`, `shoot` place/pop/drop, `is_cleared`; 18 tests + 2 goldens;
  fmt+clippy default+pedantic clean). Committed 839bca8, 40d4045.
- **Registry + how-to-registry are the shared wiring points** (`src/registry.ts`,
  `src/how-to-registry.ts`). (Read 2026-07-30.)
- **To verify at B4 start (not yet read):** `crates/solitaire-solver` +
  `games/solitaire/daily-pack.json` as the winnable-pack pattern (existence
  confirmed via workspace `Cargo.toml` members + README; internals to be read in
  B4 before mirroring). Recorded here so B4 reads before assuming its shape.

## Documentation Impact

- `fun/CLAUDE.md` — **new** project directives. Phase: directives update (done).
- `docs/BUILDING-GAMES.md` — "Game isolation" + "two tiers" sections. Phase:
  directives update (done); confirm the new-game checklist fits bubble at B7.
- `README.md` — bubble in shelf order + crate list (incl. `bubble-solver`) +
  `games/bubble/` map. Phase: B7.
- `TODO/bubble.md` — **new** (variants, specials, ceiling advance, drag). Phase: B7.
- `crates/bubble-core/RULES.md` — extend for the `Game`/budget/colour-sequence +
  the pack contract. Phase: B3/B4 (same phase as the code).
- `src/registry.ts`, `src/how-to-registry.ts` — bubble entries (grep confirms the
  only two registries). Phase: B7.

## Concurrency Map

Sequential spine: **B3 → B4 → B5 → B6 → B7.** Each reads what the prior wrote
(B4 solver uses the B3 `Game`; B5 wasm binds B3 + reads the B4 pack; B6 UI calls
B5; B7 wires/guides B6). All phases sequential — each reads the prior's output;
no parallel set, so no re-entry verification field is needed.

**Cross-session shared-file merge risk (not intra-plan parallelism):** B5 and B7
edit files the **active match-3 session also edits** — `Cargo.toml`, `build.mjs`,
`src/registry.ts`, `src/how-to-registry.ts`, `README.md`. This worktree is git-
isolated (branch `claude/games-tier`), so there is no live trampling; these files
need a clean merge/rebase against `fun` main at delivery. bubble-owned paths
(`crates/bubble-*`, `src/games/bubble/*`, `games/bubble/*`) don't overlap
match-3's — the merge surface is exactly those five shared files.

## Phases

### Phase B1 — core: hex geometry + seeded deal ✅ DONE (839bca8)
Staggered hex `Board`, six-neighbour adjacency, seeded `deal`, `state_hash`; 11
lib tests + a pinned golden. RED→GREEN; fmt+clippy clean.

### Phase B2 — core: shot resolution + scoring ✅ DONE (40d4045)
`is_legal_target`/`legal_targets`, `shoot` (pop ≥3, drop floating, score =
popped + 2·dropped), `is_cleared`; 6 tests + a pinned shot-pipeline golden.
RED→GREEN.

### Phase B3 — core: the `Game` wrapper + `pond-outcome` impl (score surfaced)
**Goal:** a play-loop with deterministic launcher colours, a shot budget, a
surfaced score, and a verifiable outcome replayable from `(seed, targets)`.
**Changes:**
- [ ] `crates/bubble-core/src/game.rs` — `Game` holding board, seed, `colors`,
  budget `N`, `shots: Vec<Pos>`, cumulative `score`. `current_color()` derived
  from `(seed, shot_index)` (ChaCha20). `play(target) -> Result<ShotReport,
  ShotError>` (B2 `shoot` w/ derived colour, accumulates score, records the
  target). `shots_left`, `is_won` (=`is_cleared`), `is_lost` (=budget spent &&
  !cleared), `current_hash`, `score`.
- [ ] `impl pond_outcome::Game for Bubble` (`Move=Pos`, `KIND="bubble"`,
  `VERSION=1`): `replay(seed, targets)` re-derives colours, applies shots, returns
  `Replayed { final_hash, won: is_cleared, score: Some(score), stars: None }`.
- [ ] `crates/bubble-core/Cargo.toml` — add `pond-outcome`; extend `RULES.md`.
**Call chain:** `pond_outcome::verify::<Bubble>(record)` → `Bubble::replay` →
`Game::play`×n → `engine::shoot`.
**Wiring test:** `verify_roundtrip` — build a `Game`, play a scripted winning
line, `attest`→`Record`, `verify`→`ok==true`; a tampered hash → `ok==false`; and
assert the record carries `score: Some(_)`, `stars: None`. RED until `Game` +
`impl Game` exist.
**Test edges (mutation resistance):** shots_left boundary — a win on the **last**
shot (budget→0, cleared) is `Won`; the **same** deal one shot short is `Lost`.
Colour-derivation determinism: two `replay`s of the same `(seed, targets)` give
byte-identical hashes; a colour-stream off-by-one changes the hash (a golden pins
it). Score accumulates across a multi-pop line (not just the last shot).
**Depends on:** B2.
**Read-set:** `crates/bubble-core/src/{engine,board,rng,hash,lib}.rs`,
`crates/pond-outcome/src/lib.rs`.
**Write-set:** `crates/bubble-core/src/{game.rs,lib.rs}`,
`crates/bubble-core/Cargo.toml`, `crates/bubble-core/RULES.md`,
`crates/bubble-core/tests/golden.rs`.
**Shared-state contract:** no shared mutable state beyond the write-set;
Rust-only. `Cargo.lock` gains the `pond-outcome` edge (benign).
**Observability:** `ShotError` is a typed error (`thiserror`), not a panic; the
`Game` never panics on an illegal target (returns `Err`).
**Risks:** colour derivation must be folded so replay==play — a golden replay
vector pins it.
**Done when:** (1) a scripted game attests to a `Record` and re-verifies by
replay (tamper fails), through `pond_outcome::{attest,verify}`, with a surfaced
score. (2) `cargo test -p bubble-core` (incl. `verify_roundtrip` + replay golden)
green; `-p pond-outcome` still green.
**Validation:** Narrow — wiring test + unit + golden. Tests sufficient.

### Phase B4 — solver + winnable-daily pack (`crates/bubble-solver`)
**Goal:** guarantee every daily deal is clearable within N shots; bake the pack.
**Changes:**
- [ ] **B4a — read `crates/solitaire-solver` + `games/solitaire/daily-pack.json`
  first** (resolve the deferred Verified-Assumption), then mirror its shape.
- [ ] `crates/bubble-solver/` — a build-time winnability oracle: given a seed,
  search for a clearing shot line under the deterministic colour sequence within
  N (bounded search/greedy-with-backtrack, like solitaire-solver finds a win
  line). Returns `Some(clear_line: Vec<Pos>)` or `None`.
- [ ] a generator that scans seeds, keeps winnable ones, and writes
  `games/bubble/daily-pack.json` — a year (365) of winnable daily seeds + a
  fixture clear line (the proof), **seeds-lean + byte-identically regenerable**
  (mirror solitaire v2).
**Call chain:** (build-time) generator → `bubble_solver::solve(seed)` →
`Game::play` → `engine::shoot`; (runtime) `bubble_daily_seed(day)` → pack index.
**Wiring test:** `pack_lines_actually_clear` — for a sample of pack entries,
replay `(seed, fixture_line)` through `bubble_core::Game` and assert
`is_cleared`; `pack_regen_is_byte_identical` — regenerating the pack yields the
committed bytes. RED until the solver + generator exist.
**Test edges:** a seed the solver rejects (`None`) is **not** in the pack; the
fixture line length ≤ N; an off-by-one in the colour sequence makes a stored
line fail to clear (guards the solver/Game colour agreement).
**Depends on:** B3.
**Read-set:** `crates/bubble-core/**`, `crates/solitaire-solver/**`,
`games/solitaire/daily-pack.json`.
**Write-set:** `crates/bubble-solver/{Cargo.toml,src/**}`, `Cargo.toml`
(workspace member), `games/bubble/daily-pack.json`, `Cargo.lock`.
**Shared-state contract:** edits shared `Cargo.toml` (member add) — merge-time
only. Build-time crate; no runtime state.
**Observability:** the generator logs seeds scanned / accepted / rejected counts
(so a low acceptance rate — a too-tight N — is visible, not silent). Log the
rejected count explicitly (no silent truncation).
**Risks:** search cost — bound it; if acceptance is too low, N is too tight (tune
the mode constant). A too-generous N makes the game trivial — balance is an
owner-tunable const, logged.
**Done when:** (1) `games/bubble/daily-pack.json` exists, every entry's fixture
line clears its board by replay, and the pack regenerates byte-identically. (2)
`cargo test -p bubble-solver` + `-p bubble-core` green; the generator runs.
**Validation:** Moderate — wiring tests (lines clear; byte-identical regen) +
the logged acceptance-rate sanity check.

### Phase B5 — bubble-wasm C-ABI binding + typed TS wrapper
**Goal:** the browser holds a `Game` and drives it; daily reads the pack.
**Changes:**
- [ ] `crates/bubble-wasm/` — raw C-ABI over `bubble_core::Game`: `new_game(lo,
  hi)`, `board_json`, `legal_targets_json`, `current_color`, `shoot(r,c)->u32`,
  `score`, `shots_left`, `current_hash`, `is_cleared`, `mark_assistance`,
  `outcome_json(declare)->*const u8`, `out_len`, `bubble_daily_seed(day)` (pack
  index). **Never panics.**
- [ ] `src/games/bubble/bubble-wasm.ts` — typed wrapper (per-game dir).
- [ ] `Cargo.toml` (member), `build.mjs` (build + serve `/bubble.wasm` + the pack).
**Call chain:** `bubble-wasm.ts` → wasm `shoot`/`board_json` → `bubble_core::Game`.
**Wiring test:** a Rust `tests/` over the C-ABI — `new_game` → scripted win via
`shoot` → `is_cleared()==1`, `outcome_json` parses to a verifiable record; and
`bubble_daily_seed(0)` returns a pack seed. RED until the binding exists.
**Test edges:** `shoot` on an illegal target returns a non-zero status and leaves
`current_hash` unchanged; `out_len`/`board_json` round-trip a known board.
**Depends on:** B3, B4.
**Read-set:** `crates/bubble-core/**`, `crates/match3-wasm/src/lib.rs`,
`games/bubble/daily-pack.json`, `build.mjs`.
**Write-set:** `crates/bubble-wasm/{Cargo.toml,src/lib.rs}`,
`src/games/bubble/bubble-wasm.ts`, `Cargo.toml`, `build.mjs`, `Cargo.lock`.
**Shared-state contract:** edits shared `Cargo.toml`+`build.mjs` (merge-time);
wasm holds module-static single-game state (as match3-wasm does).
**Observability:** every fallible C-ABI path returns a status code / empty
buffer; the TS wrapper surfaces a decode failure to `console.error` (not a silent
empty board).
**Risks:** raw-pointer out-buffer + never-panic discipline; `seed_lo/hi` split
must match match3's convention.
**Done when:** (1) JS starts a game, reads board/legal-targets/current-colour,
shoots, reads score/shots-left/cleared, gets a verifiable `outcome_json`, and
daily resolves via the pack. (2) `npm run build:wasm` builds `/bubble.wasm`;
C-ABI Rust test + `cargo test --workspace` green; native==wasm xbuild passes.
**Validation:** Moderate — wiring test + build the wasm + scripted JS smoke.

### Phase B6 — board UI (`src/games/bubble/bubble.ts`)
**Goal:** a playable, accessible, verification-forward `/bubble/`.
**Changes:**
- [ ] `src/games/bubble/bubble.ts` — a `GameModule`: render the hex board
  (colour-blind-safe shape+hue tokens, AA both themes), a launcher (current +
  next colour), **tap a target → core-driven legal-target glow → `shoot`**,
  pop/drop re-render, score / shots-left HUD.
- [ ] cleared (or shots-out) → **verification-forward** result (score + record +
  one-tap re-verify + deflated `?r=` share that re-verifies on open).
- [ ] daily (pack via `bubble_daily_seed`) + free-play (`?seed=`); hints (a good
  legal target; counts as assistance) + shared settings; hints-off → "I'm stuck"
  ends + reports honestly.
- [ ] bubble tokens in `tokens.css` (only-hex file); AA recorded + asserted.
**Call chain:** `/bubble/` URL → drawer/registry `load` → `bubble.ts mount` →
`bubble-wasm.ts` → wasm.
**Wiring test:** an e2e loading `/bubble/`, shooting a legal target, asserting the
board changed + a result/record appears; **plus the guardrail e2e** — an illegal
tap changes nothing (legality lives in the core, not the UI).
**Test edges:** legal-target glow set == `legal_targets_json` exactly (no
UI-invented targets); 360px hex fit; theme toggle no-flash.
**Depends on:** B5.
**Read-set:** `src/{contract,chrome,settings,theme,how-to}.ts`,
`src/games/match3.ts` (reference), `tokens.css`.
**Write-set:** `src/games/bubble/bubble.ts`, `tokens.css`, `styles.css`,
`src/games/bubble/*` assets.
**Shared-state contract:** append-only bubble tokens/classes in
`tokens.css`/`styles.css` (the hex-in-`styles.css` test must still pass) —
merge-time only.
**Observability:** the module logs (console.debug) the seed + mode on mount so a
"wrong board" report is diagnosable; no PII.
**Risks:** glow must read the core; an e2e asserts the illegal-tap no-op.
**Done when:** (1) a stranger opens `/bubble/`, taps targets (legal glow; core
decides), pops/drops, and on clear/shots-out sees a verifiable score+record with
re-verify + share; hints/settings/daily/free-play work. (2) `npm run test` +
`npm run e2e` (axe both themes) green.
**Validation:** Broad — wiring e2e + manual play + axe both themes + 360px +
illegal-tap guardrail + share round-trip.

### Phase B7 — how-to guide, registry wiring, tests, deploy
**Goal:** bubble is a first-class shelf game; gate green; live.
**Changes:**
- [ ] `src/games/bubble/bubble-howto.ts` (pure-data, lead with tap-to-aim) +
  `src/how-to-registry.ts` entry + `npm run guide:shots`.
- [ ] `src/registry.ts` — `{id:"bubble", status:"playable", load}` + `/bubble/`.
- [ ] `README.md`, `docs/BUILDING-GAMES.md` (confirm checklist), `TODO/bubble.md`.
- [ ] full gate + deploy (GitHub Actions → Pages).
**Call chain:** header → `/how-to/?game=bubble` → shared renderer → bubble howto;
drawer → registry → bubble.
**Wiring test:** how-to e2e (images load, TOC==entries, axe) + registry e2e
(drawer lists + launches bubble).
**Test edges:** how-to sync test fails if a guide names a missing shot.
**Depends on:** B6.
**Read-set:** `src/{how-to,how-to-page}.ts`, `tools/guide-shots.mjs`,
`src/registry.ts`, `README.md`, `docs/BUILDING-GAMES.md`.
**Write-set:** `src/games/bubble/bubble-howto.ts`, `src/how-to-registry.ts`,
`src/registry.ts`, `README.md`, `docs/BUILDING-GAMES.md`, `TODO/bubble.md`,
`assets/guide/bubble-*.jpg`.
**Shared-state contract:** edits shared `registry.ts`+`how-to-registry.ts`+
`README.md` (merge-time coordination with match-3).
**Observability:** deploy workflow logs the gate; a failed gate blocks publish.
**Risks:** guide-shot sync; CI builds wasm + the pack.
**Done when:** (1) the drawer lists Bubble as playable, launches it, links to its
how-to (with screenshots), live at `fun.croft.ing/bubble/`. (2) `cargo test
--workspace` + fmt + clippy; `npm run test` + `npm run e2e` (axe); deploy green.
**Validation:** Broad — full gate + a live smoke on the deployed URL.

## Open Questions

- [CONFIRMED: PHASE-GATED (B4)] **B3-Q1 — winnability. RESOLVED: winnable-pack
  solver** (owner 2026-07-30). A build-time solver certifies each daily seed is
  clearable within N and bakes the pack (phase B4). Solver-free is not chosen.
- [CONFIRMED: ADVISORY] **B3-Q2 — score. RESOLVED: surface score, no stars**
  (owner 2026-07-30). `Replayed { score: Some, stars: None }`; result screen
  shows the score as a secondary metric under the clear-in-N objective.
- [CONFIRMED: ADVISORY] **Q-ISO — migrate existing games to per-game dirs?**
  Bubble uses `src/games/bubble/` now; migrating solitaire/match-3 TS is a
  separate owner-gated pass coordinated with the active match-3 session. Not in
  this plan.

No BLOCKING questions remain. B3-Q1 is PHASE-GATED at B4 but does not block
starting B3.

## Review Log

- **2026-07-30 Pass 1+2 (combined).** Built the plan from the draft + template.
  Added Verified Assumptions (from real source), the game-isolation decision,
  Concurrency Map (sequential + cross-session merge risk), Documentation Impact,
  per-phase Call chain/Wiring test/Read+Write-set/Shared-state/2-tier Done-when/
  Validation, and three Open Questions. B1/B2 recorded as executed.
- **2026-07-30 Owner decisions folded.** B3-Q1 → **winnable-pack solver** (added
  phase **B4**; renumbered wasm→B5, UI→B6, guide→B7; daily now reads the pack).
  B3-Q2 → **surface score, no stars** (B3 `Replayed{score:Some,stars:None}`;
  Verified-Assumption updated — `pub` fields, so still no additive pond-outcome
  change). Q-ISO → per-game dir for bubble now, migration deferred.
- **### Pass 3: Quality Gates — 2026-07-30**
  **TDD ordering:** every phase leads with a wiring test that exercises the entry
  point (B3 `verify`; B4 pack-lines-clear; B5 C-ABI; B6/B7 e2e through `/bubble/`
  + drawer); no test deferred to a later phase.
  **Observability:** added per-phase notes — typed `ShotError` (no panics); the
  B4 generator logs scanned/accepted/**rejected** counts (no silent truncation);
  the B5 TS wrapper surfaces decode failures to `console.error`; the B6 module
  logs seed+mode on mount (no PII).
  **Debugging readiness:** commit per phase (each a green checkpoint); pinned
  golden vectors at B1/B2/B3/B4 are the regression checkpoints; the byte-
  identical pack regen is a B4 checkpoint.
  **Validation calibration:** B3 Narrow (tests), B4 Moderate (wiring + acceptance
  sanity), B5 Moderate (wiring + build + smoke), B6/B7 Broad (e2e + axe + live
  smoke) — matched to scope.
  **Mutation resistance:** added edge/boundary specs to each phase (shots_left
  last-shot win vs one-short lose; colour-stream off-by-one flips the hash;
  solver-rejected seed absent from pack; illegal-tap no-op) so tests aren't
  single-point happy-path assertions.
  **Concurrency honesty:** Map confirmed; sequential plan; write-sets disjoint
  from match-3's except the five named shared files (merge-time, documented); no
  parallel set → no re-entry field needed.
  **Documentation impact:** every added file (`fun/CLAUDE.md`,
  `crates/bubble-solver`, `games/bubble/daily-pack.json`, `src/games/bubble/*`,
  `TODO/bubble.md`) has an owning phase; doc updates sit in the phase that makes
  them stale (README+registries at B7; RULES.md at B3/B4), not a trailing docs
  phase.
  **Coherence:** plan still solves the original problem; no scope creep beyond the
  owner-requested winnable pack.
  **Confirmed ready:** yes — B3 can start now; B3-Q1 gates B4 only.
- **2026-07-30 Execution complete (B3–B7).** All phases shipped TDD-first, each a
  green committed checkpoint. Notable deltas from the plan, all recorded in the
  commits: B3's launcher policy was refined in B4 to load a **board-present**
  colour (always-progress gameplay + tractable winnability); B4's solver is a
  greedy DFS certifying ~45% of seeds (365-seed pack, byte-identically
  regenerable); registry/page wiring was pulled into **B6** (not B7) so the
  wiring test could drive a real `/bubble/`. `pond-outcome` needed **no** change
  (as predicted). Full gate green; deploy-ready; not pushed.
