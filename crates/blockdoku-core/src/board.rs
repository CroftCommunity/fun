//! The Blockdoku board — a 9×9 grid of plain occupancy.
//!
//! `board[row][col]`, rows top→bottom, cols left→right. A cell is `0` (empty) or
//! `1` (filled). Colour is cosmetic and lives in the UI, never here — the whole
//! determinism-critical path is integer occupancy. 3×3 boxes are indexed `0..9`
//! row-major (`box = (row/3)*3 + (col/3)`).
//!
//! Completing a full row, column, or 3×3 box clears it. All regions completed by a
//! **single placement** are detected first and then cleared as a **union**, so a
//! cell shared by a cleared row and a cleared box is emptied once (§ RULES).

use crate::shapes::ShapeDef;

/// Board side length (9×9).
pub const SIZE: usize = 9;
/// 3×3 box side length.
pub const BOX: usize = 3;

/// A cell coordinate `(row, col)`.
pub type Pos = (usize, usize);

/// The set of regions completed by one placement (indices into rows/cols/boxes).
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct ClearReport {
    /// Completed row indices (`0..9`).
    pub rows: Vec<usize>,
    /// Completed column indices (`0..9`).
    pub cols: Vec<usize>,
    /// Completed 3×3 box indices (`0..9`, row-major).
    pub boxes: Vec<usize>,
}

impl ClearReport {
    /// Total number of regions cleared (rows + cols + boxes) — the combo count.
    #[must_use]
    pub fn total(&self) -> usize {
        self.rows.len() + self.cols.len() + self.boxes.len()
    }

    /// Whether nothing was cleared.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.total() == 0
    }
}

/// The 9×9 occupancy grid.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Board {
    cells: Vec<u8>,
}

impl Default for Board {
    fn default() -> Self {
        Self::empty()
    }
}

impl Board {
    /// An empty 9×9 board.
    #[must_use]
    pub fn empty() -> Self {
        Self {
            cells: vec![0; SIZE * SIZE],
        }
    }

    /// Build from explicit occupancy rows (tests / fixtures). Each row must be
    /// length [`SIZE`]; extra/short rows are taken as given (test-only helper).
    #[must_use]
    pub fn from_rows(rows: &[[u8; SIZE]; SIZE]) -> Self {
        let mut cells = Vec::with_capacity(SIZE * SIZE);
        for row in rows {
            cells.extend_from_slice(row);
        }
        Self { cells }
    }

    /// Occupancy at `(r, c)` (`0` empty / `1` filled).
    #[must_use]
    pub fn get(&self, r: usize, c: usize) -> u8 {
        self.cells[r * SIZE + c]
    }

    /// Set occupancy at `(r, c)`.
    pub fn set(&mut self, r: usize, c: usize, v: u8) {
        self.cells[r * SIZE + c] = v;
    }

    /// Row-major cells (the hashed encoding).
    #[must_use]
    pub fn cells(&self) -> &[u8] {
        &self.cells
    }

    /// The 3×3 box index for `(r, c)`, row-major (`0..9`).
    #[must_use]
    pub fn box_of(r: usize, c: usize) -> usize {
        (r / BOX) * BOX + (c / BOX)
    }

    /// The 9 cells of box `b`, row-major.
    #[must_use]
    pub fn box_cells(b: usize) -> [Pos; SIZE] {
        let (br, bc) = ((b / BOX) * BOX, (b % BOX) * BOX);
        let mut out = [(0, 0); SIZE];
        let mut i = 0;
        for dr in 0..BOX {
            for dc in 0..BOX {
                out[i] = (br + dr, bc + dc);
                i += 1;
            }
        }
        out
    }

    /// Whether `shape` can be placed with its top-left at `(row, col)`: it fits in
    /// bounds and every filled offset lands on an empty cell.
    #[must_use]
    pub fn can_place(&self, shape: &ShapeDef, row: usize, col: usize) -> bool {
        if row + shape.rows() > SIZE || col + shape.cols() > SIZE {
            return false;
        }
        shape
            .filled_offsets()
            .into_iter()
            .all(|(dr, dc)| self.get(row + dr, col + dc) == 0)
    }

    /// Place `shape` at `(row, col)`. Caller must have checked [`Board::can_place`].
    pub fn place(&mut self, shape: &ShapeDef, row: usize, col: usize) {
        for (dr, dc) in shape.filled_offsets() {
            self.set(row + dr, col + dc, 1);
        }
    }

    /// Detect every fully-occupied row, column, and 3×3 box. Detection reads the
    /// board as-is (no mutation), so all regions completed by one placement are
    /// found together before any clearing happens.
    #[must_use]
    pub fn completed_regions(&self) -> ClearReport {
        let mut report = ClearReport::default();
        for r in 0..SIZE {
            if (0..SIZE).all(|c| self.get(r, c) == 1) {
                report.rows.push(r);
            }
        }
        for c in 0..SIZE {
            if (0..SIZE).all(|r| self.get(r, c) == 1) {
                report.cols.push(c);
            }
        }
        for b in 0..SIZE {
            if Self::box_cells(b).iter().all(|&(r, c)| self.get(r, c) == 1) {
                report.boxes.push(b);
            }
        }
        report
    }

    /// Clear the **union** of all cells in the reported rows, columns, and boxes.
    /// A cell counted by two regions is emptied once.
    pub fn clear_regions(&mut self, report: &ClearReport) {
        for &r in &report.rows {
            for c in 0..SIZE {
                self.set(r, c, 0);
            }
        }
        for &c in &report.cols {
            for r in 0..SIZE {
                self.set(r, c, 0);
            }
        }
        for &b in &report.boxes {
            for (r, c) in Self::box_cells(b) {
                self.set(r, c, 0);
            }
        }
    }

    /// Whether any of the given shapes can be placed anywhere (game-over test:
    /// false for a non-empty tray means the game is stuck).
    #[must_use]
    pub fn has_any_placement(&self, shapes: &[&ShapeDef]) -> bool {
        shapes.iter().any(|s| self.can_place_anywhere(s))
    }

    /// Whether `shape` fits at any anchor on the current board.
    #[must_use]
    pub fn can_place_anywhere(&self, shape: &ShapeDef) -> bool {
        (0..SIZE).any(|r| (0..SIZE).any(|c| self.can_place(shape, r, c)))
    }

    /// Every legal anchor `(row, col)` for `shape`, row-major (the canonical order
    /// the UI glows and `legal_moves` reports).
    #[must_use]
    pub fn placements(&self, shape: &ShapeDef) -> Vec<Pos> {
        let mut out = Vec::new();
        for r in 0..SIZE {
            for c in 0..SIZE {
                if self.can_place(shape, r, c) {
                    out.push((r, c));
                }
            }
        }
        out
    }
}
