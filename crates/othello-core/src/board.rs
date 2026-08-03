//! The Othello board: an 8×8 grid of discs, whose turn it is, and cheap queries.
//!
//! Cells are a flat `[u8; 64]`, index `row * SIZE + col`, **row 0 = top** (Othello
//! has no gravity, so plain reading order is simplest). `0` = empty, `1` = Side A
//! (Black, the opener), `2` = Side B (White). The byte encoding is what the state
//! hash consumes, so it is identical on native and `wasm32`.

use adversary_core::Side;

/// Board side length (8×8).
pub const SIZE: usize = 8;
/// Total cells.
pub const CELLS: usize = SIZE * SIZE;

/// The byte a side occupies a cell with (`0` is empty). A = Black = 1, B = White = 2.
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

/// An Othello position: the grid plus whose turn it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Board {
    /// Flat cells, `row * SIZE + col`, row 0 = top.
    pub cells: [u8; CELLS],
    /// The side to move.
    pub to_move: Side,
}

impl Board {
    /// The standard Othello opening: the centre four discs (A at (3,4) & (4,3),
    /// B at (3,3) & (4,4)) with Side A (Black) to move.
    #[must_use]
    pub fn start() -> Self {
        let mut cells = [0u8; CELLS];
        cells[3 * SIZE + 3] = cell_of(Side::B); // (3,3) White
        cells[4 * SIZE + 4] = cell_of(Side::B); // (4,4) White
        cells[3 * SIZE + 4] = cell_of(Side::A); // (3,4) Black
        cells[4 * SIZE + 3] = cell_of(Side::A); // (4,3) Black
        Board {
            cells,
            to_move: Side::A,
        }
    }

    /// The cell byte at flat index `idx`.
    #[must_use]
    pub fn at(&self, idx: usize) -> u8 {
        self.cells[idx]
    }

    /// The cell byte at `(row, col)`.
    #[must_use]
    pub fn get(&self, row: usize, col: usize) -> u8 {
        self.cells[row * SIZE + col]
    }

    /// How many discs `side` has on the board.
    #[must_use]
    pub fn count(&self, side: Side) -> usize {
        let b = cell_of(side);
        self.cells.iter().filter(|&&v| v == b).count()
    }
}
