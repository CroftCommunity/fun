//! Engine-side building blocks for the hybrid player ("classic search + LLM").
//!
//! The engine (exact Oracle) produces two things the browser LLM layer consumes:
//! a difficulty [`band`] of candidate moves, and a per-move [`assess`]ment (the
//! ground truth for explanation / tutoring). The LLM selects within the band and
//! narrates the assessment — its facts are **correct by construction** because
//! the engine supplies them. See `docs/AI-PLAYERS.md`.
//!
//! Difficulty is two independent knobs: a **class floor** (never drop the
//! win/draw/loss class → never throw the game) and **within-class regret** (band
//! width Δ). The LLM adds no strength here (measured ≈ random-in-band); its role
//! is legality + personality + explanation.

use drop4_core::{apply_move, legal_cols, winner, Board, Col};
use drop4_solver::Solver;

use crate::MoveQuality;

/// Whether the band may include moves that drop the win/draw/loss class.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClassFloor {
    /// Allow any in-Δ move, including class-dropping (blundering) ones — easier.
    Any,
    /// Keep only moves that preserve the best achievable class — **never throws
    /// the game** (0 blunders by construction).
    PreserveBestClass,
}

/// A candidate move in the difficulty band, with its exact value and quality.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Candidate {
    /// The column to drop in.
    pub col: Col,
    /// Exact value (side-to-move perspective; higher is better).
    pub value: i32,
    /// Quality relative to the best move.
    pub quality: MoveQuality,
}

/// Engine-grounded assessment of a single move — the ground truth the LLM
/// narrates for explanation / tutoring (it cannot get these facts wrong).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MoveAssessment {
    /// The move assessed.
    pub col: Col,
    /// Quality relative to the best move.
    pub quality: MoveQuality,
    /// Exact value of this move.
    pub value: i32,
    /// Exact value of the best move in the position.
    pub best_value: i32,
    /// How far below the best value this move is (0 = optimal).
    pub regret: i32,
    /// This move completes a four-in-a-row now (wins immediately).
    pub immediate_win: bool,
    /// This move blocks an immediate winning threat the opponent had.
    pub blocks_opponent_win: bool,
}

fn quality_of(value: i32, best: i32) -> MoveQuality {
    if value == best {
        MoveQuality::Optimal
    } else if value.signum() == best.signum() {
        MoveQuality::ResultPreserving
    } else {
        MoveQuality::Blunder
    }
}

/// Whether dropping `mv` completes a four-in-a-row for the side to move now.
#[must_use]
pub fn is_immediate_win(board: &Board, mv: Col) -> bool {
    winner(&apply_move(board, mv)) == Some(board.to_move)
}

/// Whether `mv` occupies the square where the opponent would otherwise win on
/// their next move (i.e. it blocks an immediate opponent threat). One-ply and
/// oracle-free — cheap on any position.
#[must_use]
pub fn blocks_opponent_win(board: &Board, mv: Col) -> bool {
    let opp = board.to_move.other();
    let mut as_opp = *board;
    as_opp.to_move = opp;
    legal_cols(&as_opp).contains(&mv) && winner(&apply_move(&as_opp, mv)) == Some(opp)
}

/// The difficulty band: legal moves within `delta` of the exact best value,
/// filtered by the `floor`. Empty if the board is terminal. `PreserveBestClass`
/// guarantees no blunder (class drop) is admitted regardless of `delta`.
#[must_use]
pub fn band(board: &Board, floor: ClassFloor, delta: i32, solver: &mut Solver) -> Vec<Candidate> {
    let values = solver.move_values(board);
    let Some(best) = values.iter().map(|&(_, v)| v).max() else {
        return Vec::new();
    };
    values
        .into_iter()
        .filter_map(|(col, value)| {
            if value < best - delta {
                return None;
            }
            let quality = quality_of(value, best);
            if floor == ClassFloor::PreserveBestClass && quality == MoveQuality::Blunder {
                return None;
            }
            Some(Candidate {
                col,
                value,
                quality,
            })
        })
        .collect()
}

