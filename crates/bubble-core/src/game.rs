//! The `Game` play-loop and the verifiable-outcome binding (RULES.md "Aim" /
//! "The shot" one layer up).
//!
//! A `Game` holds the board, a deterministic launcher-colour stream, a shot
//! budget, and the running score. Because the launcher colour of shot `i` is
//! derived from `(seed, i)` and aim is a tap-target `Pos`, a whole game replays
//! exactly from `(seed, targets)` — which is what makes the outcome verifiable
//! ([`Bubble`] implements [`pond_outcome::Game`]).

use std::collections::BTreeSet;

use crate::board::{Board, Cell, Pos};
use crate::clear_board_mode as mode;
use crate::engine::{deal, is_cleared, shoot, ShotError, ShotReport};
use crate::hash::state_hash;
use crate::rng::DetRng;

/// Decorrelate the launcher-colour stream from the deal stream (both seeded from
/// the same game seed) with a fixed golden-ratio XOR, so launcher colours are
/// not a mirror of the dealt colours. Deterministic.
const LAUNCHER_SEED_XOR: u64 = 0x9E37_79B9_7F4A_7C15;

/// The distinct bubble colours currently on the board, in ascending order
/// (deterministic).
fn present_colors(board: &Board) -> Vec<u8> {
    let mut set = BTreeSet::new();
    for cell in board.cells() {
        if let Cell::Bubble(c) = cell {
            set.insert(*c);
        }
    }
    set.into_iter().collect()
}

/// Load the launcher with a colour that is **present on the board** (a
/// deterministic pick over the present set), so a shot can always make progress
/// — better gameplay than a purely random colour, and it keeps the board
/// clearable, which is what makes the B4 winnable pack tractable. Returns `0`
/// when the board is empty (the game is already won; the colour is unused).
fn pick_color(board: &Board, rng: &mut DetRng) -> u8 {
    let present = present_colors(board);
    if present.is_empty() {
        return 0;
    }
    present[rng.index(present.len())]
}

/// A single clear-the-board game: board + deterministic launcher + budget.
#[derive(Clone)]
pub struct Game {
    board: Board,
    colors: usize,
    budget: usize,
    deal_draws: u64,
    launcher: DetRng,
    current: u8,
    shots: Vec<Pos>,
    score: u64,
}

impl Game {
    /// A game in the default clear-the-board mode ([`mode`]).
    #[must_use]
    pub fn new(seed: u64) -> Self {
        Self::with_params(
            seed,
            mode::WIDTH,
            mode::HEIGHT,
            mode::ROWS_FILLED,
            mode::COLORS,
            mode::SHOT_BUDGET,
        )
    }

    /// A game with explicit parameters (used by the solver and by tests).
    #[must_use]
    pub fn with_params(
        seed: u64,
        width: usize,
        height: usize,
        rows_filled: usize,
        colors: usize,
        budget: usize,
    ) -> Self {
        let d = deal(seed, width, height, rows_filled, colors);
        let mut launcher = DetRng::from_seed(seed ^ LAUNCHER_SEED_XOR);
        let current = pick_color(&d.board, &mut launcher);
        Self {
            board: d.board,
            colors,
            budget,
            deal_draws: d.draws,
            launcher,
            current,
            shots: Vec::new(),
            score: 0,
        }
    }

    /// The current board (for rendering / legal-target queries).
    #[must_use]
    pub fn board(&self) -> &Board {
        &self.board
    }

    /// The colour loaded in the launcher (the colour the next shot places).
    #[must_use]
    pub fn current_color(&self) -> u8 {
        self.current
    }

    /// Shots remaining in the budget.
    #[must_use]
    pub fn shots_left(&self) -> usize {
        self.budget.saturating_sub(self.shots.len())
    }

    /// Cumulative score (pop/drop).
    #[must_use]
    pub fn score(&self) -> u64 {
        self.score
    }

    /// The shot targets taken so far (the outcome proof passed to `attest`).
    #[must_use]
    pub fn shots(&self) -> &[Pos] {
        &self.shots
    }

    /// The board is cleared — the objective is met.
    #[must_use]
    pub fn is_won(&self) -> bool {
        is_cleared(&self.board)
    }

