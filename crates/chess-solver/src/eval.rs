//! The horizon evaluation — what a position is worth when the search runs out
//! of depth before it runs out of game.
//!
//! Material plus a piece-square nudge per piece, **tapered** between a
//! middlegame and an endgame king table by a 0..24 phase counter derived from
//! remaining non-pawn material. Every constant is an `i32` and every term an
//! integer, so `native == wasm` on the compared path. The tables are this
//! crate's own, hand-set from the standard shapes (knights to the centre,
//! rooks to the seventh, the king castled early and active late) — modest by
//! design: the search provides tactics, the eval only has to point it
//! somewhere reasonable.
//!
//! **No mobility term, on purpose.** A legal-move count costs a full move
//! generation per side per leaf — measured 2026-08-30 as the difference
//! between a 260 s and a ~30 s release suite, and the same factor on every
//! shipped move's latency. Material + tables is the honest cheap eval; if
//! Phase 5's self-play finds it too flat, the lever is a cheaper mobility
//! proxy, not `legal_moves` at the leaves.

use chess_core::board::{color_of, kind_of};
use chess_core::{Board, Color, PieceKind, Position};

/// A proven mate's magnitude — far above any reachable material sum (all the
/// material on the board is under 11,000 centipawns), so a proven terminal
/// always outranks a horizon evaluation. Pinned by test.
pub const MATE: i32 = 1_000_000;

/// Piece values in centipawns.
const VALUE: [i32; 6] = [100, 320, 330, 500, 900, 0];

/// Phase contribution per piece kind (knight/bishop 1, rook 2, queen 4):
/// the full set sums to 24; a bare board to 0. Pinned by test.
const PHASE: [i32; 6] = [0, 1, 1, 2, 4, 0];

// Piece-square tables, **white's perspective, a1 = index 0** (RULES §1 —
// NOT the rank-8-first visual layout published tables use). Black reads the
// same table through the vertical mirror `sq ^ 56`, pinned by test.
#[rustfmt::skip]
const PST_PAWN: [i32; 64] = [
      0,   0,   0,   0,   0,   0,   0,   0,
      2,   4,   4, -10, -10,   4,   4,   2,
      2,  -2,  -4,   0,   0,  -4,  -2,   2,
      0,   0,   0,  12,  12,   0,   0,   0,
      4,   4,   8,  16,  16,   8,   4,   4,
     10,  10,  15,  20,  20,  15,  10,  10,
     30,  30,  30,  30,  30,  30,  30,  30,
      0,   0,   0,   0,   0,   0,   0,   0,
];
#[rustfmt::skip]
const PST_KNIGHT: [i32; 64] = [
    -30, -20, -10, -10, -10, -10, -20, -30,
    -20,  -5,   0,   5,   5,   0,  -5, -20,
    -10,   0,  10,  12,  12,  10,   0, -10,
    -10,   5,  12,  16,  16,  12,   5, -10,
    -10,   5,  12,  16,  16,  12,   5, -10,
    -10,   0,  10,  12,  12,  10,   0, -10,
    -20,  -5,   0,   5,   5,   0,  -5, -20,
    -30, -20, -10, -10, -10, -10, -20, -30,
];
#[rustfmt::skip]
const PST_BISHOP: [i32; 64] = [
    -15,  -8,  -8,  -8,  -8,  -8,  -8, -15,
     -8,   6,   0,   4,   4,   0,   6,  -8,
     -8,   8,   8,   8,   8,   8,   8,  -8,
     -8,   0,   8,  10,  10,   8,   0,  -8,
     -8,   4,   8,  10,  10,   8,   4,  -8,
     -8,   4,   8,   8,   8,   8,   4,  -8,
     -8,   0,   0,   0,   0,   0,   0,  -8,
    -15,  -8,  -8,  -8,  -8,  -8,  -8, -15,
];
#[rustfmt::skip]
const PST_ROOK: [i32; 64] = [
      0,   0,   2,   6,   6,   2,   0,   0,
     -4,   0,   0,   0,   0,   0,   0,  -4,
     -4,   0,   0,   0,   0,   0,   0,  -4,
     -4,   0,   0,   0,   0,   0,   0,  -4,
     -4,   0,   0,   0,   0,   0,   0,  -4,
     -4,   0,   0,   0,   0,   0,   0,  -4,
     10,  12,  12,  12,  12,  12,  12,  10,
      2,   2,   2,   2,   2,   2,   2,   2,
];
#[rustfmt::skip]
const PST_QUEEN: [i32; 64] = [
    -10,  -5,  -5,  -2,  -2,  -5,  -5, -10,
     -5,   0,   2,   2,   2,   2,   0,  -5,
     -5,   2,   4,   4,   4,   4,   2,  -5,
     -2,   2,   4,   6,   6,   4,   2,  -2,
     -2,   2,   4,   6,   6,   4,   2,  -2,
     -5,   2,   4,   4,   4,   4,   2,  -5,
     -5,   0,   2,   2,   2,   2,   0,  -5,
    -10,  -5,  -5,  -2,  -2,  -5,  -5, -10,
];
#[rustfmt::skip]
const PST_KING_MG: [i32; 64] = [
     15,  20,  10,   0,   0,  10,  20,  15,
     10,  10,   0, -10, -10,   0,  10,  10,
    -10, -15, -15, -20, -20, -15, -15, -10,
    -20, -25, -25, -30, -30, -25, -25, -20,
    -30, -35, -35, -40, -40, -35, -35, -30,
    -30, -35, -35, -40, -40, -35, -35, -30,
    -30, -35, -35, -40, -40, -35, -35, -30,
    -30, -35, -35, -40, -40, -35, -35, -30,
];
#[rustfmt::skip]
const PST_KING_EG: [i32; 64] = [
    -30, -20, -15, -10, -10, -15, -20, -30,
    -20,  -8,   0,   5,   5,   0,  -8, -20,
    -15,   0,  10,  15,  15,  10,   0, -15,
    -10,   5,  15,  20,  20,  15,   5, -10,
    -10,   5,  15,  20,  20,  15,   5, -10,
    -15,   0,  10,  15,  15,  10,   0, -15,
    -20,  -8,   0,   5,   5,   0,  -8, -20,
    -30, -20, -15, -10, -10, -15, -20, -30,
];

