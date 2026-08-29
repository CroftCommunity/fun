//! Phase 0 discovery spike for the Orchard Drop Tier-1 plan.
//!
//! Answers D1-D6 of `plans/2026-08-28-1-plan-orchard-drop-tier1.md`. Throwaway
//! harness around a solver body that is `promote`-disposition: `world.rs` and
//! `fixed.rs` become `crates/pond-physics` in Phase 1, under TDD there.
//!
//! Run:
//! ```text
//! cargo test --release                                     # D1, D2, D3-native, D6
//! cargo build --release --target wasm32-unknown-unknown     # the wasm half
//! node verify.mjs                                           # D3 cross-check, D4 timing
//! ```

pub mod fixed;
pub mod scenario;
pub mod world;

use scenario::{digest, run, TOTAL_TICKS};

/// D3: the settle scenario's digest after the full run.
#[no_mangle]
pub extern "C" fn scenario_digest() -> u64 {
    digest(&run(TOTAL_TICKS, 0, false))
}

/// D3 guard: the same scenario with the first fruit's spawn `x` moved by one
/// sub-unit — the smallest representable change. A digest that does not move
/// here is not measuring the simulation.
#[no_mangle]
pub extern "C" fn perturbed_digest() -> u64 {
    digest(&run(TOTAL_TICKS, 1, false))
}

/// D6: the digest after exactly `n` ticks, so a divergence can be bisected to
/// the first tick that differs rather than reported as "the hashes differ".
#[no_mangle]
pub extern "C" fn tick_digest(n: u32) -> u64 {
    digest(&run(n, 0, false))
}

/// D6 control: the same as [`tick_digest`], with contact order deliberately
/// broken. Used to prove the bisect tool detects a divergence it is shown.
#[no_mangle]
pub extern "C" fn broken_tick_digest(n: u32) -> u64 {
    digest(&run(n, 0, true))
}

/// Total ticks the scenario runs, exposed so the host does not hardcode it.
#[no_mangle]
pub extern "C" fn total_ticks() -> u32 {
    TOTAL_TICKS
}
