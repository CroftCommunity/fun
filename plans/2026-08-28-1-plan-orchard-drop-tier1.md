# Orchard Drop → Tier-1: a fixed-point deterministic fruit-merge core

**Status:** Pass 1 drafted, not started. Phase 0 (the solver spike) is the gate — every later
phase is contingent on D1/D3 succeeding, and the plan names its fallback if they do not.
**Author cadence:** `/phase-plan` (Pass 1 recorded here; Passes 2–3 pending).
**Standards anchor:** `docs/BUILDING-GAMES.md` §§2–8 (Tier-1) — with §11 (Tier-3) as the
explicitly-considered-and-rejected alternative.
**Supersedes in part:** `plans/2026-08-02-orchard-drop-wrap.md` (the Tier-2 wrap this replaces).

---

## Problem Statement

Orchard Drop ships today as a **Tier-2 wrap** — an opaque-origin sandboxed iframe around a
single-file HTML bundle, carrying the "no verifiable record" banner. That classification is
correct under §9, but it misdescribes the artifact. Measured on the vendored bundle
(`src/games/orchard-drop/vendor/index.html`, 101,155 bytes total):

```
lines 1–146    HTML + CSS                  4,896 B    ours (AGPL-3.0)
line  147      Matter.js 0.19.0 minified  80,726 B    theirs (MIT © @liabru)   ← 80%
lines 148–570  game JS                    15,533 B    ours (AGPL-3.0)
```

**We wrote the game. The only foreign thing in it is the physics engine**, and the game uses a
startlingly small slice of that engine. The complete Matter surface, from the game half of the
bundle (§ *fruit definitions* through § *main loop*):

| Used | Not used |
|---|---|
| `Bodies.circle` (fruit) | constraints, joints, springs |
| `Bodies.rectangle` ×3 (static walls) | polygons, compound bodies, vertex sets |
| `Engine.create`, `Engine.update(engine, dt)` | every `Body.*` mutator |
| `World.add`, `Composite.remove`, `Composite.allBodies` | sleeping, plugins, `Render`, `Runner` |
| `Events.on('collisionStart')`, `engine.gravity.y` | raycasting, region queries, SAT |

Circles against three static axis-aligned boxes under gravity, plus a contact event. No
rotational constraints, no polygon collision, no transcendental math required by the solver.

Four concrete costs follow from the current classification:

1. **No verifiable outcome.** The shelf's defining property (§3) is absent — no `?r=` share, no
   re-verify, no replayable record. Every other first-party game on the shelf has one.
2. **The sandbox breaks the game's own persistence.** `loadBest`/`saveBest` throw in the opaque
   origin and are swallowed by their `try/catch`, so the best score resets every session. The
   wrap plan recorded this as an accepted containment cost; it is only a cost because the game
   is contained, and it is contained only because it is classified as foreign code.
3. **80KB of vendored third-party bytes** with an MIT redistribution obligation, a drift-check
   surface, and a containment harness enrolment — all carried for a solver whose entire job here
   is "circles fall into a box."
4. **It blocks a substrate the shelf will want twice.** `TODO/emojiwars.md` is the shelf's other
   physics game and is stalled at the same question.

## Approach

Replace Matter.js with a **fixed-point integer circle solver written in Rust**, and promote the
game to Tier-1 with a full verifiable outcome.

```
                              TODAY (Tier-2)                    PROPOSED (Tier-1)
  ┌──────────────────────┐  ┌────────────────────────┐  ┌──────────────────────────────┐
  │ shelf chrome         │  │ sandboxed iframe       │  │ shelf chrome                 │
  │  + "no record"banner │──│  ├ Matter.js 0.19.0    │  │  └ canvas renderer (TS)      │
  │                      │  │  └ game JS (ours)      │  │      │ presentational only   │
  └──────────────────────┘  └────────────────────────┘  ├──────┼───────────────────────┤
                                                        │ orchard-wasm (C-ABI)         │
                                                        ├──────────────────────────────┤
                                                        │ orchard-core   rules, ladder,│
                                                        │   scoring, RNG, state_hash   │
                                                        ├──────────────────────────────┤
                                                        │ pond-physics   fixed-point   │
                                                        │   circle solver, i64 only    │
                                                        └──────────────────────────────┘
```

Two structural changes make the outcome verifiable:

**1. Fixed-point, no floats on the hashed path.** `fun/CLAUDE.md` states the discipline
outright, and `crates/bubble-core/src/aim.rs` is the precedent: continuous motion, fixed-point
`i64` at shift-16, a committed direction table replacing runtime trig, presentational output
(`Landing.path`) kept off the hash. Circles-only collision needs **no transcendentals at all** —
integer sqrt for contact distance, clamp-to-AABB for the walls, semi-implicit Euler, sequential
impulses. Body rotation accumulates as an integer angle; only the *renderer* needs sin/cos, and
the renderer is off-hash.

**2. The move list carries ticks.** This is the shape change that is not obvious. In solitaire,
2048, and every other Tier-1 game here, the world advances only when the player moves. In Suika
the world runs continuously and the player drops *at a moment of their choosing*, so a move is a
(time, place) pair:

```rust
enum Move { Drop { tick: u32, x: i32 } }
// verify: seed → construct world → step to each recorded tick → apply that drop → re-hash
```

Three wall-clock quantities in the current game become tick counts: the 520 ms drop cooldown
(`setTimeout`), the 1200 ms freshly-dropped game-over grace (`performance.now() - b.born`), and
the 900 ms over-the-line dwell (`b.overTime`). The variable `dt = Math.min(now - last, 33)`
becomes a fixed timestep behind an accumulator. Drop `x` quantizes to a sub-pixel integer.

