# P9 — The Rust CI gate

**Status:** planned (Pass 1 + Pass 2 complete; Pass 3 pending)
**Standards anchor:** `fun/CLAUDE.md` § "Dev practices — non-negotiable"
**Found by:** Pass 3 of `plans/2026-08-04-checkers-game.md`, while checking that
plan's per-phase verification commands against what CI actually runs.
**Sequencing constraint:** lands **before** checkers Phase 4 (see § Relationship to
the checkers plan).

---

## Problem Statement

`fun/CLAUDE.md` states, as non-negotiable: *"**Rust discipline** (`rust-enforcer`):
no `unwrap()`/`expect()` in production paths, `Result<T,E>` for fallible ops,
`#[warn(missing_docs)]`, `thiserror` errors, **`clippy::pedantic` clean**,
**`cargo fmt --check` clean**. The cores are determinism-critical."*

**None of it is checked by anything automated.**

- `.github/workflows/deploy.yml` runs `npm ci` → `build:wasm` → `typecheck` →
  `lint` → `unit` → `node build.mjs` → publish. There is no `cargo test`, no
  `cargo clippy`, no `cargo fmt --check` anywhere in the file.
- `npm run test` (`package.json:19`) is `typecheck && lint && unit && build` — the
  same four, so the local "full gate" does not verify a line of Rust either.
- `clippy::pedantic` is not merely unenforced, it is **unexpressed**: there is no
  `[lints]` table in `Cargo.toml` and no `#![warn(clippy::pedantic)]` in any of the
  33 crates. Nothing in the repo has ever asked for pedantic.

So the shelf's differentiator — determinism-first Rust cores whose verifiable
outcomes are the entire Tier-1 claim — is the one layer with no gate. A broken
`state_hash`, a failing replay test, a `usize`/`u32` slip that diverges native from
wasm: each of these reaches `main` and deploys, as long as the wasm still compiles.

**What partial coverage exists today, precisely.** `npm run build:wasm` runs
`cargo build -p <11 wasm crates> --release --target wasm32-unknown-unknown`
(`tools/build-wasm.sh`), so those 11 crates and their dependency closure are proven
to **compile for wasm**. That is real but narrow: it proves nothing about test
outcomes, host-target compilation, lints, or formatting — and it entirely misses
`crates/drop4-harness`, the Rust AI-scoring harness, which no wasm crate depends on
and which CI therefore never even builds.

**What we are building:** a Rust gate in CI and in `npm run test`, at a lint level
the repo can actually hold, plus an honest reconciliation of `fun/CLAUDE.md` with
whatever that level turns out to be.

---

## Reasoning

### Why now, and not "sometime"

Two reasons, and the second is the load-bearing one.

1. The checkers build (`plans/2026-08-04-checkers-game.md`) adds **three new Rust
   crates** and migrates **two shipped ones** onto a newly extracted shared crate.
   That is the largest Rust change the shelf has taken, and its Phase 7/8 migrations
   are explicitly at risk of a silent RNG-consumption change that shifts every
   seeded game. Doing that with no automated Rust gate means the per-phase `cargo`
   commands in that plan are the only thing between a regression and `main` — which
   is exactly what Pass 3 flagged.
2. **It is nearly free right now, and it gets more expensive every crate.** Measured
   (see Verified Assumptions): `cargo fmt --check` is already clean, and
   `cargo clippy --workspace --all-targets` emits **one** warning across all 33
   crates. The cleanup cost is one line today. There is no version of this task that
   is cheaper later.

### Why the lint level is the plan's real decision

`fun/CLAUDE.md` says `clippy::pedantic`. Default clippy is one warning away from
clean; pedantic is an unknown and probably large number away, and — this is the
part that matters — **pedantic actively fights this repo's determinism discipline.**
`clippy::pedantic` includes `cast_possible_truncation`, and `fun/CLAUDE.md` in the
same breath requires *"`usize`→`u32` at RNG/hash boundaries so native==wasm"*. Every
one of those deliberate, correctness-motivated casts is a pedantic warning. Adopting
pedantic wholesale means sprinkling `#[allow(clippy::cast_possible_truncation)]`
across the determinism-critical paths, which makes the very code that most needs
scrutiny the code with the most suppressions in it.

That is a genuine design tension, not a chore, so the plan surfaces it as the one
BLOCKING open question rather than quietly picking. The recommendation (see Open
Questions) is to gate default-level now, adopt pedantic **per-crate on new crates**
via `[lints]`, and amend `fun/CLAUDE.md` to describe what is actually enforced —
because an unenforced mandate is worse than a smaller enforced one: it trains
readers to treat the whole section as aspirational.

### Why a separate CI job, not more steps in `build`

`deploy.yml`'s `build` job is a serial chain ending in the Pages artifact upload.
Appending three `cargo` steps to it would (a) serialize the Rust gate ahead of the
deploy artifact for no reason — they share no outputs — and (b) mean a clippy
warning blocks the site build rather than failing alongside it.

A parallel `rust` job with `deploy: needs: [build, rust]` gets both properties that
matter: the gate runs concurrently with the site build (so wall-clock is the max of
the two, not the sum), and a Rust failure still blocks the deploy. This also keeps
the two jobs' caches independent — the Rust job wants a cargo cache keyed on
`Cargo.lock`, which the site build does not.

### Why the cargo cache is part of the gate, not a follow-up

