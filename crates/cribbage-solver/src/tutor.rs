//! Engine-grounded coaching, with every verdict bound to whether it is exact.
//!
//! A discard verdict **is** exact: the expectation is exhaustive over the 46
//! cuts, so "you kept a hand worth 7.2 on average; the best keep was 8.9" is a
//! true sentence. A pegging verdict is not — the other seat's cards are a model —
//! so the wording hedges. The flag is set inside this crate and the wording is
//! pinned to it by tests, so a caller cannot make the tutor overclaim.

use cribbage_core::game::{Move, Phase};
use cribbage_core::View;

use crate::crib_table::CribTable;
use crate::expect::discard_options;
use crate::peg::{peg_options, DEPTH};

/// A move's quality relative to the best available, by regret in hundredths.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveClass {
    /// The best available (regret 0).
    Best,
    /// Within a point of the best.
    Close,
    /// One to three points behind.
    Loose,
    /// Three or more points behind.
    Blunder,
}

impl MoveClass {
    /// The class for a regret in hundredths.
    #[must_use]
    pub fn of(regret: i32) -> MoveClass {
        match regret {
            0 => MoveClass::Best,
            1..=100 => MoveClass::Close,
            101..=299 => MoveClass::Loose,
            _ => MoveClass::Blunder,
        }
    }
}

/// One option, assessed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Assessment {
    /// The move.
    pub mv: Move,
    /// Its expected value in hundredths.
    pub expected: i32,
    /// How far below the best, in hundredths.
    pub regret: i32,
    /// Its class.
    pub quality: MoveClass,
}

/// Every option for the view's seat, assessed, best first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    /// The options, best first. Empty off-turn, at the show, or when over.
    pub moves: Vec<Assessment>,
    /// Whether the values are exact (a discard) or a model (pegging).
    pub exact: bool,
}

/// Assess every option for the view's seat.
#[must_use]
pub fn assess(view: &View, table: &CribTable) -> Report {
    let (options, exact) = match view.phase {
        Phase::Discard => (discard_options(view, table), true),
        Phase::Peg => (peg_options(view, DEPTH), false),
        _ => (Vec::new(), false),
    };
    let best = options.iter().map(|(_, v)| *v).max().unwrap_or(0);
    let mut moves: Vec<Assessment> = options
        .into_iter()
        .map(|(mv, expected)| {
            let regret = best - expected;
            Assessment {
                mv,
                expected,
                regret,
                quality: MoveClass::of(regret),
            }
        })
        .collect();
    moves.sort_by(|a, b| {
        b.expected
            .cmp(&a.expected)
            .then(a.mv.code().cmp(&b.mv.code()))
    });
    Report { moves, exact }
}

/// The coach's sentence for a move of `quality`, hedged unless `exact`.
#[must_use]
pub fn coach_line(quality: MoveClass, exact: bool) -> &'static str {
    match (quality, exact) {
        (MoveClass::Best, true) => "That is the best keep — highest expected score.",
        (MoveClass::Best, false) => "That is the engine's pick.",
        (MoveClass::Close, true) => "Close — within a point of the best keep.",
        (MoveClass::Close, false) => "Reasonable, as far as the engine can see.",
        (MoveClass::Loose, true) => "That gives up a point or two of expectation.",
        (MoveClass::Loose, false) => "The engine would have played differently.",
        (MoveClass::Blunder, true) => "That threw away three or more expected points.",
        (MoveClass::Blunder, false) => "That looks risky.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cribbage_core::{apply, GameState};

    #[test]
    fn a_discard_report_is_exact_sorted_and_the_best_has_no_regret() {
        let s = GameState::new(21);
        let r = assess(&View::for_seat(&s, s.to_move()), &CribTable::shipped());
        assert!(r.exact);
        assert_eq!(r.moves.len(), 15);
        assert_eq!(r.moves[0].regret, 0);
        assert_eq!(r.moves[0].quality, MoveClass::Best);
        assert!(r.moves.windows(2).all(|w| w[0].expected >= w[1].expected));
        for a in &r.moves {
            assert_eq!(a.regret, r.moves[0].expected - a.expected);
            assert_eq!(a.quality, MoveClass::of(a.regret));
        }
    }

    #[test]
    fn a_pegging_report_is_never_exact() {
        let s = GameState::new(21);
        let s = apply(&apply(&s, Move::Discard(0)).unwrap(), Move::Discard(0)).unwrap();
        let r = assess(&View::for_seat(&s, s.to_move()), &CribTable::shipped());
        assert!(!r.exact);
        assert_eq!(r.moves.len(), 4);
    }

    #[test]
    fn off_turn_is_empty() {
        let s = GameState::new(21);
        let r = assess(
            &View::for_seat(&s, s.to_move().other()),
            &CribTable::shipped(),
        );
        assert!(r.moves.is_empty());
    }

    #[test]
    fn the_coach_only_states_a_verdict_when_exact() {
        assert!(coach_line(MoveClass::Blunder, true).contains("threw away"));
        assert!(!coach_line(MoveClass::Blunder, false).contains("threw"));
        assert!(coach_line(MoveClass::Blunder, false).contains("risky"));
        assert!(coach_line(MoveClass::Best, true).contains("best keep"));
        assert!(!coach_line(MoveClass::Best, false).contains("best"));
    }

    #[test]
    fn classes_by_regret() {
        assert_eq!(MoveClass::of(0), MoveClass::Best);
        assert_eq!(MoveClass::of(100), MoveClass::Close);
        assert_eq!(MoveClass::of(101), MoveClass::Loose);
        assert_eq!(MoveClass::of(300), MoveClass::Blunder);
    }
}
