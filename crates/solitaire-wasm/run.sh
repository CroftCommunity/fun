#!/usr/bin/env bash
# Binding wiring check (delivery plan Phase C): build solitaire-wasm to wasm with
# the rustup stable toolchain (Homebrew rustc has no wasm std and shadows it on
# PATH, so RUSTC must be set explicitly), then drive it under node.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
fun="$(cd "$here/../.." && pwd)"
rustc_bin="$(rustup which --toolchain stable rustc)"
cargo_bin="$(rustup which --toolchain stable cargo)"

RUSTC="$rustc_bin" "$cargo_bin" build \
  --manifest-path "$fun/Cargo.toml" -p solitaire-wasm --release \
  --target wasm32-unknown-unknown

node "$here/check.mjs" \
  "$fun/target/wasm32-unknown-unknown/release/solitaire_wasm.wasm" \
  "$fun/crates/solitaire-core/vectors"