/// The 0..=24 game-phase counter: full armies read 24, a bare board 0. The
/// king tables blend on it.
#[must_use]
pub fn phase(board: &Board) -> i32 {
    let mut p = 0;
    for &cell in &board.cells {
        if let Some(kind) = kind_of(cell) {
            p += PHASE[kind as usize];
        }
    }
    p.min(24)
}

/// The piece-square nudge for `kind` of `color` on `sq`, at game `phase`.
fn pst(kind: PieceKind, color: Color, sq: u8, phase: i32) -> i32 {
    let idx = usize::from(match color {
        Color::White => sq,
        Color::Black => sq ^ 0b11_1000, // the vertical mirror, sq ^ 56 (RULES §1)
    });
    match kind {
        PieceKind::Pawn => PST_PAWN[idx],
        PieceKind::Knight => PST_KNIGHT[idx],
        PieceKind::Bishop => PST_BISHOP[idx],
        PieceKind::Rook => PST_ROOK[idx],
        PieceKind::Queen => PST_QUEEN[idx],
        PieceKind::King => (PST_KING_MG[idx] * phase + PST_KING_EG[idx] * (24 - phase)) / 24,
    }
}

/// The static value of `pos` from the **side to move's** perspective, in
/// centipawns; higher is better for them.
#[must_use]
pub fn heuristic(pos: &Position) -> i32 {
    let board = &pos.board;
    let me = board.side;
    let ph = phase(board);
    let mut score = 0i32;
    for (sq, &cell) in board.cells.iter().enumerate() {
        let (Some(color), Some(kind)) = (color_of(cell), kind_of(cell)) else {
            continue;
        };
        let sign = if color == me { 1 } else { -1 };
        score += sign * (VALUE[kind as usize] + pst(kind, color, sq as u8, ph));
    }
    score
}

#[cfg(test)]
mod tests {
    use super::*;
    use chess_core::board::square_from_text;
    use chess_core::Board;

    fn board(fen: &str) -> Board {
        Board::from_fen(fen).expect("eval test FEN parses")
    }

