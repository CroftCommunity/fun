//! Engine-grounded tutor facts — the ground truth the tutor panel (and an LLM
//! narrator) surfaces. Every fact comes from the search, so it cannot be wrong
//! about what it claims.
//!
//! ## The honesty invariant, and why checkers states it per move
//!
//! Drop 4 and Othello decide honesty **per position**: a tractability switch says
//! "this position is solved" and the whole report is exact or the whole report is
//! capped. Checkers cannot — Phase 0 measured that no piece count makes a full
//! solve affordable, so [`crate::search::Scored::exact`] is a property of a
//! *move's* value, not of the position.
//!
//! That changes where the invariant lives. Grading a move a `Blunder` is a claim
//! that it **drops the win/draw/loss class**, and proving a drop needs two proofs:
//! that this move's class is what the search says, and that the best move's is
//! too. So a `Blunder` is only ever reported when both values are proven.
//! Everything unproven grades `ResultPreserving` at worst — the tutor says "there
//! was better", never "that threw the game", because early on it does not know.
//!
//! [`TutorReport::exact`] then means "every move in this report is proven", which
//! is what the UI needs to decide between provable wording and hedged wording for
//! the report as a whole.

use checkers_core::{legal_chains, legal_moves, Board};

use crate::search::{move_scores, Level};

/// Search depth for tutor facts. Deeper than the live opponent's Medium, because
/// a tutor is allowed to take longer than a move — and depth is what buys proofs.
const TUTOR_DEPTH: u32 = Level::Hard.depth();

/// A move's quality relative to the position's best move.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveClass {
    /// Achieves the position's best value (nothing is strictly better).
    Optimal,
    /// Not the best value, but does not provably drop the win/draw/loss class.
    ResultPreserving,
    /// Provably drops the win/draw/loss class. Only reachable when both this
    /// move's value and the best move's are proven.
    Blunder,
}

/// One legal move's engine-grounded tutor facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TutorMove {
    /// The packed move code this entry is about. Named `col` for the shared
    /// `TutorFactMove` wire shape the three games' wasm bindings all speak; for
    /// checkers it is a `(from, to, variant)` code, not a column.
    pub col: u16,
    /// This move's value (side-to-move perspective; higher is better).
    pub value: i32,
    /// The best value available in the position.
    pub best_value: i32,
    /// How far below `best_value` this move is (`0` = optimal).
    pub regret: i32,
    /// This move's quality relative to the best move.
    pub quality: MoveClass,
    /// Whether this move's value is a **proven** one. Per move, not per position.
    pub exact: bool,
    /// How many pieces this move captures.
    ///
    /// Checkers' one-ply fact, chosen over `crowns` (see the module-level note in
    /// the plan): material *is* the game here, a learner's first question about a
    /// move is what it takes, and a count carries more signal than a boolean.
    /// Crowning is available from `Chain::crowned` if the panel later wants it,
    /// and is rare enough early that it would read as zero for most of a game.
    pub captures: u8,
}

/// The whole position's engine-grounded tutor assessment.
#[derive(Debug, Clone)]
pub struct TutorReport {
    /// One entry per legal move. Empty when the position is terminal.
    pub moves: Vec<TutorMove>,
    /// The move code achieving `best_value` (the first, if several tie). `None`
    /// when there is nothing to assess.
    pub best_col: Option<u16>,
    /// `true` only when **every** move in the report is proven — see the module
    /// docs. The per-move flag is what grading uses; this is what the UI uses to
    /// pick wording for the report as a whole.
    pub exact: bool,
}

/// Grade `value` against `best`.
///
/// Equal value is `Optimal`. A `Blunder` requires **both** values proven and a
/// genuine class drop between them; anything else is `ResultPreserving`. That is
/// the honesty invariant, and it is why an unproven position can never grade a
/// blunder however bad a move looks.
fn quality(value: i32, value_exact: bool, best: i32, best_exact: bool) -> MoveClass {
    if value == best {
        return MoveClass::Optimal;
    }
    if !(value_exact && best_exact) {
        return MoveClass::ResultPreserving;
    }
    if value.signum() == best.signum() {
        MoveClass::ResultPreserving
    } else {
        MoveClass::Blunder
    }
}

