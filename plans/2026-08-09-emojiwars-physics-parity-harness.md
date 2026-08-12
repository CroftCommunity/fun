# Emoji Wars — the physics parity harness, and feel as the gate

status: **SUPERSEDED 2026-08-11.** The owner decided against a deterministic engine
for Emoji Wars: it keeps pixel-based matter-js, and the shelf gains a third tier
for engine-backed originals (`docs/BUILDING-GAMES.md` §11). The Rapier spike that
this plan rested on stands as evidence and is unaffected
(`discovery/alpha/experiments/rapier-determinism`, commit `eb70cff`) — it is why
the tier is a decision rather than a default. Kept, not deleted, because the
reasoning is what justifies §11. The one idea that survives: a tolerance-probe
regression net against matter-js itself, now standardised in §11.

original status (superseded): Pass 1 (shape), not started, gated on one owner decision.

**Standing assumption, stated rather than assumed silently:** this plan is
written as though Emoji Wars lands *in* `fun`. That is the owner's call and it is
not yet made — see Open Questions Q1. Everything here except §"Where this lives"
holds regardless of the answer; only the destination paths move.

## Problem Statement

Emoji Wars (`CroftCommunity/levelforge`, live at `levelforge.croft.ing`) is a
touch-first 2D physics game plus its level editor, built on **matter-js**. Two
facts collided:

1. The owner wants it in `fun`, whose bar is **determinism-first, local-first,
   verifiable** (`docs/BUILDING-GAMES.md:5`). matter-js is float JS physics with
   no cross-platform reproducibility story, so a Tier-1 **verifiable outcome**
   (move-list replay → `state_hash`, re-verifying `?r=` share) is not reachable
   on it. It is not Tier 2 either — Tier 2 is an *opportunistic wrap of an
   existing game*, and this one is ours.

2. The determinism spike
   (`discovery/alpha/experiments/rapier-determinism`, commit `eb70cff`) settled
   that **Rapier `enhanced-determinism` gives bit-identical results on
   `aarch64-apple-darwin` and `wasm32-unknown-unknown`**. So Tier 1 *is*
   reachable — on a different engine.

That leaves one real cost, and it is the whole reason this plan exists:
`src/play/` is ~1,700 lines written against matter-js, and every feel constant in
it — `HOP`, `COYOTE_MS`, hero friction `0.35`, restitution `0.15`, the break-model
and fracture thresholds — was **derived by thumb on a phone**. Rapier's solver
behaves differently. A naive port silently discards all of it, and the failure
mode is not a red test: it is a game that still runs and no longer feels right.

**The problem this plan solves is therefore not "port the physics." It is: make
feel measurable before rewriting anything that produces it.**

## Approach

Build a **parity harness** first: one scenario definition, two engine adapters,
run side by side, diff the results.

```
scenario JSON ──▶ PhysicsAdapter ──┬──▶ MatterAdapter   (today, shipping, the oracle)
                                   └──▶ RapierAdapter   (new, proven probe by probe)
                                          │
                    ┌─────────────────────┴─────────────────────┐
                    ▼                                           ▼
          headless: numbers                          browser: side-by-side
          diffable, in the gate                      two panes, one input, a thumb
```

Three consequences, in descending order of how much they matter:

**The adapter is the migration mechanism, not test scaffolding.** Once physics
sits behind an interface, there is no big-bang swap: both engines can run, be
diffed, and cut over per-probe, per-mode, or per-level. If Rapier turns out wrong
for bounce and right for drop, that is an expressible outcome rather than a
crisis.

**Constants get *fitted*, not rediscovered.** This is the point. With matter-js
as a live oracle, "what restitution reproduces the reference bounce sequence?" is
a solve, not a phone session. Numeric fit first, thumb to confirm — instead of
thumb to discover. That converts the expensive risk into a cheap one.

**Feel gets two different treatments because it is two different things.**
Trajectory parity is a number and belongs in the gate. Whether a hop *feels* right
is not a number and only a thumb on a phone answers it. One harness, two outputs.

### The probe ladder

Ordered so a failure is **diagnostic**: each probe isolates one subsystem, and
any probe below a red one is measuring noise.

