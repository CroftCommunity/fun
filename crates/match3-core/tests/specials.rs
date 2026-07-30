//! Special-gem overlay: model + hash + authoring (Track B0, Phase 1). A special
//! is a `Cell::Gem(color)` carrying a marker in a parallel overlay grid — it is
//! orthogonal to matching/legality (which see only the gem colour). These tests
//! pin the representation, the append-only-when-present hashing (the jelly
//! precedent, so gem-only boards hash unchanged), and authoring round-trips.

use match3_core::board::{Board, SpecialKind};
use match3_core::hash::state_hash;

fn board(rows: &[&str]) -> Board {
    Board::from_rows(rows).expect("rows parse")
}

#[test]
fn no_special_by_default() {
    let b = board(&["012", "345", "012"]);
    assert!(b.special().iter().all(std::option::Option::is_none));
    assert_eq!(b.special_at(1, 1), None);
}

#[test]
fn set_and_read_a_special() {
    let mut b = board(&["012", "345", "012"]);
    b.set_special(1, 1, Some(SpecialKind::StripedH));
    assert_eq!(b.special_at(1, 1), Some(SpecialKind::StripedH));
    assert_eq!(b.special_at(0, 0), None);
}

#[test]
fn authoring_round_trips() {
    // '.' none, 'H'/'V' striped, 'W' wrapped, 'C' colour-bomb.
    let b = Board::from_rows_with_specials(&["012", "345", "012"], &["H..", ".W.", "..C"])
        .expect("parses");
    assert_eq!(b.special_at(0, 0), Some(SpecialKind::StripedH));
    assert_eq!(b.special_at(1, 1), Some(SpecialKind::Wrapped));
    assert_eq!(b.special_at(2, 2), Some(SpecialKind::ColorBomb));
    assert_eq!(b.special_at(0, 1), None);
}

#[test]
fn gem_only_hash_is_unchanged_by_the_overlay() {
    // The append-only-when-present guarantee: a board with no specials hashes
    // exactly as it did before the overlay existed. Setting a special then
    // clearing it must return to the original hash (no section emitted when
    // empty), so every pre-specials golden vector stays valid without a re-lock.
    let mut b = board(&["012", "345", "012"]);
    let base = state_hash(&b, 6, 0, 0);
    b.set_special(1, 1, Some(SpecialKind::StripedH));
    assert_ne!(
        state_hash(&b, 6, 0, 0),
        base,
        "a present special must change the hash"
    );
    b.set_special(1, 1, None);
    assert_eq!(
        state_hash(&b, 6, 0, 0),
        base,
        "clearing the only special restores the gem-only hash"
    );
}

#[test]
fn special_hash_is_deterministic_and_kind_sensitive() {
    let mut h = board(&["012", "345", "012"]);
    h.set_special(0, 0, Some(SpecialKind::StripedH));
    let mut v = board(&["012", "345", "012"]);
    v.set_special(0, 0, Some(SpecialKind::StripedV));
    assert_eq!(
        state_hash(&h, 6, 0, 0),
        state_hash(&h, 6, 0, 0),
        "same state hashes identically"
    );
    assert_ne!(
        state_hash(&h, 6, 0, 0),
        state_hash(&v, 6, 0, 0),
        "the special kind is part of the fingerprint"
    );
}
