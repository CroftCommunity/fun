//! Engine-grounded tutor facts — the ground truth the deterministic tutor (and,
//! later, an LLM narrator) surfaces for coaching. Every fact comes from the
//! solver, so it cannot be wrong.
//!
//! Two honesty modes, chosen by tractability (the same [`TRACTABLE_EMPTIES`]
//! switch the shipped [`crate::live::live_band`] opponent uses): in the endgame
//! (≤ [`TRACTABLE_EMPTIES`] empties) the facts are the **exact** oracle's and are
//! provably right; earlier they come from the fast depth-capped search and are
//! **horizon-approximate**. [`TutorReport::exact`] says which — so the UI can be
//! honest ("that threw a win" only when exact; "looks risky" when capped).

use drop4_core::{apply_move, legal_cols, winner, Board, Col};

use crate::live::capped_class;
use crate::{move_values_capped, Solver};

/// Empties at or below which the exact oracle is fast enough that tutor facts
/// are **provably exact**; above it, facts come from the fast depth-capped
/// search and are horizon-approximate. The same threshold the shipped live
/// opponent uses for its exact/capped switch.
pub const TRACTABLE_EMPTIES: usize = 16;

/// Search depth for the capped (early-position) tutor facts — matches the Hard
/// live opponent's sight, deep enough to see immediate wins/threats that drive
/// the honest "looks risky" wording.
const TUTOR_CAPPED_DEPTH: u32 = 8;

/// A move's quality relative to the position's best move.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveClass {
    /// Achieves the position's best value (nothing is strictly better).
    Optimal,
    /// Keeps the same win/draw/loss class as best, but is not the best value.
    ResultPreserving,
    /// Drops the win/draw/loss class (e.g. throws away a win).
    Blunder,
}

/// One legal move's engine-grounded tutor facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TutorMove {
    /// The column this move drops in.
    pub col: Col,
    /// This move's value (side-to-move perspective; higher is better). Exact or
    /// capped per [`TutorReport::exact`].
    pub value: i32,
    /// The best value available in the position (the same scoring mode as
    /// `value`).
    pub best_value: i32,
    /// How far below `best_value` this move is (`0` = optimal).
    pub regret: i32,
    /// This move's quality relative to the best move.
    pub quality: MoveClass,
    /// This move completes a four-in-a-row now (wins immediately). Always exact
    /// (one-ply), regardless of [`TutorReport::exact`].
    pub immediate_win: bool,
    /// This move blocks an immediate winning threat the opponent had. Always
    /// exact (one-ply).
    pub blocks_opponent_win: bool,
}

/// The whole position's engine-grounded tutor assessment.
#[derive(Debug, Clone)]
pub struct TutorReport {
    /// One entry per legal move. Empty if the position is terminal.
    pub moves: Vec<TutorMove>,
    /// The column achieving `best_value` (the first, if several tie). `None` if
    /// the position is terminal.
    pub best_col: Option<Col>,
    /// `true` when the facts are the exact oracle's (provably right, endgame);
    /// `false` when they are the horizon-approximate capped search's (early).
    pub exact: bool,
}

/// Grade `value` against the position's `best` value, bucketing win/draw/loss
/// class with `class_of` (`i32::signum` for exact values, [`capped_class`] for
/// capped ones). Equal value = `Optimal`; same class = `ResultPreserving`; a
/// dropped class = `Blunder`.
fn quality(value: i32, best: i32, class_of: impl Fn(i32) -> i32) -> MoveClass {
    if value == best {
        MoveClass::Optimal
    } else if class_of(value) == class_of(best) {
        MoveClass::ResultPreserving
    } else {
        MoveClass::Blunder
    }
}

/// Whether dropping `mv` completes a four-in-a-row for the side to move now.
fn is_immediate_win(board: &Board, mv: Col) -> bool {
    winner(&apply_move(board, mv)) == Some(board.to_move)
}

/// Whether `mv` occupies the square where the opponent would otherwise win on
/// their next move (blocks an immediate opponent threat). One-ply, oracle-free.
fn blocks_opponent_win(board: &Board, mv: Col) -> bool {
    let opp = board.to_move.other();
    let mut as_opp = *board;
    as_opp.to_move = opp;
    legal_cols(&as_opp).contains(&mv) && winner(&apply_move(&as_opp, mv)) == Some(opp)
}

