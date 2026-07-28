//! RNG-free unit tests for the tie-break tables in RULES.md. Every expectation
//! here is hand-computable, so these are the red-first driver for the engine.

use match3_core::board::Cell;
use match3_core::engine::{
    apply_gravity, clear_cells, find_matches, refill, swap_legal, ClearOutcome,
};
use match3_core::rng::DetRng;
use match3_core::Board;

fn board(rows: &[&str]) -> Board {
    Board::from_rows(rows).expect("rows parse")
}

// --- T1 match detection -----------------------------------------------------

#[test]
fn t1_horizontal_run() {
    let b = board(&["000", "123", "145"]);
    assert_eq!(find_matches(&b), vec![(0, 0), (0, 1), (0, 2)]);
}

#[test]
fn t1_vertical_run() {
    let b = board(&["10", "10", "10", "23"]);
    assert_eq!(
        find_matches(&b),
        vec![(0, 0), (0, 1), (1, 0), (1, 1), (2, 0), (2, 1)]
    );
}

#[test]
fn t1_intersecting_plus_counts_shared_cell_once() {
    // Row 1 and column 1 both run through (1,1).
    let b = board(&["010", "111", "010"]);
    assert_eq!(
        find_matches(&b),
        vec![(0, 1), (1, 0), (1, 1), (1, 2), (2, 1)]
    );
}

#[test]
fn t1_blocker_breaks_a_run() {
    // 0 0 B 0 0 — longest same-colour run is 2, so no match.
    let b = board(&["00A00"]);
    assert!(find_matches(&b).is_empty());
}

#[test]
fn t1_no_match_is_empty() {
    let b = board(&["01", "10"]);
    assert!(find_matches(&b).is_empty());
}

// --- T2 clear + blocker damage ---------------------------------------------

#[test]
fn t2_clears_matched_to_empty() {
    let mut b = board(&["000", "123"]);
    let out = clear_cells(&mut b, &[(0, 0), (0, 1), (0, 2)]);
    assert_eq!(
        out,
        ClearOutcome {
            gems_cleared: 3,
            blocker_layers_removed: 0
        }
    );
    assert_eq!(b.to_rows(), vec!["...", "123"]);
}

#[test]
fn t2_adjacent_one_layer_blocker_is_removed() {
    let mut b = board(&["000", "A12"]); // A = 1-layer blocker at (1,0)
    let out = clear_cells(&mut b, &[(0, 0), (0, 1), (0, 2)]);
    assert_eq!(
        out,
        ClearOutcome {
            gems_cleared: 3,
            blocker_layers_removed: 1
        }
    );
    // Blocker (1,0) was adjacent to matched (0,0) -> dropped to 0 -> Empty.
    assert_eq!(b.get(1, 0), Cell::Empty);
}

#[test]
fn t2_layered_blocker_loses_at_most_one_layer_even_with_two_adjacent() {
    // col0 and col2 both match; blocker (1,1) is adjacent to matched (1,0) AND
    // (1,2), yet loses only one layer (at-most-one-per-step).
    let mut b = board(&["101", "1B1", "101"]); // B = 2-layer blocker
    let matched = find_matches(&b);
    let out = clear_cells(&mut b, &matched);
    assert_eq!(out.gems_cleared, 6);
    assert_eq!(out.blocker_layers_removed, 1);
    assert_eq!(b.get(1, 1), Cell::Blocker(1));
}

// --- T3 gravity -------------------------------------------------------------

#[test]
fn t3_gems_fall_to_bottom_preserving_order() {
    let mut b = board(&["0", ".", "1", ".", "2"]);
    apply_gravity(&mut b);
    assert_eq!(b.to_rows(), vec![".", ".", "0", "1", "2"]);
}

#[test]
fn t3_blocker_is_a_fixed_shelf() {
    // Blocker at row 1 splits the column: [row0] and [rows2..4].
    let mut b = board(&["0", "A", ".", "1", "."]);
    apply_gravity(&mut b);
    assert_eq!(b.to_rows(), vec!["0", "A", ".", ".", "1"]);
}

// --- T4 refill --------------------------------------------------------------

#[test]
fn t4_fills_every_hole_leaves_blockers_and_counts_draws() {
    let mut b = board(&["0.0", ".A.", "..."]);
    let empties_before = b.cells().iter().filter(|c| c.is_empty()).count();
    assert_eq!(empties_before, 6);
    let mut rng = DetRng::from_seed(1);
    refill(&mut b, &mut rng, 6);
    assert!(b.is_settled(), "no holes remain after refill");
    assert_eq!(b.get(1, 1), Cell::Blocker(1), "blocker untouched");
    assert_eq!(rng.draws(), empties_before as u64, "one draw per hole");
    for c in b.cells() {
        if let Cell::Gem(g) = c {
            assert!((*g as usize) < 6, "gem colour within range");
        }
    }
}

#[test]
fn t4_refill_is_deterministic_for_a_seed() {
    let mut a = board(&["...", "...", "..."]);
    let mut b = a.clone();
    refill(&mut a, &mut DetRng::from_seed(99), 6);
    refill(&mut b, &mut DetRng::from_seed(99), 6);
    assert_eq!(a, b, "same seed + same holes -> identical fill");
}

// --- swap legality ----------------------------------------------------------

#[test]
fn swap_legal_true_when_swap_creates_a_match() {
    let b = board(&["0010", "3452", "4534"]);
    assert!(swap_legal(&b, (0, 2), (0, 3)));
}

#[test]
fn swap_illegal_when_no_match_results() {
    let b = board(&["0010", "3452", "4534"]);
    assert!(!swap_legal(&b, (0, 0), (0, 1)));
}

#[test]
fn swap_illegal_when_not_adjacent() {
    let b = board(&["0010", "3452", "4534"]);
    assert!(!swap_legal(&b, (0, 0), (0, 3)));
}

#[test]
fn swap_illegal_onto_a_blocker() {
    let b = board(&["A010", "3452", "4534"]);
    assert!(!swap_legal(&b, (0, 0), (0, 1)));
}
