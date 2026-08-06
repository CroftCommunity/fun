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

/// Search depth for tutor facts — **one ply deeper than the strongest opponent**.
///
/// The tutor is opened deliberately, once, and it is the only surface allowed to
/// say a move threw the game. A move has to answer at tap speed; a panel opening
/// does not, so the two should not share a budget. Written as `Expert + 1` rather
/// than a bare number so the relationship the tutor depends on is visible in the
/// code, and pinned by `the_tutor_searches_deeper_than_the_opponent_ever_does`.
///
/// **Measured in wasm 2026-08-06** (Node/V8, through the shipped `tutor_json`,
/// over real games at Expert; proof rate is the share of move values proven):
///
/// | depth | proven moves | median ms | worst ms |
/// |---|---|---|---|
/// | 6 (was shipped) | 2.2% | 8 | 46 |
/// | 8 (= Expert) | 3.9% | 46 | 349 |
/// | **9 — shipped** | **4.9%** | **85** | **705** |
/// | 10 | 5.6% | 235 | 2300 |
/// | 12 | 6.4% | 1024 | 12571 |
///
/// 9 more than doubles the proof rate of the depth it replaces while keeping the
/// worst case under a second. 10 costs three times that latency for another 0.7
/// points, and 12 is twelve seconds — not a panel, a hang. The curve is the
/// familiar one: each extra ply multiplies cost and adds a little proof.
///
/// The cost is real enough that the panel must not block the paint — see the
/// `checkers.ts` tutor panel, which shows its reading state before searching.
const TUTOR_DEPTH: u32 = Level::Expert.depth() + 1;

/// Search depth for the **per-move** coach — the note the UI shows about the move
/// you just tapped.
///
/// This one is on the tap path: the UI assesses the tapped move *before* applying
/// it, so whatever this costs is added to every move a player makes with the
/// tutor enabled. That is the opposite of the panel's situation, and the reason
/// the two do not share a budget. At the panel's depth the same call measured
/// **705ms** worst case in wasm; here it is **46ms**.
///
/// A shallower search does not make the coach dishonest — grading still needs two
/// proofs for a blunder — it only makes it hedge more often, which is the correct
/// trade for a surface nobody asked to open.
const COACH_DEPTH: u32 = Level::Hard.depth();

// The two relationships the surfaces above depend on, checked by the **compiler**
// rather than by a test — clippy is right that a constant comparison is not an
// assertion worth running, and a build failure is a stronger guarantee than a red
// test anyway. The behavioural halves (does the extra depth buy proofs? does the
// coach still grade honestly?) are tested below, where they belong.
const _: () = assert!(
    TUTOR_DEPTH > Level::Expert.depth(),
    "the tutor panel must search deeper than the strongest opponent"
);
const _: () = assert!(
    COACH_DEPTH < TUTOR_DEPTH,
    "the per-move coach is on the tap path and must be cheaper than the panel"
);

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

/// The engine-grounded [`TutorReport`] for `board`, searched to [`TUTOR_DEPTH`] —
/// the **panel** budget. A terminal position yields an empty report. Never panics.
#[must_use]
pub fn assess(board: &Board) -> TutorReport {
    assess_at(board, TUTOR_DEPTH)
}

/// The engine-grounded [`TutorReport`] for `board` at the **per-move coach**
/// budget ([`COACH_DEPTH`]) — cheap enough to sit on the tap path.
#[must_use]
pub fn assess_for_move(board: &Board) -> TutorReport {
    assess_at(board, COACH_DEPTH)
}

