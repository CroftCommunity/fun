#!/usr/bin/env bash
# The Rust gate — the same three commands, in the same order, with the same
# toolchain as CI's `rust` job in .github/workflows/deploy.yml.
#
# Why the PATH dance: Homebrew's cargo/clippy shadow rustup on PATH, the same
# problem build-wasm.sh already works around for rustc. Homebrew's clippy also
# *lags* — during this gate's bring-up (2026-08-04) local clippy 0.1.94 passed
# code that CI's 0.1.97 rejected three separate times, once per round trip. So
# this script pins the toolchain explicitly rather than trusting whatever
# `cargo clippy` happens to resolve to; `npm run test:rust` then means exactly
# what CI means.
#
# --release on the test command is load-bearing, not tuning: in the debug
# profile the suite runs >20 min (bubble-solver's search dominates); in release
# it is ~53s.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
fun="$(cd "$here/.." && pwd)"

rustup_bin="$(dirname "$(rustup which --toolchain stable cargo)")"
export PATH="$rustup_bin:$PATH"

cd "$fun"
echo "rust-gate: $(rustc --version) / $(cargo clippy --version)"
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --release
