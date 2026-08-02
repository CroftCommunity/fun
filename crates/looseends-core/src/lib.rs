//! Loose Ends — a deterministic, headless arrow-release ("tap-away") puzzle
//! engine.
//!
//! A grid is filled with snake-shaped arrows. An arrow is **FREE** when the
//! straight ray from its arrowhead to the board edge is clear of every other
//! arrow; releasing a FREE arrow clears its cells. Boards are procedurally
//! generated from a seed and **solvable by construction** (arrows placed in
//! reverse solution order), so every board fully clears under a greedy solver.
//!
//! Determinism is integer-exact (FNV-1a + a `u32`-carried `mulberry32`), so
//! native and `wasm32` agree bit-for-bit; a [`hash::state_hash`] plus the
//! ordered move list make a cleared board a verifiable [`pond_outcome`] record.

#![warn(missing_docs)]

pub mod board;
pub mod config;
pub mod game;
pub mod generate;
pub mod hash;
pub mod rng;
pub mod score;

pub use board::{Arrow, Board, ReleaseError};
pub use config::{daily_config, daily_seed, level_config, level_seed, Config};
pub use game::{Game, LooseEnds, Tap};
pub use generate::generate;
pub use hash::state_hash;
pub use rng::{hash_str, Rng};
pub use score::{score, stars};
