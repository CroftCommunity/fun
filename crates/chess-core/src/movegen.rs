//! The move code, move generation, legality, and perft.
//!
//! A move is `(from, to, promo)` packed into a 15-bit code (RULES §3).
//! Generation is pseudo-legal + make-and-check (RULES §8): there is no second
//! legality path, so what perft verifies is what the game plays.
//!
//! `legal_moves` returns ascending `(from, to, promo)` order — part of the
//! crate's contract (RULES §13): the difficulty band's tie-breaks and replays
//! read it.

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::board::{
    cell_of, color_of, kind_of, Board, Color, PieceKind, CASTLE_BK, CASTLE_BQ, CASTLE_WK, CASTLE_WQ,
};

/// Bits of the packed code given to each square field.
const SQUARE_BITS: u32 = 6;
/// The largest promotion code (`4` = queen, RULES §3).
const MAX_PROMO: u8 = 4;
/// Mask for one packed square field.
const SQUARE_MASK: u16 = (1 << SQUARE_BITS) - 1;

/// The largest valid packed move code — `promo` 4, `to` 63, `from` 63
/// (RULES §3). Anything above it is rejected at deserialize rather than
/// masked into a different move.
pub const MAX_MOVE_CODE: u16 =
    ((MAX_PROMO as u16) << (SQUARE_BITS * 2)) | (SQUARE_MASK << SQUARE_BITS) | SQUARE_MASK;

/// A move: origin, destination, and the promotion piece code (RULES §3).
///
/// `promo` is `0` for every non-promotion; `1..=4` = N, B, R, Q. Castling is
/// the king's two-square move; en passant is the pawn's diagonal to the empty
/// ep square — neither needs a flag, the position disambiguates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Move {
    /// Origin square, `0..64` (RULES §1).
    pub from: u8,
    /// Destination square, `0..64`.
    pub to: u8,
    /// `0` none; `1..=4` = knight, bishop, rook, queen (RULES §3, §7).
    pub promo: u8,
}

impl Move {
    /// The packed wire code: `from | to << 6 | promo << 12` (RULES §3).
    #[must_use]
    pub fn code(self) -> u16 {
        u16::from(self.from) & SQUARE_MASK
            | (u16::from(self.to) & SQUARE_MASK) << SQUARE_BITS
            | u16::from(self.promo) << (SQUARE_BITS * 2)
    }

    /// The move a packed code names, or `None` when out of range (RULES §3).
    ///
    /// Structural validity only — whether the move is *legal* is a question
    /// about a position, answered by membership in [`legal_moves`].
    #[must_use]
    pub fn from_code(code: u16) -> Option<Self> {
        if code > MAX_MOVE_CODE {
            return None;
        }
        Some(Move {
            from: (code & SQUARE_MASK) as u8,
            to: ((code >> SQUARE_BITS) & SQUARE_MASK) as u8,
            promo: (code >> (SQUARE_BITS * 2)) as u8,
        })
    }

    /// The promotion piece this move creates, if any.
    #[must_use]
    pub fn promo_kind(self) -> Option<PieceKind> {
        match self.promo {
            1 => Some(PieceKind::Knight),
            2 => Some(PieceKind::Bishop),
            3 => Some(PieceKind::Rook),
            4 => Some(PieceKind::Queen),
            _ => None,
        }
    }
}

// A `Move` serializes as its single packed code, so an outcome's move list is
// a plain JSON number array (compact `?r=` shares; the TS side reads numbers,
// not structs). Same shape as checkers' 14-bit code. native == wasm.
impl Serialize for Move {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u16(self.code())
    }
}

impl<'de> Deserialize<'de> for Move {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let code = u16::deserialize(d)?;
        Move::from_code(code)
            .ok_or_else(|| D::Error::custom(format!("invalid chess move code {code}")))
    }
}