/// Engine-grounded [`TutorReport`] for the current position: every legal move's
/// value, quality, regret, and one-ply threat facts, plus the best move and
/// whether the facts are `exact`. Exact (`i32::signum` classes) in the endgame
/// (≤ [`TRACTABLE_EMPTIES`] empties), capped (horizon-approximate,
/// [`capped_class`] classes) earlier. Never panics.
#[must_use]
pub fn assess(board: &Board, solver: &mut Solver) -> TutorReport {
    let empties = board.cells.iter().filter(|&&v| v == 0).count();
    let exact = empties <= TRACTABLE_EMPTIES;
    let values = if exact {
        solver.move_values(board)
    } else {
        move_values_capped(board, TUTOR_CAPPED_DEPTH)
    };
    let Some(best_value) = values.iter().map(|&(_, v)| v).max() else {
        return TutorReport {
            moves: Vec::new(),
            best_col: None,
            exact,
        };
    };
    let class_of: fn(i32) -> i32 = if exact { i32::signum } else { capped_class };
    let best_col = values
        .iter()
        .find(|&&(_, v)| v == best_value)
        .map(|&(c, _)| c);
    let moves = values
        .iter()
        .map(|&(col, value)| TutorMove {
            col,
            value,
            best_value,
            regret: best_value - value,
            quality: quality(value, best_value, class_of),
            immediate_win: is_immediate_win(board, col),
            blocks_opponent_win: blocks_opponent_win(board, col),
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
    use super::{assess, MoveClass};
    use crate::Solver;
    use adversary_core::Side;
    use drop4_core::{Board, Col, WIDTH};

    // A late (16-empty, fast to solve) position: A to move, col 6 the only win
    // (+), cols 0-4 all lose (-). Shared with drop4-harness / the solver tests.
    #[rustfmt::skip]
    const BLUNDER_FIXTURE: [u8; 42] = [
        2, 1, 2, 1, 1, 1, 2,
        0, 2, 2, 1, 2, 2, 2,
        0, 1, 0, 2, 2, 2, 1,
        0, 2, 0, 0, 2, 1, 1,
        0, 1, 0, 0, 0, 1, 1,
        0, 0, 0, 0, 0, 1, 0,
    ];

    fn board(cells: [u8; 42]) -> Board {
        Board {
            cells,
            to_move: Side::A,
        }
    }

    #[test]
    fn exact_mode_grades_the_only_win_optimal_and_a_loser_a_blunder() {
        // 16 empties → provably exact. Col 6 is the only win → Optimal; cols 0-4
        // throw the win → Blunder. The exact flag must be set.
        let mut solver = Solver::new();
        let report = assess(&board(BLUNDER_FIXTURE), &mut solver);
        assert!(report.exact, "a 16-empty position is exact");
        assert_eq!(report.best_col, Some(Col(6)), "col 6 is the best move");

        let q = |c: u8| {
            report
                .moves
                .iter()
                .find(|m| m.col == Col(c))
                .map(|m| m.quality)
        };
        assert_eq!(q(6), Some(MoveClass::Optimal), "the only win is Optimal");
        assert_eq!(
            q(0),
            Some(MoveClass::Blunder),
            "throwing the win is a Blunder"
        );
        // The best move has zero regret; the blunder has positive regret.
        let m6 = report.moves.iter().find(|m| m.col == Col(6)).unwrap();
        let m0 = report.moves.iter().find(|m| m.col == Col(0)).unwrap();
        assert_eq!(m6.regret, 0, "the best move has no regret");
        assert!(m0.regret > 0, "the blunder trails the best value");
    }

    #[test]
    fn capped_mode_grades_optimal_and_result_preserving_early() {
        // An early, asymmetric position (41 empties → capped, horizon-approximate):
        // one move is tightest (Optimal), others are the same unresolved class but
        // not best (ResultPreserving). Pins the middle branch through the public
        // API in capped mode, and the capped flag.
        let mut pos = Board::empty();
        pos = drop4_core::apply_move(&pos, Col(3));
        pos = drop4_core::apply_move(&pos, Col(4));
        let mut solver = Solver::new();
        let report = assess(&pos, &mut solver);
        assert!(!report.exact, "an opening position is capped, not exact");
        assert!(
            report.moves.iter().any(|m| m.quality == MoveClass::Optimal),
            "there is a tightest (Optimal) move"
        );
        assert!(
            report
                .moves
                .iter()
                .any(|m| m.quality == MoveClass::ResultPreserving),
            "a same-class non-best move is ResultPreserving, not a Blunder"
        );
    }

    #[test]
    fn exact_flag_flips_at_the_tractable_boundary() {
        // 16 empties → exact; 17 empties → capped. Names the edge so a `<=`→`<`
        // mutation on the threshold is caught (not a single-point assertion).
        let mut solver = Solver::new();
        assert!(
            assess(&board(BLUNDER_FIXTURE), &mut solver).exact,
            "16 empties is exact"
        );

        // Remove the topmost disc of column 6 → 17 empties, still gravity-valid
        // and non-terminal (removing a disc cannot complete a line).
        let mut cells = BLUNDER_FIXTURE;
        for r in (0..6usize).rev() {
            if cells[r * WIDTH + 6] != 0 {
                cells[r * WIDTH + 6] = 0;
                break;
            }
        }
        assert_eq!(
            cells.iter().filter(|&&v| v == 0).count(),
            17,
            "now 17 empties"
        );
        assert!(
            !assess(&board(cells), &mut solver).exact,
            "17 empties is capped, not exact"
        );
    }

    #[test]
    fn one_ply_facts_flag_the_win_and_the_block() {
        // Immediate win: A has three in col 0 (after [0,1,0,1,0,1]) → col 0 wins now.
        let mut pos = Board::empty();
        for c in [0u8, 1, 0, 1, 0, 1] {
            pos = drop4_core::apply_move(&pos, Col(c));
        }
        let mut solver = Solver::new();
        let win = assess(&pos, &mut solver);
        let m0 = win.moves.iter().find(|m| m.col == Col(0)).unwrap();
        assert!(m0.immediate_win, "col 0 completes four-in-a-row now");

        // Block: after [0,3,1,3,2,3] B threatens col 3 → A's col 3 blocks it.
        let mut pos = Board::empty();
        for c in [0u8, 3, 1, 3, 2, 3] {
            pos = drop4_core::apply_move(&pos, Col(c));
        }
        let block = assess(&pos, &mut solver);
        let m3 = block.moves.iter().find(|m| m.col == Col(3)).unwrap();
        assert!(m3.blocks_opponent_win, "col 3 blocks B's immediate threat");
    }
}
