//! The shipped opponent: difficulty as a band over per-move values.
//!
//! Difficulty is a knob on the **engine**, never on a language model. Two knobs,
//! both from `adversary_solver`: a **class floor** (`preserve_class`, so a level
//! that has it on can never drop from winning to losing) times **within-class
//! sloppiness**. A third, `depth`, matters only above
//! [`TRACTABLE_EDGES`](crate::search::TRACTABLE_EDGES) — below it every level
//! reads the same exact values and the levels differ purely by band.
//!
//! ## The polarity that matters here
//!
//! 3x3 Dots and Boxes is a **second-player win, 6-3** (`dots-core/RULES.md`). So
//! at `Perfect`, whichever side moves second wins with correct play, and the
//! front end owes the player the choice of who opens — otherwise "unbeatable" is a
//! property of the seating, not of the engine.

use adversary_solver::{select_in_band, LiveBand};
use dots_core::{Board, Edge};
use rand::RngCore;

/// Difficulty levels, Easy through Perfect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    /// Beatable: no class floor, and often takes a worse in-class move.
    Easy,
    /// Beatable with attention: no class floor, occasionally sloppy.
    Medium,
    /// Never throws the game from a position it can prove, but does not always
    /// take the tightest winning line — it will win by one box where three were
    /// available.
    Hard,
    /// Never throws the game, and always the tightest move it can see.
    Perfect,
}

impl Level {
    /// The level for a `0..3` code, as the game-agnostic harness port speaks it.
    /// Anything out of range saturates to `Perfect`, matching the other games.
    #[must_use]
    pub fn from_code(code: u32) -> Self {
        match code {
            0 => Level::Easy,
            1 => Level::Medium,
            2 => Level::Hard,
            _ => Level::Perfect,
        }
    }
}

/// The band knobs for `level`.
///
/// `depth` only has an effect above `TRACTABLE_EDGES` — the first four plies —
/// and it is **provably inert there**, not merely near-flat. Measured at every
/// position the capped path can run in (24, 23, 22 and 21 free edges) at depths
/// 1, 2, 4, 6 and 8: the value of *every* move is **0 at every depth** — one
/// distinct value in the whole set. No box can reach three sides before three
/// edges are drawn or be captured before four, so there is nothing for a deeper
/// look to find, and depth 8 costs 200-340 ms to return the same flat landscape
/// depth 1 returns in 0.0 ms (Phase 12, 2026-08-07).
///
/// That is also the measurement that **rejects iterative deepening** here.
/// `adversary_solver::deepen` exists to keep the best *complete* iteration when a
/// budget cuts a search short; when every iteration returns identical values there
/// is no better iteration to keep, so it could only spend time. It paid +14% on
/// checkers and −41% on Othello; here it is not applicable at all.
///
/// The strength difference between levels is therefore carried entirely by the
/// class floor and the sloppiness, and below the threshold every level reads the
/// same exact values.
#[must_use]
pub fn live_band(level: Level) -> LiveBand {
    match level {
        Level::Easy => LiveBand {
            depth: 1,
            preserve_class: false,
            sloppiness_pct: 45,
        },
        Level::Medium => LiveBand {
            depth: 2,
            preserve_class: false,
            sloppiness_pct: 15,
        },
        Level::Hard => LiveBand {
            depth: 3,
            preserve_class: true,
            sloppiness_pct: 10,
        },
        Level::Perfect => LiveBand {
            depth: 3,
            preserve_class: true,
            sloppiness_pct: 0,
        },
    }
}

/// The class of a value: the **sign of the box margin**.
///
/// Deliberately not in `adversary-solver`, whose docs draw the line here: what a
/// value's class means is a game's own judgement. For this game a positive final
/// margin is a win and a negative one a loss, and zero cannot occur at nine boxes
/// — but the function does not assume that, because it is also applied to
/// depth-capped values, which are not final margins at all.
#[must_use]
pub fn class_of(value: i32) -> i32 {
    value.signum()
}

