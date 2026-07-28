//! Deal determinism corpus: the deterministic deal produces the canonical
//! Klondike shape, and `(seed)` fully determines the dealt state hash.

use std::collections::BTreeSet;

use solitaire_core::{state_hash, Card, GameState};

#[test]
fn deal_has_canonical_klondike_shape() {
    let g = GameState::new_game(0);

    // Pile p (0-indexed) holds p+1 cards; top face-up, the rest face-down.
    for (p, pile) in g.tableau.iter().enumerate() {
        assert_eq!(pile.len(), p + 1, "pile {p} should hold {} cards", p + 1);
        assert!(
            pile.last().expect("non-empty pile").face_up,
            "pile {p} top face-up"
        );
        assert!(
            pile[..pile.len() - 1].iter().all(|tc| !tc.face_up),
            "pile {p} non-top cards face-down"
        );
    }

    assert_eq!(g.stock.len(), 24, "24 cards to stock");
    assert!(g.waste.is_empty(), "waste starts empty");
    assert_eq!(g.foundations, [0; 4], "foundations start empty");
    assert_eq!(g.draws, 51, "Fisher-Yates consumes 51 draws for 52 cards");
    assert!(!g.is_won(), "a fresh deal is not won");

    // All 52 distinct cards are dealt exactly once across tableau + stock.
    let mut seen = BTreeSet::new();
    for pile in &g.tableau {
        for tc in pile {
            assert!(seen.insert(tc.card.index()), "duplicate card dealt");
        }
    }
    for c in &g.stock {
        assert!(seen.insert(c.index()), "duplicate card dealt");
    }
    assert_eq!(seen.len(), 52, "the full 52-card deck is dealt");
}

#[test]
fn deal_is_deterministic_and_seed_sensitive() {
    // Same seed → identical dealt state (the verifiable-outcome property).
    assert_eq!(
        state_hash(&GameState::new_game(0)),
        state_hash(&GameState::new_game(0)),
        "same seed must reproduce the same deal hash"
    );
    // Different seeds → different deals (not a hard guarantee in theory, but a
    // collision here would be an astronomically unlikely SHA-256 clash).
    assert_ne!(
        state_hash(&GameState::new_game(0)),
        state_hash(&GameState::new_game(1)),
        "different seeds should deal differently"
    );
}

#[test]
fn card_index_round_trips() {
    for idx in 0u8..52 {
        assert_eq!(Card::from_index(idx).index(), idx);
    }
}
