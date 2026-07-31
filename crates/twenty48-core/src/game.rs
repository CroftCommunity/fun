//! The `Game` play-loop and the verifiable-outcome binding.
//!
//! A `Game` holds the board, a seeded spawn RNG, the directions played, and the
//! running score. Because the spawn stream is seeded and a move is a
//! [`Direction`], a whole game replays exactly from `(seed, directions)` — which
//! is what makes the outcome verifiable ([`Twenty48`] implements
//! [`pond_outcome::Game`]).

use crate::board::Board;
use crate::engine::{has_any_move, slide, spawn, Direction, ALL_DIRECTIONS};
use crate::hash::state_hash;
use crate::mode;
use crate::rng::DetRng;

/// Why a move could not be played.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MoveError {
    /// The direction does not change the board (the core decides legality).
    #[error("that direction does not change the board")]
    Illegal,
    /// The game is already won or stuck — no further moves are accepted.
    #[error("the game is already over")]
    GameOver,
}

/// A single 2048 game: board + seeded spawn stream + move list + score.
#[derive(Clone)]
pub struct Game {
    board: Board,
    seed: u64,
    rng: DetRng,
    moves: Vec<Direction>,
    score: u64,
}

impl Game {
    /// A new game for `seed`: an empty board seeded with `mode::START_TILES` spawns.
    #[must_use]
    pub fn new(seed: u64) -> Self {
        let mut board = Board::empty(mode::WIDTH, mode::HEIGHT);
        let mut rng = DetRng::from_seed(seed);
        for _ in 0..mode::START_TILES {
            spawn(&mut board, &mut rng);
        }
        Self {
            board,
            seed,
            rng,
            moves: Vec::new(),
            score: 0,
        }
    }

    /// A game from an explicit board (tests + the pack fixture). Bypasses the
    /// deal; never used by `replay`, so it does not weaken verification.
    #[doc(hidden)]
    #[must_use]
    pub fn from_board(board: Board, seed: u64) -> Self {
        Self {
            board,
            seed,
            rng: DetRng::from_seed(seed),
            moves: Vec::new(),
            score: 0,
        }
    }

    /// The current board (for rendering).
    #[must_use]
    pub fn board(&self) -> &Board {
        &self.board
    }

    /// The seed this game was dealt from (the outcome proof carries it).
    #[must_use]
    pub fn seed(&self) -> u64 {
        self.seed
    }

    /// The directions played so far (the outcome proof passed to `attest`).
    #[must_use]
    pub fn moves(&self) -> &[Direction] {
        &self.moves
    }

    /// The cumulative score (sum of merge values).
    #[must_use]
    pub fn score(&self) -> u64 {
        self.score
    }

    /// The largest tile value on the board (`0` if empty).
    #[must_use]
    pub fn max_tile(&self) -> u64 {
        let e = self.board.max_exponent();
        if e == 0 {
            0
        } else {
            1u64 << e
        }
    }

    /// The 2048 tile has been made.
    #[must_use]
    pub fn is_won(&self) -> bool {
        self.board.max_exponent() >= mode::WIN_EXP
    }

    /// The board is full and no direction changes it.
    #[must_use]
    pub fn is_stuck(&self) -> bool {
        self.board.is_full() && !has_any_move(&self.board)
    }

    /// The game has ended (won or stuck).
    #[must_use]
    pub fn is_over(&self) -> bool {
        self.is_won() || self.is_stuck()
    }

    /// The canonical state hash — replay reproduces it exactly.
    #[must_use]
    pub fn current_hash(&self) -> String {
        state_hash(&self.board, self.rng.draws(), self.score)
    }

    /// Slide in `dir`; on success spawn a new tile and record the move.
    ///
    /// # Errors
    /// - `GameOver` if the game already ended (nothing changes).
    /// - `Illegal` if the direction does not change the board (nothing changes) —
    ///   so a tampered illegal move in a record is a no-op and diverges the hash.
    pub fn play(&mut self, dir: Direction) -> Result<(), MoveError> {
        if self.is_over() {
            return Err(MoveError::GameOver);
        }
        let mut next = self.board.clone();
        let report = slide(&mut next, dir);
        if !report.changed {
            return Err(MoveError::Illegal);
        }
        self.board = next;
        self.score += report.score_gain;
        spawn(&mut self.board, &mut self.rng);
        self.moves.push(dir);
        Ok(())
    }

