//! The difficulty band — how the shipped opponent turns a search into a level.
//!
//! The selector is `adversary_solver::select_in_band`, shared with the other
//! versus games. What is chess's own: how a value maps to a win/draw/loss
//! **class** (checkers' magnitude shape — only a proven terminal produces a
//! value beyond the heuristic's ceiling, so an ordinary horizon judgement
//! classifies as `0` and a proven mate by its sign), and the level table,
//! whose depths and node budgets are the Phase 4 measurement (Chromium,
//! 50 positions: Easy d2/10k = 16 ms worst · Medium d3/40k = 66 · Hard
//! d4/100k = 170 · Expert d5/150k = 258, 0/50 over 400 ms at ~730k nps —
//! `plans/2026-08-30-plan-chess-vs-engine.md`, Phase 4's Review Log; the
//! Samsung confirmation is owed, and the recorded lever if it misses the
//! 400 ms bar is Expert's cap, a constant here).

use chess_core::{result, Move, Position};
use rand_chacha::rand_core::RngCore;

// Re-exported so `chess_solver::live::*` names them, matching the other games.
pub use adversary_solver::{select_in_band, LiveBand};

use crate::eval::MATE;
use crate::search::search_root;

/// Above this magnitude a value can only have come from a proven terminal —
/// the heuristic's ceiling is all the material on the board, a few thousand.
const TERMINAL_MAGNITUDE: i32 = MATE / 2;

/// Difficulty levels — a deepening ceiling, a node budget, and (via the band)
/// a class floor and sloppiness. Chess is unsolved, so even Expert is a strong
/// heuristic player that proves what it can inside its horizon.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    /// Shallow, sloppy, beatable.
    Easy,
    /// Moderate depth.
    Medium,
    /// Deep, class-preserving.
    Hard,
    /// Deepest, tightest.
    Expert,
}

impl Level {
    /// The deepening ceiling for this level (`search_root`'s `max_depth`).
    /// `const` so the tutor can pin its depth against Expert's at compile time.
    #[must_use]
    pub const fn depth(self) -> u32 {
        match self {
            Level::Easy => 2,
            Level::Medium => 3,
            Level::Hard => 4,
            Level::Expert => 5,
        }
    }

    /// The node budget for this level — the Phase 4 table (module docs).
    #[must_use]
    pub const fn budget(self) -> u64 {
        match self {
            Level::Easy => 10_000,
            Level::Medium => 40_000,
            Level::Hard => 100_000,
            Level::Expert => 150_000,
        }
    }
}

/// The win/draw/loss class of a value: `1` a terminal-derived win, `-1` a
/// terminal-derived loss, `0` an unresolved horizon judgement — magnitude is
/// not class (checkers' shape, and for the same reason: exactness here is per
/// move, so a constant `0` would leave the class floor permanently dead).
#[must_use]
pub fn class_of(value: i32) -> i32 {
    if value > TERMINAL_MAGNITUDE {
        1
    } else if value < -TERMINAL_MAGNITUDE {
        -1
    } else {
        0
    }
}

/// The [`LiveBand`] for a [`Level`]: Easy/Medium are shallow, sloppy and
/// beatable; Hard/Expert are class-preserving (never throw a game the search
/// can see the end of), Expert with no sloppiness at all.
#[must_use]
pub fn live_band(level: Level) -> LiveBand {
    match level {
        Level::Easy => LiveBand {
            depth: level.depth(),
            preserve_class: false,
            sloppiness_pct: 60,
        },
        Level::Medium => LiveBand {
            depth: level.depth(),
            preserve_class: false,
            sloppiness_pct: 30,
        },
        Level::Hard => LiveBand {
            depth: level.depth(),
            preserve_class: true,
            sloppiness_pct: 40,
        },
        Level::Expert => LiveBand {
            depth: level.depth(),
            preserve_class: true,
            sloppiness_pct: 0,
        },
    }
}

