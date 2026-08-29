//! Scoring — the show (`score_hand`) and the pegging stack (`score_peg`), as
//! pure functions with a breakdown, so the UI narrates what the core counted
//! rather than counting again.

use serde::{Deserialize, Serialize};

use crate::card::Card;

/// The breakdown of a hand or crib scored against the cut.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct HandScore {
    /// Two per combination summing to fifteen.
    pub fifteens: u8,
    /// Two per pair (a pair royal is three pairs, a double pair royal six).
    pub pairs: u8,
    /// Runs of three or more, multiplied by duplicate ranks.
    pub runs: u8,
    /// Four in hand (not the crib), five with the cut.
    pub flush: u8,
    /// One for a jack in hand matching the cut's suit.
    pub nobs: u8,
}

impl HandScore {
    /// The total.
    #[must_use]
    pub fn total(self) -> u8 {
        self.fifteens + self.pairs + self.runs + self.flush + self.nobs
    }
}

/// The points the LAST card on the pegging stack earned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct PegScore {
    /// Two for making fifteen.
    pub fifteen: u8,
    /// Two for making thirty-one.
    pub thirty_one: u8,
    /// Pair 2, pair royal 6, double pair royal 12.
    pub pairs: u8,
    /// The length of the longest run the last card completes (3+).
    pub run: u8,
}

impl PegScore {
    /// The total.
    #[must_use]
    pub fn total(self) -> u8 {
        self.fifteen + self.thirty_one + self.pairs + self.run
    }
}

/// Score four cards against the cut. `is_crib` withholds the four-card flush.
#[must_use]
pub fn score_hand(hand: &[Card; 4], cut: Card, is_crib: bool) -> HandScore {
    let five = [hand[0], hand[1], hand[2], hand[3], cut];

    // Fifteens: every non-empty subset of the five.
    let fifteens = (1u32..32)
        .filter(|mask| {
            five.iter()
                .enumerate()
                .filter(|(i, _)| mask & (1 << i) != 0)
                .map(|(_, c)| u32::from(c.value()))
                .sum::<u32>()
                == 15
        })
        .count() as u8
        * 2;

    // Pairs and runs from rank multiplicities.
    let mut counts = [0u8; 14];
    for c in &five {
        counts[usize::from(c.rank)] += 1;
    }
    let pairs = counts.iter().map(|&n| n * n.saturating_sub(1)).sum();
    let runs = run_points(&counts);

    let suit = hand[0].suit;
    let flush = if hand.iter().all(|c| c.suit == suit) {
        if cut.suit == suit {
            5
        } else if is_crib {
            0
        } else {
            4
        }
    } else {
        0
    };

    let nobs = u8::from(hand.iter().any(|c| c.is_jack() && c.suit == cut.suit));

    HandScore {
        fifteens,
        pairs,
        runs,
        flush,
        nobs,
    }
}

/// Run points from rank multiplicities: each maximal stretch of three or more
/// consecutive present ranks scores its length times the product of the
/// multiplicities (a double run of three is 6, a triple run 9, a double-double 12).
fn run_points(counts: &[u8; 14]) -> u8 {
    let mut points = 0u8;
    let mut rank = 1usize;
    while rank <= 13 {
        if counts[rank] == 0 {
            rank += 1;
            continue;
        }
        let start = rank;
        let mut mult = 1u8;
        while rank <= 13 && counts[rank] > 0 {
            mult *= counts[rank];
            rank += 1;
        }
        let len = (rank - start) as u8;
        if len >= 3 {
            points += len * mult;
        }
    }
    points
}

