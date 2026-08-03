//! Perfect Drop 4 solver — the classic opponent and the exact scoring oracle.
//!
//! A bitboard negamax solver (alpha-beta, transposition table, centre-first
//! ordering, null-window iterative deepening — the Pascal Pons algorithm). It
//! serves two roles: the **opponent** the player faces (with difficulty
//! [`Level`]s), and the **exact oracle** the AI-scoring harness grades moves
//! against — [`solve`] returns the game-theoretic value (win/draw/loss +
//! distance) of any position, so move quality is judged, not estimated.

#![warn(missing_docs)]

pub mod bitboard;
pub mod live;
pub mod solver;

pub use bitboard::Position;
pub use live::{best_move_capped, choose_capped, heuristic};
pub use solver::{best_move, choose, evaluate, solve, Eval, Level, Solver};
