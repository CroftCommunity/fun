# Games pond — stand up `fun.croft.ing` and the game shelf

**Status:** Pass 1+2+3 complete; all BLOCKING open questions resolved (D2/D3/D4). Ready for execution
pending the user's walk-through of the remaining PHASE-GATED / ADVISORY questions. Planning only — no
code written yet.
**Author cadence:** phase-plan skill. This doc is the single handoff artifact between passes and
between context windows.

---

## Problem Statement

Croft's Track B "games pond" (`fun.croft.ing`) is fully *designed* but *not built*. The one piece
that exists is a determinism spike — `discovery/alpha/experiments/match3-p1/`, a green (19-test),
headless, deterministic match-3 core built determinism-first, red-first, per the per-pond build
discipline (`beta/croft/build-order-and-ponds-roadmap.md` → "Per-pond build discipline").

The owner wants to promote that work out of a discovery experiment into a **real, standalone repo**
and stand up **`fun.croft.ing`** as a **game shelf** — a PWA that hosts multiple games and lets a
person pick one and play. The confirmed shelf order is **solitaire → match-3 → cribbage**.

Constraints and context that shape the build:
- **Track B is gated on the deep-link resolver** (roadmap Phase 0.2, ROADMAP_TODO E11) for *spread*,
  but not for *existence*: the pond can function on the manual join-code floor and, for single-player
  games, needs no network at all. So the resolver does not block standing up the shelf or the two
  single-player games. It *does* gate cribbage's discoverability.
- **Cribbage is categorically different from the other two.** Solitaire and match-3 are single-player;
  cribbage is a 2-player adversarial card game. It requires a *fair deal* (commit-reveal, the
  `fair-reveal-primitive-spec.md` primitive) and a *transport* (iroh / browser-native WebRTC per
  `beta/cairn/iroh-app-pond-building-blocks.md`, GGRS+matchbox). That is Track B network territory —
  scoped here as a gated later phase, not peer work with the single-player games.
- **CroftC convention:** content belongs in its own repo (`.claude/CLAUDE.md` → "Repo content belongs
  in its repo"). The games pond gets its own repo/history; nested repos are git-ignored by the
  CroftC meta-repo.
- **The per-pond build discipline is non-negotiable per game:** golden vectors + rules doc *before*
  engine, engine grown red-first, verifiable outcomes by move-list replay against a state hash,
  Rust→wasm for the free native+wasm cross-build determinism test.

Scope decision (owner, 2026-07-27): **full determinism-verified pond** — not just a shell. The
determinism discipline (cross-build test, P2 version policy, P3 par bands, P8 verifiable outcomes)
is in scope for this plan's spine, applied to the single-player games. Cribbage's P2P layer is the
one explicitly-gated exclusion.

---

## Reasoning

### Why a standalone repo (not extend croft-pwa)

`croft-pwa` is the Track A **atproto** standards + reference-impl meta-site (Bluesky OAuth, PDS
writes, sealed-box vault). The games pond is Track B: **local-first / iroh-P2P, no atproto account
dependency**. Coupling Track B games to the Track A atproto meta-site would drag account/OAuth
plumbing into games that must run for a stranger with no account. Owner confirmed: **new standalone
repo**, reusing croft-pwa's *engineering conventions* (bundle budget, a11y axe gate, telemetry,
PR-preview deploys) but not its atproto architecture.

### Why solitaire first (over the already-built match-3)

The corpus recommendation and the owner's own higher ranking both say solitaire first, for a reason
that survives scrutiny: **solitaire ships a *complete* game soonest.** It has no level-generation
phase (P4) — a shuffled deal from a seed *is* the content — so it is a four-phase build where match-3
is nine. Match-3's core being already-built is sunk value we keep (promote it in, bring it to shelf
parity), but "we already built its core" is not a reason to ship an *incomplete* game (a match-3
sandbox with no levels) ahead of a *complete* one. Match-3 already did its job: it proved the engine
discipline solitaire now inherits.

### Why the determinism discipline is a shared substrate, not per-game copy-paste

The three P-phases that recur across every game — **P2** (version-and-unknown-field document policy
for saves / codes / outcome records), **P8** (verifiable outcome = move-list replay → state hash),
and the **native+wasm cross-build determinism test** — are *identical machinery* across games. Built
once as shared crates (`pond-docformat`, `pond-outcome`, the cross-build test harness), every game's
core reuses them. This is why the workspace is a Cargo workspace with per-game core crates plus
shared substrate crates, not one crate per game in isolation. It is also what makes "full
determinism-verified pond" tractable: the expensive discipline is paid once.

### Why cribbage is gated, not deferred-for-no-reason

Cribbage is the first game that needs *two people who don't trust each other* to agree on a deal and
a score. That is the fair-reveal commit-reveal primitive plus a live transport — a whole substrate
(iroh/WebRTC signaling, connection lifecycle, disconnection handling) that does not exist yet and is
the roadmap's Track B growth spine. Pretending cribbage is peer work with solitaire would smuggle an
unbuilt network substrate into a plan that otherwise ships without one. It gets a gated later phase
with its dependencies named honestly.

### The maker is a tool, the game is a portable artifact (from the card-maker thread)

A principle carried over from the card-maker/packaging design
(`seeds/.../croft-card-maker-webxdc-packaging-and-push-2026-07-22.md`, filed) applies verbatim to the
games pond: **"the level maker is an internal hosted tool, the game is the portable artifact — the
tool is a page, the output is a file."** Three consequences for this plan:

- **The shelf is a page you arrive at; a game/level is a file.** `fun.croft.ing` is where you go to
  play (Phase 7); a match-3 level pack (Phase 8) and a solitaire deal are portable artifacts, not
  server state. This reinforces the local-first, resolver-independent posture.
- **Packaging ladder — pick the dumbest rung that works:** a plain URL (the floor, works for anyone),
  a single-file HTML build, and a `.xdc` only when it needs shared state across people (i.e. the
  future 2-player games, opened natively in Croft Chat with a URL as the floor for everyone else).
  Single-player solitaire/match-3 sit on the URL rung; cribbage (Phase 9) is the first that could earn
  `.xdc`.
- **Untrusted-renderer domain constraint (security):** if `fun.croft.ing` ever grows an "open a game a
  stranger packaged/sent you" endpoint, that endpoint runs untrusted code and **must not share a
  registrable domain with any estate session cookie** — either a separate registrable domain or a
  host-only session brokered by the kernel. A one-line config decision now, a migration later. Noted
  as a Phase 7 hosting constraint; not triggered by first-party games, but do not accidentally scope
  the shelf inside a cookie domain.

Notification path (same thread): **Web Push (one W3C standard, payload-encrypted), not Pushover.**
Irrelevant to the single-player games; relevant when cribbage (Phase 9) needs "your turn" — it uses
Web Push, gated on iOS Home-Screen install (which P6 already requires for persistent storage).

### Alternatives considered and rejected

- **Extend croft-pwa** — rejected: couples Track B to Track A atproto plumbing (see above).
- **Match-3 first** — rejected: ships an incomplete game ahead of a complete one (see above).
- **Shelf-agnostic, defer game choice** — rejected: owner wants a playable game, and a shelf with no
  game is not a demonstrable artifact.
- **Per-game duplicated determinism machinery** — rejected: P2/P8/cross-build test are identical
  across games; duplication would rot independently and defeat the compatibility-matrix sustainment.
- **TypeScript-with-integer-discipline core** — rejected at P1 for match-3 already (Rust→wasm chosen
  for the free cross-build determinism test); solitaire inherits that decision for consistency and to
  reuse the shared substrate crates.

---

## Verified Assumptions