fn assess_at(board: &Board, depth: u32) -> TutorReport {
    let scored = move_scores(board, depth);
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

    /// The **last** `keep` positions of a self-played game — real play, sampled
    /// where proofs actually live.
    ///
    /// Sampling from the opening instead measures nothing: the first version of
    /// this fixture took the first 30 plies and both depths proved **zero**
    /// values, because a proof needs a terminal inside the horizon and the
    /// midgame has none at any depth this side of absurd. That is the same shape
    /// as the wasm measurement, where the proof rate came almost entirely from
    /// long endgames.
    fn endgame_positions(seed: u64, keep: usize) -> Vec<Board> {
        use rand_chacha::rand_core::SeedableRng;
        use rand_chacha::ChaCha20Rng;

        let mut rng = ChaCha20Rng::seed_from_u64(seed);
        let mut board = <Checkers as Adversary>::initial(seed);
        let mut out = Vec::new();
        for _ in 0..400 {
            if <Checkers as Adversary>::result(&board).is_some() {
                break;
            }
            out.push(board);
            let Some(mv) = crate::live::choose(&board, Level::Medium, &mut rng) else {
                break;
            };
            board = checkers_core::apply_move(&board, mv);
        }
        out.split_off(out.len().saturating_sub(keep))
    }

    /// How many move values a search at `depth` proves across `positions`.
    fn proofs_at(positions: &[Board], depth: u32) -> usize {
        positions
            .iter()
            .map(|b| {
                move_scores(b, depth)
                    .iter()
                    .filter(|(_, s)| s.exact)
                    .count()
            })
            .sum()
    }

    #[test]
    fn the_analysis_budget_outranks_every_player() {
        // The scoring harness grades a played move against the oracle's read of
        // the position. A grader searching no deeper than the player it grades is
        // not an oracle — an Expert engine picking the max at its own depth is
        // "optimal" by construction, so the grade says nothing. The analysis path
        // must therefore see further than any shipped level, which is the same
        // budget the panel uses (`assess`), not the tap path's (`assess_for_move`).
        //
        // `TUTOR_DEPTH > Level::Expert.depth()` is asserted at compile time; what
        // is measured here is that the difference is real in play.
        let positions: Vec<Board> = (1..3)
            .flat_map(|seed| endgame_positions(seed, 12))
            .collect();
        let deep: usize = positions
            .iter()
            .map(|b| assess(b).moves.iter().filter(|m| m.exact).count())
            .sum();
        let tap: usize = positions
            .iter()
            .map(|b| assess_for_move(b).moves.iter().filter(|m| m.exact).count())
            .sum();
        assert!(
            tap > 0,
            "the fixture must reach positions with proofs at all"
        );
        assert!(
            deep > tap,
            "the analysis budget proved {deep} where the tap budget proved {tap} — grading gains nothing from it"
        );
    }

    #[test]
    fn the_per_move_coach_stays_at_tap_speed() {
        // The panel and the per-move coach are not the same surface, and giving
        // them one budget was a bug in waiting: the UI assesses the tapped move
        // *before* applying it, so the panel's depth would land on every tap with
        // the tutor enabled. Measured in wasm: 705ms worst case at the panel's
        // depth against 46ms at the coach's. A tap cannot spend that.
        //
        // The ordering is a compile-time assertion up top; what matters here is
        // that the cheaper path still grades the same way — a shallower search means the coach
        // hedges more often, never that it grades dishonestly. The invariant is
        // the same one the panel has: no blunder without two proofs.
        let opening = <Checkers as Adversary>::initial(0);
        let coached = assess_for_move(&opening);
        assert_eq!(coached.moves.len(), 7);
        assert!(!coached.exact, "nothing is proven this early at any depth");
        assert!(coached
            .moves
            .iter()
            .all(|m| m.quality != MoveClass::Blunder));

        // ...and where a proof IS reachable at the shallower depth, the coach
        // still finds it, so honest coaching does not vanish with the budget.
        let proven = assess_for_move(&king_hunts_a_lone_man());
        assert!(
            proven.moves.iter().any(|m| m.exact),
            "the coach still proves what a small position allows"
        );
    }

    #[test]
    fn the_tutor_searches_deeper_than_the_opponent_ever_does() {
        // The tutor is opened deliberately, once, and it is the only surface that
        // may claim a move "threw the game" — so it is the one place worth
        // spending real time hunting for a proof. A move has to answer at tap
        // speed and cannot. Sharing one budget caps the panel at what a *move*
        // can afford, which is backwards.
        //
        // That the constant *is* deeper is a compile-time assertion up top. What
        // this test adds is the part a constant cannot state: the extra budget has
        // to actually buy proofs in real play, or it is only costing latency. Two
        // seeds, so this is not one lucky line.
        let positions: Vec<Board> = (1..3)
            .flat_map(|seed| endgame_positions(seed, 12))
            .collect();
        assert!(
            positions.len() >= 20,
            "enough positions to be worth counting"
        );
        let tutor = proofs_at(&positions, TUTOR_DEPTH);
        let opponent = proofs_at(&positions, Level::Expert.depth());
        assert!(
            opponent > 0,
            "the fixture must reach positions with proofs at all"
        );
        assert!(
            tutor > opponent,
            "the tutor's depth proved {tutor} move values where the opponent's proved {opponent} — it is buying nothing"
        );
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

        // This used to assert every opening regret was **zero** — at the old
        // depth of 6 all seven moves evaluated identically, which is a real fact
        // about checkers openings (famously near-equal; it is why tournament play
        // forces the first three moves). At `Expert + 1` the search separates
        // them: regrets 8/4/1/4/4/0/4, one `Optimal` and six `ResultPreserving`.
        //
        // That is the deeper tutor budget doing exactly what it was raised to do,
        // so the assertion is updated rather than the depth reverted. The
        // invariant above — no blunder without proof — is untouched, and it is the
        // part the UI's wording rests on.
        assert!(
            report.moves.iter().any(|m| m.regret > 0),
            "the deeper tutor search can tell the opening moves apart"
        );
        assert_eq!(
            report
                .moves
                .iter()
                .filter(|m| m.quality == MoveClass::Optimal)
                .count(),
            1,
            "exactly one opening move is best at this depth"
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

        // At the old depth of 6, two of these four moves wandered outside the
        // horizon and came back unproven, so the report as a whole was not exact.
        // At `Expert + 1` the search proves all four — this small a position is
        // now fully solved, which is the point of the raised budget.
        assert!(
            report.moves.iter().all(|m| m.exact),
            "the deeper budget proves the whole of a position this small"
        );
        assert!(report.exact, "so the report as a whole is proven");
        // The rule that an *unproven* move can never be graded a blunder no longer
        // has a witness in this fixture, and deliberately is not given a contrived
        // one: it is pinned directly, and at every combination of proven/unproven,
        // by `a_blunder_needs_both_values_proven`, and in real play by
        // `opening_is_capped_and_never_grades_a_blunder` above.
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
