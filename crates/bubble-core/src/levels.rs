//! Levels mode — the escalating, point-gated, descending-stack game (RULES.md
//! "Levels mode"). Endless survival: earn each level's point target while
//! periodic top-row inserts push the stack toward the bottom deadline; the run
//! ends when a bubble crosses it.
//!
//! Determinism holds exactly as in clear-board mode. The board, launcher-colour
//! stream, and insert-row colours are all seeded ([`DetRng`]); the insert trigger
//! is the **shot count** (a pure function of the recorded angle list); and no
//! wall clock ever drives a state transition (the timer is presentational, read
//! from [`LevelConfig::time_limit_secs_at`] but never consulted here). So a whole
//! run replays byte-identically from `(seed, angles)` against the state hash,
//! which is what makes [`BubbleLevels`] a verifiable [`pond_outcome::Game`].

use crate::aim::Angle;
use crate::board::{Board, Cell};
use crate::engine::{deal, shoot_angle, ShotReport};
use crate::game::{pick_color, present_colors};
use crate::hash::state_hash;
use crate::levels_mode as mode;
use crate::rng::DetRng;

/// Decorrelate the levels launcher-colour stream from the deal stream.
const LEVELS_LAUNCHER_XOR: u64 = 0xC2B2_AE3D_27D4_EB4F;
/// Decorrelate the insert-row colour stream from both the deal and launcher.
const LEVELS_INSERT_XOR: u64 = 0x1656_67B1_9E37_79F9;

/// The arcade dropped-bubble score for `n` bubbles dropped in one shot:
/// `20 · 2^(n-1)`, capped at `1_310_720` for `n ≥ 17` (RULES.md "Levels mode").
/// `0` for `n == 0`. Popped bubbles score `10` each (applied in [`LevelGame::play`]).
#[must_use]
pub fn drop_score(n: usize) -> u64 {
    if n == 0 {
        return 0;
    }
    // Cap the exponent at 16 (n == 17) so the shift never overflows and the value
    // saturates at 20 << 16 == 1_310_720.
    let shift = (n - 1).min(16) as u32;
    20u64 << shift
}

/// A coarse 0–3 star grade for the highest level reached — the shelf-consistent
/// graded-score metric surfaced on the shared record.
#[must_use]
pub fn grade(level: u32) -> u8 {
    match level {
        0 | 1 => 0,
        2 | 3 => 1,
        4 | 5 => 2,
        _ => 3,
    }
}

/// The tunable difficulty knobs for levels mode. [`LevelConfig::default_mode`]
/// reads the [`crate::levels_mode`] constants; tests and future calibration use
/// [`LevelGame::with_config`] to vary them (mirrors `Game::with_params`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LevelConfig {
    /// Cells in a full (even) row.
    pub width: usize,
    /// Rows on the board (**even** — see [`Board::insert_top_row`]).
    pub height: usize,
    /// Palette-size metadata folded into the state hash.
    pub max_colors: usize,
    /// Reserved bottom rows: a bubble here ends the run.
    pub deadline_rows: usize,
    /// Colours at level 1 (`+1` per level up to `max_colors`).
    pub colors_base: usize,
    /// Pre-filled rows at level 1.
    pub start_rows_base: usize,
    /// Points to clear level 1.
    pub target_base: u64,
    /// Extra points required per level above 1.
    pub target_step: u64,
    /// Shots between inserts at level 1.
    pub cadence_base: usize,
    /// Fastest insert cadence (floor).
    pub cadence_floor: usize,
}

impl LevelConfig {
    /// The shipped levels-mode configuration (the [`crate::levels_mode`] knobs).
    #[must_use]
    pub fn default_mode() -> Self {
        Self {
            width: mode::WIDTH,
            height: mode::HEIGHT,
            max_colors: mode::MAX_COLORS,
            deadline_rows: mode::DEADLINE_ROWS,
            colors_base: mode::COLORS_BASE,
            start_rows_base: mode::START_ROWS_BASE,
            target_base: mode::TARGET_BASE,
            target_step: mode::TARGET_STEP,
            cadence_base: mode::CADENCE_BASE,
            cadence_floor: mode::CADENCE_FLOOR,
        }
    }

