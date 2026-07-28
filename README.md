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
  solitaire-core/    Klondike draw-1 engine (stub → built in the master plan Phase 4)
  pond-docformat/    P2 versioned document envelope (saves / codes / outcomes)   [stub]
  pond-outcome/      P8 verifiable-outcome record (replay → state hash)           [stub]
  match3-wasm/       browser binding over match3-core                            [stub]
  solitaire-wasm/    browser binding over solitaire-core (serde-JSON board)      [stub]
app/  src/           the games drawer UI (vanilla TS + esbuild) — front-end plan
plans/               the phase-plans governing this repo
```

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
