//! The shipped opponent: difficulty as a band over per-move values.
//!
//! Difficulty is a knob on the **engine**, never on a language model. Two knobs,
//! both from `adversary_solver`: a **class floor** (`preserve_class`, so a level
//! that has it on can never drop from winning to losing) times **within-class
//! sloppiness**. A third, `depth`, is what carries strength above
//! [`TRACTABLE_SEEDS`](crate::search::TRACTABLE_SEEDS).
//!
//! ## The split this game has that dots did not
//!
//! Phase 0 measured that roughly **70% of a game sits above the exact
//! threshold**, and Phase 3 measured that the capped search's values are
//! genuinely spread there — six distinct values across six opening moves at every
//! depth from 6 up. So the levels differ in two different ways depending on where
//! the game is:
//!
//! - **Below the threshold**, every level reads the same exact values and the
//!   levels differ purely by band. The class floor is real, because the class is
//!   proven.
//! - **Above it**, [`capped_class`](crate::search::capped_class) is a constant, so
//!   the floor is inert by design and the levels differ by **depth and
//!   sloppiness**. Nothing is proven up there and the band is not allowed to
//!   pretend otherwise.
//!
//! That is why the top level is **`Expert` and not `Perfect`**: Phase 0 could not
//! solve the opening at 100M nodes, so there is no seat and no level from which
//! this engine plays a proven game start to finish. Othello and checkers ship the
//! same shape, and `docs/AI-PLAYERS.md` records why.

use adversary_solver::{select_in_band, LiveBand, NodeBudget};
use furrow_core::{Board, Pit};
use rand::RngCore;

use crate::search::{
    capped_class, class_of, is_affordable, move_values, CAPPED_NODE_BUDGET, EXACT_NODE_BUDGET,
};

/// Difficulty levels, Easy through Expert.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    /// Beatable: no class floor, a shallow look, and often a worse in-class move.
    Easy,
    /// Beatable with attention: no class floor, occasionally sloppy.
    Medium,
    /// Never throws a game it can **prove**, and looks a good way ahead when it
    /// cannot — but does not always take the tightest line.
    Hard,
    /// The strongest this engine plays: deepest search, no sloppiness, and the
    /// class floor wherever a class has actually been proven.
    ///
    /// **Not `Perfect`.** Above the exact threshold — about 70% of a game — it is
    /// searching, not solving, so it can be out-played there.
    Expert,
}

impl Level {
    /// The level for a `0..3` code, as the game-agnostic harness port speaks it.
    /// Anything out of range saturates to `Expert`, matching the other games.
    #[must_use]
    pub fn from_code(code: u32) -> Self {
        match code {
            0 => Level::Easy,
            1 => Level::Medium,
            2 => Level::Hard,
            _ => Level::Expert,
        }
    }
}

/// The band knobs for `level`.
///
/// The depths are set against Phase 3's measurement of the capped path from the
/// opening: 714 nodes at depth 4, 21,711 at depth 8, 79,347 at depth 10 and
/// 248,997 at depth 12 — so the top level's depth 10 is about 20 ms natively and
/// well inside [`CAPPED_NODE_BUDGET`]. Phase 12 re-tunes these against wasm on a
/// phone; they are measured here, not guessed, but they are measured on a laptop.
#[must_use]
pub fn live_band(level: Level) -> LiveBand {
    match level {
        Level::Easy => LiveBand {
            depth: 2,
            preserve_class: false,
            sloppiness_pct: 45,
        },
        Level::Medium => LiveBand {
            depth: 4,
            preserve_class: false,
            sloppiness_pct: 15,
        },
        Level::Hard => LiveBand {
            depth: 7,
            preserve_class: true,
            sloppiness_pct: 10,
        },
        Level::Expert => LiveBand {
            depth: 10,
            preserve_class: true,
            sloppiness_pct: 0,
        },
    }
}

/// The class function to band with at `pos`: the margin's sign where the search
/// proves a result, and a constant where it does not.
///
/// Split out so the choice is visible rather than buried in [`choose`]. Using
/// [`class_of`] on a capped value would let the floor claim a guarantee the
/// search never made.
#[must_use]
pub fn class_for(pos: &Board) -> fn(i32) -> i32 {
    if is_affordable(pos) {
        class_of
    } else {
        capped_class
    }
}

