//! Engine-grounded tutor facts — the ground truth the deterministic tutor (and
//! an LLM narrator) surfaces. Every fact comes from the search, so it cannot be
//! wrong about what it claims.
//!
//! Two honesty modes, chosen by tractability (the same [`TRACTABLE_EMPTIES`]
//! switch the live opponent uses): in the deep endgame (≤ `TRACTABLE_EMPTIES`
//! empties) the facts are the **exact** solve's and provably right; earlier they
//! come from the depth-capped heuristic and are **horizon-approximate**.
//! [`TutorReport::exact`] says which — so the UI can be honest ("that threw the
//! game" only when exact; "looks risky" when heuristic). Because a heuristic
//! value proves no win/draw/loss class (Othello is unsolved early), capped mode
//! **never** grades a move a `Blunder` — the honesty invariant.

use othello_core::{Board, Move};

use crate::live::capped_class;
use crate::search::{move_values, TRACTABLE_EMPTIES};

/// Search depth for the capped (early-position) tutor facts.
const TUTOR_CAPPED_DEPTH: u32 = 5;

/// The four corner cell indices — permanent, un-flippable, the strongest squares.
const CORNERS: [u8; 4] = [0, 7, 56, 63];

/// A move's quality relative to the position's best move.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveClass {
    /// Achieves the position's best value (nothing is strictly better).
    Optimal,
    /// Keeps the same win/draw/loss class as best, but is not the best value.
    ResultPreserving,
    /// Drops the win/draw/loss class (only distinguishable in the exact endgame).
    Blunder,
}

/// One legal placement's engine-grounded tutor facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TutorMove {
    /// The cell index this move places at.
    pub col: u8,
    /// This move's value (side-to-move perspective; higher is better). Exact
    /// (disc differential) or capped (heuristic) per [`TutorReport::exact`].
    pub value: i32,
    /// The best value available in the position.
    pub best_value: i32,
    /// How far below `best_value` this move is (`0` = optimal).
    pub regret: i32,
    /// This move's quality relative to the best move.
    pub quality: MoveClass,
    /// This move claims a corner (permanent, high-value). Othello's one-ply fact
    /// (there is no immediate line-win or single-square block as in Drop 4).
    pub takes_corner: bool,
}

/// The whole position's engine-grounded tutor assessment.
#[derive(Debug, Clone)]
pub struct TutorReport {
    /// One entry per legal **placement**. Empty if terminal or a forced pass
    /// (nothing to choose — the UI auto-passes).
    pub moves: Vec<TutorMove>,
    /// The cell index achieving `best_value` (the first, if several tie). `None`
    /// if there is nothing to assess.
    pub best_col: Option<u8>,
    /// `true` when the facts are the exact solve's (endgame); `false` when they
    /// are the horizon-approximate heuristic's (early).
    pub exact: bool,
}

/// Grade `value` against `best`, bucketing win/draw/loss class with `class_of`.
/// Equal value = `Optimal`; same class = `ResultPreserving`; a dropped class =
/// `Blunder`. In capped mode `class_of` is [`capped_class`] (always `0`), so no
/// move is ever a `Blunder` early — the honesty invariant.
fn quality(value: i32, best: i32, class_of: impl Fn(i32) -> i32) -> MoveClass {
    if value == best {
        MoveClass::Optimal
    } else if class_of(value) == class_of(best) {
        MoveClass::ResultPreserving
    } else {
        MoveClass::Blunder
    }
}

