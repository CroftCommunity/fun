//! The Dots and Boxes board: which edges are drawn, who owns each box, and
//! whose turn it is.
//!
//! **Edge numbering** (fixed, and the wire code a `?r=` share carries):
//!
//! ```text
//! horizontal  H(r,c) = r*COLS + c            r in 0..=ROWS, c in 0..COLS   -> 0..11
//! vertical    V(r,c) = H_EDGES + r*(COLS+1) + c   r in 0..ROWS, c in 0..=COLS -> 12..23
//! ```
//!
//! Box `(r, c)` closes on `H(r,c)`, `H(r+1,c)`, `V(r,c)`, `V(r,c+1)`.
//!
//! `edges` is a `u32` bitmask rather than a byte array because the search keys a
//! memo table on it directly, and because a fixed-width integer keeps the hashed
//! path free of `usize` (whose width differs between native and `wasm32`).

use adversary_core::Side;

/// Boxes down the board.
pub const ROWS: usize = 3;
/// Boxes across the board.
pub const COLS: usize = 3;
/// Horizontal edges: one per box column, on each of `ROWS + 1` dot rows.
pub const H_EDGES: usize = (ROWS + 1) * COLS;
/// Vertical edges: one per box row, on each of `COLS + 1` dot columns.
pub const V_EDGES: usize = ROWS * (COLS + 1);
/// Total edges on the board.
pub const EDGES: usize = H_EDGES + V_EDGES;
/// Total boxes on the board.
pub const BOXES: usize = ROWS * COLS;
/// Every edge drawn — the terminal edge mask.
pub const ALL_EDGES: u32 = (1u32 << EDGES) - 1;

/// The index of the horizontal edge on dot row `r` spanning box column `c`.
#[must_use]
pub const fn h_edge(r: usize, c: usize) -> usize {
    r * COLS + c
}

/// The index of the vertical edge on dot column `c` spanning box row `r`.
#[must_use]
pub const fn v_edge(r: usize, c: usize) -> usize {
    H_EDGES + r * (COLS + 1) + c
}

/// The edge mask of the four edges that close box `b`.
#[must_use]
pub const fn box_mask(b: usize) -> u32 {
    let r = b / COLS;
    let c = b % COLS;
    (1u32 << h_edge(r, c))
        | (1u32 << h_edge(r + 1, c))
        | (1u32 << v_edge(r, c))
        | (1u32 << v_edge(r, c + 1))
}

/// For each edge, the one or two boxes it borders (`-1` where there is no second).
const EDGE_BOXES: [[i8; 2]; EDGES] = build_edge_boxes();

const fn build_edge_boxes() -> [[i8; 2]; EDGES] {
    let mut out = [[-1i8; 2]; EDGES];
    let mut b = 0;
    while b < BOXES {
        let mask = box_mask(b);
        let mut e = 0;
        while e < EDGES {
            if mask & (1u32 << e) != 0 {
                if out[e][0] < 0 {
                    out[e][0] = b as i8;
                } else {
                    out[e][1] = b as i8;
                }
            }
            e += 1;
        }
        b += 1;
    }
    out
}

/// The byte a side owns a box with (`0` is unowned).
#[must_use]
pub fn owner_of(side: Side) -> u8 {
    match side {
        Side::A => 1,
        Side::B => 2,
    }
}

/// The side owning a box byte, or `None` for unowned / unknown.
#[must_use]
pub fn side_of_owner(byte: u8) -> Option<Side> {
    match byte {
        1 => Some(Side::A),
        2 => Some(Side::B),
        _ => None,
    }
}

/// A bitmask over `BOXES` of the boxes that drawing edge `e` **completes**,
/// given the edges already drawn.
///
/// Returns `0` when `e` completes nothing — which is also the test for "the turn
/// passes", since a capture is exactly what grants another move. Drawing an edge
/// that is already present completes nothing new.
#[must_use]
pub fn completed_boxes(edges: u32, e: usize) -> u16 {
    if e >= EDGES || edges & (1u32 << e) != 0 {
        return 0;
    }
    let after = edges | (1u32 << e);
    let mut done = 0u16;
    for &b in &EDGE_BOXES[e] {
        if b < 0 {
            continue;
        }
        let mask = box_mask(b as usize);
        if after & mask == mask {
            done |= 1u16 << b;
        }
    }
    done
}

/// A Dots and Boxes position: drawn edges, box owners, and whose turn it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Board {
    /// Drawn-edge bitmask, bits `0..EDGES`.
    pub edges: u32,
    /// Box owners, box-major (`r * COLS + c`); `0` unowned, `1` Side A, `2` Side B.
    pub owners: [u8; BOXES],
    /// The side to move.
    pub to_move: Side,
}

impl Board {
    /// The empty starting board with Side A to move.
    #[must_use]
    pub fn empty() -> Self {
        Board {
            edges: 0,
            owners: [0; BOXES],
            to_move: Side::A,
        }
    }

    /// Whether edge `e` is drawn.
    #[must_use]
    pub fn is_drawn(&self, e: usize) -> bool {
        e < EDGES && self.edges & (1u32 << e) != 0
    }

    /// How many edges remain undrawn.
    #[must_use]
    pub fn free_count(&self) -> u32 {
        (!self.edges & ALL_EDGES).count_ones()
    }

    /// Whether every edge is drawn (the only terminal condition).
    #[must_use]
    pub fn is_complete(&self) -> bool {
        self.edges == ALL_EDGES
    }

