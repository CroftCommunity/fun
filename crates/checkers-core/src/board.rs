//! The checkers board: the 32 dark squares, what stands on them, and the
//! geometry that maps a square to its `(row, col)` and back.
//!
//! English draughts is played on the **dark squares only**, so a position is a
//! flat `[u8; 32]` rather than a 64-cell grid — half the state, and the state
//! hash consumes those 32 bytes directly, so it is byte-identical on native and
//! `wasm32`.
//!
//! Squares carry the standard 1–32 draughts numbering. The array is 0-based, so
//! **index `i` is square number `i + 1`** — the `-1`/`+1` lives at the text
//! boundary (`move_to_text` / `parse_move`) and nowhere else. Numbering runs in
//! reading order over the dark squares starting from Black's back rank: row 0
//! holds 1–4, row 7 holds 29–32. Black (Side A) starts on 1–12 and advances
//! toward **increasing** row; White (Side B) starts on 21–32 and advances toward
//! decreasing row. Black moves first, per the rules.
//!
//! A square `(row, col)` is dark when `row + col` is **odd**. That is not an
//! arbitrary parity choice: it is the one that puts square 1 at `(0, 1)`, which
//! is what makes the seven textbook opening moves (9-13, 9-14, 10-14, 10-15,
//! 11-15, 11-16, 12-16) come out right — and getting it backwards is silent, the
//! board simply ignores every piece placed on a light square.

use adversary_core::Side;

/// Board side length (8×8), of which only the dark squares are playable.
pub const SIZE: usize = 8;
/// Playable (dark) squares — the length of a position's cell array.
pub const SQUARES: usize = 32;

/// Whether a piece is a man (moves forward only) or a king (any direction).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Rank {
    /// An uncrowned piece: moves and jumps forward only.
    Man,
    /// A crowned piece: moves and jumps in any diagonal direction, one square at
    /// a time (English draughts kings are **not** flying).
    King,
}

/// A piece on the board: whose it is, and whether it is crowned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Piece {
    /// The owning side.
    pub side: Side,
    /// Man or king.
    pub rank: Rank,
}

impl Piece {
    /// A man of `side`.
    #[must_use]
    pub fn man(side: Side) -> Self {
        Piece {
            side,
            rank: Rank::Man,
        }
    }

    /// A king of `side`.
    #[must_use]
    pub fn king(side: Side) -> Self {
        Piece {
            side,
            rank: Rank::King,
        }
    }
}

/// The byte a piece occupies a square with (`0` is empty). A man = 1, A king = 2,
/// B man = 3, B king = 4 — the encoding the state hash consumes.
#[must_use]
pub fn cell_of(piece: Piece) -> u8 {
    match (piece.side, piece.rank) {
        (Side::A, Rank::Man) => 1,
        (Side::A, Rank::King) => 2,
        (Side::B, Rank::Man) => 3,
        (Side::B, Rank::King) => 4,
    }
}

/// The piece a square byte holds, or `None` for empty / unknown.
#[must_use]
pub fn piece_of_cell(byte: u8) -> Option<Piece> {
    match byte {
        1 => Some(Piece::man(Side::A)),
        2 => Some(Piece::king(Side::A)),
        3 => Some(Piece::man(Side::B)),
        4 => Some(Piece::king(Side::B)),
        _ => None,
    }
}

/// The row a man of `side` is crowned on: Side A advances down the board to row
/// 7, Side B advances up it to row 0.
#[must_use]
pub fn crowning_row(side: Side) -> usize {
    match side {
        Side::A => SIZE - 1,
        Side::B => 0,
    }
}

/// The row delta a man of `side` moves by: `+1` for A, `-1` for B.
#[must_use]
pub fn forward(side: Side) -> isize {
    match side {
        Side::A => 1,
        Side::B => -1,
    }
}

/// The 0-based square index at `(row, col)`, or `None` when the coordinate is off
/// the board or on a light (unplayable) square. Takes `isize` because every
/// caller is walking a diagonal and needs to fall off the edge safely.
#[must_use]
pub fn square_at(row: isize, col: isize) -> Option<u8> {
    let on_board = (0..SIZE as isize).contains(&row) && (0..SIZE as isize).contains(&col);
    if !on_board || (row + col) % 2 == 0 {
        return None;
    }
    Some((row * 4 + col / 2) as u8)
}

/// The `(row, col)` of 0-based square index `square` (which must be `< SQUARES`).
#[must_use]
pub fn row_col(square: u8) -> (usize, usize) {
    let s = (square as usize) % SQUARES;
    let row = s / 4;
    // Even rows carry their dark squares on the odd columns, odd rows on the even
    // ones — the `row + col` odd rule, read the other way round.
    let col = 2 * (s % 4) + usize::from(row.is_multiple_of(2));
    (row, col)
}

