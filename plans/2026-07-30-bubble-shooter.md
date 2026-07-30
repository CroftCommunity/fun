# Bubble shooter — Tier-1 build-fresh (phase plan)

**Status:** Pass 1+2 complete 2026-07-30 (planning). **B1 + B2 already executed
TDD-first and committed** (see Phases). B3–B6 planned below, not yet executed;
Pass 3 (quality gates) pending in a fresh context before execution resumes.

> Convention note: this repo keeps plans as `plans/YYYY-MM-DD-<slug>.md` (e.g.
> `2026-07-30-match3-playable.md`), so this file keeps that name rather than the
> phase-plan skill's `N-plan-` scheme (skill: "match the existing convention").

## Problem Statement

`fun.croft.ing` is a two-tier game shelf (COHESION §62). Tier 1 = Croft-native,
build-fresh, **determinism-first + verifiable outcome**; solitaire and match-3
ship. The bubble shooter is the next Tier-1 game. Owner decided it is
**build-fresh, not a wrap** of Frozen Bubble, precisely to keep the
verifiable-outcome magic (a provable, shareable score/clear) and a clean license
— an off-the-shelf JS bubble shooter has neither. It is **single-player and
ungated** (no P2P, no fair-reveal), so it can land ahead of the P2P-gated
cribbage. Objective (owner): **clear-the-board-in-N-shots**.

Goal: `/bubble/` is a real, verifiable, accessible game meeting every standard in
`docs/BUILDING-GAMES.md`.

## Reasoning

- **Build fresh, not wrap.** Frozen Bubble is GPL/Perl-lineage with GPL/CC-BY-SA
  art; the mechanic is simple enough that building is ≤ the cost of a wrap + the
  Tier-2 containment harness, and building is the *only* path that yields a
  verifiable outcome + our own identity. (Owner-confirmed via the tier question.)
- **Tap-target aim, not continuous physics.** A continuous trajectory uses
  floats, which break the native==wasm `state_hash`. Instead the player **taps a
  target cell**; the core decides reachability. A shot's move is a small integer
  `Pos`, so `(seed, targets)` replays exactly. The determinism constraint and the
  tap-first accessibility floor agree — one decision satisfies both.
- **Deterministic launcher colours.** The colour of each shot is derived from
  `(seed, shot_index)` via the same ChaCha20 stream, so replay re-derives every
  shot's colour; the move list is only the targets. This lives in a `Game`
  wrapper (B3).
- **Objective = clear-the-board-in-N-shots (owner).** Win = board empty within N
  shots; a completed run that doesn't clear is `Outcome::Lost` (verifiable by
  replay). Maps onto the existing `pond-outcome` model with **no additive
  changes** (see Verified Assumptions).
- **No solver for v1 (mirror match-3).** match-3 chose flat thresholds over a
  per-deal solver. Bubble mirrors: a **generous shot budget**, no
  winnable-guarantee solver; an unclearable deal honestly ends `Lost`. A
  winnable-pack solver is a deferred variant (Open Question B3-Q1).
- **Game isolation (owner, 2026-07-30).** Each game owns a self-contained
  directory; shared shelf infrastructure stays shared. Concretely: the bubble
  game's TS (`bubble.ts`, its wasm wrapper, its how-to data, any bubble assets)
  lives under a **per-game directory `src/games/bubble/`**, not scattered in a
  flat `src/games/`. The Rust crates stay per-game already (`bubble-core`,
  `bubble-wasm`) as Cargo workspace members under `crates/`. Shared substrate
  (drawer chrome, settings, theme, how-to renderer, `pond-docformat`,
  `pond-outcome`) is *not* duplicated per game — the shelf is built once
  (BUILDING-GAMES §1). Migrating the *existing* solitaire/match-3 TS into
  per-game dirs is a separate, owner-gated step coordinated with the active
  match-3 session (Open Question Q-ISO).

## Verified Assumptions

