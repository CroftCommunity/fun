#!/usr/bin/env bash
# Build the browser wasm binding(s) with the rustup stable toolchain. Homebrew's
# rustc (the active one) has no wasm std and shadows rustup on PATH, so RUSTC is
# set explicitly. `node build.mjs` then copies the artifact into dist/.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
fun="$(cd "$here/.." && pwd)"

RUSTC="$(rustup which --toolchain stable rustc)" "$(rustup which --toolchain stable cargo)" build \
  --manifest-path "$fun/Cargo.toml" -p solitaire-wasm -p match3-wasm -p bubble-wasm -p wyrdle-wasm -p twenty48-wasm -p align-wasm -p blockdoku-wasm --release \
  --target wasm32-unknown-unknown
