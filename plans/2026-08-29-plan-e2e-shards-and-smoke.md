# The browser suite: shards for runtime, a smoke tier for sanity

**Status:** Pass 1 (shape), 2026-08-29. Not started. Three decisions (D1–D3) with
recommendations; D1 changes what gets built, so it is answered before Phase 1.

## Problem Statement

The browser suite is the gate's critical path and it is saturating. 23 spec files,
~270 tests per engine (~295 with the a11y matrix), run as two CI jobs — one per
Playwright project — each with the 2 workers a GitHub runner gives Playwright, under a
30 s per-test ceiling. It has grown a game at a time, and each versus game brings a
full-game test.

What saturation looks like, measured on the landing that made it visible
(run 33263190505, 2026-08-29): two tests failed on the mobile-WebKit job — `home.spec`
on a `page.goto` that hit 30 s, `orchard-drop.spec` on a status line that never
updated — neither in the game being landed, both unrelated to each other, both cheap
tests queued behind long ones. The workflow's own comment block records the same shape
three times over the preceding two days ("a different test each run"), and the split
into one job per engine was the previous remedy. It bought headroom; the headroom is
spent.

Two distinct problems are tangled in that symptom, and they need two different cuts:

- **Runtime.** Total test time on one runner: 279 s on mobile-WebKit, 135 s on
  chromium (last green run, 601c864). Locally with 7 workers the same suite is 1.3 min.
- **Sanity.** When the leg saturates, the *failing test names are noise* — they name
  whichever cheap test lost the race, not what broke. A human reading the board cannot
  tell a starved page load from a broken game.

## Reasoning

### What a job actually costs, measured

From the last green run's step timings (run 33259048541):

| step | chromium | mobile-webkit |
|---|---|---|
| checkout, toolchain, node, `npm ci`, caches | ~25 s | ~25 s |
| Playwright browser + system deps | 16 s | **110 s** |
| `npm run e2e` (includes the wasm build inside `webServer`) | 135 s | 279 s |

Inside the `e2e` step, Playwright's `webServer` runs `npm run build:wasm` before a
single test starts — on a cold runner that is one to two minutes of the step. So a job
is roughly **2–3.5 min of fixed cost** (more on WebKit, whose browser download is
slow) plus the tests. That number decides how many shards are worth having.

### Why shard by count, not by game

Playwright's `--shard=i/n` splits the *test list* evenly. Splitting by spec file would
recreate the lopsided leg: the a11y matrix (45 tests, ~80 s across both engines), the
versus games (Furrow 40 s, Othello 39 s, checkers 34 s, Dots 25 s) and the rest (most
specs under 5 s) do not balance by file. By count they roughly do, and the balance is
checked by measurement in Phase 2, not assumed.

### Why sharding alone is not enough, and what is

With three shards per engine, each shard pays the fixed cost again:

```
 today            fixed ~3 min + tests ~4.5 min  = ~7.5 min  (webkit)
 3 shards         fixed ~3 min + tests ~1.5 min  = ~4.5 min  wall, ×3 the minutes
 3 shards + one   fixed ~1.5 min + tests ~1.5 min = ~3 min   wall
   wasm build
```

The wasm build is the fixed cost that does not have to be paid per shard: the `build`
job already produces `dist/` (with the `.wasm` files) for deploy. Handing that
artifact to the e2e shards, and pointing `webServer` at a plain `serve` of it, takes
the build out of every shard. That is **D1**, and it is the difference between a
sharding change that saves two minutes and one that halves the wall clock.

The cost of D1 is a coupling the workflow does not have today: e2e would depend on
`build` (it currently runs in parallel with it). On a runner, `build` is ~5.6 min of
mostly `npm run unit`; e2e would start after it. Net wall clock is still better, but
it changes the shape of the graph, and `croft-pwa/docs/CI.md` — the canonical
pattern — should say so. Alternative: a small `wasm` job that builds only the `.wasm`
files (~1.5 min) and feeds both `build` and the shards; cleaner, one more job.

### Why a smoke tier is local, not a job

A `@smoke` subset — each game's wiring test and its axe pass, about a minute — gives a
human a red/green they can read. It is worth having as **a command** (`npm run
smoke`), for the pre-push habit and for the "is the shelf broken or is CI starved"
question. It is *not* worth a CI job: CI already runs everything, and a smoke job
that passes while a shard fails is exactly the "green tick over something red" shape
`CI.md` warns about. **D2.**

### Why not `retries`

Playwright's `retries` would turn a starved `page.goto` into a pass on the second
try. It would also have turned `dots.spec.ts:191` — a real hang the workflow's comment
block records — into a pass. A remedy aimed at the symptom buries the evidence.
Not proposed.

### The per-test convention

Cribbage's full-game test held a worker for 72 s per engine doing nothing but the
engine's pacing beats, and a `?fast=1` seam that collapses the beats took it to
5 s. The pattern generalises: a test that plays a game asserts rules and wiring, not
pacing. A test over **~20 s** is a smell, and the fix is a seam, not a longer
timeout. This is a convention for `CLAUDE.md`, and a measurement in Phase 2 — the
tests currently over it are Othello's and checkers' full games. **D3** is whether to
give them the same seam in this plan or file it.

### Alternatives considered and rejected

- **Raise the per-test timeout.** Rejected in the workflow's own comment block, for
  the right reason: it buried a hang once already.
- **Consolidate back to one job.** Rejected there too ("DO NOT CONSOLIDATE"); shards
  are a further split, not a merge, and keep the per-engine attribution.