- **`pond-outcome` already models clear-the-board — no additive change needed.**
  `crates/pond-outcome/src/lib.rs`: the `Game` trait (`replay(seed, moves) ->
  Replayed`), `Replayed::new(hash, won)` / `Replayed::scored(...)`, `Outcome`
  has `Won` and `Lost`, and `Record<M>` carries optional `score`/`stars`
  (`skip_serializing_if`). A clear-the-board bubble game is win/lose (+optional
  score) → `Replayed::new` / `Outcome::Lost` cover it. (Read 2026-07-30.)
- **match3-wasm gives the exact C-ABI shape to mirror.** `crates/match3-wasm/src/
  lib.rs` exports `new_game(seed_lo,seed_hi)`, `board_json()`,
  `legal_moves_json()`, `current_hash()`, `score()`, `moves_left()`,
  `is_won()`, `play_swap(...)->u32` (status), `mark_assistance()`,
  `outcome_json(declare)->*const u8`, `out_len()`, `target_daily_seed(u32)` — raw
  C-ABI + serde-JSON, a `ptr`/`len` out-buffer, never panics. B4 mirrors this
  surface. (Read 2026-07-30.)
- **B1/B2 core is green.** `bubble-core`: hex geometry + six-neighbour adjacency,
  seeded `deal`, `bub\x00` `state_hash`, `is_legal_target`/`legal_targets`,
  `shoot` (place→pop≥3→drop-floating, score = popped + 2·dropped), `is_cleared`.
  18 tests + a pinned golden; fmt + clippy(default+pedantic) clean. (Committed
  839bca8, 40d4045.)
- **Registry + how-to registry are the two shared wiring points.**
  `src/registry.ts` (`REGISTRY` array; `cribbage` is `status:"soon"`) and
  `src/how-to-registry.ts`. A new game becomes playable by a registry entry with
  `status:"playable"` + a `load` factory + its own `/<id>/` URL. (Read 2026-07-30.)

## Documentation Impact

- `docs/BUILDING-GAMES.md` — add a **Game isolation** section (per-game directory
  convention) [this turn, directives update] and confirm the new-game checklist
  still fits bubble. Phase: directives update / B6.
- `fun/CLAUDE.md` — **new** project-layer directives (TDD, phase-plan,
  determinism-first, two-tier, per-game isolation). Phase: directives update
  (this turn).
- `README.md` — add bubble to the shelf order + crate list + `games/` map.
  Phase: B6.
- `TODO/bubble.md` — **new**, bubble follow-ups (variants, specials, ceiling
  advance, winnable-pack). Phase: B6.
- `src/registry.ts`, `src/how-to-registry.ts` — bubble entries. Phase: B6 (grep
  confirms these are the only registries).

## Concurrency Map

Sequential spine: **B3 → B4 → B5 → B6.** Each phase reads what the prior wrote
(B4 binds the B3 `Game`; B5 UI calls the B4 wasm; B6 guide/tests exercise the B5
UI). All later phases sequential — each phase reads what the prior wrote.

**Shared-file coordination risk (not parallelism within this plan, but across
sessions):** B4 and B6 edit files the **active match-3 session also edits** —
`Cargo.toml` (workspace members), `build.mjs` (wasm build list), `src/
registry.ts`, `src/how-to-registry.ts`. This worktree is isolated at the git
level (branch `claude/games-tier`), so there is no live trampling, but these
files will need a clean merge/rebase against `fun` main at delivery. Treated as a
merge-time concern, flagged here so it isn't a surprise. bubble-owned files
(`crates/bubble-*`, `src/games/bubble/*`, `games/bubble/*`) do not overlap
match-3's, so the merge surface is exactly those four shared files.

## Phases

### Phase B1 — core: hex geometry + seeded deal ✅ DONE (839bca8)
**Goal:** the determinism foundation. **Done:** staggered hex `Board`,
six-neighbour adjacency, seeded `deal`, `state_hash`; 11 lib tests + a pinned
golden (seed 1 → 38 draws). RED→GREEN; fmt + clippy clean.

### Phase B2 — core: shot resolution + scoring ✅ DONE (40d4045)
**Goal:** place → pop → drop. **Done:** `is_legal_target`/`legal_targets`,
`shoot` (pop connected ≥3, drop floating, score = popped + 2·dropped),
`is_cleared`; 6 more tests + a pinned shot-pipeline golden. RED→GREEN.

