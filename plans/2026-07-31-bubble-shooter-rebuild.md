# Bubble shooter rebuild — real aim-and-shoot, deterministic (phase plan)

**Status:** 🚧 EXECUTING (branch `claude/bubble-shooter-rebuild`, worktree
`worktrees/fun/bubble-v2`). **V0–V4 complete + committed; V5 (aim UI) next.**
Rebuilds the shipped `/bubble/` from **tap-a-cell-to-place** into a **real Bubble
Shooter** (aim → shoot → fly → bounce → stick → pop), while keeping the shelf's
verifiable outcome via a quantized-angle + fixed-point core.

## Execution log

- **V0+V1 (commit `0a21590`):** fixed-point aim → landing resolver (`aim.rs`:
  `Angle`, `resolve_shot`, committed `directions.json` integer table). 21 tests.
- **V2a (commit `0565dc3`):** `engine::shoot_angle` = `resolve_shot` then place/
  pop/drop (extracted `apply_shot`, no legality gate). Additive; workspace green.
- **V2+V3+V4 (commit `33067d1`) — the atomic `Pos→Angle` flip** (one commit
  because `Bubble::Move`/`shots()` is one type that couples core+solver+wasm+pack):
  - **V2 game:** `Game::play(Angle)` (infallible; a `taken` counter tracks the
    budget separately from the recorded angle line); `Bubble` `Move = Angle`,
    `VERSION = 2`.
  - **V3 solver:** the DFS move set is the **reachable-landing set**
    (`reachable_landings`: distinct cells the fan actually lands on, each with its
    angle) — *not* `legal_targets`. **Decision (deviation from the plan's
    landing-space-then-map sketch):** an early landing-space DFS + post-hoc
    `angle_for_landing` mapping rejected ~all lines, because most legal cells are
    "tucked" and unreachable by any ray. Searching the physical reachable set
    directly is correct (every found line replays) and needs no mapping.
    `angle_for_landing` stays in core as a tested utility. Pack regenerated: 365
    angle-winnable seeds, fixture seed 495 clears in 7 shots. Aim acceptance
    ~20% (vs tap-anywhere) — expected; the aim model is harder.
  - **V4 wasm:** `shoot(angle)` (0/2), `trajectory_json(angle)` (fixed-point path
    + landing), `legal_targets_json` removed; `bubble-wasm.ts` wrapper updated.
  - **Verified:** `cargo test --workspace` 229 passed / 17 ignored; fmt + clippy
    clean; `npm run build:wasm` builds; Node C-ABI smoke fires the fixture's 7
    angles → clears (score 57) → verifiable bubble **v2** record.
  - **Known-red until V5:** `bubble.ts` (UI) still calls the old tap-target
    wrapper API, so `tsc`/e2e fail until the V5 rewrite.
- **V5 exposure plan:** the aim UI needs geometry + fan from the core (single
  source of truth) — add `geom_json` (`diam`/`radius`/`rowH`/`fanLo`/`fanHi`) and
  a reachable-aware `hint_angle` to the wasm; render on a canvas with an
  accessible `<input type=range>` angle control + pointer/touch aim.

## Problem Statement

The shipped bubble game (`/bubble/`) is the wrong game. It is **tap-a-target-cell
to place a bubble** — effectively a "pick where to drop / pop-connect" puzzle.
What was wanted (owner, 2026-07-31, ref bubbleshooter.com + OpenGenus
`Bubble-Shooter-game-in-HTML` + natygames `animals-pop`) is a **classic Bubble
Shooter**: a launcher at the bottom, the player **aims an angle**, **shoots** a
bubble that **flies up**, **bounces off the side walls**, **sticks** where it
first touches an existing bubble (or the ceiling), and **pops** the connected
same-colour group of 3+, with unsupported bubbles dropping.

The v1 tap-to-place interaction was a deliberate determinism tradeoff — the v1
plan (`plans/2026-07-30-bubble-shooter.md`) chose it *specifically* to avoid
floating-point trajectories, which break the `native==wasm` `state_hash`. That
protected verifiability but discarded the actual game. This rebuild fixes that.

