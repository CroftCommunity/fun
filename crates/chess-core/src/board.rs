//! The board: a 64-cell mailbox plus the five FEN fields, and FEN itself.
//!
//! Squares are `0..64`, a1 = 0 … h8 = 63 (`rank * 8 + file` — RULES §1). Cells
//! encode per RULES §2: `0` empty, `1..=6` white P N B R Q K, `9..=14` black.
//! `from_fen` is strict about meaning, not just shape (RULES §2): a castling
//! right whose king or rook is not on its home square is an error in the
//! input, not a state this crate will hold.

use thiserror::Error;

/// The standard start position (RULES §2).
pub const START_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/// A side. White moves first and plays toward rank 8 (RULES §1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Color {
    /// The side that moves first.
    White,
    /// The second side.
    Black,
}

impl Color {
    /// The opposing colour.
    #[must_use]
    pub fn other(self) -> Self {
        match self {
            Color::White => Color::Black,
            Color::Black => Color::White,
        }
    }
}

/// A piece kind, in the cell-encoding order of RULES §2.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PieceKind {
    /// Pawn.
    Pawn,
    /// Knight.
    Knight,
    /// Bishop.
    Bishop,
    /// Rook.
    Rook,
    /// Queen.
    Queen,
    /// King.
    King,
}

/// White kingside castling right (`K`).
pub const CASTLE_WK: u8 = 1;
/// White queenside castling right (`Q`).
pub const CASTLE_WQ: u8 = 2;
/// Black kingside castling right (`k`).
pub const CASTLE_BK: u8 = 4;
/// Black queenside castling right (`q`).
pub const CASTLE_BQ: u8 = 8;

/// The cell byte for a piece (RULES §2).
#[must_use]
pub fn cell_of(color: Color, kind: PieceKind) -> u8 {
    let k = kind as u8 + 1;
    match color {
        Color::White => k,
        Color::Black => k | 8,
    }
}

/// The colour standing on a cell byte, or `None` for empty.
#[must_use]
pub fn color_of(cell: u8) -> Option<Color> {
    match cell {
        0 => None,
        c if c & 8 == 0 => Some(Color::White),
        _ => Some(Color::Black),
    }
}

/// The piece kind on a cell byte, or `None` for empty.
#[must_use]
pub fn kind_of(cell: u8) -> Option<PieceKind> {
    match cell & 7 {
        1 => Some(PieceKind::Pawn),
        2 => Some(PieceKind::Knight),
        3 => Some(PieceKind::Bishop),
        4 => Some(PieceKind::Rook),
        5 => Some(PieceKind::Queen),
        6 => Some(PieceKind::King),
        _ => None,
    }
}

/// Why a FEN was rejected (RULES §2 — strict about meaning, never a panic).
#[derive(Debug, Error, PartialEq, Eq)]
pub enum FenError {
    /// Not 4 or 6 whitespace-separated fields.
    #[error("a FEN has six fields, or four with the clocks omitted")]
    Fields,
    /// The placement field does not have exactly eight ranks.
    #[error("the placement field must have exactly eight ranks")]
    Ranks,
    /// A rank's pieces and digits do not sum to eight files.
    #[error("rank {0} does not sum to eight files")]
    RankSum(usize),
    /// A character that is neither a piece letter nor a digit 1-8.
    #[error("invalid placement character {0:?}")]
    Cell(char),
    /// Not exactly one king per side.
    #[error("each side must have exactly one king")]
    Kings,
    /// The side-to-move field is not `w` or `b`.
    #[error("side to move must be 'w' or 'b'")]
    Side,
    /// The castling field has an invalid character or a repeated right.
    #[error("invalid castling field")]
    Castling,
    /// A castling right whose king or rook is not on its home square.
    #[error("castling right {0:?} without king and rook on their home squares")]
    CastlingPlacement(char),
    /// The en-passant field is not `-` or a square on the correct rank.
    #[error("invalid en-passant square for the side to move")]
    EpSquare,
    /// A clock field is not a number.
    #[error("the clock fields must be numeric")]
    Clock,
}

