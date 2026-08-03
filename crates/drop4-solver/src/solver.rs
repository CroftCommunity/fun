//! The negamax solver and the difficulty-graded opponent / exact oracle.
//!
//! [`solve`] returns the exact game-theoretic value of a bitboard position from
//! the side-to-move's perspective: positive = the side to move wins (larger =
//! faster), `0` = draw, negative = loses (more negative = loses sooner). That
//! exactness is what makes the AI-scoring harness's move-quality metric
//! unambiguous — a "blunder" is a move that provably drops the win/draw/loss
//! class. [`best_move`] / [`evaluate`] lift it to a [`drop4_core::Board`], and
//! [`choose`] adds difficulty levels for opponent play.

use drop4_core::{apply_move, legal_cols, winner, Board, Col};
use rand_chacha::rand_core::RngCore;

use crate::bitboard::Position;

/// Total playable cells.
const CELLS: i32 = 42;
/// The most negative score the encoding can hold (Pons: `-(W*H)/2 + 3`).
const MIN_SCORE: i32 = -(42 / 2) + 3;
/// Centre-first column exploration order — the strongest heuristic for Drop 4.
const ORDER: [u64; 7] = [3, 2, 4, 1, 5, 0, 6];
/// Transposition-table capacity (a prime, ~4.2M entries ≈ 38 MB). Reused across
/// moves and games by a [`Solver`], since keys are absolute positions.
const TT_SIZE: u64 = 4_194_319;

/// A fixed-size, replace-on-write transposition table with fast modular
/// indexing. The `HashMap` default hasher is far too slow for a full solve, so
/// the position key is stored alongside the value to detect index collisions.
struct TransTable {
    keys: Vec<u64>,
    vals: Vec<i8>,
}

impl TransTable {
    fn new() -> Self {
        TransTable {
            keys: vec![0; TT_SIZE as usize],
            vals: vec![0; TT_SIZE as usize],
        }
    }

    fn get(&self, key: u64) -> Option<i8> {
        let i = (key % TT_SIZE) as usize;
        // `vals == 0` marks an empty slot; the stored key guards collisions.
        (self.keys[i] == key && self.vals[i] != 0).then_some(self.vals[i])
    }

    fn put(&mut self, key: u64, val: i8) {
        let i = (key % TT_SIZE) as usize;
        self.keys[i] = key;
        self.vals[i] = val;
    }
}

/// The exact evaluation of a position: its value and the move that achieves it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Eval {
    /// Exact score from the side-to-move's perspective (see [`Solver::solve`]).
    pub value: i32,
    /// A move achieving `value`, or `None` if the position is terminal.
    pub best_move: Option<Col>,
}

/// A reusable Drop 4 solver. Holds the transposition table so a whole game (or
/// a whole trial) shares one table — allocate it once and reuse across moves.
pub struct Solver {
    tt: TransTable,
}

impl Default for Solver {
    fn default() -> Self {
        Solver::new()
    }
}

impl Solver {
    /// A fresh solver with an empty transposition table.
    #[must_use]
    pub fn new() -> Self {
        Solver {
            tt: TransTable::new(),
        }
    }

    /// The exact game value of `pos` from the side-to-move's perspective:
    /// positive = the side to move wins (larger = sooner), `0` = draw, negative
    /// = loses. Uses null-window iterative deepening (Pons part 9).
    pub fn solve(&mut self, pos: &Position) -> i32 {
        let mut min = -(CELLS - pos.moves as i32) / 2;
        let mut max = (CELLS + 1 - pos.moves as i32) / 2;
        while min < max {
            let mut med = min + (max - min) / 2;
            if med <= 0 && min / 2 < med {
                med = min / 2;
            } else if med >= 0 && max / 2 > med {
                med = max / 2;
            }
            let r = self.negamax(pos, med, med + 1);
            if r <= med {
                max = r;
            } else {
                min = r;
            }
        }
        min
    }

