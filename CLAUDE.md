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
  errors, `clippy::pedantic` clean, `cargo fmt --check` clean. The cores are
  determinism-critical — no floats on the hashed path; `usize`→`u32` at RNG/hash
  boundaries so native==wasm.
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
  *with up-front size disclosure* (e.g. SuperTuxKart). See the Tux Racer wrap
  spike in `plans/` for the reference path; the wrapped-game standard is a
  pending addendum to `docs/BUILDING-GAMES.md`.

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