    /// Boxes owned by `(Side A, Side B)`.
    #[must_use]
    pub fn box_counts(&self) -> (u8, u8) {
        let mut counts = (0u8, 0u8);
        for &owner in &self.owners {
            match side_of_owner(owner) {
                Some(Side::A) => counts.0 += 1,
                Some(Side::B) => counts.1 += 1,
                None => {}
            }
        }
        counts
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn board_dimensions_are_the_documented_3x3() {
        assert_eq!(ROWS, 3);
        assert_eq!(COLS, 3);
        assert_eq!(H_EDGES, 12);
        assert_eq!(V_EDGES, 12);
        assert_eq!(EDGES, 24);
        assert_eq!(BOXES, 9);
        assert_eq!(ALL_EDGES, 0x00FF_FFFF);
    }

    #[test]
    fn edge_numbering_is_dense_and_collision_free() {
        // Every (kind, r, c) maps to a distinct index, and together they cover
        // 0..EDGES exactly once. This is the property the wire code depends on.
        let mut seen = vec![0u32; EDGES];
        for r in 0..=ROWS {
            for c in 0..COLS {
                seen[h_edge(r, c)] += 1;
            }
        }
        for r in 0..ROWS {
            for c in 0..=COLS {
                seen[v_edge(r, c)] += 1;
            }
        }
        assert!(
            seen.iter().all(|&n| n == 1),
            "each edge index used exactly once, got {seen:?}"
        );
    }

    #[test]
    fn horizontal_and_vertical_ranges_do_not_overlap() {
        assert_eq!(h_edge(0, 0), 0);
        assert_eq!(h_edge(ROWS, COLS - 1), H_EDGES - 1);
        assert_eq!(v_edge(0, 0), H_EDGES);
        assert_eq!(v_edge(ROWS - 1, COLS), EDGES - 1);
    }

    #[test]
    fn every_box_has_four_distinct_edges() {
        for b in 0..BOXES {
            assert_eq!(
                box_mask(b).count_ones(),
                4,
                "box {b} must close on exactly four edges"
            );
        }
    }

    #[test]
    fn the_top_left_box_closes_on_the_expected_edges() {
        // Box 0 is (r=0, c=0): H(0,0)=0, H(1,0)=3, V(0,0)=12, V(0,1)=13.
        let expected = (1u32 << 0) | (1u32 << 3) | (1u32 << 12) | (1u32 << 13);
        assert_eq!(box_mask(0), expected);
    }

    #[test]
    fn interior_edges_border_two_boxes_and_rim_edges_one() {
        // H(1,0) = 3 sits between box 0 (r0c0) and box 3 (r1c0).
        assert_eq!(EDGE_BOXES[3], [0, 3]);
        // H(0,0) = 0 is on the top rim, so it borders only box 0.
        assert_eq!(EDGE_BOXES[0], [0, -1]);
        // V(0,0) = 12 is on the left rim, so it borders only box 0.
        assert_eq!(EDGE_BOXES[12], [0, -1]);
        // V(0,1) = 13 is interior, between box 0 and box 1.
        assert_eq!(EDGE_BOXES[13], [0, 1]);
    }

    #[test]
    fn completed_boxes_reports_nothing_until_the_fourth_edge() {
        let m = box_mask(0);
        let three = m & !(1u32 << 13); // box 0 missing only V(0,1)
        assert_eq!(
            completed_boxes(three, 0),
            0,
            "an already-drawn edge closes nothing"
        );
        assert_eq!(
            completed_boxes(three, 13),
            1u16 << 0,
            "the fourth edge closes box 0"
        );
    }

    #[test]
    fn one_edge_can_close_two_boxes_at_once() {
        // Draw everything for boxes 0 and 1 except their shared edge V(0,1)=13.
        let both = (box_mask(0) | box_mask(1)) & !(1u32 << 13);
        let done = completed_boxes(both, 13);
        assert_eq!(done.count_ones(), 2, "the shared edge closes both boxes");
        assert_eq!(done, (1u16 << 0) | (1u16 << 1));
    }

    #[test]
    fn completed_boxes_is_out_of_range_safe() {
        assert_eq!(completed_boxes(0, EDGES), 0);
        assert_eq!(completed_boxes(0, 999), 0);
    }

    #[test]
    fn owner_round_trips_and_zero_is_unowned() {
        assert_eq!(side_of_owner(owner_of(Side::A)), Some(Side::A));
        assert_eq!(side_of_owner(owner_of(Side::B)), Some(Side::B));
        assert_eq!(side_of_owner(0), None);
        assert_eq!(side_of_owner(7), None);
    }

    #[test]
    fn empty_board_is_side_a_to_move_with_every_edge_free() {
        let b = Board::empty();
        assert_eq!(b.to_move, Side::A);
        assert_eq!(b.free_count(), EDGES as u32);
        assert!(!b.is_complete());
        assert_eq!(b.box_counts(), (0, 0));
        assert!(!b.is_drawn(0));
    }

    #[test]
    fn a_full_edge_mask_is_complete_with_no_free_edges() {
        let b = Board {
            edges: ALL_EDGES,
            owners: [1; BOXES],
            to_move: Side::A,
        };
        assert!(b.is_complete());
        assert_eq!(b.free_count(), 0);
        assert_eq!(b.box_counts(), (9, 0));
        assert!(b.is_drawn(EDGES - 1));
    }

    #[test]
    fn is_drawn_is_out_of_range_safe() {
        let b = Board {
            edges: ALL_EDGES,
            owners: [0; BOXES],
            to_move: Side::A,
        };
        assert!(!b.is_drawn(EDGES), "an index past the board is not drawn");
    }
}