/// The opponent's move at `level`, or `None` if the position is terminal.
///
/// The RNG is untouched at zero sloppiness (a `select_in_band` guarantee), so
/// `Hard` and `Perfect` play the same game from the same seed every time.
pub fn choose(pos: &Board, level: Level, rng: &mut impl RngCore) -> Option<Edge> {
    let band = live_band(level);
    let (values, _exact) = crate::search::move_values(pos, band.depth);
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
    use adversary_core::{Adversary, MatchResult, Side};
    use dots_core::{apply_move, Dots, ALL_EDGES, BOXES, EDGES};
    use rand_chacha::rand_core::SeedableRng;
    use rand_chacha::ChaCha20Rng;

    fn rng() -> ChaCha20Rng {
        ChaCha20Rng::seed_from_u64(7)
    }

    fn from_open(keep_open: &[usize], to_move: Side) -> Board {
        let mut edges = ALL_EDGES;
        for &e in keep_open {
            edges &= !(1u32 << e);
        }
        Board {
            edges,
            owners: [0; BOXES],
            to_move,
        }
    }

    #[test]
    fn level_codes_map_to_the_four_levels_and_saturate() {
        assert_eq!(Level::from_code(0), Level::Easy);
        assert_eq!(Level::from_code(1), Level::Medium);
        assert_eq!(Level::from_code(2), Level::Hard);
        assert_eq!(Level::from_code(3), Level::Perfect);
        assert_eq!(
            Level::from_code(99),
            Level::Perfect,
            "out of range saturates"
        );
    }

    #[test]
    fn the_class_floor_is_on_for_the_top_two_levels_only() {
        assert!(!live_band(Level::Easy).preserve_class);
        assert!(!live_band(Level::Medium).preserve_class);
        assert!(live_band(Level::Hard).preserve_class);
        assert!(live_band(Level::Perfect).preserve_class);
    }

    #[test]
    fn sloppiness_falls_monotonically_and_only_perfect_is_exact() {
        let s = |l| live_band(l).sloppiness_pct;
        assert!(s(Level::Easy) > s(Level::Medium));
        assert!(s(Level::Medium) > s(Level::Hard));
        assert_eq!(s(Level::Perfect), 0, "only Perfect is never sloppy");
    }

    #[test]
    fn no_two_levels_are_the_same_player() {
        // Worth asserting because it silently stopped being true once depth turned
        // out to be inert above the exact threshold: with depth carrying no
        // weight, Hard and Perfect collapsed into an identical band, and four
        // levels became three. Clippy caught it as duplicate match arms.
        let bands = [Level::Easy, Level::Medium, Level::Hard, Level::Perfect].map(live_band);
        for i in 0..bands.len() {
            for j in i + 1..bands.len() {
                assert_ne!(
                    bands[i], bands[j],
                    "levels {i} and {j} are indistinguishable"
                );
            }
        }
    }

    #[test]
    fn class_is_the_sign_of_the_margin() {
        assert_eq!(class_of(3), 1);
        assert_eq!(class_of(-3), -1);
        assert_eq!(class_of(0), 0);
    }

    #[test]
    fn choose_returns_none_only_when_the_board_is_finished() {
        let done = from_open(&[], Side::A);
        assert!(done.is_complete());
        assert_eq!(choose(&done, Level::Perfect, &mut rng()), None);

        let live = <Dots as Adversary>::initial(0);
        assert!(choose(&live, Level::Perfect, &mut rng()).is_some());
    }

    #[test]
    fn choose_always_returns_a_legal_move() {
        for level in [Level::Easy, Level::Medium, Level::Hard, Level::Perfect] {
            let mut pos = <Dots as Adversary>::initial(0);
            let mut r = rng();
            while let Some(mv) = choose(&pos, level, &mut r) {
                assert!(
                    dots_core::legal_edges(&pos).contains(&mv),
                    "{level:?} chose an illegal edge"
                );
                pos = apply_move(&pos, mv);
            }
            assert!(pos.is_complete(), "{level:?} played the board out");
        }
    }

    #[test]
    fn zero_sloppiness_is_deterministic_from_the_same_seed() {
        let play = || {
            let mut pos = <Dots as Adversary>::initial(0);
            let mut r = rng();
            let mut moves = Vec::new();
            while let Some(mv) = choose(&pos, Level::Perfect, &mut r) {
                moves.push(mv.0);
                pos = apply_move(&pos, mv);
            }
            moves
        };
        assert_eq!(play(), play(), "Perfect reproduces its game exactly");
    }

    #[test]
    fn perfect_never_throws_a_winning_position() {
        // The property the class floor exists for, and the one the AI-scoring
        // harness grades against. Take positions the exact solver proves are wins
        // for the mover, and assert the chosen move stays a win.
        let mut checked = 0;
        for open_from in 4..=8usize {
            let pos = from_open(&(open_from..EDGES).collect::<Vec<_>>(), Side::A);
            let (values, exact) = crate::search::move_values(&pos, 8);
            if !exact {
                continue;
            }
            let best = values.iter().map(|&(_, v)| v).max().unwrap_or(0);
            if best <= 0 {
                continue; // not a winning position; nothing to preserve
            }
            let mv = choose(&pos, Level::Perfect, &mut rng()).expect("has moves");
            let chosen = values
                .iter()
                .find(|&&(m, _)| m == mv)
                .map(|&(_, v)| v)
                .expect("the chosen move was valued");
            assert!(
                chosen > 0,
                "Perfect dropped a proven win: chose {mv:?} worth {chosen} where {best} was available"
            );
            checked += 1;
        }
        assert!(
            checked > 0,
            "the test must actually exercise a winning position"
        );
    }

    #[test]
    fn perfect_against_perfect_reaches_the_theoretical_result() {
        // The game value is -3 for the opening player (dots-core/RULES.md), so a
        // correct engine playing both sides must land on 3:6.
        //
        // This is the one test that prices the heuristic opening. Above
        // TRACTABLE_EDGES the values are depth-capped and prove nothing, so if
        // those first four plies cost the theoretical result, THIS is where it
        // shows -- and if it holds, the four unproven plies cost nothing after
        // all, which is the finding the dropped opening book was about.
        let mut pos = <Dots as Adversary>::initial(0);
        let mut r = rng();
        while let Some(mv) = choose(&pos, Level::Perfect, &mut r) {
            pos = apply_move(&pos, mv);
        }
        assert_eq!(
            pos.box_counts(),
            (3, 6),
            "perfect play both sides is a second-player win, 6-3"
        );
        assert_eq!(<Dots as Adversary>::result(&pos), Some(MatchResult::WinB));
    }

    #[test]
    fn a_full_engine_game_reaches_a_decisive_result() {
        let mut pos = <Dots as Adversary>::initial(0);
        let mut r = rng();
        while let Some(mv) = choose(&pos, Level::Hard, &mut r) {
            pos = apply_move(&pos, mv);
        }
        let result = <Dots as Adversary>::result(&pos).expect("a finished board has a result");
        assert_ne!(result, MatchResult::Draw, "nine boxes cannot tie");
    }
}