/// Engine-grounded [`TutorReport`] for `board`: every legal placement's value,
/// quality, regret, and the corner fact, plus the best cell and whether the
/// facts are `exact`. Exact (`i32::signum` classes) in the endgame
/// (≤ [`TRACTABLE_EMPTIES`] empties), capped ([`capped_class`], all unresolved)
/// earlier. A terminal or forced-pass position yields an empty report. Never
/// panics.
#[must_use]
pub fn assess(board: &Board) -> TutorReport {
    let empties = board.cells.iter().filter(|&&v| v == 0).count();
    let exact = empties <= TRACTABLE_EMPTIES;
    let depth = if exact { 0 } else { TUTOR_CAPPED_DEPTH };
    // Only Place moves are assessable; a lone Pass (or terminal) has nothing to
    // choose between, so the report is empty and the UI auto-passes.
    let places: Vec<(u8, i32)> = move_values(board, depth)
        .into_iter()
        .filter_map(|(mv, v)| match mv {
            Move::Place(idx) => Some((idx, v)),
            Move::Pass => None,
        })
        .collect();
    let Some(best_value) = places.iter().map(|&(_, v)| v).max() else {
        return TutorReport {
            moves: Vec::new(),
            best_col: None,
            exact,
        };
    };
    let class_of: fn(i32) -> i32 = if exact { i32::signum } else { capped_class };
    let best_col = places
        .iter()
        .find(|&&(_, v)| v == best_value)
        .map(|&(c, _)| c);
    let moves = places
        .iter()
        .map(|&(col, value)| TutorMove {
            col,
            value,
            best_value,
            regret: best_value - value,
            quality: quality(value, best_value, class_of),
            takes_corner: CORNERS.contains(&col),
        })
        .collect();
    TutorReport {
        moves,
        best_col,
        exact,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::{Adversary, Side};
    use othello_core::{
        apply_move, legal_moves, legal_places, result, Board as OBoard, Othello, CELLS,
    };

    #[test]
    fn opening_is_capped_and_never_grades_a_blunder() {
        // The start (54 empties) is horizon-approximate: exact=false, and because
        // a heuristic proves no class, no move is ever a Blunder — the honesty
        // invariant the tutor's hedged wording relies on.
        let report = assess(&<Othello as Adversary>::initial(0));
        assert!(!report.exact, "the opening is capped, not exact");
        assert!(report.best_col.is_some(), "there is a best opening move");
        assert!(
            report.moves.iter().all(|m| m.quality != MoveClass::Blunder),
            "capped mode never claims a Blunder"
        );
    }

    #[test]
    fn corner_move_carries_the_takes_corner_fact() {
        // The (0,0) corner is a legal placement (flips (0,1)); a C-square is too.
        let mut cells = [0u8; CELLS];
        cells[2] = 1; // (0,2) A
        cells[1] = 2; // (0,1) B
        cells[24] = 1; // (3,0) A
        cells[16] = 2; // (2,0) B
        let board = OBoard {
            cells,
            to_move: Side::A,
        };
        let report = assess(&board);
        let corner = report.moves.iter().find(|m| m.col == 0).unwrap();
        let c_square = report.moves.iter().find(|m| m.col == 8).unwrap();
        assert!(corner.takes_corner, "the (0,0) placement takes a corner");
        assert!(!c_square.takes_corner, "the C-square does not");
    }

    #[test]
    fn exact_endgame_grades_optimal_and_a_class_dropping_move_a_blunder() {
        // Endgame disc counts swing hard per move, so a knife-edge position (one
        // move wins, another loses for the same mover) is common — but only in a
        // contested game. Scan many diverse seeded-random games' exact positions
        // for the first class split, then assert the best is Optimal and a
        // class-dropping move is a Blunder — proving exact grading (the honest
        // "that threw the game" wording).
        use rand_chacha::rand_core::{RngCore, SeedableRng};
        use rand_chacha::ChaCha20Rng;
        let mut found = false;
        'games: for seed in 0..40u64 {
            let mut rng = ChaCha20Rng::seed_from_u64(seed);
            let mut pos = <Othello as Adversary>::initial(0);
            while result(&pos).is_none() {
                let empties = pos.cells.iter().filter(|&&v| v == 0).count();
                if empties <= TRACTABLE_EMPTIES && legal_places(&pos).len() >= 2 {
                    let report = assess(&pos);
                    assert!(report.exact, "an endgame position is exact");
                    let optimal = report
                        .moves
                        .iter()
                        .find(|m| m.quality == MoveClass::Optimal);
                    let blunder = report
                        .moves
                        .iter()
                        .find(|m| m.quality == MoveClass::Blunder);
                    if let (Some(opt), Some(bl)) = (optimal, blunder) {
                        assert_eq!(opt.regret, 0, "the best move has no regret");
                        assert!(bl.regret > 0, "a blunder trails the best value");
                        assert!(
                            bl.value.signum() != opt.value.signum(),
                            "a blunder drops the class"
                        );
                        found = true;
                        break 'games;
                    }
                }
                let moves = legal_moves(&pos);
                pos = apply_move(&pos, moves[(rng.next_u32() as usize) % moves.len()]);
            }
        }
        assert!(
            found,
            "a diverse endgame offered a class-split position to grade"
        );
    }
}
