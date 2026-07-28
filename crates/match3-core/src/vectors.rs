//! Golden-vector corpus types + a replay harness. See `vectors/README.md`.
//!
//! A vector is a hand-authored input plus hand-computable expectations
//! (move legality, step-0 clears, step-0 score). `final_state_hash` is a
//! recorded regression + cross-build-determinism anchor (locked once the engine
//! is green — by construction it is not hand-derivable).

use serde::Deserialize;

use crate::board::Board;
use crate::engine::{Game, Pos};

/// `[from_row, from_col, to_row, to_col]`.
pub type Move4 = [usize; 4];

#[derive(Debug, Clone, Deserialize)]
pub struct Expect {
    #[serde(default)]
    pub move_legal: Vec<bool>,
    #[serde(default)]
    pub step0_cleared: Vec<Vec<[usize; 2]>>,
    #[serde(default)]
    pub step0_score: Vec<u64>,
    #[serde(default)]
    pub final_state_hash: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Vector {
    pub name: String,
    pub seed: u64,
    pub colors: usize,
    pub board: Vec<String>,
    #[serde(default)]
    pub moves: Vec<Move4>,
    pub expect: Expect,
}

/// What a replay actually produced — compared against `Vector::expect`.
#[derive(Debug, Clone)]
pub struct Observed {
    pub move_legal: Vec<bool>,
    pub step0_cleared: Vec<Vec<Pos>>,
    pub step0_score: Vec<u64>,
    pub final_state_hash: String,
}

impl Vector {
    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }

    pub fn to_game(&self) -> Game {
        let rows: Vec<&str> = self.board.iter().map(|s| s.as_str()).collect();
        let board = Board::from_rows(&rows).expect("vector board parses");
        Game::new(board, self.seed, self.colors)
    }

    /// Replay every move against a fresh game and record observations.
    pub fn replay(&self) -> Observed {
        let mut game = self.to_game();
        let mut move_legal = Vec::new();
        let mut step0_cleared = Vec::new();
        let mut step0_score = Vec::new();
        for mv in &self.moves {
            let report = game.play_move((mv[0], mv[1]), (mv[2], mv[3]));
            move_legal.push(report.legal);
            let (cleared, score) = match report.steps.first() {
                Some(s) => (s.cleared.clone(), s.score_gained),
                None => (Vec::new(), 0),
            };
            step0_cleared.push(cleared);
            step0_score.push(score);
        }
        Observed {
            move_legal,
            step0_cleared,
            step0_score,
            final_state_hash: game.state_hash(),
        }
    }
}