Goal: `/bubble/` is a real aim-and-shoot bubble shooter that still meets every
standard in `docs/BUILDING-GAMES.md` — including the verifiable outcome +
re-verifying `?r=` share.

## Reasoning

- **A real shooter *is* compatible with determinism — split physics from
  presentation.** The insight the v1 plan missed:
  1. **Quantize the aim** to an integer angle (proposal: tenths of a degree in a
     legal fan, e.g. `100..=1700` = 10.0°..170.0°, a `u16`). The move is that
     integer.
  2. **Resolve the shot in the core in fixed-point integer math** — ray-cast the
     projectile from the launcher along the angle, reflecting off the left/right
     walls, until it first contacts an occupied cell or the ceiling; snap to the
     nearest empty hex cell at that contact. This yields a landing `Pos`
     deterministically, **with no floats on the hashed path** (fixed-point `i32`
     with a fixed shift, integer reflection). `(seed, angles)` replays exactly;
     the `state_hash` stays integer, so `native==wasm` holds.
  3. **The flying-bubble animation is purely presentational.** The UI animates
     the projectile along the path the core already computed (the core can hand
     the UI the fixed-point path points to render); floats in the rAF animation
     never touch the hash. The core decides the landing; the UI only visualizes
     it.
- **Reuse the board + pop/drop + score + outcome machinery.** v1's staggered-hex
  `Board` (6-neighbour adjacency, `row_len`, `neighbors`), the connected-cluster
  **pop (≥3)** + floating-cluster **drop** + **score**, the deterministic
  launcher-colour stream (`DetRng` over the present colour set), the
  `pond-outcome` binding, and the winnable-daily pack all carry over. What
  changes is the **input/aim/landing layer**: the move type goes from
  `Pos` (target cell) to `Angle` (`u16`), and a new `resolve_shot(board, angle)
  -> Pos` sits in front of the existing `shoot(board, pos, colour)`.
- **Evolve `bubble-core` in place, bump the record version to 2.** It is the same
  game, corrected — same crate names, game id `bubble`, URL `/bubble/`. The
  `pond-outcome` `Move` type and `VERSION` change (`Pos`→`Angle`, v1→v2), which
  invalidates old `?r=` shares and the old daily pack — acceptable pre-1.0 (no
  back-compat; global rule), and the old bubble had no real players yet. Regenerate
  the pack.
- **The solver searches over reachable landings, mapped to angles.** v1's solver
  searched target `Pos`es. The set of reachable landing cells for a board is
  exactly what a fan of angles produces, so the solver still searches landing
  cells (bounded DFS, as v1), and for the daily-pack **fixture** records the
  **angle** that reaches each chosen landing (via `resolve_shot`'s inverse: pick
  any angle whose landing == the cell). Winnability is preserved.
- **Legality is trivial but the core still decides.** Every angle lands
  *somewhere* (top row if it hits nothing), so there is no "illegal shot"; the
  core computes the landing from the angle and the UI never decides it. The
  guardrail E2E asserts the landing the UI animates to == the core's resolved
  landing (the UI does not invent physics).

## Verified Assumptions

- **The board + engine surface to reuse** (`crates/bubble-core/src/`): `board.rs`
  (staggered hex: `row_len`, `neighbors`, `get/set/index`, `Cell`),
  `engine.rs` (`deal`, `shoot(board, pos, colour) -> ShotReport{popped, dropped,
  score_gain}`, `legal_targets`, `is_cleared`, `ShotError`), `game.rs`
  (`Game` with the `DetRng` launcher-colour stream + budget + score + `impl
  pond_outcome::Game`, `Move=Pos`), `hash.rs` (`state_hash(board, colors, draws,
  score)` — integer, unchanged). (Read 2026-07-31.)
- **`state_hash` needs no change** — it already hashes only board + colors +
  draws + score (all integer). The move type change does not touch it. (Read
  2026-07-31.)
