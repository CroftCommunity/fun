//! Chess engine: the horizon evaluation, the search, and (Phase 5) the
//! difficulty band and tutor.
//!
//! Chess is not solved and has no affordable endgame solve (the checkers D3
//! lesson applies with more force — pieces cycle, the tree is bounded by the
//! clocks, not by material). So the Oracle here takes checkers' honest shape:
//! a heuristic alpha-beta throughout, whose [`search::Scored::exact`] flag is
//! set **only** when a value traces to a real terminal reached inside the
//! search — checkmate, stalemate, insufficient material, the 50-move clock or
//! the third repetition. "Up a pawn" is never exact.

#![warn(missing_docs)]

pub mod eval;
pub mod live;
pub mod search;
pub mod tutor;

pub use adversary_solver::NodeBudget;
pub use eval::{heuristic, phase, MATE};
pub use live::{choose, class_of, live_band, Level};
pub use search::{
    best_move, move_scores, move_scores_with, move_values, search_root, Scored, SearchReport, Table,
};
pub use tutor::{assess, assess_for_move, coach_line, MoveClass, TutorMove, TutorReport};
