//! The complete game: [`Position`] (board + repetition history), the terminal
//! rules in their decided order, the [`Adversary`] impl, the verifiable
//! record ([`pond_outcome::Game`]), SAN rendering, and the text bridge.
//!
//! The order of the terminal checks is a rule, not an implementation detail
//! (RULES §10): **checkmate and stalemate first** (a mate on the 100th
//! halfmove is a win, D4d), then the 50-move clock, then insufficient
//! material, then threefold repetition. The repetition history is a
//! fixed-capacity array — an 808-byte memcpy per search node instead of a
//! heap clone — and every hash is defined over the **logical** history (the
//! `len` keys in order), never the container.

use adversary_core::{Adversary, MatchResult, Side};
use sha2::{Digest, Sha256};

use crate::board::{
    cell_of, color_of, kind_of, square_from_text, square_text, Board, Color, PieceKind,
};
use crate::hash::{position_key, Key};
use crate::movegen::{apply_move, attacked, king_square, legal_moves, Move};

/// The repetition history's capacity. The 50-move rule ends any game at
/// halfmove 100, and a fresh reversible run pushes one key per ply plus the
/// key it starts from, so the logical history never exceeds 100 entries
/// before the clock's draw (RULES §11 — pinned by test as an invariant).
pub const HISTORY_CAP: usize = 100;

/// A full position: the board plus the position keys since the last
/// irreversible move (RULES §10, §11).
#[derive(Debug, Clone, Copy)]
pub struct Position {
    /// The board half — cells and the five FEN fields.
    pub board: Board,
    /// Keys since the last irreversible move, oldest first; only
    /// `history[..len]` is meaningful.
    history: [Key; HISTORY_CAP],
    /// How many entries of `history` are live.
    len: u8,
}

impl PartialEq for Position {
    fn eq(&self, other: &Self) -> bool {
        self.board == other.board && self.logical_history() == other.logical_history()
    }
}
impl Eq for Position {}

impl Position {
    /// The standard game start.
    #[must_use]
    pub fn start() -> Position {
        Position::from_board(Board::start())
    }

    /// A position over `board` with a fresh history — the test-and-bridge
    /// constructor (RULES §2): prior repetitions are unknowable from a FEN,
    /// exactly as FIDE treats a resumed position.
    #[must_use]
    pub fn from_board(board: Board) -> Position {
        let mut pos = Position {
            board,
            history: [0; HISTORY_CAP],
            len: 0,
        };
        pos.push_key();
        pos
    }

    /// The live keys, oldest first.
    fn logical_history(&self) -> &[Key] {
        &self.history[..usize::from(self.len)]
    }

    /// Push the current board's key, unless the history is full — which only
    /// happens on the clock's own terminal ply (RULES §11).
    fn push_key(&mut self) {
        if usize::from(self.len) < HISTORY_CAP {
            self.history[usize::from(self.len)] =
                position_key(&self.board, ep_capturable(&self.board));
            self.len += 1;
        }
    }

    /// How many times the current position has occurred (itself included).
    fn occurrences_of_current(&self) -> usize {
        match self.logical_history().last() {
            Some(&current) => self
                .logical_history()
                .iter()
                .filter(|&&k| k == current)
                .count(),
            None => 0,
        }
    }

    /// The position after `mv`, history maintained: an irreversible move — a
    /// pawn move, a capture (the clock resets), or a castling-rights change —
    /// clears the history before the new key is pushed (RULES §11).
    #[must_use]
    pub fn play(&self, mv: Move) -> Position {
        let next_board = apply_move(&self.board, mv);
        let irreversible = next_board.halfmove == 0 || next_board.castling != self.board.castling;
        let mut next = Position {
            board: next_board,
            history: self.history,
            len: if irreversible { 0 } else { self.len },
        };
        next.push_key();
        next
    }
}

/// Is the recorded en-passant capture actually **legal** for the side to move
/// (FIDE 9.2.3.1 — the possibility, not the square; RULES §10)?
#[must_use]
pub fn ep_capturable(board: &Board) -> bool {
    let Some(ep) = board.ep else { return false };
    let us = board.side;
    // The capturer stands beside the pushed pawn: one rank behind the ep
    // square from our direction of travel, file-adjacent.
    let from_rank = match us {
        Color::White => ep / 8 - 1,
        Color::Black => ep / 8 + 1,
    };
    let pawn = cell_of(us, PieceKind::Pawn);
    for df in [-1i32, 1] {
        let file = i32::from(ep % 8) + df;
        if !(0..8).contains(&file) {
            continue;
        }
        let from = from_rank * 8 + file as u8;
        if board.cells[usize::from(from)] != pawn {
            continue;
        }
        // Make-and-check the specific capture: pins can outlaw it.
        let after = apply_move(
            board,
            Move {
                from,
                to: ep,
                promo: 0,
            },
        );
        if !attacked(&after, king_square(&after, us), us.other()) {
            return true;
        }
    }
    false
}