Confirmed firsthand this session (2026-07-27):

- **`match3-core` is green and promotable.** `cargo test` → `19 passed, 1 ignored` (4 suites). Public
  surface (`crates/match3-core/src/lib.rs:12-16`): `Board`, `Cell`, `Game`, `MoveReport`, `StepReport`,
  `Pos`, `state_hash` (via `hash` module), plus `find_matches`/`clear_cells`/`apply_gravity`/`refill`/
  `swap_legal`. Move-list replay + state hash already exist — P8's primitive is present, not net-new.
- **State-hash contract is specified** (`experiments/match3-p1/RULES.md:104-117`): SHA-256 over a
  canonical `"m3\x00" || dims || draws || score || cells` encoding. `(seed, initial board, moves)`
  fully determines every state.
- **Workspace pins exactly** (`experiments/match3-p1/Cargo.toml`): `rand =0.8.6`, `rand_chacha =0.3.1`,
  `serde =1.0.228`, `serde_json =1.0.145`, `sha2 =0.10.9`, `hex =0.4.3`, `thiserror =2.0.18`,
  `Cargo.lock` committed. Matches `alpha/Proofs/lineage-groups` (dependency minimalism, P10 posture).
- **`wasm32-unknown-unknown` rustup target is installed.** `wasm-pack`/`wasm-bindgen`/`wasmtime`/
  `wasmer` are **not** installed; **`node v25.9.0`** is present; no WASI target installed. → the cheap
  cross-build path is a node-hosted `wasm32-unknown-unknown` module, but the exact runner is a Phase 0
  discovery item (see D1).
- **Referenced specs exist in-corpus:** `alpha/thinking/app/ponds/fair-reveal-primitive-spec.md` and
  `beta/cairn/iroh-app-pond-building-blocks.md` (GGRS+matchbox) — the cribbage substrate references.
- **Repo confirmed: `CroftCommunity/fun`** (GitHub org `CroftCommunity`, repo `fun`, matching
  `fun.croft.ing`); local checkout `CroftC/fun`. No `fun/` dir exists under `CroftC/` yet (clean
  create). `gh` shows the `chasemp` account authed with `repo`+`read:org`; Phase 1 runs
  `gh auth switch --user chasemp` and confirms push access to the `CroftCommunity` org.

Unverified — needs Phase 0 or owner input (do **not** plan hard logic on these until resolved):

- ~~Which solitaire variant~~ **RESOLVED: Klondike draw-1** (owner, 2026-07-27). Sub-detail still to
  pin in Phase 4 against a canonical source, not assumed: pass/redeal limit through the stock (draw-1
  is commonly unlimited passes) and whether scoring is tracked at all.
- The definitions of game-phases **P5, P7, P9** — **RESOLVED 2026-07-27 (owner):** the fuller P1–P9
  write-up is **not recoverable**. The source raw
  (`...games-pond-roadmap-browser-p2p-phased-build-2026-07-22.md:15-19`) is only the P1–P10 *tail*, and
  the material the owner still had turned out to be the adjacent card-maker/packaging/push thread
  (`seeds/.../croft-card-maker-webxdc-packaging-and-push-2026-07-22.md`, already filed), not the phase
  list. **Ruling: proceed; treat P5/P7/P9 as OPEN, to be designed fresh when reached — openly, as new
  design, never reconstructed-and-labelled-as-recovered.** Faithfully definable from corpus today:
  **P1** (determinism), **P2** (version/unknown-field policy), **P3** (bot report contract → par
  bands), **P4** (level generation), **P6** (saves + browser-storage durability; Home-Screen install
  for persistent storage), **P8** (score verification), **P10** (sustainment). The Phase 0–8 spine
  depends on none of P5/P7/P9.
- Solitaire's analogue of "par" (winnable-deal classification / minimum-move solver) — whether P3's
  bot-harness shape applies to solitaire or only to match-3.
- ~~Hosting target~~ **RESOLVED: GitHub Pages** (owner, 2026-07-27), matching every live Croft pad
  (arecipe / skylite / pdsview / greetings on `*.croft.ing`). **DNS residual RESOLVED 2026-07-28:
  `fun.croft.ing` domain added and GitHub Pages is active.** Phase 7 go-live is unblocked.
- The exact serialization envelope shape for P2 (owner may have a house convention).

---

## Documentation Impact

Every doc touched, and the phase that owns the change:

- **`fun/README.md`** (NEW) — repo purpose, shelf concept, build discipline pointer, run/deploy
  instructions. Phase 1.
- **`fun/plans/2026-07-27-games-pond-fun-crofting.md`** (NEW) — this plan copied in as the
  repo's founding plan doc once the repo exists. Phase 1. (Authored in `discovery/alpha/plans/` now
  because the repo doesn't exist yet; discovery is the workspace planning home.)
