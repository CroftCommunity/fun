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

/// Clear-the-blockers mode parameters, shared by the deal, the solver's winnable
/// pack, and the wasm binding so all three agree on the same daily boards.
pub mod blockers_mode {
    /// Board width.
    pub const WIDTH: usize = 8;
    /// Board height.
    pub const HEIGHT: usize = 8;
    /// Gem colours.
    pub const COLORS: usize = 6;
    /// Single-layer blockers placed in a deal.
    pub const BLOCKERS: usize = 6;
    /// Swap budget: the objective is met by clearing every blocker within this.
    pub const MOVE_BUDGET: usize = 30;
}
pub use engine::{
    apply_gravity, blockers_remaining, clear_cells, deal, deal_blockers, find_matches,
    has_legal_move, legal_swaps, reference_score, refill, reshuffle_if_dead, swap_legal,
    ClearOutcome, Game, MoveReport, Pos, StepReport,
};