/// Engine-grounded assessment of `mv` — the facts an LLM narrates for tutoring.
#[must_use]
pub fn assess(board: &Board, mv: Col, solver: &mut Solver) -> MoveAssessment {
    let values = solver.move_values(board);
    let best = values.iter().map(|&(_, v)| v).max().unwrap_or(0);
    let value = values
        .iter()
        .find(|&&(c, _)| c == mv)
        .map_or(best, |&(_, v)| v);
    MoveAssessment {
        col: mv,
        quality: quality_of(value, best),
        value,
        best_value: best,
        regret: best - value,
        immediate_win: is_immediate_win(board, mv),
        blocks_opponent_win: blocks_opponent_win(board, mv),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::Adversary;
    use drop4_core::Drop4;

    fn play(cols: &[u8]) -> Board {
        let mut pos = <Drop4 as Adversary>::initial(0);
        for &c in cols {
            pos = <Drop4 as Adversary>::apply(&pos, Col(c));
        }
        pos
    }

    // A late (16-empty, fast) position: A to move, col 6 the only win (+),
    // cols 0-4 all lose (-). Independent solver; shared with drop4-solver.
    #[rustfmt::skip]
    const BLUNDER_FIXTURE: [u8; 42] = [
        2, 1, 2, 1, 1, 1, 2,
        0, 2, 2, 1, 2, 2, 2,
        0, 1, 0, 2, 2, 2, 1,
        0, 2, 0, 0, 2, 1, 1,
        0, 1, 0, 0, 0, 1, 1,
        0, 0, 0, 0, 0, 1, 0,
    ];

    fn blunder_board() -> Board {
        Board {
            cells: BLUNDER_FIXTURE,
            to_move: adversary_core::Side::A,
        }
    }

    #[test]
    fn immediate_win_and_block_are_one_ply_facts() {
        // A has three stacked in col 0 and is to move: col 0 wins now.
        let win_pos = play(&[0, 1, 0, 1, 0, 1]);
        assert!(is_immediate_win(&win_pos, Col(0)));
        assert!(!is_immediate_win(&win_pos, Col(1)));

        // B has three stacked in col 3, A to move: col 3 blocks B's threat.
        let threat = play(&[0, 3, 1, 3, 2, 3]);
        assert!(blocks_opponent_win(&threat, Col(3)));
        assert!(!blocks_opponent_win(&threat, Col(0)));
    }

    #[test]
    fn preserve_class_band_never_includes_a_blunder() {
        let board = blunder_board();
        let mut solver = Solver::new();
        // A wide band, class floor on: only class-preserving moves survive, and
        // col 6 (the only win) is in; the losing cols are dropped.
        let safe = band(&board, ClassFloor::PreserveBestClass, 100, &mut solver);
        assert!(
            safe.iter().all(|c| c.quality != MoveQuality::Blunder),
            "class floor removes every blunder"
        );
        assert!(
            safe.iter().any(|c| c.col == Col(6)),
            "the winning move is in the band"
        );
        // Class floor off: the wide band includes a class-dropping blunder.
        let loose = band(&board, ClassFloor::Any, 100, &mut solver);
        assert!(
            loose.iter().any(|c| c.quality == MoveQuality::Blunder),
            "without the floor, losing moves are admitted"
        );
    }

    #[test]
    fn assess_flags_the_win_and_the_blunder() {
        let board = blunder_board();
        let mut solver = Solver::new();
        let win = assess(&board, Col(6), &mut solver);
        assert_eq!(win.quality, MoveQuality::Optimal);
        assert_eq!(win.regret, 0);
        let blunder = assess(&board, Col(0), &mut solver);
        assert_eq!(blunder.quality, MoveQuality::Blunder);
        assert!(blunder.regret > 0, "a blunder has positive regret");
    }
}