- **`pond-outcome` is generic over `Move: Serialize + DeserializeOwned + Clone`**
  — an `Angle(u16)` newtype satisfies it; only `bubble-core`'s `impl` changes.
  (Verified across the wyrdle/2048 builds.)
- **Fixed-point trajectory determinism is the one real unknown** → resolved by a
  **Phase 0 spike** (below) before committing the later phases.
- **The UI aiming + flying-bubble pattern** is standard (bubbleshooter.com,
  OpenGenus HTML impl) — pointer/drag to aim, a dotted trajectory preview with
  wall bounces, a rAF projectile animation. To be prototyped in Phase 0.

## Documentation Impact

- `crates/bubble-core/RULES.md` — rewrite the "Aim / The shot" section: quantized
  angle, fixed-point ray-cast + wall reflection, landing resolution; note the
  move type change (`Pos`→`Angle`) + version bump. Phases: V0–V2.
- `plans/2026-07-30-bubble-shooter.md` — add a header note: superseded by this
  rebuild (tap-to-place → aim-and-shoot). Phase: V6.
- `docs/BUILDING-GAMES.md` — §4 currently says bubble uses "tap-a-target aim (no
  continuous physics)" as *the* determinism example; update it to the correct
  general principle: **quantized input + fixed-point core physics + cosmetic
  float animation** keeps continuous-feeling games verifiable. Phase: V6.
- `README.md` — rewrite the Bubble line (aim-and-shoot). `TODO/bubble.md` — prune
  done items, add v2 follow-ups (variants, aim-assist toggle). Phase: V6.
- `src/registry.ts`, `src/how-to-registry.ts` — bubble entries stay (id
  unchanged); the how-to content is rewritten (V6). `tools/guide-shots.mjs` —
  the bubble shots change (aiming + a shot in flight). Phase: V6.

## Concurrency Map

Sequential spine: **V0 → V1 → V2 → V3 → V4 → V5 → V6.** Each phase reads what the
prior wrote. All sequential; no parallel set. Runs in the isolated worktree
`worktrees/fun/bubble-v2` (branch `claude/bubble-shooter-rebuild`) off
`origin/main`; the active match-3 session's shared-file surface is the usual six
(`Cargo.toml`, `build.mjs`, `tools/build-wasm.sh`, `src/registry.ts`,
`src/how-to-registry.ts`, `README.md`) — merge-time only. Bubble-owned paths
(`crates/bubble-*`, `src/games/bubble/*`, `games/bubble/*`, `tests/bubble.spec.ts`)
are ours. Isolation invariants: no `git checkout/stash/rebase` in the main `fun/`
worktree; writes confined to this worktree + scratchpad.

## Phases

### Phase V0 — Discovery: fixed-point trajectory + landing (the real unknown)
**Goal:** prove a deterministic, integer fixed-point ray-cast (with wall bounce)
maps a quantized angle to a sensible landing hex cell, and that it feels right,
before building the game on it.
**Discovery tasks:**
- [ ] **BS-D1: Fixed-point ray-cast + wall reflection → contact point.** Spike a
  fixed-point (`i32`, shift 16) ray from the launcher origin along a quantized
  angle, reflecting off left/right walls, stepping until it enters an occupied
  cell's radius or the ceiling. **Success:** a table of `angle -> contact (x,y)`
  is reproducible bit-for-bit across two runs and across native vs a wasm build
  (reuse the determinism discipline; a tiny xbuild-style check). Disposition:
  `promote` (becomes `engine::resolve_shot`).
- [ ] **BS-D2: Contact → landing hex cell.** Snap the contact point to the
  nearest empty hex cell adjacent to the first occupied cell hit (or a ceiling
  row cell). **Success:** a fan of angles yields a spread of distinct, plausible
  landing cells covering the board; no angle lands on an occupied cell.
  Disposition: `promote`.