    /// Alpha-beta negamax with the transposition table (Pons part 8: win-now
    /// short-circuit, centre-first ordering, upper-bound TT).
    fn negamax(&mut self, pos: &Position, mut alpha: i32, mut beta: i32) -> i32 {
        // Draw: the board is full with no line.
        if pos.moves as i32 >= CELLS {
            return 0;
        }
        // If the side to move can win now, that is the value — and we return
        // before ever playing into (and recursing on) a won position.
        for col in ORDER {
            if pos.can_play(col) && pos.is_winning_move(col) {
                return win_score(pos.moves);
            }
        }
        // We cannot win this move, so our best possible outcome is a win
        // next-next.
        let mut max = (CELLS - 1 - pos.moves as i32) / 2;
        if let Some(stored) = self.tt.get(pos.key()) {
            max = i32::from(stored) + MIN_SCORE - 1;
        }
        if beta > max {
            beta = max;
            if alpha >= beta {
                return beta;
            }
        }
        for col in ORDER {
            if pos.can_play(col) {
                let mut child = *pos;
                child.play(col);
                let score = -self.negamax(&child, -beta, -alpha);
                if score >= beta {
                    return score;
                }
                if score > alpha {
                    alpha = score;
                }
            }
        }
        // Store `alpha` as an upper bound of the true score (offset so 0 means
        // "absent" in the table).
        let encoded = i8::try_from(alpha - MIN_SCORE + 1).unwrap_or(i8::MAX);
        self.tt.put(pos.key(), encoded);
        alpha
    }

    /// Evaluate a board: the exact value for the side to move and the move that
    /// achieves it. Returns `best_move: None` if the board is already terminal.
    pub fn evaluate(&mut self, board: &Board) -> Eval {
        let legal = legal_cols(board);
        if legal.is_empty() {
            return Eval {
                value: 0,
                best_move: None,
            };
        }
        let moves = Position::from_board(board).moves;
        // An immediate win is always optimal — take it without solving the
        // other children (and never hand a won board to `solve`).
        for &col in &legal {
            if winner(&apply_move(board, col)) == Some(board.to_move) {
                return Eval {
                    value: win_score(moves),
                    best_move: Some(col),
                };
            }
        }
        let mut best_val = i32::MIN;
        let mut best = None;
        for col in legal {
            let child = apply_move(board, col);
            let v = -self.solve(&Position::from_board(&child));
            if v > best_val {
                best_val = v;
                best = Some(col);
            }
        }
        Eval {
            value: best_val,
            best_move: best,
        }
    }

    /// The exact best move for `board`, or `None` if terminal.
    pub fn best_move(&mut self, board: &Board) -> Option<Col> {
        self.evaluate(board).best_move
    }

    /// The exact value (side-to-move perspective) of **every** legal move — the
    /// Oracle's per-move judgment. This is the source for a difficulty band (keep
    /// moves within Δ of the best) and for the move-quality scorer. Empty if the
    /// board is terminal.
    pub fn move_values(&mut self, board: &Board) -> Vec<(Col, i32)> {
        let moves = Position::from_board(board).moves;
        legal_cols(board)
            .into_iter()
            .map(|c| {
                let child = apply_move(board, c);
                let v = if winner(&child) == Some(board.to_move) {
                    win_score(moves) // immediate win
                } else if legal_cols(&child).is_empty() {
                    0 // full board, no winner => draw
                } else {
                    -self.solve(&Position::from_board(&child))
                };
                (c, v)
            })
            .collect()
    }

    /// Choose a move for `board` at `level`, drawing randomness from `rng`.
    /// `None` only if the board is terminal.
    pub fn choose(&mut self, board: &Board, level: Level, rng: &mut impl RngCore) -> Option<Col> {
        let legal = legal_cols(board);
        if legal.is_empty() {
            return None;
        }
        if level != Level::Perfect && rng.next_u32() % 100 < level.blunder_pct() {
            let i = (rng.next_u32() as usize) % legal.len();
            return Some(legal[i]);
        }
        self.best_move(board)
    }
}