/// A live opponent move at `level`, or `None` when the position is terminal.
///
/// **A proven mate is always taken, at every level** — Easy's sloppiness makes
/// it beatable between mates, but an opponent that visibly declines a mate in
/// one reads as broken, not easy. The RNG is untouched both there and at zero
/// sloppiness, so Expert plays the same game from the same seed.
#[must_use]
pub fn choose(pos: &Position, level: Level, rng: &mut impl RngCore) -> Option<Move> {
    if result(pos).is_some() {
        return None;
    }
    let band = live_band(level);
    let report = search_root(pos, band.depth, level.budget());
    if report.moves.is_empty() {
        return None;
    }
    if let Some(&(mate, _)) = report
        .moves
        .iter()
        .filter(|&&(_, s)| s.exact && s.value > TERMINAL_MAGNITUDE)
        .max_by_key(|&&(_, s)| s.value)
    {
        return Some(mate);
    }
    let values: Vec<(Move, i32)> = report.moves.iter().map(|&(mv, s)| (mv, s.value)).collect();
    select_in_band(
        &values,
        class_of,
        band.preserve_class,
        band.sloppiness_pct,
        rng,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::{Adversary, MatchResult};
    use chess_core::{legal_moves, Board, Chess};
    use rand_chacha::rand_core::SeedableRng;
    use rand_chacha::ChaCha20Rng;

    fn pos_of(fen: &str) -> Position {
        Position::from_board(Board::from_fen(fen).expect("live test FEN parses"))
    }

    #[test]
    fn the_level_table_is_monotonic_easy_to_expert() {
        // The table is data and gets its test (Pass 3): depth and budget are
        // non-decreasing, and Expert's depth is >= 4 (D2's trigger never fired).
        let ladder = [Level::Easy, Level::Medium, Level::Hard, Level::Expert];
        for pair in ladder.windows(2) {
            assert!(pair[0].depth() <= pair[1].depth(), "{pair:?} depth order");
            assert!(
                pair[0].budget() <= pair[1].budget(),
                "{pair:?} budget order"
            );
        }
        assert!(Level::Expert.depth() >= 4);
    }

    #[test]
    fn class_comes_from_proven_magnitude_not_size() {
        // The three points, the third being the edge: magnitude is not class.
        assert_eq!(class_of(MATE + 3), 1, "a proven mate for the mover");
        assert_eq!(class_of(-(MATE + 3)), -1, "a proven mate against");
        assert_eq!(class_of(900), 0, "a heuristic +900 proves nothing");
        assert_eq!(class_of(-900), 0);
        assert_eq!(class_of(0), 0, "a draw-or-level value");
    }

    #[test]
    #[cfg_attr(debug_assertions, ignore = "release only: 50 searched choices")]
    fn an_immediate_mate_is_taken_even_at_easy() {
        // Easy's 60% sloppiness would otherwise skip Re8# often; a visible
        // declined mate reads as broken, so it never may.
        let pos = pos_of("6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1");
        let mate = <Chess as Adversary>::parse_move(&pos, "e1e8").expect("legal");
        let mut rng = ChaCha20Rng::seed_from_u64(7);
        for _ in 0..50 {
            assert_eq!(choose(&pos, Level::Easy, &mut rng), Some(mate));
        }
    }

    #[test]
    #[cfg_attr(debug_assertions, ignore = "release only: 200 Expert searches")]
    fn expert_never_drops_a_proven_class() {
        // The mate-in-two ladder: every Expert choice across 200 draws stays in
        // the proven-win class (the floor is on and sloppiness is zero — but
        // the assertion is about the *outcome*, not the knobs).
        let pos = pos_of("7k/8/R7/1R6/8/8/8/6K1 w - - 0 1");
        let winning: Vec<Move> = crate::search::move_scores(&pos, Level::Expert.depth())
            .into_iter()
            .filter(|&(_, s)| class_of(s.value) > 0)
            .map(|(mv, _)| mv)
            .collect();
        assert!(!winning.is_empty(), "the fixture has proven-winning moves");
        assert!(
            winning.len() < legal_moves(&pos.board).len(),
            "and non-winning ones, or the floor has nothing to protect"
        );
        let mut rng = ChaCha20Rng::seed_from_u64(3);
        for _ in 0..200 {
            let mv = choose(&pos, Level::Expert, &mut rng).expect("live position");
            assert!(
                winning.contains(&mv),
                "Expert dropped a proven class: {mv:?}"
            );
        }
    }

    #[test]
    #[cfg_attr(debug_assertions, ignore = "release only: 40 seeded searches")]
    fn zero_sloppiness_does_not_consume_the_rng_and_easy_does() {
        let pos = <Chess as Adversary>::initial(0);
        // Expert (0%): different seeds, same move — the rng is untouched.
        let a = choose(&pos, Level::Expert, &mut ChaCha20Rng::seed_from_u64(1));
        let b = choose(&pos, Level::Expert, &mut ChaCha20Rng::seed_from_u64(2));
        assert_eq!(a, b, "Expert is deterministic");
        // Easy (60%, no floor): across seeds it must sometimes pick below the
        // best, or the sloppiness knob is not connected.
        let best = crate::search::move_scores(&pos, Level::Easy.depth())
            .into_iter()
            .max_by_key(|&(_, s)| s.value)
            .map(|(mv, _)| mv)
            .expect("moves");
        let varied = (0..40).any(|seed| {
            choose(&pos, Level::Easy, &mut ChaCha20Rng::seed_from_u64(seed))
                .is_some_and(|mv| mv != best)
        });
        assert!(varied, "Easy never strayed from the best move in 40 seeds");
    }

    #[test]
    fn a_terminal_position_has_no_move_to_choose() {
        let mated = pos_of("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1");
        let mut rng = ChaCha20Rng::seed_from_u64(1);
        assert_eq!(choose(&mated, Level::Expert, &mut rng), None);
    }

    // ---- self-play: the wiring test (cheap) and the strength counts ----

    /// One game of `white` vs `black`, adjudicated by the core's own result;
    /// `None` if the ply cap is hit (counted as a draw by the caller).
    fn play_game(white: Level, black: Level, seed: u64) -> Option<MatchResult> {
        let mut rng = ChaCha20Rng::seed_from_u64(seed);
        let mut pos = <Chess as Adversary>::initial(seed);
        for _ in 0..300 {
            if let Some(res) = result(&pos) {
                return Some(res);
            }
            let level = match <Chess as Adversary>::side_to_move(&pos) {
                adversary_core::Side::A => white,
                adversary_core::Side::B => black,
            };
            let mv = choose(&pos, level, &mut rng)?;
            pos = pos.play(mv);
        }
        None
    }

    /// A uniformly random legal player's move.
    fn random_move(pos: &Position, rng: &mut impl RngCore) -> Option<Move> {
        let legal = <Chess as Adversary>::legal_moves(pos);
        if legal.is_empty() {
            None
        } else {
            Some(legal[(rng.next_u32() as usize) % legal.len()])
        }
    }

    fn play_vs_random(engine: Level, engine_is_white: bool, seed: u64) -> Option<MatchResult> {
        let mut rng = ChaCha20Rng::seed_from_u64(seed);
        let mut pos = <Chess as Adversary>::initial(seed);
        for _ in 0..300 {
            if let Some(res) = result(&pos) {
                return Some(res);
            }
            let white_turn = <Chess as Adversary>::side_to_move(&pos) == adversary_core::Side::A;
            let mv = if white_turn == engine_is_white {
                choose(&pos, engine, &mut rng)
            } else {
                random_move(&pos, &mut rng)
            };
            pos = pos.play(mv?);
        }
        None
    }

    #[test]
    #[cfg_attr(debug_assertions, ignore = "release only: two full games")]
    fn expert_vs_easy_self_play_terminates_and_expert_wins_most() {
        // The wiring test: the whole choose() loop over the real Adversary,
        // both seats, to a real terminal. Two games for CI; the 20-game counts
        // run on demand below and are recorded in the plan's Review Log.
        let mut expert_points = 0;
        for seed in 0..2u64 {
            match play_game(Level::Expert, Level::Easy, seed) {
                Some(MatchResult::WinA) => expert_points += 2,
                Some(MatchResult::Draw) | None => expert_points += 1,
                Some(MatchResult::WinB) => {}
            }
        }
        assert!(
            expert_points >= 3,
            "Expert scored {expert_points}/4 vs Easy"
        );
    }

    #[test]
    #[ignore = "on demand: ~40 full games, minutes — counts go in the Review Log"]
    fn strength_counts_for_the_review_log() {
        let mut expert_beats_easy = 0;
        let mut draws_a = 0;
        for seed in 0..20u64 {
            match play_game(Level::Expert, Level::Easy, seed) {
                Some(MatchResult::WinA) => expert_beats_easy += 1,
                Some(MatchResult::Draw) | None => draws_a += 1,
                Some(MatchResult::WinB) => {}
            }
        }
        let mut easy_beats_random = 0;
        let mut draws_b = 0;
        for seed in 0..20u64 {
            let engine_white = seed % 2 == 0;
            match play_vs_random(Level::Easy, engine_white, seed) {
                Some(MatchResult::WinA) if engine_white => easy_beats_random += 1,
                Some(MatchResult::WinB) if !engine_white => easy_beats_random += 1,
                Some(MatchResult::Draw) | None => draws_b += 1,
                Some(_) => {}
            }
        }
        panic!(
            "REVIEW LOG COUNTS — Expert v Easy: {expert_beats_easy}/20 wins ({draws_a} draws); \
             Easy v random: {easy_beats_random}/20 wins ({draws_b} draws). \
             Bars: >= 15 and >= 14. (Deliberate panic so the numbers land in the output.)"
        );
    }
}