/// A chess position's board state: the mailbox and the five FEN fields.
///
/// This is the *board* half of a position; the repetition history that makes
/// threefold decidable arrives with `Position` in the game module (RULES §11).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Board {
    /// The 64 cells, a1 = index 0 … h8 = index 63 (RULES §1, §2).
    pub cells: [u8; 64],
    /// Whose turn it is.
    pub side: Color,
    /// Castling rights, the four `CASTLE_*` bits.
    pub castling: u8,
    /// The en-passant square behind a just-double-pushed pawn (plain FEN
    /// semantics — recorded capturable or not; RULES §2).
    pub ep: Option<u8>,
    /// Plies since the last pawn move or capture (RULES §11).
    pub halfmove: u16,
    /// Starts at 1, increments after Black moves (RULES §11).
    pub fullmove: u16,
}

impl Board {
    /// The standard start position.
    ///
    /// # Panics
    ///
    /// Never in practice: `START_FEN` is a constant this crate's tests pin.
    #[must_use]
    pub fn start() -> Board {
        Board::from_fen(START_FEN).expect("not possible: START_FEN is pinned by test")
    }

    /// Parse a FEN (six fields, or four with the clocks defaulted to `0 1`).
    /// Strict per RULES §2; an invalid input is an `Err`, never a panic.
    ///
    /// # Errors
    ///
    /// A [`FenError`] naming the malformation — wrong field count, a bad rank,
    /// a castling right whose king or rook is off its home square, an
    /// en-passant square on the wrong rank, a non-numeric clock.
    pub fn from_fen(fen: &str) -> Result<Board, FenError> {
        let fields: Vec<&str> = fen.split_whitespace().collect();
        let (placement, side_field, castling_field, ep_field, halfmove_field, fullmove_field) =
            match fields.as_slice() {
                [placement, side, castling, ep] => (*placement, *side, *castling, *ep, "0", "1"),
                [placement, side, castling, ep, halfmove, fullmove] => {
                    (*placement, *side, *castling, *ep, *halfmove, *fullmove)
                }
                _ => return Err(FenError::Fields),
            };

        let cells = parse_placement(placement)?;

        let side = match side_field {
            "w" => Color::White,
            "b" => Color::Black,
            _ => return Err(FenError::Side),
        };

        let rights = parse_castling(castling_field, &cells)?;

        let ep = match ep_field {
            "-" => None,
            s => {
                let sq = square_from_text(s).ok_or(FenError::EpSquare)?;
                // The square behind the pawn: rank index 5 with White to move
                // (Black just pushed), rank index 2 with Black to move.
                let want_rank = match side {
                    Color::White => 5,
                    Color::Black => 2,
                };
                if sq / 8 != want_rank {
                    return Err(FenError::EpSquare);
                }
                Some(sq)
            }
        };

        let halfmove: u16 = halfmove_field.parse().map_err(|_| FenError::Clock)?;
        let fullmove: u16 = fullmove_field.parse().map_err(|_| FenError::Clock)?;

        Ok(Board {
            cells,
            side,
            castling: rights,
            ep,
            halfmove,
            fullmove,
        })
    }

    /// Print the six-field FEN (RULES §2).
    #[must_use]
    pub fn to_fen(&self) -> String {
        let mut out = String::new();
        for rank in (0..8).rev() {
            let mut empty = 0;
            for file in 0..8 {
                let cell = self.cells[rank * 8 + file];
                if cell == 0 {
                    empty += 1;
                    continue;
                }
                if empty > 0 {
                    out.push_str(&empty.to_string());
                    empty = 0;
                }
                let ch = match kind_of(cell) {
                    Some(PieceKind::Pawn) => 'p',
                    Some(PieceKind::Knight) => 'n',
                    Some(PieceKind::Bishop) => 'b',
                    Some(PieceKind::Rook) => 'r',
                    Some(PieceKind::Queen) => 'q',
                    Some(PieceKind::King) => 'k',
                    None => unreachable!("non-empty cell has a kind"),
                };
                out.push(if color_of(cell) == Some(Color::White) {
                    ch.to_ascii_uppercase()
                } else {
                    ch
                });
            }
            if empty > 0 {
                out.push_str(&empty.to_string());
            }
            if rank > 0 {
                out.push('/');
            }
        }
        out.push(' ');
        out.push(match self.side {
            Color::White => 'w',
            Color::Black => 'b',
        });
        out.push(' ');
        if self.castling == 0 {
            out.push('-');
        } else {
            for (bit, ch) in [
                (CASTLE_WK, 'K'),
                (CASTLE_WQ, 'Q'),
                (CASTLE_BK, 'k'),
                (CASTLE_BQ, 'q'),
            ] {
                if self.castling & bit != 0 {
                    out.push(ch);
                }
            }
        }
        out.push(' ');
        match self.ep {
            None => out.push('-'),
            Some(sq) => out.push_str(&square_text(sq)),
        }
        out.push(' ');
        out.push_str(&self.halfmove.to_string());
        out.push(' ');
        out.push_str(&self.fullmove.to_string());
        out
    }
}

