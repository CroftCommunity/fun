//! Deterministic, headless bubble-shooter engine (Puzzle Bobble family).
//!
//! The determinism foundation for the `fun.croft.ing` bubble shooter (Tier-1,
//! build-fresh). See RULES.md for the geometry, adjacency, deal, shot
//! resolution, and the state hash this crate implements verbatim. Aim is
//! tap-a-target (no continuous physics), so a game replays exactly from
//! `(seed, shots)` against the state hash.

#![warn(missing_docs)]

pub mod board;
pub mod engine;
pub mod hash;
pub mod rng;

pub use board::{Board, BoardError, Cell, Pos};
pub use engine::{deal, Deal};
pub use hash::state_hash;

/// Default clear-the-board mode parameters, shared by the deal, the UI, and the
/// wasm binding so all agree on the same daily boards. The objective + shot
/// budget live in the `Game` wrapper (B2), not here.
pub mod clear_board_mode {
    /// Cells in a full (even) row.
    pub const WIDTH: usize = 8;
    /// Rows on the board.
    pub const HEIGHT: usize = 11;
    /// Rows pre-filled with bubbles at the deal.
    pub const ROWS_FILLED: usize = 5;
    /// Bubble colours.
    pub const COLORS: usize = 5;
}