/// The four insufficient-material draws (RULES §10 — the computable subset of
/// the dead-position rule): K v K, K+B v K, K+N v K, and bishops-only with
/// every bishop on one square colour. Everything else stays live.
#[must_use]
pub fn insufficient_material(board: &Board) -> bool {
    let mut knights = 0u32;
    let mut bishop_colours = [false; 2];
    for (sq, &cell) in board.cells.iter().enumerate() {
        match kind_of(cell) {
            None | Some(PieceKind::King) => {}
            Some(PieceKind::Knight) => knights += 1,
            Some(PieceKind::Bishop) => {
                bishop_colours[(sq / 8 + sq % 8) % 2] = true;
            }
            Some(_) => return false, // a pawn, rook or queen can still mate
        }
    }
    let bishops_on_both = bishop_colours[0] && bishop_colours[1];
    match knights {
        0 => !bishops_on_both,
        1 => !bishop_colours[0] && !bishop_colours[1],
        _ => false, // K+N+N v K is not in the subset (RULES §10)
    }
}

/// `Some(result)` when `pos` is terminal (RULES §9, §10) — checkmate and
/// stalemate first, then the clock, insufficient material, threefold.
#[must_use]
pub fn result(pos: &Position) -> Option<MatchResult> {
    let board = &pos.board;
    if legal_moves(board).is_empty() {
        let in_check = attacked(board, king_square(board, board.side), board.side.other());
        return Some(if in_check {
            match board.side {
                Color::White => MatchResult::WinB,
                Color::Black => MatchResult::WinA,
            }
        } else {
            MatchResult::Draw
        });
    }
    if board.halfmove >= 100 {
        return Some(MatchResult::Draw);
    }
    if insufficient_material(board) {
        return Some(MatchResult::Draw);
    }
    if pos.occurrences_of_current() >= 3 {
        return Some(MatchResult::Draw);
    }
    None
}

/// The canonical lowercase-hex SHA-256 of `pos` — the verifiable-outcome
/// anchor. Covers every field of the position **including the logical
/// repetition history** (RULES §11): two boards identical in every FEN field
/// but with different histories have different legal futures, so they are
/// different states. Integer fields little-endian; `native == wasm`.
#[must_use]
pub fn state_hash(pos: &Position) -> String {
    let mut h = Sha256::new();
    h.update(b"chess\x00");
    h.update(pos.board.cells);
    h.update([match pos.board.side {
        Color::White => 1u8,
        Color::Black => 2,
    }]);
    h.update([pos.board.castling]);
    h.update([pos.board.ep.map_or(0xFF, |sq| sq)]);
    h.update(pos.board.halfmove.to_le_bytes());
    h.update(pos.board.fullmove.to_le_bytes());
    h.update([pos.len]);
    for key in pos.logical_history() {
        h.update(key.to_le_bytes());
    }
    hex::encode(h.finalize())
}

/// The marker type carrying the two shared-trait impls, like every shelf core.
pub struct Chess;

impl Adversary for Chess {
    type Position = Position;
    type Move = Move;
    const KIND: &'static str = "chess";

    fn initial(_seed: u64) -> Position {
        // The standard opening. `seed` is reserved for Chess960 (RULES §14);
        // today every seed opens from the standard start.
        Position::start()
    }

    fn side_to_move(pos: &Position) -> Side {
        match pos.board.side {
            Color::White => Side::A,
            Color::Black => Side::B,
        }
    }

    fn legal_moves(pos: &Position) -> Vec<Move> {
        // Empty when terminal (RULES §9, §10): a clock or repetition draw has
        // board-level moves, but the *game* offers none.
        if result(pos).is_some() {
            return Vec::new();
        }
        legal_moves(&pos.board)
    }

    fn apply(pos: &Position, mv: Move) -> Position {
        pos.play(mv)
    }

    fn result(pos: &Position) -> Option<MatchResult> {
        result(pos)
    }

    fn state_hash(pos: &Position) -> String {
        state_hash(pos)
    }