- [ ] **BS-D3: Aim/preview UI feel prototype.** A throwaway HTML/canvas or DOM
  spike: launcher at bottom, pointer-aim, a dotted trajectory preview with
  bounce, a rAF projectile animation to the core-computed landing. **Success:**
  aiming + preview + fly reads as a real bubble shooter; confirm the preview path
  (from the fixed-point sim) matches where the animated bubble lands.
  Disposition: `throwaway` (informs V5).
- [ ] **BS-D4: Angle granularity + fan limits.** Decide the angle unit (tenths of
  a degree?) and the legal fan (exclude near-horizontal/straight-down). **Success:**
  a granularity where adjacent angles usually map to adjacent/near landings (fine
  control) without an absurd move alphabet.
**Outputs fed back:** Verified Assumptions gains the fixed-point scheme + angle
unit; V1's `resolve_shot` signature is fixed from BS-D1/D2; V5's UI approach from
BS-D3. If the fixed-point sim can't be made cleanly deterministic (unlikely),
escalate before V1.
**Done when:** a documented, reproducible `angle -> landing` mapping exists
(native==wasm), and the aim/preview feel is validated. **Discovery Exemption
applies.**
**Validation:** Moderate — reproducibility table + a felt UI prototype.

### Phase V1 — core: `resolve_shot` (angle → landing) + `shoot_angle`
**Goal:** the deterministic aim/landing layer in front of the existing pop/drop.
**Changes:**
- [ ] `crates/bubble-core/src/aim.rs` — `Angle(u16)` newtype (serde as an int) +
  `resolve_shot(board, angle) -> Landing { pos: Pos, path: Vec<(i32,i32)> }`
  (fixed-point ray-cast + reflection from V0; `path` is the fixed-point points
  for the UI to animate/preview). Legal-fan clamping.
- [ ] `engine.rs` — `shoot_angle(board, angle, colour) -> ShotReport` =
  `resolve_shot` then the existing `shoot(board, landing, colour)`.
- [ ] `RULES.md` — the new aim section.
- [ ] `tests/golden.rs` — pinned `angle -> landing` vectors (incl. a wall-bounce
  case and a straight-up case) + a pinned trajectory hash; a spot-check that
  landings are always empty + adjacent to an occupied cell or on the ceiling row.
**Wiring test:** `golden.rs::angle_resolves_to_pinned_landing` — scripted angles
on a crafted board resolve to the hand/spike-derived landing cells; RED first.
**Test edges:** a wall-bounce angle lands mirrored correctly; an angle into a gap
lands on the ceiling; two runs of `resolve_shot` are identical (determinism); a
near-horizontal angle is clamped into the legal fan.
**Depends on:** V0.
**Read-set:** `crates/bubble-core/src/{board,engine,hash,lib}.rs`.
**Write-set:** `crates/bubble-core/src/{aim.rs,engine.rs,lib.rs}`, `RULES.md`, `tests/golden.rs`.
**Observability:** `resolve_shot` never panics; an out-of-fan angle is clamped
(documented), not an error.
**Done when:** crafted angles resolve to pinned landings (native); `cargo test -p
bubble-core` + fmt + clippy clean.
**Validation:** Narrow — golden + unit over the pure resolver.

### Phase V2 — core: `Game` + `pond-outcome` move to `Angle`
**Goal:** the play-loop + verifiable outcome keyed on angles.
**Changes:**
- [ ] `game.rs` — `Game::play(angle: Angle)` (was `Pos`): `shoot_angle` with the
  current launcher colour, accumulate score, record the **angle**, advance the
  colour. `shots(): &[Angle]`. Keep budget/`is_won`/`is_lost`/`current_hash`.
- [ ] `impl pond_outcome::Game for Bubble` — `Move = Angle`, `VERSION = 2`;
  `replay(seed, angles)` re-derives each landing + pops.
