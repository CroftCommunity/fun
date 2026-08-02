//! Deterministic, headless Blockdoku engine.
//!
//! The determinism foundation for the `fun.croft.ing` Blockdoku game (Tier-1,
//! build-fresh). Blockdoku is a 9×9 block-sudoku: a tray of polyomino pieces is
//! dealt; placing a piece that completes any full row, column, or 3×3 box clears
//! it; the tray refills when emptied; the game ends when no tray piece fits. It is
//! **endless score-attack — there is no win** (see RULES.md).
//!
//! The only randomness is the seeded piece deal, drawn from a `ChaCha20` stream
//! ([`rng::DetRng`]), so a run replays exactly from `(seed, moves)` and
//! native == wasm. See RULES.md for the board rules, the scoring constants (ported
//! 1:1 from the original), the deal, and the state hash this crate implements.

#![warn(missing_docs)]

pub mod board;
pub mod hash;
pub mod rng;
pub mod scoring;
pub mod shapes;
mod shapes_gen;

pub use board::{Board, ClearReport, Pos, BOX, SIZE};
pub use hash::state_hash;
pub use rng::DetRng;
pub use scoring::{
    combo_bonus, score_placement, streak_bonus, Multiplier, PlacementScore, LINE_POINTS,
    SQUARE_POINTS,
};
pub use shapes::{by_key, catalog, keys_in_tier, ShapeDef, Tier};