- **`fun/GAMES.md`** or per-game `RULES.md` (NEW) — the rules-doc-first deliverable per game.
  Solitaire: Phase 4. (Match-3's `RULES.md` travels in with its crate: Phase 3.)
- **`discovery/alpha/experiments/match3-p1/`** — gains a **tombstone/pointer** note that the core was
  promoted to `CroftCommunity/fun`; the experiment is archived or left as the provenance record.
  **Phase 1** (moved from Phase 3 in Pass 3 — a discovery-repo edit must be sequential, not inside the
  parallel {3,4} set; decide archive-vs-keep here, record in the Review Log).
- **`discovery/beta/croft/build-order-and-ponds-roadmap.md:252`** — the match-3 catalog row: **Phase 1**
  sets "promoted to CroftCommunity/fun"; **Phase 7** appends "solitaire leading the shelf (live)" once
  the shelf ships. (Both are discovery-repo edits → both sequential; moved off the parallel {3,4} set.)
- **`discovery/alpha/ROADMAP_TODO.md` E46** — status transitions at **sequential checkpoints only**:
  Phase 1 (repo created + match-3 promoted), Phase 2 (cross-build green), Phase 7 (shelf + solitaire
  live). **Not** inside the parallel {3,4} phases (shared discovery tree). The phase that makes the
  reference stale owns the edit.
- **`discovery/alpha/thinking/app/prds/games-pond.md`** — currently a stub (S5); promote from
  "candidate" toward "building" and record the confirmed shelf order + the standalone-repo decision.
  Phase 7 (when the shelf goes live).
- **`discovery/alpha/experiments/README.md:114-122`** — the match3-p1 entry updates to a promotion
  pointer. **Phase 1** (moved from Phase 3 in Pass 3 — discovery-repo edit, sequential).
- Grep performed: `grep -rn match3-p1` across `discovery/` before Phase 3 to catch every stale path
  reference (the experiment path is cited in ROADMAP_TODO, build-order roadmap, experiments/README,
  RULES.md, and this plan). Recorded here so no reference is missed at promotion.

---

## Concurrency Map

```
Sequential spine:
  Phase 0 (Discovery)
    → Phase 1 (repo + workspace scaffold; promote match3-core)
      → Phase 2 (native+wasm cross-build determinism test)
        → [ Phase 3 (match-3 shelf-parity)  ||  Phase 4 (solitaire P1 core) ]
          → Phase 5 (P2 version policy — shared substrate crate)
            → Phase 6 (P8 verifiable-outcome record — shared substrate crate)
              → Phase 7 (shelf shell + solitaire playable, deploy fun.croft.ing)
                → Phase 8 (match-3 P3 par bands + P4 level pack)
  Gated later plan:  Phase 9 (cribbage: fair-reveal + P2P transport)
```

**Parallel set {Phase 3, Phase 4}:**
- **Disjoint write-sets:** Phase 3 writes only `crates/match3-wasm/**` + `crates/match3-core/RULES.md`
  (status line). Phase 4 writes `crates/solitaire-core/**` + `crates/solitaire-wasm/**` +
  `games/solitaire/**` + the solitaire vectors appended to `tests/cross_build/**`. No file overlap:
  Phase 3's roundtrip test is crate-local (`crates/match3-wasm/tests/`), so it does not touch the
  shared workspace `tests/` dir that Phase 4 edits.
- **Shared-state contract (invariants, not mechanisms):** Both run in isolated git worktrees off the
  `fun` feature branch (`worktrees/fun/<name>` per CroftC convention). Invariants each phase upholds:
  (a) does **not** invoke `git checkout`/`stash`/`rebase` in the parent worktree; (b) does **not** edit
  the **discovery repo** — *all* discovery-repo pointer edits were lifted into Phase 1 (sequential),
  because the discovery working tree is shared and lies outside the `fun` worktree isolation, so two
  parallel agents writing it would collide; (c) does **not** edit workspace `Cargo.toml` (its `members`
  list was frozen in Phase 1 by creating every member as a compiling empty-but-real crate); (d) builds
  to a per-worktree `target/`, binds no port, starts no daemon.
- **Re-entry verification (one-to-one with the invariants):** After each parallel phase returns —
  (a) parent-repo HEAD == pre-dispatch SHA; (b) **`git -C discovery status` clean** (no discovery file
  touched); (c) workspace `Cargo.toml` byte-unchanged since Phase 1; (d) `git worktree list` shows only
  the expected worktrees and `git status` clean in the parent; no orphan `claude-*` / `cargo` processes.

Everything else is sequential: Phase 2 needs Phase 1's workspace; Phases 5/6 are shared substrate the
games consume (they come after at least one game core exists to exercise them); Phase 7 needs the
games + substrate; Phase 8 needs match-3 in the shelf; Phase 9 needs a transport substrate that
doesn't exist yet.

**Hard rule honored:** the two cross-phase shared writes — workspace `Cargo.toml` `members` and the
shared **discovery working tree** — are both lifted into sequential Phase 1, so {3,4} have genuinely
disjoint write-sets and touch no shared ambient state before they run in parallel.

---

## Phases

### Phase 0: Discovery

**Goal:** Resolve the unknowns that could invalidate later phases before committing to them. Cheap
insurance — a day of probes over days of rework.

**Status (Pass 3):** D2 (Klondike draw-1), D3 (P5/P7/P9 open), and D4 (GitHub Pages host) were resolved
during planning — see Verified Assumptions / Open Questions; **do not re-run them.** The only live
technical discovery task is **D1** (the wasm cross-build runner). Residuals: D4's `fun.croft.ing`
DNS/registration (needed at Phase 7, not now) and the optional D5 feel-spike. D1 is resolvable with a
cheap probe (`cargo build --target wasm32-unknown-unknown -p match3-core` + a node loader attempt) and
should be the first thing done at execution start.

- [ ] **D1: What is the cheapest native+wasm cross-build determinism runner available here?**
  - **Probe:** Build `match3-core`'s corpus-replay to `wasm32-unknown-unknown` and attempt to run it
    under node (v25.9) via a thin loader; compare the emitted final `state_hash` per vector to the
    native `cargo test` hashes. If `unknown-unknown` needs too much glue, evaluate installing a WASI
    target + a runtime (wasmtime) as the alternative. Record which path produces byte-identical hashes
    with the least tooling.
  - **Success criteria:** A concrete runner choice (target + host) that reproduces all committed
    vector hashes from a wasm build, matching native, on this machine — with the command captured.
  - **Disposition:** `keep-as-fixture` — the loader/harness becomes Phase 2's test infrastructure.
- [ ] **D2: Which solitaire, exactly?**
  - **Probe:** Owner decision + confirm against a canonical rules source: Klondike draw-1 or draw-3;
    redeal/pass limit; scoring model (or none). Not code — a rules confirmation.
  - **Success criteria:** A written, unambiguous rules statement sufficient to author `RULES.md` +
    tie-break tables in Phase 4 (deal order, legal-move predicate, win condition, state-hash fields).
  - **Disposition:** `keep-as-fixture` — becomes the Phase 4 rules doc seed.
- [ ] **D3: Do P5, P7, P9 have owner-defined meanings?**
  - **Probe:** Ask the owner for the fuller P1–P9 write-up that predates the pasted tail (the raw
    invites folding it in). Record definitions or confirm they are open.
  - **Success criteria:** Either concrete P5/P7/P9 definitions folded into this plan's phase set, or an
    explicit "these are open, plan only around P1/P2/P3/P4/P8/P10" ruling. **No fabrication either way.**
  - **Disposition:** `throwaway` (pure knowledge; updates the plan).
- [ ] **D4: What hosts `fun.croft.ing`?**
  - **Probe:** Confirm the deploy target — GitHub Pages (matches the live Track A pads: arecipe,
    skylite, pdsview, greetings) or Vercel/other — and the DNS/registration status of `fun.croft.ing`.
  - **Success criteria:** A named host + a confirmed (or to-be-registered) domain, enough to scaffold
    CI/deploy in Phase 1 and wire the deploy in Phase 7.
  - **Disposition:** `throwaway`.
- [ ] **D5: Optional throwaway feel-spike (solitaire).**
  - **Probe:** One afternoon, no tests, no architecture — a grid/pile you can drag cards on to check
    the solitaire interaction feels good before committing UI decisions in Phase 7. Explicitly the
    run-brief's feel-spike, run *after* rather than before since P1 discipline is already proven.
  - **Success criteria:** A yes/no "the interaction feels right" + any UI notes captured in the plan.
  - **Disposition:** `throwaway` — **delete after.** Do not let it accrete tests or become the real UI.

**Done when:** D1–D4 resolved with firsthand evidence; D3 has either definitions or an explicit open
ruling; Verified Assumptions updated; any phase whose assumption a probe invalidated is adjusted here
(Phase 0 is the only phase allowed to restructure later phases). D5 is optional and gates nothing.

**Discovery Exemption applies** (see phase-plan/execute.md): D-tasks are exempt from TDD/wiring/commit
rules; each honors its declared Disposition; findings are recorded in this doc.

---

### Phase 1: Standalone repo + Cargo/PWA workspace scaffold; promote match3-core

**Goal:** `CroftC/fun` exists as its own git repo (remote `CroftCommunity/fun`) with a working Cargo
workspace (game-core crates + shared substrate crate stubs registered as members) and a PWA app
skeleton, CI wired, croft-pwa conventions borrowed, and `match3-core` moved in intact and still green.

**Changes:**
- [ ] `git init` a new repo at `CroftC/fun` with the **chasemp** identity (`gh auth switch --user
  chasemp` first; `chase@owasp.org`), remote `git@github-personal:CroftCommunity/fun`. Confirm chasemp
  has push access to the `CroftCommunity` org before the first push. Do **not** add it to the CroftC
  meta-repo (nested repos are git-ignored by design).
- [ ] Cargo workspace `Cargo.toml` with `members`: `crates/match3-core`, `crates/solitaire-core`,
  `crates/pond-docformat`, `crates/pond-outcome`, plus a `crates/*-wasm` glue crate per game. **Create
  every member dir in this phase** with a minimal compiling `lib.rs` (no stubs of *behavior* — a crate
  that compiles and has a `//! purpose` doc and zero public API is not a behavioral stub; it is an
  empty-but-real member). This freezes the `members` list before the {3,4} parallel set.
- [ ] Move `discovery/alpha/experiments/match3-p1/crates/match3-core` → `fun/crates/match3-core`
  with its `RULES.md`, `vectors/`, tests, and pinned deps. Confirm `cargo test` stays green post-move.
- [ ] PWA app skeleton (`app/` or `web/`) borrowing croft-pwa conventions: bundle-size budget,
  `@axe-core/playwright` a11y gate, telemetry hook, and a **GitHub Pages** PR-preview + deploy config
  (D4-confirmed; static build to `gh-pages`, matching the live `*.croft.ing` pads).
- [ ] CI: `cargo test` + `cargo fmt --check` + `cargo clippy --all-targets` + the web lint/build +
  a11y gate. GitHub Pages deploy job stubbed (wired live to `fun.croft.ing` in Phase 7 — domain + Pages
  are active as of 2026-07-28, so go-live is unblocked).
- [ ] `README.md` (repo purpose, shelf concept, discipline pointer) + copy this plan into
  `fun/plans/`.
- [ ] **All discovery-repo promotion edits, here and atomic with the move (NOT in the parallel Phase
  3/4 — they share the discovery working tree):** the `match3-p1` tombstone/pointer, the
  `experiments/README.md:114-122` entry, the build-order roadmap row
  (`build-order-and-ponds-roadmap.md:252` → "promoted to CroftCommunity/fun"), and ROADMAP_TODO E46
  ("repo created"). Decide and record archive-vs-keep of `experiments/match3-p1/` here.

**Call chain:** N/A (scaffold). The wiring proof is that the *workspace* builds and the promoted
crate's existing tests pass unchanged from their new home.
**Wiring test:** `cargo test --workspace` green from `fun/` (all promoted match-3 tests pass at
the new path) **and** the web skeleton `build` command exits 0 in CI. RED before the move/scaffold,
GREEN after.
**Depends on:** Phase 0 (D4 host for CI/deploy config).
**Read-set:** `discovery/alpha/experiments/match3-p1/**` (source of the move), croft-pwa config files
(read for convention reuse — not edited).
**Write-set:** the entire new `fun/**` tree; **and all discovery-repo promotion edits** — the
`match3-p1` tombstone, `experiments/README.md`, `build-order-and-ponds-roadmap.md:252`, and
ROADMAP_TODO E46. These are done here (not Phase 3) so the discovery working tree is only ever written
sequentially, never by a parallel worktree phase.
**Shared-state contract:** Creates a new git repo (new HEAD, isolated from CroftC and discovery repos).
Does not `git checkout`/`rebase` in CroftC or discovery. No ports, no daemons. The `git mv`-equivalent
is a filesystem move + `git add` in the new repo and a `git rm` in discovery — two separate repos, two
separate commits.
**Risks:** The match-3 move breaks a relative path in a test or in `RULES.md` cross-references. Mitigate
by grepping `match3-p1` first (Documentation Impact) and running the wiring test immediately post-move.
CroftC `.gitignore` must already ignore `fun/` (nested-repo rule) — verify it does, add if not.
**Done when:**
1. **Behavioral:** From a clean checkout of the new repo, `cargo test --workspace` is green and the web
   skeleton builds — a contributor can clone `CroftCommunity/fun` and get a working build with match-3's
   core intact, with no dependency on the discovery repo.
2. **Verification:** `cd fun && cargo test --workspace && <web build cmd>` exits 0; `git -C
   fun log` shows the founding commit; `git -C discovery status` clean after the removal commit.
**Validation:** **Moderate.** Wiring test + confirm the promoted vectors still hash-match (regression),
+ manually clone-and-build from scratch to prove repo self-containment.

---

### Phase 2: Native+wasm cross-build determinism test

**Goal:** The property that justified choosing Rust is now *enforced*: `match3-core`'s corpus replays
to byte-identical `state_hash` values on a wasm build and on native, checked in CI. This becomes the
reusable template every game core plugs into.

**Changes:**
- [ ] A `crates/match3-wasm` (or a `--target wasm32-*` build of a small replay binary, per D1) that
  exposes "replay this vector, return its final `state_hash`".
- [ ] A test harness (the D1 runner: node-hosted wasm or wasmtime) that, for every vector in
  `match3-core/vectors/`, runs the wasm build and asserts the hash equals the committed
  `final_state_hash` **and** equals the native replay's hash.
- [ ] CI job runs the cross-build test on every push.
- [ ] **Divergence diagnostics:** on any mismatch the harness emits the vector id, the native hash, the
  wasm hash, and — where the per-step trace is available — the first cascade step whose state differs.
  A bare "hashes differ" is undebuggable for a determinism failure. **Logging lives in the harness, never
  in the hashed state path** — a log line must not be able to change `state_hash`.

**Call chain:** `cargo test cross_build` (native harness) → spawns/loads the wasm replay build →
replays each vector → compares hashes to native `Game` replay and to committed anchors.
**Wiring test:** `test_wasm_hashes_match_native` iterates the committed corpus and fails if *any*
vector's wasm hash diverges from native. RED with a deliberately mismatched build flag (prove it can
fail), GREEN with the real build.
**Depends on:** Phase 0 (D1 runner), Phase 1 (workspace).
**Read-set:** `crates/match3-core/**`, `crates/match3-core/vectors/**`.
**Write-set:** `crates/match3-wasm/**`, `tests/cross_build/**`, CI config.
**Shared-state contract:** Builds to a wasm target dir; runs a node/wasm subprocess bound to no port,
reading only the repo's vectors. No shared mutable state beyond the file write-set.
**Risks:** float/`usize`/endianness divergence between targets surfaces here — that is the *point* (it
is a real determinism bug to fix, not a test to relax). If node can't cleanly host
`wasm32-unknown-unknown`, D1's fallback (WASI + runtime) is used; do not weaken the assertion to make
it pass.
**Done when:**
1. **Behavioral:** Running the cross-build test proves every committed match-3 vector produces the
   identical state hash on wasm and native; a determinism regression on either target fails CI.