### Phase B3 — core: the `Game` wrapper + `pond-outcome` impl
**Goal:** a play-loop with deterministic launcher colours, a shot budget, and a
verifiable outcome, so a game is replayable from `(seed, targets)`.
**Changes:**
- [ ] `crates/bubble-core/src/game.rs` — a `Game` struct: holds the board, seed,
  `colors`, shot budget `N`, shots taken (`Vec<Pos>`), score. `current_color()`
  = deterministic from `(seed, shot_index)` (ChaCha20). `play(target) ->
  Result<ShotReport, ShotError>` (uses B2 `shoot` with the derived colour).
  `shots_left()`, `is_won()` (= `is_cleared`), `is_lost()` (= budget spent, not
  cleared), `current_hash()`.
- [ ] `impl pond_outcome::Game for Bubble`: `Move = Pos`, `KIND="bubble"`,
  `VERSION=1`, `replay(seed, targets)` re-derives colours, applies each shot,
  returns `Replayed::new(hash, won)` (or `scored` if we surface score — B3-Q2).
- [ ] add `bubble-core` dep on `pond-outcome`; wire the golden replay test.
**Call chain:** (Rust) `pond_outcome::verify::<Bubble>(record)` → `Bubble::replay`
→ `Game::play`×n → `engine::shoot`. Wiring test drives `verify` end-to-end.
**Wiring test:** `verify_roundtrip`: build a `Game`, play a scripted winning
sequence, `attest` → `Record`, `verify` → `ok == true`; and a tampered hash →
`ok == false`. RED until `impl Game` + `Game` exist.
**Depends on:** B2.
**Read-set:** `crates/bubble-core/src/{engine,board,rng,hash,lib}.rs`,
`crates/pond-outcome/src/lib.rs`.
**Write-set:** `crates/bubble-core/src/game.rs`, `crates/bubble-core/src/lib.rs`
(re-export + module), `crates/bubble-core/Cargo.toml` (add `pond-outcome`),
`crates/bubble-core/tests/golden.rs` (replay golden).
**Shared-state contract:** no shared mutable state beyond the file write-set;
Rust-only, no git/process/network. `Cargo.lock` gains the dep edge (benign).
**Risks:** deterministic-colour derivation must be folded so replay matches
play; a golden replay vector pins it. Clear-the-board winnability (B3-Q1).
**Done when:**
1. **Behavioral:** a scripted bubble game can be attested to a `Record` and
   re-verified by replay (and a tampered record fails), entirely through
   `pond_outcome::{attest,verify}`.
2. **Verification:** `cargo test -p bubble-core` (incl. the new `verify_roundtrip`
   + replay golden) green; `-p pond-outcome` still green (no additive change).
**Validation:** Narrow/moderate — wiring test + unit + golden. Tests sufficient.

### Phase B4 — bubble-wasm C-ABI binding + typed TS wrapper
**Goal:** the browser can hold a `Game` and drive it. Mirror match3-wasm exactly.
**Changes:**
- [ ] `crates/bubble-wasm/` — raw C-ABI over `bubble_core::Game`: `new_game(seed_lo,
  seed_hi)`, `board_json()`, `legal_targets_json()`, `current_color()`,
  `shoot(r,c)->u32` (status), `score()`, `shots_left()`, `current_hash()`,
  `is_cleared()`, `mark_assistance()`, `outcome_json(declare)->*const u8`,
  `out_len()`, `bubble_daily_seed(day_index)`. **Never panics** (every fallible
  path → status code / empty buffer).
- [ ] `src/games/bubble/bubble-wasm.ts` — typed TS wrapper over the exports (the
  per-game directory; game isolation).
