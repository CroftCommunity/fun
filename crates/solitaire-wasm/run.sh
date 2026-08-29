#!/usr/bin/env bash
# Binding wiring check (delivery plan Phase C): build solitaire-wasm to wasm with
# the rustup stable toolchain (Homebrew rustc has no wasm std and shadows it on
# PATH, so RUSTC must be set explicitly), then drive it under node.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
fun="$(cd "$here/../.." && pwd)"
# Resolved from the repo root so rustup honours rust-toolchain.toml. This said
# `--toolchain stable` until 2026-08-29, floating free of the pin — the same bug
# tools/build-wasm.sh and crates/xbuild/run.sh both carried. All three had it,
# and the two nobody ran kept it longest.
rustc_bin="$(cd "$fun" && rustup which rustc)"
cargo_bin="$(cd "$fun" && rustup which cargo)"


RUSTC="$rustc_bin" "$cargo_bin" build \
  --manifest-path "$fun/Cargo.toml" -p solitaire-wasm --release \
  --target wasm32-unknown-unknown

node "$here/check.mjs" \
  "$fun/target/wasm32-unknown-unknown/release/solitaire_wasm.wasm" \
  "$fun/crates/solitaire-core/vectors"