2. **Verification:** `cargo test cross_build -- --nocapture` (or the D1 command) exits 0 and prints per-
   vector hash equality; a deliberately perturbed build makes it fail (proving the test bites).
**Validation:** **Broad.** Wiring test + run on both targets + confirm CI executes it + verify the
failure path (perturb, see red, revert).

---

### Phase 3: Match-3 shelf-parity crate hygiene  *(parallel with Phase 4)*

**Goal:** Match-3's promoted core is finished as a shelf-ready *library* — its wasm glue, outcome hook,
and doc pointers are in place — without yet building its full game (levels/par are Phase 8). Leaves
match-3 as a clean, cross-build-verified core the shelf can later mount.

**Changes:**
- [ ] Finalize `crates/match3-wasm` public surface for the shelf (new-game(seed), play_move, current
  state hash, serialize/deserialize a save — the last deferred to Phase 5's format).
- [ ] Update the promoted `crates/match3-core/RULES.md` status line (a `fun`-repo edit, safe inside the
  worktree). **All *discovery-repo* pointer edits (build-order roadmap row, `experiments/README`,
  ROADMAP_TODO E46) and the archive-vs-keep decision were moved to Phase 1** — they touch the shared
  discovery working tree, which lies outside the `fun` worktree's isolation, so they must not run inside
  a parallel worktree phase (Pass 3 concurrency fix).
- [ ] Put the roundtrip test in `crates/match3-wasm/tests/` (crate-local), not the workspace `tests/`
  dir, so it cannot collide with Phase 4's edits to the shared cross-build harness.

**Call chain:** shelf loader (Phase 7) → `match3-wasm::new_game(seed)` → `Game` → `state_hash`.
**Wiring test:** `test_match3_wasm_surface_roundtrips` — construct a game, play the golden-vector move
list through the wasm surface, assert the final hash matches the committed anchor (proves the *shelf-
facing API*, not just the internal engine, reaches the right state).
**Depends on:** Phase 2 (cross-build test + wasm crate exist).
**Read-set:** `crates/match3-core/**`, `crates/match3-wasm/**`.
**Write-set:** `crates/match3-wasm/**` and `crates/match3-core/RULES.md` (status line only). **No
discovery-repo files** (lifted to Phase 1); does not touch the shared workspace `tests/` dir.
**Shared-state contract:** Worktree-isolated; touches only the two `fun`-repo paths above. Does **not**
edit the **discovery repo** (its working tree is shared and outside this worktree's isolation), does
**not** edit workspace `Cargo.toml` (frozen in Phase 1), and does **not** touch `tests/cross_build/**`
(Phase 4 owns the harness edit). No git ops in the parent worktree; no ports/daemons.
**Re-entry verification:** parent-repo HEAD == pre-dispatch SHA; `Cargo.toml` `members` unchanged;
`git status` clean in the parent worktree; **`git -C discovery status` clean** (this phase touched no
discovery file); worktree list as expected; no orphan `cargo` processes.
**Risks:** Scope creep into level/par work (that is Phase 8) — resist; this phase is library hygiene.
**Done when:**
1. **Behavioral:** The shelf-facing wasm API can start a match-3 game, accept moves, and report a
   verifiable state hash — enough for Phase 7 to mount it, with no level system yet.
2. **Verification:** `cargo test -p match3-wasm` green including the roundtrip wiring test.
**Validation:** **Moderate.** Wiring test + confirm the public surface is what Phase 7 needs (review
against the shelf loader contract sketched in Phase 7).

---

### Phase 4: Solitaire P1 — the determinism foundation  *(parallel with Phase 3)*

**Goal:** Solitaire's determinism foundation, mirroring the match-3 P1 discipline exactly: `RULES.md`
+ tie-break/ordering tables **first**, a golden-vector corpus, then `solitaire-core` grown red-first,
with a `state_hash` and the cross-build test (reusing Phase 2's harness). No UI yet.

**Changes:**
- [ ] `games/solitaire/RULES.md` — **Klondike draw-1** (D2-confirmed): 28-card tableau deal into 7
    piles (1..7, last card of each face-up), 4 foundations, draw-1 waste, standard build rules
    (alternating-colour descending on tableau, same-suit ascending on foundations). Pin the residual
    sub-details against a canonical source, do **not** assume: stock pass/redeal limit and whether a
    score is tracked. Then: deal order from seed (the RNG/shuffle is
  the determinism primitive, analogous to match-3's refill stream), the legal-move predicate, the win
  condition, and the canonical `state_hash` field layout.
- [ ] `games/solitaire/vectors/*.json` — hand-authored `(seed, deal, move list)` + hand-computed
  step-0 expectations + recorded `final_state_hash` anchors (locked once green). Schema mirrors
  match-3's `vectors/README.md`.
- [ ] `crates/solitaire-core` — board/pile model, seeded shuffle (same ChaCha20 primitive, pinned
  deps), move engine, win detection, `state_hash`, grown red-first against the tie-break unit tests
  and the corpus.
- [ ] `crates/solitaire-core/tests/tie_breaks.rs` — RNG-free per-rule unit tests that name the *edges*
  (mirroring match-3's 16-test file), never single happy-path points, so a one-line mutation to the
  legal-move predicate fails a test: King-only onto an empty tableau column (reject non-King);
  foundations build same-suit ascending A→K (reject wrong-suit / non-sequential); tableau builds
  alternating-colour descending (reject same-colour / non-sequential); a move of or onto a face-down
  card is illegal; draw-1 waste cycling and the stock pass-limit boundary; win iff all 52 cards are on
  the foundations. Boundary cases on each threshold.
- [ ] `crates/solitaire-wasm` glue mirroring `match3-wasm`.
- [ ] Solitaire wired into Phase 2's cross-build harness (its vectors added to the byte-identical
  wasm==native assertion).

**Call chain:** `cargo test` (tie-break units + corpus replay) drives the engine red-first; later
shelf loader (Phase 7) → `solitaire-wasm::new_game(seed)` → `Game` → `state_hash`.
**Wiring test:** `test_solitaire_corpus_replays_to_locked_hashes` (corpus replay determinism +
regression) **and** solitaire added to `test_wasm_hashes_match_native` — the same cross-build assertion
match-3 gets. RED before the engine exists, GREEN when the tie-break tables are fully implemented.
**Depends on:** Phase 0 (D2 rules), Phase 2 (cross-build harness).
**Read-set:** `crates/match3-core/**` (as the discipline template — read, not edited), Phase 2 harness.
**Write-set:** `crates/solitaire-core/**`, `crates/solitaire-wasm/**`, `games/solitaire/RULES.md`,
`games/solitaire/vectors/**`.
**Shared-state contract:** Worktree-isolated; disjoint from Phase 3's write-set. Does **not** edit
workspace `Cargo.toml` (frozen Phase 1). No git ops in parent worktree; no ports/daemons; per-worktree
`target/`.
**Re-entry verification:** parent HEAD unchanged; `Cargo.toml` `members` unchanged; parent `git status`
clean; worktree list as expected; no orphan `cargo` processes.
**Risks:** Rules ambiguity (D2 not tight enough) surfaces as un-authorable tie-breaks — if so, stop and
resolve D2 before implementing, do not guess. Solitaire's shuffle must consume RNG in a fixed,
documented order or cross-build determinism breaks (same failure class as match-3 refill order).
**Done when:**
1. **Behavioral:** A `(seed, move list)` replays to an identical, locked `state_hash` on native and
   wasm; the rules doc + tie-break tables + golden vectors are the primary artifact, engine second —
   solitaire has a verifiable-outcome core exactly as match-3 does.
2. **Verification:** `cargo test -p solitaire-core` (tie-break units + corpus) green; solitaire vectors
   pass `test_wasm_hashes_match_native`.
**Validation:** **Broad.** Wiring test + cross-build test + hand-verify at least one vector's step-0
expectations against the rules doc by inspection (the golden-vector discipline).

---

### Phase 5: P2 — version-and-unknown-field document policy (shared substrate)

**Goal:** The `pond-docformat` crate: one versioned, forward/unknown-field-tolerant serialization
envelope governing **all three durable document types** — saves, deal/level/share codes, and outcome
records — with a per-version fixture (the P10 compatibility-matrix seed). Built once, consumed by
every game.

**Changes:**
- [ ] `crates/pond-docformat` — a versioned envelope (`{ kind, version, payload }` shape TBD by owner
  convention, D-adjacent) that: tags each document with `kind`+`version`; deserializes tolerantly
  (unknown fields preserved or explicitly rejected per a documented policy, not silently dropped);
  refuses to load a *newer major* it can't understand with a loud, typed error (fail-loud).
- [ ] A fixture per (kind, version) checked in — the forever-fixture the P10 drill exercises.
- [ ] Wire `match3-core` and `solitaire-core` saves/outcomes to go through the envelope.

**Call chain:** game save/load and outcome emit → `pond-docformat::{write,read}` → typed round-trip.
**Wiring test:** `test_old_fixture_loads_under_current_and_unknown_field_policy_holds` — load every
committed fixture with the current code and assert the documented unknown-field behavior; assert a
synthetic newer-major fixture is rejected with the loud typed error. RED before the crate, GREEN after,
and it exercises the crate through the *games'* save path, not the crate in isolation.
**Depends on:** Phase 4 (at least one game core with a save/outcome to serialize) — sequenced after the
{3,4} set so it wraps real document types, not hypothetical ones.
**Read-set:** `crates/match3-core/**`, `crates/solitaire-core/**`.
**Write-set:** `crates/pond-docformat/**`, save/outcome call sites in both core crates, `fixtures/**`.
**Shared-state contract:** No shared mutable state beyond the file write-set.
**Risks:** Over-designing the envelope before three document types actually exist — keep it minimal;
the policy (how unknown fields and version skew are handled) is the real deliverable, not a rich schema.
Silent-fallback temptation on version skew — forbidden; skew is a loud typed error.
**Done when:**
1. **Behavioral:** Both games persist and reload documents through one versioned envelope; an old
   fixture loads under new code, and an unreadable newer-major fails loudly — the compatibility matrix
   has its first live entries.
2. **Verification:** `cargo test -p pond-docformat` + the games' save-path tests green, including the
   fixture-load and newer-major-rejection wiring test.
**Validation:** **Moderate.** Wiring test + author two versions of one fixture and prove forward-load.

---

### Phase 6: P8 — verifiable-outcome record (shared substrate)

**Goal:** The `pond-outcome` crate: a self-checking outcome record produced by replaying a move list
against the game's `state_hash` — the "cleared clean / game won" attestation that the follow-chain
leaderboard later reads. **Local only** (no network) — this is the *record*, not its distribution.

**Changes:**
- [ ] `crates/pond-outcome` — given `(game kind, seed, initial state, move list)`, replay via the
    game's core, and emit an outcome record (`{ kind, seed, result, final_hash, move_count }`) that
    *anyone* can re-verify by replaying — the record carries its own proof. Serialized via
    `pond-docformat` (Phase 5).
- [ ] Wire both games to emit an outcome on completion; a verifier that recomputes and checks the hash.
- [ ] A "count of clean clears" accumulator (additive, per the discipline — a count, never a ratio).

**Call chain:** game end → `pond-outcome::attest(kind, seed, moves)` → replay via core → record;
`pond-outcome::verify(record)` → re-replay → hash match / mismatch.
**Wiring test:** `test_outcome_record_reverifies_and_tamper_is_detected` — emit a real solitaire win
record, re-verify it (pass), then mutate one move / the final hash and assert verification fails. Runs
through the game core, not a mock. RED before the crate, GREEN after.
**Depends on:** Phase 4 (a game to complete), Phase 5 (envelope).
**Read-set:** `crates/*-core/**`, `crates/pond-docformat/**`.
**Write-set:** `crates/pond-outcome/**`, outcome-emit call sites in both games, tests.
**Shared-state contract:** No shared mutable state beyond the file write-set. No network (explicitly).
**Risks:** Conflating "record" with "leaderboard" — the leaderboard (follow-chain, networked) is out of
scope and gated; this phase stops at the locally-verifiable record. Trusting client arithmetic — the
whole point is the record re-verifies by replay, so `verify` must re-run the core, never trust a stored
result field.
**Done when:**
1. **Behavioral:** Finishing a game produces a record that any party can re-verify by replay, and any
   tampering is detected — the "142 cleared clean" count is built on individually-verifiable records.
2. **Verification:** `cargo test -p pond-outcome` green including the reverify + tamper-detection wiring
   test.
**Validation:** **Moderate.** Wiring test + manually tamper a serialized record and confirm rejection.

---

### Phase 7: Shelf shell + solitaire playable; deploy `fun.croft.ing`

> **EXPANDED/REPLACED (2026-07-28) by the front-end plan
> `2026-07-28-games-drawer-solitaire-ui.md`.** That companion plan decomposes this compressed phase
> into a full UI/UX build (slide-out drawer + full-screen + new-tab, per-game URLs, design system,
> wasm-bindgen browser binding, tap-to-move solitaire, PWA/a11y, deploy). The owner chose the
> slide-out-drawer model; the domain + Pages are live as of 2026-07-28. Use the companion plan for
> execution; this phase entry remains as the master-plan-level summary of the same work.

**Goal:** The game-agnostic **shelf** PWA is live at `fun.croft.ing`: it lists games, launches one, and
**solitaire is fully playable** in the browser over its wasm core, producing a verifiable outcome
record. This is the first demonstrable artifact.

**Changes:**
- [ ] Shelf shell: a game-agnostic catalog UI (list of games with metadata) + a launcher that mounts a
    game module. Match-3 shows as "core ready" (mountable but no levels yet); solitaire shows as
    playable.
- [ ] Solitaire UI: a real (not throwaway) playable board over `solitaire-wasm`, honoring the D5
    feel-spike notes; new-deal(seed), legal-move enforcement from the core, win detection, outcome
    record emitted via `pond-outcome`.
- [ ] Wire the D4 deploy (GitHub Pages or Vercel) + custom domain `fun.croft.ing`; a11y gate, bundle
    budget, PR-preview all enforced in CI (croft-pwa conventions).
- [ ] Promote `prds/games-pond.md` from candidate toward building; update E46 to "shelf live"; append
  "solitaire leading the shelf (live)" to the build-order roadmap row. (All discovery-repo edits, done
  here sequentially.)
- [ ] Instrument via the borrowed telemetry hook: game-launch, game-complete, and outcome-verify
  events (no PII, local-first) so a shelf/launch failure is diagnosable post-deploy.

**Call chain:** `fun.croft.ing` → shelf catalog → user picks Solitaire → launcher mounts solitaire
module → `solitaire-wasm.new_game(seed)` → user plays → win → `pond-outcome.attest` → record shown.
**Wiring test:** a Playwright end-to-end (`shelf.spec.ts`): load the deployed shelf (or preview), click
Solitaire, play a scripted winning deal, assert a verifiable outcome record appears. This exercises the
*entry point* (the shelf URL) through to the outcome — the single most important test that the whole
chain is live, not just the crates. RED before the UI wiring, GREEN after. (Browser flows use
Playwright per CroftC `.claude/CLAUDE.md`; the Chrome extension is disabled here.)
**Depends on:** Phases 4, 5, 6 (solitaire core + envelope + outcome), Phase 0 D4 (host), Phase 3
(match-3 mountable). Phase 1 web skeleton.
**Read-set:** all `crates/*-wasm/**`, the web skeleton.
**Write-set:** `app/**` (shelf + solitaire UI), CI deploy config; discovery-repo edits
`prds/games-pond.md`, ROADMAP_TODO E46, `build-order-and-ponds-roadmap.md:252` (all sequential — Phase
7 is not parallel with anything, so the shared discovery tree is safe here).
**Shared-state contract:** Deploy touches an external host (D4) + DNS — the one outward-facing action
in the plan; **confirm with owner before first production deploy** (irreversible-ish, public). PR
previews are fine unattended. No local daemon beyond the dev server (bound to a dev port, not in CI).
**Domain-scoping constraint (from the card-maker thread):** first-party games are trusted code, so
the shelf can live at `fun.croft.ing` safely today — but if a future endpoint opens a game a *stranger*
packaged, that untrusted renderer must not share a registrable domain with any estate session cookie.
Decide the shelf's cookie/session scope deliberately here (one-line config now vs a migration later),
even though first-party games don't force it.
**Risks:** wasm bundle size blows the budget (mitigate: `wasm-opt`, code-split per game so the shelf
doesn't ship every game's wasm up front). The Playwright browser-egress limitation noted in memory
(`sandbox-browser-egress-blocks-live-tests`) may block a *live* `fun.croft.ing` E2E from this sandbox —
run the E2E against a local build here and hand the live-domain check to a networked env.
**Done when:**
1. **Behavioral:** A stranger can open `fun.croft.ing`, choose Solitaire, play a deal to a win, and get
   a verifiable outcome record — with match-3 visible on the shelf as core-ready.
2. **Verification:** the Playwright shelf E2E passes against a local production build; the deploy job
   succeeds and the domain resolves (live check handed to a networked env if sandbox egress blocks it).
**Validation:** **Broad.** Wiring E2E + manual play session + confirm deploy + a11y/bundle gates green +
verify the emitted record re-verifies (Phase 6 integration).

---

### Phase 8: Match-3 P3 par bands + P4 level pack

**Goal:** Match-3 becomes a *complete* game on the shelf: a generated level pack (P4, byte-identical
from a master seed) and par bands (P3, derived from a bot/solver's moves-remaining distribution),
making "cleared clean vs par" meaningful.

**Changes:**
- [ ] A match-3 bot/solver harness that plays thousands of deals per level and reports the
    moves-remaining-on-win distribution (P3's report contract).
- [ ] Derive per-level par bands from the distribution percentiles at build time; ship them in the
    level pack. Absolute (vs the level), not relative (vs players); generous per the corpus caveat.
- [ ] Level generation from a master seed, regenerable byte-identically on a clean machine (the P10
    annual-drill target); fixtures per pack version (P2/P10).
- [ ] Shelf: match-3 flips from "core ready" to fully playable with levels + par + verifiable
    clean-clear count (reusing Phase 6's `pond-outcome`).

**Call chain:** build step → level generator (master seed) → pack + par bands → shelf mounts match-3
with levels → play → `pond-outcome` clean-clear vs par.
**Wiring test:** `test_pack_regenerates_byte_identical` (P10 drill in miniature) + a Playwright E2E
mounting match-3 with a generated level, playing to a clean clear, asserting the par comparison and
verifiable record. RED before generation/par, GREEN after.
**Depends on:** Phases 3, 6, 7 (match-3 core in the shelf + outcome record + shelf live).
**Read-set:** `crates/match3-core/**`, `crates/pond-outcome/**`, the shelf app.
**Write-set:** `crates/match3-levels/**` (generator + bot), `app/**` (match-3 UI), pack fixtures.
**Shared-state contract:** Bot runs are CPU-bound, no network, no shared state beyond output files.
**Risks:** Bot-calibrated par diverges from human play (corpus caveat) — set generously, mark par
"gettable," and label bands as bot-derived. Level-gen non-determinism would break the P10 drill — the
generator must be seeded and pinned like the engines.
**Done when:**
1. **Behavioral:** Match-3 is fully playable on the shelf with generated levels and par bands, a level
    pack regenerates byte-identically from its master seed, and a clean clear yields a verifiable count.
2. **Verification:** `cargo test -p match3-levels` (incl. byte-identical regeneration) + the match-3
    shelf E2E green.
**Validation:** **Broad.** Wiring tests + regenerate the pack on a clean checkout and diff (byte-
identical) + a manual play session.

---

### Phase 9 (GATED — likely its own plan): Cribbage — fair-reveal + P2P transport

**Goal:** The third shelf game: 2-player cribbage. **Gated** on a real-time P2P transport and the
fair-reveal commit-reveal primitive — neither exists yet. Named here for completeness; **not executed
under this plan.** Expected to become its own phase-plan once the transport substrate lands.

**Why gated, not deferred-arbitrarily:** cribbage needs two mutually-distrusting players to agree on a
deal (fair-reveal, `alpha/thinking/app/ponds/fair-reveal-primitive-spec.md`) over a live connection
(iroh / browser-native WebRTC, `beta/cairn/iroh-app-pond-building-blocks.md`, GGRS+matchbox). That
transport is the roadmap's Track B growth spine (resolver, Phase 0.2) and is unbuilt.

**Sketch (to be expanded in its own plan):** cribbage-core determinism (deal + pegging + hand/crib
scoring + his-heels/nobs) with golden vectors and state hash (same P1 discipline); fair-reveal for the
deal; a transport adapter; the outcome record extended to a two-party mutual attestation (the
"mutual-signed outcome-attestation mechanism" flagged open in `prds/games-pond.md` and beta T15).
**Depends on:** a P2P transport substrate (does not exist), fair-reveal implementation, resolver.
**Done when:** deferred to its own plan.

---

## Open Questions

Each carries a recommended severity; the owner confirms or overrides before the plan advances.

- **[RESOLVED 2026-07-27]** D3 — P5/P7/P9 meanings. Owner confirmed the fuller P1–P9 write-up is not
  recoverable; the material on hand was the card-maker/packaging/push thread, not the phase list.
  **Ruling: proceed; P5/P7/P9 are OPEN, designed fresh when reached (openly, not fabricated).** The
  plan covers the faithfully-definable P1/P2/P3/P4/P6/P8/P10; the Phase 0–8 spine needs none of the
  three unknowns. Optional follow-up: a short design pass to co-design P5/P7/P9 from scratch before
  they are reached (owner's call, gates nothing).
- **[RESOLVED 2026-07-27]** D2 — solitaire variant: **Klondike draw-1.** Phase 4 pins the residual
  sub-details (stock pass/redeal limit; whether scoring is tracked) against a canonical source rather
  than assuming.
- **[RESOLVED 2026-07-27 / 2026-07-28]** D4 — host: **GitHub Pages** (estate convention). DNS residual
  now closed: `fun.croft.ing` domain added and Pages active (2026-07-28). Fully unblocked.
- **[PHASE-GATED (Phase 4) — DECISION PENDING]** Does P3's bot-harness/par concept apply to solitaire,
  or only to match-3? Owner asked for an explanation (2026-07-27) before deciding; agent recommendation
  is **match-3 only** (solitaire ships with win / clean-clear counts, no solver). Does not block Phase 4;
  revisit before any solitaire-par work. *Rationale: a Klondike solver is a real algorithmic lift for a
  marginal comparison feature, and the discipline's preferred metric ("count of clean clears") needs no
  solver.*
- **[RESOLVED 2026-07-27]** `pond-docformat` envelope shape — no house convention; **design a minimal
  `{ kind, version, payload }` envelope in Phase 5.** The unknown-field + version-skew policy is the
  deliverable, not a rich schema.
- **[RESOLVED 2026-07-27]** Repo name — **`CroftCommunity/fun`** (org `CroftCommunity`, repo `fun`),
  local checkout `CroftC/fun`. The advisory question is closed.
- **[RESOLVED 2026-07-27]** Archive vs keep `experiments/match3-p1/` — **keep as a provenance
  tombstone** (do not delete); the promotion pointer lands in Phase 1.
- **[RESOLVED 2026-07-27]** D5 solitaire feel-spike — **skip** (P1 discipline already proven on
  match-3; it gates nothing).

---

## Review Log

- **2026-07-27 — Pass 1+2 (combined).** Initial plan authored from: the P1–P10 run-brief tail
  (`seeds/.../croft-games-pond-roadmap-...-2026-07-22.md`), the per-pond build discipline
  (`beta/croft/build-order-and-ponds-roadmap.md`), the live match-3 spike (`experiments/match3-p1/`,
  verified green this session), and owner decisions captured this session (standalone repo; shelf order
  solitaire → match-3 → cribbage; domain `fun.croft.ing`; full determinism-verified scope).
  - **Pass 2 gap analysis folded in:** (1) lifted the only cross-phase shared write (workspace
    `Cargo.toml` `members`) out of the {3,4} parallel set into Phase 1, so the parallel phases have
    genuinely disjoint write-sets. (2) Sequenced P2 (Phase 5) and P8 (Phase 6) *after* the {3,4} game
    set so they wrap real document types, not hypothetical ones. (3) Named the browser-egress
    limitation (memory: `sandbox-browser-egress-blocks-live-tests`) as a Phase 7 risk with the
    local-build-E2E mitigation. (4) Added the `grep match3-p1` pre-promotion step to Documentation
    Impact so no stale path reference is missed. (5) Made every workspace member a compiling empty-but-
    real crate in Phase 1 to avoid behavioral stubs while still freezing the members list.
  - **Honesty holds recorded:** P5/P7/P9 are *not* invented — flagged BLOCKING (D3). Solitaire rules
    are *not* assumed — flagged BLOCKING (D2). Cribbage's P2P substrate is *not* pretended into
    existence — Phase 9 is gated and explicitly not executed under this plan.
  - **Pending:** Pass 3 quality gates (TDD ordering within phases, diagnostic/logging readiness,
    validation calibration review, Documentation Impact coverage check) — run in a fresh context.
- **2026-07-27 — D3 resolved + card-maker principles folded in.** Owner reported the fuller P1–P9
  write-up is not recoverable; the material on hand was the already-filed card-maker/packaging/push
  thread, not the phase list. **D3 ruling: proceed; P5/P7/P9 open, designed fresh when reached.**
  Corrected the definable-phase list to include **P6** (saves + browser-storage durability — it *is*
  in the corpus, "P6's durability assumptions", tied to Home-Screen install for persistent storage).
  Folded three principles from the card-maker thread into Reasoning + Phase 7: (1) maker-is-a-tool /
  game-is-a-portable-file; (2) the packaging ladder (URL floor → single-file HTML → `.xdc` only for
  shared-state/2-player games); (3) the untrusted-renderer must not share a registrable domain with an
  estate session cookie (Phase 7 hosting constraint). Recorded Web Push (not Pushover) as the eventual
  cribbage notification path. **Still BLOCKING:** D2 (solitaire variant) and D4 (host) remain
  unanswered.
- **2026-07-27 — D2 + D4 resolved. All BLOCKING questions now closed.** Owner chose **Klondike draw-1**
  (Phase 4 folds in the standard 7-pile / 4-foundation / draw-1 ruleset and will pin the stock-pass and
  scoring sub-details against a canonical source, not assume them) and **GitHub Pages** as the host
  (Phase 1 scaffolds a Pages PR-preview/deploy; Phase 7 wires `fun.croft.ing` once DNS is confirmed —
  the one residual, non-blocking for Phases 0–6). Pass 1+2 is complete with a fully-unblocked spine.
- **2026-07-27 — repo identity confirmed.** Repo is **`CroftCommunity/fun`** (GitHub org
  `CroftCommunity`, repo `fun`), local checkout `CroftC/fun`, remote
  `git@github-personal:CroftCommunity/fun` via the `chasemp` account (`gh auth switch --user chasemp`;
  confirm org push access before first push). Resolves the advisory repo-name question. Updated Phase 1,
  the Concurrency Map worktree paths (`worktrees/fun/<name>`), and Documentation Impact throughout.
  Retained filenames that legitimately keep the `games-pond` token (the source raw, this plan's own
  filename, the existing `prds/games-pond.md`).

### Pass 3: Quality Gates — 2026-07-27
**TDD ordering:** Every phase already starts test-first with a wiring test that runs through the entry
point (workspace build, cross-build harness, wasm surface roundtrip, save-path, outcome reverify,
Playwright shelf E2E). No changes needed to ordering.
**Specificity / mutation resistance:** Strengthened Phase 4 — added an explicit
`solitaire-core/tests/tie_breaks.rs` item naming the *edges* the per-rule tests must cover (King-to-
empty-column, foundation same-suit-ascending, tableau alternating-colour-descending, face-down-card
illegality, stock pass-limit boundary, win = all 52 on foundations), so a one-line mutation to the
legal-move predicate fails a test rather than surviving a happy-path assertion.
**Observability:** Added Phase 2 divergence diagnostics (emit vector id + both hashes + first diverging
step on mismatch; logging never in the hashed state path) and Phase 7 telemetry events (game-launch /
complete / outcome-verify) so a determinism failure or a post-deploy shelf failure is diagnosable.
**Debugging readiness:** Commit-per-phase (skill guardrail) + the re-entry checks give per-phase
checkpoints; the cross-build divergence diagnostics are the key instrumented failure. No further change.
**Validation calibration:** Reviewed — Broad for the external/determinism/browser phases (2, 4, 7, 8),
Moderate for scaffold/library/substrate phases (1, 3, 5, 6). Calibration holds; no changes.
**Concurrency honesty — the material Pass 3 finding:** Phases 3 and 4 (the parallel set) both edited
**discovery-repo** doc pointers (build-order roadmap row, `experiments/README`, ROADMAP_TODO E46). The
discovery working tree is shared and lies **outside** the `fun` worktree isolation, so two parallel
agents writing it would collide — a files-only isolation check missed it. **Fix (additive):** lifted
*all* discovery-repo edits into sequential phases — match-3 promotion pointers → Phase 1 (atomic with
the move), "solitaire live" pointers → Phase 7. Rewrote the {3,4} shared-state contract as invariants
(no discovery-repo edit; no parent-worktree git ops; frozen `Cargo.toml`; per-worktree `target/`) with
a one-to-one re-entry checklist (added `git -C discovery status` clean). Also confined Phase 3's
roundtrip test to the crate-local `tests/` dir so it can't collide with Phase 4's shared cross-build
harness edit. No new parallelism surfaced — the sequential spine is correct.
**Discovery (Phase 0):** D2/D3/D4 resolved during planning; annotated Phase 0 so they are not re-run.
D1 is the only live technical task and is resolvable with a cheap probe at execution start. All tasks
declare a disposition; D1 is `keep-as-fixture` with Phase 2 as its named consumer.
**Coherence:** Plan still solves the stated problem (repo + shelf + games, determinism-verified). Scope
matches the owner's "full determinism-verified pond"; no creep. Fixed a stale Documentation-Impact
phase pointer (prds/games-pond was listed at Phase 6 but edited in Phase 7 — now Phase 7).
**Documentation impact:** Every listed doc has an owning phase; all discovery-repo edits are now in
sequential phases (1 and 7), none in the parallel set; the `grep match3-p1` pre-promotion step stays in
Phase 1. No end-of-plan "docs phase."
**Confirmed ready:** yes for Phases 0–8, pending the user's walk-through of the remaining PHASE-GATED
and ADVISORY open questions (below). No BLOCKING questions remain. Phase 9 (cribbage) stays gated to
its own future plan.
- **2026-07-28 — DNS residual closed + front-end companion plan spun out.** `fun.croft.ing` domain
  added and GitHub Pages active (owner) — D4's DNS residual is closed and Phase 7 go-live is unblocked
  (updated Verified Assumptions, the D4 open question, and the Phase 1 CI note). Phase 7's UI/UX work
  was expanded into a dedicated front-end plan, `2026-07-28-games-drawer-solitaire-ui.md` (slide-out
  drawer + full-screen + new-tab, per-game URLs, design system, wasm-bindgen binding, tap-to-move
  solitaire, PWA/a11y, deploy). Phase 7 here now points to it; the master plan retains ownership of the
  Rust/determinism spine (P1–P6, P8). E46 carries breadcrumbs to both plans.
- **2026-07-27 — open-question walk-through (post-Pass-3).** Owner resolved: `pond-docformat` envelope
  designed in Phase 5 (no house convention); `experiments/match3-p1/` kept as a provenance tombstone;
  D5 feel-spike skipped. The solitaire-par question (P3-applies-to-solitaire?) was deferred — owner
  asked for an explanation before deciding; agent recommendation stands at **match-3 only**. This is
  PHASE-GATED at Phase 4 and blocks nothing upstream.