/// The immediate-win score for a board that already has `moves` discs (the side
/// to move wins by playing now).
fn win_score(moves: u32) -> i32 {
    (CELLS + 1 - moves as i32) / 2
}

/// The exact game value of `pos` from the side-to-move's perspective (one-off;
/// allocates a fresh table — use a [`Solver`] to reuse one across moves).
#[must_use]
pub fn solve(pos: &Position) -> i32 {
    Solver::new().solve(pos)
}

/// Evaluate a board with a fresh solver (see [`Solver::evaluate`]).
#[must_use]
pub fn evaluate(board: &Board) -> Eval {
    Solver::new().evaluate(board)
}

/// The exact best move for `board` with a fresh solver, or `None` if terminal.
#[must_use]
pub fn best_move(board: &Board) -> Option<Col> {
    Solver::new().best_move(board)
}

/// Opponent difficulty. Weaker levels play the exact-best move most of the time
/// but mix in a random legal move with a level-dependent probability, so they
/// are beatable without ever being erratic on the shipped opponent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    /// Blunders often.
    Easy,
    /// Blunders sometimes.
    Medium,
    /// Rarely blunders.
    Hard,
    /// Never blunders — the exact solver.
    Perfect,
}

impl Level {
    /// Percent chance (0-100) of playing a random legal move instead of best.
    #[must_use]
    fn blunder_pct(self) -> u32 {
        match self {
            Level::Easy => 55,
            Level::Medium => 25,
            Level::Hard => 8,
            Level::Perfect => 0,
        }
    }
}