/// The engine-grounded [`TutorReport`] for `board`. A terminal position yields an
/// empty report. Never panics.
#[must_use]
pub fn assess(board: &Board) -> TutorReport {
    let scored = move_scores(board, TUTOR_DEPTH);
    // `legal_chains` is index-aligned with `legal_moves`, and `move_scores`
    // preserves that order — so the capture count for entry `i` is chain `i`'s.
    let chains = legal_chains(board);
    debug_assert_eq!(chains.len(), legal_moves(board).len());

    let Some(&(_, best)) = scored.iter().max_by_key(|&&(_, s)| s.value) else {
        return TutorReport {
            moves: Vec::new(),
            best_col: None,
            exact: false,
        };
    };

    let moves: Vec<TutorMove> = scored
        .iter()
        .enumerate()
        .map(|(i, &(mv, s))| TutorMove {
            col: mv.code(),
            value: s.value,
            best_value: best.value,
            regret: best.value - s.value,
            quality: quality(s.value, s.exact, best.value, best.exact),
            exact: s.exact,
            captures: chains
                .get(i)
                .map_or(0, |c| u8::try_from(c.captures.len()).unwrap_or(u8::MAX)),
        })
        .collect();

    let best_col = moves.iter().find(|m| m.value == best.value).map(|m| m.col);

    TutorReport {
        exact: moves.iter().all(|m| m.exact),
        best_col,
        moves,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::{Adversary, Side};
    use checkers_core::{cell_of, square_at, Checkers, Piece};

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

    /// A king loose against a lone man: two of its four moves force the capture
    /// inside the horizon and two do not, so this is the smallest position where
    /// grading has something to distinguish.
    fn king_hunts_a_lone_man() -> Board {
        fixture(
            Side::A,
            &[(2, 1, Piece::king(Side::A)), (5, 2, Piece::man(Side::B))],
        )
    }

    #[test]
    fn opening_is_capped_and_never_grades_a_blunder() {
        // The wiring test, and the invariant the UI's hedged wording rests on: a
        // heuristic proves no class, so no opening move may be called a blunder
        // however bad it looks.
        let report = assess(&<Checkers as Adversary>::initial(0));
        assert_eq!(report.moves.len(), 7, "the seven textbook opening moves");
        assert!(!report.exact, "nothing is proven this early");
        assert!(report.moves.iter().all(|m| !m.exact));
        assert!(
            report.moves.iter().all(|m| m.quality != MoveClass::Blunder),
            "capped mode must never grade a blunder"
        );
        assert!(report.best_col.is_some());

        // Measured 2026-08-05: all seven opening moves evaluate identically at
        // this depth, so they are all `Optimal` and every regret is zero. That is
        // a fact about checkers openings (famously near-equal — it is why
        // tournament play forces the first three moves) rather than a broken
        // grader, and the assertion below is what keeps the two distinguishable:
        // in a position that *does* have a worse move, the grader finds it.
        assert!(report.moves.iter().all(|m| m.regret == 0));
        let hunting = assess(&king_hunts_a_lone_man());
        assert!(
            hunting.moves.iter().any(|m| m.regret > 0),
            "the grader can tell moves apart when the position can"
        );
    }

    #[test]
    fn a_proven_position_grades_its_proven_moves() {
        let report = assess(&king_hunts_a_lone_man());
        assert_eq!(report.moves.len(), 4);

        let best = report
            .moves
            .iter()
            .find(|m| m.quality == MoveClass::Optimal)
            .expect("some move is optimal");
        assert_eq!(best.regret, 0);
        assert!(best.exact, "the best move's value is proven");
        assert!(best.value > 0, "and it is a win");

        // A second move also forces the win, just a ply later: proven, same class,
        // so `ResultPreserving` — worse, not thrown.
        let slower = report
            .moves
            .iter()
            .find(|m| m.exact && m.regret > 0)
            .expect("a slower proven win");
        assert_eq!(slower.quality, MoveClass::ResultPreserving);

        // ...and the moves that wander off are *not* proven, so they cannot be
        // called blunders however bad they look. This is the honesty rule doing
        // its job, not a gap: the search did not find a win from there inside its
        // horizon, which is not the same as knowing there isn't one.
        let wandering: Vec<_> = report.moves.iter().filter(|m| !m.exact).collect();
        assert_eq!(wandering.len(), 2);
        assert!(wandering
            .iter()
            .all(|m| m.quality == MoveClass::ResultPreserving));
        assert!(!report.exact, "so the report as a whole is not proven");
    }

    #[test]
    fn blunder_is_effectively_unreachable_through_assess_and_that_is_deliberate() {
        // A finding worth pinning rather than leaving as a surprise: grading a
        // blunder needs **both** the played move's value and the best move's to be
        // proven, and in real play that pairing is vanishingly rare — a sweep of
        // 300 random-play positions produced not one. When the best move is a
        // proven win, the alternatives are almost always horizon judgements, and
        // "the search found no win from there within six plies" is not "that threw
        // the game".
        //
        // Two consequences, both deliberate:
        //   * the shipped tutor will say "there was better" far more often than
        //     "that threw it", which is the honest thing for an unsolved game;
        //   * a zero-blunder assertion over a checkers tournament is close to
        //     vacuous, so Phase 15 must lean on `scoredMoves` and the class floor
        //     rather than on a blunder count.
        //
        // The branch itself is covered at the seam by `a_blunder_needs_both_values_proven`,
        // which is the same answer this repo reached for every other unreachable
        // branch: if no real input gets there, test the policy where a test can.
        assert_eq!(quality(-9_000, true, 9_000, true), MoveClass::Blunder);
        let hunting = assess(&king_hunts_a_lone_man());
        assert!(hunting
            .moves
            .iter()
            .all(|m| m.quality != MoveClass::Blunder));
    }

    #[test]
    fn a_multi_capture_carries_its_count() {
        // 6 takes 10 and then 19 — one move, two pieces. The count is the fact a
        // learner actually asks about, which is why it is the one carried.
        let pos = fixture(
            Side::A,
            &[
                (1, 2, Piece::man(Side::A)),
                (2, 3, Piece::man(Side::B)),
                (4, 5, Piece::man(Side::B)),
            ],
        );
        let report = assess(&pos);
        assert_eq!(report.moves.len(), 1, "capture is mandatory");
        assert_eq!(report.moves[0].captures, 2);

        // The other side of the branch: a quiet move captures nothing, or
        // "captures" is just a constant that happens to look right.
        let quiet = fixture(
            Side::A,
            &[(1, 2, Piece::man(Side::A)), (7, 6, Piece::king(Side::B))],
        );
        assert!(assess(&quiet).moves.iter().all(|m| m.captures == 0));
    }

    #[test]
    fn a_blunder_needs_both_values_proven() {
        // The invariant stated directly at the seam, because the position that
        // would exercise every branch through `assess` is awkward to build: a
        // class drop between two *unproven* values must still grade
        // ResultPreserving, however far apart the values are.
        assert_eq!(quality(5, true, 5, true), MoveClass::Optimal);
        assert_eq!(
            quality(-9_000, false, 9_000, false),
            MoveClass::ResultPreserving
        );
        assert_eq!(
            quality(-9_000, true, 9_000, false),
            MoveClass::ResultPreserving
        );
        assert_eq!(
            quality(-9_000, false, 9_000, true),
            MoveClass::ResultPreserving
        );
        assert_eq!(quality(-9_000, true, 9_000, true), MoveClass::Blunder);
        // Same class, different value: worse, but not a thrown game.
        assert_eq!(quality(100, true, 9_000, true), MoveClass::ResultPreserving);
        // A draw is its own class, so dropping from a draw to a loss is a blunder.
        assert_eq!(quality(-9_000, true, 0, true), MoveClass::Blunder);
    }

    #[test]
    fn a_terminal_position_assesses_to_nothing() {
        let over = fixture(Side::A, &[(7, 6, Piece::man(Side::B))]);
        let report = assess(&over);
        assert!(report.moves.is_empty());
        assert_eq!(report.best_col, None);
        assert!(!report.exact, "an empty report claims nothing");
    }
}
