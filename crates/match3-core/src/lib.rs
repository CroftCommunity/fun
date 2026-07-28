//! Deterministic, headless match-3 engine (P1).
//!
//! The determinism foundation from the per-pond build discipline. See RULES.md
//! for the rules and the tie-break tables this crate implements verbatim.

pub mod board;
pub mod engine;
pub mod hash;
pub mod rng;
pub mod vectors;

pub use board::{Board, BoardError, Cell};
pub use engine::{
    apply_gravity, clear_cells, find_matches, refill, swap_legal, ClearOutcome, Game, MoveReport,
    Pos, StepReport,
};