- [ ] `Cargo.toml` (workspace member), `build.mjs` (build + serve `/bubble.wasm`).
**Call chain:** `bubble-wasm.ts` → wasm `shoot`/`board_json` → `bubble_core::Game`.
**Wiring test:** a Rust `tests/` over the C-ABI: `new_game` → `shoot` a scripted
win → `is_cleared()==1`, `outcome_json` parses to a verifiable record. (The JS
side is covered by B5's e2e.) RED until the binding exists.
**Depends on:** B3.
**Read-set:** `crates/bubble-core/**`, `crates/match3-wasm/src/lib.rs` (pattern),
`build.mjs`.
**Write-set:** `crates/bubble-wasm/{Cargo.toml,src/lib.rs}`,
`src/games/bubble/bubble-wasm.ts`, `Cargo.toml`, `build.mjs`, `Cargo.lock`.
**Shared-state contract:** edits shared `Cargo.toml` + `build.mjs` (see
Concurrency Map merge risk); no runtime shared state; wasm holds module-static
game state (single-game-at-a-time, as match3-wasm does).
**Risks:** the raw-pointer out-buffer + never-panic discipline; `seed_lo/hi`
u64-split must match match3's convention.
**Done when:**
1. **Behavioral:** JS can start a game, read the board + legal targets + current
   colour, shoot a target, read score/shots-left/cleared, and get a verifiable
   `outcome_json`.
2. **Verification:** `npm run build:wasm` builds `/bubble.wasm`; the C-ABI Rust
   test + `cargo test --workspace` green; the native==wasm xbuild check passes.
**Validation:** Moderate — wiring test + build the wasm + a scripted JS smoke.

### Phase B5 — board UI (`src/games/bubble/bubble.ts`)
**Goal:** a playable, accessible, verification-forward `/bubble/`.
**Changes:**
- [ ] `src/games/bubble/bubble.ts` — a `GameModule` (`mount`/`unmount`): render
  the hex board (bubble tokens, colour-blind-safe shape+hue, AA both themes),
  a launcher showing current + next colour, **tap a target cell → core-driven
  legal-target glow → `shoot`**, pop/drop re-render, score / shots-left HUD.
- [ ] board-cleared (or shots-out) → **verification-forward** result screen
  (record + one-tap re-verify + deflated `?r=` share that re-verifies on open).
- [ ] daily (date-seed via `bubble_daily_seed`) + free-play (`?seed=`); hints
  (point at a good legal target; counts as assistance) + the shared settings;
  hints-off → "I'm stuck" ends + reports honestly.
- [ ] bubble tokens in `tokens.css` (the only-hex file); AA recorded + asserted.
**Call chain:** `/bubble/` URL → drawer/registry `load` → `bubble.ts mount` →
`bubble-wasm.ts` → wasm. **Wiring test:** an e2e that loads `/bubble/`, shoots a
legal target, and asserts the board changed + a result/record appears.
**Depends on:** B4.
**Read-set:** `src/contract.ts`, `src/chrome.ts`, `src/settings.ts`,
`src/theme.ts`, `src/how-to.ts`, `src/games/match3.ts` (reference), `tokens.css`.
**Write-set:** `src/games/bubble/bubble.ts`, `tokens.css`, `styles.css`
(bubble-specific classes via tokens), `src/games/bubble/*` assets.
**Shared-state contract:** edits shared `tokens.css`/`styles.css` (append-only
bubble tokens/classes; the hex-in-styles test must still pass) — a small shared
surface, merge-time only. No runtime shared state.
**Risks:** legal-target glow must read the core (`legal_targets_json`), never
re-implement legality (an e2e asserts an illegal tap is a no-op); 360px hex fit.
**Done when:**
1. **Behavioral:** a stranger opens `/bubble/`, taps target cells (legal targets
   glow; core decides), pops/drops, and on clear/shots-out sees a verifiable
   record with re-verify + share; hints/settings/daily/free-play all work.
2. **Verification:** `npm run test` (typecheck·lint·unit·build) + `npm run e2e`
   (Playwright incl. axe both themes) green.
**Validation:** Moderate/broad — wiring e2e + manual play + axe both themes +
360px + illegal-tap-noop guardrail + share round-trip.

### Phase B6 — how-to guide, registry wiring, tests, deploy
**Goal:** bubble is a first-class shelf game; gate green; live.
**Changes:**
- [ ] `src/games/bubble/bubble-howto.ts` (pure-data blocks, lead with the
  tap-to-aim interaction model) + `src/how-to-registry.ts` entry +
  `npm run guide:shots`.
- [ ] `src/registry.ts` — add `{id:"bubble", status:"playable", load}` + `/bubble/`.
- [ ] tests: shot mechanics, a clear-the-board win, illegal-tap no-op, share
  round-trip, axe both themes, 360px; how-to sync tests.
- [ ] `README.md` (shelf order + crates), `docs/BUILDING-GAMES.md` (confirm the
  isolation section + checklist), `TODO/bubble.md`.
- [ ] full gate + deploy (GitHub Actions → Pages).
**Call chain:** header link → `/how-to/?game=bubble` → shared renderer → bubble
howto data; and drawer → registry → bubble. **Wiring test:** how-to e2e (images
load, TOC==entries, axe) + the registry e2e (drawer lists + launches bubble).
**Depends on:** B5.
**Read-set:** `src/how-to.ts`, `src/how-to-page.ts`, `tools/guide-shots.mjs`,
`src/registry.ts`, `README.md`, `docs/BUILDING-GAMES.md`.
**Write-set:** `src/games/bubble/bubble-howto.ts`, `src/how-to-registry.ts`,
`src/registry.ts`, `README.md`, `docs/BUILDING-GAMES.md`, `TODO/bubble.md`,
`assets/guide/bubble-*.jpg`.
**Shared-state contract:** edits shared `registry.ts` + `how-to-registry.ts` +
`README.md` (merge-time coordination with match-3, as flagged). No runtime state.
**Risks:** guide-shot sync test fails if a guide names a missing shot; deploy
builds wasm in CI.
**Done when:**
1. **Behavioral:** the drawer lists Bubble as playable, launches it, the header
   links to its how-to (with generated screenshots), and it is live at
   `fun.croft.ing/bubble/`.
2. **Verification:** `cargo test --workspace` + fmt + clippy; `npm run test` +
   `npm run e2e` (incl. axe); deploy workflow green.
**Validation:** Broad — full gate + a live smoke on the deployed URL.

## Open Questions

- [RECOMMENDED: PHASE-GATED (B3)] **B3-Q1 — winnability.** Clear-the-board with a
  fixed deal + generous N and no solver (honest `Lost` on hard deals), mirroring
  match-3's no-solver call — or a winnable-pack solver? *Rationale: match-3
  precedent avoided the solver; a solver is a large deferred effort. Recommend
  no-solver v1, generous N, solver as a deferred variant.*
- [RECOMMENDED: PHASE-GATED (B3)] **B3-Q2 — score surfaced?** Clear-the-board is
  win/lose; do we also surface the pop/drop **score** (`Replayed::scored`, stars)
  as a secondary metric, or keep it pure win-in-N? *Rationale: score adds
  replay-compare value cheaply since B2 already computes it; recommend surface
  score, no stars for v1.*
- [RECOMMENDED: ADVISORY] **Q-ISO — migrate existing games to per-game dirs?**
  Adopt `src/games/bubble/` now (this plan); migrating solitaire/match-3 TS into
  `src/games/<game>/` is a separate owner-gated pass coordinated with the active
  match-3 session. *Rationale: don't restructure a sibling game mid-build;
  establish the pattern on the new game first.*

## Review Log

- **2026-07-30 Pass 1+2 (combined).** Built the plan from the existing draft +
  the phase-plan template. Added: Verified Assumptions (pond-outcome needs no
  change; match3-wasm C-ABI shape; registries) from reading the real source;
  the game-isolation decision (per-game `src/games/bubble/`) per owner steer;
  Concurrency Map (sequential + the cross-session shared-file merge risk on
  `Cargo.toml`/`build.mjs`/`registry.ts`/`how-to-registry.ts`); Documentation
  Impact; Wiring tests + Call chains + Read/Write-sets on every phase; three
  Open Questions. B1/B2 recorded as executed (TDD, committed). **Not yet run:**
  Pass 3 (quality gates: TDD ordering, observability, validation calibration) —
  do in a fresh context before executing B3.
