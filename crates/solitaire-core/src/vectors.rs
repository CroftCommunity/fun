//! Golden-vector schema + replay. See RULES.md → "Golden-vector corpus".
//!
//! A vector is a `(seed, move list)` plus, once locked, the recorded
//! `final_state_hash` — a cross-build determinism + regression anchor. Unlike
//! `match3-core`'s tiny boards, a 52-card shuffled deal has no practical
//! hand-computed step-0 expectation, so the anchor is the recorded hash and the
//! move list is documented in `notes`.

use serde::Deserialize;

use crate::board::GameState;
use crate::engine::{Move, MoveError};

/// One golden vector loaded from `vectors/*.json`.
#[derive(Debug, Deserialize)]
pub struct Vector {
    /// Human-readable name.
    pub name: String,
    /// Game seed.
    pub seed: u64,
    /// The move list to replay (default: empty = just the deal).
    #[serde(default)]
    pub moves: Vec<Move>,
    /// Recorded final state hash (locked once the engine is green; empty until).
    #[serde(default)]
    pub final_state_hash: String,
    /// What the vector exercises.
    #[serde(default)]
    pub notes: String,
}

impl Vector {
    /// Deal from `seed`, apply every move (each expected legal), return the
    /// final state.
    ///
    /// # Errors
    /// Returns the first [`MoveError`] if any move in the list is illegal —
    /// which, for a locked vector, indicates a regression.
    pub fn replay(&self) -> Result<GameState, MoveError> {
        let mut game = GameState::new_game(self.seed);
        for &mv in &self.moves {
            game.play_move(mv)?;
        }
        Ok(game)
    }
}