`deploy.yml` has `cache: npm` and **no cargo cache at all** — every run compiles all
Rust from scratch. That is tolerable today because `build:wasm` is a
`cargo build --release` of 11 crates. Adding a host-target `cargo test --workspace`
plus a `cargo clippy --all-targets` means two further full compiles of 33 crates,
uncached, on every push to `main`. Measured locally on a warm cache the checks
themselves are seconds; cold, the compile dominates completely (see Verified
Assumptions). Shipping the gate without `Swatinem/rust-cache` would make CI slow
enough that someone eventually deletes the gate, which is a worse outcome than not
having added it. The cache is therefore in the same phase as the first check, not
deferred.

### Why "prove the gate bites" is the wiring test

A CI gate is the one kind of change where the normal test-first instinct has no
natural home: there is no unit to assert on, and a gate that passes tells you
nothing — a gate wired to the wrong path, or with a typo'd command that exits 0,
also passes. **The only evidence a gate works is watching it fail on a violation
it is supposed to catch.**

So every gate phase here has the same wiring test, and it is a genuine RED: commit a
deliberate violation on a scratch branch, watch CI go red *for the expected reason*,
revert. That is the phase's proof, and skipping it leaves a gate nobody has ever
seen work.

---

## Verified Assumptions

**Measured firsthand on this working tree (2026-08-04), not assumed:**

- **`cargo fmt --check` → exit 0.** The workspace is already format-clean. This gate
  costs nothing to adopt and can go in first with no cleanup at all.
- **`cargo clippy --workspace --all-targets` → exactly one warning**, across all 33
  members: `clippy::needless_range_loop` at `crates/bubble-core/src/board.rs:325`
  (`for r in 0..b.height - 1` indexing `old_len`). It is in a **lib test**, which is
  why it only appears under `--all-targets` — a plain `cargo clippy` would report
  the workspace clean and gate nothing in the test code. Warm-cache wall clock:
  **3.84s**.
- **No `[lints]` table in `Cargo.toml`; no `clippy::pedantic` attribute in any
  crate.** Crates carry `#![warn(missing_docs)]` at the crate root
  (`othello-core/src/lib.rs:12`, `othello-solver/src/lib.rs:12`) and nothing else.
  The pedantic mandate has never been expressed in the code, so nothing has ever
  been written against it.
- **`.github/workflows/deploy.yml`** — the `build` job is `checkout` →
  `dtolnay/rust-toolchain@stable` (targets: `wasm32-unknown-unknown`) →
  `setup-node@v4` (`cache: npm`) → `npm ci` → `npm run build:wasm` →
  `npm run typecheck` → `npm run lint` → `npm run unit` → `node build.mjs` →
  `configure-pages` → `upload-pages-artifact`. Then a `deploy` job with
  `needs: build`. **The only cache directive in the file is `cache: npm`.**
- **`package.json:19`** — `"test": "npm run typecheck && npm run lint && npm run
  unit && npm run build"`. No Rust.
- **`tools/build-wasm.sh`** — `cargo build -p solitaire-wasm -p trio-tumble-wasm -p
  bubble-wasm -p wyrdle-wasm -p twenty48-wasm -p drop4-wasm -p othello-wasm -p
  align-wasm -p blockdoku-wasm -p looseends-wasm -p color-sort-wasm --release
  --target wasm32-unknown-unknown`. Eleven crates + their dependency closure,
  compile-only, wasm target only.
- **`Cargo.toml` workspace `members` — 33 crates.** `crates/drop4-harness` appears
  in the clippy run but is **not** in `build:wasm`'s dependency closure (no
  `-wasm` crate depends on the harness), so CI does not currently compile it at all.
- **The test gate's cost is entirely a profile question, and the answer is
  `--release`.** Measured:

  | command | wall clock | result |
  |---|---|---|
  | `cargo test --workspace` (debug) | **>20 min, killed unfinished** | — |
  | `cargo test --workspace --release` | **52.97s** | **all green** |
  | `cargo clippy --workspace --all-targets` | 3.84s (warm) | 1 warning |
  | `cargo fmt --check` | instant | clean |

  The debug figure is not spread across the workspace — it is **one test binary**.
  `crates/bubble-solver/tests/solver.rs`'s `committed_pack_seeds_are_winnable_
  spotcheck` runs three full `find_win` searches, and in the debug profile it alone
  ran >15 minutes before being killed; the same three tests take **15.95s** in
  release. That is roughly a 75× profile penalty on search code, which is exactly
  the shape you would expect and exactly why a debug-profile gate would have been
  abandoned within a month.

  The crate's genuinely heavy work (`generate_daily_pack`,
  `pack_regenerates_byte_identical`, `probe_acceptance`) is **already** behind
  `#[ignore]` — so no `#[ignore]` split is needed, and none should be added. The
  profile alone fixes it.
- **The workspace is green today** (`cargo test --workspace --release` exit 0,
  33 crates). The gate will not go red on adoption, so Phase 2 is a wiring exercise
  and not a remediation one — the same inversion the clippy measurement produced.

**Not verified — deliberately deferred to Phase 0:**

- The `clippy::pedantic` warning count and its shape (concentrated in a few crates
  vs diffuse; how much of it is `cast_possible_truncation` on the determinism
  boundaries) → **D2**. This is what turns the BLOCKING open question from a
  judgement call into a decision with a number behind it.
- Whether `dtolnay/rust-toolchain@stable` provides `clippy` and `rustfmt`
  components by default in this configuration → **D3**.
- A **cold** `cargo test --workspace --release` figure, which is what CI actually
  pays on a cache miss → folded into **D1**, now a much narrower task.

---

## Documentation Impact

- `fun/CLAUDE.md` § "Dev practices" — the `clippy::pedantic` claim must be amended
  to whatever the resolved lint policy actually is, and the commit-checkpoint bullet
  should name the Rust commands now that they exist. **Phase 4.**
