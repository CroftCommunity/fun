//! The `Game` play-loop and the verifiable-outcome binding (RULES.md "Aim" /
//! "The shot" one layer up).
//!
//! A `Game` holds the board, a deterministic launcher-colour stream, a shot
//! budget, and the running score. Because the launcher colour of shot `i` is
//! derived from `(seed, i)` and aim is a quantized integer [`Angle`], a whole
//! game replays exactly from `(seed, angles)` — the fixed-point resolver turns
//! each angle back into the same landing — which is what makes the outcome
//! verifiable ([`Bubble`] implements [`pond_outcome::Game`]).

use std::collections::BTreeSet;

use crate::aim::Angle;
use crate::board::{Board, Cell};
use crate::clear_board_mode as mode;
use crate::engine::{deal, is_cleared, shoot_angle, ShotReport};
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
    /// The on-deck colour — the next shot's colour, shown as a preview. The
    /// launcher is a 2-deep pipeline: `current` fires now, `next` is on deck.
    /// Because `next` is chosen one shot ahead (from the board as it stood then),
    /// it can be previewed before the intervening shot resolves — at the cost of
    /// the fired colour no longer being guaranteed present on the current board.
    next: u8,
    /// The recorded aim line (the outcome proof). Only [`Game::play`] appends;
    /// the solver's landing-space [`Game::play_at`] advances without recording.
    shots: Vec<Angle>,
    /// Shots fired against the budget — incremented by both `play` and
    /// `play_at`, so budget tracking holds for the solver's landing-space search
    /// as well as a real angle game (for a real game `taken == shots.len()`).
    taken: usize,
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
        // Fill the 2-deep pipeline up front — both drawn from the initial board —
        // so the on-deck colour can be previewed before the first shot.
        let current = pick_color(&d.board, &mut launcher);
        let next = pick_color(&d.board, &mut launcher);
        Self {
            board: d.board,
            colors,
            budget,
            deal_draws: d.draws,
            launcher,
            current,
            next,
            shots: Vec::new(),
            taken: 0,
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

    /// The on-deck colour — the colour the shot *after* this one will place.
    /// Shown as a next-piece preview; becomes `current_color` on the next shot.
    #[must_use]
    pub fn next_color(&self) -> u8 {
        self.next
    }

    /// Shots remaining in the budget.
    #[must_use]
    pub fn shots_left(&self) -> usize {
        self.budget.saturating_sub(self.taken)
    }

    /// Cumulative score (pop/drop).
    #[must_use]
    pub fn score(&self) -> u64 {
        self.score
    }

    /// The aim line fired so far (the outcome proof passed to `attest`).
    #[must_use]
    pub fn shots(&self) -> &[Angle] {
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
        self.taken >= self.budget && !is_cleared(&self.board)
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

    /// Fire the current launcher colour at `angle`: the core resolves the
    /// landing ([`shoot_angle`]), applies the shot, records the angle, and loads
    /// the next colour. Infallible — every angle lands somewhere, so a tampered
    /// angle simply resolves to a different landing and diverges the state hash,
    /// failing verification.
    pub fn play(&mut self, angle: Angle) -> ShotReport {
        let report = shoot_angle(&mut self.board, angle, self.current);
        self.score += report.score_gain;
        self.shots.push(angle);
        self.taken += 1;
        // Advance the pipeline: the on-deck colour loads into the launcher, and a
        // fresh on-deck colour is drawn from the now-resolved board.
        self.current = self.next;
        self.next = pick_color(&self.board, &mut self.launcher);
        report
    }
}

/// The verifiable-outcome binding for the bubble shooter.
pub struct Bubble;

impl pond_outcome::Game for Bubble {
    type Move = Angle;
    const KIND: &'static str = "bubble";
    const VERSION: u32 = 3;

    fn replay(seed: u64, moves: &[Angle]) -> pond_outcome::Replayed {
        let mut game = Game::new(seed);
        for &angle in moves {
            // Each angle re-resolves to its landing on the current board, so an
            // honest line reproduces the hash and a tampered angle diverges it.
            game.play(angle);
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

    // A fixed aim line: straight up, then two off-centre angles. The exact
    // landings are the resolver's business — the record just has to replay.
    const LINE: [Angle; 3] = [Angle(90), Angle(70), Angle(110)];

    #[test]
    fn verify_roundtrip_holds_and_detects_tamper() {
        let seed = 7;
        let mut g = Game::new(seed);
        for &a in &LINE {
            g.play(a);
        }
        let record = attest::<Bubble>(seed, g.shots().to_vec(), Outcome::Abandoned, Some(false));
        assert!(verify::<Bubble>(&record).ok, "an honest record verifies");
        assert!(record.score.is_some(), "score is surfaced");

        let mut bad_hash = record.clone();
        bad_hash.final_hash = "0".repeat(64);
        assert!(
            !verify::<Bubble>(&bad_hash).ok,
            "a tampered hash fails verification"
        );

        // Tampering an angle re-resolves to a different landing, so the replayed
        // hash no longer matches the stored one.
        let mut bad_angle = record.clone();
        bad_angle.moves[0] = Angle(45);
        assert!(
            !verify::<Bubble>(&bad_angle).ok,
            "a tampered angle diverges the hash"
        );
    }

    #[test]
    fn fresh_game_previews_current_and_next_from_the_deal() {
        // The launcher is a 2-deep pipeline: a fresh game exposes the loaded
        // colour AND the on-deck colour, both drawn from the initial board so a
        // preview can be shown before the first shot.
        let g = Game::new(7);
        let present = present_colors(g.board());
        assert!(
            present.contains(&g.current_color()),
            "loaded colour is present on the board"
        );
        assert!(
            present.contains(&g.next_color()),
            "on-deck colour is present on the board"
        );
    }

    #[test]
    fn next_promotes_to_current_on_each_shot() {
        // The shown "next" is exactly the colour fired next: each shot promotes
        // the on-deck colour into the launcher, then loads a fresh on-deck colour.
        let mut g = Game::new(7);
        for &a in &LINE {
            let upcoming = g.next_color();
            g.play(a);
            assert_eq!(
                g.current_color(),
                upcoming,
                "the previewed on-deck colour becomes the loaded colour after a shot"
            );
        }
    }

    #[test]
    fn bubble_record_is_v3() {
        // The 2-deep launcher changes the fired-colour sequence, so the outcome
        // version is bumped (v2 shares no longer verify against v3 replay).
        assert_eq!(<Bubble as pond_outcome::Game>::VERSION, 3);
    }

    #[test]
    fn win_on_the_last_shot() {
        // colours=1, 3x3, one filled row => a 3-cluster; a straight-up shot
        // resolves to the cell below centre, completing a 4-cluster that clears
        // the board. Budget 1 => the last shot.
        let mut g = Game::with_params(1, 3, 3, 1, 1, 1);
        assert_eq!(g.shots_left(), 1);
        g.play(Angle(90));
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
        for &a in &LINE {
            g.play(a);
        }
        let angles = g.shots().to_vec();
        let a = Bubble::replay(seed, &angles);
        let b = Bubble::replay(seed, &angles);
        assert_eq!(a.final_hash, b.final_hash, "replay is deterministic");
        assert_eq!(a.won, g.is_won());
        assert!(a.score.is_some());
    }
}