    /// The board from White's side, the FEN, and the move grammar — exactly
    /// this shape, pinned glyph-for-glyph by test (RULES §12).
    fn render_text(pos: &Position) -> String {
        use std::fmt::Write as _;
        let mut s = String::new();
        for rank in (0..8).rev() {
            let _ = write!(s, "{} ", rank + 1);
            for file in 0..8 {
                let cell = pos.board.cells[rank * 8 + file];
                let glyph = match (color_of(cell), kind_of(cell)) {
                    (None, _) | (_, None) => '.',
                    (Some(color), Some(kind)) => {
                        let ch = match kind {
                            PieceKind::Pawn => 'p',
                            PieceKind::Knight => 'n',
                            PieceKind::Bishop => 'b',
                            PieceKind::Rook => 'r',
                            PieceKind::Queen => 'q',
                            PieceKind::King => 'k',
                        };
                        if color == Color::White {
                            ch.to_ascii_uppercase()
                        } else {
                            ch
                        }
                    }
                };
                s.push(glyph);
                if file < 7 {
                    s.push(' ');
                }
            }
            s.push('\n');
        }
        s.push_str("  a b c d e f g h\n");
        let _ = writeln!(s, "FEN: {}", pos.board.to_fen());
        let mover = match pos.board.side {
            Color::White => "White",
            Color::Black => "Black",
        };
        let _ = write!(
            s,
            "To move: {mover}. Moves are long algebraic like e2e4; promote with a letter, e7e8q."
        );
        s
    }

    /// UCI long algebraic: `e2e4`, `e7e8q`, `e1g1` (RULES §12).
    fn move_to_text(mv: Move) -> String {
        let mut s = format!("{}{}", square_text(mv.from), square_text(mv.to));
        if let Some(kind) = mv.promo_kind() {
            s.push(match kind {
                PieceKind::Knight => 'n',
                PieceKind::Bishop => 'b',
                PieceKind::Rook => 'r',
                _ => 'q',
            });
        }
        s
    }

    /// Strict UCI, case-insensitive: an unparseable or illegal move is `None`
    /// (RULES §12) — including a promotion push with no piece letter.
    fn parse_move(pos: &Position, s: &str) -> Option<Move> {
        let text = s.trim().to_ascii_lowercase();
        if !(4..=5).contains(&text.len()) {
            return None;
        }
        let from = square_from_text(text.get(0..2)?)?;
        let to = square_from_text(text.get(2..4)?)?;
        let promo = match text.get(4..5) {
            None => 0,
            Some("n") => 1,
            Some("b") => 2,
            Some("r") => 3,
            Some("q") => 4,
            Some(_) => return None,
        };
        let mv = Move { from, to, promo };
        <Chess as Adversary>::legal_moves(pos)
            .contains(&mv)
            .then_some(mv)
    }
}

impl pond_outcome::Game for Chess {
    type Move = Move;
    const KIND: &'static str = "chess";
    const VERSION: u32 = 1;

    fn replay(seed: u64, moves: &[Move]) -> pond_outcome::Replayed {
        let mut pos = <Chess as Adversary>::initial(seed);
        for (i, &mv) in moves.iter().enumerate() {
            // Stricter than the older cores' silent skip: a move that is not
            // legal HERE — tampered, or appended after the terminal — poisons
            // the replay outright, so verification fails even when the extra
            // move would not have moved the final hash (a move after a clock
            // or repetition draw applies to nothing, and a silent skip would
            // let a padded record verify).
            if <Chess as Adversary>::legal_moves(&pos).contains(&mv) {
                pos = pos.play(mv);
            } else {
                return pond_outcome::Replayed::new(format!("rejected-move-at-{i}"), false);
            }
        }
        let won = matches!(result(&pos), Some(MatchResult::WinA));
        pond_outcome::Replayed::new(state_hash(&pos), won)
    }
}

