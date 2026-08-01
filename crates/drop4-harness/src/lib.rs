//! The Drop 4 AI-player trial harness.
//!
//! "Run test games and score the playing." A [`Player`] chooses a move; the
//! [`run_match`] runner plays two of them to a verifiable-by-replay
//! [`MatchRecord`]; and [`score_side`] grades a player's moves against the
//! **exact** Drop 4 solver oracle — every move is `Optimal`,
//! `ResultPreserving`, or a `Blunder` (a move that provably drops the
//! win/draw/loss class). [`run_trial`] plays N games and aggregates a
//! [`Scorecard`].
//!
//! This layer is deterministic and lives in Rust so classic players and the
//! exact oracle are `native == wasm` and testable. The **LLM player** and the
//! pluggable WebGPU `AIRuntime` are the TS harness (they need a browser); they
//! reuse this exact-oracle scoring so an on-device model is graded on the same
//! footing as the classic engine.

#![warn(missing_docs)]

use adversary_core::{Adversary, MatchResult, Side};
use drop4_core::{apply_move, legal_cols, winner, Board, Col, Drop4};
use drop4_solver::{Level, Position, Solver};
use rand_chacha::rand_core::RngCore;

/// Positions with more than this many empty cells are skipped by the scorer:
/// an exact solve of an early position is the expensive tail (see the plan's
/// D3 note), so the move-quality metric is reported on the tractable endgame
/// and the count of skipped early moves is recorded honestly.
pub const SCORE_MAX_EMPTIES: usize = 12;

/// A move-chooser. The shipped classic opponent is [`Player::Classic`]; the
/// cheap [`Player::Greedy`] and [`Player::Random`] are trial baselines.
#[derive(Debug, Clone, Copy)]
pub enum Player {
    /// Uniformly-random legal move.
    Random,
    /// One-ply tactical: take an immediate win, else block an immediate threat,
    /// else prefer the centre. Cheap (no deep search) — a fast trial baseline.
    Greedy,
    /// The exact solver at a difficulty [`Level`].
    Classic(Level),
}

impl Player {
    /// Choose a legal move for `board`, or `None` if the board is terminal.
    pub fn choose_move(
        &self,
        board: &Board,
        solver: &mut Solver,
        rng: &mut impl RngCore,
    ) -> Option<Col> {
        match self {
            Player::Random => {
                let legal = legal_cols(board);
                (!legal.is_empty()).then(|| legal[(rng.next_u32() as usize) % legal.len()])
            }
            Player::Greedy => greedy(board),
            Player::Classic(level) => solver.choose(board, *level, rng),
        }
    }
}

/// The cheap one-ply tactical policy (see [`Player::Greedy`]).
fn greedy(board: &Board) -> Option<Col> {
    let legal = legal_cols(board);
    if legal.is_empty() {
        return None;
    }
    let me = board.to_move;
    // 1. Take an immediate win.
    if let Some(&c) = legal
        .iter()
        .find(|&&c| winner(&apply_move(board, c)) == Some(me))
    {
        return Some(c);
    }
    // 2. Block an immediate opponent threat (a column where, if it were their
    //    turn, the opponent would win).
    let opp = me.other();
    let threat = legal.iter().find(|&&c| {
        let mut as_opp = *board;
        as_opp.to_move = opp;
        winner(&apply_move(&as_opp, c)) == Some(opp)
    });
    if let Some(&c) = threat {
        return Some(c);
    }
    // 3. Prefer the centre.
    for c in [3u8, 2, 4, 1, 5, 0, 6] {
        if legal.contains(&Col(c)) {
            return Some(Col(c));
        }
    }
    Some(legal[0])
}

/// A finished match: the seed, the alternating move list, and the result.
/// Replaying `(seed, moves)` through `drop4-core` reproduces the result — a
/// verifiable outcome regardless of which player chose each move.
#[derive(Debug, Clone)]
pub struct MatchRecord {
    /// The start seed.
    pub seed: u64,
    /// Alternating moves; index 0 is side A's first move.
    pub moves: Vec<Col>,
    /// The terminal result.
    pub result: MatchResult,
}