/// Is `sq` attacked by any piece of `by`? (RULES §4, §8.)
#[must_use]
pub fn attacked(board: &Board, sq: u8, by: Color) -> bool {
    let file = i32::from(sq % 8);
    let rank = i32::from(sq / 8);
    let at = |f: i32, r: i32| -> u8 {
        if (0..8).contains(&f) && (0..8).contains(&r) {
            board.cells[(r * 8 + f) as usize]
        } else {
            0
        }
    };

    // Pawns attack diagonally forward, so `sq` is attacked from one rank back
    // (from White's side: below).
    let pawn_rank = match by {
        Color::White => rank - 1,
        Color::Black => rank + 1,
    };
    let pawn = cell_of(by, PieceKind::Pawn);
    if at(file - 1, pawn_rank) == pawn || at(file + 1, pawn_rank) == pawn {
        return true;
    }

    let knight = cell_of(by, PieceKind::Knight);
    for (df, dr) in [
        (1, 2),
        (2, 1),
        (2, -1),
        (1, -2),
        (-1, -2),
        (-2, -1),
        (-2, 1),
        (-1, 2),
    ] {
        if at(file + df, rank + dr) == knight {
            return true;
        }
    }

    let king = cell_of(by, PieceKind::King);
    for df in -1..=1 {
        for dr in -1..=1 {
            if (df != 0 || dr != 0) && at(file + df, rank + dr) == king {
                return true;
            }
        }
    }

    let bishop = cell_of(by, PieceKind::Bishop);
    let rook = cell_of(by, PieceKind::Rook);
    let queen = cell_of(by, PieceKind::Queen);
    for (df, dr, hit) in [
        (1, 1, bishop),
        (1, -1, bishop),
        (-1, 1, bishop),
        (-1, -1, bishop),
        (1, 0, rook),
        (-1, 0, rook),
        (0, 1, rook),
        (0, -1, rook),
    ] {
        let (mut f, mut r) = (file + df, rank + dr);
        while (0..8).contains(&f) && (0..8).contains(&r) {
            let cell = at(f, r);
            if cell != 0 {
                if cell == hit || cell == queen {
                    return true;
                }
                break;
            }
            f += df;
            r += dr;
        }
    }
    false
}

/// The square of `color`'s king.
#[must_use]
pub fn king_square(board: &Board, color: Color) -> u8 {
    let king = cell_of(color, PieceKind::King);
    for (i, &cell) in board.cells.iter().enumerate() {
        if cell == king {
            return i as u8;
        }
    }
    // from_fen enforces exactly one king per side, and apply_move never
    // removes one — a kingless board cannot be constructed.
    unreachable!("a board always has both kings (RULES §2)")
}

/// Every pseudo-legal move of the side to move, before the self-check filter.
fn pseudo_legal(board: &Board) -> Vec<Move> {
    let mut out = Vec::with_capacity(48);
    for from in 0..64u8 {
        let cell = board.cells[from as usize];
        if color_of(cell) != Some(board.side) {
            continue;
        }
        match kind_of(cell).expect("not possible: occupied cell has a kind") {
            PieceKind::Pawn => pawn_moves(board, from, &mut out),
            PieceKind::Knight => leaper_moves(board, from, &KNIGHT_DELTAS, &mut out),
            PieceKind::King => {
                leaper_moves(board, from, &KING_DELTAS, &mut out);
                castle_moves(board, from, &mut out);
            }
            PieceKind::Bishop => slider_moves(board, from, &BISHOP_DIRS, &mut out),
            PieceKind::Rook => slider_moves(board, from, &ROOK_DIRS, &mut out),
            PieceKind::Queen => {
                slider_moves(board, from, &BISHOP_DIRS, &mut out);
                slider_moves(board, from, &ROOK_DIRS, &mut out);
            }
        }
    }
    out
}

const KNIGHT_DELTAS: [(i32, i32); 8] = [
    (1, 2),
    (2, 1),
    (2, -1),
    (1, -2),
    (-1, -2),
    (-2, -1),
    (-2, 1),
    (-1, 2),
];
const KING_DELTAS: [(i32, i32); 8] = [
    (1, 1),
    (1, 0),
    (1, -1),
    (0, 1),
    (0, -1),
    (-1, 1),
    (-1, 0),
    (-1, -1),
];
const BISHOP_DIRS: [(i32, i32); 4] = [(1, 1), (1, -1), (-1, 1), (-1, -1)];
const ROOK_DIRS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