    /// The budget is spent and the board is not cleared.
    #[must_use]
    pub fn is_lost(&self) -> bool {
        self.shots.len() >= self.budget && !is_cleared(&self.board)
    }

    /// The canonical state hash, folding the RNG position (deal + launcher) and
    /// the score, so replay reproduces it exactly.
    #[must_use]
    pub fn current_hash(&self) -> String {
        state_hash(
            &self.board,
            self.colors,
            self.deal_draws + self.launcher.draws(),
            self.score,
        )
    }

    /// Fire the current launcher colour at `target`, then load the next colour.
    ///
    /// # Errors
    /// Returns `IllegalTarget` if `target` is not a legal landing cell; on error
    /// nothing changes (no shot recorded, no launcher advance) — so a tampered
    /// move list diverges the state hash and fails verification.
    pub fn play(&mut self, target: Pos) -> Result<ShotReport, ShotError> {
        let report = shoot(&mut self.board, target, self.current)?;
        self.score += report.score_gain;
        self.shots.push(target);
        self.current = pick_color(&self.board, &mut self.launcher);
        Ok(report)
    }
}

/// The verifiable-outcome binding for the bubble shooter.
pub struct Bubble;

impl pond_outcome::Game for Bubble {
    type Move = Pos;
    const KIND: &'static str = "bubble";
    const VERSION: u32 = 1;

    fn replay(seed: u64, moves: &[Pos]) -> pond_outcome::Replayed {
        let mut game = Game::new(seed);
        for &target in moves {
            // An illegal target in a tampered record is a no-op, so the state
            // hash diverges from the honest game and verification fails.
            let _ = game.play(target);
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
    use crate::engine::legal_targets;
    use pond_outcome::{attest, verify, Game as _, Outcome};

    #[test]
    fn verify_roundtrip_holds_and_detects_tamper() {
        let seed = 7;
        let mut g = Game::new(seed);
        // Play three legal shots, choosing the first legal target each time
        // (deterministic, row-major order).
        let mut targets = Vec::new();
        for _ in 0..3 {
            let t = legal_targets(g.board())[0];
            g.play(t).expect("first legal target is legal");
            targets.push(t);
        }
        let record = attest::<Bubble>(seed, targets, Outcome::Abandoned, Some(false));
        assert!(verify::<Bubble>(&record).ok, "an honest record verifies");
        assert!(record.score.is_some(), "score is surfaced");
        assert_eq!(record.stars, None, "no stars for v1");

        let mut tampered = record.clone();
        tampered.final_hash = "0".repeat(64);
        assert!(
            !verify::<Bubble>(&tampered).ok,
            "a tampered hash fails verification"
        );
    }

    #[test]
    fn win_on_the_last_shot() {
        // colours=1, 3x3, one filled row => a 3-cluster; one shot into (1,0)
        // connects a 4-cluster and clears the board. Budget 1 => the last shot.
        let mut g = Game::with_params(1, 3, 3, 1, 1, 1);
        assert_eq!(g.shots_left(), 1);
        g.play((1, 0))
            .expect("adjacent to the filled row, so legal");
        assert!(g.is_won(), "the board is cleared");
        assert!(!g.is_lost());
        assert_eq!(g.shots_left(), 0);
    }

    #[test]
    fn budget_spent_without_clearing_is_lost() {
        // Budget 0 on a non-empty board: immediately lost, no shots taken.
        let g = Game::with_params(1, 3, 3, 1, 1, 0);
        assert!(!g.is_won());
        assert!(g.is_lost());
    }

    #[test]
    fn replay_is_deterministic_and_scores() {
        let seed = 42;
        let mut g = Game::new(seed);
        let mut targets = Vec::new();
        for _ in 0..3 {
            let t = legal_targets(g.board())[0];
            g.play(t).expect("legal");
            targets.push(t);
        }
        let a = Bubble::replay(seed, &targets);
        let b = Bubble::replay(seed, &targets);
        assert_eq!(a.final_hash, b.final_hash, "replay is deterministic");
        assert_eq!(a.won, g.is_won());
        assert!(a.score.is_some());
        assert_eq!(a.stars, None);
    }
}
