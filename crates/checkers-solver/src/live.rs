//! The difficulty band — how the shipped opponent turns a search into a level.
//!
//! The selector itself is `adversary_solver::select_in_band`, shared with Drop 4
//! and Othello. What stays here is the part that is genuinely checkers': how a
//! value maps to a win/draw/loss **class**, and what each level's knobs are.
//!
//! ## Why [`capped_class`] is Drop 4's shape and not Othello's
//!
//! The plan called for Othello's shape — a constant `0`, on the reasoning that
//! checkers is unsolved early so a heuristic proves no class. The reasoning is
//! right and the shape is wrong, because of a structural difference the plan
//! predates.
//!
//! Othello can afford a constant because it has a **position-level** tractability
//! switch: below `TRACTABLE_EMPTIES` its `choose` swaps `capped_class` out for
//! `i32::signum`, and the class floor comes alive for the whole endgame. Checkers
//! has no such switch — Phase 0 measured that no piece count makes a full solve
//! affordable, so exactness here is **per move**, not per position. A constant `0`
//! would therefore leave `preserve_class` permanently dead: Hard and Expert could
//! throw a *proven* win, which is the exact failure the class floor exists to
//! prevent.
//!
//! So the class comes from the value's magnitude. Only a terminal can produce one
//! above [`TERMINAL_MAGNITUDE`] — the heuristic's ceiling is a few thousand — so
//! an ordinary horizon judgement classifies as `0` (unknown, as Othello wants)
//! and a terminal-derived value classifies by its sign (as Drop 4 wants). One
//! function, both behaviours, no switch.
//!
//! Note this is the **band's** classification, not the tutor's. The band is
//! choosing a move, so a magnitude that is *probably* a win is good enough to
//! steer by. The tutor makes claims to a person, so it uses the search's real
//! per-move `exact` flag instead — see [`crate::tutor`].

use checkers_core::{legal_moves, result, Board, Move};
use rand_chacha::rand_core::RngCore;

// Re-exported so `checkers_solver::live::*` names them, matching the other two
// games; the extraction is not meant to be visible to callers.
pub use adversary_solver::{select_in_band, LiveBand};

use crate::search::{move_values, Level};

/// Above this magnitude, a value can only have come from a terminal position —
/// the heuristic's ceiling is 24 pieces of material plus mobility, a few thousand.
const TERMINAL_MAGNITUDE: i32 = 500_000;

/// The win/draw/loss class of a value: `1` a terminal-derived win, `-1` a
/// terminal-derived loss, `0` an unresolved horizon judgement.
///
/// See the module docs for why this classifies by magnitude rather than returning
/// a constant `0` as Othello's does.
#[must_use]
pub fn capped_class(value: i32) -> i32 {
    if value > TERMINAL_MAGNITUDE {
        1
    } else if value < -TERMINAL_MAGNITUDE {
        -1
    } else {
        0
    }
}

/// The [`LiveBand`] for a [`Level`]: Easy/Medium are shallow, sloppy and
/// beatable; Hard/Expert are deep and class-preserving (never throw a game the
/// search can see the end of), Expert with no sloppiness at all.
#[must_use]
pub fn live_band(level: Level) -> LiveBand {
    match level {
        Level::Easy => LiveBand {
            depth: level.depth(),
            preserve_class: false,
            sloppiness_pct: 60,
        },
        Level::Medium => LiveBand {
            depth: level.depth(),
            preserve_class: false,
            sloppiness_pct: 30,
        },
        Level::Hard => LiveBand {
            depth: level.depth(),
            preserve_class: true,
            sloppiness_pct: 40,
        },
        Level::Expert => LiveBand {
            depth: level.depth(),
            preserve_class: true,
            sloppiness_pct: 0,
        },
    }
}