- `docs/BUILDING-GAMES.md` — the new-game checklist should name the Rust gate a new
  crate must pass, alongside the existing wiring/registration requirements.
  **Phase 4.**
- `README.md` — if it documents the test/CI story, it gains the Rust commands.
  *Grep evidence: `grep -n "npm run test\|npm run unit" README.md` — to be run in
  Phase 0 D4 and this line resolved or struck.* **Phase 4.**
- `plans/2026-08-04-checkers-game.md` — its Pass 3 Review Log records "CI runs no
  Rust gate whatsoever" as a standing condition and widens every Rust phase's
  verification because of it. Once this plan lands, that reasoning is historical
  rather than current; add a dated note pointing at this plan. The per-phase
  `cargo clippy`/`cargo fmt` commands **stay** — they are still the right local
  practice and now match CI instead of substituting for it. **Phase 4.**
- **No file is added, renamed, moved, or removed by Phases 1–3** (they edit
  `deploy.yml`, `package.json`, `Cargo.toml`, and one line of `bubble-core`), so
  there are no stale-reference risks from this plan's own structure.

---

## Concurrency Map

```
Sequential spine:
  Phase 0 → 1 → 2 → 3 → 4
```

**All phases sequential.** Phases 1–3 each append to the *same* `rust` job in
`.github/workflows/deploy.yml`; a shared write-set entry forces sequential under the
hard rule, and the job does not exist until Phase 1 creates it. Phase 4 documents
what 1–3 established and cannot precede them.

**Shared-state contract applying to every phase:** all phases run in the main
worktree on one feature branch. None invokes `git checkout`, `git stash`, or
`git rebase` in the parent worktree; none binds a network port; none writes outside
the repo except `target/` (git-ignored). No phase is dispatched to a subagent, so no
re-entry verification is required.

**The one real concurrency hazard is not between phases — it is CI-side.** The
existing `concurrency: {group: pages, cancel-in-progress: true}` covers the whole
workflow, so adding a parallel `rust` job inherits that grouping: a newer push
cancels an in-flight Rust gate too. That is the correct behaviour (the newer commit
gets its own gate) and is called out so it is not later mistaken for flakiness.

---

## Phases

> **Execution note.** Commit at every green phase. Phases 1–3 each need a real CI
> run to be verifiable, so each phase's wiring test involves pushing a branch — this
> is the rare plan where "don't push unless asked" needs an explicit exception, and
> the owner should grant it for a scratch branch before Phase 1 starts.

### Phase 0: Discovery

**Goal:** Put numbers behind the two decisions that shape everything downstream —
the test gate's cost, and whether pedantic is adoptable.

**Discovery tasks:**

- [x] **D1: What does `cargo test --workspace` cost, and where does the time go?**
      — **LARGELY RESOLVED DURING PLANNING.** Measured: debug >20 min (killed),
      release **52.97s and green**; the debug cost is one binary
      (`bubble-solver`'s `committed_pack_seeds_are_winnable_spotcheck`, 15.95s in
      release), whose heavy siblings are already `#[ignore]`d. **Decision: gate in
      `--release`, add no `#[ignore]`s.** Recorded in Verified Assumptions.
  - **Remaining probe (narrow):** one **cold** `cargo test --workspace --release`
    (i.e. `cargo clean` first, or the first CI run on a cache miss) — the 52.97s
    figure was mostly-warm and CI pays the cold price whenever `Cargo.lock` moves.
  - **Success criteria:** A cold wall-clock number, to be compared against the
    `rust` job's observed CI time in Phase 2.
  - **Disposition:** `keep-as-fixture` — the numbers live in Verified Assumptions
    and justify Phase 2's profile choice in writing.