The outcome shape is **already solved by 2048** — an endless score-chase whose claim is "on seed
X this sequence reached score S," with `Record.score` carrying the number
(`crates/twenty48-core/src/game.rs`, `src/games/2048/2048-outcome.ts`). Orchard Drop's claim is
identical in kind: "on seed X this sequence of drops reached score S." No new outcome machinery.

## Reasoning

### Why not stay Tier-2

Doing nothing is a legitimate option and the plan should say so: the game works, it is honestly
labelled, and the four costs above are real but not urgent. The argument for moving is that
Orchard Drop is the *only* game on the shelf that is ours, unverifiable, and cheap to make
verifiable. The classification is accurate but describes an accident of how it was built, not a
property of what it is.

### Why not Tier-3 (§11) — keeping Matter but un-sandboxing it

This is the cheapest path: vendor Matter properly, drop the iframe, declare `tier: 3`. It buys
the honest authorship label and fixes the best-score persistence, and it costs almost nothing.

Rejected because it buys the *least of what we actually want* while still paying a real entry
fee. There is still no verifiable record, still 80KB of vendored engine, and it requires
widening `src/contract.ts` (a `tier?: 1` / `tier: 2` union today) and `src/wrapped-banner.ts`
(returns `null` unless `tier === 2`) to admit a third tier — the same work `TODO/emojiwars.md`
is blocked on. Paying an entry fee to arrive somewhere we do not want to stop is the wrong
trade. If Phase 0 fails, this becomes the fallback, and then the fee is worth paying.

### Why not Rapier with `enhanced-determinism` — the alternative that would also work

This deserves more than a dismissal, because it is *measured to work*.
`discovery/alpha/experiments/rapier-determinism/RESULT.md` (2026-08-09, rapier2d `=0.35.1`)
records bit-identical native and wasm digests over 600 steps of a contact-rich scenario, with
four guards proving the digest is sensitive and the scenario is not inert. A float engine that
is bit-reproducible *could* carry Tier-1. Three reasons it is not the choice here:

- **The spike's own limits are the disqualifier.** Its "What this does NOT establish" section is
  explicit: one wasm engine (Node 22 / V8), one machine (aarch64 Darwin). iOS Safari is
  JavaScriptCore and was never tested; x86_64 native was never tested. A `?r=` share that
  silently fails to re-verify on an iPhone is worse than having no share at all — it is a
  verification promise that breaks for a subset of users we would not hear from. Integer `i64`
  arithmetic in wasm is exactly specified by the standard and carries no such exposure. This is
  the load-bearing reason.
- **It contradicts the repo's stated discipline.** `fun/CLAUDE.md`: "The cores are
  determinism-critical — no floats on the hashed path." Rapier's determinism is real but it is
  achieved by *constraining* float behaviour (`libm_force` routing transcendentals through
  `libm`), not by avoiding it. Adopting it means the shelf's one physics core is the one core
  that breaks the shelf's one numeric rule.
- **Dependency weight.** The workspace pins seven external crates total, exactly, with a
  committed lockfile. Rapier pulls rapier2d + parry2d + simba + glam and their trees, and
  `enhanced-determinism` is mutually exclusive with `parallel` and both `simd-*` features (its
  performance cost is, per the spike, unmeasured).

Against all that: Rapier is *far* less work than writing a solver, and it is battle-tested where
ours would be new. If Phase 0's D1 (stable stacking) fails, Rapier-with-`enhanced-determinism` is
the second fallback and it still lands Tier-1 — at the cost of accepting the untested-engine
exposure above, which would then need saying out loud in the how-to guide.

### Why a shared `pond-physics` crate rather than physics inside `orchard-core`

`TODO/emojiwars.md` records that Emoji Wars declined determinism because re-deriving every
phone-tuned feel constant across ~1,700 lines of play code against a different solver was not
worth a replay proof it did not want. That reasoning is sound *for Emoji Wars* and this plan does
not reopen it. But it means the shelf has never measured what a deterministic physics substrate
of its own actually costs, on anything.

Orchard Drop is the cheap place to find out: 420 lines of game code, no authored levels, and the
entire tuning surface is five numbers (`restitution: .12`, `friction: .35`, `frictionStatic: .5`,
`density: .0012`, `gravity.y = 1.35`). If `pond-physics` works here it is a substrate Emoji Wars
could later inherit on its own schedule; if it does not work here it would never have worked
there, and we learn that for the price of one spike rather than one game. Naming it `pond-*`
matches the existing shared-substrate crates (`pond-docformat`, `pond-outcome`).

### Why the solver is tractable at all

The scope is unusually small for a physics engine, and the constraints are what make it so:

- **Bodies ≤ ~40.** O(N²) broadphase is ~800 pairs per step. No spatial grid, no sleeping, no
  islands — three subsystems that will not be written.
- **Circles only, walls static and axis-aligned.** Narrowphase is `dist² vs (r1+r2)²` and a
  clamp-to-box. No SAT, no polygon clipping, no convex decomposition.
- **No transcendentals.** Contact normals need one integer square root; nothing needs sin, cos,
  atan2, or a direction table. Bubble needed a committed table because it aims by *angle*;
  Orchard Drop never does.

What remains genuinely hard is **stable stacking**, and the plan treats that as the risk rather
than the detail. See Phase 0.

### What Tier-1 costs beyond the physics

