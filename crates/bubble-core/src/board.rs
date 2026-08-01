//! The staggered hex board and its six-neighbour adjacency (RULES.md
//! "Board geometry" + "Adjacency").

use serde::{Deserialize, Serialize};

/// A board position as `(row, col)`.
pub type Pos = (usize, usize);

/// One cell: empty, or a bubble of a colour in `0..colors`.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum Cell {
    /// No bubble.
    Empty,
    /// A bubble of the given colour index.
    Bubble(u8),
}

/// Errors constructing or addressing a board.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum BoardError {
    /// A dimension was zero.
    #[error("board dimensions must be non-zero")]
    ZeroDim,
}

/// A staggered hex board: "full" rows hold `width` cells, "short" rows hold
/// `width-1`, stored in one flat row-major `Vec<Cell>`.
///
/// Which rows are full is set by `parity_offset ∈ {0, 1}`: row `r` is full when
/// `(r + parity_offset)` is even. A fresh board has offset `0` (even rows full,
/// odd rows short — the base staggered layout). Pushing a new row in at the top
/// ([`Board::insert_top_row`]) shifts every row down one **and flips the offset**,
/// which exactly cancels the index shift so every existing bubble keeps its
/// full/short classification and geometry — only the new top row is added. A flip
/// preserves the flat cell count only when `height` is even (otherwise the
/// full/short balance changes by one), which the top-insert path requires.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Board {
    /// Cells in a full row.
    pub width: usize,
    /// Number of rows.
    pub height: usize,
    /// Row-parity offset: row `r` is full when `(r + parity_offset)` is even.
    parity_offset: usize,
    cells: Vec<Cell>,
}

impl Board {
    /// Length of row `r` at `parity_offset`: `width` when `(r + parity_offset)`
    /// is even (a full row), else `width - 1` (a short row).
    #[must_use]
    pub fn row_len_off(width: usize, r: usize, parity_offset: usize) -> usize {
        if (r + parity_offset).is_multiple_of(2) {
            width
        } else {
            width.saturating_sub(1)
        }
    }

    /// Length of row `r` in the base (offset-0) layout: `width` if `r` is even,
    /// `width - 1` if odd. Convenience for offset-0 contexts (the deal, tests);
    /// parity-carrying code uses [`Board::row_len_at`].
    #[must_use]
    pub fn row_len(width: usize, r: usize) -> usize {
        Self::row_len_off(width, r, 0)
    }

    /// This board's row-parity offset (`0` for a fresh board; toggles on each
    /// top-row insert).
    #[must_use]
    pub fn parity_offset(&self) -> usize {
        self.parity_offset
    }

    /// Length of row `r` respecting **this board's** parity offset — the
    /// parity-aware length every board-carrying caller should use.
    #[must_use]
    pub fn row_len_at(&self, r: usize) -> usize {
        Self::row_len_off(self.width, r, self.parity_offset)
    }

    /// A board of all-`Empty` cells.
    ///
    /// # Errors
    /// Returns `ZeroDim` if `width` or `height` is zero (a short odd row needs
    /// `width >= 2` to be non-degenerate, enforced as `width >= 1` here and the
    /// caller's mode constants keep it sane).
    pub fn new_empty(width: usize, height: usize) -> Result<Self, BoardError> {
        if width == 0 || height == 0 {
            return Err(BoardError::ZeroDim);
        }
        let total: usize = (0..height).map(|r| Self::row_len(width, r)).sum();
        Ok(Self {
            width,
            height,
            parity_offset: 0,
            cells: vec![Cell::Empty; total],
        })
    }

    /// Flat index of `(row, col)`, or `None` if out of bounds (parity-aware).
    #[must_use]
    pub fn index(&self, r: usize, c: usize) -> Option<usize> {
        if r >= self.height || c >= self.row_len_at(r) {
            return None;
        }
        let start: usize = (0..r).map(|rr| self.row_len_at(rr)).sum();
        Some(start + c)
    }

    /// The cell at `(row, col)`, or `None` if out of bounds.
    #[must_use]
    pub fn get(&self, r: usize, c: usize) -> Option<Cell> {
        self.index(r, c).map(|i| self.cells[i])
    }

    /// Set the cell at `(row, col)`. No-op if out of bounds.
    pub fn set(&mut self, r: usize, c: usize, cell: Cell) {
        if let Some(i) = self.index(r, c) {
            self.cells[i] = cell;
        }
    }

    /// All cells in canonical flat order (row 0 first).
    #[must_use]
    pub fn cells(&self) -> &[Cell] {
        &self.cells
    }

