//! The shipped opponent: difficulty as **noise over expected value**.
//!
//! The shared `adversary_solver::select_in_band` is deliberately not used. Its
//! class floor — "never drop from winning to losing" — is its whole difficulty
//! model, and no cribbage move has a class: a throw worth 8.9 against one worth
//! 8.6 throws nothing. What transfers is the shape: a top-*k* of the ranked
//! options, a percentage chance of taking a random one of those instead of the
//! best, and the property that **the RNG is untouched when the chance is zero**,
//! so `Expert` plays the same game from the same seed.
//!
//! Phase 0 measured that the discard is the whole game (random discarding wins
//! 3.8%; hand-only 45%; the crib term the last 5 points), so the levels are set
//! by how much of the discard expectation they throw away; pegging sloppiness
//! is the finer adjustment.

use cribbage_core::game::{Move, Phase, ShowStep};
use cribbage_core::score::score_hand;
use cribbage_core::View;
use rand::RngCore;

use crate::crib_table::CribTable;
use crate::expect::discard_options;
use crate::peg::{peg_options, DEPTH};

/// Difficulty levels, Easy through Expert.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    /// Throws almost at random and pegs by immediate points only.
    Easy,
    /// Keeps a reasonable hand most of the time.
    Medium,
    /// Rarely throws away expectation.
    Hard,
    /// Exact discard expectation, two-ply pegging, no noise. Not perfect play:
    /// pegging has no such thing, and the crib term is an expectation.
    Expert,
}

impl Level {
    /// The level for a `0..3` code; out of range saturates to `Expert`.
    #[must_use]
    pub fn from_code(code: u32) -> Level {
        match code {
            0 => Level::Easy,
            1 => Level::Medium,
            2 => Level::Hard,
            _ => Level::Expert,
        }
    }
}

/// The knobs for one level.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Band {
    /// How many of the best-ranked throws are eligible when sloppy.
    pub discard_top_k: usize,
    /// Percent chance (0-100) of a random eligible throw instead of the best.
    pub discard_sloppiness_pct: u32,
    /// Pegging lookahead plies.
    pub peg_depth: u32,
    /// Percent chance of a random playable card instead of the best.
    pub peg_sloppiness_pct: u32,
}

/// The band for `level`. Measured in Phase 10, not tuned here.
#[must_use]
pub fn band_for(level: Level) -> Band {
    match level {
        Level::Easy => Band {
            discard_top_k: 15,
            discard_sloppiness_pct: 70,
            peg_depth: 1,
            peg_sloppiness_pct: 40,
        },
        Level::Medium => Band {
            discard_top_k: 6,
            discard_sloppiness_pct: 45,
            peg_depth: 1,
            peg_sloppiness_pct: 25,
        },
        Level::Hard => Band {
            discard_top_k: 3,
            discard_sloppiness_pct: 25,
            peg_depth: DEPTH,
            peg_sloppiness_pct: 10,
        },
        Level::Expert => Band {
            discard_top_k: 1,
            discard_sloppiness_pct: 0,
            peg_depth: DEPTH,
            peg_sloppiness_pct: 0,
        },
    }
}

/// Pick from ranked `options` (any order): the best, or with probability
/// `sloppiness_pct` a uniformly random one of the `top_k` best. `None` only for
/// no options. The RNG is not consumed when `sloppiness_pct == 0`.
#[must_use]
pub fn select(
    options: &[(Move, i32)],
    top_k: usize,
    sloppiness_pct: u32,
    rng: &mut impl RngCore,
) -> Option<Move> {
    if options.is_empty() {
        return None;
    }
    let mut ranked: Vec<(Move, i32)> = options.to_vec();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.code().cmp(&b.0.code())));
    if sloppiness_pct > 0 && rng.next_u32() % 100 < sloppiness_pct {
        let k = top_k.clamp(1, ranked.len());
        return Some(ranked[(rng.next_u32() as usize) % k].0);
    }
    Some(ranked[0].0)
}