/// Score the last card of `stack` — the cards played since the count last
/// reset, in play order. `stack` must be non-empty. Go and last-card points are
/// the game's, not the stack's.
#[must_use]
pub fn score_peg(stack: &[Card]) -> PegScore {
    let count: u32 = stack.iter().map(|c| u32::from(c.value())).sum();
    let fifteen = if count == 15 { 2 } else { 0 };
    let thirty_one = if count == 31 { 2 } else { 0 };

    let n = stack.len();
    let last = stack[n - 1].rank;
    let same = 1 + stack[..n - 1]
        .iter()
        .rev()
        .take_while(|c| c.rank == last)
        .count();
    let pairs = match same {
        2 => 2,
        3 => 6,
        4 => 12,
        _ => 0,
    };

    // The longest trailing window whose ranks are a permutation of consecutive
    // ranks. A window with a duplicate is not a run, but a shorter window may be.
    let run = (3..=n)
        .rev()
        .find(|&len| {
            let mut ranks: Vec<u8> = stack[n - len..].iter().map(|c| c.rank).collect();
            ranks.sort_unstable();
            ranks.windows(2).all(|w| w[1] == w[0] + 1)
        })
        .map_or(0, |len| len as u8);

    PegScore {
        fifteen,
        thirty_one,
        pairs,
        run,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(rank: u8, suit: u8) -> Card {
        Card { rank, suit }
    }

    // ---- the show

    #[test]
    fn the_perfect_twenty_nine() {
        // J♠ 5♥ 5♦ 5♣ with 5♠ cut: eight fifteens (16), double pair royal (12), nobs (1)
        let s = score_hand(&[c(11, 3), c(5, 2), c(5, 1), c(5, 0)], c(5, 3), false);
        assert_eq!(
            s,
            HandScore {
                fifteens: 16,
                pairs: 12,
                runs: 0,
                flush: 0,
                nobs: 1
            }
        );
        assert_eq!(s.total(), 29);
    }

    #[test]
    fn a_zero_hand_is_zero() {
        assert_eq!(
            score_hand(&[c(2, 0), c(4, 1), c(6, 2), c(8, 3)], c(10, 0), false).total(),
            0
        );
    }

    #[test]
    fn double_run_with_a_fifteen_from_the_cut() {
        // 4 4 5 6 + K: 4+5+6 twice (4), 5+K (2), pair (2), two runs of three (6) = 14
        let s = score_hand(&[c(4, 0), c(4, 1), c(5, 0), c(6, 0)], c(13, 3), false);
        assert_eq!(
            s,
            HandScore {
                fifteens: 6,
                pairs: 2,
                runs: 6,
                flush: 0,
                nobs: 0
            }
        );
    }

    #[test]
    fn triple_run_and_double_double_run() {
        // 3 3 3 4 + 5: three runs of three (9) + pair royal (6) + fifteens 3+3+4+5 x3 (6) = 21
        let s = score_hand(&[c(3, 0), c(3, 1), c(3, 2), c(4, 0)], c(5, 0), false);
        assert_eq!(s.runs, 9);
        assert_eq!(s.pairs, 6);
        assert_eq!(s.total(), 21);
        // 6 6 7 7 + 8: four runs of three (12) + two pairs (4) + fifteens 7+8 x2 (4) = 20
        let s = score_hand(&[c(6, 0), c(6, 1), c(7, 0), c(7, 1)], c(8, 0), false);
        assert_eq!(s.runs, 12);
        assert_eq!(s.pairs, 4);
        assert_eq!(s.total(), 20);
    }

    #[test]
    fn a_run_of_five_scores_five_once() {
        let s = score_hand(&[c(1, 0), c(2, 1), c(3, 2), c(4, 3)], c(5, 0), false);
        assert_eq!(s.runs, 5);
        assert_eq!(s.fifteens, 2); // 1+2+3+4+5
    }

    #[test]
    fn a_flush_is_four_in_hand_five_with_the_cut_and_the_crib_needs_five() {
        let h = [c(2, 0), c(4, 0), c(6, 0), c(9, 0)];
        assert_eq!(score_hand(&h, c(13, 1), false).flush, 4);
        assert_eq!(score_hand(&h, c(13, 0), false).flush, 5);
        assert_eq!(score_hand(&h, c(13, 1), true).flush, 0);
        assert_eq!(score_hand(&h, c(13, 0), true).flush, 5);
    }

    #[test]
    fn nobs_is_a_jack_in_hand_matching_the_cut_never_the_jack_cut() {
        assert_eq!(
            score_hand(&[c(11, 2), c(2, 0), c(4, 1), c(8, 3)], c(7, 2), false).nobs,
            1
        );
        assert_eq!(
            score_hand(&[c(11, 2), c(2, 0), c(4, 1), c(8, 3)], c(7, 1), false).nobs,
            0
        );
        assert_eq!(
            score_hand(&[c(2, 2), c(3, 0), c(4, 1), c(8, 3)], c(11, 2), false).nobs,
            0
        );
    }

    #[test]
    fn fifteens_count_every_subset() {
        // 5 10 10 10 + 10: 5+10 x4 (8) + double pair royal (12) = 20
        let s = score_hand(&[c(5, 0), c(10, 0), c(10, 1), c(10, 2)], c(10, 3), false);
        assert_eq!(s.fifteens, 8);
        assert_eq!(s.pairs, 12);
    }

    // ---- pegging

    #[test]
    fn peg_fifteen_and_thirty_one() {
        assert_eq!(score_peg(&[c(10, 0), c(5, 1)]).fifteen, 2);
        assert_eq!(
            score_peg(&[c(10, 0), c(10, 1), c(10, 2), c(1, 0)]).thirty_one,
            2
        );
        assert_eq!(
            score_peg(&[c(10, 0), c(10, 1), c(10, 2), c(1, 0)]).total(),
            2
        );
    }

    #[test]
    fn peg_pairs_are_consecutive_only() {
        assert_eq!(score_peg(&[c(7, 0), c(7, 1)]).pairs, 2);
        assert_eq!(score_peg(&[c(7, 0), c(7, 1), c(7, 2)]).pairs, 6);
        assert_eq!(score_peg(&[c(7, 0), c(7, 1), c(7, 2), c(7, 3)]).pairs, 12);
        assert_eq!(score_peg(&[c(7, 0), c(2, 1), c(7, 2)]).pairs, 0);
    }

    #[test]
    fn peg_runs_count_in_any_order_and_only_the_trailing_window() {
        assert_eq!(score_peg(&[c(4, 0), c(6, 1), c(5, 2)]).run, 3);
        assert_eq!(score_peg(&[c(4, 0), c(6, 1), c(5, 2)]).total(), 5); // + fifteen
        assert_eq!(
            score_peg(&[c(2, 0), c(4, 0), c(6, 1), c(5, 2), c(3, 3)]).run,
            5
        );
        assert_eq!(score_peg(&[c(9, 0), c(4, 0), c(6, 1), c(5, 2)]).run, 3);
        assert_eq!(score_peg(&[c(4, 0), c(4, 1), c(5, 2), c(6, 3)]).run, 3); // the pair breaks a longer run
        assert_eq!(score_peg(&[c(4, 0), c(5, 1), c(6, 2), c(6, 3)]).run, 0); // duplicate in the window
    }

    /// The whole-space check Phase 0 ran: every (four-card hand, cut) — 12,994,800
    /// of them — must reproduce the published distribution. Runs in ~0.3s in
    /// release, which is how the gate runs it. In a debug build it is minutes,
    /// and `cargo mutants` builds debug — 260 mutants × minutes is the whole
    /// afternoon — so it steps aside there and the hand-written scorer tests
    /// carry the mutants.
    #[test]
    #[cfg_attr(
        debug_assertions,
        ignore = "minutes in debug; the release gate runs it"
    )]
    fn every_hand_and_cut_reproduces_the_published_distribution() {
        let deck = crate::card::full_deck();
        let mut dist = [0u64; 30];
        for a in 0..52 {
            for b in a + 1..52 {
                for c in b + 1..52 {
                    for d in c + 1..52 {
                        let hand = [deck[a], deck[b], deck[c], deck[d]];
                        for e in 0..52 {
                            if e == a || e == b || e == c || e == d {
                                continue;
                            }
                            dist[usize::from(score_hand(&hand, deck[e], false).total())] += 1;
                        }
                    }
                }
            }
        }
        assert_eq!(dist.iter().sum::<u64>(), 12_994_800);
        assert_eq!(dist[29], 4);
        assert_eq!(dist[28], 76);
        assert_eq!(dist[0], 1_009_008);
        for impossible in [19, 25, 26, 27] {
            assert_eq!(dist[impossible], 0, "a {impossible} hand is impossible");
        }
    }

    #[test]
    fn peg_last_card_alone_scores_nothing_here() {
        assert_eq!(score_peg(&[c(9, 0)]).total(), 0);
    }
}