The §§2–8 tax is not small and this plan should not undersell it. The current game draws its own
header, score, best, and game-over overlay inside a foreign canvas that §9 explicitly exempts
from our accessibility standard. A Tier-1 game owes: tokens + WCAG AA + axe clean in both themes
across the whole surface (§5), standard settings (§6), tap-first input (§4), mobile-first with
44px targets, a `how-to` guide with `guide:shots` (§7), and the full gate (§8). Roughly, Phase 4
is as much work as Phases 1–3 combined, and it is work that carries no interesting risk — which
is exactly why it is the phase most likely to be underestimated.

## Verified Assumptions

Confirmed by reading the tree at `e453afb` (fun) unless noted. Anything not listed here is
inference.

| Claim | Evidence |
|---|---|
| The vendored bundle is 101,155 B; Matter is 80,726 B of it on a single minified line (147); our HTML+CSS is 4,896 B and our game JS 15,533 B | `wc -c` over `sed -n` ranges of `src/games/orchard-drop/vendor/index.html` |
| The game's entire Matter surface is `Bodies.circle`, `Bodies.rectangle`, `Engine.create`, `Engine.update`, `World.add`, `Composite.remove`, `Composite.allBodies`, `Events.on('collisionStart')`, `engine.gravity.y` | grep of the game half (lines 148–570) for `Engine.|World.|Bodies.|Body.|Events.|Composite.|Runner`; zero `Body.*` mutator hits |
| The tuning surface is five constants | `vendor/index.html` § *fruit definitions* / `newFruitBody` / `resetGame`: `restitution:.12, friction:.35, frictionStatic:.5, density:.0012`, `engine.gravity.y = 1.35` |
| Three wall-clock quantities gate play and must become ticks | `vendor/index.html` § *game over* (`now - b.born < 1200`, `b.overTime > 900`) and `drop()` (`setTimeout(..., 520)`) |
| Fixed-point continuous motion with off-hash presentational output is an established pattern here | `crates/bubble-core/src/aim.rs` — `const FP: i64 = 65536`, `STEP`/`MAX_STEPS` march, doc comment "Everything here is integer … so a shot replays byte-identically and `native == wasm`"; `Landing.path` documented "presentational only, not hashed" |
| An endless score-chase already carries a verifiable record on this shelf | `crates/twenty48-core/src/game.rs` (`score` folded into `state_hash`, `attest::<Twenty48>`); `src/games/2048/2048-outcome.ts` header: "on seed X this sequence of slides reached score S" |
| `pond_outcome::Record` has an optional `score` field and an `Outcome` enum including `Lost` | `crates/pond-outcome/src/lib.rs` — `pub enum Outcome { Won, Stuck, Abandoned, Lost }`, `Record<M>` |
| Bindings are raw C-ABI with a static output buffer, no wasm-bindgen | `crates/twenty48-wasm/src/lib.rs` — `#[no_mangle] pub extern "C" fn board_json() -> *const u8`, `out_len()` |
| The wasm build list is an explicit `-p` enumeration, not a glob | `tools/build-wasm.sh` — the `cargo build --manifest-path ... -p solitaire-wasm -p match3-wasm …` line |
| The cross-build harness covers a named subset (solitaire, dots, furrow), driven by `check.mjs` under node | `crates/xbuild/src/lib.rs` module doc + its `use` list |
| Four crates carry committed golden vectors | `ls -d crates/*/vectors` → dots-core, furrow-core, match3-core, solitaire-core |
| The containment spec auto-enrolls any game directory containing `tier2.meta.json` | `tests/tier2-containment.spec.ts` — `tier2Games()` walks `src/games/*/tier2.meta.json` |
| `tier: 3` will not typecheck today, and the banner is `tier === 2`-gated | `src/contract.ts` (`readonly tier?: 1` / `readonly tier: 2`); `docs/BUILDING-GAMES.md` §11 "What admitting the first Tier-3 game requires in code" |
| Rapier `enhanced-determinism` gives native == wasm, tested on exactly one engine and one machine | `discovery/alpha/experiments/rapier-determinism/RESULT.md`, §§ *Result* and *What this does NOT establish* |
| No integer-sqrt or fixed-point helper exists to reuse | grep for `isqrt|sqrt` across `crates/*/src/*.rs` — only bubble's prose references to fixed point; `crates/looseends-core` holds the only `f64`, off-hash |
| Retiring the wrap does not disturb drawer-count assertions | orchard-drop keeps its id and slot: `tests/chrome.test.ts` drawer-id list and `build.mjs` `GAME_PAGES` both keep the entry; only `TIER2_VENDORS` loses it |
| Deleting `vendor/LICENSE.txt` orphans no licence obligation | The file's first-party half only *refers* to the repo's top-level `LICENSE` and the repo URL as the corresponding source — both survive. Its second half reproduces the Matter.js MIT notice, which is only required while the Matter.js code ships |
| Guide shots are written to `assets/guide/`, not `assets/shots/` | `tools/guide-shots.mjs:17` — `const outDir = join(root, "assets", "guide")`; `ls assets/` → `fonts guide` |

**Unverified and deliberately so** — these are Phase 0's job, not Pass 1's: whether a hand-rolled
fixed-point solver stacks 30 circles stably; the fixed-point precision envelope; replay cost for
a full-length game; whether the result *feels* like the Matter version.

## Documentation Impact

- `docs/BUILDING-GAMES.md` — no §-standard changes; but §11's "a deterministic path was measured,
  found to work, and declined" paragraph should gain a cross-reference noting that Orchard Drop
  took the other branch and why the economics differed. **Phase 6.**
- `TODO/README.md:49` — "astray, hexgl, clumsybird, orchard-drop — shipped wraps" loses
  orchard-drop. **Phase 4** (the phase that makes it false).
