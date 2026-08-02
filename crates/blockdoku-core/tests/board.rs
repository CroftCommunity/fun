//! B1: board placement, region detection, and simultaneous union clearing.

use blockdoku_core::board::{Board, ClearReport, SIZE};
use blockdoku_core::{by_key, state_hash};

fn filled_row() -> [u8; SIZE] {
    [1; SIZE]
}
fn empty_row() -> [u8; SIZE] {
    [0; SIZE]
}

#[test]
fn box_indexing_is_row_major() {
    assert_eq!(Board::box_of(0, 0), 0);
    assert_eq!(Board::box_of(0, 8), 2);
    assert_eq!(Board::box_of(4, 4), 4); // centre box
    assert_eq!(Board::box_of(8, 8), 8);
    assert_eq!(Board::box_of(3, 0), 3);
    // Every cell of box 4 maps back to box 4.
    for (r, c) in Board::box_cells(4) {
        assert_eq!(Board::box_of(r, c), 4);
    }
}

#[test]
fn placement_respects_bounds_and_occupancy() {
    let mut b = Board::empty();
    let l3x2 = by_key("l3x2").unwrap(); // 3 rows x 2 cols
    assert!(b.can_place(l3x2, 0, 0));
    assert!(b.can_place(l3x2, 6, 7)); // fits: 6+3<=9, 7+2<=9
    assert!(!b.can_place(l3x2, 7, 0)); // 7+3 > 9 rows
    assert!(!b.can_place(l3x2, 0, 8)); // 0+2 > 9 cols

    b.place(l3x2, 0, 0);
    // The occupied cells now block an overlapping placement.
    assert!(!b.can_place(by_key("single").unwrap(), 0, 0));
    assert!(b.can_place(by_key("single").unwrap(), 0, 5));
}

#[test]
fn placements_are_row_major_and_canonical() {
    let mut b = Board::empty();
    // Fill everything except (4,4); only a single fits, at exactly one anchor.
    for r in 0..SIZE {
        for c in 0..SIZE {
            if (r, c) != (4, 4) {
                b.set(r, c, 1);
            }
        }
    }
    let single = by_key("single").unwrap();
    assert_eq!(b.placements(single), vec![(4, 4)]);
    assert!(b.can_place_anywhere(single));
    assert!(!b.has_any_placement(&[by_key("line2").unwrap()]));
    assert!(b.has_any_placement(&[by_key("line2").unwrap(), single]));
}

#[test]
fn completing_a_row_is_detected_and_cleared() {
    let mut rows = [empty_row(); SIZE];
    rows[0] = filled_row();
    let mut b = Board::from_rows(&rows);
    let report = b.completed_regions();
    assert_eq!(report.rows, vec![0]);
    assert!(report.cols.is_empty());
    assert!(report.boxes.is_empty());
    assert_eq!(report.total(), 1);

    b.clear_regions(&report);
    for c in 0..SIZE {
        assert_eq!(b.get(0, c), 0, "row 0 col {c} should be cleared");
    }
}

#[test]
fn a_full_column_and_full_box_clear_as_a_union_over_the_shared_cell() {
    // Fill column 0 entirely, and additionally fill box 0's remaining cells so
    // box 0 is also complete. Cell (0,0) is shared by both regions; it must be
    // cleared exactly once (union), and both regions are detected together.
    let mut b = Board::empty();
    for r in 0..SIZE {
        b.set(r, 0, 1); // column 0
    }
    for (r, c) in Board::box_cells(0) {
        b.set(r, c, 1); // box 0 (rows 0..3, cols 0..3)
    }
    let report = b.completed_regions();
    assert_eq!(report.cols, vec![0]);
    assert_eq!(report.boxes, vec![0]);
    assert!(report.rows.is_empty());
    // 1 col + 1 box cleared = combo count 2.
    assert_eq!(report.total(), 2);

    b.clear_regions(&report);
    // Column 0 emptied.
    for r in 0..SIZE {
        assert_eq!(b.get(r, 0), 0);
    }
    // Box 0 emptied (incl. the shared cell (0,0)).
    for (r, c) in Board::box_cells(0) {
        assert_eq!(b.get(r, c), 0);
    }
}

#[test]
fn detection_reads_the_board_before_any_clearing() {
    // Two full rows completed by the same placement are both detected, then both
    // cleared — detection does not mutate mid-scan.
    let mut rows = [empty_row(); SIZE];
    rows[0] = filled_row();
    rows[1] = filled_row();
    let mut b = Board::from_rows(&rows);
    let report = b.completed_regions();
    assert_eq!(report.rows, vec![0, 1]);
    b.clear_regions(&report);
    assert_eq!(b, Board::empty());
}

#[test]
fn state_hash_is_stable_and_occupancy_sensitive() {
    let empty = Board::empty();
    let h0 = state_hash(&empty, 0, 0);
    // Deterministic across calls.
    assert_eq!(h0, state_hash(&Board::empty(), 0, 0));

    let mut b = Board::empty();
    b.set(4, 4, 1);
    assert_ne!(h0, state_hash(&b, 0, 0), "occupancy changes the hash");
    // Score and draws also bind into the hash.
    assert_ne!(state_hash(&b, 0, 0), state_hash(&b, 1, 0));
    assert_ne!(state_hash(&b, 0, 0), state_hash(&b, 0, 15));
}

#[test]
fn empty_report_helper() {
    assert!(ClearReport::default().is_empty());
}