    /// Colours in play at `level` (`level ≥ 1`): ramps from `colors_base` by one
    /// per level, capped at `max_colors`.
    #[must_use]
    pub fn colors_at(&self, level: u32) -> usize {
        (self.colors_base + (level.max(1) as usize - 1)).min(self.max_colors)
    }

    /// Rows pre-filled at the level-1 deal — ramps slowly, kept clear of the
    /// deadline so a fresh board is never already lost.
    #[must_use]
    pub fn start_rows_at(&self, level: u32) -> usize {
        let cap = self.height.saturating_sub(self.deadline_rows + 1);
        (self.start_rows_base + (level.max(1) as usize - 1) / 2).min(cap)
    }

    /// Points required to clear `level`.
    #[must_use]
    pub fn target_score_at(&self, level: u32) -> u64 {
        self.target_base + self.target_step * u64::from(level.max(1) - 1)
    }

    /// Shots between top-row inserts at `level` — tightens with level down to
    /// `cadence_floor`.
    #[must_use]
    pub fn insert_cadence_at(&self, level: u32) -> usize {
        self.cadence_base
            .saturating_sub(level.max(1) as usize - 1)
            .max(self.cadence_floor)
    }

    /// The presentational per-level clock in seconds (never a verified loss —
    /// read by the UI only). Reads the [`crate::levels_mode`] time knobs.
    #[must_use]
    pub fn time_limit_secs_at(&self, level: u32) -> u32 {
        mode::TIME_BASE_SECS
            .saturating_sub(mode::TIME_STEP_SECS * (level.max(1) - 1))
            .max(mode::TIME_FLOOR_SECS)
    }
}

/// Whether any occupied cell sits in the reserved bottom deadline rows.
fn crossed_deadline(board: &Board, deadline_rows: usize) -> bool {
    let start = board.height.saturating_sub(deadline_rows);
    (start..board.height)
        .any(|r| (0..board.row_len_at(r)).any(|c| matches!(board.get(r, c), Some(Cell::Bubble(_)))))
}

/// A single levels-mode run: a descending board, a seeded launcher, a seeded
/// insert stream, and the level/score bookkeeping.
#[derive(Clone)]
pub struct LevelGame {
    board: Board,
    config: LevelConfig,
    level: u32,
    level_score: u64,
    total_score: u64,
    shots_since_insert: usize,
    deal_draws: u64,
    launcher: DetRng,
    insert_rng: DetRng,
    current: u8,
    next: u8,
    shots: Vec<Angle>,
    lost: bool,
    /// Whether the most recent `play` pushed in a new top row (for the UI's
    /// slide-down animation). Presentational.
    last_inserted: bool,
}

impl LevelGame {
    /// A run in the shipped levels-mode configuration.
    #[must_use]
    pub fn new(seed: u64) -> Self {
        Self::with_config(seed, LevelConfig::default_mode())
    }

    /// A run with an explicit [`LevelConfig`] (calibration + tests).
    #[must_use]
    pub fn with_config(seed: u64, config: LevelConfig) -> Self {
        let d = deal(
            seed,
            config.width,
            config.height,
            config.start_rows_at(1),
            config.colors_at(1),
        );
        let mut launcher = DetRng::from_seed(seed ^ LEVELS_LAUNCHER_XOR);
        let insert_rng = DetRng::from_seed(seed ^ LEVELS_INSERT_XOR);
        let current = pick_color(&d.board, &mut launcher);
        let next = pick_color(&d.board, &mut launcher);
        Self {
            board: d.board,
            config,
            level: 1,
            level_score: 0,
            total_score: 0,
            shots_since_insert: 0,
            deal_draws: d.draws,
            launcher,
            insert_rng,
            current,
            next,
            shots: Vec::new(),
            lost: false,
            last_inserted: false,
        }
    }

    /// The current board (rendering / aim queries).
    #[must_use]
    pub fn board(&self) -> &Board {
        &self.board
    }

    /// The current level (starts at 1).
    #[must_use]
    pub fn level(&self) -> u32 {
        self.level
    }

    /// Points earned toward the current level's target.
    #[must_use]
    pub fn level_score(&self) -> u64 {
        self.level_score
    }

    /// Cumulative score across the whole run (the shared metric).
    #[must_use]
    pub fn total_score(&self) -> u64 {
        self.total_score
    }