- `TODO/emojiwars.md` — its "Why it is Tier-3, and what that cost" section should note that
  `pond-physics` now exists as an option it may inherit or decline. Not a reversal of its
  decision. **Phase 6.**
- `plans/2026-08-02-orchard-drop-wrap.md` — `**Status:**` line updated to superseded, pointing
  here. **Phase 4.**
- `crates/pond-physics/RULES.md` — **new.** The solver's rules doc (§2 requires one alongside
  golden vectors): integration scheme, contact model, iteration order, fixed-point layout,
  and the invariants the vectors lock. **Phase 1.**
- `crates/orchard-core/RULES.md` — **new.** Ladder, merge rule, scoring table, drop cooldown,
  game-over condition, RNG schedule, `state_hash` composition. **Phase 2.**
- `src/games/orchard-drop/orchard-drop-howto.ts` — the "A wrapped game — no verifiable record"
  entry is deleted and replaced with the verification-forward guide §7 requires; the Matter.js
  credit becomes a Suika-lineage credit only. **Phase 5.**
- `src/games/orchard-drop/vendor/LICENSE.txt` — deleted with the vendor bundle. The AGPL
  source-offer that file also carried must survive somewhere; confirm `README.md` covers it
  before deleting. **Phase 4.**
- `docs/STATE-OF-PLAY.md` — grepped for `orchard`: no hits, no change needed.
- `README.md` — grepped for `orchard`: no hits, no change needed.

## Concurrency Map

```
Sequential spine: Phase 0 → Phase 1 → Phase 2 → Phase 3 → [Phase 4 + Phase 5 land together] → Phase 6
```

**All phases sequential.** Each phase reads what the prior wrote: Phase 2's rules sit on Phase
1's solver API, Phase 3 binds Phase 2's types, Phase 4 calls Phase 3's wrapper, Phase 5's replay
path re-enters Phase 2's core. There is no pair with disjoint read-sets to parallelize.

**Phases 4 and 5 land as a single merge**, despite being planned separately. Between them the
shelf would hold a game with the wrap retired (so no "no verifiable record" banner) and no `?r=`
record yet — a game presenting as verifiable by omission. That is precisely the honesty failure
§9 and §11 both exist to prevent, so the intermediate state may exist on the branch but must
never reach `main`.

Shared-state contract for the whole plan: work happens in
`worktrees/fun/orchard-tier1-plan` on `claude/orchard-tier1-plan`. No `git checkout`/`stash`/
`rebase` in the shared `fun/` checkout; no ports bound; `cargo` writes only to `fun/target/`,
which is shared with the peer `claude/uiux-mocks` worktree — expect rebuild churn, not
corruption. Note `fun/` currently holds an untracked `assets/new/` belonging to another session;
never `git add -A` in that tree.

## Phases

### Phase 0: Discovery — does a fixed-point circle solver hold a Suika pile?

**Goal:** Resolve the one question that can invalidate the entire plan, before writing a crate.
A Suika pile is ~30 circles in *sustained* contact, and the characteristic failure of a
hand-rolled solver is not a wrong answer but a mushy one: piles that jitter, slowly sink into
each other, or pop. Matter buys warm-started Gauss-Seidel with position correction, tuned over
years. This phase measures whether a minimal fixed-point solver is good enough, or whether we are
buying a research project.

**Location:** `spike/orchard-physics/` — throwaway crate, not a workspace member (matching how
`discovery/alpha/experiments/rapier-determinism` sits outside its smoke matrix).

- [ ] **D1: Does a fixed-point sequential-impulse solver produce a stable pile?**
  - **Probe:** Semi-implicit Euler at fixed `dt`, `i64` shift-16 positions/velocities, integer
    sqrt for contact normals, N solver iterations with Baumgarte position correction, contacts
    resolved in a stable order (sorted by body id, never insertion or hash order). Drop 30
    circles of the Orchard ladder's radii into a 440×640 crate and step 3,600 ticks (60 s).
  - **Success criteria:** After settling, total kinetic energy stays below a recorded floor for
    600 consecutive ticks; no circle centre penetrates another by more than 1% of its radius; no
    circle escapes the crate. Record the iteration count needed — if stability requires more than
    ~20 iterations per step, note it as a cost against D4.
  - **Disposition:** `promote` — the solver core becomes Phase 1 production code and gets TDD
    there; the spike's harness is `throwaway`.
- [ ] **D2: What is the fixed-point precision and overflow envelope?**
  - **Probe:** With shift-16 `i64`, compute worst-case intermediate magnitudes for
    `dist²` (radii up to 128 px → 256·65536 sub-units squared), impulse accumulation, and mass
    ratios across the 11-tier ladder (cherry r=17 vs watermelon r=128; area ratio ~57:1).
  - **Success criteria:** A written bound showing no intermediate exceeds `i64::MAX`, plus a test
    that drives the extreme case (a cherry pinned between two watermelons) without overflow.
    Decide shift-16 vs a different scale from the numbers, not by copying bubble.
  - **Disposition:** `keep-as-fixture` — the bound goes into `pond-physics/RULES.md`.