    /// The six-neighbour positions of `(r, c)` that lie on the board
    /// (RULES.md "Adjacency"). Order is unspecified; callers treat it as a set.
    #[must_use]
    pub fn neighbors(&self, r: usize, c: usize) -> Vec<Pos> {
        let rlen = self.row_len_at(r);
        if r >= self.height || c >= rlen {
            return Vec::new();
        }
        let mut out = Vec::with_capacity(6);
        if c >= 1 {
            out.push((r, c - 1));
        }
        if c + 1 < rlen {
            out.push((r, c + 1));
        }
        // Diagonal column offsets by row parity (RULES.md "Adjacency"):
        // full rows reach c-1 and c; short rows reach c and c+1. "Full" is
        // `(r + parity_offset)` even, so the offset toggles with a top insert.
        let (d0, d1): (isize, isize) = if (r + self.parity_offset).is_multiple_of(2) {
            (-1, 0)
        } else {
            (0, 1)
        };
        for dr in [-1isize, 1] {
            let nr = r as isize + dr;
            if nr < 0 || nr as usize >= self.height {
                continue;
            }
            let nr = nr as usize;
            let nlen = self.row_len_at(nr);
            for dc in [d0, d1] {
                let nc = c as isize + dc;
                if nc >= 0 && (nc as usize) < nlen {
                    out.push((nr, nc as usize));
                }
            }
        }
        out
    }

