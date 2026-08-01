//! The bitboard position the solver searches over (Pascal Pons's layout).
//!
//! One `u64` (`current_position`) holds the side-to-move's discs, another
//! (`mask`) holds every disc. Bit index `col * 7 + row`, row 0 = bottom, with a
//! 7th (sentinel) bit per column so column arithmetic can't overflow between
//! columns. This is derived from a [`drop4_core::Board`] and is an internal
//! search representation only — the game's canonical state still lives in
//! `drop4-core`.

use drop4_core::{side_of_cell, Board, WIDTH as BW};

/// Board width (columns).
pub const WIDTH: u64 = 7;
/// Board height (rows).
pub const HEIGHT: u64 = 6;
/// Bits reserved per column (playable rows + one sentinel).
const STRIDE: u64 = HEIGHT + 1;

/// The lowest (row-0) bit of column `col`.
#[must_use]
pub fn bottom_mask_col(col: u64) -> u64 {
    1u64 << (col * STRIDE)
}

/// The top playable (row `HEIGHT-1`) bit of column `col`.
#[must_use]
pub fn top_mask_col(col: u64) -> u64 {
    1u64 << ((HEIGHT - 1) + col * STRIDE)
}

/// All playable bits of column `col`.
#[must_use]
pub fn column_mask(col: u64) -> u64 {
    ((1u64 << HEIGHT) - 1) << (col * STRIDE)
}

/// Whether `pos` contains any four-in-a-row (horizontal / vertical / both
/// diagonals). Strides: 7 horizontal, 1 vertical, 8 ascending, 6 descending.
#[must_use]
pub fn alignment(pos: u64) -> bool {
    // horizontal
    let m = pos & (pos >> 7);
    if m & (m >> 14) != 0 {
        return true;
    }
    // vertical
    let m = pos & (pos >> 1);
    if m & (m >> 2) != 0 {
        return true;
    }
    // diagonal ascending (↗)
    let m = pos & (pos >> 8);
    if m & (m >> 16) != 0 {
        return true;
    }
    // diagonal descending (↘)
    let m = pos & (pos >> 6);
    if m & (m >> 12) != 0 {
        return true;
    }
    false
}

/// A bitboard position: whose-turn discs, all discs, and the move count.
#[derive(Debug, Clone, Copy)]
pub struct Position {
    /// The side-to-move's discs.
    pub current: u64,
    /// Every disc on the board.
    pub mask: u64,
    /// Number of discs played so far.
    pub moves: u32,
}

impl Position {
    /// Build a bitboard from a [`drop4_core::Board`]. `current` is the discs of
    /// the side to move.
    #[must_use]
    pub fn from_board(board: &Board) -> Self {
        let mut mask = 0u64;
        let mut current = 0u64;
        let mut moves = 0u32;
        for col in 0..BW {
            let h = board.height(col);
            for row in 0..h {
                let bit = 1u64 << (col as u64 * STRIDE + row as u64);
                mask |= bit;
                moves += 1;
                if side_of_cell(board.get(col, row)) == Some(board.to_move) {
                    current |= bit;
                }
            }
        }
        Position {
            current,
            mask,
            moves,
        }
    }

    /// Whether column `col` (0-based) can accept another disc.
    #[must_use]
    pub fn can_play(&self, col: u64) -> bool {
        self.mask & top_mask_col(col) == 0
    }

    /// Whether playing `col` completes a four-in-a-row for the side to move.
    #[must_use]
    pub fn is_winning_move(&self, col: u64) -> bool {
        // The single new bit that a drop in `col` would occupy.
        let new_bit = (self.mask + bottom_mask_col(col)) & column_mask(col);
        alignment(self.current | new_bit)
    }

    /// Play `col` for the side to move (assumes it is legal): the turn passes,
    /// so `current` flips to the other side and `mask` gains the new disc.
    pub fn play(&mut self, col: u64) {
        self.current ^= self.mask;
        self.mask |= self.mask + bottom_mask_col(col);
        self.moves += 1;
    }

    /// A key that uniquely identifies the position (Pons: `current + mask`).
    #[must_use]
    pub fn key(&self) -> u64 {
        self.current + self.mask
    }
}
