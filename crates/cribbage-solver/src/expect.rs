//! The discard: exhaustive expectation over the 46 cards that could be cut,
//! plus or minus what the throw is worth to the crib.

use cribbage_core::card::{full_deck, Card};
use cribbage_core::game::{discard_pairs, Move, Phase};
use cribbage_core::score::score_hand;
use cribbage_core::View;

use crate::crib_table::CribTable;

/// Expected show score of `keep`, in hundredths, averaged over every card not
/// in `seen`.
#[must_use]
pub fn hand_expectation(keep: &[Card; 4], seen: &[Card]) -> i32 {
    let (total, n) = full_deck()
        .into_iter()
        .filter(|c| !seen.contains(c))
        .fold((0i64, 0i64), |(t, n), cut| {
            (t + i64::from(score_hand(keep, cut, false).total()), n + 1)
        });
    if n == 0 {
        return 0;
    }
    (total * 100 / n) as i32
}

/// Every discard with its expected value in hundredths: the kept hand's
/// expectation plus the crib's if this seat deals, minus it otherwise. Empty
/// unless the view's seat is discarding.
#[must_use]
pub fn discard_options(view: &View, table: &CribTable) -> Vec<(Move, i32)> {
    if view.phase != Phase::Discard || view.to_move != view.seat || view.hand.len() != 6 {
        return Vec::new();
    }
    let six = &view.hand;
    let sign = if view.dealer == view.seat { 1 } else { -1 };
    discard_pairs()
        .iter()
        .enumerate()
        .map(|(i, &(a, b))| {
            let keep: Vec<Card> = six
                .iter()
                .enumerate()
                .filter(|(k, _)| *k != a && *k != b)
                .map(|(_, c)| *c)
                .collect();
            let hand = hand_expectation(&[keep[0], keep[1], keep[2], keep[3]], six);
            let crib = table.get(six[a], six[b]);
            (Move::Discard(i as u8), hand + sign * crib)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use cribbage_core::{apply, GameState, Seat};

    fn c(rank: u8, suit: u8) -> Card {
        Card { rank, suit }
    }

    #[test]
    fn a_hand_of_four_fives_expects_more_than_a_hand_of_nothing() {
        let fives = [c(5, 0), c(5, 1), c(5, 2), c(5, 3)];
        let junk = [c(2, 0), c(4, 1), c(6, 2), c(8, 3)];
        let fives_x = hand_expectation(&fives, &fives);
        let junk_x = hand_expectation(&junk, &junk);
        assert!(
            fives_x > 2000,
            "four fives are 20 before the cut: {fives_x}"
        );
        assert!(junk_x < fives_x / 4, "{junk_x} vs {fives_x}");
    }

    #[test]
    fn expectation_averages_exactly_over_the_unseen_cards() {
        // 5 5 5 J: 12 base (three pairs 6 + fifteens... ) — compute by hand: over the 46
        // unseen cuts, the mean of score_hand. Cross-check the function against a
        // direct loop so the two cannot disagree on the divisor.
        let keep = [c(5, 0), c(5, 1), c(5, 2), c(11, 3)];
        let seen = [c(5, 0), c(5, 1), c(5, 2), c(11, 3), c(2, 0), c(9, 0)];
        let mut total = 0i64;
        let mut n = 0i64;
        for card in full_deck() {
            if seen.contains(&card) {
                continue;
            }
            total += i64::from(score_hand(&keep, card, false).total());
            n += 1;
        }
        assert_eq!(n, 46);
        assert_eq!(i64::from(hand_expectation(&keep, &seen)), total * 100 / n);
    }

    #[test]
    fn discard_options_cover_all_fifteen_throws_and_flip_the_crib_sign_with_the_deal() {
        let s = GameState::new(21);
        let table = CribTable::shipped();
        let nd = s.dealer().other();
        let v = View::for_seat(&s, nd);
        let opts = discard_options(&v, &table);
        assert_eq!(opts.len(), 15);
        let codes: Vec<u8> = opts.iter().map(|(m, _)| m.code()).collect();
        assert_eq!(codes, (0..15).collect::<Vec<u8>>());
        // the dealer is not to move yet: no options until the non-dealer has thrown
        assert!(discard_options(&View::for_seat(&s, s.dealer()), &table).is_empty());
        let after_nd = apply(&s, Move::Discard(0)).unwrap();
        let d_view = View::for_seat(&after_nd, s.dealer());
        let d_opts = discard_options(&d_view, &table);
        assert_eq!(d_opts.len(), 15);
        for (i, (_, v_d)) in d_opts.iter().enumerate() {
            let (a, b) = discard_pairs()[i];
            let keep: Vec<Card> = d_view
                .hand
                .iter()
                .enumerate()
                .filter(|(k, _)| *k != a && *k != b)
                .map(|(_, c)| *c)
                .collect();
            let hand = hand_expectation(&[keep[0], keep[1], keep[2], keep[3]], &d_view.hand);
            assert_eq!(
                *v_d,
                hand + table.get(d_view.hand[a], d_view.hand[b]),
                "dealer throw {i}"
            );
        }
        // for each throw, dealer value - hand expectation == +crib, non-dealer == -crib
        for (i, (m, v_nd)) in opts.iter().enumerate() {
            let (a, b) = discard_pairs()[i];
            let keep: Vec<Card> = v
                .hand
                .iter()
                .enumerate()
                .filter(|(k, _)| *k != a && *k != b)
                .map(|(_, c)| *c)
                .collect();
            let hand = hand_expectation(&[keep[0], keep[1], keep[2], keep[3]], &v.hand);
            let crib = table.get(v.hand[a], v.hand[b]);
            assert_eq!(*v_nd, hand - crib, "non-dealer throw {m:?}");
        }
        let _ = Seat::A;
        // not discarding: nothing
        let pegging = apply(&apply(&s, Move::Discard(0)).unwrap(), Move::Discard(0)).unwrap();
        assert_eq!(pegging.phase(), Phase::Peg);
        assert!(discard_options(&View::for_seat(&pegging, nd), &table).is_empty());
    }
}