/// A live opponent move at `level`, or `None` if the position is terminal.
///
/// Capture is mandatory, so in a forced position this returns the one legal
/// chain whatever the level says — difficulty in checkers lives in the *choice*
/// of chain and in the quiet moves between them.
#[must_use]
pub fn choose(board: &Board, level: Level, rng: &mut impl RngCore) -> Option<Move> {
    if result(board).is_some() || legal_moves(board).is_empty() {
        return None;
    }
    let band = live_band(level);
    let values = move_values(board, band.depth);
    select_in_band(
        &values,
        capped_class,
        band.preserve_class,
        band.sloppiness_pct,
        rng,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::{Adversary, Side};
    use checkers_core::{cell_of, square_at, Checkers, Piece};
    use rand_chacha::rand_core::SeedableRng;
    use rand_chacha::ChaCha20Rng;

    fn sq(row: isize, col: isize) -> u8 {
        square_at(row, col).expect("fixture coordinate is a dark square")
    }

    fn fixture(to_move: Side, pieces: &[(isize, isize, Piece)]) -> Board {
        let mut board = Board::empty(to_move);
        for &(row, col, piece) in pieces {
            board.cells[sq(row, col) as usize] = cell_of(piece);
        }
        board
    }

    #[test]
    fn the_class_comes_from_the_value_magnitude_not_a_constant() {
        // Both branches, because this function is the whole reason `preserve_class`
        // can do anything at all in checkers.
        assert_eq!(capped_class(0), 0, "an even horizon judgement");
        assert_eq!(capped_class(4_000), 0, "a strong heuristic proves nothing");
        assert_eq!(capped_class(-4_000), 0);
        assert_eq!(capped_class(TERMINAL_MAGNITUDE), 0, "the boundary itself");
        assert_eq!(capped_class(TERMINAL_MAGNITUDE + 1), 1, "one past it");
        assert_eq!(capped_class(-TERMINAL_MAGNITUDE - 1), -1);
        assert_eq!(capped_class(1_000_008), 1, "a real terminal win value");
    }

    #[test]
    fn the_class_floor_never_throws_a_game_the_search_can_see_the_end_of() {
        // A king and a man against one man, one ply from a capture that wins
        // outright — and a quiet alternative that does not. Level::Hard has the
        // floor on and 40% sloppiness, so without the floor it would throw this
        // roughly two times in five.
        // A king loose against a lone man. Two of its four moves force the
        // capture inside the horizon and two wander off, so the floor has a real
        // choice to get wrong — and Hard's 40% sloppiness would take it.
        let pos = fixture(
            Side::A,
            &[(2, 1, Piece::king(Side::A)), (5, 2, Piece::man(Side::B))],
        );
        let winning: Vec<Move> = move_values(&pos, Level::Hard.depth())
            .into_iter()
            .filter(|&(_, v)| capped_class(v) > 0)
            .map(|(mv, _)| mv)
            .collect();
        assert!(!winning.is_empty(), "the fixture has a winning move");
        assert!(
            winning.len() < legal_moves(&pos).len(),
            "and a non-winning one, or the floor has nothing to choose between"
        );

        let mut rng = ChaCha20Rng::seed_from_u64(3);
        for _ in 0..200 {
            let mv = choose(&pos, Level::Hard, &mut rng).expect("a live position");
            assert!(
                winning.contains(&mv),
                "the floor admitted a class drop: {mv:?}"
            );
        }

        // The other side of the branch: Easy has no floor, so it may throw it —
        // otherwise "the floor works" is indistinguishable from "the search only
        // ever returns the best move".
        let mut rng = ChaCha20Rng::seed_from_u64(5);
        let threw = (0..200)
            .any(|_| choose(&pos, Level::Easy, &mut rng).is_some_and(|mv| !winning.contains(&mv)));
        assert!(threw, "Easy is supposed to be beatable");
    }

    #[test]
    fn expert_is_deterministic_and_returns_a_legal_move() {
        let pos = <Checkers as Adversary>::initial(0);
        let mut first = ChaCha20Rng::seed_from_u64(1);
        let mut second = ChaCha20Rng::seed_from_u64(2);
        // Expert has zero sloppiness, so its move cannot depend on the rng.
        let a = choose(&pos, Level::Expert, &mut first).expect("a live position");
        let b = choose(&pos, Level::Expert, &mut second).expect("a live position");
        assert_eq!(a, b, "Expert (no sloppiness) is deterministic");
        assert!(legal_moves(&pos).contains(&a), "and returns a legal move");
    }

    #[test]
    fn a_terminal_position_has_no_move_to_choose() {
        let over = fixture(Side::A, &[(7, 6, Piece::man(Side::B))]);
        let mut rng = ChaCha20Rng::seed_from_u64(1);
        assert_eq!(choose(&over, Level::Expert, &mut rng), None);

        // ...and so does a drawn one, which is a different terminal condition and
        // reaches `None` by a different route (`legal_moves` is empty at the draw).
        let mut drawn = fixture(
            Side::A,
            &[(0, 1, Piece::king(Side::A)), (7, 6, Piece::king(Side::B))],
        );
        drawn.no_progress = 80;
        assert_eq!(choose(&drawn, Level::Expert, &mut rng), None);
    }
}
