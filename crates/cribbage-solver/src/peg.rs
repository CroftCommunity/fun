//! Pegging: expectimax over the other seat's unknown cards, modelled as draws
//! from everything this seat has not seen. Phase 0 measured two plies as worth
//! ~6 points of win rate over the folk heuristic and a third ply as worth
//! nothing, so [`DEPTH`] is 2.

use cribbage_core::card::Card;
use cribbage_core::game::{Move, Phase};
use cribbage_core::score::score_peg;
use cribbage_core::View;

/// Plies of lookahead the shipped opponent uses.
pub const DEPTH: u32 = 2;

/// Every playable card with its expectimax value in hundredths (this seat's
/// points minus the other seat's expected best reply). Empty unless the view's
/// seat is pegging with a playable card.
#[must_use]
pub fn peg_options(view: &View, depth: u32) -> Vec<(Move, i32)> {
    if view.phase != Phase::Peg || view.to_move != view.seat {
        return Vec::new();
    }
    let unseen = unseen_ranks(&view.seen);
    let count = u32::from(view.count);
    view.hand
        .iter()
        .enumerate()
        .filter(|(_, c)| count + u32::from(c.value()) <= 31)
        .map(|(i, _)| {
            let value = play_value(
                &view.hand,
                i,
                &view.stack,
                &unseen,
                u32::from(view.opponent_cards),
                depth,
            );
            (Move::Play(i as u8), value)
        })
        .collect()
}

/// How many of each rank this seat has not seen (index by rank, 0 unused).
fn unseen_ranks(seen: &[Card]) -> [u32; 14] {
    let mut counts = [4u32; 14];
    counts[0] = 0;
    for c in seen {
        counts[usize::from(c.rank)] = counts[usize::from(c.rank)].saturating_sub(1);
    }
    counts
}

fn count_of(stack: &[Card]) -> u32 {
    stack.iter().map(|c| u32::from(c.value())).sum()
}

/// The value of playing `hand[i]` onto `stack`: its points, minus the other
/// seat's expected best reply (if `depth > 1`), in hundredths.
fn play_value(
    hand: &[Card],
    i: usize,
    stack: &[Card],
    unseen: &[u32; 14],
    opp_left: u32,
    depth: u32,
) -> i32 {
    let mut next = stack.to_vec();
    next.push(hand[i]);
    let mut value = i32::from(score_peg(&next).total()) * 100;
    if depth > 1 && opp_left > 0 && count_of(&next) < 31 {
        let rest: Vec<Card> = hand
            .iter()
            .enumerate()
            .filter(|(k, _)| *k != i)
            .map(|(_, c)| *c)
            .collect();
        value -= expected_reply(&next, &rest, unseen, opp_left, depth - 1);
    }
    value
}

/// The other seat's expected best reply, from their side, over the unseen
/// ranks. A rank they cannot play is a go for them — roughly a point to us.
fn expected_reply(
    stack: &[Card],
    my_rest: &[Card],
    unseen: &[u32; 14],
    opp_left: u32,
    depth: u32,
) -> i32 {
    let total: u32 = unseen.iter().sum();
    if total == 0 {
        return 0;
    }
    let count = count_of(stack);
    let mut acc = 0i64;
    let mut playable = 0u32;
    for rank in 1..=13u8 {
        let n = unseen[usize::from(rank)];
        if n == 0 {
            continue;
        }
        let card = Card { rank, suit: 0 };
        if count + u32::from(card.value()) > 31 {
            continue;
        }
        playable += n;
        let mut next = stack.to_vec();
        next.push(card);
        let mut v = i64::from(score_peg(&next).total()) * 100;
        if depth > 1 && !my_rest.is_empty() && count_of(&next) < 31 {
            let mut fewer = *unseen;
            fewer[usize::from(rank)] -= 1;
            let best_mine = (0..my_rest.len())
                .filter(|&k| count_of(&next) + u32::from(my_rest[k].value()) <= 31)
                .map(|k| play_value(my_rest, k, &next, &fewer, opp_left - 1, depth - 1))
                .max()
                .unwrap_or(-100);
            v -= i64::from(best_mine);
        }
        acc += v * i64::from(n);
    }
    let cannot = i64::from(total - playable);
    ((acc - 100 * cannot) / i64::from(total)) as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    use cribbage_core::{apply, legal_moves, GameState};

    fn pegging_view() -> View {
        let s = GameState::new(21);
        let s = apply(&apply(&s, Move::Discard(0)).unwrap(), Move::Discard(0)).unwrap();
        assert_eq!(s.phase(), Phase::Peg);
        View::for_seat(&s, s.to_move())
    }

    #[test]
    fn options_are_exactly_the_playable_cards() {
        let v = pegging_view();
        let opts = peg_options(&v, DEPTH);
        assert_eq!(opts.len(), 4, "a fresh hand of four all play at count 0");
        let codes: Vec<u8> = opts.iter().map(|(m, _)| m.code()).collect();
        assert_eq!(codes, vec![16, 17, 18, 19]);
    }

    #[test]
    fn a_card_that_makes_fifteen_now_is_preferred_at_one_ply() {
        // Build a view by hand: count 10 on the stack, we hold a 5 and a 9.
        let mut v = pegging_view();
        v.stack = vec![Card { rank: 10, suit: 0 }];
        v.count = 10;
        v.hand = vec![Card { rank: 9, suit: 1 }, Card { rank: 5, suit: 1 }];
        v.seen = vec![
            Card { rank: 10, suit: 0 },
            Card { rank: 9, suit: 1 },
            Card { rank: 5, suit: 1 },
        ];
        v.opponent_cards = 3;
        let opts = peg_options(&v, 1);
        let best = opts.iter().max_by_key(|(_, val)| *val).unwrap().0;
        assert_eq!(best, Move::Play(1), "the five makes fifteen");
        assert_eq!(opts[1].1, 200);
        assert_eq!(opts[0].1, 0);
    }

    #[test]
    fn two_plies_charge_a_card_for_what_it_hands_the_other_seat() {
        // Leading: a 5 invites any ten-card to make fifteen; a 4 cannot be fifteened.
        let mut v = pegging_view();
        v.stack.clear();
        v.count = 0;
        v.hand = vec![Card { rank: 5, suit: 1 }, Card { rank: 4, suit: 1 }];
        v.seen = v.hand.clone();
        v.opponent_cards = 4;
        let opts = peg_options(&v, 2);
        let five = opts.iter().find(|(m, _)| *m == Move::Play(0)).unwrap().1;
        let four = opts.iter().find(|(m, _)| *m == Move::Play(1)).unwrap().1;
        assert!(
            four > five,
            "leading the 4 ({four}) beats leading the 5 ({five})"
        );
    }

    #[test]
    fn options_are_empty_off_turn_and_when_nothing_plays() {
        let s = GameState::new(21);
        let s = apply(&apply(&s, Move::Discard(0)).unwrap(), Move::Discard(0)).unwrap();
        let off = View::for_seat(&s, s.to_move().other());
        assert!(peg_options(&off, DEPTH).is_empty());
        let mut v = View::for_seat(&s, s.to_move());
        v.count = 30;
        v.stack = vec![
            Card { rank: 10, suit: 0 },
            Card { rank: 10, suit: 1 },
            Card { rank: 10, suit: 2 },
        ];
        v.hand = vec![Card { rank: 9, suit: 3 }];
        assert!(peg_options(&v, DEPTH).is_empty());
        let _ = legal_moves(&s);
    }
}