    /// Push a new row in at the top (the Puzzle Bobble descending-stack pressure):
    /// shift every row down one, **flip the parity offset** (so all existing
    /// bubbles keep their geometry), and write `new_top` into the new row 0. The
    /// content in the old bottom row is pushed off the fixed-height board.
    ///
    /// Returns `true` if any **occupied** cell was pushed off the bottom — the
    /// mechanical half of the deadline check (the levels wrapper also treats
    /// content reaching the reserved bottom rows as a loss).
    ///
    /// `new_top` supplies the new row 0's cells; it is read up to that row's
    /// length under the flipped offset (extra entries ignored, a short slice
    /// padded with `Empty`). A parity flip preserves the flat cell count only for
    /// **even** `height`; the levels mode upholds that (`debug_assert`).
    pub fn insert_top_row(&mut self, new_top: &[Cell]) -> bool {
        debug_assert!(
            self.height.is_multiple_of(2),
            "top-row insertion needs an even height so the parity flip preserves the cell count"
        );
        let new_offset = 1 - self.parity_offset;
        // Was any occupied cell in the old bottom row (about to fall off)?
        let last = self.height - 1;
        let pushed_off =
            (0..self.row_len_at(last)).any(|c| matches!(self.get(last, c), Some(Cell::Bubble(_))));

        // Rebuild the flat cells under the new offset: row 0 = new_top, row r>0 =
        // old row r-1 (same length under the flipped offset, so cells line up).
        let mut cells: Vec<Cell> = Vec::with_capacity(self.cells.len());
        for r in 0..self.height {
            let len = Board::row_len_off(self.width, r, new_offset);
            for c in 0..len {
                let cell = if r == 0 {
                    new_top.get(c).copied().unwrap_or(Cell::Empty)
                } else {
                    // Old row r-1 under the OLD offset has this same length.
                    self.get(r - 1, c).unwrap_or(Cell::Empty)
                };
                cells.push(cell);
            }
        }
        self.parity_offset = new_offset;
        self.cells = cells;
        pushed_off
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_len_alternates_full_then_short() {
        assert_eq!(Board::row_len(8, 0), 8);
        assert_eq!(Board::row_len(8, 1), 7);
        assert_eq!(Board::row_len(8, 2), 8);
    }

    #[test]
    fn empty_board_has_expected_cell_count() {
        // 4 rows of width 8: 8 + 7 + 8 + 7 = 30.
        let b = Board::new_empty(8, 4).expect("valid dims");
        assert_eq!(b.cells().len(), 30);
        assert!(b.cells().iter().all(|&c| c == Cell::Empty));
    }

    #[test]
    fn zero_dimension_rejected() {
        assert_eq!(Board::new_empty(0, 4), Err(BoardError::ZeroDim));
        assert_eq!(Board::new_empty(8, 0), Err(BoardError::ZeroDim));
    }

    #[test]
    fn interior_even_row_cell_has_six_neighbours() {
        // Big enough that (2, 3) is fully interior.
        let b = Board::new_empty(8, 6).expect("valid dims");
        let n = b.neighbors(2, 3);
        assert_eq!(n.len(), 6, "interior even cell must have 6 neighbours");
        // even-row diagonals are at columns c-1 and c on rows above and below.
        for p in [(1, 2), (1, 3), (3, 2), (3, 3), (2, 2), (2, 4)] {
            assert!(n.contains(&p), "expected neighbour {p:?} in {n:?}");
        }
    }

    #[test]
    fn interior_odd_row_cell_has_six_neighbours() {
        let b = Board::new_empty(8, 6).expect("valid dims");
        let n = b.neighbors(3, 3);
        assert_eq!(n.len(), 6, "interior odd cell must have 6 neighbours");
        // odd-row diagonals are at columns c and c+1 on rows above and below.
        for p in [(2, 3), (2, 4), (4, 3), (4, 4), (3, 2), (3, 4)] {
            assert!(n.contains(&p), "expected neighbour {p:?} in {n:?}");
        }
    }

    #[test]
    fn top_left_corner_has_two_neighbours() {
        let b = Board::new_empty(8, 6).expect("valid dims");
        let n = b.neighbors(0, 0);
        // (0,0): right (0,1) and one down-diagonal (1,0). Up row none.
        assert_eq!(n.len(), 2, "corner {n:?}");
        assert!(n.contains(&(0, 1)));
        assert!(n.contains(&(1, 0)));
    }

    #[test]
    fn neighbours_never_point_off_board() {
        let b = Board::new_empty(8, 6).expect("valid dims");
        for r in 0..b.height {
            for c in 0..Board::row_len(b.width, r) {
                for (nr, nc) in b.neighbors(r, c) {
                    assert!(b.get(nr, nc).is_some(), "({nr},{nc}) off board");
                }
            }
        }
    }

    // ---- parity offset + top-row insertion (levels-mode pressure) ----

    #[test]
    fn fresh_board_has_offset_zero_and_base_row_lengths() {
        let b = Board::new_empty(8, 4).expect("valid dims");
        assert_eq!(b.parity_offset(), 0);
        assert_eq!(
            (b.row_len_at(0), b.row_len_at(1)),
            (8, 7),
            "even full, odd short"
        );
    }

    #[test]
    fn insert_shifts_content_down_and_flips_parity_preserving_geometry() {
        // Even height so the flip preserves the flat cell count. Fill every cell
        // with a position-encoded colour, insert an empty top row, and confirm
        // each old (r,c) reappears at (r+1,c) with the same colour AND the same
        // full/short row classification — i.e. only a new top row was added.
        let mut b = Board::new_empty(8, 4).expect("valid dims");
        let color = |r: usize, c: usize| u8::try_from((r * 8 + c) % 250).expect("fits");
        for r in 0..b.height {
            for c in 0..b.row_len_at(r) {
                b.set(r, c, Cell::Bubble(color(r, c)));
            }
        }
        let old_len: Vec<usize> = (0..b.height).map(|r| b.row_len_at(r)).collect();

        let pushed = b.insert_top_row(&[]); // empty new top row
        assert!(
            pushed,
            "the old bottom row was full, so occupied content fell off"
        );
        assert_eq!(b.parity_offset(), 1, "offset flipped");

        // New row 0 is the inserted (empty) row.
        for c in 0..b.row_len_at(0) {
            assert_eq!(b.get(0, c), Some(Cell::Empty), "new top row is empty");
        }
        // Old row r moved to r+1, same colour and same classification (length).
        for r in 0..b.height - 1 {
            assert_eq!(
                b.row_len_at(r + 1),
                old_len[r],
                "row {r} kept its full/short classification after shifting to {}",
                r + 1
            );
            for c in 0..b.row_len_at(r + 1) {
                assert_eq!(
                    b.get(r + 1, c),
                    Some(Cell::Bubble(color(r, c))),
                    "old ({r},{c}) shifted to ({},{c}) unchanged",
                    r + 1
                );
            }
        }
    }

    #[test]
    fn two_inserts_return_parity_to_zero() {
        let mut b = Board::new_empty(8, 4).expect("valid dims");
        b.insert_top_row(&[]);
        assert_eq!(b.parity_offset(), 1);
        b.insert_top_row(&[]);
        assert_eq!(
            b.parity_offset(),
            0,
            "an even number of inserts restores the base parity"
        );
        assert_eq!((b.row_len_at(0), b.row_len_at(1)), (8, 7));
    }

    #[test]
    fn insert_reports_no_push_off_when_bottom_row_empty() {
        // Only the top row filled: shifting down cannot push any bubble off.
        let mut b = Board::new_empty(8, 4).expect("valid dims");
        for c in 0..b.row_len_at(0) {
            b.set(0, c, Cell::Bubble(1));
        }
        assert!(
            !b.insert_top_row(&[]),
            "nothing occupied at the bottom, nothing falls off"
        );
    }

    #[test]
    fn inserted_top_row_takes_the_new_offset_length() {
        // After one insert the offset is 1, so row 0 is a SHORT row (width-1).
        let mut b = Board::new_empty(8, 4).expect("valid dims");
        let new_top: Vec<Cell> = (0..8)
            .map(|c| Cell::Bubble(u8::try_from(c).unwrap()))
            .collect();
        b.insert_top_row(&new_top);
        assert_eq!(b.row_len_at(0), 7, "row 0 is short at offset 1");
        for c in 0..7 {
            assert_eq!(b.get(0, c), Some(Cell::Bubble(u8::try_from(c).unwrap())));
        }
        assert_eq!(
            b.get(0, 7),
            None,
            "the 8th supplied cell is dropped — short row"
        );
    }
}