/// The opponent's move at `level`, or `None` if the position is terminal.
///
/// The RNG is untouched at zero sloppiness (a `select_in_band` guarantee), so
/// `Expert` plays the same game from the same seed every time.
pub fn choose(pos: &Board, level: Level, rng: &mut impl RngCore) -> Option<Pit> {
    let band = live_band(level);
    let budget = if is_affordable(pos) {
        NodeBudget::of(EXACT_NODE_BUDGET)
    } else {
        NodeBudget::of(CAPPED_NODE_BUDGET)
    };
    let report = move_values(pos, band.depth, budget);
    select_in_band(
        &report.values,
        class_for(pos),
        band.preserve_class,
        band.sloppiness_pct,
        rng,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::Side;
    use furrow_core::{apply_move, legal_pits, A_STORE, B_STORE, CELLS, PITS};
    use rand::SeedableRng;
    use rand_chacha::ChaCha20Rng;

    fn board(a: [u8; PITS], b: [u8; PITS], stores: (u8, u8), to_move: Side) -> Board {
        let mut cells = [0u8; CELLS];
        cells[..PITS].copy_from_slice(&a);
        cells[A_STORE] = stores.0;
        cells[PITS + 1..PITS + 1 + PITS].copy_from_slice(&b);
        cells[B_STORE] = stores.1;
        Board { cells, to_move }
    }

    fn rng() -> ChaCha20Rng {
        ChaCha20Rng::seed_from_u64(7)
    }

    #[test]
    fn levels_map_from_the_harness_codes_and_saturate_upward() {
        assert_eq!(Level::from_code(0), Level::Easy);
        assert_eq!(Level::from_code(1), Level::Medium);
        assert_eq!(Level::from_code(2), Level::Hard);
        assert_eq!(Level::from_code(3), Level::Expert);
        assert_eq!(
            Level::from_code(99),
            Level::Expert,
            "out of range is strongest"
        );
    }

    #[test]
    fn the_top_level_is_deterministic_and_leaves_the_rng_untouched() {
        // A level with no sloppiness must produce the same game from the same
        // seed -- and it must not consume a draw, or every subsequent random
        // number in the match shifts.
        let pos = Board::opening();
        let mut a = rng();
        let mut b = rng();
        let first = choose(&pos, Level::Expert, &mut a);
        assert_eq!(first, choose(&pos, Level::Expert, &mut b));
        let mut untouched = rng();
        let _ = choose(&pos, Level::Expert, &mut untouched);
        assert_eq!(
            untouched.next_u64(),
            rng().next_u64(),
            "zero sloppiness must not draw from the RNG"
        );
    }

    #[test]
    fn choose_returns_nothing_at_a_terminal() {
        let over = board([0; PITS], [0; PITS], (24, 24), Side::A);
        assert!(legal_pits(&over).is_empty());
        assert_eq!(choose(&over, Level::Expert, &mut rng()), None);
    }

    #[test]
    fn the_engine_never_throws_a_won_position_it_can_prove() {
        // The wiring test the plan names, driven through `choose` -- the shipped
        // entry point, not the search behind it. From seeded positions inside the
        // exact threshold whose value is a win for the mover, the top level's
        // move must still be a win.
        let mut checked = 0;
        for seed in 0..40u64 {
            let mut s = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
            let mut pos = Board::opening();
            let mut guard = 0;
            while pos.in_play() > 14 && !legal_pits(&pos).is_empty() && guard < 400 {
                s ^= s << 13;
                s ^= s >> 7;
                s ^= s << 17;
                let moves = legal_pits(&pos);
                pos = apply_move(&pos, moves[(s as usize) % moves.len()]);
                guard += 1;
            }
            if legal_pits(&pos).is_empty() || !is_affordable(&pos) {
                continue;
            }
            let report = move_values(&pos, 10, NodeBudget::of(EXACT_NODE_BUDGET));
            assert!(report.exact, "inside the threshold the solve must complete");
            let best = report.values.iter().map(|&(_, v)| v).max().unwrap_or(0);
            if class_of(best) <= 0 {
                continue; // not a won position; nothing to preserve
            }
            checked += 1;
            let picked = choose(&pos, Level::Expert, &mut rng()).expect("a legal move exists");
            let value = report
                .values
                .iter()
                .find(|&&(m, _)| m == picked)
                .map(|&(_, v)| v)
                .expect("the chosen move was one of the valued ones");
            assert!(
                class_of(value) > 0,
                "Expert dropped a proven win: picked {picked:?} worth {value} from {:?}",
                report.values
            );
        }
        assert!(checked >= 5, "only {checked} won positions were exercised");
    }

    #[test]
    fn easy_and_expert_disagree_often_enough_to_be_different_opponents() {
        // A difficulty model that produces the same moves is not one.
        let mut differ = 0;
        for seed in 0..24u64 {
            let mut s = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
            let mut pos = Board::opening();
            for _ in 0..(seed % 9) {
                if legal_pits(&pos).is_empty() {
                    break;
                }
                s ^= s << 13;
                s ^= s >> 7;
                s ^= s << 17;
                let moves = legal_pits(&pos);
                pos = apply_move(&pos, moves[(s as usize) % moves.len()]);
            }
            if legal_pits(&pos).is_empty() {
                continue;
            }
            let mut r = ChaCha20Rng::seed_from_u64(seed);
            let easy = choose(&pos, Level::Easy, &mut r);
            let expert = choose(&pos, Level::Expert, &mut rng());
            if easy != expert {
                differ += 1;
            }
        }
        assert!(
            differ >= 4,
            "Easy and Expert agreed almost everywhere ({differ} differed)"
        );
    }

    #[test]
    fn above_the_threshold_the_class_floor_is_deliberately_inert() {
        // Stated as a test because it is a decision with a cost: for about 70% of
        // a game the floor guarantees nothing, and a reader should find that
        // written down rather than infer it from a constant.
        let opening = Board::opening();
        assert!(!is_affordable(&opening));
        let f = class_for(&opening);
        assert_eq!(f(50), f(-50), "every capped value is one class");
        // And below it, the floor is real.
        let endgame = board([1, 0, 2, 0, 1, 0], [0, 1, 0, 2, 0, 1], (20, 20), Side::A);
        assert!(is_affordable(&endgame));
        let g = class_for(&endgame);
        assert_ne!(g(3), g(-3));
    }

    #[test]
    fn every_level_plays_a_legal_move_from_the_opening() {
        for level in [Level::Easy, Level::Medium, Level::Hard, Level::Expert] {
            let mv = choose(&Board::opening(), level, &mut rng()).expect("the opening has moves");
            assert!(
                legal_pits(&Board::opening()).contains(&mv),
                "{level:?} played {mv:?}"
            );
        }
    }
}