/// The engine's move for the view's seat at `level`, or `None` when it is not
/// that seat's turn or the game is over. At the show it claims exactly.
#[must_use]
pub fn live_move(
    view: &View,
    table: &CribTable,
    level: Level,
    rng: &mut impl RngCore,
) -> Option<Move> {
    if view.to_move != view.seat {
        return None;
    }
    let band = band_for(level);
    match view.phase {
        Phase::Discard => select(
            &discard_options(view, table),
            band.discard_top_k,
            band.discard_sloppiness_pct,
            rng,
        ),
        Phase::Peg => {
            let options = peg_options(view, band.peg_depth);
            if options.is_empty() {
                // nothing plays: the only legal move is a go
                return Some(Move::Go);
            }
            select(&options, options.len(), band.peg_sloppiness_pct, rng)
        }
        Phase::Show(step) => {
            // Count exactly: the hand on the table is ours at this step.
            let on_table = view.revealed.iter().find(|r| r.step == step)?;
            let cards = [
                on_table.cards[0],
                on_table.cards[1],
                on_table.cards[2],
                on_table.cards[3],
            ];
            let total = score_hand(&cards, view.cut?, step == ShowStep::Crib).total();
            Some(Move::Claim(total))
        }
        Phase::Over => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cribbage_core::{apply, legal_moves, GameState, Seat};
    use rand::SeedableRng;
    use rand_chacha::ChaCha20Rng;

    fn opts() -> Vec<(Move, i32)> {
        vec![
            (Move::Discard(0), 300),
            (Move::Discard(1), 900),
            (Move::Discard(2), 600),
            (Move::Discard(3), 100),
        ]
    }

    #[test]
    fn level_codes_map_in_order_and_saturate_to_expert() {
        assert_eq!(Level::from_code(0), Level::Easy);
        assert_eq!(Level::from_code(1), Level::Medium);
        assert_eq!(Level::from_code(2), Level::Hard);
        assert_eq!(Level::from_code(3), Level::Expert);
        assert_eq!(Level::from_code(99), Level::Expert);
        assert_eq!(band_for(Level::Expert).discard_sloppiness_pct, 0);
        assert!(band_for(Level::Easy).discard_top_k > band_for(Level::Hard).discard_top_k);
    }

    #[test]
    fn zero_sloppiness_takes_the_best_and_does_not_touch_the_rng() {
        let mut rng = ChaCha20Rng::seed_from_u64(1);
        let before = rng.next_u32();
        let mut rng = ChaCha20Rng::seed_from_u64(1);
        assert_eq!(select(&opts(), 3, 0, &mut rng), Some(Move::Discard(1)));
        assert_eq!(rng.next_u32(), before, "the stream was not consumed");
        assert_eq!(select(&[], 3, 0, &mut rng), None);
    }

    #[test]
    fn full_sloppiness_stays_inside_the_top_k() {
        let mut rng = ChaCha20Rng::seed_from_u64(2);
        let mut seen = std::collections::HashSet::new();
        for _ in 0..200 {
            let m = select(&opts(), 2, 100, &mut rng).unwrap();
            assert!(
                matches!(m, Move::Discard(1 | 2)),
                "{m:?} is outside the top two"
            );
            seen.insert(m.code());
        }
        assert_eq!(seen.len(), 2, "both of the top two were chosen");
    }

    #[test]
    fn expert_is_deterministic_from_the_seed_and_always_legal_and_claims_exactly() {
        let table = CribTable::shipped();
        let run = |seed: u64| {
            let mut s = GameState::new(seed);
            let mut rng = ChaCha20Rng::seed_from_u64(seed);
            let mut moves = Vec::new();
            while s.outcome().is_none() {
                let v = View::for_seat(&s, s.to_move());
                let m = live_move(&v, &table, Level::Expert, &mut rng).expect("a move on turn");
                assert!(legal_moves(&s).contains(&m), "{m:?} is not legal");
                if let Move::Claim(n) = m {
                    // the engine never under- or over-claims: no muggins ever
                    let after = apply(&s, m).unwrap();
                    assert!(
                        matches!(after.last_scored(), Some((_, cribbage_core::Scored::Claim { claimed, actual, muggins: 0 })) if claimed == actual.total() && claimed == n)
                    );
                }
                moves.push(m);
                s = apply(&s, m).unwrap();
            }
            moves
        };
        assert_eq!(run(9), run(9));
        assert_ne!(run(9), run(10));
    }

    #[test]
    fn off_turn_and_over_return_none() {
        let table = CribTable::shipped();
        let s = GameState::new(3);
        let mut rng = ChaCha20Rng::seed_from_u64(0);
        let off = View::for_seat(&s, s.to_move().other());
        assert_eq!(live_move(&off, &table, Level::Expert, &mut rng), None);
        let _ = Seat::A;
    }

    #[test]
    fn easy_actually_differs_from_expert_on_the_same_deal() {
        let table = CribTable::shipped();
        let mut differ = 0;
        for seed in 0..30u64 {
            let s = GameState::new(seed);
            let v = View::for_seat(&s, s.to_move());
            let mut rng = ChaCha20Rng::seed_from_u64(seed);
            let easy = live_move(&v, &table, Level::Easy, &mut rng);
            let mut rng = ChaCha20Rng::seed_from_u64(seed);
            let expert = live_move(&v, &table, Level::Expert, &mut rng);
            if easy != expert {
                differ += 1;
            }
        }
        assert!(
            differ > 10,
            "Easy agreed with Expert on {} of 30 discards",
            30 - differ
        );
    }
}