| # | Probe | Isolates | Measured |
|---|---|---|---|
| 0 | scale calibration | units | typical piece size → `length_unit` |
| 1 | free fall, no contact | gravity + integrator | apex, time-to-floor |
| 2 | **ball drop** | restitution model | bounce apex sequence |
| 3 | ramp slide | friction model | distance, time-to-rest |
| 4 | stack settle | solver | rest poses, settle time |
| 5 | sling launch | the composite | trajectory, pieces disturbed |

Probe 0 is not ceremony. matter-js works in **pixels** (the Emoji Wars world is
1600×900); Rapier's solver is tuned for **meters**, and porting pixel coordinates
in naively makes a 60-unit box behave like a building. Rapier has a first-class
knob and documents this exact case:

```rust
// "Pixel-based 2D game where typical objects are 100 pixels tall"
integration_params.length_unit = 100.0;
```
(`rapier2d-0.35.1/src/dynamics/integration_parameters.rs:227`)

Get probe 0 wrong and probes 1–5 are all noise, which is why it is first and why
it is a probe rather than an assumption.

Probes **2 and 4 are where divergence is expected** — restitution and stack
solving are where matter-js's sequential-impulse approach and Rapier's differ
most. Those are the two to fit rather than hope for. If they refuse to fit, that
is the finding, and it arrives in days.

## Reasoning

**Why a harness before a port.** The spike answered the cheap question (does the
engine reproduce?) and left the expensive one (does the game still feel like
itself?). Building the harness first means the expensive question is answered by
measurement at every step rather than by a verdict at the end. The alternative —
port, then playtest — discovers a feel regression after the code that caused it
is already gone, with no oracle left to diff against. **matter-js is only an
oracle while it is still running.** That is a fact with an expiry date, and it is
the strongest argument for doing this now rather than after.

**Why not just accept a third tier and keep matter-js.** That was the honest
option while determinism looked expensive. The spike made it cheap, so the
argument for a third tier collapses to "we would rather not do the work" — which
is a real reason, but not a standards reason, and `BUILDING-GAMES.md:54` is
explicit that a faked verifiable outcome is not acceptable. Better to reach the
bar or stay outside the shelf honestly.

**Why the adapter survives the decision.** Even if Emoji Wars stays at
`levelforge.croft.ing` and never enters `fun`, a physics interface with a
recorded oracle is worth having: it is how the game gets a regression net it
currently lacks. The harness is not wasted by a "no" on Q1.

**Why feel is a gate and not a phase.** A phase ends. Feel regressions arrive
whenever a constant moves, which is continuously. Putting the side-by-side page
in the repo from Phase 1 means the thumb check is always one command away, rather
than an event someone schedules and then skips.

## Verified Assumptions

| Assumption | Source |
|---|---|
| Rapier `enhanced-determinism` gives native == wasm, bit-identical | measured, `discovery/alpha/experiments/rapier-determinism/RESULT.md` (commit `eb70cff`) |
| The feature is load-bearing: wasm is stable either way, *native* is what moves | the 2×2 control in that RESULT.md |
| `enhanced-determinism` = `[simba/libm_force, parry2d/enhanced-determinism]`, and is **not** exclusive with rapier2d's defaults (`dim2, f32, std, block-solver`) | `cargo info rapier2d` |
| It **is** exclusive with `parallel`, `simd-stable`, `simd-nightly` | rapier determinism docs |
| rapier2d 0.35 uses glam `Vec2` (not nalgebra); `step()` takes gravity by value, 12 args | crate source, and a failed compile against the older API |
| `length_unit` exists and documents the pixel-game case | `integration_parameters.rs:227` |
| Emoji Wars world is 1600×900 / 900×1600, world-as-level-data refactor **already done** — no module reads a global world size | `levelforge` `FOLLOWUP.md`, verified by grep |
| `grounded.ts` is already extracted and marked "shared-ready for bounce"; bounce tuning constants already placeheld in `tuning.ts` | `levelforge/src/play/grounded.ts`, `tuning.ts` |
| `src/main.ts` is 3,721 lines with 14 inline `meta.mode` branches and **no** `GameMode` interface | measured by `wc`/`grep` on the clone |
| Repo modes are `slingshot \| drop \| drive`; spec says `sling \| drop \| bounce`; `drive` reads a `meta.goal` zone where spec says `role:'goal'` | `levelforge/src/schema.ts:58`, `FOLLOWUP.md` naming note |
| Homebrew clippy shadows rustup and fails `E0514`; resolve through `rustup which` | hit during the spike; matches `fun/CLAUDE.md` and `tools/build-wasm.sh` |