- [ ] update `game.rs` tests (scripted angle line; verify roundtrip + tamper).
**Wiring test:** `verify_roundtrip` on an angle line: `attest`→`verify` ok,
tampered angle/hash fail. RED until `play(Angle)` exists.
**Test edges:** win on the last shot via an angle line; replay determinism;
a tampered angle diverges the hash.
**Depends on:** V1.
**Write-set:** `crates/bubble-core/src/{game.rs,lib.rs}`, `tests/golden.rs`.
**Done when:** a scripted angle game attests + re-verifies (tamper fails);
`cargo test -p bubble-core` + `-p pond-outcome` green.
**Validation:** Narrow — wiring + unit.

### Phase V3 — solver + winnable pack over angles
**Goal:** regenerate the winnable-daily pack for the aim model.
**Changes:**
- [ ] `crates/bubble-solver` — search reachable **landings** (via the current
  board's empty-adjacent cells, as v1's `legal_targets`), pick a clearing line,
  and map each chosen landing back to a representative **angle** (`resolve_shot`
  inverse: scan the fan for an angle whose landing == the cell). Fixture stores
  angles.
- [ ] regenerate `games/bubble/daily-pack.json` (now angle fixtures);
  byte-identical regen drill.
**Wiring test:** `pack_lines_clear` — replay `(seed, angle_line)` through
`bubble_core::Game` → `is_cleared`; `pack_regen_byte_identical`. RED.
**Depends on:** V1, V2.
**Write-set:** `crates/bubble-solver/**`, `games/bubble/daily-pack.json`.
**Observability:** generator logs scanned/accepted/rejected; a landing with no
angle in the fan is logged + skipped (no silent gap).
**Done when:** the pack's fixture angle line clears by replay; byte-identical
regen; `cargo test -p bubble-solver` green.
**Validation:** Moderate — wiring + regen + acceptance sanity.

### Phase V4 — bubble-wasm: shoot-by-angle + trajectory read
**Goal:** the browser drives shots by angle and can render the path.
**Changes:**
- [ ] `crates/bubble-wasm/src/lib.rs` — replace the target-based export with
  `shoot(angle: u32) -> u32` (0 applied / 2 over); `trajectory_json(angle)` →
  the fixed-point path points + resolved landing (for preview + animation);
  keep `board_json`, `current_color`, `score`, `shots_left`, `current_hash`,
  `is_cleared`, `outcome_json`, `bubble_daily_seed`. Never panics.
- [ ] `src/games/bubble/bubble-wasm.ts` — typed wrapper: `shoot(angle)`,
  `trajectory(angle): {points, landing}`, remove `legalTargets`.
**Wiring test:** native C-ABI test — `new_game` → `trajectory_json(angle)` parses
→ `shoot(angle)==0` → `outcome_json` parses to a bubble v2 record. RED.
**Depends on:** V2, V3.
**Write-set:** `crates/bubble-wasm/src/lib.rs`, `src/games/bubble/bubble-wasm.ts`,
`build.mjs` (pack unchanged path), `Cargo.lock`.
**Done when:** `npm run build:wasm` builds; C-ABI test + `cargo test --workspace`
green; a JS smoke shoots an angle and clears via the fixture.
**Validation:** Moderate — wiring + build + smoke.

### Phase V5 — UI: aim, trajectory preview, flying-bubble animation
**Goal:** replace the tap-target UI with a real aim-and-shoot `/bubble/`.
**Changes:**
- [ ] `src/games/bubble/bubble.ts` — a launcher at the bottom (current + next
  colour); **aim** by pointer/drag (launcher points at the cursor) + keyboard
  (←/→ rotate, ↑/Space fire) + touch drag-to-aim; a **dotted trajectory preview**
  (from `trajectory(angle)`, incl. wall bounces); on fire, animate the projectile
  along the core path (rAF, reduced-motion → snap), then re-render pop/drop.
  Reuse the verification-forward result + `?r=` share + hints/settings (a hint =
  a good angle from the solver/`legal`-analog; assistance).
- [ ] tokens/styles: the aim reticle, trajectory dots, projectile, launcher.
- [ ] `tests/bubble.spec.ts` — rewrite: aim + fire lands where the core says
  (the guardrail: the animated landing == `trajectory(angle).landing`); the
  fixture angle line clears to a verifiable win + `?r=` round-trip; hints-off
  "I'm done"; axe both themes; 360px; **reduced-motion** snaps instantly.