/// Pawn pushes, captures, en passant, and promotions (RULES §4, §6, §7).
fn pawn_moves(board: &Board, from: u8, out: &mut Vec<Move>) {
    let us = board.side;
    let (promo_rank, start_rank, dir) = match us {
        Color::White => (7u8, 1u8, 8i32),
        Color::Black => (0u8, 6u8, -8i32),
    };
    let push = |to: u8, out: &mut Vec<Move>| {
        if to / 8 == promo_rank {
            for promo in 1..=MAX_PROMO {
                out.push(Move { from, to, promo });
            }
        } else {
            out.push(Move { from, to, promo: 0 });
        }
    };
    let one = (i32::from(from) + dir) as u8;
    if board.cells[one as usize] == 0 {
        push(one, out);
        if from / 8 == start_rank {
            let two = (i32::from(from) + 2 * dir) as u8;
            if board.cells[two as usize] == 0 {
                out.push(Move {
                    from,
                    to: two,
                    promo: 0,
                });
            }
        }
    }
    let file = i32::from(from % 8);
    for df in [-1i32, 1] {
        if !(0..8).contains(&(file + df)) {
            continue;
        }
        let to = (i32::from(from) + dir + df) as u8;
        if color_of(board.cells[to as usize]) == Some(us.other()) {
            push(to, out);
        } else if board.ep == Some(to) && board.cells[to as usize] == 0 {
            // En passant (RULES §6): only ever on the very next move,
            // because apply_move clears `ep` on every other move.
            out.push(Move { from, to, promo: 0 });
        }
    }
}

/// Single-step moves for the knight and king delta tables (RULES §4).
fn leaper_moves(board: &Board, from: u8, deltas: &[(i32, i32)], out: &mut Vec<Move>) {
    let (file, rank) = (i32::from(from % 8), i32::from(from / 8));
    for &(df, dr) in deltas {
        let (f, r) = (file + df, rank + dr);
        if (0..8).contains(&f) && (0..8).contains(&r) {
            let to = (r * 8 + f) as u8;
            if color_of(board.cells[to as usize]) != Some(board.side) {
                out.push(Move { from, to, promo: 0 });
            }
        }
    }
}

/// Castles (RULES §5). A held right implies king and rook on their home
/// squares: `from_fen` validates it on entry and `apply_move` clears the right
/// the moment either leaves.
fn castle_moves(board: &Board, from: u8, out: &mut Vec<Move>) {
    let us = board.side;
    let (k_bit, q_bit) = match us {
        Color::White => (CASTLE_WK, CASTLE_WQ),
        Color::Black => (CASTLE_BK, CASTLE_BQ),
    };
    let them = us.other();
    if board.castling & k_bit != 0
        && board.cells[from as usize + 1] == 0
        && board.cells[from as usize + 2] == 0
        && !attacked(board, from, them)
        && !attacked(board, from + 1, them)
        && !attacked(board, from + 2, them)
    {
        out.push(Move {
            from,
            to: from + 2,
            promo: 0,
        });
    }
    if board.castling & q_bit != 0
        && board.cells[from as usize - 1] == 0
        && board.cells[from as usize - 2] == 0
        && board.cells[from as usize - 3] == 0
        && !attacked(board, from, them)
        && !attacked(board, from - 1, them)
        && !attacked(board, from - 2, them)
    {
        out.push(Move {
            from,
            to: from - 2,
            promo: 0,
        });
    }
}

/// Sliding moves along `dirs` until blocked (RULES §4).
fn slider_moves(board: &Board, from: u8, dirs: &[(i32, i32)], out: &mut Vec<Move>) {
    let (file, rank) = (i32::from(from % 8), i32::from(from / 8));
    for &(df, dr) in dirs {
        let (mut f, mut r) = (file + df, rank + dr);
        while (0..8).contains(&f) && (0..8).contains(&r) {
            let to = (r * 8 + f) as u8;
            let target = board.cells[to as usize];
            if target == 0 {
                out.push(Move { from, to, promo: 0 });
            } else {
                if color_of(target) == Some(board.side.other()) {
                    out.push(Move { from, to, promo: 0 });
                }
                break;
            }
            f += df;
            r += dr;
        }
    }
}