/// A checkers position: what stands on each dark square, plus whose turn it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Board {
    /// Square bytes, index `i` = square number `i + 1`. See [`cell_of`].
    pub cells: [u8; SQUARES],
    /// The side to move.
    pub to_move: Side,
}

impl Board {
    /// The standard opening: twelve men a side on the three rows nearest each
    /// player (A on squares 1–12, B on 21–32), with A (Black) to move.
    #[must_use]
    pub fn start() -> Self {
        let mut cells = [0u8; SQUARES];
        for cell in cells.iter_mut().take(12) {
            *cell = cell_of(Piece::man(Side::A));
        }
        for cell in cells.iter_mut().skip(20) {
            *cell = cell_of(Piece::man(Side::B));
        }
        Board {
            cells,
            to_move: Side::A,
        }
    }

    /// An empty board with `to_move` to play — the base for a test fixture.
    #[must_use]
    pub fn empty(to_move: Side) -> Self {
        Board {
            cells: [0u8; SQUARES],
            to_move,
        }
    }

    /// The byte on square index `idx`.
    #[must_use]
    pub fn at(&self, idx: usize) -> u8 {
        self.cells[idx % SQUARES]
    }

    /// The piece on square index `idx`, if any.
    #[must_use]
    pub fn piece_at(&self, idx: usize) -> Option<Piece> {
        piece_of_cell(self.at(idx))
    }

    /// How many pieces (men and kings) `side` has on the board.
    #[must_use]
    pub fn count(&self, side: Side) -> usize {
        self.cells
            .iter()
            .filter_map(|&b| piece_of_cell(b))
            .filter(|p| p.side == side)
            .count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn square_numbering_matches_the_standard_draughts_board() {
        // The anchors that fix the parity: square 1 is (0,1), square 32 is (7,6).
        assert_eq!(square_at(0, 1), Some(0), "square 1");
        assert_eq!(square_at(7, 6), Some(31), "square 32");
        // Row 2 holds squares 9-12 and row 3 holds 13-16 — the rows the seven
        // textbook opening moves run between.
        assert_eq!(square_at(2, 1), Some(8), "square 9");
        assert_eq!(square_at(2, 7), Some(11), "square 12");
        assert_eq!(square_at(3, 0), Some(12), "square 13");
        assert_eq!(square_at(3, 6), Some(15), "square 16");
    }

    #[test]
    fn every_square_round_trips_through_row_col() {
        for s in 0..SQUARES as u8 {
            let (row, col) = row_col(s);
            assert_eq!(
                square_at(row as isize, col as isize),
                Some(s),
                "square index {s} at ({row},{col})"
            );
            assert_eq!((row + col) % 2, 1, "square {s} is a dark square");
        }
    }

    #[test]
    fn light_and_off_board_coordinates_have_no_square() {
        assert_eq!(square_at(0, 0), None, "(0,0) is light");
        assert_eq!(square_at(3, 3), None, "(3,3) is light");
        assert_eq!(square_at(-1, 2), None, "off the top");
        assert_eq!(square_at(8, 1), None, "off the bottom");
        assert_eq!(square_at(2, -1), None, "off the left");
        assert_eq!(square_at(2, 8), None, "off the right");
    }

    #[test]
    fn piece_bytes_round_trip_and_zero_is_empty() {
        for piece in [
            Piece::man(Side::A),
            Piece::king(Side::A),
            Piece::man(Side::B),
            Piece::king(Side::B),
        ] {
            assert_eq!(piece_of_cell(cell_of(piece)), Some(piece));
        }
        assert_eq!(piece_of_cell(0), None, "0 is empty");
        assert_eq!(piece_of_cell(9), None, "unknown byte is not a piece");
    }

    #[test]
    fn start_puts_twelve_men_a_side_on_the_outer_three_rows() {
        let b = Board::start();
        assert_eq!(b.to_move, Side::A, "Black (the darker pieces) moves first");
        assert_eq!(b.count(Side::A), 12);
        assert_eq!(b.count(Side::B), 12);
        assert_eq!(b.piece_at(0), Some(Piece::man(Side::A)), "square 1");
        assert_eq!(b.piece_at(11), Some(Piece::man(Side::A)), "square 12");
        assert_eq!(b.piece_at(31), Some(Piece::man(Side::B)), "square 32");
        for idx in 12..20 {
            assert_eq!(b.at(idx), 0, "the middle two rows start empty");
        }
        // Nobody starts crowned.
        assert!(b.cells.iter().all(|&c| c != 2 && c != 4));
    }

    #[test]
    fn men_advance_toward_their_crowning_row() {
        assert_eq!(forward(Side::A), 1);
        assert_eq!(forward(Side::B), -1);
        assert_eq!(crowning_row(Side::A), 7, "A advances down to row 7");
        assert_eq!(crowning_row(Side::B), 0, "B advances up to row 0");
    }
}
