# fun — the Croft games pond (`fun.croft.ing`)

A determinism-first, local-first **game shelf**. Each game is built so its outcome is verifiable by
replaying its move list against a state hash, it runs offline with no account and no server, and it is
a portable artifact addressable at its own URL.

## The shelf and the drawer

`fun.croft.ing` presents games in a **slide-out drawer** over a persistent play area; each game can
also go **full-screen** or **open in its own tab** (so every game has its own URL). A game is a module
that implements one contract and renders chrome-agnostically into a mount point — the drawer is built
once and every game reuses it. Shelf order: **solitaire → match-3 → cribbage**.

## Layout

```
crates/
  match3-core/       deterministic match-3 engine (promoted from the discovery spike; self-contained
                     with its RULES.md + vectors/) — green, red-first
  solitaire-core/    Klondike draw-1 engine (master-plan Phase 4) — green
  solitaire-solver/  build-time Klondike solver + winnable-daily pack generator (Phase S) — green
  pond-docformat/    P2 versioned document envelope (saves / codes / outcomes) — built
  pond-outcome/      P8 verifiable-outcome record (replay → state hash)         — built
  match3-wasm/       browser binding over match3-core                            [stub]
  solitaire-wasm/    browser binding over solitaire-core (raw C-ABI + serde-JSON) — built
games/solitaire/     daily-pack.json — the winnable-daily deals + win-path fixture (payload[0])
src/                 the games drawer UI (vanilla TS + esbuild); solitaire is playable at /solitaire/
plans/               the phase-plans governing this repo
```

## Solitaire (playable — front-plan Phase 4)

`/solitaire/` is a real Klondike draw-1 game over the wasm binding: tap a source → the core's legal
targets glow → tap a target to move; double-tap auto-sends to a foundation; the stock draws and
recycles. Daily deal by default (a winnable seed from `daily-pack.json`, UTC rollover), with a
free-play toggle (`?seed=<n>` for deterministic runs). Undo and an "I'm stuck" control exist; a
"Declare assistance used" setting (on by default) records whether undo/hints were used. A win leads
with a verification-forward screen — "Cleared clean ✓ — verifiable" — the full `pond-outcome` record,
moves-to-clear, one-tap re-verify (replays the record through the core), and a `?r=` share link that
re-verifies the shared result before display (deflated, so even a long win stays a portable URL).

## Build

```sh
cargo test --workspace     # game cores (match3-core: 19 tests green)
cargo fmt --all --check
cargo clippy --workspace --all-targets
npm run build              # static site -> dist/  (esbuild toolchain lands in the front-end plan)
```

## Build discipline

Determinism-first, red-first, per the Croft per-pond build discipline. Rust → wasm buys the native +
wasm cross-build determinism test essentially free. Dependencies are few, pinned exactly (`=x.y.z`),
and `Cargo.lock` is committed. See `plans/` for the governing phase-plans:

- `2026-07-27-games-pond-fun-crofting.md` — the pond master plan (Rust/determinism spine).
- `2026-07-28-games-drawer-solitaire-ui.md` — the front-end plan (drawer UX + solitaire, first game).

Provenance: `match3-core` was promoted from `discovery/alpha/experiments/match3-p1/` (2026-07-28).
