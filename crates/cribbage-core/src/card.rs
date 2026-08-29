//! Cards: rank, suit, pegging value, and the 0..52 wire code.

use serde::{Deserialize, Serialize};

/// Cards in a deck.
pub const DECK_SIZE: usize = 52;

/// A rank, 1 (ace) through 13 (king). Aces are always low in cribbage.
pub type Rank = u8;
/// A suit, 0..=3 (clubs, diamonds, hearts, spades — the order is only a code).
pub type Suit = u8;

/// A playing card.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Card {
    /// 1..=13.
    pub rank: Rank,
    /// 0..=3.
    pub suit: Suit,
}

impl Card {
    /// The pegging / fifteen value: face cards count ten.
    #[must_use]
    pub fn value(self) -> u8 {
        self.rank.min(10)
    }

    /// The wire code, `suit * 13 + (rank - 1)`, in `0..52`.
    #[must_use]
    pub fn code(self) -> u8 {
        self.suit * 13 + (self.rank - 1)
    }

    /// The card for a wire code in `0..52`, or `None`.
    #[must_use]
    pub fn from_code(code: u8) -> Option<Card> {
        (code < DECK_SIZE as u8).then(|| Card {
            rank: code % 13 + 1,
            suit: code / 13,
        })
    }

    /// Whether this is a jack (his heels on the cut, his nobs in hand).
    #[must_use]
    pub fn is_jack(self) -> bool {
        self.rank == 11
    }
}

/// The full deck in code order.
#[must_use]
pub fn full_deck() -> Vec<Card> {
    (0..DECK_SIZE as u8).filter_map(Card::from_code).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn face_cards_count_ten_and_aces_one() {
        assert_eq!(Card { rank: 13, suit: 0 }.value(), 10);
        assert_eq!(Card { rank: 11, suit: 0 }.value(), 10);
        assert_eq!(Card { rank: 10, suit: 0 }.value(), 10);
        assert_eq!(Card { rank: 9, suit: 0 }.value(), 9);
        assert_eq!(Card { rank: 1, suit: 0 }.value(), 1);
    }

    #[test]
    fn code_round_trips_every_card_and_rejects_52() {
        for code in 0..52u8 {
            let c = Card::from_code(code).expect("in range");
            assert_eq!(c.code(), code);
            assert!((1..=13).contains(&c.rank));
            assert!(c.suit < 4);
        }
        assert_eq!(Card::from_code(52), None);
        assert_eq!(full_deck().len(), 52);
    }
}