/// Play `a` (side A, moves first) against `b` (side B) to a terminal result.
pub fn run_match(
    a: &Player,
    b: &Player,
    seed: u64,
    solver: &mut Solver,
    rng: &mut impl RngCore,
) -> MatchRecord {
    let mut pos = <Drop4 as Adversary>::initial(seed);
    let mut moves = Vec::new();
    loop {
        if let Some(result) = <Drop4 as Adversary>::result(&pos) {
            return MatchRecord {
                seed,
                moves,
                result,
            };
        }
        let player = if <Drop4 as Adversary>::side_to_move(&pos) == Side::A {
            a
        } else {
            b
        };
        let mv = player
            .choose_move(&pos, solver, rng)
            .expect("a non-terminal position has a legal move");
        pos = <Drop4 as Adversary>::apply(&pos, mv);
        moves.push(mv);
    }
}

/// How good a move was, judged by the exact oracle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveQuality {
    /// Achieves the position's exact best value.
    Optimal,
    /// Keeps the same win/draw/loss class as best, but not the best value.
    ResultPreserving,
    /// Drops the win/draw/loss class (e.g. throws away a win).
    Blunder,
}

/// Grade `mv` in `board` against the exact solver: compare the move's exact
/// value to the position's best exact value. Equal value = `Optimal`; same
/// win/draw/loss sign = `ResultPreserving`; a dropped sign = `Blunder`.
/// `board` must be non-terminal.
#[must_use]
pub fn classify(board: &Board, mv: Col, solver: &mut Solver) -> MoveQuality {
    let best_val = solver.evaluate(board).value;
    let child = apply_move(board, mv);
    let mv_val = if winner(&child) == Some(board.to_move) {
        // An immediate win is the winning best value.
        best_val
    } else if <Drop4 as Adversary>::result(&child).is_some() {
        // Terminal but not our win => a full-board draw.
        0
    } else {
        // The opponent moves in `child`; our value is the negation of theirs.
        -solver.solve(&Position::from_board(&child))
    };
    if mv_val == best_val {
        MoveQuality::Optimal
    } else if mv_val.signum() == best_val.signum() {
        MoveQuality::ResultPreserving
    } else {
        MoveQuality::Blunder
    }
}

/// A player's aggregate result over a set of games.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Scorecard {
    /// Games played.
    pub games: usize,
    /// Games this side won / drew / lost.
    pub wins: usize,
    /// Draws.
    pub draws: usize,
    /// Losses.
    pub losses: usize,
    /// Moves graded by the oracle (endgame moves with ≤ `SCORE_MAX_EMPTIES`).
    pub scored_moves: usize,
    /// Graded moves that were optimal.
    pub optimal: usize,
    /// Graded moves that preserved the result class but weren't optimal.
    pub preserving: usize,
    /// Graded moves that dropped the result class.
    pub blunders: usize,
    /// Moves skipped because the position was too early to solve cheaply.
    pub skipped_early: usize,
}

impl Scorecard {
    /// The blunder rate over graded moves (0.0 if none were graded).
    #[must_use]
    pub fn blunder_rate(&self) -> f64 {
        if self.scored_moves == 0 {
            0.0
        } else {
            self.blunders as f64 / self.scored_moves as f64
        }
    }
}

/// Grade every move `side` made across `records`, folding into `card`.
pub fn score_side(records: &[MatchRecord], side: Side, solver: &mut Solver, card: &mut Scorecard) {
    for record in records {
        match record.result {
            MatchResult::WinA if side == Side::A => card.wins += 1,
            MatchResult::WinB if side == Side::B => card.wins += 1,
            MatchResult::Draw => card.draws += 1,
            _ => card.losses += 1,
        }
        let mut pos = <Drop4 as Adversary>::initial(record.seed);
        for &mv in &record.moves {
            if <Drop4 as Adversary>::result(&pos).is_none()
                && <Drop4 as Adversary>::side_to_move(&pos) == side
            {
                let empties = pos.cells.iter().filter(|&&b| b == 0).count();
                if empties <= SCORE_MAX_EMPTIES {
                    match classify(&pos, mv, solver) {
                        MoveQuality::Optimal => card.optimal += 1,
                        MoveQuality::ResultPreserving => card.preserving += 1,
                        MoveQuality::Blunder => card.blunders += 1,
                    }
                    card.scored_moves += 1;
                } else {
                    card.skipped_early += 1;
                }
            }
            pos = <Drop4 as Adversary>::apply(&pos, mv);
        }
    }
}

