//! Deterministic, headless bubble-shooter engine (Puzzle Bobble family).
//!
//! The determinism foundation for the `fun.croft.ing` bubble shooter (Tier-1,
//! build-fresh). See RULES.md for the geometry, adjacency, deal, shot
//! resolution, and the state hash this crate implements verbatim. Aim is a
//! quantized integer [`Angle`] resolved to a landing by a fixed-point ray-cast
//! ([`resolve_shot`], no floats on the hashed path), so a game replays exactly
//! from `(seed, angles)` against the state hash and `native == wasm` holds.

#![warn(missing_docs)]

pub mod aim;
pub mod board;
pub mod engine;
pub mod game;
pub mod hash;
pub mod levels;
pub mod rng;

pub use aim::{angle_for_landing, cell_center, cell_center_off, fan, resolve_shot, Angle, Landing};
pub use board::{Board, BoardError, Cell, Pos};
pub use engine::{deal, Deal};
pub use game::{Bubble, Game};
pub use hash::state_hash;
pub use levels::{BubbleLevels, LevelGame};

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
    /// Shot budget: the objective is to clear the board within this many shots.
    /// Generous by default; the B4 winnable-pack solver certifies clearability
    /// within it and can retune this constant.
    pub const SHOT_BUDGET: usize = 40;
}

/// Levels mode — the escalating, point-gated, descending-stack game (Puzzle
/// Bobble family). Endless survival: reach each level's point target before the
/// stack, pushed down by periodic top-row inserts, crosses the bottom deadline.
/// Every value here is a deterministic knob; the per-level ramp lives in
/// [`crate::levels`]. Pressure is **shot-driven** (inserts on a shot count) so a
/// game replays from `(seed, angles)`; the timer is presentational only.
pub mod levels_mode {
    /// Cells in a full (even) row.
    pub const WIDTH: usize = 8;
    /// Rows on the board. **Even** so a top-row insert's parity flip preserves the
    /// flat cell count (see `Board::insert_top_row`).
    pub const HEIGHT: usize = 12;
    /// Palette-size metadata folded into the state hash (stable across levels; the
    /// per-level palette ramps up to this).
    pub const MAX_COLORS: usize = 8;
    /// Reserved bottom rows: any bubble reaching them ends the run (the deadline).
    pub const DEADLINE_ROWS: usize = 1;
    /// Colours at level 1 (ramps by `+1` per level up to `MAX_COLORS`).
    pub const COLORS_BASE: usize = 3;
    /// Pre-filled rows at level 1 (ramps slowly with level).
    pub const START_ROWS_BASE: usize = 4;
    /// Points to clear level 1.
    pub const TARGET_BASE: u64 = 1_500;
    /// Extra points required per level above 1.
    pub const TARGET_STEP: u64 = 750;
    /// Shots between top-row inserts at level 1 (tightens with level).
    pub const CADENCE_BASE: usize = 6;
    /// Fastest insert cadence (floor).
    pub const CADENCE_FLOOR: usize = 3;
    /// Presentational per-level clock at level 1, seconds (never a verified loss).
    pub const TIME_BASE_SECS: u32 = 90;
    /// Seconds shaved off the presentational clock per level.
    pub const TIME_STEP_SECS: u32 = 5;
    /// Floor for the presentational clock, seconds.
    pub const TIME_FLOOR_SECS: u32 = 30;
}
