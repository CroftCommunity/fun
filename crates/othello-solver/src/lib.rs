//! Othello (Reversi) engine — the classic opponent, the honest oracle, and the
//! tutor's fact source.
//!
//! Othello is **not solved from the opening**, so this is a heuristic alpha-beta
//! search (positional + mobility) with an **exact full solve in the deep
//! endgame** — the same exact-when-tractable / capped-otherwise shape as the
//! Drop 4 solver, renamed exact/heuristic. It serves as the difficulty-tuned
//! opponent (via a class-preserving band) and the fact source the tutor and the
//! AI-scoring harness grade against. No network; integer-only on any compared
//! path so `native == wasm`.

#![warn(missing_docs)]

pub mod eval;
pub mod search;

pub use eval::{heuristic, WEIGHTS};
pub use search::{best_move, move_values, Level, TRACTABLE_EMPTIES};