/// The position after `mv`, which must be pseudo-legal in `board` (RULES §4–§7,
/// §11). Callers pick from [`legal_moves`]; the wasm boundary enforces
/// membership before applying.
///
/// # Panics
///
/// If `mv` does not originate on a piece of the side to move — callers pick
/// from [`legal_moves`], and the wasm boundary rejects a foreign code first.
#[must_use]
pub fn apply_move(board: &Board, mv: Move) -> Board {
    let mut b = *board;
    let from = mv.from as usize;
    let to = mv.to as usize;
    let cell = b.cells[from];
    let us = b.side;
    let kind = kind_of(cell).expect("not possible: a move originates on a piece");
    let captured = b.cells[to];

    // The halfmove clock: reset by a pawn move or a capture (en passant is
    // both), incremented by everything else (RULES §11).
    b.halfmove = if kind == PieceKind::Pawn || captured != 0 {
        0
    } else {
        b.halfmove + 1
    };

    // En passant: the captured pawn stands beside the landing square (RULES §6).
    if kind == PieceKind::Pawn
        && captured == 0
        && Some(mv.to) == board.ep
        && mv.from % 8 != mv.to % 8
    {
        let victim = match us {
            Color::White => to - 8,
            Color::Black => to + 8,
        };
        b.cells[victim] = 0;
    }

    // Castling: the rook crosses to the square the king passed (RULES §5).
    if kind == PieceKind::King && mv.to.abs_diff(mv.from) == 2 {
        let (rook_from, rook_to) = if mv.to > mv.from {
            (from + 3, from + 1)
        } else {
            (from - 4, from - 1)
        };
        b.cells[rook_to] = b.cells[rook_from];
        b.cells[rook_from] = 0;
    }

    b.cells[to] = match mv.promo_kind() {
        Some(promoted) => cell_of(us, promoted),
        None => cell,
    };
    b.cells[from] = 0;

    // Castling rights (RULES §5): a king move clears the mover's pair; touching
    // a rook home square — as origin (the rook left) or destination (whatever
    // stood there was captured) — clears its bit. Clearing an already-clear
    // bit is harmless, so no piece test is needed: a *held* right implies the
    // rook was still at home, which is exactly when from/to hits matter.
    if kind == PieceKind::King {
        b.castling &= match us {
            Color::White => !(CASTLE_WK | CASTLE_WQ),
            Color::Black => !(CASTLE_BK | CASTLE_BQ),
        };
    }
    for sq in [mv.from, mv.to] {
        b.castling &= match sq {
            0 => !CASTLE_WQ,
            7 => !CASTLE_WK,
            56 => !CASTLE_BQ,
            63 => !CASTLE_BK,
            _ => 0xFF,
        };
    }

    // The ep square exists for exactly one reply (RULES §6): set behind a
    // double push, cleared by every other move.
    b.ep = if kind == PieceKind::Pawn && mv.to.abs_diff(mv.from) == 16 {
        Some(mv.from.midpoint(mv.to))
    } else {
        None
    };

    if us == Color::Black {
        b.fullmove += 1;
    }
    b.side = us.other();
    b
}

/// Every legal move of the side to move, ascending `(from, to, promo)`
/// (RULES §8, §13). Empty when the position is terminal.
#[must_use]
pub fn legal_moves(board: &Board) -> Vec<Move> {
    let us = board.side;
    let mut moves: Vec<Move> = pseudo_legal(board)
        .into_iter()
        .filter(|&mv| {
            let after = apply_move(board, mv);
            !attacked(&after, king_square(&after, us), us.other())
        })
        .collect();
    moves.sort_by_key(|m| (m.from, m.to, m.promo));
    moves
}

/// The count of legal move sequences of length `depth` (perft).
#[must_use]
pub fn perft(board: &Board, depth: u32) -> u64 {
    match depth {
        0 => 1,
        1 => legal_moves(board).len() as u64,
        _ => legal_moves(board)
            .iter()
            .map(|&mv| perft(&apply_move(board, mv), depth - 1))
            .sum(),
    }
}

