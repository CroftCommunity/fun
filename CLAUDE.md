# fun.croft.ing — agent directives

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
  `phase-plan` skill (three passes; plan doc in `plans/YYYY-MM-DD-<slug>.md`,
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
  - **Run the gate through `npm run test:rust`, not bare `cargo clippy`.**
    Homebrew's cargo/clippy shadow rustup on PATH — the same trap `build-wasm.sh`
    already documents for `rustc` — and Homebrew's clippy *lags*. During this
    gate's bring-up local clippy 0.1.94 passed code CI's 0.1.97 rejected, three
    round trips in a row. `tools/rust-gate.sh` pins rustup's stable toolchain so
    local and CI agree; the job also prints its versions every run.
  - **Lint level: default clippy workspace-wide, `pedantic` opt-in per crate.**
    New crates opt in with `[lints] workspace = true`, which picks up
    `[workspace.lints.clippy]` in the root `Cargo.toml` — pedantic **minus the cast
    family**. Measured 2026-08-04: 81% of pedantic's 190 hits here are
    `cast_possible_truncation` and friends firing on exactly the `usize`→`u32`
    narrowing the line above *requires*. Existing crates are grandfathered.
    (This bullet used to claim "`clippy::pedantic` clean" workspace-wide; nothing
    checked it and nothing ever had. It now says what is true.)
- **Commit at every stable (green) point.** No batching phases. Each commit is a
  working checkpoint. Co-author trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Don't push/PR unless
  asked.
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

## The shelf model — two tiers (COHESION §62 in discovery)

`docs/BUILDING-GAMES.md` is the full standards doc. In short:

- **Tier 1 — Croft-native (build-fresh).** Determinism-first Rust core → wasm,
  **verifiable outcome** (move-list replay → `state_hash`, re-verifying `?r=`
  share), tap-first with the core deciding legality. solitaire · match-3 ·
  bubble (in progress). This is the shelf's differentiator; build fresh when a
  game's rules are simpler than an integration.
- **Tier 2 — opportunistic wrap/port.** Already-packaged **ethical** games taken
  as-is (client-side/static, non-extractive, redistribution-licensed, fits our
  chrome, **honestly represented** — no faked verifiable outcome). Gated by a
  real-browser **containment/legibility** harness (untrusted code in our chrome).
  A large one-time download that then runs fully offline is an allowed class
  *with up-front size disclosure*. The wrapped-game standard is **ratified in
  `docs/BUILDING-GAMES.md` §9**; **Astray** (`src/games/astray/`) is the Tier-2
  reference implementation (as solitaire is for Tier-1). Every wrap ships a
  `tier2.meta.json` (provenance + posture). Avoid the Emscripten + runtime-untar
  class (the SuperTuxKart cut, `plans/2026-07-31-supertuxkart-wrap.md`).

**Adversarial (two-player) games + AI opponents.** Drop 4 (`/drop4/`) is the
shelf's first two-player game vs a computer opponent — a Tier-1 build with a
verifiable outcome. The engine is strength/difficulty, the LLM is UX
(legality/personality/explanation/tutoring); the standard lives in
`docs/BUILDING-GAMES.md` §10 and the full guide in `docs/AI-PLAYERS.md`.

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