/// A trial report: the matchup and side A's scorecard.
#[derive(Debug, Clone)]
pub struct Report {
    /// Human-readable matchup label.
    pub matchup: String,
    /// Side A's aggregate scorecard (A is the player under test).
    pub a: Scorecard,
}

impl Report {
    /// A one-block textual rendering of the scorecard.
    #[must_use]
    pub fn render(&self) -> String {
        let c = &self.a;
        format!(
            "{}\n  games {} | A W-D-L {}-{}-{} (win rate {:.0}%)\n  graded moves {} (skipped {} early) | optimal {} · preserving {} · blunders {} (blunder rate {:.1}%)",
            self.matchup,
            c.games,
            c.wins,
            c.draws,
            c.losses,
            if c.games == 0 { 0.0 } else { 100.0 * c.wins as f64 / c.games as f64 },
            c.scored_moves,
            c.skipped_early,
            c.optimal,
            c.preserving,
            c.blunders,
            100.0 * c.blunder_rate(),
        )
    }
}

/// Play `games` matches of `a` (side A) vs `b` (side B) and score side A.
#[must_use]
pub fn run_trial(a: &Player, b: &Player, games: usize, base_seed: u64) -> Report {
    use rand_chacha::rand_core::SeedableRng;
    use rand_chacha::ChaCha20Rng;
    let mut solver = Solver::new();
    let mut records = Vec::with_capacity(games);
    for i in 0..games {
        let mut rng = ChaCha20Rng::seed_from_u64(base_seed.wrapping_add(i as u64));
        records.push(run_match(a, b, i as u64, &mut solver, &mut rng));
    }
    let mut card = Scorecard {
        games,
        ..Scorecard::default()
    };
    score_side(&records, Side::A, &mut solver, &mut card);
    Report {
        matchup: format!("{a:?} (A) vs {b:?} (B)"),
        a: card,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pond_outcome::{attest, verify, Outcome};
    use rand_chacha::rand_core::SeedableRng;
    use rand_chacha::ChaCha20Rng;

    // A 16-empty position (independent solver): A to move; col 6 is the only
    // win (value +8), cols 0-4 all lose (value -8) — clean optimal-vs-blunder.
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
            to_move: Side::A,
        }
    }

    #[test]
    fn classify_labels_optimal_win_and_class_dropping_blunder() {
        let mut solver = Solver::new();
        let board = blunder_board();
        assert_eq!(
            classify(&board, Col(6), &mut solver),
            MoveQuality::Optimal,
            "col 6 is the only winning move"
        );
        assert_eq!(
            classify(&board, Col(0), &mut solver),
            MoveQuality::Blunder,
            "col 0 throws away the win (win -> loss)"
        );
    }

    #[test]
    fn match_record_replays_to_the_same_result() {
        let mut solver = Solver::new();
        let mut rng = ChaCha20Rng::seed_from_u64(1);
        let record = run_match(&Player::Greedy, &Player::Random, 0, &mut solver, &mut rng);
        // The move list replays through drop4-core to a verifiable outcome.
        let attested = attest::<Drop4>(record.seed, record.moves.clone(), Outcome::Abandoned, None);
        assert!(verify::<Drop4>(&attested).ok, "match record replays");
    }

    #[test]
    fn greedy_beats_random_far_more_than_it_loses() {
        // Greedy (takes wins, blocks threats) should dominate a random opponent.
        let report = run_trial(&Player::Greedy, &Player::Random, 20, 100);
        assert!(
            report.a.wins > report.a.losses * 2,
            "greedy should win far more than it loses: {:?}",
            report.a
        );
    }

    #[test]
    fn scorer_totals_are_consistent() {
        let report = run_trial(&Player::Greedy, &Player::Random, 8, 7);
        let c = &report.a;
        assert_eq!(c.optimal + c.preserving + c.blunders, c.scored_moves);
        assert_eq!(c.wins + c.draws + c.losses, c.games);
    }
}