/// Per-first-move perft split — the divergence locator (the plan's Phase 1
/// diagnostics rule: a failing perft names its subtree).
#[must_use]
pub fn divide(board: &Board, depth: u32) -> Vec<(Move, u64)> {
    legal_moves(board)
        .iter()
        .map(|&mv| {
            let n = if depth <= 1 {
                1
            } else {
                perft(&apply_move(board, mv), depth - 1)
            };
            (mv, n)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::square_text;

    // ---- the move code (RULES §3): data gets tests before it is trusted ----

    #[test]
    fn the_move_code_boundary_pairs() {
        // MAX_MOVE_CODE round-trips; one above is rejected (serde boundary
        // pair, the checkers pattern).
        let max = Move::from_code(MAX_MOVE_CODE).expect("MAX_MOVE_CODE is a move");
        assert_eq!(
            max,
            Move {
                from: 63,
                to: 63,
                promo: 4
            }
        );
        assert_eq!(max.code(), MAX_MOVE_CODE);
        assert_eq!(Move::from_code(MAX_MOVE_CODE + 1), None);
        // promo 4 accepted, promo 5 rejected (5 << 12 is the first code past MAX).
        assert_eq!(MAX_MOVE_CODE + 1, 5 << 12);
        // square 63 round-trips; 64 cannot be constructed by any valid code
        // (six bits carry at most 63).
        let e2e4 = Move {
            from: 12,
            to: 28,
            promo: 0,
        };
        assert_eq!(Move::from_code(e2e4.code()), Some(e2e4));
    }

    #[test]
    fn a_move_serializes_as_its_bare_code_and_bad_codes_are_rejected() {
        // RULES §3: a record is a plain JSON number array.
        let mv = Move {
            from: 12,
            to: 28,
            promo: 0,
        };
        assert_eq!(
            serde_json::to_string(&mv).expect("serializes"),
            mv.code().to_string()
        );
        let back: Move = serde_json::from_str(&mv.code().to_string()).expect("deserializes");
        assert_eq!(back, mv);
        assert!(serde_json::from_str::<Move>(&(MAX_MOVE_CODE + 1).to_string()).is_err());
        // A promotion carries its piece through the code (RULES §7).
        let promo = Move {
            from: 52,
            to: 60,
            promo: 4,
        };
        let round: Move = serde_json::from_str(&promo.code().to_string()).expect("promo code");
        assert_eq!(round.promo_kind(), Some(PieceKind::Queen));
    }

    // ---- perft (RULES §4–§8): the aggregate truth ----

    /// The published reference counts (chessprogramming.org "Perft Results",
    /// fetched 2026-08-30; plan → Reasoning). Depths 1..=3 run everywhere;
    /// the CI depths are release-only below.
    const PERFT_SHALLOW: [(&str, [u64; 3]); 6] = [
        (crate::board::START_FEN, [20, 400, 8_902]),
        (
            "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
            [48, 2_039, 97_862],
        ),
        (
            "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
            [14, 191, 2_812],
        ),
        (
            "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
            [6, 264, 9_467],
        ),
        (
            "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
            [44, 1_486, 62_379],
        ),
        (
            "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
            [46, 2_079, 89_890],
        ),
    ];

    /// Assert one perft count; on a mismatch the failure prints the `divide`
    /// split so the divergent first move is in the log.
    fn assert_perft(fen: &str, depth: u32, want: u64) {
        let board = Board::from_fen(fen).expect("reference FEN parses");
        let got = perft(&board, depth);
        if got != want {
            let split: Vec<String> = divide(&board, depth)
                .iter()
                .map(|(mv, n)| {
                    format!(
                        "{}{}{} {n}",
                        square_text(mv.from),
                        square_text(mv.to),
                        match mv.promo {
                            0 => String::new(),
                            p => format!("(p{p})"),
                        }
                    )
                })
                .collect();
            panic!(
                "perft({depth}) of {fen}: got {got}, reference {want}\ndivide:\n{}",
                split.join("\n")
            );
        }
    }

    #[test]
    fn perft_depths_1_to_3_match_the_published_table() {
        for (fen, counts) in PERFT_SHALLOW {
            for (i, &want) in counts.iter().enumerate() {
                assert_perft(fen, i as u32 + 1, want);
            }
        }
    }

    // The CI depths (~16M nodes total): release-only — the repo's recorded
    // mechanism for tests too slow for debug/mutants (CLAUDE.md → mutation
    // testing). The wiring tests of Phase 1.
    #[test]
    #[cfg_attr(debug_assertions, ignore = "release only: ~5M nodes")]
    fn perft_start_depth_5_is_4_865_609() {
        assert_perft(crate::board::START_FEN, 4, 197_281);
        assert_perft(crate::board::START_FEN, 5, 4_865_609);
    }

    #[test]
    #[cfg_attr(debug_assertions, ignore = "release only: ~4M nodes")]
    fn perft_kiwipete_depth_4_is_4_085_603() {
        let fen = PERFT_SHALLOW[1].0;
        assert_perft(fen, 4, 4_085_603);
    }

    #[test]
    #[cfg_attr(debug_assertions, ignore = "release only: ~12M nodes")]
    fn perft_positions_3_to_6_at_ci_depth() {
        assert_perft(PERFT_SHALLOW[2].0, 4, 43_238);
        assert_perft(PERFT_SHALLOW[2].0, 5, 674_624);
        assert_perft(PERFT_SHALLOW[3].0, 4, 422_333);
        assert_perft(PERFT_SHALLOW[4].0, 4, 2_103_487);
        assert_perft(PERFT_SHALLOW[5].0, 4, 3_894_594);
    }

    // The deeper rows, on demand only:
    // `cargo test -p chess-core --release -- --ignored perft_deep`.
    #[test]
    #[ignore = "on demand: ~500M nodes"]
    fn perft_deep_rows() {
        assert_perft(crate::board::START_FEN, 6, 119_060_324);
        assert_perft(PERFT_SHALLOW[1].0, 5, 193_690_690);
        assert_perft(PERFT_SHALLOW[2].0, 6, 11_030_083);
        assert_perft(PERFT_SHALLOW[3].0, 5, 15_833_292);
        assert_perft(PERFT_SHALLOW[4].0, 5, 89_941_194);
        assert_perft(PERFT_SHALLOW[5].0, 5, 164_075_551);
    }

    // ---- the edges perft cannot name (plan Phase 1; each cites RULES) ----

    fn moves_of(fen: &str) -> (Board, Vec<Move>) {
        let board = Board::from_fen(fen).expect("edge FEN parses");
        let moves = legal_moves(&board);
        (board, moves)
    }

    fn has(moves: &[Move], from: &str, to: &str) -> bool {
        let f = crate::board::square_from_text(from).expect("square");
        let t = crate::board::square_from_text(to).expect("square");
        moves.iter().any(|m| m.from == f && m.to == t)
    }

    #[test]
    fn castling_each_bar_removes_exactly_that_wing() {
        // RULES §5, the four temporary bars + the lost right, each alone.
        // Baseline: both castles available.
        let open = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
        let (_, m) = moves_of(open);
        assert!(
            has(&m, "e1", "g1") && has(&m, "e1", "c1"),
            "baseline both castles"
        );

        // The right lost (no K in the field): kingside gone, queenside stays.
        let (_, m) = moves_of("r3k2r/8/8/8/8/8/8/R3K2R w Qkq - 0 1");
        assert!(!has(&m, "e1", "g1") && has(&m, "e1", "c1"), "lost right");

        // A piece on the path: knight b1 blocks queenside only.
        let (_, m) = moves_of("r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1");
        assert!(has(&m, "e1", "g1") && !has(&m, "e1", "c1"), "occupied path");

        // The king in check: both castles barred (the king may still step).
        let (_, m) = moves_of("r3k2r/8/8/8/4r3/8/8/R3K2R w KQkq - 0 1");
        assert!(
            !has(&m, "e1", "g1") && !has(&m, "e1", "c1"),
            "king in check"
        );

        // The crossed square attacked: rook on d8 bars queenside (d1 crossed);
        // kingside stays.
        let (_, m) = moves_of("3rk2r/8/8/8/8/8/8/R3K2R w KQk - 0 1");
        assert!(
            has(&m, "e1", "g1") && !has(&m, "e1", "c1"),
            "crossed square attacked"
        );

        // The landing square attacked: rook on g8 bars kingside (g1 landing);
        // queenside stays.
        let (_, m) = moves_of("r3k1r1/8/8/8/8/8/8/R3K2R w KQq - 0 1");
        assert!(
            !has(&m, "e1", "g1") && has(&m, "e1", "c1"),
            "landing square attacked"
        );

        // The rook's own squares may be attacked (b1 attacked by the b8 rook —
        // the queenside castle stands; only the king's three squares matter).
        let (_, m) = moves_of("1r2k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
        assert!(has(&m, "e1", "c1"), "rook squares may be attacked");
    }

    #[test]
    fn castling_rights_lost_by_exactly_the_three_causes() {
        // RULES §5: king move, that rook's move, that rook captured at home —
        // and nothing else.
        let open = Board::from_fen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1").expect("fen");

        // A king move clears the mover's pair, leaves the opponent's.
        let after = apply_move(
            &open,
            Move {
                from: 4,
                to: 12,
                promo: 0,
            },
        );
        assert_eq!(
            after.castling,
            CASTLE_BK | CASTLE_BQ,
            "king move clears both"
        );

        // The h1 rook's move clears only K.
        let after = apply_move(
            &open,
            Move {
                from: 7,
                to: 15,
                promo: 0,
            },
        );
        assert_eq!(
            after.castling,
            CASTLE_WQ | CASTLE_BK | CASTLE_BQ,
            "rook move clears its wing"
        );

        // A capture ON h8 clears black's k: the a1 rook cannot reach h8 here,
        // so use a bishop that can.
        let b = Board::from_fen("r3k2r/8/8/8/8/8/6B1/R3K2R w KQkq - 0 1").expect("fen");
        let g2 = crate::board::square_from_text("g2").expect("sq");
        let h8 = crate::board::square_from_text("h8").expect("sq");
        let after = apply_move(
            &b,
            Move {
                from: g2,
                to: h8,
                promo: 0,
            },
        );
        assert_eq!(
            after.castling,
            CASTLE_WK | CASTLE_WQ | CASTLE_BQ,
            "capture on the home square clears that wing"
        );

        // A quiet rook move elsewhere clears nothing of the opponent's, and a
        // king stepping out and BACK does not restore anything: the state is
        // the truth, not the squares (RULES §5).
        let after_out = apply_move(
            &open,
            Move {
                from: 4,
                to: 12,
                promo: 0,
            },
        );
        let reply = apply_move(
            &after_out,
            Move {
                from: 60,
                to: 52,
                promo: 0,
            },
        );
        let back = apply_move(
            &reply,
            Move {
                from: 12,
                to: 4,
                promo: 0,
            },
        );
        assert_eq!(
            back.castling & (CASTLE_WK | CASTLE_WQ),
            0,
            "leaving and returning restores nothing"
        );
    }

    #[test]
    fn en_passant_exists_for_exactly_one_move() {
        // RULES §6. After d7d5 beside a white e5 pawn, exd6 e.p. is legal.
        let before = Board::from_fen("4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1").expect("fen");
        let d7 = crate::board::square_from_text("d7").expect("sq");
        let d5 = crate::board::square_from_text("d5").expect("sq");
        let after_push = apply_move(
            &before,
            Move {
                from: d7,
                to: d5,
                promo: 0,
            },
        );
        assert_eq!(
            after_push.ep,
            crate::board::square_from_text("d6"),
            "ep square recorded"
        );
        let m = legal_moves(&after_push);
        assert!(has(&m, "e5", "d6"), "the en-passant capture is offered");

        // The capture removes the d5 pawn, which does not stand on the landing
        // square (RULES §6).
        let e5 = crate::board::square_from_text("e5").expect("sq");
        let d6 = crate::board::square_from_text("d6").expect("sq");
        let taken = apply_move(
            &after_push,
            Move {
                from: e5,
                to: d6,
                promo: 0,
            },
        );
        assert_eq!(taken.cells[d5 as usize], 0, "the victim pawn is gone");

        // One quiet move later the possibility is gone.
        let k_step = apply_move(
            &after_push,
            Move {
                from: 4,
                to: 3,
                promo: 0,
            },
        );
        let reply = apply_move(
            &k_step,
            Move {
                from: 60,
                to: 59,
                promo: 0,
            },
        );
        assert_eq!(reply.ep, None);
        assert!(!has(&legal_moves(&reply), "e5", "d6"), "the chance expired");

        // A double push NOBODY can capture still records its square in FEN
        // (RULES §2 — plain FEN, not X-FEN).
        let lone = Board::from_fen("4k3/3p4/8/8/8/8/8/4K3 b - - 0 1").expect("fen");
        let pushed = apply_move(
            &lone,
            Move {
                from: d7,
                to: d5,
                promo: 0,
            },
        );
        assert!(
            pushed.to_fen().contains(" d6 "),
            "uncapturable ep square still printed"
        );
    }

    #[test]
    fn promotion_yields_exactly_four_moves_and_only_at_the_last_rank() {
        // RULES §7. A lone pawn on the seventh: exactly four pushes, one per
        // piece, and nothing else in the position carries promo != 0.
        let (_, m) = moves_of("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
        let promos: Vec<&Move> = m.iter().filter(|mv| mv.promo != 0).collect();
        assert_eq!(promos.len(), 4, "exactly four promotion moves");
        let mut kinds: Vec<u8> = promos.iter().map(|mv| mv.promo).collect();
        kinds.sort_unstable();
        assert_eq!(
            kinds,
            vec![1, 2, 3, 4],
            "knight, bishop, rook, queen — no fifth option"
        );
        assert!(
            m.iter().all(|mv| mv.promo == 0 || mv.to / 8 == 7),
            "promo only at the last rank"
        );

        // A capture-promotion is offered too (RULES §7: push or capture).
        let (_, m) = moves_of("1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1");
        assert_eq!(
            m.iter().filter(|mv| mv.promo != 0).count(),
            8,
            "push x4 + capture x4"
        );
    }

    #[test]
    fn the_halfmove_clock_counts_what_rules_11_says() {
        // RULES §11: reset by a pawn move, reset by a capture, incremented by
        // a quiet piece move.
        let sq = |s| crate::board::square_from_text(s).expect("square");
        let b = Board::from_fen("4k3/8/8/8/4N3/8/P7/4K3 w - - 7 20").expect("fen");
        assert_eq!(
            apply_move(
                &b,
                Move {
                    from: sq("a2"),
                    to: sq("a3"),
                    promo: 0
                }
            )
            .halfmove,
            0,
            "a pawn move resets"
        );
        assert_eq!(
            apply_move(
                &b,
                Move {
                    from: sq("e4"),
                    to: sq("f6"),
                    promo: 0
                }
            )
            .halfmove,
            8,
            "a quiet piece move increments"
        );
        let cap = Board::from_fen("4k3/8/8/4p3/4R3/8/8/4K3 w - - 7 20").expect("fen");
        assert_eq!(
            apply_move(
                &cap,
                Move {
                    from: sq("e4"),
                    to: sq("e5"),
                    promo: 0
                }
            )
            .halfmove,
            0,
            "a capture resets"
        );
    }

    #[test]
    fn a_pinned_piece_moves_along_the_pin_line_and_not_off_it() {
        // RULES §8. Black bishop a5, white knight c3, white king e1: the
        // knight is pinned on the a5-e1 diagonal, and a knight can never move
        // along a line, so it has no move at all.
        let (_, m) = moves_of("4k3/8/8/b7/8/2N5/8/4K3 w - - 0 1");
        let c3 = crate::board::square_from_text("c3").expect("sq");
        assert!(
            m.iter().all(|mv| mv.from != c3),
            "a knight cannot move along a diagonal pin"
        );

        // A rook pinned on a file may slide along it and not off it.
        let (_, m) = moves_of("4k3/4r3/8/8/8/8/4R3/4K3 w - - 0 1");
        let e2 = crate::board::square_from_text("e2").expect("sq");
        let rook_moves: Vec<&Move> = m.iter().filter(|mv| mv.from == e2).collect();
        assert!(
            !rook_moves.is_empty(),
            "the pinned rook still has file moves"
        );
        assert!(
            rook_moves.iter().all(|mv| mv.to % 8 == 4),
            "every pinned-rook move stays on the e-file"
        );
    }

    #[test]
    fn a_king_may_not_capture_a_defended_piece_and_check_legality_holds() {
        // RULES §8: black knight e2 defended by the black rook e8; the white
        // king on e1 may not take it. (The black king sits on a8, out of play.)
        let (_, m) = moves_of("k3r3/8/8/8/8/8/4n3/4K3 w - - 0 1");
        assert!(
            !has(&m, "e1", "e2"),
            "a defended piece is untouchable by the king"
        );
        // A move that gives check is generated like any other: Rh8+ against
        // the e8 king.
        let (_, m) = moves_of("4k3/8/8/8/8/8/8/4K2R w - - 0 1");
        assert!(has(&m, "h1", "h8"), "a checking move is generated");
        // And a move that steps the mover's own king into an attacked square
        // is never offered.
        let (_, m) = moves_of("k3r3/8/8/8/8/8/8/3K4 w - - 0 1");
        assert!(!has(&m, "d1", "e1"), "stepping into check is not offered");
    }

    #[test]
    fn legal_moves_are_in_ascending_from_to_promo_order() {
        // RULES §13: the order is part of the contract.
        let m = legal_moves(&Board::start());
        let mut sorted = m.clone();
        sorted.sort_by_key(|mv| (mv.from, mv.to, mv.promo));
        assert_eq!(m, sorted);
        assert_eq!(m.len(), 20, "the start position has twenty moves");
    }
}
