#!/usr/bin/env bash
# Native+wasm cross-build determinism check (master-plan Phase 2).
#
# Builds `xbuild` to wasm32-unknown-unknown with the rustup stable toolchain
# (Homebrew's rustc has no wasm std; and its rustc shadows the toolchain on
# PATH, so RUSTC must be set explicitly), then runs check.mjs under node to
# assert the wasm hashes equal the locked native golden hashes.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
fun="$(cd "$here/../.." && pwd)"

rustc_bin="$(rustup which --toolchain stable rustc)"
cargo_bin="$(rustup which --toolchain stable cargo)"

RUSTC="$rustc_bin" "$cargo_bin" build \
  --manifest-path "$fun/Cargo.toml" -p xbuild --release \
  --target wasm32-unknown-unknown

node "$here/check.mjs" \
  "$fun/target/wasm32-unknown-unknown/release/xbuild.wasm" \
  "$fun/crates/solitaire-core/vectors" \
  "$fun/crates/dots-core/vectors" \
  "$fun/crates/furrow-core/vectors" \
  "$fun/crates/cribbage-core/vectors"