**Wiring test:** e2e through `/bubble/` — set an angle, fire, board changes to the
core-resolved landing; RED until wired.
**Depends on:** V4.
**Write-set:** `src/games/bubble/bubble.ts`, `tokens.css`, `styles.css`, `tests/bubble.spec.ts`.
**Done when:** a stranger opens `/bubble/`, aims, fires, watches the bubble fly +
bounce + stick + pop, and on clear/out sees a verifiable result + share;
hints/settings/daily/free-play work. `npm run test` + `npm run e2e` green.
**Validation:** Broad — e2e + manual play (aim feel) + axe + 360px + reduced-motion
+ landing-matches-core guardrail + share round-trip.

### Phase V6 — how-to, docs, guide shots, gate, deploy-ready
**Goal:** bubble v2 is a first-class shelf game; gate green.
**Changes:**
- [ ] `src/games/bubble/bubble-howto.ts` — rewrite for aim-and-shoot; `guide:shots`
  (aiming + a shot in flight + a pop). `docs/BUILDING-GAMES.md` §4 correction;
  `README.md`; `TODO/bubble.md`; supersede-note on the v1 plan.
- [ ] full gate: `cargo test --workspace` + fmt + clippy; `npm run test` + `npm run e2e`.
**Depends on:** V5.
**Done when:** drawer launches the real shooter, how-to shows aim-and-shoot with
fresh shots; full gate green; deploy-ready (not pushed unless asked).
**Validation:** Broad — full gate + local serve smoke.

## Open Questions

- [RECOMMENDED: PHASE-GATED (V0)] **BS-Q1 — angle unit + legal fan.** Recommended:
  tenths of a degree (`u16`), fan ≈ 10°..170°. *Rationale: fine enough for control,
  small enough alphabet; V0 confirms the feel.*
- [RECOMMENDED: ADVISORY] **BS-Q2 — objective.** Recommended: keep v1's
  **clear-the-board-in-N-shots + winnable pack** (reuses the machinery). Alternative:
  a descending-ceiling / endless score-attack (closer to bubbleshooter.com but no
  bounded winnability). *Rationale: clear-the-board keeps the verifiable winnable
  pack; ceiling-descent is a bigger scope + winnability question. Advisory — decide
  by V3.*
- [RECOMMENDED: ADVISORY] **BS-Q3 — evolve in place vs new crate.** Recommended:
  **evolve `bubble-core` in place**, bump record `VERSION` to 2 (old shares/pack
  invalidated — fine pre-1.0). *Rationale: same game corrected; avoids a parallel
  crate. Advisory.*

No BLOCKING questions. BS-Q1 is resolved by the V0 spike.

## Review Log

- **2026-07-31 Pass 1+2+3 (combined).** Built from the shipped bubble v1 + the
  owner's correction (tap-to-place → real aim-and-shoot, ref bubbleshooter.com).
  Core decision: quantized integer angle + fixed-point ray-cast/bounce in the
  core (deterministic, native==wasm) with a **cosmetic** float animation in the
  UI — so a continuous-feeling shooter keeps the verifiable outcome. Reuse
  board/pop/drop/score/pack; change only the aim/landing/move-type layer
  (`Pos`→`Angle`, `VERSION` 1→2). Phase 0 spike de-risks the fixed-point geometry
  (the one real unknown) before the build phases. Pass-2: write-sets disjoint from
  match-3's except the six shared files; every phase leads RED at its entry point.
  Pass-3: TDD ordering; typed/no-panic core; mutation edges (wall-bounce mirror,
  ceiling landing, determinism, tamper); validation calibrated (V0 Moderate, V1/V2
  Narrow, V3/V4 Moderate, V5/V6 Broad); BUILDING-GAMES §4 correction scheduled in
  its phase. Awaiting owner review before executing V0.