    #[test]
    fn every_table_mirrors_exactly_for_black() {
        // The data test written before the tables are trusted: black reads the
        // white table through sq ^ 56, for every kind, square and phase.
        for kind in [
            PieceKind::Pawn,
            PieceKind::Knight,
            PieceKind::Bishop,
            PieceKind::Rook,
            PieceKind::Queen,
            PieceKind::King,
        ] {
            for sq in 0..64u8 {
                for ph in [0, 12, 24] {
                    assert_eq!(
                        pst(kind, Color::Black, sq, ph),
                        pst(kind, Color::White, sq ^ 0b11_1000, ph),
                        "{kind:?} at {sq} phase {ph}"
                    );
                }
            }
        }
    }

    #[test]
    fn a_centre_knight_outscores_a_rim_knight() {
        let centre = square_from_text("d4").expect("sq");
        let rim = square_from_text("a4").expect("sq");
        assert!(
            pst(PieceKind::Knight, Color::White, centre, 24)
                > pst(PieceKind::Knight, Color::White, rim, 24)
        );
    }

    #[test]
    fn mate_outranks_every_material_sum() {
        // 9 queens + 2 rooks + 2 bishops + 2 knights + 8 pawns + every nudge
        // is still far below MATE.
        let max_material = 9 * 900 + 2 * 500 + 2 * 330 + 2 * 320 + 8 * 100 + 64 * 40;
        assert!(
            MATE > 2 * max_material,
            "a proven mate always wins the compare"
        );
    }

    #[test]
    fn phase_reads_24_at_the_start_and_0_bare() {
        assert_eq!(phase(&Board::start()), 24);
        assert_eq!(phase(&board("4k3/8/8/8/8/8/8/4K3 w - - 0 1")), 0);
        // Queens carry the most phase: losing both drops it by 8.
        assert_eq!(
            phase(&board(
                "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1"
            )),
            16
        );
    }

    #[test]
    fn every_table_is_symmetric_across_the_files() {
        // Data-shape contract: every rank reads the same a→h as h→a, on every
        // table — the standard shapes are file-symmetric, and a single sign
        // or value slip in one entry breaks the mirror.
        for table in [
            &PST_PAWN,
            &PST_KNIGHT,
            &PST_BISHOP,
            &PST_ROOK,
            &PST_QUEEN,
            &PST_KING_MG,
            &PST_KING_EG,
        ] {
            for sq in 0..64usize {
                assert_eq!(table[sq], table[sq ^ 7], "entry {sq} vs its file mirror");
            }
        }
    }

    #[test]
    fn the_king_table_tapers_between_its_two_shapes() {
        // phase 24 = the middlegame table exactly, 0 = the endgame table
        // exactly, 12 = their midpoint.
        for sq in 0..64u8 {
            let i = usize::from(sq);
            assert_eq!(pst(PieceKind::King, Color::White, sq, 24), PST_KING_MG[i]);
            assert_eq!(pst(PieceKind::King, Color::White, sq, 0), PST_KING_EG[i]);
            assert_eq!(
                pst(PieceKind::King, Color::White, sq, 12),
                i32::midpoint(PST_KING_MG[i], PST_KING_EG[i])
            );
        }
    }

    #[test]
    fn the_nudge_is_added_to_material_not_subtracted() {
        // Through heuristic() itself: a centre knight outscores a rim knight,
        // so the table enters with the sign its shape means.
        let centre = Position::from_board(board("4k3/7p/8/8/3N4/8/8/4K3 w - - 0 1"));
        let rim = Position::from_board(board("4k3/7p/8/8/N7/8/8/4K3 w - - 0 1"));
        assert!(heuristic(&centre) > heuristic(&rim));
    }

    #[test]
    fn the_start_position_is_level_and_material_dominates() {
        let start = Position::start();
        let v = heuristic(&start);
        assert!(v.abs() <= 30, "the start is near-level, got {v}");
        // A queen up dominates every positional nudge.
        let up = Position::from_board(board("3qk3/8/8/8/8/8/8/3QK2Q w - - 0 1"));
        assert!(heuristic(&up) > 700, "a queen up reads as a queen up");
    }
}