    /// Points required to clear the current level.
    #[must_use]
    pub fn target_score(&self) -> u64 {
        self.config.target_score_at(self.level)
    }

    /// Colours in play at the current level.
    #[must_use]
    pub fn colors(&self) -> usize {
        self.config.colors_at(self.level)
    }

    /// Shots remaining until the next top-row insert.
    #[must_use]
    pub fn shots_to_insert(&self) -> usize {
        self.config
            .insert_cadence_at(self.level)
            .saturating_sub(self.shots_since_insert)
    }

    /// The presentational per-level clock in seconds (UI only, never a loss).
    #[must_use]
    pub fn time_limit_secs(&self) -> u32 {
        self.config.time_limit_secs_at(self.level)
    }

    /// The colour loaded in the launcher.
    #[must_use]
    pub fn current_color(&self) -> u8 {
        self.current
    }

    /// The on-deck colour (next-piece preview).
    #[must_use]
    pub fn next_color(&self) -> u8 {
        self.next
    }

    /// Whether the run has ended (a bubble crossed the deadline).
    #[must_use]
    pub fn is_lost(&self) -> bool {
        self.lost
    }

    /// Levels mode is endless survival — there is no terminal win.
    #[must_use]
    pub fn is_won(&self) -> bool {
        false
    }

    /// Whether the most recent `play` pushed in a new top row (UI animation).
    #[must_use]
    pub fn last_inserted(&self) -> bool {
        self.last_inserted
    }

    /// The recorded aim line (the outcome proof).
    #[must_use]
    pub fn shots(&self) -> &[Angle] {
        &self.shots
    }

    /// The reserved bottom deadline row count.
    #[must_use]
    pub fn deadline_rows(&self) -> usize {
        self.config.deadline_rows
    }

    /// The canonical state hash, folding the RNG position (deal + launcher +
    /// insert stream) and the cumulative score.
    #[must_use]
    pub fn current_hash(&self) -> String {
        state_hash(
            &self.board,
            self.config.max_colors,
            self.deal_draws + self.launcher.draws() + self.insert_rng.draws(),
            self.total_score,
        )
    }

    /// Push a new top row of seeded colours (from the current level's palette),
    /// returning whether occupied content was pushed off the bottom.
    fn insert_row(&mut self) -> bool {
        let colors = self.colors();
        let new_offset = 1 - self.board.parity_offset();
        let len = Board::row_len_off(self.config.width, 0, new_offset);
        let new_top: Vec<Cell> = (0..len)
            .map(|_| {
                let c = u8::try_from(self.insert_rng.index(colors)).unwrap_or(0);
                Cell::Bubble(c)
            })
            .collect();
        self.board.insert_top_row(&new_top)
    }

    /// Fire the current launcher colour along `angle`: resolve + apply the shot,
    /// score it (arcade: `10·popped + drop_score(dropped)`), advance the level
    /// when the target is met, fire a top-row insert on the shot-count cadence,
    /// and check the deadline. A no-op once the run is lost. Infallible — every
    /// angle lands somewhere.
    pub fn play(&mut self, angle: Angle) -> ShotReport {
        self.last_inserted = false;
        if self.lost {
            return ShotReport {
                popped: Vec::new(),
                dropped: Vec::new(),
                score_gain: 0,
            };
        }
        let report = shoot_angle(&mut self.board, angle, self.current);
        let gain = 10 * report.popped.len() as u64 + drop_score(report.dropped.len());
        self.level_score += gain;
        self.total_score += gain;
        self.shots.push(angle);

        // Advance the level while the (carried-over) score meets the target.
        while self.level_score >= self.config.target_score_at(self.level) {
            self.level_score -= self.config.target_score_at(self.level);
            self.level += 1;
        }

        // Shot-driven pressure: a new row every `insert_cadence(level)` shots.
        self.shots_since_insert += 1;
        let mut pushed_off = false;
        if self.shots_since_insert >= self.config.insert_cadence_at(self.level) {
            pushed_off = self.insert_row();
            self.shots_since_insert = 0;
            self.last_inserted = true;
        }

        if pushed_off || crossed_deadline(&self.board, self.config.deadline_rows) {
            self.lost = true;
        }

        // Advance the launcher pipeline (deterministic, from the resolved board).
        self.current = self.next;
        self.next = pick_color(&self.board, &mut self.launcher);
        report
    }
}