- [x] **D2: How big is `clippy::pedantic`, and what is it made of?** — **RESOLVED
      2026-08-04. ~190 warnings, and 81% of them are the cast family.**

  | lint | count |
  |---|---|
  | `cast_possible_truncation` | **132** |
  | `cast_possible_wrap` | 12 |
  | `cast_sign_loss` | 6 |
  | `cast_precision_loss` | 4 |
  | **cast family subtotal** | **154 / ~190 ≈ 81%** |
  | `missing_panics_doc` | 6 |
  | `naive_bytecount` | 5 |
  | `redundant_closure_for_method_calls` | 4 |
  | `many_single_char_names` | 4 |
  | `doc_markdown` | 4 |
  | `struct_excessive_bools` | 3 |
  | everything else | ~10 |

  This is the predicted conflict, confirmed with a number: adopting pedantic
  wholesale means **~154 `#[allow]` attributes on exactly the `usize`→`u32` casts
  `fun/CLAUDE.md` requires for `native == wasm`** — decorating the most
  determinism-critical code in the repo with suppressions.

  **Refinement to the approved decision (D2's real contribution):** "pedantic on new
  crates" should mean **pedantic minus the cast family**, expressed as a `[lints]`
  table rather than scattered attributes:

  ```toml
  [lints.clippy]
  pedantic = { level = "warn", priority = -1 }
  # The determinism discipline (fun/CLAUDE.md) *requires* usize->u32 narrowing at
  # RNG/hash boundaries so native == wasm. These four would fire on every one of
  # them; allowing them here beats 154 scattered #[allow]s on the code that most
  # needs to stay readable.
  cast_possible_truncation = "allow"
  cast_possible_wrap = "allow"
  cast_sign_loss = "allow"
  cast_precision_loss = "allow"
  ```

  That keeps the ~36 genuinely useful pedantic lints (`missing_panics_doc`,
  `doc_markdown`, `redundant_closure_for_method_calls`, `match_same_arms`,
  `items_after_statements`, …) and drops only the ones the project's own rules
  contradict. **Disposition:** `keep-as-fixture` — the block above is what Phase 3
  installs.

- [x] **D3: Does the CI toolchain action ship `clippy` and `rustfmt`?** —
      **RESOLVED BY CONSTRUCTION.** `dtolnay/rust-toolchain@stable`'s installed
      profile is not something this plan should depend on: the workflow specifies
      `components: clippy, rustfmt` explicitly. That is correct whether or not the
      defaults happen to include them, costs nothing, and documents the job's
      requirements at the point of use. **Disposition:** `throwaway`.

- [x] **D4: Documentation-reference sweep.** — **RESOLVED 2026-08-04.** Two files
      already document the exact commands as required practice, which materially
      shrinks Phase 4 (it becomes a cross-reference and honesty fix, not new
      instruction):
  - `README.md:228-232` — a **Build** section already listing
    `cargo test --workspace`, `cargo fmt --all --check`,
    `cargo clippy --workspace --all-targets`. *Note the `--all` on fmt; the CI job
    matches the documented command rather than inventing a variant.*
  - `docs/BUILDING-GAMES.md:261-263` — "Rust: `cargo test --workspace`, `fmt
    --check`, `clippy`. All green before shipping."
  - `CLAUDE.md:21` — the `clippy::pedantic` claim, the one that needs amending.
  - `TODO/drop4.md:9,13,24` — historical "clippy clean" records; true when written,
    not touched.

  So the practice was already written down in three places and enforced in none.
  Documentation Impact amended accordingly. **Disposition:** `throwaway`.

- [x] **D6 (unplanned, found while executing D4): CI has no pre-merge trigger at
      all.** `deploy.yml` is the repo's **only** workflow, and its triggers are
      `push: branches: [main]` + `workflow_dispatch`. There is no `pull_request`
      trigger, so today's `typecheck`/`lint`/`unit` steps run **only after code is
      already on `main`**. That is not a gate, it is a notification — and it means
      the Phase 1 wiring test as originally written (push a scratch branch, watch
      CI go red) **cannot work**, because a scratch-branch push triggers nothing.
      Consequences folded into Phase 1; see also the new open question.

**Outputs fed back into the plan:** Verified Assumptions gains D1's timings and
D2's histogram; the BLOCKING lint-level question is resolved; Phase 2's profile
choice is justified by D1 rather than guessed.

**Done when:** D1–D4 have recorded findings, and the lint-level question has a
number behind it.

**Read-set:** `.github/workflows/deploy.yml`, `Cargo.toml`, `package.json`,
`tools/build-wasm.sh`, `README.md`, `docs/`, `CLAUDE.md`.
**Write-set:** this plan file only (plus `target/`, git-ignored).
**Shared-state contract:** No shared mutable state beyond the plan file. The probes
are read-only apart from `target/`; verify `git status` is clean apart from the plan
at phase end.
**Risks:** D2's output is large enough to be tempting to skim. The histogram is the
deliverable, not the raw list — a count without a by-lint breakdown does not
actually answer the question.
**Validation:** Discovery Exemption applies (no TDD, no wiring test). Findings must
be concrete numbers, not "it seems manageable".

---

### Phase 1: The `rust` job — `fmt` + cache

**Goal:** A Rust job exists in CI, is cached, blocks deploy, and is **proven to
fail** on a real violation.

**Changes:**
- [ ] `.github/workflows/deploy.yml` — a new `rust` job: `checkout` →
      `dtolnay/rust-toolchain@stable` with `components: clippy, rustfmt` (D3) →
      `Swatinem/rust-cache@v2` → `cargo fmt --all --check` (matching the command
      `README.md:229` already documents, rather than inventing a variant).
- [ ] `.github/workflows/deploy.yml` — `deploy.needs` becomes `[build, rust]`, so a
      Rust failure blocks publication rather than merely annotating it.
- [ ] `.github/workflows/deploy.yml` — **a ref guard on the `deploy` job**
      (`if: github.ref == 'refs/heads/main'`). *Required by D6, and a latent-hazard
      fix in its own right: `workflow_dispatch` is currently runnable against any
      ref and would publish that ref to production. Since dispatch-on-a-branch is
      the only way to exercise CI on a non-`main` ref (D6), the wiring test below
      cannot be run safely without this guard.*

**Why `fmt` first:** it is measured clean (exit 0), so this phase proves the *job
wiring* — toolchain, cache, `needs` — with a check that cannot fail for reasons
unrelated to the wiring. Introducing the job and a cleanup in the same phase would
make a red run ambiguous.

**Call chain:** trigger → `rust` job → `cargo fmt --all --check` → exit code →
`deploy` gated on it.
**Wiring test (RED first, and the whole point of the phase).** D6 changed *how* this
runs, not what it proves: a scratch-branch **push triggers nothing**, so the run is
started deliberately with `gh workflow run deploy.yml --ref <scratch-branch>`.
1. On the scratch branch, commit a deliberately mis-formatted file.
2. Dispatch the workflow against that ref.
3. **Confirm red at the `cargo fmt --all --check` step specifically** — not at a
   compile error, not in the `build` job.
4. **Confirm the `deploy` job was skipped**, which proves both `needs:` and the ref
   guard. This is a separate assertion from "the gate went red" and is the one that
   actually protects production.
5. Revert the violation, dispatch again, confirm green.

A gate never observed failing is indistinguishable from a gate that is not wired,
which is why this is the phase's deliverable rather than a formality.
**Depends on:** Phase 0 (D3).
**Read-set:** `.github/workflows/deploy.yml`.
**Write-set:** `.github/workflows/deploy.yml`.
**Shared-state contract:** Edits the workflow that publishes the live site. The
`build` job and its steps are **not touched** this phase — if `build` changes, the
change was not additive. The scratch branch used for the wiring test must not be
`main`, since a red `main` blocks the real deploy.
**Risks:** (a) A missing `clippy`/`rustfmt` component fails the job for the wrong
reason — pre-empted by D3. (b) `deploy.needs` is easy to get half-right: verify the
*deploy job was actually skipped* on the red run, not just that the gate was red.
That is the property being bought, and it is a different assertion.
**Done when:**
1. **Behavioral:** A push with a formatting violation does not deploy; a clean push
   does.
2. **Verification:** One red CI run (on the deliberate violation, failing at the
   expected step, with `deploy` skipped) and one green run, both linked in the
   commit message.
**Validation:** Moderate. The two CI runs above — this cannot be validated locally,
because what is being tested is the workflow wiring, not the command.

---

### Phase 2: `cargo test --workspace` in the gate

**Goal:** Rust test failures stop being invisible.

**Changes:**
- [ ] `.github/workflows/deploy.yml` — add **`cargo test --workspace --release`** to
      the `rust` job, with a comment quoting D1's measured justification (debug
      >20 min vs release 52.97s; the gap is one search-heavy test binary).

**The profile is decided, not deferred (D1, resolved during planning).** `--release`
is not an optimization here, it is what makes the gate survivable: the same suite is
~25× faster and still green. No `#[ignore]` split is added — `bubble-solver`'s
genuinely heavy generators are already ignored, and ignoring the *spotcheck* would
remove the one test that proves the committed daily pack is still winnable, which is
a real Tier-1 property rather than a slow nuisance.

**Call chain:** push → `rust` job → `cargo test --workspace` → exit code → `deploy`.
**Wiring test (RED first):** on a scratch branch, break one assertion in a core
crate's test — pick one in a crate **outside `build:wasm`'s dependency closure**,
i.e. `crates/drop4-harness`, because that crate is currently not even compiled by
CI and is therefore the strongest possible proof the new gate reaches further than
the old one. Confirm red at the `cargo test` step with `deploy` skipped; revert;
confirm green.
**Depends on:** Phase 1.
**Read-set:** `Cargo.toml`, `tools/build-wasm.sh` (to confirm the closure claim).
**Write-set:** `.github/workflows/deploy.yml`.
**Shared-state contract:** Additive to the `rust` job only; `build` and `deploy`
untouched apart from Phase 1's `needs`.
**Risks:** (a) **Someone later "fixes" the gate by dropping `--release`**, not
knowing it is load-bearing, and the job silently goes from ~1 minute to >20. The
mitigation is the comment in the workflow quoting the measurement — this is the one
place in the plan where a code comment is genuinely the control. (b) CI cold-cache
wall clock: release compilation of 33 crates on a cache miss is the real cost, and
it is paid on every `Cargo.lock` change — which the checkers plan makes often.
Mitigated by Phase 1's cache landing first, and quantified by D1's remaining cold
measurement.
**Done when:**
1. **Behavioral:** A failing Rust test anywhere in the workspace — including in
   crates CI never previously compiled — blocks the deploy.
2. **Verification:** The red/green run pair above, plus the observed CI wall-clock
   for the `rust` job on **both** a cache hit and a cache miss, recorded in the
   commit message. One number does not characterize a cached job.
**Validation:** Moderate. The CI run pair + both recorded timings, compared against
D1's local figures.

---

### Phase 3: `cargo clippy` in the gate

**Goal:** Lints stop being advisory.

**Changes:**
- [ ] `crates/bubble-core/src/board.rs:325` — fix the single
      `clippy::needless_range_loop` warning (the only one in the workspace).
- [ ] `.github/workflows/deploy.yml` — add `cargo clippy --workspace --all-targets
      -- -D warnings` to the `rust` job.
- [ ] `Cargo.toml` and/or per-crate `[lints]` — **only** as resolved by the
      BLOCKING open question. If the answer is "pedantic on new crates", this is
      where the `[lints]` mechanism is established so the checkers crates can opt in.

**`--all-targets` is not optional.** The workspace's one existing warning is in a
**lib test**; a plain `cargo clippy` reports the workspace clean and would gate
nothing in test code — which is precisely where the fixture and soak code this repo
relies on lives.

**Call chain:** push → `rust` job → `cargo clippy … -D warnings` → exit → `deploy`.
**Wiring test (RED first):** two runs, because there are two claims. (a) Introduce a
default-level lint violation in **library** code, confirm red. (b) Introduce one in
**test** code, confirm red — this is the assertion that `--all-targets` is actually
doing something, and it is the one a copied-from-elsewhere clippy step would fail.
Revert both; confirm green.
**Depends on:** Phase 2, and the BLOCKING open question resolved.
**Read-set:** `crates/bubble-core/src/board.rs`.
**Write-set:** `.github/workflows/deploy.yml`, `crates/bubble-core/src/board.rs`,
`Cargo.toml` (conditional).
**Shared-state contract:** `bubble-core` is a shipped game's core — the fix must be
behaviour-preserving, verified by `cargo test -p bubble-core` before and after, not
by inspection. A clippy fix that changes iteration semantics in a board routine is a
real regression risk on a determinism-critical crate.
**Risks:** The `needless_range_loop` fix is in board-collapse logic; the naive
`enumerate()` rewrite clippy suggests is not always equivalent when the loop mutates
or reads a second slice. Prefer `#[allow]` with a `// SAFETY-of-intent` style
comment over a rewrite that is not obviously identical — a suppression with a reason
beats a subtle behaviour change.
**Done when:**
1. **Behavioral:** A clippy violation in library *or* test code blocks the deploy,
   and the workspace is clean at the gated level.
2. **Verification:** Both red/green run pairs above; `cargo test -p bubble-core`
   green before and after the fix.
**Validation:** Broad. The CI runs + the before/after `bubble-core` test comparison
+ read the actual diff of the `board.rs` fix against the surrounding logic.

---

### Phase 4: Reconcile the docs with what is enforced

**Goal:** `fun/CLAUDE.md` describes the gate that exists, not the one it wished for.

**Changes:**
- [ ] `fun/CLAUDE.md` § "Dev practices" — the Rust discipline bullet states the
      **enforced** lint level and where it is enforced; if the resolution was
      "pedantic on new crates only", say exactly that, with the `[lints]` mechanism
      named. The commit-checkpoint bullet gains the Rust commands.
- [ ] `package.json` — `"test"` gains the Rust half, so the local full gate and CI
      agree. *(If D1's timing makes that intolerable for the common case, add
      `test:rust` and have `test` call it, so there is still one obvious command —
      but do not leave `npm run test` silently Rust-free, which is the exact defect
      this plan exists to fix.)*
- [ ] `docs/BUILDING-GAMES.md` — the new-crate checklist names the Rust gate.
- [ ] `plans/2026-08-04-checkers-game.md` — a dated note that the "CI runs no Rust
      gate" condition its Pass 3 recorded is now closed by this plan; its per-phase
      `cargo` commands stay as local practice.

**Call chain:** n/a (documentation + one npm script).
**Wiring test:** `npm run test` must actually run the Rust half — verified by
temporarily breaking a Rust test and confirming `npm run test` goes red. The script
change is the one part of this phase that is code, and an unverified script edit is
how `npm run test` came to be Rust-free in the first place.
**Depends on:** Phase 3.
**Read-set:** all files in Documentation Impact.
**Write-set:** `CLAUDE.md`, `package.json`, `docs/BUILDING-GAMES.md`,
`plans/2026-08-04-checkers-game.md`.
**Shared-state contract:** `package.json`'s `test` script is the repo's front door;
changing it affects every contributor's habit. No other script is touched.
**Risks:** Rubber-stamping — writing "clippy::pedantic clean" again because it reads
well. Each claim in the amended bullet must correspond to a command that exists in
`deploy.yml`, checked line by line.
**Done when:**
1. **Behavioral:** A reader of `fun/CLAUDE.md` can name the exact commands that
   enforce each Rust claim, and `npm run test` fails on a broken Rust test.
2. **Verification:** The `npm run test` red/green pair; every amended claim traced
   to a `deploy.yml` line.
**Validation:** Narrow. The `npm run test` check + a read-through of the amended
bullet against the workflow file.

---

## Relationship to the checkers plan

`plans/2026-08-04-checkers-game.md` is unblocked by this plan but partially
**sequenced against** it:

```
  checkers Part A (1 → 2a → 2b → 2c → 3)      TypeScript only — unaffected
                                               ↓ can run before, during, or after
  THIS PLAN (0 → 1 → 2 → 3 → 4)               ← should complete here
                                               ↓
  checkers Part B (4 → 5 → 6 → 7 → 8 → 9 → 10)  first Rust phases
```

The argument for that ordering: checkers Phase 4 creates the first new Rust crate,
and Phases 7–8 migrate two shipped solvers with a named RNG-consumption risk. Those
are exactly the changes a Rust gate is for. Landing the gate first also means the
three new checkers crates are born under whatever `[lints]` policy the BLOCKING
question settles, rather than being retrofitted.

The argument against forcing it: this plan's Phases 1–3 each need a CI round-trip,
so it is calendar-bound in a way checkers Part A is not. If the owner wants checkers
moving immediately, **run checkers Part A and this plan's Phase 0 in either order** —
they share no files — and hold checkers Phase 4 until this plan's Phase 3 is green.

---

## Open Questions

- `[CONFIRMED: BLOCKING — RESOLVED 2026-08-04]` **What lint level does the gate
  enforce, and what does `fun/CLAUDE.md` say afterwards?**
  **Decision: gate `-D warnings` at default level workspace-wide; adopt
  `clippy::pedantic` per-crate via `[lints]` starting with the three new checkers
  crates; amend `fun/CLAUDE.md` to state exactly that.** D2 then refined *what
  "pedantic" means here*: **pedantic minus the cast family**, since 81% of the
  workspace's 190 pedantic warnings are `cast_possible_truncation` and friends
  firing on the very `usize`→`u32` narrowing the determinism rule mandates. The
  `[lints]` block is recorded in D2 and installed in Phase 3. *Original framing
  below, for the record.* Default clippy is one warning from clean;
  `clippy::pedantic` is unmeasured (D2) and structurally conflicts with the repo's
  own `usize`→`u32` determinism rule via `cast_possible_truncation`.
  **Recommendation: gate `-D warnings` at default level workspace-wide, adopt
  `clippy::pedantic` per-crate through `[lints]` starting with the three new
  checkers crates, and amend `fun/CLAUDE.md` to state exactly that.** *Rationale:
  it makes the mandate true for all new code at zero cleanup cost, avoids a 33-crate
  campaign whose main output would be `#[allow]` attributes on the most
  safety-critical casts in the repo, and replaces an aspirational claim with an
  enforced one. Blocking because Phase 3 cannot be written without it, and because
  the answer changes what the checkers crates are born with.*

- `[CONFIRMED: BLOCKING — RESOLVED 2026-08-04]` **Is a push-per-phase acceptable?**
  **Granted** for a single throwaway branch (`ci-rust-gate-probe`), deleted at
  Phase 4. D6 refined the mechanics: a scratch-branch push triggers **no** workflow
  under the current `on:` config, so each verification is `git push` **plus**
  `gh workflow run deploy.yml --ref ci-rust-gate-probe`, and the deploy job's new
  ref guard is what keeps that dispatch from publishing a scratch branch to
  production.

- ~~`[PHASE-GATED (Phase 2)]` **Does the test gate need a profile change or a
  slow-test split?**~~ **RESOLVED DURING PLANNING (D1).** Yes to the profile, no to
  the split: `cargo test --workspace --release` is 52.97s and green, versus >20
  minutes in debug, and the gap is a single search-heavy test binary whose heavy
  siblings are already `#[ignore]`d. No longer an open question.

- `[RECOMMENDED: ADVISORY — new, from D6]` **Should `deploy.yml` gain a
  `pull_request` trigger?** Today the repo's only workflow runs on push-to-`main`
  and manual dispatch, so **every** check — the existing `typecheck`/`lint`/`unit`
  as much as the new Rust job — runs only *after* code lands on `main`. The repo
  demonstrably uses branches (28 merge commits in the last 200; a dozen live
  `claude/*` remotes), so this is a real prevention gap, not a theoretical one.
  **Recommendation: yes, but as a follow-up, not folded into this plan.**
  *Rationale: it is the single highest-value change to this workflow — it converts
  four post-hoc notifications into pre-merge gates — but it changes when the
  **existing** `build` job runs (every PR, including the Pages steps, which need
  `if:` guards of their own to stay correct). That is a wider blast radius than
  "add a Rust gate" was approved for, and it deserves its own decision rather than
  arriving as a side effect. Phases 1–4 are unaffected either way: they work under
  the current triggers via `workflow_dispatch`.*

- `[RECOMMENDED: ADVISORY]` **Should the `rust` job also gate the wasm target?**
  `build:wasm` already compiles 11 crates for `wasm32-unknown-unknown`, so a
  host-target-only gate could in principle miss a wasm-specific breakage — though
  `build` would still catch a compile failure. **Recommendation: no.** *Rationale:
  the determinism claim that actually matters (`native == wasm`) is a property of
  the code's integer discipline, which host tests exercise; adding a second target
  doubles the gate's cost for a failure mode `build` already catches. Revisit only
  if a wasm-only breakage ever ships.*

---

## Review Log

### Pass 1 + Pass 2: Plan development and gap analysis — 2026-08-04

**Note on process:** Passes 1 and 2 were run together rather than separately,
because this plan's gap analysis is *empirical* — the questions Pass 2 would ask
("is the workspace actually clean? how expensive is this?") were answered by running
the commands during Pass 1, not by re-reading it later. The Verified Assumptions
section is measurement output, not inference. Pass 3 remains outstanding and should
be run with fresh eyes.

**Produced:** Problem statement grounded in four firsthand reads (`deploy.yml`,
`package.json`, `tools/build-wasm.sh`, `Cargo.toml`); reasoning covering the lint
level, the job topology, and the cache; 5 phases; Concurrency Map; four open
questions; an explicit sequencing relationship to the checkers plan.

**Key findings during development:**
- **`cargo fmt --check` is already clean and clippy has exactly one warning** across
  33 crates. The gate was assumed to imply a cleanup campaign; measurement says it
  is one line. This inverted the plan's shape — the expensive part is CI wiring and
  the pedantic decision, not remediation.
- **The one clippy warning is in a lib test**, so `--all-targets` is load-bearing:
  a plain `cargo clippy` would have reported clean and gated nothing in test code.
  A gate that passes on day one because it is looking at the wrong targets is the
  quiet failure mode here, which is why Phase 3's wiring test asserts on *both*
  library and test violations.
- **`clippy::pedantic` structurally conflicts with `fun/CLAUDE.md`'s own
  determinism rule.** Pedantic includes `cast_possible_truncation`; the same
  document requires `usize`→`u32` at RNG/hash boundaries. Adopting it wholesale
  would put the most `#[allow]` attributes on the most correctness-critical code.
  This is why the lint level is a BLOCKING question rather than a default.
- **CI has no cargo cache** — `cache: npm` is the only cache directive — so a Rust
  gate added naively compiles 33 crates from scratch on every push. The cache is in
  the same phase as the first check for that reason.
- **`crates/drop4-harness` is not compiled by CI at all** (no wasm crate depends on
  it). It is therefore the ideal subject for Phase 2's wiring test: breaking a test
  there proves the new gate reaches strictly further than the old coverage.
- A CI gate has no natural test-first home, so **"prove the gate bites" was adopted
  as the wiring test for every gate phase** — a deliberate violation, a red run for
  the expected reason with `deploy` confirmed skipped, then a revert.

**Concurrency:** All sequential — Phases 1–3 append to the same `rust` job, which is
a shared write-set entry. Recorded the CI-side hazard (`concurrency: pages` with
`cancel-in-progress` now also cancels in-flight Rust gates) as correct-but-worth-
naming, so it is not later mistaken for flakiness.

**D1 resolved during planning rather than deferred.** The `cargo test --workspace`
timing was initially left as a Phase 0 probe, then measured rather than guessed
because it is the input to a real decision. Findings:
- Debug exceeded **20 minutes** and was killed. The cost is not spread across 33
  crates — it is **one test binary**, `crates/bubble-solver/tests/solver.rs`, whose
  `committed_pack_seeds_are_winnable_spotcheck` runs three full `find_win` searches.
- The same three tests take **15.95s in release**; the full workspace takes
  **52.97s in release, and passes**.
- The crate's genuinely heavy work is **already** behind `#[ignore]`, so the
  temptation to "fix" this with more `#[ignore]`s is wrong — it would only remove
  the spotcheck, which is the test proving the committed daily pack is still
  winnable. That is a real Tier-1 property, not a slow nuisance.

**Decision: gate in `--release`, add no `#[ignore]`s.** This turned Phase 2 from a
phase with an unknown cost and a deferred design choice into a wiring exercise, and
closed one of the plan's four open questions before execution starts. Only a *cold*
release figure remains outstanding, folded back into a much narrower D1.

**Baseline recorded:** the workspace is **green today** — `cargo test --workspace
--release` exit 0, `cargo fmt --check` exit 0, `cargo clippy --workspace
--all-targets` one warning. Every gate in this plan is one line of remediation or
zero away from passing, which is the strongest argument for doing it now.

**Plan is ready for Pass 3** (quality gates: TDD ordering, observability, validation
calibration, documentation-impact coverage) — to be run in a fresh context.

### Execution — 2026-08-04 (Phases 0–4 complete)

**All four phases landed.** Final CI state: `rust` 1m59s in parallel with `build`
1m54s, so the gate costs **no added wall clock**. Every gate was verified by the
"prove it bites" wiring test — a deliberate violation, a red run at the *expected
step*, then a revert and a green run:

| phase | violation used | red at | green |
|---|---|---|---|
| 1 `fmt` | mis-formatted item in `adversary-core` | `cargo fmt --all --check`, 11s | 13s |
| 2 `test` | flipped assertion in **`drop4-harness`** — chosen because no wasm crate depends on it, so CI never compiled it before this gate existed | `cargo test --workspace --release`, 1m21s | 1m42s |
| 3 `clippy` | `len_zero` in **test** code | `cargo clippy … --all-targets`, 1m35s | 1m59s |
| 4 `npm run test` | flipped assertion in `drop4-harness` | the `test:rust` step | — |

**The finding that cost three round trips, and the fix.** Phases 1–2 went green
first try; Phase 3 then failed CI **three times** on code a local
`cargo clippy --workspace --all-targets -- -D warnings` reported clean — including
from a scrubbed `CARGO_TARGET_DIR`, which ruled out caching. Root cause:
**Homebrew's `cargo-clippy` shadows rustup's on PATH, and lags** — local was
**0.1.94**, CI **0.1.97**. Every "clean" local clippy run was the wrong clippy.
This is the same shadowing trap `tools/build-wasm.sh` already documents for
`rustc`, which is what eventually pointed at it.

Consequences, all landed:
- **`tools/rust-gate.sh`** (new) pins rustup's stable toolchain and runs the three
  CI commands; `npm run test:rust` calls it. Without this, `npm run test` would
  reliably pass locally and fail in CI — the script *is* the fix, not a convenience.
- The `rust` job **prints `rustc`/`clippy`/`rustfmt` versions every run**, so the
  next divergence is one glance instead of three round trips.
- With the matching toolchain the workspace had **four** real issues, not one:
  `bubble-core` `needless_range_loop`, `trio-tumble-core` ×2 and `bubble-solver`
  `unnecessary_sort_by`, and `bubble-solver` `manual_checked_ops`. All fixed.
  Both `sort_by` → `sort_by_key(Reverse(..))` rewrites are stable sorts over the
  same keys, so the equal-key ordering both call sites' comments rely on for
  determinism is unchanged — verified by `trio-tumble-core`'s full suite (145 tests,
  golden vectors included) staying green.

