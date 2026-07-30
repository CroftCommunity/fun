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

/// A staggered hex board: even rows full (`width`), odd rows short (`width-1`),
/// stored in one flat row-major `Vec<Cell>`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Board {
    /// Cells in a full (even) row.
    pub width: usize,
    /// Number of rows.
    pub height: usize,
    cells: Vec<Cell>,
}

impl Board {
    /// Length of row `r`: `width` if even, `width - 1` if odd.
    #[must_use]
    pub fn row_len(width: usize, r: usize) -> usize {
        if r.is_multiple_of(2) {
            width
        } else {
            width.saturating_sub(1)
        }
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
            cells: vec![Cell::Empty; total],
        })
    }

    /// Flat index of `(row, col)`, or `None` if out of bounds.
    #[must_use]
    pub fn index(&self, r: usize, c: usize) -> Option<usize> {
        if r >= self.height || c >= Self::row_len(self.width, r) {
            return None;
        }
        let start: usize = (0..r).map(|rr| Self::row_len(self.width, rr)).sum();
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
        let rlen = Self::row_len(self.width, r);
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
        // even rows reach c-1 and c; odd rows reach c and c+1.
        let (d0, d1): (isize, isize) = if r.is_multiple_of(2) { (-1, 0) } else { (0, 1) };
        for dr in [-1isize, 1] {
            let nr = r as isize + dr;
            if nr < 0 || nr as usize >= self.height {
                continue;
            }
            let nr = nr as usize;
            let nlen = Self::row_len(self.width, nr);
            for dc in [d0, d1] {
                let nc = c as isize + dc;
                if nc >= 0 && (nc as usize) < nlen {
                    out.push((nr, nc as usize));
                }
            }
        }
        out
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
}