**Unverified, and named as such:**

- **Any wasm engine but V8.** The spike ran under Node 22. iOS Safari is JSC and
  untested. `fun`'s Playwright gate is chromium-only, so it would not catch a JSC
  difference either — this is already a known open item in
  `.claude/CI-PATTERN.md`. **Probe 1 on a real iPhone is the cheapest way to
  close it** and should happen early, not at the end.
- **Perf cost of forgoing `parallel`/SIMD.** Unmeasured. Likely irrelevant at
  Emoji Wars' body counts; "likely" is doing work in that sentence.
- **Whether bounce feel is reachable at all in Rapier.** Bounce has no reference
  oracle — `levelforge.html` v0.12 cannot play it, and `drive` is a prototype.
  It is the one genuinely new construction here.

## Phases

Each phase leaves the gate green and is independently revertable.

**Phase 0 — scale calibration.** `PhysicsAdapter` interface + scenario JSON +
`MatterAdapter`. `RapierAdapter` stub that only builds a world. Probe 0 fits
`length_unit` against real Emoji Wars piece sizes. RED: a probe asserting a known
piece falls a known distance in a known time under matter-js, before either
adapter exists.

**Phase 1 — the ladder, headless.** Probes 1–3 against both adapters, emitting a
parity table with per-probe deltas and tolerances. Tolerances are *recorded from
matter-js*, not invented. Ship the side-by-side browser page in this phase, not
later, and run probe 1 on a real iPhone to close the JSC gap.

**Phase 2 — fit the contested constants.** Probes 2 and 4. Fit restitution and
solver settings against the matter-js oracle. Record every fitted constant with
the probe and delta that justified it — the thing the current codebase's
phone-tuned constants lack.

**Phase 3 — the composite.** Probe 5 (sling launch) plus a phone A/B on real
levels from `levels/`. This is where a "numbers match, feel is wrong" verdict
would surface; the plan must be willing to return that answer.

**Phase 4 — cut over behind the adapter.** Per-mode, gated on its probes being
green. Drop first (simplest, has tests). Sling second. **Bounce last** — it is
new construction, not a port, and the spec explicitly forbids inventing beyond it.

**Phase 5 — the verifiable outcome.** Only now: fixed timestep, captured and
quantised inputs, canonical state serialisation, bit-exact level-JSON → world.
These are the other five-sixths of Tier 1 that the engine choice does *not* give
you, and they are the same work under any engine.

**Explicitly not in this run:** the frontstage/backstage/lobby decomposition of
`main.ts`; the `slingshot→sling` / `drive→bounce` schema rename and its migration;
the canvas/media library extraction. All three are real and none is blocked by
this plan — but folding them in would make every phase's diff unreadable, and
this plan's entire value is that its deltas are legible.

## Documentation Impact

- `docs/BUILDING-GAMES.md` — Emoji Wars is the first physics game on the shelf.
  Whether that needs new standard text depends on Q1; if it enters as Tier 1, the
  verifiable-outcome section needs to say what "replay" means for physics.
- `levelforge/FOLLOWUP.md` — its naming note defers the mode reconciliation to "a
  future pass"; that pass is now scheduled and should be linked from there.
- `.claude/CI-PATTERN.md` — if probe 1 runs on a real iPhone, the chromium-only
  gate item gains its first real datapoint.

## Open Questions

**Q1 (blocking the destination, not the work): does Emoji Wars enter `fun`?**
Options: Tier 1 via this plan; a third shelf class; or stays at
`levelforge.croft.ing` linked from the shelf. The spike removed the determinism
objection, so this is now a product call rather than a technical one. **Default
if unanswered: build the harness in `levelforge`,** since it is valuable there
regardless and moving it later is cheap.

**Q2: is bounce in scope for the port, or does it ship on matter-js first?**
Bounce is the only piece with no oracle. Building it fresh in Rapier means
inventing feel and verifying feel simultaneously. **Recommended default: ship
bounce on matter-js first to establish the oracle, then port it** — which
inverts the obvious order for a good reason.

**Q3: what tolerance counts as parity?** Bit-identical is the wrong bar for a
cross-engine comparison — the engines genuinely differ. Proposal: per-probe
tolerances recorded from matter-js run-to-run variance, so the bar is "as close
as matter-js is to itself."

## Review Log

*(empty — Pass 2 not yet run)*
