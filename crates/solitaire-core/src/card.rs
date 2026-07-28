//! Card model. See RULES.md → "Deck and coordinates".

/// A playing card. `suit` is `0..=3` (`♣=0, ♦=1, ♥=2, ♠=3`); `rank` is
/// `1..=13` (Ace=1 … King=13).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Card {
    /// Suit, `0..=3` in the canonical order `♣ ♦ ♥ ♠`.
    pub suit: u8,
    /// Rank, `1..=13` (Ace=1 … King=13).
    pub rank: u8,
}

/// Card colour. `♣ ♠` are black; `♦ ♥` are red.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Color {
    /// Clubs and spades.
    Black,
    /// Diamonds and hearts.
    Red,
}

impl Card {
    /// The canonical card index `0..=51` = `suit*13 + (rank-1)`.
    #[must_use]
    pub fn index(self) -> u8 {
        self.suit * 13 + (self.rank - 1)
    }

    /// Build a card from its canonical index `0..=51`.
    ///
    /// # Panics
    /// Panics if `index > 51` (an invariant violation, not a runtime input).
    #[must_use]
    pub fn from_index(index: u8) -> Self {
        assert!(index <= 51, "card index out of range");
        Self {
            suit: index / 13,
            rank: index % 13 + 1,
        }
    }

    /// The card's colour (`♦ ♥` red, `♣ ♠` black).
    #[must_use]
    pub fn color(self) -> Color {
        match self.suit {
            1 | 2 => Color::Red,
            _ => Color::Black,
        }
    }
}