/// Parse the FEN placement field into cells, enforcing eight ranks, exact
/// rank sums, and exactly one king per side (RULES §2).
fn parse_placement(placement: &str) -> Result<[u8; 64], FenError> {
    let ranks: Vec<&str> = placement.split('/').collect();
    if ranks.len() != 8 {
        return Err(FenError::Ranks);
    }
    let mut cells = [0u8; 64];
    let mut kings = [0u32; 2];
    for (i, rank_str) in ranks.iter().enumerate() {
        let rank = 7 - i; // FEN lists rank 8 first
        let mut file = 0usize;
        for ch in rank_str.chars() {
            if let Some(d) = ch.to_digit(10) {
                if !(1..=8).contains(&d) {
                    return Err(FenError::Cell(ch));
                }
                file += d as usize;
            } else {
                let color = if ch.is_ascii_uppercase() {
                    Color::White
                } else {
                    Color::Black
                };
                let kind = match ch.to_ascii_lowercase() {
                    'p' => PieceKind::Pawn,
                    'n' => PieceKind::Knight,
                    'b' => PieceKind::Bishop,
                    'r' => PieceKind::Rook,
                    'q' => PieceKind::Queen,
                    'k' => PieceKind::King,
                    _ => return Err(FenError::Cell(ch)),
                };
                if file >= 8 {
                    return Err(FenError::RankSum(rank + 1));
                }
                if kind == PieceKind::King {
                    kings[usize::from(color == Color::Black)] += 1;
                }
                cells[rank * 8 + file] = cell_of(color, kind);
                file += 1;
            }
        }
        if file != 8 {
            return Err(FenError::RankSum(rank + 1));
        }
    }
    if kings != [1, 1] {
        return Err(FenError::Kings);
    }
    Ok(cells)
}

/// Validate and pack the castling field against the placement (RULES §2, §5):
/// a right whose king or rook is off its home square is a lie in the input.
fn parse_castling(field: &str, cells: &[u8; 64]) -> Result<u8, FenError> {
    if field == "-" {
        return Ok(0);
    }
    let mut rights = 0u8;
    for ch in field.chars() {
        let (bit, king_sq, rook_sq, king, rook) = match ch {
            'K' => (
                CASTLE_WK,
                4,
                7,
                cell_of(Color::White, PieceKind::King),
                cell_of(Color::White, PieceKind::Rook),
            ),
            'Q' => (
                CASTLE_WQ,
                4,
                0,
                cell_of(Color::White, PieceKind::King),
                cell_of(Color::White, PieceKind::Rook),
            ),
            'k' => (
                CASTLE_BK,
                60,
                63,
                cell_of(Color::Black, PieceKind::King),
                cell_of(Color::Black, PieceKind::Rook),
            ),
            'q' => (
                CASTLE_BQ,
                60,
                56,
                cell_of(Color::Black, PieceKind::King),
                cell_of(Color::Black, PieceKind::Rook),
            ),
            _ => return Err(FenError::Castling),
        };
        if rights & bit != 0 {
            return Err(FenError::Castling);
        }
        if cells[king_sq] != king || cells[rook_sq] != rook {
            return Err(FenError::CastlingPlacement(ch));
        }
        rights |= bit;
    }
    Ok(rights)
}

/// `"e4"` for square 28 (RULES §1). Callers pass `0..64`; the rank of a
/// wider value is reduced mod 8 rather than panicking.
#[must_use]
pub fn square_text(sq: u8) -> String {
    let file = char::from(b'a' + sq % 8);
    let rank = char::from(b'1' + (sq / 8) % 8);
    format!("{file}{rank}")
}

