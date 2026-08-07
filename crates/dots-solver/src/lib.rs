//! Dots and Boxes engine — the opponent, the difficulty band, and the tutor.
//!
//! The value of a position here is a **box margin**, not a win/draw/loss class,
//! which is what this game brings to the shelf's adversarial family. The class a
//! difficulty band preserves is therefore the **sign** of that margin, and since
//! nine boxes cannot split evenly, that class is only ever win or loss — there is
//! no draw to preserve.
//!
//! Three layers, in the order they matter:
//!
//! - [`search`] — the exact solve (below [`search::TRACTABLE_EDGES`] free edges,
//!   where the sign of a value is a *proven* class) and the depth-capped search
//!   above it. The `exact` flag everything else keys off comes from here, and it
//!   reports whether the search **completed**, never what the position looks like.
//! - [`live`] — the shipped opponent: per-level depth, class floor, and
//!   sloppiness, fed through the shared `adversary_solver::select_in_band`.
//! - [`tutor`] — engine-grounded coaching whose wording is bound to `exact`: it
//!   may say a move *threw the game* only when the value proves it.

#![warn(missing_docs)]

pub mod live;
pub mod search;
pub mod tutor;

pub use live::{choose, live_band, Level};
pub use search::{
    heuristic, move_values, move_values_capped, Exact, CAPPED_NODE_BUDGET, EXACT_NODE_BUDGET,
    TRACTABLE_EDGES,
};
pub use tutor::{assess, coach_line, MoveClass, TutorMove, TutorReport, COACH_DEPTH, TUTOR_DEPTH};