- **More workers per runner.** A GitHub runner has 2 cores; 4 workers on 2 cores is
  slower, not faster (measured in `CI.md` § the runner).
- **Bigger runners.** Paid; a last resort after the free shape is exhausted.

## Verified Assumptions

- **The e2e job is one per project, with `fail-fast: false`, and its comment block
  records why** (`.github/workflows/deploy.yml`, the `e2e` job). Shards extend it.
- **`deploy: needs: [build, rust, e2e]`** (`deploy.yml:246`). A matrix job with
  shards is still one `needs` entry; all shards must pass.
- **Step timings** as tabled above (`gh run view 33259048541 --json jobs`).
- **`webServer` builds the wasm** (`playwright.config.ts`: `npm run build:wasm &&
  node build.mjs && node tools/serve.mjs`).
- **The a11y matrix was regrouped per game on 2026-08-29** (`tests/a11y-matrix.spec.ts`,
  main 601c864), so its 45 tests shard like any others.
- **`CI-PATTERN.md`'s nine rules** hold today (`pull_request` trigger, `needs`, the
  `main` guard, concurrency, permissions, one gate command, pins, timeouts,
  dispatch). Shards must keep every one; rule 6 ("one gate command, identical locally
  and in CI") is the one sharding is most likely to bend, so `npm run e2e` stays the
  command and `--shard` is an argument to it, as `--project` already is.

## Documentation Impact

- `.github/workflows/deploy.yml` — the `e2e` matrix, and its comment block extended
  with the shard decision and the measured costs. Phase 2.
- `croft-pwa/docs/CI.md` → the runner section: shards, the fixed-cost table, and
  (under D1) the artifact hand-off. `CroftC/.claude/CI-PATTERN.md` index line. Phase 4.
- `fun/CLAUDE.md` → the gate bullet: `npm run smoke`, and the ~20 s convention with
  the seam pattern. Phase 3/4.
- `docs/BUILDING-GAMES.md` §8 (the gate): a full-game test takes the seam. Phase 4.

## Concurrency Map

Phases 1 → 2 → 3 sequential (each measures what the prior changed). Phase 4 is docs.
The workflow file is a contested surface across sessions (`CI-PATTERN.md`: read before
touching any workflow) — claim it in `.coordination/claims/` for Phase 2.

## Phases

### Phase 1: measure the split before choosing it

- [ ] Per-test durations from three recent green runs (both engines), as a table:
  the fixed-cost split inside the `e2e` step (wasm build vs tests), and the
  distribution — how many tests over 10 s, over 20 s, and their names.
- [ ] Dry-run `--shard=i/3` locally per engine and record each shard's total, to see
  whether count-sharding balances (the a11y matrix and the versus games are the
  risk).
- [ ] Record the numbers in this plan; choose the shard count from them (the prior is
  three; two if the fixed cost dominates without D1).

**Done when:** the table is in the Review Log and the shard count is a measured
choice.

### Phase 2: shards in the workflow (and D1's build hand-off if taken)

- [ ] `e2e` matrix: `project × shard`, `npm run e2e -- --project=… --shard=i/n`,
  `fail-fast: false` kept, job name `e2e (mobile-webkit 2/3)` so a failure names
  both engine and shard.
- [ ] Under D1: `build` uploads `dist/` (or a `wasm` job uploads the `.wasm` files);
  the shards download it and `webServer` becomes a plain serve. `build.mjs`'s
  "wasm not built yet" warning becomes an error in CI so a missing artifact cannot
  pass as a green run over nothing (`CI.md`'s guard).
- [ ] The comment block: why shards, the costs, and "DO NOT raise the timeout"
  carried forward.
- [ ] Prove it on a branch run: every shard green, wall clock recorded; then a
  deliberately broken game (a wiring test made to fail) reddens exactly one shard
  and blocks deploy.

**Done when:** a green run's wall clock is recorded beside today's 7.5 min, and the
broken-game proof is in the Review Log.

### Phase 3: the smoke tier and the seam convention

- [ ] `@smoke` on each game's wiring test and its axe pass; `npm run smoke` =
  `playwright test --grep @smoke`; measured under a minute locally.
- [ ] `@long` on the game-playing tests; no CI behaviour change (they run in their
  shards), only legibility on the board.
- [ ] D3: Othello's and checkers' full-game tests take the `?fast=1` seam (their
  modules already pace with constants; the seam is the cribbage shape).
- [ ] The ~20 s convention in `CLAUDE.md`, with the seam as the fix pattern.

**Done when:** `npm run smoke` runs in under a minute and turns red on the same
deliberately broken game.

### Phase 4: documentation

Everything under "Documentation Impact"; `CI.md` is the canonical and gets the table.

## Open Questions

1. **D1 — take the wasm build out of the shards?** Recommendation: **yes, via a
   small `wasm` job** that builds only the `.wasm` files and feeds both `build` and
   the shards. Without it, sharding saves about two minutes of a 7.5-minute leg and
   triples the runner minutes; with it, the leg is about three minutes. The cost is
   one more job and an artifact hand-off to document.
2. **D2 — smoke as a command only, not a CI job.** Recommendation: **command only**,
   for the reason in "Reasoning". A CI job would be a green tick that means less than
   the shards next to it.
3. **D3 — give Othello's and checkers' full-game tests the fast seam in this plan?**
   Recommendation: **yes**; they are the two tests still over 20 s, and the seam is
   forty lines each on the cribbage pattern. Filing it instead leaves the convention
   with two standing exceptions on the day it is written.

## Review Log

*(Execution notes go here, one entry per phase: what was measured, what the
measurement refuted, and what changed as a result.)*