- [ ] **D3: Does the solver produce identical digests on native and wasm?**
  - **Probe:** Mirror the rapier spike's method — FNV-1a-64 over the bit patterns of every
    body's final `(x, y, angle)` after a fixed contact-rich run. Build `wasm32-unknown-unknown`,
    cross-check under node. Resolve cargo via `rustup which cargo` (Homebrew's shadows it and has
    no wasm std — the trap `tools/build-wasm.sh` documents).
  - **Success criteria:** Digests equal. Plus the rapier spike's two believability guards, which
    are the part that makes a matching digest mean anything: a one-ULP-equivalent perturbation
    (change one body's initial sub-unit position by 1) must *change* the digest, and an assertion
    that bodies actually moved and settled. A digest that agrees because the scenario is inert
    proves nothing.
  - **Disposition:** `promote` — becomes the Phase 1 vector + the Phase 6 `xbuild` enrolment.
  - **Expected to pass.** wasm i64 arithmetic is exactly specified; this is a guard against our
    own mistakes (an unstable iteration order, `usize` width leaking in), not against the
    platform. If it fails, the cause is a bug in D1's code, not a property of the target.
- [ ] **D4: What does a full-game replay cost?**
  - **Probe:** A 5-minute game is ~18,000 ticks × ~30 bodies × D1's iteration count. Time a
    full replay natively and in wasm under node.
  - **Success criteria:** Replay completes in under 1 s in release wasm. Verification is
    user-facing (§3's one-tap re-verify), so a multi-second stall is a design problem, not a
    tuning note. If it misses, the mitigation is a checkpointed hash rather than a faster solver —
    record which.
- [ ] **D5: Does it feel like the Matter version?**
  - **Probe:** Side-by-side against the live wrap at `/orchard-drop/`, same drop sequence, human
    judgement. Specifically: does fruit *roll* off a pile the way it does now, and does a merge
    settle without visible jitter?
  - **Success criteria:** Subjective and honestly recorded as such. This is a **judgement gate,
    not a pass/fail test** — a solver that is stable (D1) but feels dead is a legitimate reason to
    stop and take the Rapier fallback. Record the verdict either way.

**Read-set:** `src/games/orchard-drop/vendor/index.html`, `crates/bubble-core/src/aim.rs`,
`discovery/alpha/experiments/rapier-determinism/RESULT.md`.
**Write-set:** `spike/orchard-physics/` (new, throwaway), this plan's Verified Assumptions and
Review Log.
**Shared-state contract:** No shared mutable state beyond the file write-set; the spike is not a
workspace member so it does not touch `Cargo.lock`.
**Risks:** The honest one is that D1 and D5 pull apart — a solver that is provably stable and
subjectively worse than what ships today. That is a real possible outcome and the plan's answer
is the Rapier fallback, not more iterations.
**Done when:**
1. **Behavioral:** We can state, with recorded numbers, whether a fixed-point circle solver holds
   a Suika pile, matches across targets, replays fast enough, and feels right.
2. **Verification:** `cargo test --release` in `spike/orchard-physics/` green;
   `node verify.mjs` reports matching digests; D5's verdict written into the Review Log.
**Validation:** Broad. This phase is entirely measurement, and its output rewrites the plan.

**Phase 0 is the only phase permitted to restructure the ones below it.** If D1 or D5 fails, stop
and re-plan against the fallback ladder: (1) Rapier + `enhanced-determinism`, still Tier-1, with
the untested-engine exposure stated in the guide; (2) Tier-3 with Matter vendored and
un-sandboxed, which needs the `contract.ts` + `wrapped-banner.ts` widening first; (3) leave the
wrap alone and record why.

---

### Phase 1: `crates/pond-physics` — the deterministic solver

**Goal:** A workspace crate exposing a fixed-point 2D circle world: add static AABBs, add and
remove dynamic circles, step by one tick, read body state, and report contacts made this tick.

**Changes:**
- [ ] `crates/pond-physics/src/fixed.rs` — the fixed-point type, integer sqrt, and the overflow
  bounds D2 established. RED first, including the extreme-mass-ratio case.
- [ ] `crates/pond-physics/src/body.rs` — circle + static AABB, canonical monotonic body ids
  (ids are the iteration order, so they are load-bearing, not bookkeeping).
- [ ] `crates/pond-physics/src/world.rs` — `step()`, O(N²) broadphase, narrowphase, sequential
  impulses, contact list.
- [ ] `crates/pond-physics/src/hash.rs` — canonical world serialisation for hashing.
- [ ] `crates/pond-physics/vectors/` — golden vectors: free fall, one bounce, a two-body rest, the
  30-circle settle from D1.
- [ ] `crates/pond-physics/RULES.md` — the rules doc §2 requires.
- [ ] `Cargo.toml` workspace member + `[workspace.dependencies]` entry.

**Call chain:** Nothing calls this yet — that is Phase 2. Declared deliberately: this phase ships
a library with no consumer, which is normally a dead-code smell. It is acceptable here only
because Phase 2 is committed in the same plan and the golden vectors exercise the full API.
**Wiring test:** `cargo test -p pond-physics --release` running the vectors is the *component*
proof. The genuine wiring test lands in Phase 2. **If Phase 2 slips, this crate is dead code** —
do not land Phase 1 alone for longer than it takes to write Phase 2.
**Depends on:** Phase 0 (D1 promoted, D2's bounds, D3's method).
**Read-set:** `spike/orchard-physics/`, `crates/bubble-core/src/aim.rs` (fixed-point idiom),
`crates/solitaire-core/vectors/` (vector file format).
**Write-set:** `crates/pond-physics/**`, `Cargo.toml`, `Cargo.lock`.
**Shared-state contract:** Touches `Cargo.lock` and `fun/target/`, both shared with the peer
`uiux-mocks` worktree. No other shared mutable state.
**Risks:** Over-generalising. The temptation is a physics engine; the requirement is circles in a
box. Every subsystem not needed by Orchard Drop (sleeping, islands, spatial hashing, polygons)
must be left out — Emoji Wars can add what it needs when it needs it, against tests.
**Done when:**
1. **Behavioral:** A caller can build a crate-and-fruit world, step it 3,600 times, and get a
   `state_hash` that is byte-identical on native and wasm.
2. **Verification:** `cargo test -p pond-physics --release` green including the vectors;
   the D3 cross-check re-run against the promoted code.
**Validation:** Moderate → Broad. Vectors plus the cross-target digest. Mutation testing is
**expected here** (`cargo mutants`), per the coding-agents standard — a solver is exactly the
"green suite hides a hole" shape, and survivors must be triaged equivalent vs real gap in the
Review Log. Commit the green state before each mutation round.

---

### Phase 2: `crates/orchard-core` — the game rules

**Goal:** The rules on top of the solver: the 11-tier ladder, merge-on-contact, the triangular
scoring table, the seeded next-fruit stream, the tick-indexed move list, game-over, and
`state_hash`.

**Changes:**
- [ ] `crates/orchard-core/src/ladder.rs` — the 11 tiers with their radii and the `DROPPABLE = 5`
  spawn window. Data, and therefore **still RED first** — this is the category CLAUDE.md names as
  the one people rationalise past.
- [ ] `crates/orchard-core/src/rng.rs` — seeded ChaCha20 next-fruit stream, matching the shelf
  pattern (`rand_chacha`, `seed_from_u64`, no `getrandom`).
- [ ] `crates/orchard-core/src/game.rs` — `Game`, `Move::Drop { tick, x }`, `apply`, cooldown in
  ticks, merge resolution over the solver's contact list, the watermelon-pair pop bonus, score.
- [ ] `crates/orchard-core/src/gameover.rs` — the born-grace and over-line dwell, in ticks.
- [ ] `crates/orchard-core/src/hash.rs` — `state_hash` over the world hash, the RNG draw count,
  and the score (2048's composition).
- [ ] `impl pond_outcome::Game for Orchard` — replay + `attest`/`verify`.
- [ ] `crates/orchard-core/vectors/` + `RULES.md`.

**Merge-order determinism is the subtle correctness requirement.** When three same-tier fruit
touch in one tick, which two merge decides the whole rest of the game. The current
implementation resolves this incidentally, from Matter's pair order plus a `merged` Set. Ours
must resolve it *by rule*: contacts sorted by `(lower body id, higher body id)`, first-wins,
each body consumed at most once per tick. Write the three-body case as a golden vector.

**Call chain:** `Game::apply(Move::Drop{tick,x})` → `World::step` ×N → contact list →
merge resolution → score/`state_hash`. `verify` re-enters the same path from `(seed, moves)`.
**Wiring test:** `replaying_a_recorded_game_reproduces_its_final_hash` — build a game by applying
a fixed move list, `attest` it, then `verify` the record from `(seed, moves)` alone and assert
the hash matches. This is the real wiring test for Phases 1+2 together: it proves the rules
actually drive the solver rather than sitting beside it.
**Depends on:** Phase 1.
**Read-set:** `crates/pond-physics/**`, `crates/twenty48-core/src/game.rs` (outcome idiom),
`crates/pond-outcome/src/lib.rs`, `vendor/index.html` (the rules being ported).
**Write-set:** `crates/orchard-core/**`, `Cargo.toml`, `Cargo.lock`.
**Shared-state contract:** As Phase 1.
**Risks:** Silent rule drift from the vendored original. Port each constant with the source line
beside it in a comment, and diff the ladder radii and `MERGE_SCORE` table against
`vendor/index.html` before it is deleted in Phase 4 — after that the reference is gone from the
tree and only git history has it.
**Done when:**
1. **Behavioral:** A recorded `(seed, moves)` replays to a byte-identical final hash and score.
2. **Verification:** `cargo test -p orchard-core --release`, wiring test included.
**Validation:** Moderate. Vectors + wiring test. Mutation testing expected on the merge
resolver and the scoring table.

---

### Phase 3: `crates/orchard-wasm` + the TS wrapper

**Goal:** The browser can drive the core.

**Changes:**
- [ ] `crates/orchard-wasm/src/lib.rs` — raw C-ABI, static output buffer, `new_game(seed)`,
  `step()`, `drop(x)`, `world_json()` (positions/radii/tiers/angles for the renderer),
  `current_hash()`, `score()`, `is_over()`, `record_json()`, `verify_json(...)`. Never panics —
  every fallible path returns a status code or an empty buffer.
- [ ] `src/games/orchard-drop/orchard-wasm.ts` — the typed wrapper.
- [ ] `tools/build-wasm.sh` — add `-p orchard-wasm` to the explicit `-p` list.

**Call chain:** TS wrapper → wasm export → `orchard_core::Game`.
**Wiring test:** A vitest that loads the built wasm, plays a scripted drop sequence through the
TS wrapper, and asserts the score and hash match the Rust vector for the same input. This proves
the boundary, which is where the `usize`→`u32` narrowing bugs live.
**Depends on:** Phase 2.
**Read-set:** `crates/twenty48-wasm/src/lib.rs` (binding idiom), `crates/orchard-core/**`.
**Write-set:** `crates/orchard-wasm/**`, `src/games/orchard-drop/orchard-wasm.ts`,
`tools/build-wasm.sh`, `Cargo.toml`, `Cargo.lock`.
**Shared-state contract:** `tools/build-wasm.sh` is shared; a one-token edit to an explicit list.
**Risks:** Panic on a malformed call aborts the module. Audit every `unwrap`/index/`as` on the
export path.
**Done when:**
1. **Behavioral:** A browser-side script plays a game through wasm and reads back a hash equal to
   the native vector.
2. **Verification:** `npm run build:wasm && npx vitest run tests/orchard-wasm.test.ts`.
**Validation:** Moderate.

---

### Phase 4: The native UI, and retiring the wrap *(lands with Phase 5)*

**Goal:** `/orchard-drop/` is a first-party canvas game in our chrome, with the vendor bundle
gone. This phase is necessarily atomic — a half-swapped state has `tier2.meta.json` next to a
native module, and the containment harness would enrol a game that no longer has an iframe.

**Changes:**
- [ ] `src/games/orchard-drop/orchard-drop.ts` — a real `GameModule`: canvas renderer reading
  `world_json()`, fixed-timestep accumulator driving `step()`, drops queued to the next tick
  boundary.
- [ ] `src/games/orchard-drop/render.ts` — the fruit art ported from the vendor canvas code
  (`ctx` gradients per `kind`), plus crate, danger line, and next-fruit preview. Off-hash.
- [ ] Tap-first input (§4): drag-to-aim + release, arrow keys + Space, 44px targets, the core
  deciding legality (the cooldown is a core rule, not a UI timer).
- [ ] Tokens + WCAG AA + axe in both themes across the whole surface (§5); standard settings
  wired (§6).
- [ ] **Delete** `vendor/index.html`, `vendor/LICENSE.txt`, `tier2.meta.json`. Licensing is
  clean on deletion (verified, see below): `vendor/LICENSE.txt` only *points at* the top-level
  `LICENSE` for the first-party half, and the Matter.js MIT notice it reproduces leaves with the
  Matter.js code it covers.
- [ ] `build.mjs` — drop `"orchard-drop"` from `TIER2_VENDORS`; it stays in `GAME_PAGES`.
- [ ] `src/registry.ts` — remove `tier: 2` and the Matter.js attribution; the entry keeps its id,
  icon, slot, and `status: "playable"`, so no drawer-count assertion moves.
- [ ] `tests/orchard-drop.spec.ts` — rewritten from a wrap-wiring test to a native game test.
- [ ] `TODO/README.md:49` — orchard-drop leaves the shipped-wraps line.
- [ ] `plans/2026-08-02-orchard-drop-wrap.md` — `**Status:**` → superseded by this plan.

**Call chain:** drawer → `orchardDropModule().mount(container)` → canvas + rAF loop →
`orchard-wasm.ts` → wasm → core.
**Wiring test:** `tests/orchard-drop.spec.ts` — navigate to `/orchard-drop/`, assert **no iframe
is present**, assert the honest-representation banner is **absent**, drop a fruit via keyboard,
and assert the score element changes. The negative assertions matter as much as the positive one:
they are what proves the wrap is gone rather than merely hidden.
**Depends on:** Phase 3.
**Read-set:** `vendor/index.html` (the art and layout being ported — read it before deleting it),
`src/games/2048/2048.ts` (native module idiom), `src/wrapped-banner.ts`, `src/settings.ts`.
**Write-set:** `src/games/orchard-drop/**`, `src/registry.ts`, `build.mjs`,
`tests/orchard-drop.spec.ts`, `TODO/README.md`, `plans/2026-08-02-orchard-drop-wrap.md`.
**Shared-state contract:** `src/registry.ts` and `build.mjs` are high-traffic shared files — check
`git log --oneline -3` on both before editing, and rebase rather than resolve at land time.
**Risks:** Underestimation. This is the largest phase and the one with no interesting problems in
it, which is exactly the combination that runs long. The accessibility work in particular is new
here — §9 exempted the embedded canvas, so none of it has been done for this game before.
**Done when:**
1. **Behavioral:** `/orchard-drop/` plays natively — no iframe, no banner, keyboard and touch
   both work, best score persists across a reload (the bug the sandbox caused, fixed as a
   side-effect).
2. **Verification:** `npx playwright test tests/orchard-drop.spec.ts` plus the axe scan in both
   themes; `npx vitest run` green (the containment spec must now enumerate three games, not four).
**Validation:** Broad. Run it on a real phone, not just an emulated viewport.

---

### Phase 5: The verifiable outcome *(lands with Phase 4)*

**Goal:** The property this whole plan exists to buy — a finished run emits a `pond-outcome`
record, the end screen is verification-forward, and `?r=` re-verifies before display.

**Changes:**
- [ ] `src/games/orchard-drop/orchard-drop-outcome.ts` — record/envelope/verify/share on
  `src/games/2048/2048-outcome.ts`'s shape. The claim: *on seed X this sequence of drops reached
  score S*.
- [ ] `?r=` share via `src/games/share.ts` (deflated), re-verified on open.
- [ ] End-screen: score, drop count, one-tap re-verify, share.
- [ ] `orchard-drop-howto.ts` — delete the "A wrapped game — no verifiable record" entry; add the
  §7 verification-forward guide. Keep the Suika lineage credit, drop the Matter.js credit.
- [ ] `npm run guide:shots` — regenerate `orchard-crate`, which currently shows the wrap's chrome.

**Call chain:** game over → `record_json()` → outcome module → end screen; `?r=` on load →
`verify_json()` → display or reject.
**Wiring test:** Play a scripted game to game-over in a real browser, capture the `?r=` URL,
reload with it, and assert the page shows a **verified** record with the same score. End to end,
through the URL — not a unit test of the encoder.
**Depends on:** Phase 4.
**Read-set:** `src/games/2048/2048-outcome.ts`, `src/games/share.ts`, `docs/BUILDING-GAMES.md` §3.
**Write-set:** `src/games/orchard-drop/orchard-drop-outcome.ts`,
`src/games/orchard-drop/orchard-drop-howto.ts`, `assets/guide/`, `src/how-to-registry.ts`.
**Shared-state contract:** `guide:shots` writes generated assets; regenerate rather than
hand-edit.
**Risks:** Share-URL length. A long run is many drops; each is a `(tick, x)` pair. Measure a
10-minute game's deflated URL. If it exceeds a portable length, the fix is a tighter move
encoding (delta-encoded ticks), decided against a measurement rather than pre-optimised.
**Done when:**
1. **Behavioral:** Finishing a run yields a share link that, opened fresh, re-verifies and shows
   the same score — and a tampered link is rejected.
2. **Verification:** `npx playwright test tests/orchard-drop.spec.ts -g verif`.
**Validation:** Broad, including the negative case. A verifier that accepts a tampered record is
worse than no verifier.

---

### Phase 6: Cross-build enrolment, the gate, and the record

**Goal:** The determinism claim is enforced by CI, not by this plan's say-so, and the docs tell
the truth about what happened.

**Changes:**
- [ ] `crates/xbuild/src/lib.rs` — add orchard hash exports; `check.mjs` asserts wasm hashes equal
  the native golden vectors. Without this the `native == wasm` claim is a Phase 0 memory, and §2
  requires it to be a standing check.
- [ ] `docs/BUILDING-GAMES.md` §11 — cross-reference that Orchard Drop took the deterministic
  branch, and why the economics differed from Emoji Wars.
- [ ] `TODO/emojiwars.md` — note `pond-physics` exists as an option, without reopening its
  decision.
- [ ] This plan's Review Log — the honest retrospective, D5's verdict included.
- [ ] Full gate + deploy.

**Call chain:** CI `rust` job → `cargo test --workspace --release`; `npm run gate` → build:wasm →
vitest → playwright.
**Wiring test:** `node crates/xbuild/check.mjs` fails if a solver constant is changed. Verify by
actually perturbing one and watching it go RED — an un-failed check is not a check.
**Depends on:** Phase 5.
**Read-set:** `crates/xbuild/src/lib.rs`, `.github/workflows/deploy.yml`.
**Write-set:** `crates/xbuild/**`, `docs/BUILDING-GAMES.md`, `TODO/emojiwars.md`, this plan.
**Shared-state contract:** Deploy touches the live site — the landing/deploy step is ask-first
per the workspace commit matrix.
**Risks:** Skipping the doc half. It is the last item in the last phase, which is the most-skipped
position in any plan.
**Done when:**
1. **Behavioral:** Changing a solver constant turns CI red.
2. **Verification:** `npm run gate` green; `npm run test:rust` green; the deliberate-perturbation
   check observed RED then reverted.
**Validation:** Broad.

---

## Open Questions

- [RECOMMENDED: BLOCKING] Is the fixed-point solver worth writing versus taking Rapier with
  `enhanced-determinism`, which is already measured to work? *Phase 0 answers the empirical half
  (D1/D5); the judgement half is the trade in § Reasoning — integer math has no untested-engine
  exposure and honours the repo's no-floats-on-the-hashed-path rule, but Rapier is battle-tested
  and much less work. The owner should confirm the direction before Phase 1, because Phase 0's
  spike is cheap and Phase 1 is not.*
- [RECOMMENDED: BLOCKING] Is the §§5–8 tax (Phase 4) acceptable? *It is roughly half the total
  effort and buys accessibility and settings the wrap was exempt from — real value, but it is not
  the physics work and it is easy to agree to the plan while only picturing the interesting part.*
- [RECOMMENDED: PHASE-GATED — Phase 2] Should the merge tie-break rule match the current game's
  observable behaviour, or is a clean rule enough? *Matter's pair order is an implementation
  detail we cannot faithfully reproduce, so a three-way contact may resolve differently than it
  does today. Recommendation: a clean documented rule, and accept that old muscle memory shifts
  slightly. There are no saved games to break.*
- [RECOMMENDED: PHASE-GATED — Phase 5] Does the record need `Outcome::Lost` semantics, or is a
  score-chase always `Abandoned`/`Lost`? *2048 has the same question already answered; follow
  whatever it does rather than inventing a variant.*
- [RECOMMENDED: ADVISORY] Should `pond-physics` be built for Emoji Wars' needs, or strictly for
  Orchard Drop's? *Recommendation: strictly Orchard Drop's. Emoji Wars has not decided to adopt
  it and building for a hypothetical second consumer is how a 3-file solver becomes an engine.*

## Review Log

- **2026-08-28 — Pass 1 (plan development).** Drafted from a read of the vendored bundle, the
  Tier-1/2/3 standards in `docs/BUILDING-GAMES.md`, the bubble fixed-point precedent, the 2048
  outcome precedent, and the rapier-determinism spike. Sixteen assumptions verified against the
  tree at `e453afb` and recorded above; four unknowns deliberately left to Phase 0. Two
  alternatives (Tier-3 with Matter; Tier-1 with Rapier) were considered and rejected with reasons
  rather than omitted — the Rapier rejection is the weaker of the two and is written that way.
  Not yet reviewed for gaps or downstream effects (Pass 2) or quality gates (Pass 3).
- **2026-08-28 — Pass 1 self-check against the tree.** Every path the plan cites was re-read
  rather than inferred. Two corrections: guide shots land in `assets/guide/`, not `assets/shots/`
  (`tools/guide-shots.mjs:17`); and the licensing open question was resolved rather than left
  open — `vendor/LICENSE.txt` carries no obligation that outlives the vendor bundle, so Phase 4
  can delete it outright. `crates/xbuild/check.mjs` confirmed to exist at that path.