/// Standard Algebraic Notation for `mv` in `pos` — a **rendering only**,
/// never parsed (RULES §12): disambiguation by file, rank, or both; `x`;
/// `=Q`; `+` / `#`; `O-O` / `O-O-O`.
#[must_use]
pub fn san_of(pos: &Position, mv: Move) -> String {
    let board = &pos.board;
    let moving = kind_of(board.cells[usize::from(mv.from)]);
    let mut s = String::new();

    if moving == Some(PieceKind::King) && mv.to.abs_diff(mv.from) == 2 {
        s.push_str(if mv.to > mv.from { "O-O" } else { "O-O-O" });
    } else {
        let is_ep = moving == Some(PieceKind::Pawn)
            && board.cells[usize::from(mv.to)] == 0
            && mv.from % 8 != mv.to % 8;
        let is_capture = board.cells[usize::from(mv.to)] != 0 || is_ep;
        match moving {
            Some(PieceKind::Pawn) => {
                if is_capture {
                    s.push(char::from(b'a' + mv.from % 8));
                }
            }
            Some(kind) => {
                s.push(match kind {
                    PieceKind::Knight => 'N',
                    PieceKind::Bishop => 'B',
                    PieceKind::Rook => 'R',
                    PieceKind::Queen => 'Q',
                    _ => 'K',
                });
                // Disambiguate against other same-kind pieces that can also
                // legally reach the destination (RULES §12).
                let rivals: Vec<Move> = legal_moves(board)
                    .into_iter()
                    .filter(|m| {
                        m.to == mv.to
                            && m.from != mv.from
                            && kind_of(board.cells[usize::from(m.from)]) == moving
                    })
                    .collect();
                if !rivals.is_empty() {
                    let file_unique = rivals.iter().all(|m| m.from % 8 != mv.from % 8);
                    let rank_unique = rivals.iter().all(|m| m.from / 8 != mv.from / 8);
                    if file_unique {
                        s.push(char::from(b'a' + mv.from % 8));
                    } else if rank_unique {
                        s.push(char::from(b'1' + mv.from / 8));
                    } else {
                        s.push_str(&square_text(mv.from));
                    }
                }
            }
            None => {}
        }
        if is_capture {
            s.push('x');
        }
        s.push_str(&square_text(mv.to));
        if let Some(kind) = mv.promo_kind() {
            s.push('=');
            s.push(match kind {
                PieceKind::Knight => 'N',
                PieceKind::Bishop => 'B',
                PieceKind::Rook => 'R',
                _ => 'Q',
            });
        }
    }

    // Check and mate suffixes, judged on the board after the move.
    let after = apply_move(board, mv);
    let them = after.side;
    if attacked(&after, king_square(&after, them), them.other()) {
        s.push(if legal_moves(&after).is_empty() {
            '#'
        } else {
            '+'
        });
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::START_FEN;

    fn pos_of(fen: &str) -> Position {
        Position::from_board(Board::from_fen(fen).expect("test FEN parses"))
    }

    /// Apply a space-separated UCI move list through the trait, asserting
    /// each move parses and is legal, and return every intermediate result.
    fn walk(mut pos: Position, moves: &str) -> (Position, Vec<Option<MatchResult>>) {
        let mut results = Vec::new();
        for (i, text) in moves.split_whitespace().enumerate() {
            let mv = <Chess as Adversary>::parse_move(&pos, text)
                .unwrap_or_else(|| panic!("ply {}: {text} must be legal", i + 1));
            pos = <Chess as Adversary>::apply(&pos, mv);
            results.push(<Chess as Adversary>::result(&pos));
        }
        (pos, results)
    }

    // ---- the D4 fixtures (Phase 0, validated against a reference engine) ----

    #[test]
    fn d4a_threefold_is_live_at_ply_7_and_draw_at_exactly_ply_8() {
        // RULES §10; D4(a). The start counts as occurrence one.
        let start = pos_of("k7/8/8/8/8/8/8/K6R w - - 0 1");
        let (_, r) = walk(start, "h1h2 a8a7 h2h1 a7a8 h1h2 a8a7 h2h1 a7a8");
        assert_eq!(r[6], None, "live at ply 7");
        assert_eq!(r[7], Some(MatchResult::Draw), "draw at ply 8");
        assert!(r[..7].iter().all(Option::is_none), "and not before");
    }

    #[test]
    fn d4a_prime_a_lost_castling_right_uncounts_the_visual_repetition() {
        // RULES §10 / FIDE 9.2.3.2; D4(a'). The ply-8 lookalike of the start
        // does not count (rights differ); the draw lands at ply 10 via the
        // earliest-seen member of the shuffle cycle — the Phase 0 lesson.
        let start = pos_of("r3k3/8/8/8/8/8/8/4K2R w Kq - 0 1");
        let (_, r) = walk(start, "h1h2 e8d8 h2h1 d8e8 h1h2 e8d8 h2h1 d8e8 h1h2 e8d8");
        assert_eq!(
            r[7], None,
            "the visual repetition at ply 8 is not a third occurrence"
        );
        assert_eq!(r[8], None, "live at ply 9");
        assert_eq!(r[9], Some(MatchResult::Draw), "draw at ply 10");
    }

    #[test]
    fn d4b_an_en_passant_possibility_uncounts_the_first_occurrence() {
        // RULES §10 / FIDE 9.2.3.1; D4(b). The board after ply 1 has a LEGAL
        // ep capture, so its recurrences without one are different positions.
        let start = pos_of("k7/8/8/8/3p4/8/4P3/K7 w - - 0 1");
        let (_, r) = walk(start, "e2e4 a8b8 a1b1 b8a8 b1a1 a8b8 a1b1 b8a8 b1a1 a8b8");
        assert_eq!(
            r[8], None,
            "live at ply 9 — the ply-1 occurrence did not count"
        );
        assert_eq!(r[9], Some(MatchResult::Draw), "draw at ply 10");
    }

    #[test]
    fn d4c_the_clock_draws_at_exactly_100_and_resets_reset_it() {
        // RULES §10, §11; D4(c). Live at clock 99, draw at 100.
        let start = pos_of("k7/p7/8/8/8/8/8/K6R w - - 90 60");
        let (end, r) = walk(start, "h1h2 a8b8 h2h3 b8a8 h3h4 a8b8 h4h5 b8a8 h5h6 a8b8");
        assert_eq!(r[8], None, "live at halfmove 99");
        assert_eq!(r[9], Some(MatchResult::Draw), "draw at halfmove 100");
        assert_eq!(end.board.halfmove, 100);

        // A pawn move at 99 resets to 0 and the game runs on; the history
        // invariant holds throughout (len never exceeds the array).
        let (end, r) = walk(
            start,
            "h1h2 a8b8 h2h3 b8a8 h3h4 a8b8 h4h5 b8a8 h5h6 a7a6 h6h5 a8b7",
        );
        assert_eq!(r[9], None, "the pawn move at 99 resets the clock");
        assert_eq!(r[11], None, "and the game runs on");
        assert_eq!(end.board.halfmove, 2);
        assert!(
            usize::from(end.len) <= HISTORY_CAP,
            "history bound invariant"
        );

        // A capture at 99 resets too.
        let cap = pos_of("k7/8/8/8/8/8/1p6/KR6 w - - 99 60");
        let (end, r) = walk(cap, "b1b2");
        assert_eq!(r[0], None, "the capture at 99 resets");
        assert_eq!(end.board.halfmove, 0);
    }

    #[test]
    fn d4d_checkmate_on_the_100th_halfmove_is_a_win_not_a_draw() {
        // RULES §10; D4(d) — checkmate precedes every draw.
        let start = pos_of("7k/8/6K1/8/8/8/8/R7 w - - 99 60");
        let (end, r) = walk(start, "a1a8");
        assert_eq!(r[0], Some(MatchResult::WinA), "mate outranks the clock");
        assert_eq!(end.board.halfmove, 100);
    }

    // ---- decisive and stale terminals (RULES §9) ----

    #[test]
    fn fools_mate_and_scholars_mate_reach_the_right_winners() {
        let (_, r) = walk(Position::start(), "f2f3 e7e5 g2g4 d8h4");
        assert_eq!(r[3], Some(MatchResult::WinB), "fool's mate: Black wins");

        let (_, r) = walk(Position::start(), "e2e4 e7e5 f1c4 f8c5 d1h5 g8f6 h5f7");
        assert_eq!(r[6], Some(MatchResult::WinA), "scholar's mate: White wins");
    }

    #[test]
    fn stalemate_is_a_draw_and_differs_from_mate_only_by_the_check() {
        // RULES §9: the same "no legal moves" with and without check.
        let stale = pos_of("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
        assert_eq!(result(&stale), Some(MatchResult::Draw), "stalemate");
        let mate = pos_of("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1");
        assert_eq!(
            result(&mate),
            Some(MatchResult::WinA),
            "the checked twin is mate"
        );
    }

    // ---- insufficient material (RULES §10): the four cases and the named
    // non-cases ----

    #[test]
    fn the_insufficient_material_subset_and_its_non_cases() {
        let cases = [
            ("4k3/8/8/8/8/8/8/4K3 w - - 0 1", "K v K"),
            ("4k3/8/8/8/8/8/8/2B1K3 w - - 0 1", "K+B v K"),
            ("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1", "K+N v K"),
            // Bc1 and bf4 both stand on dark squares.
            ("4k3/8/8/8/5b2/8/8/2B1K3 w - - 0 1", "K+B v K+B, one colour"),
        ];
        for (fen, name) in cases {
            assert_eq!(
                result(&pos_of(fen)),
                Some(MatchResult::Draw),
                "{name} is a draw"
            );
        }
        let non_cases = [
            // Bc1 dark, bh3 light: mates exist (help-mates), so live.
            (
                "4k3/8/8/8/8/7b/8/2B1K3 w - - 0 1",
                "K+B v K+B, opposite colours",
            ),
            ("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "K+R v K"),
            ("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", "K+P v K"),
            ("4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1", "K+N+N v K"),
            ("4k3/8/8/8/8/8/8/1NB1K3 w - - 0 1", "K+B+N v K"),
        ];
        for (fen, name) in non_cases {
            assert_eq!(result(&pos_of(fen)), None, "{name} stays live (RULES §10)");
        }
    }

    // ---- promotion through the bridge (RULES §7, §12) ----

    #[test]
    fn promotion_parses_to_each_piece_and_creates_it() {
        for (letter, kind) in [
            ('q', PieceKind::Queen),
            ('r', PieceKind::Rook),
            ('b', PieceKind::Bishop),
            ('n', PieceKind::Knight),
        ] {
            let pos = pos_of("7k/4P3/8/8/8/8/8/4K3 w - - 0 1");
            let mv = <Chess as Adversary>::parse_move(&pos, &format!("e7e8{letter}"))
                .expect("promotion parses");
            let after = <Chess as Adversary>::apply(&pos, mv);
            assert_eq!(
                after.board.cells[usize::from(square_from_text("e8").expect("sq"))],
                cell_of(Color::White, kind),
                "promotes to {kind:?}"
            );
        }
    }

    #[test]
    fn parse_move_is_strict_and_case_insensitive() {
        // RULES §12.
        let pos = pos_of("7k/4P3/8/8/8/8/8/4K3 w - - 0 1");
        let lower = <Chess as Adversary>::parse_move(&pos, "e7e8q");
        let upper = <Chess as Adversary>::parse_move(&pos, "E7E8Q");
        assert!(lower.is_some());
        assert_eq!(lower, upper, "case-insensitive");
        assert_eq!(
            <Chess as Adversary>::parse_move(&pos, "e7e8"),
            None,
            "a promotion push with no piece letter is not a move (RULES §7)"
        );
        let start = Position::start();
        assert_eq!(
            <Chess as Adversary>::parse_move(&start, "e2e5"),
            None,
            "well-formed but illegal"
        );
        assert_eq!(
            <Chess as Adversary>::parse_move(&start, "e2"),
            None,
            "too short"
        );
    }

    // ---- the hash (RULES §11) ----

    #[test]
    fn same_fen_different_history_hashes_differently() {
        let a = pos_of("k7/8/8/8/8/8/8/K6R w - - 4 3");
        // The same board reached by a four-ply shuffle carries a longer
        // logical history — a different state with different legal futures.
        let (b, _) = walk(
            pos_of("k7/8/8/8/8/8/8/K6R w - - 0 1"),
            "h1h2 a8a7 h2h1 a7a8",
        );
        // Align the clocks so ONLY the history differs.
        assert_eq!(a.board.to_fen(), b.board.to_fen(), "identical FEN");
        assert_ne!(state_hash(&a), state_hash(&b), "history is hashed");

        // And two positions with the same logical history are equal and hash
        // equal, however they were produced.
        let (b2, _) = walk(
            pos_of("k7/8/8/8/8/8/8/K6R w - - 0 1"),
            "h1h2 a8a7 h2h1 a7a8",
        );
        assert_eq!(b, b2);
        assert_eq!(state_hash(&b), state_hash(&b2));
    }

    // ---- the delegation pair and render_text (Pass 3 mutation gaps) ----

    #[test]
    fn the_trait_impl_is_live_not_a_stub() {
        assert_eq!(
            <Chess as Adversary>::legal_moves(&Position::start()).len(),
            20
        );
        let mated = pos_of("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1");
        assert!(
            <Chess as Adversary>::legal_moves(&mated).is_empty(),
            "terminal offers nothing"
        );
        assert_eq!(
            <Chess as Adversary>::side_to_move(&Position::start()),
            Side::A
        );
        assert_eq!(
            <Chess as Adversary>::state_hash(&Position::start()),
            state_hash(&Position::start())
        );
    }

    #[test]
    fn render_text_is_pinned_glyph_for_glyph() {
        // RULES §12 — asserted exactly, not by contains.
        let want = "\
8 r n b q k b n r
7 p p p p p p p p
6 . . . . . . . .
5 . . . . . . . .
4 . . . . . . . .
3 . . . . . . . .
2 P P P P P P P P
1 R N B Q K B N R
  a b c d e f g h
FEN: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
To move: White. Moves are long algebraic like e2e4; promote with a letter, e7e8q.";
        assert_eq!(<Chess as Adversary>::render_text(&Position::start()), want);
    }

    // ---- SAN (RULES §12) ----

    fn san(fen: &str, uci: &str) -> String {
        let pos = pos_of(fen);
        let mv = <Chess as Adversary>::parse_move(&pos, uci).expect("SAN test move is legal");
        san_of(&pos, mv)
    }

    #[test]
    fn san_covers_disambiguation_captures_promotion_castles_check_and_mate() {
        // No disambiguation.
        assert_eq!(san(START_FEN, "g1f3"), "Nf3");
        // Three queens reaching f3: by file, by rank, by both.
        // The black king sits on a7, out of every queen's line — with it
        // on a8, Qd5 would already be checking and the position illegal.
        let queens = "8/k7/8/3Q4/8/8/8/K2Q3Q w - - 0 1";
        assert_eq!(san(queens, "h1f3"), "Qhf3", "file disambiguates");
        assert_eq!(san(queens, "d5f3"), "Q5f3", "rank disambiguates");
        assert_eq!(san(queens, "d1f3"), "Qd1f3", "both needed");
        // A capture, a check, castles.
        assert_eq!(san("k7/8/8/3q4/4P3/8/8/K7 w - - 0 1", "e4d5"), "exd5");
        assert_eq!(san("k7/8/8/8/8/8/8/K3R3 w - - 0 1", "e1e8"), "Re8+");
        assert_eq!(san("4k3/8/8/8/8/8/8/4K2R w K - 0 1", "e1g1"), "O-O");
        assert_eq!(san("r3k3/8/8/8/8/8/8/4K3 b q - 0 1", "e8c8"), "O-O-O");
        // En passant renders as a plain pawn capture.
        let start = pos_of("4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1");
        let (after_push, _) = walk(start, "d7d5");
        let ep = <Chess as Adversary>::parse_move(&after_push, "e5d6").expect("ep is legal");
        assert_eq!(san_of(&after_push, ep), "exd6");
        // A capture-promotion mate.
        assert_eq!(
            san("4r1k1/3P2pp/8/8/8/8/8/K7 w - - 0 1", "d7e8q"),
            "dxe8=Q#"
        );
        // Fool's mate ends in a mate suffix.
        let (pos, _) = walk(Position::start(), "f2f3 e7e5 g2g4");
        let mate = <Chess as Adversary>::parse_move(&pos, "d8h4").expect("Qh4# is legal");
        assert_eq!(san_of(&pos, mate), "Qh4#");
    }

    // ---- replay and the verifiable record (the wiring test) ----

    /// A deterministic 60-ply game: from the start, ply `i` plays legal move
    /// `(i * 7 + 3) % len` — reproducible anywhere, terminal-safe.
    fn deterministic_game(plies: usize) -> Vec<Move> {
        let mut pos = <Chess as Adversary>::initial(0);
        let mut moves = Vec::new();
        for i in 0..plies {
            let legal = <Chess as Adversary>::legal_moves(&pos);
            if legal.is_empty() {
                break;
            }
            let mv = legal[(i * 7 + 3) % legal.len()];
            moves.push(mv);
            pos = <Chess as Adversary>::apply(&pos, mv);
        }
        moves
    }

    fn record_of(moves: Vec<Move>) -> pond_outcome::Record<Move> {
        let replayed = <Chess as pond_outcome::Game>::replay(0, &moves);
        pond_outcome::Record {
            kind: "chess".into(),
            seed: 0,
            move_count: moves.len(),
            moves,
            final_hash: replayed.final_hash,
            result: pond_outcome::Outcome::Lost,
            assistance: Some(false),
            score: None,
            stars: None,
        }
    }

    #[test]
    fn a_sixty_ply_game_replays_and_each_tamper_fails_for_its_own_reason() {
        let moves = deterministic_game(60);
        assert_eq!(moves.len(), 60, "the deterministic game reaches 60 plies");
        let record = record_of(moves.clone());
        assert!(
            pond_outcome::verify::<Chess>(&record).ok,
            "the honest record verifies"
        );

        // A tampered move: replace ply 30 with a different legal-looking code.
        let mut tampered = record.clone();
        tampered.moves[30] = Move {
            from: 0,
            to: 63,
            promo: 0,
        };
        let v = pond_outcome::verify::<Chess>(&tampered);
        assert!(!v.ok, "a tampered move fails");
        assert!(
            v.actual.starts_with("rejected-move-at-"),
            "and names its ply"
        );

        // A truncated list diverges the hash.
        let mut truncated = record.clone();
        truncated.moves.truncate(59);
        assert!(
            !pond_outcome::verify::<Chess>(&truncated).ok,
            "a truncated list fails"
        );

        // A move appended after the terminal: fool's mate plus one more.
        let (fools, _) = walk(Position::start(), "f2f3 e7e5 g2g4 d8h4");
        assert!(result(&fools).is_some());
        let mut fools_moves: Vec<Move> = Vec::new();
        {
            let mut pos = Position::start();
            for text in ["f2f3", "e7e5", "g2g4", "d8h4"] {
                let mv = <Chess as Adversary>::parse_move(&pos, text).expect("legal");
                fools_moves.push(mv);
                pos = <Chess as Adversary>::apply(&pos, mv);
            }
        }
        let honest = record_of(fools_moves.clone());
        assert!(pond_outcome::verify::<Chess>(&honest).ok);
        let mut padded = honest.clone();
        padded.moves.push(Move {
            from: 12,
            to: 28,
            promo: 0,
        });
        padded.move_count += 1;
        let v = pond_outcome::verify::<Chess>(&padded);
        assert!(!v.ok, "a move appended after the terminal fails");
        assert_eq!(v.actual, "rejected-move-at-4");
    }

    // ---- the committed xbuild vectors (RULES §11; Phase 3 replays them) ----

    #[derive(serde::Serialize, serde::Deserialize)]
    struct Vector {
        name: String,
        note: String,
        seed: u64,
        moves: Vec<Move>,
        final_state_hash: String,
    }

    fn vectors_dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("vectors")
    }

    #[test]
    fn the_committed_vectors_replay_to_their_recorded_hashes() {
        for file in ["01-full-game.json", "02-threefold.json"] {
            let path = vectors_dir().join(file);
            let text = std::fs::read_to_string(&path).unwrap_or_else(|e| {
                panic!(
                    "{} must exist (regenerate_vectors writes it): {e}",
                    path.display()
                )
            });
            let v: Vector = serde_json::from_str(&text).expect("vector parses");
            let replayed = <Chess as pond_outcome::Game>::replay(v.seed, &v.moves);
            assert_eq!(
                replayed.final_hash, v.final_state_hash,
                "{file} replays to its recorded hash"
            );
        }
        // And the threefold vector really ends in the repetition draw.
        let text = std::fs::read_to_string(vectors_dir().join("02-threefold.json")).expect("read");
        let v: Vector = serde_json::from_str(&text).expect("parse");
        let mut pos = <Chess as Adversary>::initial(v.seed);
        for &mv in &v.moves {
            pos = <Chess as Adversary>::apply(&pos, mv);
        }
        assert_eq!(result(&pos), Some(MatchResult::Draw));
    }

    /// One-shot generator for the committed vectors — run manually:
    /// `cargo test -p chess-core --release regenerate_vectors -- --ignored`.
    #[test]
    #[ignore = "writes crates/chess-core/vectors/*.json; run on demand"]
    fn regenerate_vectors() {
        let full = deterministic_game(60);
        let full_hash = <Chess as pond_outcome::Game>::replay(0, &full).final_hash;
        let knights = "g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8";
        let mut pos = Position::start();
        let mut knight_moves = Vec::new();
        for text in knights.split_whitespace() {
            let mv = <Chess as Adversary>::parse_move(&pos, text).expect("legal");
            knight_moves.push(mv);
            pos = <Chess as Adversary>::apply(&pos, mv);
        }
        assert_eq!(result(&pos), Some(MatchResult::Draw), "threefold at ply 8");
        let knight_hash = <Chess as pond_outcome::Game>::replay(0, &knight_moves).final_hash;
        let vectors = [
            Vector {
                name: "full-game".into(),
                note: "Sixty deterministic plies from the standard start (ply i plays \
                       legal move (i*7+3) % len). Locks generation, application, the \
                       clock and the history fold in one record."
                    .into(),
                seed: 0,
                moves: full,
                final_state_hash: full_hash,
            },
            Vector {
                name: "threefold".into(),
                note: "The knight shuffle: the start position's third occurrence at \
                       ply 8 is the automatic threefold draw (RULES \u{a7}10)."
                    .into(),
                seed: 0,
                moves: knight_moves,
                final_state_hash: knight_hash,
            },
        ];
        for (file, v) in ["01-full-game.json", "02-threefold.json"]
            .iter()
            .zip(&vectors)
        {
            let json = serde_json::to_string_pretty(v).expect("serializes");
            std::fs::write(vectors_dir().join(file), json + "\n").expect("written");
        }
    }
}
