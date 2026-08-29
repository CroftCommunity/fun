//! The cribbage engine — the shelf's first opponent for a hidden-information
//! game, and the reason its shape differs from `*-solver` crates before it.
//!
//! **Every public function here takes a [`View`], never a `GameState`.** That is
//! the type-level half of the "never peeks" property (the measurement rig holds
//! the other half); `tests` pins it by reading this crate's own source.
//!
//! Strength comes from **expectation over the unseen cards**, not search to a
//! terminal — Phase 0 of the plan measured why: the discard is the whole game
//! (random discarding loses 24 games in 25), the crib term is worth ~5 points of
//! win rate, two plies of pegging lookahead are worth ~6 and a third is worth
//! nothing. There is no class floor because no cribbage move has a class.

#![warn(missing_docs)]

pub mod crib_table;
mod crib_table_data;
pub mod expect;
pub mod live;
pub mod peg;
pub mod tutor;

pub use crib_table::CribTable;
pub use cribbage_core::View;
pub use expect::{discard_options, hand_expectation};
pub use live::{live_move, select, Band, Level};
pub use peg::peg_options;
pub use tutor::{assess, coach_line, Assessment, MoveClass, Report};

#[cfg(test)]
mod tests {
    /// The type-level rule, pinned by reading the source: no public item of this
    /// crate names the full state. A refactor that adds a `&GameState` parameter
    /// fails here before it can ship.
    #[test]
    fn no_public_function_takes_the_full_state() {
        for (name, src) in [
            ("expect", include_str!("expect.rs")),
            ("live", include_str!("live.rs")),
            ("peg", include_str!("peg.rs")),
            ("tutor", include_str!("tutor.rs")),
            ("crib_table", include_str!("crib_table.rs")),
        ] {
            let production = src.split("#[cfg(test)]").next().unwrap_or(src);
            let code: String = production
                .lines()
                .filter(|l| !l.trim_start().starts_with("//"))
                .collect::<Vec<_>>()
                .join("\n");
            assert!(!code.contains("GameState"), "{name}.rs names GameState");
        }
    }
}