**Lesson worth keeping:** the plan predicted the *cost* question (profile) and the
*policy* question (pedantic) and got both right from measurement. It did not
predict that the local and CI toolchains were different programs. "Measure it"
was the right instinct; "measure it **with the same binary CI uses**" is the
sharper version.

**Follow-up landed the same day (2026-08-05): the toolchain is now pinned.**
`rust-toolchain.toml` (channel `1.97.1`, components `clippy`/`rustfmt`, target
`wasm32-unknown-unknown`) is the single source of truth; both CI jobs read the
channel out of it with `sed` rather than duplicating a version string, and
`tools/rust-gate.sh` + `tools/build-wasm.sh` resolve cargo with `rustup which`
**from the repo root** so the pin applies to them too (both previously said
`--toolchain stable`, which floated independently of CI). This closes the second
half of the divergence bug: pinning fixes the *version*, resolving through rustup
fixes the *PATH shadowing*. Rationale in the file itself — the workspace pins
every dependency exactly and commits `Cargo.lock`, so a floating compiler was
inconsistent with its own determinism discipline.

**Deviations from the plan as written:**
- **D6** (CI has no `pull_request` trigger — the workflow only runs post-merge to
  `main`) was discovered during D4 and reshaped Phase 1: a scratch-branch push
  triggers nothing, so every verification ran via
  `gh workflow run deploy.yml --ref ci-rust-gate-probe`. Phase 1 therefore also
  added the `deploy` ref guard, without which dispatching against a branch would
  publish that branch to production.
- Phase 3's two-part wiring test (library violation **and** test violation) was run
  as the **test-code** case only. That case is the strictly stronger assertion: it
  proves clippy runs *and* that `--all-targets` reaches test targets, whereas a
  library violation proves only the former. Recorded rather than quietly dropped.
- `README.md:228-232`'s Build section still lists the three bare `cargo` commands.
  Left as-is deliberately — they are correct as documentation of *what* runs; the
  toolchain caveat lives in `CLAUDE.md` and `docs/BUILDING-GAMES.md` where the
  gate is specified.
