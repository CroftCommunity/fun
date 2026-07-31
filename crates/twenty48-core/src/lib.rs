//! Deterministic, headless 2048 engine.
//!
//! The determinism foundation for the `fun.croft.ing` 2048 game (Tier-1,
//! build-fresh). See RULES.md for the slide/merge rules, the seeded-spawn
//! contract, the exponent encoding, win/stuck, and the state hash this crate
//! implements verbatim. The only randomness is the post-move tile spawn, drawn
//! from a seeded `ChaCha20` stream, so a game replays exactly from
//! `(seed, directions)` and native == wasm.

#![warn(missing_docs)]

pub mod board;
pub mod engine;
pub mod game;
pub mod hash;
pub mod rng;

pub use board::{Board, Pos};
pub use engine::{has_any_move, slide, spawn, Direction, SlideReport, ALL_DIRECTIONS};
pub use game::{Game, MoveError, Twenty48};
pub use hash::state_hash;

/// Default mode parameters, shared by the deal, the UI, and the wasm binding.
pub mod mode {
    /// Board columns.
    pub const WIDTH: usize = 4;
    /// Board rows.
    pub const HEIGHT: usize = 4;
    /// Winning tile exponent (`2^11` = 2048).
    pub const WIN_EXP: u8 = 11;
    /// Tiles spawned at the start of a game.
    pub const START_TILES: usize = 2;
}