/// The verifiable-outcome binding for levels mode. Endless survival, so the
/// result is never `Won`; the shared metric is the cumulative score, with a 0–3
/// star grade for the highest level reached.
pub struct BubbleLevels;

impl pond_outcome::Game for BubbleLevels {
    type Move = Angle;
    const KIND: &'static str = "bubble-levels";
    const VERSION: u32 = 1;

    fn replay(seed: u64, moves: &[Angle]) -> pond_outcome::Replayed {
        let mut game = LevelGame::new(seed);
        for &angle in moves {
            game.play(angle);
        }
        pond_outcome::Replayed::scored(
            game.current_hash(),
            false,
            game.total_score(),
            grade(game.level()),
        )
    }
}

/// The distinct colours present on `board` (re-exported helper for the wasm
/// binding's live-colour readouts). Deterministic ascending order.
#[must_use]
pub fn board_colors(board: &Board) -> Vec<u8> {
    present_colors(board)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pond_outcome::{attest, verify, Game as _, Outcome};

    #[test]
    fn drop_score_follows_the_arcade_series_and_caps() {
        assert_eq!(drop_score(0), 0);
        assert_eq!(drop_score(1), 20);
        assert_eq!(drop_score(2), 40);
        assert_eq!(drop_score(3), 80);
        assert_eq!(drop_score(7), 1_280);
        assert_eq!(drop_score(17), 1_310_720, "caps at n=17");
        assert_eq!(drop_score(30), 1_310_720, "stays capped beyond 17");
    }

    #[test]
    fn a_fresh_run_is_level_one_with_a_present_colour_loaded() {
        let g = LevelGame::new(7);
        assert_eq!(g.level(), 1);
        assert_eq!(g.total_score(), 0);
        assert!(!g.is_lost());
        assert_eq!(g.board().height, mode::HEIGHT);
        assert_eq!(
            g.board().height % 2,
            0,
            "even height for parity-flip inserts"
        );
        let present = board_colors(g.board());
        assert!(
            present.contains(&g.current_color()),
            "loaded colour is on the board"
        );
        assert!(
            present.contains(&g.next_color()),
            "on-deck colour is on the board"
        );
    }

    #[test]
    fn score_accumulates_by_the_arcade_formula() {
        // Every play adds exactly 10·popped + drop_score(dropped) to the total.
        let mut g = LevelGame::new(42);
        let mut expected = 0u64;
        for deg in [90u16, 70, 110, 85, 95, 60, 120] {
            let rep = g.play(Angle(deg));
            expected += 10 * rep.popped.len() as u64 + drop_score(rep.dropped.len());
            assert_eq!(g.total_score(), expected, "total tracks the arcade formula");
        }
    }

    #[test]
    fn reaching_the_target_advances_the_level() {
        // A single-colour palette makes a pop deterministic: the dealt block is
        // one connected colour-0 cluster, so a straight-up shot connects to it and
        // pops ≥3. A tiny target then crosses on that first scoring shot. Loose
        // cadence keeps the early shots from inserting/losing first.
        let cfg = LevelConfig {
            colors_base: 1,
            max_colors: 1,
            start_rows_base: 3,
            target_base: 20,
            target_step: 20,
            cadence_base: 50,
            cadence_floor: 50,
            ..LevelConfig::default_mode()
        };
        let mut g = LevelGame::with_config(3, cfg);
        let rep = g.play(Angle(90));
        assert!(
            rep.popped.len() >= 3,
            "a same-colour block pops, got {rep:?}"
        );
        assert!(
            g.total_score() >= cfg.target_base,
            "the target's worth of points was earned"
        );
        assert!(g.level() > 1, "crossing the target advanced the level");
    }

    #[test]
    fn an_insert_fires_on_the_shot_cadence() {
        // Default config: cadence 6 at level 1, target 1500 (no level-up in 6
        // shots), so the 6th shot — and only it — pushes in a new row.
        let mut g = LevelGame::new(11);
        for _ in 0..5 {
            g.play(Angle(90));
            assert!(!g.last_inserted(), "no insert before the cadence");
        }
        assert_eq!(g.shots_to_insert(), 1, "one shot from an insert");
        g.play(Angle(90));
        assert!(g.last_inserted(), "the 6th shot pushes in a new top row");
        assert_eq!(g.board().parity_offset(), 1, "the insert flipped parity");
    }

    #[test]
    fn the_stack_crossing_the_deadline_ends_the_run() {
        // A short board that fills to the deadline fast: height 4 (even), 3 rows
        // pre-filled, 1 deadline row, and an insert every shot — the first insert
        // shifts a filled row into the deadline row.
        let cfg = LevelConfig {
            height: 4,
            deadline_rows: 1,
            start_rows_base: 3,
            cadence_base: 1,
            cadence_floor: 1,
            target_base: 1_000_000,
            target_step: 0,
            ..LevelConfig::default_mode()
        };
        let mut g = LevelGame::with_config(5, cfg);
        assert!(!g.is_lost(), "a fresh board is not already lost");
        // Within a few shots the descending rows must cross the deadline.
        for _ in 0..6 {
            if g.is_lost() {
                break;
            }
            g.play(Angle(90));
        }
        assert!(g.is_lost(), "the stack crossed the bottom deadline");
        // Once lost, further play is a frozen no-op.
        let score = g.total_score();
        let rep = g.play(Angle(90));
        assert_eq!(rep.score_gain, 0);
        assert_eq!(g.total_score(), score, "no scoring after the run ends");
    }

    #[test]
    fn replay_is_deterministic_and_verifies_and_detects_tamper() {
        let seed = 99;
        let line = [
            Angle(90),
            Angle(70),
            Angle(120),
            Angle(85),
            Angle(100),
            Angle(60),
            Angle(150),
        ];
        let mut g = LevelGame::new(seed);
        for &a in &line {
            g.play(a);
        }
        let record = attest::<BubbleLevels>(seed, g.shots().to_vec(), Outcome::Lost, Some(false));
        assert_eq!(record.kind, "bubble-levels");
        assert!(record.score.is_some(), "score is surfaced");
        assert!(record.stars.is_some(), "a star grade is surfaced");
        assert!(
            verify::<BubbleLevels>(&record).ok,
            "an honest record verifies"
        );

        // Determinism: a second replay reproduces the hash + score.
        let a = BubbleLevels::replay(seed, &line);
        let b = BubbleLevels::replay(seed, &line);
        assert_eq!(a.final_hash, b.final_hash);
        assert_eq!(a.score, b.score);

        let mut tampered = record.clone();
        tampered.moves[0] = Angle(45);
        assert!(
            !verify::<BubbleLevels>(&tampered).ok,
            "a tampered angle diverges the replayed hash"
        );
    }

    #[test]
    fn record_is_bubble_levels_v1() {
        assert_eq!(<BubbleLevels as pond_outcome::Game>::KIND, "bubble-levels");
        assert_eq!(<BubbleLevels as pond_outcome::Game>::VERSION, 1);
    }

    /// Reachability sanity (V3): the shipped difficulty curve must be *possible* —
    /// good play reaches at least level 2 (i.e. earns `target_score(1) = 1500`)
    /// before the descending stack crosses the deadline. Greedy play maximises
    /// pop+drop each shot (the `hint_angle` heuristic). A regression that makes a
    /// level target unreachable fails here rather than shipping an impossible ramp.
    #[test]
    fn the_shipped_level_one_target_is_reachable_by_good_play() {
        let (lo, hi) = crate::fan();
        let mut reached_level_2_before_loss = false;
        // A few seeds so the check isn't a single lucky deal.
        for seed in [1u64, 7, 42, 100] {
            let mut g = LevelGame::new(seed);
            for _ in 0..250 {
                if g.is_lost() || g.level() >= 2 {
                    break;
                }
                // Pick the fan angle that removes the most bubbles this shot.
                let mut best = lo;
                let mut best_gain = 0usize;
                for deg in lo..=hi {
                    let mut probe = g.clone();
                    let rep = probe.play(Angle(deg));
                    let gain = rep.popped.len() + rep.dropped.len();
                    if gain > best_gain {
                        best_gain = gain;
                        best = deg;
                    }
                }
                g.play(Angle(best));
            }
            if g.level() >= 2 {
                reached_level_2_before_loss = true;
                break;
            }
        }
        assert!(
            reached_level_2_before_loss,
            "good play must be able to clear level 1's target before the deadline"
        );
    }
}
