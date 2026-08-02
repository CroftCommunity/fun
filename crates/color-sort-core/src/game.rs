//! The `Game` play-loop and the verifiable-outcome binding.
//!
//! A `Game` holds the dealt initial state, the current state, and the pours
//! played. Because the deal is a pure function of the packed seed and a move is a
//! [`Move`], a whole game replays exactly from `(seed, moves)` — which makes the
//! outcome verifiable ([`ColorSort`] implements [`pond_outcome::Game`]).

use crate::board::State;
use crate::deal::deal_from_seed;
use crate::engine::{apply_move, is_deadlocked, ui_moves, Move, MoveError};
use crate::hash::state_hash;

/// A single sort-puzzle game: the deal + current state + the pours played.
#[derive(Clone)]
pub struct Game {
    initial: State,
    state: State,
    seed: u64,
    moves: Vec<Move>,
    /// Prior states, so Free-mode undo is O(1) (Strict mode never calls `undo`).
    history: Vec<State>,
}

impl Game {
    /// A new game for the packed `seed` (deals the tubes).
    #[must_use]
    pub fn new(seed: u64) -> Self {
        let state = deal_from_seed(seed);
        Self {
            initial: state.clone(),
            state,
            seed,
            moves: Vec::new(),
            history: Vec::new(),
        }
    }

    /// A game from an explicit initial state (tests + the pack fixture). The
    /// `seed` is still recorded for the outcome; callers that need a verifiable
    /// record must pass the deal's real packed seed.
    #[doc(hidden)]
    #[must_use]
    pub fn from_state(state: State, seed: u64) -> Self {
        Self {
            initial: state.clone(),
            state,
            seed,
            moves: Vec::new(),
            history: Vec::new(),
        }
    }

    /// The current state (for rendering).
    #[must_use]
    pub fn state(&self) -> &State {
        &self.state
    }

    /// The packed deal seed (the outcome proof carries it).
    #[must_use]
    pub fn seed(&self) -> u64 {
        self.seed
    }

    /// The pours played so far (the outcome proof passed to `attest`).
    #[must_use]
    pub fn moves(&self) -> &[Move] {
        &self.moves
    }

    /// The move count (one pour = one move).
    #[must_use]
    pub fn move_count(&self) -> usize {
        self.moves.len()
    }

    /// The win condition is met.
    #[must_use]
    pub fn is_won(&self) -> bool {
        self.state.is_won()
    }

    /// No UI-legal pour remains and the game is not won.
    #[must_use]
    pub fn is_deadlocked(&self) -> bool {
        is_deadlocked(&self.state)
    }

    /// The canonical state hash — replay reproduces it exactly.
    #[must_use]
    pub fn current_hash(&self) -> String {
        state_hash(&self.state)
    }

    /// The UI-legal pours from the current state (the board glows these).
    #[must_use]
    pub fn ui_moves(&self) -> Vec<Move> {
        ui_moves(&self.state)
    }

    /// Play a pour, recording it and pushing the prior state for undo.
    ///
    /// # Errors
    /// Propagates [`MoveError`] from [`apply_move`]; on error nothing changes.
    pub fn play(&mut self, mv: Move) -> Result<usize, MoveError> {
        let prev = self.state.clone();
        let moved = apply_move(&mut self.state, mv)?;
        self.history.push(prev);
        self.moves.push(mv);
        Ok(moved)
    }

    /// Undo the last pour (Free mode). Returns `false` if there is nothing to undo.
    pub fn undo(&mut self) -> bool {
        match self.history.pop() {
            Some(prev) => {
                self.state = prev;
                self.moves.pop();
                true
            }
            None => false,
        }
    }

    /// Restart the same deal (regenerates nothing — the deal is unchanged).
    pub fn restart(&mut self) {
        self.state = self.initial.clone();
        self.moves.clear();
        self.history.clear();
    }
}

/// The verifiable-outcome binding for the sort puzzle.
pub struct ColorSort;

impl pond_outcome::Game for ColorSort {
    type Move = Move;
    const KIND: &'static str = "color-sort";
    const VERSION: u32 = 1;

    fn replay(seed: u64, moves: &[Move]) -> pond_outcome::Replayed {
        let mut game = Game::new(seed);
        for &mv in moves {
            // A tampered move (illegal, or after a win) is a no-op, so the hash
            // diverges from the honest game and verification fails.
            let _ = game.play(mv);
        }
        pond_outcome::Replayed::new(game.current_hash(), game.is_won())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::deal::{pack_seed, DealParams};
    use pond_outcome::{attest, verify, Outcome};

    // A tiny unsolved hand-built state: two mixed tubes + one empty, cap 2.
    fn unsolved() -> State {
        State::from_tubes(vec![vec![0, 1], vec![1, 0], vec![]], 2, 2)
    }

    #[test]
    fn play_undo_restart_roundtrip() {
        let mut g = Game::from_state(unsolved(), 0);
        assert!(!g.is_won(), "the fixture is genuinely unsolved");
        let before = g.current_hash();
        // Pour the top of tube 0 (a single unit) into the empty tube 2.
        g.play(Move { from: 0, to: 2 }).expect("legal pour");
        assert_ne!(g.current_hash(), before);
        assert!(g.undo());
        assert_eq!(g.current_hash(), before, "undo restores the prior state");
        assert!(!g.undo(), "nothing left to undo");
        g.play(Move { from: 0, to: 2 }).expect("legal pour again");
        g.restart();
        assert_eq!(g.current_hash(), before, "restart restores the deal");
        assert_eq!(g.move_count(), 0);
    }

    #[test]
    fn verify_roundtrip_holds_and_detects_tamper() {
        // A real dealt game: two colors, replay a solving line found by brute force.
        let seed = pack_seed(DealParams {
            base: 7,
            attempt: 0,
            colors: 2,
            empties: 2,
        });
        let mut g = Game::new(seed);
        // Greedily play any legal pour until won or stuck (small state solves fast).
        for _ in 0..200 {
            if g.is_won() {
                break;
            }
            let Some(&mv) = g.ui_moves().first() else {
                break;
            };
            let _ = g.play(mv);
        }
        let record = attest::<ColorSort>(seed, g.moves().to_vec(), Outcome::Abandoned, Some(false));
        assert!(verify::<ColorSort>(&record).ok, "an honest record verifies");

        let mut bad_hash = record.clone();
        bad_hash.final_hash = "0".repeat(64);
        assert!(!verify::<ColorSort>(&bad_hash).ok, "a tampered hash fails");
    }
}
