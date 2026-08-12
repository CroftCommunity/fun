# Emoji Wars — backlog (the first Tier-3 game)

A touch-first 2D physics game **plus its level editor**, currently living in its own repo
(`CroftCommunity/levelforge`, deployed at `levelforge.croft.ing`) and **decided to move into `fun`**
(owner, 2026-08-09). Standards anchor: `docs/BUILDING-GAMES.md` **§11 — Tier-3, engine-backed
originals**, which this game is the reference implementation for. Provenance:
`discovery/alpha/seeds/transcripts/raw/emojiwars-levelforge-three-modes-and-reshape-2026-08-09.md`
and `discovery/alpha/seeds/emojiwars-unpacked/`.

**Nothing in this file is started.** The tier standard exists; the game has not moved.

## Why it is Tier-3, and what that cost

A deterministic engine was **measured, found to work, and declined**. Rapier's
`enhanced-determinism` gives bit-identical native and wasm results
(`discovery/alpha/experiments/rapier-determinism`, `RESULT.md`) — the control is the interesting
half: wasm is stable with the feature on *or* off, and only **native** moves, because
`wasm32-unknown-unknown` has no platform math library and was already using libm. The price of
adopting it was re-deriving every phone-tuned feel constant in ~1,700 lines of play code against a
different solver, to buy a replay proof a hand-authored physics level does not especially want. So
§11 is a decision, not a default. The superseded plan is kept at
`plans/2026-08-09-emojiwars-physics-parity-harness.md` because the road not taken is what makes the
tier legible.

## Blocking the move

- [ ] **The file layout does not fit.** `fun`'s per-game shape is `crates/<game>-core` +
  `crates/<game>-wasm` + `src/games/<game>/`. Emoji Wars has **no Rust core** — it is Vite +
  TypeScript + matter-js. §11 covers the *standards*; it says nothing about layout. Decide the shape
  before moving anything.
- [ ] **The code does not know Tier-3 exists.** `src/contract.ts` is a union of `tier?: 1` and
  `tier: 2`, so `tier: 3` will not typecheck; `src/wrapped-banner.ts` returns `null` unless
  `tier === 2`. Shipping without widening **both** would put an **unmarked non-verifiable game on the
  shelf** — the exact failure the honesty rule exists to prevent. **Test-first**, and widen the banner
  condition rather than adding a second banner.

## The reshape (agreed in principle, unplanned)

- [ ] **Frontstage / backstage / lobby.** This names the defect precisely: `src/main.ts` is **3,721
  lines — 39% of a 9,642-line codebase** — holding editor UI, gestures, and **14 inline
  `level.meta.mode ===` branches with no `GameMode` interface**, and there is **no lobby module at
  all**, because the distinction was never in the code. Player and builder are inseparable **as a
  product**, entirely separable **as code**.
- [ ] **Mode rename + schema migration.** Repo ships `slingshot | drop | drive` at schema v0.8; the
  spec says `sling | drop | bounce`, and `drive` reads a `meta.goal` zone where the spec says
  `role:'goal'`. `levelforge/FOLLOWUP.md` deferred this to "a future pass" — this is that pass. A
  `migrate()` already exists, and committed levels plus the paste-and-load loop must not break.
- [ ] **Bounce mode has no reference oracle.** `levelforge.html` v0.12 cannot play it and `drive` is
  a prototype, so it is genuinely new construction, not a port. The spec forbids inventing beyond it;
  mirror drop where the spec is silent. Sequence it **last**.

## Tier-3 obligations this game must meet (§11)

- [ ] **The data/sim line must be visible in the directory structure**, not asserted in prose. Level
  schema, `migrate()`, and pure rules are the **data side** and keep full Tier-1 discipline — golden
  vectors, TDD red-first, mutation testing. Only the matter-js integration is the **sim side**.
- [ ] **Tolerance probes** replace golden vectors on the sim side, with tolerances **recorded from
  matter-js's own run-to-run variance** (the bar is "as close as the engine is to itself"), each
  isolating one subsystem so a failure is diagnostic. This is the surviving half of the abandoned
  parity harness: a **feel regression net**, catching "someone moved a constant and the hop is
  mushy" — Tier-3's characteristic failure, which leaves every test green.
- [ ] **Share inputs, never outcomes.** A level/seed/challenge is shareable; a result presented as a
  record is not. A self-reported score shown *as* self-reported is fine — the lie is the framing.
- [ ] Engine (matter-js) **pinned, vendored, licensed, size-disclosed, with a CI drift check** — it
  is not our code (workspace dependency rule). No CDN.
- [ ] Full first-party standard: tap-first, standard settings, tokens + WCAG AA + axe **across the
  whole surface** (Tier-3 is stricter than Tier-2 here — nothing foreign is executing).

## Canvas / media layer — extract, don't formalise yet

- [ ] **Extract a canvas/media library.** Paint concerns already touch **9 files, ~246 references**
  (`main.ts`, `editor/render.ts`, `editor/backdrops.ts`, `editor/geometry.ts`, plus the paint-tool
  kit) — **a smear, not yet a layer**.
- [ ] **BLOCKED — the owner has two other canvas/draw/media use cases in mind and they are unnamed.**
  One sentence each unblocks scoping. Recommendation on record: extract the **library** now (concrete,
  from working code), and **defer the dialect** until the second use case shows what is actually
  common — designing a contract from one real use case plus two imagined ones fits the imagined ones
  badly. If no dialect is ever needed, the library still stands.

## Already banked (do not redo)

- The **world refactor is done**: no module reads a global world size; `WIDE`/`TALL` are schema
  presets and backdrops take `(W, H, fy)`.
- `grounded.ts` is extracted and marked **"shared-ready for bounce"**; bounce tuning constants
  (`JUMP`, `MAX_ROLL`, `ROLL_ACCEL`, `TAP_MS`) are already placeheld in `tuning.ts`.
