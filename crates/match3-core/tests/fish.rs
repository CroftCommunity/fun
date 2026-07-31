//! The 2×2 fish (Track B4). Option A: a 2×2 same-colour square is a first-class
//! match — it makes a swap legal, clears (leaving one fish), is avoided by the
//! deal, and creates a `SpecialKind::Fish`. B4.1 covers detection + creation +
//! core consistency (activation is B4.2). These tests pin the new match shape
//! and that the deal never leaves a settled board holding a free fish.

use match3_core::board::{Board, Cell, SpecialKind};
use match3_core::engine::{creations_for, deal, find_matches, find_squares, swap_legal, Game};

fn count_special(b: &Board, kind: SpecialKind) -> usize {
    b.special().iter().filter(|s| **s == Some(kind)).count()
}

#[test]
fn find_squares_detects_a_2x2_block() {
    // A 2×2 of colour 0 at the top-left; no line-3 anywhere.
    let b = Board::from_rows(&["001", "002", "345"]).expect("parses");
    let squares = find_squares(&b);
    assert_eq!(squares.len(), 1, "exactly one 2×2 block");
    assert_eq!(
        squares[0],
        [(0, 0), (0, 1), (1, 0), (1, 1)],
        "the 2×2's four cells in row-major order"
    );
}

#[test]
fn a_2x2_is_a_match() {
    // Option A: the four cells of a 2×2 are in find_matches even with no line-3.
    let b = Board::from_rows(&["001", "002", "345"]).expect("parses");
    let matched = find_matches(&b);
    for cell in [(0, 0), (0, 1), (1, 0), (1, 1)] {
        assert!(matched.contains(&cell), "{cell:?} is part of the 2×2 match");
    }
}

#[test]
fn authoring_a_fish_round_trips() {
    let b = Board::from_rows_with_specials(&["012", "345"], &["F..", "..."]).expect("parses");
    assert_eq!(b.special_at(0, 0), Some(SpecialKind::Fish));
}

#[test]
fn swapping_to_form_a_2x2_is_legal_and_creates_a_fish() {
    // Settled board (no line-3, no 2×2). Swapping (1,1)<->(1,2) brings a 0 to (1,1),
    // completing a 2×2 of 0s at rows 0-1, cols 0-1. Under Option A the swap is legal
    // (a 2×2 is a match); it clears three cells and the fourth (the swapped-in cell)
    // becomes a Fish.
    let b = Board::from_rows(&["003", "010", "245"]).expect("parses");
    assert!(
        swap_legal(&b, (1, 1), (1, 2)),
        "forming a 2×2 makes the swap legal"
    );
    let mut game = Game::new(b, 1, 6);
    let (report, snaps) = game.play_move_traced((1, 1), (1, 2));
    assert!(report.legal);
    assert_eq!(
        report.steps[0].cleared.len(),
        3,
        "three cleared, one transformed"
    );
    assert_eq!(report.steps[0].score_gained, 30, "3 gems x 10");
    assert_eq!(
        snaps[1].special_at(1, 1),
        Some(SpecialKind::Fish),
        "a fish was created at the swapped cell of the 2×2"
    );
    assert_eq!(
        snaps[1].get(1, 1),
        Cell::Gem(0),
        "the fish keeps the square's colour"
    );
}

#[test]
fn a_line_shape_beats_a_2x2_in_creation_priority() {
    // A 2×4 block of colour 0 (rows 0-1, cols 0-3) contains 2×2 squares but also two
    // horizontal 4-runs. It must create striped candies (the line shape), not fish —
    // a fish comes only from a *pure* 2×2 (no ≥3 line through it).
    let b = Board::from_rows(&["00002", "00003", "14512"]).expect("parses");
    let creations = creations_for(&b, None);
    assert!(
        creations.iter().all(|c| c.kind != SpecialKind::Fish),
        "a 2×3 region makes line specials, not a fish"
    );
    assert!(
        creations
            .iter()
            .any(|c| matches!(c.kind, SpecialKind::StripedH | SpecialKind::StripedV)),
        "it does make a striped candy"
    );
}

#[test]
fn a_deal_never_leaves_a_2x2() {
    // A settled deal must contain no match at all — including a 2×2, or the board
    // would start with a free fish. Check a spread of seeds.
    for seed in 1u64..200 {
        let b = deal(seed, 8, 8, 6);
        assert!(
            find_squares(&b).is_empty(),
            "seed {seed}: a fresh deal has no 2×2 block"
        );
        assert!(
            find_matches(&b).is_empty(),
            "seed {seed}: a fresh deal is settled (no match)"
        );
    }
}

#[test]
fn a_created_fish_survives_its_creating_step() {
    // Like every creation, the fish is transformed (not cleared) — it is on the board
    // after the move settles.
    let b = Board::from_rows(&["003", "010", "245"]).expect("parses");
    let mut game = Game::new(b, 1, 6);
    let report = game.play_move((1, 1), (1, 2));
    assert!(report.legal);
    assert_eq!(
        count_special(&game.board, SpecialKind::Fish),
        1,
        "the created fish is on the settled board"
    );
}
