//! The 2048 board — a grid of tile **exponents**.
//!
//! A cell holds `0` (empty) or an exponent `v` meaning the tile value `2^v`
//! (so `1`=2, `2`=4, … `11`=2048). Exponents keep the whole determinism-critical
//! path integer-only.

/// A cell coordinate `(row, col)`.
pub type Pos = (usize, usize);

/// A rectangular board of tile exponents, row-major.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Board {
    /// Columns.
    pub width: usize,
    /// Rows.
    pub height: usize,
    cells: Vec<u8>,
}

impl Board {
    /// An empty `width`×`height` board.
    #[must_use]
    pub fn empty(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            cells: vec![0; width * height],
        }
    }

    /// Build from explicit exponent rows (for tests and the pack fixture).
    #[must_use]
    pub fn from_rows(rows: &[&[u8]]) -> Self {
        let height = rows.len();
        let width = rows.first().map_or(0, |r| r.len());
        let mut cells = Vec::with_capacity(width * height);
        for row in rows {
            cells.extend_from_slice(row);
        }
        Self {
            width,
            height,
            cells,
        }
    }

    /// The exponent at `(r, c)` (`0` = empty).
    #[must_use]
    pub fn get(&self, r: usize, c: usize) -> u8 {
        self.cells[r * self.width + c]
    }

    /// Set the exponent at `(r, c)`.
    pub fn set(&mut self, r: usize, c: usize, v: u8) {
        self.cells[r * self.width + c] = v;
    }

    /// Row-major cells.
    #[must_use]
    pub fn cells(&self) -> &[u8] {
        &self.cells
    }

    /// Every cell is occupied.
    #[must_use]
    pub fn is_full(&self) -> bool {
        self.cells.iter().all(|&v| v != 0)
    }

    /// The empty cells, row-major.
    #[must_use]
    pub fn empties(&self) -> Vec<Pos> {
        (0..self.height)
            .flat_map(|r| (0..self.width).map(move |c| (r, c)))
            .filter(|&(r, c)| self.get(r, c) == 0)
            .collect()
    }

    /// The largest exponent on the board (`0` if empty).
    #[must_use]
    pub fn max_exponent(&self) -> u8 {
        self.cells.iter().copied().max().unwrap_or(0)
    }
}
