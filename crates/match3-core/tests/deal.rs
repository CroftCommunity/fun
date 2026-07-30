//! The seeded starting-deal generator: a settled board with no free matches
//! and at least one legal swap, deterministic from the seed.

use match3_core::{deal, find_matches, has_legal_move, legal_swaps, swap_legal, Cell};

#[test]
fn deal_is_settled_no_initial_matches_with_a_legal_move() {
    let b = deal(0, 8, 8, 6);
    assert_eq!((b.width, b.height), (8, 8));
    assert!(b.is_settled(), "deal fills every cell");
    assert!(
        find_matches(&b).is_empty(),
        "a fresh deal has no free matches"
    );
    assert!(
        has_legal_move(&b),
        "a fresh deal always has at least one legal swap"
    );
    for r in 0..b.height {
        for c in 0..b.width {
            match b.get(r, c) {
                Cell::Gem(g) => assert!((g as usize) < 6, "gem colour in range"),
                other => panic!("deal produced a non-gem cell: {other:?}"),
            }
        }
    }
}

#[test]
fn deal_is_deterministic_and_seed_sensitive() {
    assert_eq!(
        deal(42, 8, 8, 6),
        deal(42, 8, 8, 6),
        "same seed => same board"
    );
    assert_ne!(
        deal(1, 8, 8, 6).to_rows(),
        deal(2, 8, 8, 6).to_rows(),
        "different seeds => different boards"
    );
}

#[test]
fn legal_swaps_are_all_actually_legal() {
    let b = deal(7, 8, 8, 6);
    let swaps = legal_swaps(&b);
    assert!(!swaps.is_empty(), "there is a legal swap");
    for &(from, to) in &swaps {
        assert!(swap_legal(&b, from, to), "{from:?}->{to:?} must be legal");
    }
}