/// Square 28 for `"e4"`, or `None` when out of range.
#[must_use]
pub fn square_from_text(s: &str) -> Option<u8> {
    let bytes = s.as_bytes();
    if bytes.len() != 2 {
        return None;
    }
    let file = bytes[0].checked_sub(b'a')?;
    let rank = bytes[1].checked_sub(b'1')?;
    if file > 7 || rank > 7 {
        return None;
    }
    Some(rank * 8 + file)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The six perft reference positions, normalized to six fields (RULES §2;
    /// the published Kiwipete has no clocks, which the four-field arm accepts).
    pub(crate) const PERFT_FENS: [&str; 6] = [
        START_FEN,
        "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
        "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
        "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
        "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
        "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
    ];

    #[test]
    fn the_six_perft_fens_round_trip_exactly() {
        // RULES §2: to_fen(from_fen(s)) == s for any six-field input we accept.
        for fen in PERFT_FENS {
            let board = Board::from_fen(fen).expect("reference FEN parses");
            assert_eq!(board.to_fen(), fen, "round-trip of {fen}");
        }
    }

    #[test]
    fn the_clockless_four_field_form_defaults_the_clocks() {
        // RULES §2: the published Kiwipete FEN has no clocks.
        let four = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -";
        let board = Board::from_fen(four).expect("four-field FEN parses");
        assert_eq!(board.halfmove, 0);
        assert_eq!(board.fullmove, 1);
        assert_eq!(board.to_fen(), format!("{four} 0 1"));
    }

    #[test]
    fn start_is_the_standard_start() {
        let b = Board::start();
        assert_eq!(b.to_fen(), START_FEN);
        assert_eq!(b.side, Color::White);
        assert_eq!(b.castling, CASTLE_WK | CASTLE_WQ | CASTLE_BK | CASTLE_BQ);
        assert_eq!(b.ep, None);
        assert_eq!(b.cells[0], cell_of(Color::White, PieceKind::Rook), "a1");
        assert_eq!(b.cells[4], cell_of(Color::White, PieceKind::King), "e1");
        assert_eq!(b.cells[63], cell_of(Color::Black, PieceKind::Rook), "h8");
    }

    #[test]
    fn malformed_fens_are_errors_never_panics() {
        // RULES §2, each named malformation from the plan.
        let cases: [(&str, FenError); 8] = [
            // seven ranks
            (
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1",
                FenError::Ranks,
            ),
            // a rank summing to nine
            (
                "rnbqkbnr/ppppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                FenError::RankSum(7),
            ),
            // a castling right with no rook on its square (h1 empty)
            (
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN1 w K - 0 1",
                FenError::CastlingPlacement('K'),
            ),
            // zero white kings
            (
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1BNR w - - 0 1",
                FenError::Kings,
            ),
            // two black kings
            (
                "rnbqkbnk/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1",
                FenError::Kings,
            ),
            // a bad side field
            (
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1",
                FenError::Side,
            ),
            // an ep square on the wrong rank for the side to move: e3 would
            // mean WHITE just double-pushed, so it cannot be White's turn
            (
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e3 0 1",
                FenError::EpSquare,
            ),
            // a non-numeric clock
            (
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - x 1",
                FenError::Clock,
            ),
        ];
        for (fen, want) in cases {
            assert_eq!(Board::from_fen(fen), Err(want), "for {fen}");
        }
    }

    #[test]
    fn an_ep_square_is_accepted_on_the_correct_rank() {
        // RULES §2: plain FEN records the square behind any double push.
        let fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
        let board = Board::from_fen(fen).expect("ep FEN parses");
        assert_eq!(board.ep, square_from_text("e3"));
        assert_eq!(board.to_fen(), fen);
    }

    #[test]
    fn square_text_round_trips_the_corners() {
        // RULES §1: a1 = 0, h1 = 7, a8 = 56, h8 = 63.
        for (sq, name) in [(0u8, "a1"), (7, "h1"), (56, "a8"), (63, "h8"), (28, "e4")] {
            assert_eq!(square_text(sq), name);
            assert_eq!(square_from_text(name), Some(sq));
        }
        assert_eq!(square_from_text("i1"), None);
        assert_eq!(square_from_text("a9"), None);
        assert_eq!(square_from_text("e"), None);
    }
}
