//! Deterministic, headless match-3 engine (P1).
//!
//! The determinism foundation from the per-pond build discipline. See RULES.md
//! for the rules and the tie-break tables this crate implements verbatim.

pub mod board;
pub mod engine;
pub mod hash;
pub mod rng;
pub mod vectors;

pub use board::{Board, BoardError, Cell, SpecialKind};

/// Target-score mode parameters, shared by the binding and the par-table
/// generator so play-time and the baked par agree.
pub mod target_score_mode {
    /// Board width.
    pub const WIDTH: usize = 8;
    /// Board height.
    pub const HEIGHT: usize = 8;
    /// Gem colours.
    pub const COLORS: usize = 6;
    /// Legal-swap budget.
    pub const MOVE_BUDGET: usize = 20;
}

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

/// Clear-the-jelly mode parameters, shared by the deal, the solver's winnable
/// pack, and the wasm binding so all three agree on the same daily boards.
pub mod jelly_mode {
    /// Board width.
    pub const WIDTH: usize = 8;
    /// Board height.
    pub const HEIGHT: usize = 8;
    /// Gem colours.
    pub const COLORS: usize = 6;
    /// Single-layer jellied cells placed in a deal.
    pub const JELLY: usize = 6;
    /// Swap budget: the objective is met by scrubbing every jelly within this.
    pub const MOVE_BUDGET: usize = 30;
}
pub use engine::{
    apply_gravity, blockers_remaining, clear_cells, deal, deal_blockers, deal_jelly, find_matches,
    has_legal_move, jelly_remaining, legal_swaps, random_score, reference_score,
    reference_score_beam, reference_score_specials, refill, reshuffle_if_dead, swap_legal,
    ClearOutcome, Game, MoveReport, Pos, StepReport,
};
