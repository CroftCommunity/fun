//! The Furrow (mancala) engine: an exact endgame solver, a heuristic search
//! above it, the shared difficulty band, and a tutor bound to an honesty flag.

#![warn(missing_docs)]

pub mod eval;
pub mod live;
pub mod search;
pub mod tutor;