/// Choose a move for `board` at `level` with a fresh solver, drawing
/// randomness from `rng` (see [`Solver::choose`]).
#[must_use]
pub fn choose(board: &Board, level: Level, rng: &mut impl RngCore) -> Option<Col> {
    Solver::new().choose(board, level, rng)
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::Adversary;
    use drop4_core::Drop4;
    use rand_chacha::rand_core::SeedableRng;
    use rand_chacha::ChaCha20Rng;

    /// Build a board from an alternating column move list (A starts).
    fn play(cols: &[u8]) -> Board {
        let mut pos = <Drop4 as Adversary>::initial(0);
        for &c in cols {
            pos = <Drop4 as Adversary>::apply(&pos, Col(c));
        }
        pos
    }

    #[test]
    fn takes_the_immediate_win() {
        // A has three vertically in col 0 and is to move; col 0 wins.
        let pos = play(&[0, 1, 0, 1, 0, 1]);
        assert_eq!(best_move(&pos), Some(Col(0)));
        assert!(
            evaluate(&pos).value > 0,
            "an immediate win is a positive value"
        );
    }

    #[test]
    fn late_position_matches_an_independent_solver() {
        // A 28-disc position solved offline by an independent negamax (see the
        // plan's D3 probe). Few empties => the exact solve is instant, so this
        // is the fast-gate proof of multi-ply correctness. Independent solver:
        // A (side to move) wins; the optimal columns are {2, 3, 5}.
        #[rustfmt::skip]
        let cells: [u8; 42] = [
            2, 2, 2, 1, 1, 2, 1,
            2, 1, 0, 1, 1, 1, 2,
            1, 2, 0, 1, 2, 0, 1,
            2, 1, 0, 0, 2, 0, 1,
            2, 0, 0, 0, 1, 0, 2,
            2, 0, 0, 0, 1, 0, 2,
        ];
        let board = Board {
            cells,
            to_move: adversary_core::Side::A,
        };
        let eval = evaluate(&board);
        assert!(eval.value > 0, "independent solver says A (to move) wins");
        assert!(
            [Col(2), Col(3), Col(5)].contains(&eval.best_move.unwrap()),
            "best move must be one of the independent solver's optimal columns"
        );
    }

    #[test]
    fn move_values_ranks_the_only_win_highest() {
        // A late (16-empty, fast to solve) position: A to move, col 6 is the only
        // win (+), cols 0-4 all lose (-). Independent solver; see drop4-harness.
        #[rustfmt::skip]
        let cells: [u8; 42] = [
            2, 1, 2, 1, 1, 1, 2,
            0, 2, 2, 1, 2, 2, 2,
            0, 1, 0, 2, 2, 2, 1,
            0, 2, 0, 0, 2, 1, 1,
            0, 1, 0, 0, 0, 1, 1,
            0, 0, 0, 0, 0, 1, 0,
        ];
        let pos = Board {
            cells,
            to_move: adversary_core::Side::A,
        };
        let mut solver = Solver::new();
        let vals = solver.move_values(&pos);
        assert_eq!(
            vals.len(),
            legal_cols(&pos).len(),
            "one value per legal move"
        );
        let (best_col, best_val) = vals.iter().copied().max_by_key(|&(_, v)| v).unwrap();
        assert_eq!(best_col, Col(6), "col 6 is the only winning move");
        assert!(best_val > 0, "the win is a positive value");
        assert!(
            vals.iter().all(|&(c, v)| c == Col(6) || v < 0),
            "every other move loses"
        );
    }

    #[test]
    fn choose_perfect_is_the_exact_best_move() {
        // On the late fixture, Perfect must return an exact-best move regardless
        // of the RNG (it never randomises).
        #[rustfmt::skip]
        let cells: [u8; 42] = [
            2, 2, 2, 1, 1, 2, 1,
            2, 1, 0, 1, 1, 1, 2,
            1, 2, 0, 1, 2, 0, 1,
            2, 1, 0, 0, 2, 0, 1,
            2, 0, 0, 0, 1, 0, 2,
            2, 0, 0, 0, 1, 0, 2,
        ];
        let board = Board {
            cells,
            to_move: adversary_core::Side::A,
        };
        let mut rng = ChaCha20Rng::seed_from_u64(1);
        let mv = choose(&board, Level::Perfect, &mut rng).unwrap();
        assert!([Col(2), Col(3), Col(5)].contains(&mv));
    }

    // --- full-strength proofs (heavy: a near-full solve from an early/empty
    // board). Not on the fast gate; run with `cargo test -- --ignored`. These
    // are also exercised whenever the trial harness plays Perfect. ---

    #[test]
    #[ignore = "full solve from empty board — minutes; run with --ignored"]
    fn empty_board_is_a_first_player_win() {
        // The solved value of empty 7x6 Drop 4 is +1 (first player wins).
        let pos = <Drop4 as Adversary>::initial(0);
        assert_eq!(solve(&Position::from_board(&pos)), 1);
    }

    #[test]
    #[ignore = "plays full Perfect games from empty — heavy; run with --ignored"]
    fn perfect_never_loses_to_random() {
        // Perfect (as first player) never loses to a random opponent.
        let mut rng = ChaCha20Rng::seed_from_u64(42);
        let mut solver = Solver::new();
        for _ in 0..5 {
            let mut pos = <Drop4 as Adversary>::initial(0);
            let mut a_to_move = true;
            while <Drop4 as Adversary>::result(&pos).is_none() {
                let mv = if a_to_move {
                    solver.choose(&pos, Level::Perfect, &mut rng).unwrap()
                } else {
                    let legal = legal_cols(&pos);
                    legal[(rng.next_u32() as usize) % legal.len()]
                };
                pos = <Drop4 as Adversary>::apply(&pos, mv);
                a_to_move = !a_to_move;
            }
            assert_ne!(
                <Drop4 as Adversary>::result(&pos),
                Some(adversary_core::MatchResult::WinB),
                "perfect first player never loses to random"
            );
        }
    }
}
