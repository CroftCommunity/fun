//! Game state (zones) and the deterministic deal. See RULES.md → "Zones" and
//! "The deterministic deal".

use crate::card::Card;
use crate::rng::DetRng;

/// The number of tableau piles.
pub const TABLEAU_PILES: usize = 7;

/// A single tableau card: the card plus whether it is face-up.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct TableauCard {
    /// The card.
    pub card: Card,
    /// Whether the card is face-up (visible/playable).
    pub face_up: bool,
}

/// The full solitaire game state. Every field is part of the verifiable state
/// (folded into `state_hash`).
///
/// Zone conventions: the **top** of `stock` and `waste` is the **end** of the
/// vector (`.last()` is drawn/played first). Tableau piles are bottom→top with
/// the end being the exposed top.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct GameState {
    /// Foundation tops per suit `0..=3`: `0` = empty, else the top rank `1..=13`.
    pub foundations: [u8; 4],
    /// Face-down draw pile; top = end of the vec.
    pub stock: Vec<Card>,
    /// Face-up waste; top = end of the vec.
    pub waste: Vec<Card>,
    /// The seven tableau piles, bottom→top.
    pub tableau: [Vec<TableauCard>; TABLEAU_PILES],
    /// RNG values consumed by the deal (part of verifiable state).
    pub draws: u64,
}

impl GameState {
    /// Deal a fresh Klondike draw-1 game from a `u64` seed (RULES.md → "The
    /// deterministic deal").
    #[must_use]
    pub fn new_game(seed: u64) -> Self {
        let mut rng = DetRng::from_seed(seed);

        // Ordered deck 0..=51, then the fixed Fisher–Yates shuffle.
        let mut deck: Vec<Card> = (0..52).map(Card::from_index).collect();
        rng.shuffle(&mut deck);

        // Round-robin deal: round r deals one card to each pile p >= r, so pile
        // p receives p+1 cards. Deal face-down, then flip each pile's top.
        let mut tableau: [Vec<TableauCard>; TABLEAU_PILES] = std::array::from_fn(|_| Vec::new());
        let mut pos = 0usize;
        for r in 0..TABLEAU_PILES {
            for pile in tableau.iter_mut().skip(r) {
                pile.push(TableauCard {
                    card: deck[pos],
                    face_up: false,
                });
                pos += 1;
            }
        }
        for pile in &mut tableau {
            if let Some(top) = pile.last_mut() {
                top.face_up = true;
            }
        }

        // Remaining 24 cards are the stock (face-down); top = end of the vec.
        let stock = deck[pos..].to_vec();

        Self {
            foundations: [0; 4],
            stock,
            waste: Vec::new(),
            tableau,
            draws: rng.draws(),
        }
    }

    /// `true` iff all four foundations are complete (Kings up) — the win
    /// condition (all 52 cards on foundations).
    #[must_use]
    pub fn is_won(&self) -> bool {
        self.foundations.iter().all(|&top| top == 13)
    }
}
