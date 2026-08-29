# fun.croft.ing — agent directives

## Identity (workspace architecture)

**Scope:** The games shelf — shared drawer chrome + `pond-*` substrate, per-game bundles.
**Not this repo:** anything platform-level (discovery designs it; croft ships it).
**Provides:** the games site. **Consumes:** the pond substrate contract (internal).
Card + altitudes: `CroftC/.claude/ARCHITECTURE.md`.

Project-layer directives for the Croft games shelf. These sit **on top of** the
global coding-agents practices (`~/.claude/coding-agents/`, source
`github-personal:chasemp/coding-agents`) — they don't restate them, they point
at them and add what's specific to this repo. Git identity: chasemp
(`chase@owasp.org`, `github-personal`).

## Dev practices — non-negotiable, inherited from coding-agents

- **TDD, always.** RED → GREEN → REFACTOR. No production code without a failing
  test first — including data/schemas/constants. Watch the test fail before you
  make it pass. (coding-agents `CLAUDE.md`; the `tdd-guardian` agent.)
- **Phase-plan every new game and every non-trivial change.** Use the
  `/phase-plan` command (three passes; plan doc per the workspace convention `plans/YYYY-MM-DD-plan-<slug>.md` (no ordinal — retired 2026-08-29, `CroftC/.claude/TRACKING.md` § "Plan files") with a
  `**Status:**` line and Review Log (`CroftC/.claude/TRACKING.md`; older plans here
  predate it and keep their names),
  matching this repo's existing convention). A game is complex enough to warrant
  it every time. Plans carry Problem / Reasoning / Verified-Assumptions, not just
  a task list.
- **Rust discipline** (`rust-enforcer`): no `unwrap()`/`expect()` in production
  paths, `Result<T,E>` for fallible ops, `#[warn(missing_docs)]`, `thiserror`
  errors. The cores are determinism-critical — no floats on the hashed path;
  `usize`→`u32` at RNG/hash boundaries so native==wasm.
  - **Enforced in CI** by the `rust` job in `.github/workflows/deploy.yml`, which
    `deploy` depends on: `cargo fmt --all --check`, `cargo test --workspace
    --release`, `cargo clippy --workspace --all-targets -- -D warnings`. Same three
    locally via `npm run test:rust` (folded into `npm run test`).
    `--release` on the test command is **load-bearing**, not tuning: in debug the
    suite runs >20 min (bubble-solver's search), in release ~53s.
  - **The toolchain is pinned in `rust-toolchain.toml`** — the single source of
    truth, read by `tools/rust-gate.sh`, `tools/build-wasm.sh`, and both CI jobs.
    The workspace pins every dependency exactly and commits `Cargo.lock`; a
    floating `stable` contradicted that, letting a Rust release redden `main` on
    untouched code and letting two machines validate the same `native == wasm`
    claim under different compilers. Bumping it is a deliberate commit: change
    `channel`, run `npm run test:rust`, fix what the newer clippy sees.
  - **Run the gate through `npm run test:rust`, not bare `cargo clippy`.**
    Homebrew's cargo/clippy shadow rustup on PATH — the same trap `build-wasm.sh`
    documents for `rustc` — and Homebrew's clippy *lags*. During this gate's
    bring-up local clippy 0.1.94 passed code CI's 0.1.97 rejected, three round
    trips in a row. The scripts resolve cargo via `rustup which` from the repo
    root so the pin applies; the job prints its versions every run.
  - **Lint level: default clippy workspace-wide, `pedantic` opt-in per crate.**
    New crates opt in with `[lints] workspace = true`, which picks up
    `[workspace.lints.clippy]` in the root `Cargo.toml` — pedantic **minus the cast
    family**. Measured 2026-08-04: 81% of pedantic's 190 hits here are
    `cast_possible_truncation` and friends firing on exactly the `usize`→`u32`
    narrowing the line above *requires*. Existing crates are grandfathered.
    (This bullet used to claim "`clippy::pedantic` clean" workspace-wide; nothing
    checked it and nothing ever had. It now says what is true.)
- **`npm run gate` is the whole gate, and CI runs all of it.** `gate` =
  `npm run test` (Rust + **cross-build** + typecheck + lint + unit + build) +
  `npm run e2e`.
  - **`test:xbuild` was added 2026-08-29, and the finding is worth keeping.** The
    cross-build determinism harness (`crates/xbuild`) replays golden scenarios
    inside `wasm32` and asserts the hashes equal the natively-recorded ones — and
    it **ran nowhere at all**: no npm script, no `tools/` caller, no CI
    reference. It existed, was documented, and was executed by nothing, so
    `native == wasm` — a claim this shelf makes to users — rested on a script
    someone had to remember to run. It needs a node step after a wasm build,
    which is why it never fitted the Rust-only job. Its `run.sh` also resolved
    `--toolchain stable`, floating free of the pin, and that is fixed too.
  Measured 2026-08-07: **3m44s** locally, of which the browser half is ~55s.
  - CI runs the same three parts as **parallel jobs** (`build`, `rust`, `e2e`),
    and `deploy` needs all three — so a failing board blocks publication rather
    than annotating it.
  - The e2e half was CI-less until 2026-08-07: 418 tests — every game's wiring
    test, axe in both themes, every `?r=` share round-trip — ran only on whichever
    machine the author happened to use, while the checklist claimed they gated.
  - **Measured, because the estimate was wrong.** I predicted a parallel job would
    add no wall clock (`build` is 225s of `npm run unit`, so there looked to be
    room underneath it). It added about a minute: a GitHub runner gives Playwright
    **2 workers** where a laptop gives 7, so the suite takes **4.5 min** on CI
    against ~55s locally, which makes `e2e` the longest job (5.9m vs `build`'s
    5.6m) and the run 6.2m against 5.3m before. Worth it, but it is the critical
    path now — if the suite grows, that is where it shows up.
  - Run `gate` locally anyway before pushing. CI catching it is a slower, more
    public way to learn the same thing.
  - **The browser suite is sharded on CI** (2026-08-29): a `wasm` job builds the
    modules once, and three shards per engine download them and run
    `npm run e2e -- --project=… --shard=i/3`. The job name carries engine and
    shard. `build.mjs` treats a missing module as an ERROR under `CI`, so a shard
    that lost its artifact goes red instead of serving an engineless shelf.
    Sharding was chosen over a longer per-test timeout for the reason the
    workflow's comment block records: the timeout buried a real hang once.
  - **`npm run smoke`** (one engine, `@smoke`: every game's wiring test and the
    a11y matrix, ~a minute) is the human's quick red/green. It is a command, not
    a CI job — a smoke job that passes beside a failing shard is a green tick
    that means less than what is next to it.
  - **A browser test over ~20 s is a smell**, and the fix is a seam, not a longer
    timeout. A test that plays a game asserts rules and wiring, not pacing:
    cribbage, Othello and checkers read `?fast=1` and collapse the engine's beats
    to a frame; their full-game tests (`@long`) pass it. Cribbage's full game
    went from 72 s per engine to 5 s.

- **Node is pinned by `.nvmrc` (22) — use a version manager, not the system Node.**
  The same rule as `rust-toolchain.toml`: the repo pins the toolchain, CI reads
  the pin (`actions/setup-node` with `node-version-file: .nvmrc`), and a machine
  running something else is validating a different thing.
  - Set up once: `brew install fnm`, then `fnm install` in this repo (reads
    `.nvmrc`), and `eval "$(fnm env --use-on-cd)"` in `~/.zshrc` so `cd`-ing here
    switches Node automatically.
  - **The pin is enforced, not just declared.** `.npmrc` sets
    `engine-strict=true`, so `npm ci` **refuses** a wrong Node (`EBADENGINE …
    fun-croft-ing@0.1.0`) instead of printing a warning that scrolls past. That
    is the piece missing on 2026-08-06: this repo already had `.nvmrc` *and*
    `engines`, and neither stopped a full day on Node 25. Verified both
    directions — exits 0 on 22, refuses on 24. Full reasoning lives in the
    workspace standard, `croft-pwa/docs/CI.md` §6.
  - This is not hypothetical tidiness. Node **25** ships its own placeholder
    `globalThis.localStorage` — no `clear`, no `key`, no `length` — which outranks
    the `Storage` vitest's jsdom environment installs, and 11 Trio Tumble tests failed
    locally for a day while CI was green. `tests/setup/webstorage.ts` repairs it
    when broken and is inert on 22, but the repair exists because the versions
    diverged; running the pinned version is the actual fix.
  - Symptom worth recognising: `dyld: Library not loaded: libllhttp.9.3.dylib`
    from `node` means a Homebrew upgrade moved a dependency out from under the
    system Node. Under fnm that cannot happen to the pinned toolchain.
- **A check must actually run, and its result must actually reach you.** Three
  failure shapes, all observed here, all of which report the same green as a real
  pass. Named because they are invisible by construction:
  - **The result never arrives.** A pipeline exits with its LAST command's
    status, so `npm run test:rust | tail -40` hands you `tail`'s exit code and
    the tail of the log — the header, the failures and the counts are all above
    the fold. `cargo clippy | grep -c error && git commit` commits whether or not
    clippy passed, because `grep` succeeds either way. **Never pipe or chain a
    verification.** `bash tools/check.sh <label> <cmd...>` does it correctly:
    whole log to a file, tail printed, the command's own exit code returned.
  - **The check never runs.** `crates/xbuild` — the harness backing
    `native == wasm`, a claim this shelf makes to users — had no npm script, no
    caller and no CI reference for months. Writing a guard for it immediately
    found a second, `crates/solitaire-wasm/run.sh`, in the same state; both also
    carried a floating `--toolchain stable`, because nothing ran either script to
    notice. `tests/gate-reachability.test.ts` now makes unwired a red board.
  - **The check runs but grades less than it looks like.** Measured: axe's
    `.include(sel)` **throws** when the selector matches nothing; `.exclude(sel)`
    is **silent** and scans everything. So a broken include fails instantly and a
    stale exclude survives indefinitely — one did, for a day after its iframe
    left the shelf. `tests/axe-scope.test.ts` requires an exclusion to prove its
    target exists.

  The through-line: **tests going red is not the failure mode to design against.
  Checks going green without having run is.**
- **Mutation-test the cores.** `cargo mutants --package <crate> -j 4` (installed;
  run it with the pinned toolchain on PATH, as `tools/rust-gate.sh` does). Expected
  when a determinism-critical crate goes green and **before calling its phase
  done** — the game cores are rules engines, encoders and searches, which is
  exactly where a green suite hides holes. Not a per-commit gate and **not in CI**:
  a run is minutes, and it is an audit, not a check.
  - **Closing a survivor means watching the new test fail against it.** Twice in
    one session a test was written to kill a mutant, asserted to kill it, and did
    not — once because the mutated code was not the mechanism in play at all
    (game-over is driven by *merged* fruit, which carry no grace, so a dropped
    fruit's grace could be absurd and nothing noticed). Re-apply the mutation by
    hand and watch the new test go red. A test written to close a survivor is
    worth nothing until it has been seen to fail against that survivor — which is
    the same rule as watching a RED phase, one level up.
  - **Two things the cribbage audit learned about running it (2026-08-29).** In a
    worktree that has `node_modules`, `cargo mutants`' scratch copy fails with
    `File exists (os error 17)` on every worker — run it `--in-place` (which
    refuses `-j`, so it is one job) and **commit first**, since it mutates the
    tree you are sitting in. And it builds **debug**, so a test that enumerates a
    whole space (cribbage's 13M hand/cut pairs, the 20k-sample crib table) costs
    minutes *per mutant*: mark such tests
    `#[cfg_attr(debug_assertions, ignore = "…")]` — the release gate still runs
    them — and make sure something else exercises that code in debug, or the
    audit reports nothing there (the crib-table generator's 30 survivors were
    exactly that blind spot).
  - Triage every survivor into **equivalent mutant** or **real gap**, and record
    which in the plan. Equivalent mutants are common and unkillable — measured on
    `checkers-core` 2026-08-05, 9 of 26 survivors were provably behaviour-preserving
    (`(row + col) % 2` → `(row - col) % 2`, `a | b` → `a ^ b` on disjoint bit
    fields, `2 * dr` → `2 / dr` for `dr = ±1`). Chasing the score rather than
    reading the survivors buys assertions that pin implementation detail.
  - The recurring real gaps here are worth knowing in advance: **a trait impl that
    only delegates** (every test calls the free function, so `impl Adversary`'s
    `legal_moves` can return `vec![]` undetected), **convenience API with no test
    caller**, and **`render_text`** (asserting `contains("11")` passes even if every
    glyph is wrong). See `plans/2026-08-04-checkers-game.md` → Phase 4/5 execution.
- **Commit at every stable (green) point.** No batching phases. Each commit is a
  working checkpoint. Co-author trailer, naming **the model that actually wrote
  the commit** — currently
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. The name
  is attribution, so it tracks the model rather than this line: a newer model
  updates it here as part of its first commit rather than signing a predecessor's
  name. (Was pinned to Opus 4.8 until 2026-08-07.) Don't push/PR unless asked.
- **No stubs; built means wired means tested.** A game isn't done until it's
  reachable from its `/<id>/` URL through the drawer registry, with a wiring
  test that goes through the entry point (BUILDING-GAMES §8).
- **Regenerate the how-to guide shots when a game's UI changes.** Any change that
  alters what a game looks like or how it plays must re-run the "How to play"
  screenshots so the guide can never show a UI that no longer exists:
  `npm run build:wasm && npm run build && npm run guide:shots` (writes
  `assets/guide/<name>.jpg`; a unit test fails on a missing referenced shot, an
  e2e fails on a 404). This is part of the definition of done for a game update,
  alongside the how-to *copy* itself — commit the regenerated shots. Guard
  against unrelated churn: `guide:shots` rebuilds **every** game's shots, so
  `git add` only the shots for the game you changed and `git checkout --` the
  rest (other games' JPEGs can re-encode differently run-to-run).

## The shelf model — three tiers (COHESION §62 in discovery)

`docs/BUILDING-GAMES.md` is the full standards doc. In short:

- **Tier 1 — Croft-native (build-fresh).** Determinism-first Rust core → wasm,
  **verifiable outcome** (move-list replay → `state_hash`, re-verifying `?r=`
  share), tap-first with the core deciding legality. solitaire · Trio Tumble ·
  bubble · Orchard Drop (rebuilt from a wrap, 2026-08-29). This is the shelf's differentiator; build fresh when a
  game's rules are simpler than an integration.
- **Tier 2 — RETIRED 2026-08-29.** It held third-party games taken as-is in a
  sandboxed iframe, honestly represented as keeping no verifiable record. Four
  games passed through it and none stayed: three were removed as not fitting the
  shelf, and Orchard Drop was rebuilt Tier-1. The standard, its containment
  harness, its `tier2.meta.json` schema and its banner are all gone; the
  headstone and the reasoning worth keeping are in `docs/BUILDING-GAMES.md` §9,
  and the full text is in git history. **If a wrap is ever wanted again, restore
  it from history rather than reinventing it.**

- **Tier 3 — engine-backed original.** A game **we build** on a **third-party
  engine whose numerics we do not control** (a physics engine, a solver). Ours
  like Tier-1, non-verifiable like Tier-2, and neither of them: it runs in our
  page directly (nothing foreign to contain), so it owes the **full first-party
  standard** — tap-first, settings, accessibility across the whole surface —
  everywhere except the verifiable outcome the engine denies it. Two rules carry
  the tier: **share inputs, never outcomes** (a level or seed, never a result
  presented as a record), and **the data/sim line must be visible in the
  directory structure**, with the data side keeping full Tier-1 discipline
  (golden vectors, mutation testing). The sim side pins behaviour with
  **tolerance probes** instead. Standard is **`docs/BUILDING-GAMES.md` §11**;
  **Emoji Wars** (`levelforge`, matter-js) is the reference implementation.
  This tier is a decision, not a default — for Emoji Wars a deterministic path
  was measured, found to work, and declined on cost (see §11).

**Adversarial (two-player) games + AI opponents.** Three shipped, in order:
Drop 4 (`/drop4/`, solvable), Othello (`/othello/`, heuristic Oracle with an exact
endgame) and checkers (`/checkers/`, heuristic Oracle whose `exact` means *a
terminal was proven*, and whose move is a jump chain rather than a destination —
the case that tested the shared trait, band, tutor and harness rather than
repeating them). Drop 4 was the shelf's first, and all three are Tier-1 builds
with a verifiable outcome. The engine is strength/difficulty, the LLM is UX
(legality/personality/explanation/tutoring); the standard lives in
`docs/BUILDING-GAMES.md` §10 and the full guide in `docs/AI-PLAYERS.md`.
**Cribbage** (`/cribbage/`, 2026-08-29) is the first **hidden-information** game
and deliberately uses none of that stack: the core hands out a per-seat `View`,
the solver's public surface takes only a `View` (source-pinned), the binding has
no state export, and a Rust rig plays a peeking player against the honest engine
to prove it cannot see the other hand (§10 → "Variation — hidden information").

The candidate inventory + the Tier-2 inclusion filter live in discovery:
`discovery/alpha/thinking/app/ponds/client-side-static-game-candidates.md`.

## Game isolation — one directory per game

Each game owns a **self-contained directory**; shared shelf infrastructure stays
shared and is built once. See `docs/BUILDING-GAMES.md` → "Game isolation" for the
canonical layout. In short: a game's Rust crates (`crates/<game>-core`,
`crates/<game>-wasm`) and its front-end (`src/games/<game>/` — module, wasm
wrapper, how-to data, game-specific assets) belong to that game and to nothing
else; the drawer chrome, settings, theme, how-to renderer, and the `pond-*`
substrate are shared and never duplicated per game. This matters most for Tier-2
/ webxdc-style bundles, which are wholly self-contained under their own
directory. Do not let one game's mechanics leak into another's files.

## Concurrent sessions (workspace norm)

Multiple agent sessions share the `CroftC/` workspace. Do multi-turn work in a dedicated
worktree — `git -C fun worktree add ../worktrees/fun/<slug> -b claude/<slug>` — never in
this checkout (peer sessions stage with `git add -A`; loose files get swept into unrelated
commits). Contested surfaces here — claim in `CroftC/.coordination/claims/` before
touching: **landing on `main`** (the shared shelf chrome and `pond-*` substrate). Full protocol and the reasons behind it: `CroftC/.claude/COORDINATION.md`.
