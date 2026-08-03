//! Deterministic, headless water/ball/bolt sort-puzzle engine.
//!
//! The determinism foundation for the `fun.croft.ing` Color Sort game (Tier-1,
//! build-fresh). See RULES.md for the move legality, the maximal-run pour, the
//! win/deadlock rules, the deterministic deal, the packed outcome-seed encoding,
//! and the state hash this crate implements verbatim.
//!
//! One engine serves every skin: ball and bolt are pure rendering of the same
//! water-move (the equivalence theorem, Ito et al. arXiv:2202.09495). The only
//! nondeterminism is the seeded deal shuffle, so a game replays exactly from
//! `(packed seed, moves)` and native == wasm.

#![warn(missing_docs)]

pub mod board;
pub mod deal;
pub mod engine;
pub mod game;
pub mod hash;
pub mod rng;

pub use board::{State, CAP};
pub use deal::{deal, deal_from_seed, pack_seed, unpack_seed, DealParams};
pub use engine::{apply_move, is_deadlocked, is_legal, legal_moves, ui_moves, Move, MoveError};
pub use game::{ColorSort, Game};
pub use hash::state_hash;

/// The daily mode parameters (brief §5.1): fixed every day so results compare.
pub mod daily {
    /// Colours (`n`).
    pub const COLORS: u8 = 10;
    /// Empty tubes (`k`).
    pub const EMPTIES: u8 = 2;
}

/// The endless difficulty ramp (brief §5.2): colours by level, `k` fixed at 2.
pub mod endless {
    /// Empty tubes (`k`) — fixed across all levels.
    pub const EMPTIES: u8 = 2;

    /// The colour count (`n`) for level `level` (1-based), ramping the difficulty.
    #[must_use]
    pub fn colors_for(level: u32) -> u8 {
        match level {
            0..=2 => 4,
            3..=5 => 5,
            6..=9 => 6,
            10..=14 => 7,
            15..=20 => 8,
            21..=29 => 9,
            30..=49 => 10,
            50..=79 => 11,
            _ => 12,
        }
    }
}
