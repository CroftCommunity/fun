#!/usr/bin/env bash
# Build the browser wasm binding(s) with the toolchain pinned in
# rust-toolchain.toml. Homebrew's rustc (the active one) has no wasm std and
# shadows rustup on PATH, so RUSTC is set explicitly. `node build.mjs` then
# copies the artifact into dist/.
#
# `rustup which` is resolved from the repo root so it honours rust-toolchain.toml
# — previously this said `--toolchain stable`, which floated independently of the
# version CI used.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
fun="$(cd "$here/.." && pwd)"

rustc_bin="$(cd "$fun" && rustup which rustc)"
cargo_bin="$(cd "$fun" && rustup which cargo)"

RUSTC="$rustc_bin" "$cargo_bin" build \
  --manifest-path "$fun/Cargo.toml" -p solitaire-wasm -p match3-wasm -p bubble-wasm -p wyrdle-wasm -p twenty48-wasm -p drop4-wasm -p othello-wasm -p checkers-wasm -p align-wasm -p blockdoku-wasm -p looseends-wasm -p color-sort-wasm --release \
  --target wasm32-unknown-unknown
