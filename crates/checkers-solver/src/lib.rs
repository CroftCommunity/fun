//! English draughts (checkers) engine — the classic opponent and the honest
//! oracle.
//!
//! Checkers is **not solved from the opening**, and — unlike Othello — it is not
//! solvable in the endgame either. Othello's empties strictly decrease, so "few
//! empties" is a hard bound on the tree; checkers positions **cycle** (kings
//! shuffle), so the tree is bounded by the 80-ply no-progress horizon rather than
//! by material. Phase 0 measured it: a four-piece endgame is ~3.8M nodes and 1.2s
//! natively *with* a transposition table, and no piece count makes a full solve
//! affordable.
//!
//! So this crate's honesty flag means something narrower and still useful:
//!
//! > A value is `exact` when it is a **true value** (not an alpha-beta bound)
//! > whose principal variation ends in a **real terminal position** — all pieces
//! > captured, no legal move, or the no-progress draw — rather than in a
//! > heuristic evaluation at the horizon.
//!
//! That is the same guarantee the flag always licensed. It never promised a full
//! solve; it promised that a win/draw/loss **class** claim is provable, and a
//! forced win found at depth 7 proves that class exactly as well as exhausting
//! the position would. Heuristic cutoffs stay `exact: false` and the tutor hedges.
//!
//! Integer-only on any compared path so `native == wasm`.

#![warn(missing_docs)]

pub mod eval;
pub mod live;
pub mod search;
pub mod tutor;

pub use eval::{heuristic, KING, MAN};
pub use live::{capped_class, choose, live_band, select_in_band, LiveBand};
pub use search::{best_move, move_scores, move_values, Level, Scored, TRACTABLE_PIECES};
pub use tutor::{assess, MoveClass, TutorMove, TutorReport};