    /// A hint: a legal direction, preferring one that merges (scores). `None`
    /// only when the game is over. Using a hint counts as assistance.
    #[must_use]
    pub fn hint(&self) -> Option<Direction> {
        let mut fallback = None;
        for &dir in &ALL_DIRECTIONS {
            let mut probe = self.board.clone();
            let report = slide(&mut probe, dir);
            if report.changed {
                if report.score_gain > 0 {
                    return Some(dir);
                }
                fallback.get_or_insert(dir);
            }
        }
        fallback
    }
}

/// The verifiable-outcome binding for 2048.
pub struct Twenty48;

impl pond_outcome::Game for Twenty48 {
    type Move = Direction;
    const KIND: &'static str = "2048";
    const VERSION: u32 = 1;

    fn replay(seed: u64, moves: &[Direction]) -> pond_outcome::Replayed {
        let mut game = Game::new(seed);
        for &dir in moves {
            // A tampered move (illegal, or after the game ended) is a no-op, so
            // the hash diverges from the honest game and verification fails.
            let _ = game.play(dir);
        }
        pond_outcome::Replayed {
            final_hash: game.current_hash(),
            won: game.is_won(),
            score: Some(game.score()),
            stars: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pond_outcome::{attest, verify, Game as _, Outcome};

    #[test]
    fn verify_roundtrip_holds_and_detects_tamper() {
        let seed = 7;
        let mut g = Game::new(seed);
        // Play several legal moves (hint always returns a legal direction).
        let mut played = Vec::new();
        for _ in 0..6 {
            if let Some(dir) = g.hint() {
                g.play(dir).expect("hint is legal");
                played.push(dir);
            }
        }
        assert!(!played.is_empty(), "a fresh board has legal moves");

        let record = attest::<Twenty48>(seed, g.moves().to_vec(), Outcome::Abandoned, Some(false));
        assert!(verify::<Twenty48>(&record).ok, "an honest record verifies");
        assert!(record.score.is_some(), "score is surfaced");
        assert_eq!(record.stars, None, "no stars");

        let mut bad_hash = record.clone();
        bad_hash.final_hash = "0".repeat(64);
        assert!(!verify::<Twenty48>(&bad_hash).ok, "a tampered hash fails");

        if record.moves.len() >= 2 && record.moves[0] != record.moves[1] {
            let mut bad_move = record.clone();
            bad_move.moves.swap(0, 1);
            // A reordered line diverges the spawn stream / board -> hash mismatch.
            assert!(!verify::<Twenty48>(&bad_move).ok, "a tampered move fails");
        }
    }

    #[test]
    fn illegal_move_is_a_no_op() {
        // Row 0 packed left with no merge; empties elsewhere -> Left is illegal,
        // but the game is not over.
        let board = Board::from_rows(&[&[1, 2, 0, 0], &[0, 0, 0, 0], &[0, 0, 0, 0], &[0, 0, 0, 0]]);
        let mut g = Game::from_board(board, 1);
        assert!(!g.is_over());
        let before = g.current_hash();
        assert_eq!(g.play(Direction::Left), Err(MoveError::Illegal));
        assert_eq!(g.current_hash(), before, "an illegal move changes nothing");
        assert!(g.moves().is_empty());
    }

    #[test]
    fn winning_move_sets_won_and_ends() {
        // Two 1024s (exp 10) in a row: a Left move merges them to 2048 (exp 11).
        let board =
            Board::from_rows(&[&[10, 10, 0, 0], &[1, 0, 0, 0], &[0, 0, 0, 0], &[0, 0, 0, 0]]);
        let mut g = Game::from_board(board, 1);
        assert!(!g.is_won());
        g.play(Direction::Left).expect("legal merging move");
        assert!(g.is_won(), "reached the 2048 tile");
        assert_eq!(g.max_tile(), 2048);
        // Won => over => further moves rejected.
        assert_eq!(g.play(Direction::Right), Err(MoveError::GameOver));
    }

    #[test]
    fn replay_is_deterministic() {
        let seed = 99;
        let mut g = Game::new(seed);
        for _ in 0..5 {
            if let Some(dir) = g.hint() {
                g.play(dir).expect("legal");
            }
        }
        let a = Twenty48::replay(seed, g.moves());
        let b = Twenty48::replay(seed, g.moves());
        assert_eq!(a.final_hash, b.final_hash);
        assert_eq!(
            a.final_hash,
            g.current_hash(),
            "replay reproduces the live hash"
        );
        assert!(a.score.is_some());
    }
}
