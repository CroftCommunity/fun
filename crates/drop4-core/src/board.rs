//! The Drop 4 board: a 7×6 grid of discs, whose turn it is, and cheap queries.
//!
//! Cells are a flat `[u8; 42]`, index `row * WIDTH + col`, **row 0 = bottom**
//! (discs stack up from the bottom with no gaps). `0` = empty, `1` = Side A,
//! `2` = Side B. The byte encoding is what the state hash consumes, so it is
//! identical on native and `wasm32`.

use adversary_core::Side;

/// Board columns.
pub const WIDTH: usize = 7;
/// Board rows.
pub const HEIGHT: usize = 6;
/// Total cells.
pub const CELLS: usize = WIDTH * HEIGHT;

/// The byte a side occupies a cell with (`0` is empty).
#[must_use]
pub fn cell_of(side: Side) -> u8 {
    match side {
        Side::A => 1,
        Side::B => 2,
    }
}

/// The side occupying a cell byte, or `None` for empty / unknown.
#[must_use]
pub fn side_of_cell(byte: u8) -> Option<Side> {
    match byte {
        1 => Some(Side::A),
        2 => Some(Side::B),
        _ => None,
    }
}

/// A Drop 4 position: the grid plus whose turn it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Board {
    /// Flat cells, `row * WIDTH + col`, row 0 = bottom.
    pub cells: [u8; CELLS],
    /// The side to move.
    pub to_move: Side,
}

impl Board {
    /// The empty starting board with Side A to move.
    #[must_use]
    pub fn empty() -> Self {
        Board {
            cells: [0; CELLS],
            to_move: Side::A,
        }
    }

    /// The cell byte at `(col, row)`, row 0 = bottom.
    #[must_use]
    pub fn get(&self, col: usize, row: usize) -> u8 {
        self.cells[row * WIDTH + col]
    }

    /// How many discs are stacked in `col` (its next drop lands at this row).
    #[must_use]
    pub fn height(&self, col: usize) -> usize {
        (0..HEIGHT).filter(|&r| self.get(col, r) != 0).count()
    }

    /// Whether `col` can accept another disc.
    #[must_use]
    pub fn can_drop(&self, col: usize) -> bool {
        col < WIDTH && self.height(col) < HEIGHT
    }

    /// Whether every column is full.
    #[must_use]
    pub fn is_full(&self) -> bool {
        (0..WIDTH).all(|c| self.height(c) == HEIGHT)
    }
}
