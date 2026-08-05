//! Checkers rules: mandatory capture with multi-jump chains, crowning-terminates,
//! non-flying kings, and the [`Adversary`] impl.
//!
//! The one design decision worth reading before the code is the **move
//! encoding**. A checkers move is not `(from, to)` — a king can reach one square
//! from another by two different capture paths, and a cyclic capture can even
//! return to its origin. Nor is it the chain itself: [`adversary_core::Adversary`]
//! requires `Move: Copy`, which a `Vec` of landings is not. So a move is
//! `(from, to, variant)`, packed into a single 14-bit integer, where `variant`
//! distinguishes chains sharing an origin and a destination. Phase 0 measured the
//! real worst case at **3** such chains over 2.25M positions; four bits are
//! allocated.
//!
//! That keeps a recorded match a plain JSON number array, exactly like Drop 4's
//! columns and Othello's cell indices — which is what lets the shared harness
//! type a move as a number instead of a generic parameter.

use adversary_core::{Adversary, MatchResult, Side};
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::board::{
    cell_of, crowning_row, forward, piece_of_cell, row_col, square_at, Board, Piece, Rank, SIZE,
    SQUARES,
};
use crate::hash::state_hash;

/// Bits of the packed code given to `from` and to `to` (32 squares each).
const SQUARE_BITS: u32 = 5;
/// Bits given to `variant`.
const VARIANT_BITS: u32 = 4;
/// The largest `variant` the code can carry.
const MAX_VARIANT: u8 = (1 << VARIANT_BITS) - 1;
/// Mask for one packed square field.
const SQUARE_MASK: u16 = (1 << SQUARE_BITS) - 1;
/// Mask for the packed variant field.
const VARIANT_MASK: u16 = (1 << VARIANT_BITS) - 1;

/// The largest valid packed move code — `from`, `to` and `variant` all maxed.
/// Anything above it is rejected at deserialize rather than masked into a
/// different move.
pub const MAX_MOVE_CODE: u16 = (1 << (SQUARE_BITS * 2 + VARIANT_BITS)) - 1;

/// Plies of no capture and no man advance after which the game is a draw.
///
/// The standard tournament no-progress rule: **40 moves by each side**. Stated in
/// plies here because that is the unit the counter actually ticks in, and "40
/// moves" versus "80 plies" is exactly where the off-by-one hides.
pub const NO_PROGRESS_LIMIT: u16 = 80;

/// A move: the origin square, the final destination, and the `variant` that
/// disambiguates two capture chains sharing both.
///
/// Squares are **0-based indices** (`0..32`); the 1–32 draughts numbering appears
/// only in [`Adversary::move_to_text`] and [`Adversary::parse_move`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Move {
    /// 0-based origin square index.
    pub from: u8,
    /// 0-based destination square index (the last landing of the chain).
    pub to: u8,
    /// Which of the chains sharing `(from, to)` this is, in generation order.
    /// Simple moves and unambiguous captures are always `0`.
    pub variant: u8,
}

impl Move {
    /// The packed wire code: `from | to << 5 | variant << 10`.
    #[must_use]
    pub fn code(self) -> u16 {
        u16::from(self.from) & SQUARE_MASK
            | (u16::from(self.to) & SQUARE_MASK) << SQUARE_BITS
            | (u16::from(self.variant) & VARIANT_MASK) << (SQUARE_BITS * 2)
    }

    /// The move a packed code names, or `None` when the code is out of range.
    ///
    /// Structural validity only — that the fields fit. Whether the move is
    /// *legal* is a question about a position, and is answered by looking it up
    /// in [`legal_moves`].
    #[must_use]
    pub fn from_code(code: u16) -> Option<Self> {
        if code > MAX_MOVE_CODE {
            return None;
        }
        Some(Move {
            from: (code & SQUARE_MASK) as u8,
            to: ((code >> SQUARE_BITS) & SQUARE_MASK) as u8,
            variant: ((code >> (SQUARE_BITS * 2)) & VARIANT_MASK) as u8,
        })
    }
}

// A `Move` serializes as its single packed code, so an outcome's move list is a
// plain JSON number array (compact `?r=` shares; the TS side reads numbers, not
// structs). Same shape as `othello-core`'s `u8` code. native == wasm.
impl Serialize for Move {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u16(self.code())
    }
}

impl<'de> Deserialize<'de> for Move {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let code = u16::deserialize(d)?;
        Move::from_code(code)
            .ok_or_else(|| D::Error::custom(format!("invalid checkers move code {code}")))
    }
}

/// A generated move with its full path — what [`legal_moves`] derives a [`Move`]
/// from, and what [`apply_move`] replays.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chain {
    /// 0-based origin square index.
    pub from: u8,
    /// 0-based final destination. Always the last entry of `landings`, carried
    /// separately so reading it needs no `Option` handling.
    pub to: u8,
    /// The square landed on after each hop. Length 1 for a simple move.
    pub landings: Vec<u8>,
    /// The squares of the pieces captured, in hop order. Empty for a simple move.
    pub captures: Vec<u8>,
    /// Whether the move crowns the moving man. A king already crowned never
    /// re-crowns, so this is only ever true for a man reaching its king row.
    pub crowned: bool,
}

impl Chain {
    /// Whether this move captures anything.
    #[must_use]
    pub fn is_capture(&self) -> bool {
        !self.captures.is_empty()
    }
}

/// The checkers game marker (zero-sized) the trait impls hang off.
#[derive(Debug, Clone, Copy)]
pub struct Checkers;

/// The four diagonal steps, in a fixed order so generation is deterministic.
const DIRS: [(isize, isize); 4] = [(-1, -1), (-1, 1), (1, -1), (1, 1)];

/// The directions `piece` may move and jump in: a king all four, a man only the
/// two that advance it toward its crowning row.
fn dirs_for(piece: Piece) -> impl Iterator<Item = (isize, isize)> {
    let fwd = forward(piece.side);
    let king = piece.rank == Rank::King;
    DIRS.into_iter().filter(move |&(dr, _)| king || dr == fwd)
}

/// Whether landing on `square` crowns `piece` (a man reaching its king row).
fn crowns(piece: Piece, square: u8) -> bool {
    let (row, _) = row_col(square);
    piece.rank == Rank::Man && row == crowning_row(piece.side)
}

/// Append every simple (non-capturing) step `piece` can make from `from`.
fn simple_moves_from(board: &Board, from: u8, piece: Piece, out: &mut Vec<Chain>) {
    let (row, col) = row_col(from);
    for (dr, dc) in dirs_for(piece) {
        let Some(to) = square_at(row as isize + dr, col as isize + dc) else {
            continue;
        };
        if board.at(to as usize) != 0 {
            continue;
        }
        out.push(Chain {
            from,
            to,
            landings: vec![to],
            captures: Vec::new(),
            crowned: crowns(piece, to),
        });
    }
}

/// Depth-first extension of a capture chain, emitting one [`Chain`] per complete
/// sequence.
///
/// `cells` is scratch: the moving piece has already been lifted off `from`, and
/// each captured piece is removed for the duration of the sub-search and put
/// back on the way out. That removal is what stops a chain jumping the same
/// piece twice — the classic checkers bug, and the reason a lone king ringed by
/// four men has exactly two chains rather than infinitely many.
///
/// Lifting the mover also makes a **cyclic** capture work: the origin reads as
/// empty, so a king can land back where it started. (A landing square can never
/// collide with a captured one — landings sit two rows from the hop's origin and
/// captures one, so they always have opposite row parity.)
fn extend_chain(
    cells: &mut [u8; SQUARES],
    at: u8,
    piece: Piece,
    from: u8,
    landings: &mut Vec<u8>,
    captures: &mut Vec<u8>,
    out: &mut Vec<Chain>,
) {
    let (row, col) = row_col(at);
    let mut jumped = false;

    for (dr, dc) in dirs_for(piece) {
        let Some(over) = square_at(row as isize + dr, col as isize + dc) else {
            continue;
        };
        let Some(victim) = piece_of_cell(cells[over as usize]) else {
            continue;
        };
        if victim.side == piece.side {
            continue;
        }
        let Some(land) = square_at(row as isize + 2 * dr, col as isize + 2 * dc) else {
            continue;
        };
        if cells[land as usize] != 0 {
            continue;
        }

        jumped = true;
        let taken = cells[over as usize];
        cells[over as usize] = 0;
        landings.push(land);
        captures.push(over);

        if crowns(piece, land) {
            // "If a man ... jumps into the kings row, the current move
            // terminates; the piece is crowned as a king but cannot jump back
            // out as in a multi-jump until the next move."
            out.push(Chain {
                from,
                to: land,
                landings: landings.clone(),
                captures: captures.clone(),
                crowned: true,
            });
        } else {
            extend_chain(cells, land, piece, from, landings, captures, out);
        }

        captures.pop();
        landings.pop();
        cells[over as usize] = taken;
    }

    // No jump available from here: the chain is complete. A player may choose
    // which sequence to take but "must make all available jumps in the sequence
    // chosen", so a chain is only emitted where it can go no further.
    if !jumped && !captures.is_empty() {
        out.push(Chain {
            from,
            to: at,
            landings: landings.clone(),
            captures: captures.clone(),
            crowned: false,
        });
    }
}

/// Every move available to the side to move, in generation order: all capture
/// chains if any exist, otherwise all simple moves. Capture is **mandatory**, but
/// the *maximum* capture is not required — every chain is offered, long or short.
fn generate(board: &Board) -> Vec<Chain> {
    let mut captures = Vec::new();
    let mut simple = Vec::new();

    for idx in 0..SQUARES {
        let Some(piece) = board.piece_at(idx) else {
            continue;
        };
        if piece.side != board.to_move {
            continue;
        }
        let from = idx as u8;

        let mut scratch = board.cells;
        scratch[idx] = 0;
        extend_chain(
            &mut scratch,
            from,
            piece,
            from,
            &mut Vec::new(),
            &mut Vec::new(),
            &mut captures,
        );

        if captures.is_empty() {
            simple_moves_from(board, from, piece, &mut simple);
        }
    }

    if captures.is_empty() {
        simple
    } else {
        captures
    }
}

/// Each legal move paired with the chain it names. `variant` is assigned by
/// generation order among the chains sharing a `(from, to)` pair, so it is stable
/// for a given position — which is all the wire format needs, since a code is
/// only ever resolved against the position it was played in.
fn resolved(board: &Board) -> Vec<(Move, Chain)> {
    // A drawn game is over, so it offers no moves — the same way a side with no
    // pieces offers none. This is the single choke point for it, and it reads the
    // counter directly rather than calling `result()`, which would recurse.
    if board.no_progress >= NO_PROGRESS_LIMIT {
        return Vec::new();
    }
    let mut out: Vec<(Move, Chain)> = Vec::new();
    for chain in generate(board) {
        let variant = out
            .iter()
            .filter(|(m, _)| m.from == chain.from && m.to == chain.to)
            .count();
        // Four bits. Phase 0 measured a maximum of 3 chains sharing one
        // `(from, to)` across 2.25M positions, so this is unreachable in play.
        // Dropping the overflow is the safe failure: reusing a code would make
        // `apply_move` play a *different* legal move than the one recorded, which
        // is a silently wrong game rather than a missing option.
        if variant > MAX_VARIANT as usize {
            continue;
        }
        out.push((
            Move {
                from: chain.from,
                to: chain.to,
                variant: variant as u8,
            },
            chain,
        ));
    }
    out
}

/// Every legal move in `board`, with its full path. Empty when terminal.
#[must_use]
pub fn legal_chains(board: &Board) -> Vec<Chain> {
    resolved(board).into_iter().map(|(_, c)| c).collect()
}

/// The legal moves in `board`. Empty when terminal.
#[must_use]
pub fn legal_moves(board: &Board) -> Vec<Move> {
    resolved(board).into_iter().map(|(m, _)| m).collect()
}

/// The chain `mv` names in `board`, or `None` when `mv` is not legal there.
#[must_use]
pub fn chain_for(board: &Board, mv: Move) -> Option<Chain> {
    resolved(board)
        .into_iter()
        .find(|(m, _)| *m == mv)
        .map(|(_, c)| c)
}

/// The position after playing `mv` (assumes `mv` is legal — callers pick from
/// [`legal_moves`]).
///
/// An illegal move returns the position **unchanged** rather than panicking,
/// which is the same shape `othello-core`'s replay relies on: a tampered move
/// list is a no-op that diverges the state hash, so verification fails instead of
/// the core crashing on hostile input.
#[must_use]
pub fn apply_move(board: &Board, mv: Move) -> Board {
    let Some(chain) = chain_for(board, mv) else {
        return *board;
    };
    let Some(piece) = board.piece_at(chain.from as usize) else {
        return *board;
    };

    let mut next = *board;
    next.cells[chain.from as usize] = 0;
    for &captured in &chain.captures {
        next.cells[captured as usize] = 0;
    }
    let rank = if chain.crowned {
        Rank::King
    } else {
        piece.rank
    };
    next.cells[chain.to as usize] = cell_of(Piece {
        side: piece.side,
        rank,
    });
    next.to_move = board.to_move.other();

    // Progress is a capture or a man advance — the two irreversible things that
    // can happen. A man only ever moves toward its king row, so *any* man move is
    // an advance; a king move is not progress, which is precisely the shuffle the
    // draw rule exists to terminate. `saturating_add` because a counter that
    // overflows is a panic, and the core does not panic on its own arithmetic.
    let progress = !chain.captures.is_empty() || piece.rank == Rank::Man;
    next.no_progress = if progress {
        0
    } else {
        board.no_progress.saturating_add(1)
    };
    next
}

/// `Some(result)` when the position is terminal, else `None`.
///
/// Two terminal conditions, checked in this order:
///
/// 1. **The side to move cannot move — it loses.** That covers both endings the
///    rules state, since a side with no pieces left has no moves either.
/// 2. **The no-progress counter has reached [`NO_PROGRESS_LIMIT`] — a draw.**
///
/// The order is the tie-break, and it is deliberate: a side that cannot move has
/// lost by a concrete rule of the game, whereas the no-progress draw is an
/// adjudication for play that would otherwise continue indefinitely. If play has
/// already stopped, it is not continuing indefinitely. Stated here because an
/// undocumented tie-break in a hashed, replay-verified core is exactly the kind of
/// thing that bites two phases later.
///
/// Note it reads `generate` rather than [`legal_moves`], which reports a drawn
/// game as having no moves — going through that would make every draw look like a
/// loss.
#[must_use]
pub fn result(board: &Board) -> Option<MatchResult> {
    if generate(board).is_empty() {
        return Some(MatchResult::win_for(board.to_move.other()));
    }
    if board.no_progress >= NO_PROGRESS_LIMIT {
        return Some(MatchResult::Draw);
    }
    None
}

/// The character a square byte renders as: men lowercase, kings uppercase.
fn glyph(byte: u8) -> char {
    match piece_of_cell(byte) {
        Some(Piece {
            side: Side::A,
            rank: Rank::Man,
        }) => 'b',
        Some(Piece {
            side: Side::A,
            rank: Rank::King,
        }) => 'B',
        Some(Piece {
            side: Side::B,
            rank: Rank::Man,
        }) => 'w',
        Some(Piece {
            side: Side::B,
            rank: Rank::King,
        }) => 'W',
        None => '.',
    }
}

/// Read the digit run starting at `i`, returning its value and the index after it.
fn read_number(bytes: &[u8], mut i: usize) -> (u32, usize) {
    let mut n: u32 = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        n = n
            .saturating_mul(10)
            .saturating_add(u32::from(bytes[i] - b'0'));
        i += 1;
    }
    (n, i)
}

/// The first `N-N` / `NxN` / `NxNxN` run in `s`, as `(origin, final landing)`.
///
/// Scanning for the *pattern* rather than for the first two numbers is what lets
/// "move 3: 11-15" parse as 11-15 instead of 3-11; taking the last number of the
/// run is what lets a player spell a multi-jump out as "6x15x24".
fn parse_notation(text: &str) -> Option<(u32, u32)> {
    let bytes = text.as_bytes();
    let mut scan = 0;
    while scan < bytes.len() {
        if !bytes[scan].is_ascii_digit() {
            scan += 1;
            continue;
        }
        let (first, mut cursor) = read_number(bytes, scan);
        let mut last = first;
        let mut hops = 0;
        while cursor + 1 < bytes.len()
            && matches!(bytes[cursor], b'-' | b'x' | b'X')
            && bytes[cursor + 1].is_ascii_digit()
        {
            let (landing, after) = read_number(bytes, cursor + 1);
            last = landing;
            cursor = after;
            hops += 1;
        }
        if hops > 0 {
            return Some((first, last));
        }
        scan = cursor.max(scan + 1);
    }
    None
}

impl Adversary for Checkers {
    type Position = Board;
    type Move = Move;
    const KIND: &'static str = "checkers";

    fn initial(_seed: u64) -> Board {
        // The standard opening. `seed` is reserved for future start variants;
        // today every seed opens from the twelve-men-a-side setup.
        Board::start()
    }

    fn side_to_move(pos: &Board) -> Side {
        pos.to_move
    }

    fn legal_moves(pos: &Board) -> Vec<Move> {
        legal_moves(pos)
    }

    fn apply(pos: &Board, mv: Move) -> Board {
        apply_move(pos, mv)
    }

    fn result(pos: &Board) -> Option<MatchResult> {
        result(pos)
    }

    fn state_hash(pos: &Board) -> String {
        state_hash(pos)
    }

    /// The board with every square labelled by its draughts number, indented so
    /// the diagonals stay visible — a player naming a move needs both the number
    /// of the square a piece is on and which squares it touches.
    fn render_text(pos: &Board) -> String {
        use std::fmt::Write as _;

        let mut s = String::new();
        for row in 0..SIZE {
            // Even rows carry their dark squares one column to the right; the
            // half-field indent preserves that offset, and with it the diagonals.
            if row.is_multiple_of(2) {
                s.push_str("   ");
            }
            for group in 0..4 {
                let idx = row * 4 + group;
                // Infallible: writing to a String never fails.
                let _ = write!(s, "{:>2}:{} ", idx + 1, glyph(pos.cells[idx]));
            }
            s.push('\n');
        }
        let (mover, colour) = match pos.to_move {
            Side::A => ('b', "black, moving toward 32"),
            Side::B => ('w', "white, moving toward 1"),
        };
        let _ = write!(
            s,
            "To move: {mover} ({colour}). Men are lowercase, kings uppercase.\n\
             Reply with one move like 11-15, or a capture like 11x18. Capture is mandatory."
        );
        s
    }

    /// `11-15` for a step, `11x18` for a capture.
    ///
    /// A hop crosses two rows and a step crosses one, so the separator is derived
    /// rather than carried in the code. Note that the text is **not** unique in
    /// the rare position where two chains share an origin and a destination —
    /// they render identically, and [`Adversary::parse_move`] resolves such a
    /// spelling to the first of them. The wire code stays unambiguous either way.
    fn move_to_text(mv: Move) -> String {
        let (from_row, _) = row_col(mv.from);
        let (to_row, _) = row_col(mv.to);
        let sep = if from_row.abs_diff(to_row) == 1 {
            '-'
        } else {
            'x'
        };
        format!("{}{}{}", u16::from(mv.from) + 1, sep, u16::from(mv.to) + 1)
    }

    fn parse_move(pos: &Board, s: &str) -> Option<Move> {
        let (from, to) = parse_notation(s)?;
        let squares = 1..=SQUARES as u32;
        if !squares.contains(&from) || !squares.contains(&to) {
            return None;
        }
        let (from, to) = ((from - 1) as u8, (to - 1) as u8);
        legal_moves(pos)
            .into_iter()
            .find(|m| m.from == from && m.to == to)
    }
}

impl pond_outcome::Game for Checkers {
    type Move = Move;
    const KIND: &'static str = "checkers";
    const VERSION: u32 = 1;

    fn replay(seed: u64, moves: &[Move]) -> pond_outcome::Replayed {
        let mut pos = <Checkers as Adversary>::initial(seed);
        for &mv in moves {
            // A tampered move is not in `legal_moves`, so it is a no-op and the
            // line diverges from the honest match — verification then fails. Same
            // shape as `othello-core`; the core never trusts a recorded move.
            if legal_moves(&pos).contains(&mv) {
                pos = apply_move(&pos, mv);
            }
        }
        // `won` = Side A (the opening player) won; the shelf game assigns the
        // human a side and interprets accordingly. The harness scores on
        // `result()` directly, not on `won`.
        let won = matches!(
            <Checkers as Adversary>::result(&pos),
            Some(MatchResult::WinA)
        );
        pond_outcome::Replayed::new(state_hash(&pos), won)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::{cell_of, square_at, Piece, Rank};

    /// The square index at `(row, col)`. Every rules fixture below is stated
    /// geometrically, because the rules are geometric and the 1–32 numbering is a
    /// presentation detail on top. This **panics** on a light square rather than
    /// returning `None`: writing a piece to a light square is a silent no-op, and
    /// silently-ignored fixture pieces cost the Phase 0 spike an afternoon.
    fn sq(row: isize, col: isize) -> u8 {
        square_at(row, col).expect("fixture coordinate is a dark square on the board")
    }

    /// A position from `(row, col, piece)` triples, with `to_move` to play.
    fn fixture(to_move: Side, pieces: &[(isize, isize, Piece)]) -> Board {
        let mut board = Board::empty(to_move);
        for &(row, col, piece) in pieces {
            board.cells[sq(row, col) as usize] = cell_of(piece);
        }
        board
    }

    /// The legal moves in draughts notation, sorted — what a rules source states.
    fn texts(board: &Board) -> Vec<String> {
        let mut t: Vec<String> = legal_moves(board)
            .into_iter()
            .map(<Checkers as Adversary>::move_to_text)
            .collect();
        t.sort();
        t
    }

    #[test]
    fn the_opening_position_has_the_seven_textbook_moves_for_black() {
        let pos = <Checkers as Adversary>::initial(0);
        assert_eq!(<Checkers as Adversary>::side_to_move(&pos), Side::A);
        // The seven standard opening moves of English draughts. If the dark-square
        // parity or the numbering direction is wrong, this list comes out wrong —
        // which is exactly why it is the first fixture.
        assert_eq!(
            texts(&pos),
            vec!["10-14", "10-15", "11-15", "11-16", "12-16", "9-13", "9-14"],
        );
        assert_eq!(result(&pos), None, "the opening is not terminal");
        assert!(
            legal_chains(&pos).iter().all(|c| c.captures.is_empty()),
            "no captures at the opening"
        );
    }

    #[test]
    fn capture_is_mandatory_and_a_position_without_one_offers_its_simple_moves() {
        // A man on 9 can take the B man on 14 and land on 18. A also has a man on
        // 12 whose simple move to 16 is free — mandatory capture must suppress it.
        let with_capture = fixture(
            Side::A,
            &[
                (2, 1, Piece::man(Side::A)),
                (2, 7, Piece::man(Side::A)),
                (3, 2, Piece::man(Side::B)),
            ],
        );
        assert_eq!(
            texts(&with_capture),
            vec!["9x18"],
            "the free simple move is suppressed"
        );

        // The other side of the branch: move the B man out of reach and the same
        // A men offer their three simple moves. Without this, an implementation
        // that only ever returns captures passes the assertion above.
        let no_capture = fixture(
            Side::A,
            &[
                (2, 1, Piece::man(Side::A)),
                (2, 7, Piece::man(Side::A)),
                (5, 2, Piece::man(Side::B)),
            ],
        );
        assert_eq!(texts(&no_capture), vec!["12-16", "9-13", "9-14"]);
        assert!(
            legal_chains(&no_capture)
                .iter()
                .all(|c| c.captures.is_empty() && c.landings.len() == 1),
            "a simple move is a single hop that captures nothing"
        );
    }

    #[test]
    fn a_double_jump_is_one_move_with_two_landings() {
        // 6 takes 10 (landing 15) and then 19 (landing 24) — one move, two hops.
        let pos = fixture(
            Side::A,
            &[
                (1, 2, Piece::man(Side::A)),
                (2, 3, Piece::man(Side::B)),
                (4, 5, Piece::man(Side::B)),
            ],
        );
        let chains = legal_chains(&pos);
        assert_eq!(chains.len(), 1, "the chain must be completed, not split");
        let chain = &chains[0];
        assert_eq!(chain.from, sq(1, 2));
        assert_eq!(chain.landings, vec![sq(3, 4), sq(5, 6)], "two landings");
        assert_eq!(chain.captures, vec![sq(2, 3), sq(4, 5)]);
        assert_eq!(chain.to, sq(5, 6));
        assert!(!chain.crowned, "row 5 is not Black's king row");
        assert_eq!(texts(&pos), vec!["6x24"]);

        let after = apply_move(&pos, legal_moves(&pos)[0]);
        assert_eq!(after.count(Side::B), 0, "both men are taken");
        assert_eq!(
            after.piece_at(sq(5, 6) as usize),
            Some(Piece::man(Side::A)),
            "still a man"
        );
        assert_eq!(after.to_move, Side::B, "the turn passes");
    }

    #[test]
    fn crowning_terminates_the_move_but_a_landing_short_of_the_king_row_does_not() {
        // Crowning case: 22 takes 26 and lands on 31 — Black's king row. A further
        // jump (over 27, landing on 24) is geometrically available and would be
        // taken by a king, so this fixture fails unless crowning really stops the
        // chain.
        let crowns = fixture(
            Side::A,
            &[
                (5, 2, Piece::man(Side::A)),
                (6, 3, Piece::man(Side::B)),
                (6, 5, Piece::man(Side::B)),
            ],
        );
        let chains = legal_chains(&crowns);
        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].captures, vec![sq(6, 3)], "one capture, then stop");
        assert_eq!(chains[0].to, sq(7, 4));
        assert!(chains[0].crowned);

        let after = apply_move(&crowns, legal_moves(&crowns)[0]);
        assert_eq!(
            after.piece_at(sq(7, 4) as usize),
            Some(Piece::king(Side::A)),
            "the man is crowned"
        );
        assert_eq!(after.count(Side::B), 1, "the second man survives the turn");

        // The other side of the branch: the same shape one rank higher, so the
        // first landing (row 5) is *not* the king row and the chain continues into
        // it. Without this, "terminate after the first jump" passes the case above.
        let continues = fixture(
            Side::A,
            &[
                (3, 2, Piece::man(Side::A)),
                (4, 3, Piece::man(Side::B)),
                (6, 5, Piece::man(Side::B)),
            ],
        );
        let chains = legal_chains(&continues);
        assert_eq!(chains.len(), 1);
        assert_eq!(
            chains[0].captures,
            vec![sq(4, 3), sq(6, 5)],
            "the chain runs on through row 5"
        );
        assert_eq!(chains[0].to, sq(7, 6));
        assert!(chains[0].crowned, "and crowns at the end of it");
    }

    #[test]
    fn a_king_jumps_backwards_and_a_man_may_not() {
        let pieces = |rank: Rank| {
            [
                (
                    4,
                    3,
                    Piece {
                        side: Side::A,
                        rank,
                    },
                ),
                (3, 2, Piece::man(Side::B)),
            ]
        };

        // A king on 18 takes backwards over 14 onto 9.
        let king = fixture(Side::A, &pieces(Rank::King));
        assert_eq!(texts(&king), vec!["18x9"]);

        // The same geometry with a man: the jump is behind it, so there is no
        // capture at all and its two simple forward moves stand. The direction
        // constraint is a branch, and this is its other side.
        let man = fixture(Side::A, &pieces(Rank::Man));
        assert_eq!(texts(&man), vec!["18-22", "18-23"]);
        assert!(
            legal_chains(&man).iter().all(|c| c.captures.is_empty()),
            "a man cannot jump backwards"
        );
    }

    #[test]
    fn two_chains_sharing_an_origin_and_destination_get_distinct_variants() {
        // The worst case the `variant` field exists for, and the one option (C)
        // was rejected over: a lone king ringed by four men can circle the ring
        // clockwise or anticlockwise, capturing all four either way and returning
        // to the square it started on. Both are legal; `(from, to)` alone names
        // neither. It doubles as the no-double-capture guard — without removing
        // captured men as the chain runs, the king could re-jump the first man and
        // circle forever.
        let pos = fixture(
            Side::A,
            &[
                (4, 3, Piece::king(Side::A)),
                (3, 2, Piece::man(Side::B)),
                (1, 2, Piece::man(Side::B)),
                (1, 4, Piece::man(Side::B)),
                (3, 4, Piece::man(Side::B)),
            ],
        );
        let origin = sq(4, 3);
        let chains = legal_chains(&pos);
        assert_eq!(chains.len(), 2, "clockwise and anticlockwise");
        for chain in &chains {
            assert_eq!((chain.from, chain.to), (origin, origin), "a cyclic capture");
            assert_eq!(chain.captures.len(), 4, "all four men, exactly once each");
            let mut seen = chain.captures.clone();
            seen.sort_unstable();
            seen.dedup();
            assert_eq!(seen.len(), 4, "no man is captured twice");
        }
        assert_ne!(
            chains[0].captures, chains[1].captures,
            "the two chains run the ring in opposite orders"
        );

        let moves = legal_moves(&pos);
        assert_eq!(moves.len(), 2);
        assert_eq!(moves[0].variant, 0);
        assert_eq!(moves[1].variant, 1);
        assert_ne!(
            moves[0].code(),
            moves[1].code(),
            "distinct variants are distinct wire codes"
        );

        // Both are playable, and both leave White with nothing — which is a loss.
        for mv in moves {
            let after = apply_move(&pos, mv);
            assert_eq!(after.count(Side::B), 0);
            assert_eq!(
                after.piece_at(origin as usize),
                Some(Piece::king(Side::A)),
                "the king ends where it began"
            );
            assert_eq!(result(&after), Some(MatchResult::WinA));
        }
    }

    #[test]
    fn a_side_with_no_legal_move_loses_even_holding_pieces() {
        // A man on 1 with both its forward squares occupied and the jump over 6
        // blocked by the man on 10. It still has a piece; it has nowhere to go.
        let blocked = fixture(
            Side::A,
            &[
                (0, 1, Piece::man(Side::A)),
                (1, 0, Piece::man(Side::B)),
                (1, 2, Piece::man(Side::B)),
                (2, 3, Piece::man(Side::B)),
            ],
        );
        assert!(legal_moves(&blocked).is_empty());
        assert_eq!(result(&blocked), Some(MatchResult::WinB));

        // Unblock the landing square and the jump reappears — so the position
        // above is terminal because of the blockade, not because `result` says
        // everything is terminal.
        let mut open = blocked;
        open.cells[sq(2, 3) as usize] = 0;
        assert_eq!(texts(&open), vec!["1x10"]);
        assert_eq!(result(&open), None);
    }

    #[test]
    fn the_wire_code_packs_from_to_and_variant_into_one_number() {
        // A move is a 14-bit code: from | to << 5 | variant << 10. The `?r=` share
        // is a plain JSON number array, like every other game on the shelf.
        let mv = Move {
            from: 8,
            to: 12,
            variant: 0,
        };
        assert_eq!(mv.code(), 8 + (12 << 5));
        assert_eq!(serde_json::to_string(&mv).unwrap(), "392");
        assert_eq!(serde_json::from_str::<Move>("392").unwrap(), mv);

        // The boundary pair, not an arbitrary large number: the largest code that
        // decodes to a structurally valid move is accepted, and the next one is
        // rejected rather than silently truncated into a different move.
        let max = Move {
            from: 31,
            to: 31,
            variant: 15,
        };
        assert_eq!(max.code(), MAX_MOVE_CODE);
        assert_eq!(
            serde_json::from_str::<Move>(&MAX_MOVE_CODE.to_string()).unwrap(),
            max
        );
        assert!(
            serde_json::from_str::<Move>(&(MAX_MOVE_CODE + 1).to_string()).is_err(),
            "an out-of-range code is rejected, not masked"
        );

        // Every code in range round-trips through the packing.
        for code in 0..=MAX_MOVE_CODE {
            let decoded = Move::from_code(code).expect("in range");
            assert_eq!(decoded.code(), code);
        }
    }

    #[test]
    fn the_text_bridge_speaks_draughts_notation_both_ways() {
        let pos = <Checkers as Adversary>::initial(0);
        let rendered = <Checkers as Adversary>::render_text(&pos);
        assert!(rendered.contains("11"), "square numbers are shown");
        assert!(rendered.contains("11-15"), "and how to name a move");

        assert_eq!(
            <Checkers as Adversary>::parse_move(&pos, "11-15"),
            Some(Move {
                from: 10,
                to: 14,
                variant: 0
            })
        );
        assert_eq!(
            <Checkers as Adversary>::parse_move(&pos, "I'll play 11-15."),
            Some(Move {
                from: 10,
                to: 14,
                variant: 0
            }),
            "prose around the move is tolerated"
        );
        assert_eq!(
            <Checkers as Adversary>::parse_move(&pos, "move 3: 11-15"),
            Some(Move {
                from: 10,
                to: 14,
                variant: 0
            }),
            "a leading number that is not part of the notation is skipped"
        );
        assert_eq!(
            <Checkers as Adversary>::parse_move(&pos, "11-19"),
            None,
            "an illegal move is refused, not coerced"
        );
        assert_eq!(<Checkers as Adversary>::parse_move(&pos, "40-44"), None);
        assert_eq!(<Checkers as Adversary>::parse_move(&pos, "no idea"), None);

        // A multi-jump names its landings; the origin and the final square are
        // what identify it.
        let jump = fixture(
            Side::A,
            &[
                (1, 2, Piece::man(Side::A)),
                (2, 3, Piece::man(Side::B)),
                (4, 5, Piece::man(Side::B)),
            ],
        );
        assert_eq!(
            <Checkers as Adversary>::parse_move(&jump, "6x15x24"),
            Some(legal_moves(&jump)[0]),
            "intermediate landings are accepted"
        );
    }

    #[test]
    fn the_state_hash_moves_with_the_position() {
        let pos = <Checkers as Adversary>::initial(0);
        assert_eq!(
            <Checkers as Adversary>::state_hash(&pos),
            <Checkers as Adversary>::state_hash(&Board::start())
        );
        let after = apply_move(&pos, legal_moves(&pos)[0]);
        assert_ne!(
            <Checkers as Adversary>::state_hash(&pos),
            <Checkers as Adversary>::state_hash(&after)
        );
    }

    /// Play to a terminal position, picking each move with a seeded LCG so the
    /// line is fixed but not degenerate.
    ///
    /// **Why not "always the first legal move".** That was the obvious
    /// deterministic policy and it does not terminate: measured here, it runs past
    /// 200,000 plies without ending, because both sides settle into a king shuffle
    /// and English draughts as codified has no move-count draw rule. That is not a
    /// bug in this fixture — it is the concrete demonstration of the gap Phase 5's
    /// no-progress rule closes, and until it lands a checkers game can genuinely
    /// fail to terminate.
    fn seeded_game(seed: u64, cap: usize) -> (Vec<Move>, Board) {
        let mut pos = <Checkers as Adversary>::initial(seed);
        let mut rng = seed ^ 0x9E37_79B9_7F4A_7C15;
        let mut played = Vec::new();
        while result(&pos).is_none() {
            let moves = legal_moves(&pos);
            assert!(!moves.is_empty(), "a live position has moves");
            rng = rng
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            let mv = moves[(rng >> 33) as usize % moves.len()];
            played.push(mv);
            pos = apply_move(&pos, mv);
            assert!(
                played.len() <= cap,
                "seed {seed} did not terminate within {cap} plies"
            );
        }
        (played, pos)
    }

    #[test]
    fn a_full_game_plays_to_a_terminal_result() {
        // The wiring test: `legal_moves` -> `apply` -> `result` compose into a
        // game that ends. (Termination *in general* is what Phase 5's no-progress
        // draw rule buys; this asserts it for concrete lines.)
        for seed in 0..8 {
            let (moves, terminal) = seeded_game(seed, 1_000);
            assert!(moves.len() > 20, "not a two-move stalemate");
            assert!(
                legal_moves(&terminal).is_empty(),
                "terminal means no moves for the side to play"
            );
            // A game ends one of exactly two ways: a side runs out of moves and so
            // is the loser, or the no-progress counter reaches the draw.
            match result(&terminal) {
                Some(MatchResult::Draw) => {
                    assert!(terminal.no_progress >= NO_PROGRESS_LIMIT);
                }
                Some(decisive) => {
                    assert_eq!(decisive, MatchResult::win_for(terminal.to_move.other()));
                }
                None => panic!("the loop only exits on a terminal position"),
            }
        }
    }

    #[test]
    fn eleven_takes_twenty_five_over_fifteen_and_twenty_two() {
        // checkercruncher.com, quoted in the plan's Verified Assumptions:
        // "11x25 captures on 15 and 22 and lands on 25."
        let pos = fixture(
            Side::A,
            &[
                (2, 5, Piece::man(Side::A)), // square 11
                (3, 4, Piece::man(Side::B)), // square 15
                (5, 2, Piece::man(Side::B)), // square 22
            ],
        );
        let chains = legal_chains(&pos);
        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].from + 1, 11);
        assert_eq!(chains[0].to + 1, 25);
        let captured: Vec<u16> = chains[0]
            .captures
            .iter()
            .map(|&c| u16::from(c) + 1)
            .collect();
        assert_eq!(captured, vec![15, 22], "captures on 15 and 22");
        let landings: Vec<u16> = chains[0]
            .landings
            .iter()
            .map(|&c| u16::from(c) + 1)
            .collect();
        assert_eq!(landings, vec![18, 25], "via 18, landing on 25");
        assert_eq!(
            <Checkers as Adversary>::move_to_text(legal_moves(&pos)[0]),
            "11x25"
        );
    }

    #[test]
    fn an_illegal_move_is_a_no_op_rather_than_a_panic() {
        // The property Phase 5's replay leans on: a tampered move list must
        // diverge the state hash, not crash the core on hostile input. Every
        // shape of "not legal here" has to behave the same way.
        let pos = <Checkers as Adversary>::initial(0);
        let legal = legal_moves(&pos);
        for bogus in [
            Move {
                from: 0,
                to: 31,
                variant: 0,
            }, // geometrically impossible
            Move {
                from: 10,
                to: 14,
                variant: 3,
            }, // right squares, no such variant
            Move {
                from: 20,
                to: 16,
                variant: 0,
            }, // the other side's piece
        ] {
            assert!(!legal.contains(&bogus), "the fixture move must be illegal");
            assert_eq!(chain_for(&pos, bogus), None);
            assert_eq!(apply_move(&pos, bogus), pos, "unchanged, including to_move");
        }
    }

    // ---- Phase 5: the no-progress draw rule --------------------------------

    /// Play the specific move `from -> to` (there is only ever one in these
    /// fixtures), rather than whichever move happens to be first.
    fn play_to(pos: &Board, from: u8, to: u8) -> Board {
        let mv = legal_moves(pos)
            .into_iter()
            .find(|m| m.from == from && m.to == to)
            .expect("the shuffle move must be legal");
        apply_move(pos, mv)
    }

    /// Two kings in opposite corners, each stepping back and forth for `plies`.
    ///
    /// Phase 0's D4 note is load-bearing here: a *random* king shuffle keeps
    /// ending decisively, because the kings drift adjacent and mandatory capture
    /// wins on the spot. Pinning them in opposite corners and oscillating
    /// deterministically is what makes the fixture actually shuffle.
    fn king_shuffle(plies: usize) -> Board {
        let mut pos = fixture(
            Side::A,
            &[(0, 1, Piece::king(Side::A)), (7, 6, Piece::king(Side::B))],
        );
        let a = [sq(0, 1), sq(1, 0)];
        let b = [sq(7, 6), sq(6, 7)];
        for ply in 0..plies {
            let path = if ply % 2 == 0 { a } else { b };
            let step = ply / 2;
            pos = play_to(&pos, path[step % 2], path[(step + 1) % 2]);
        }
        pos
    }

    #[test]
    fn a_king_shuffle_draws_at_exactly_eighty_plies() {
        // The unit is the whole risk: "40 moves by each side" and "80 plies" are
        // the same rule counted two ways, and the off-by-one lives precisely
        // there. So the fixture names the edges instead of a single point.
        let live = king_shuffle(79);
        assert_eq!(live.no_progress, 79);
        assert_eq!(result(&live), None, "79 plies is not yet a draw");
        assert!(!legal_moves(&live).is_empty(), "and play continues");

        let drawn = king_shuffle(80);
        assert_eq!(drawn.no_progress, NO_PROGRESS_LIMIT);
        assert_eq!(result(&drawn), Some(MatchResult::Draw));
        assert!(legal_moves(&drawn).is_empty(), "a drawn game is over");

        // Past the threshold it stays drawn: the counter neither wraps nor resets
        // itself. Without this, a `== LIMIT` test passes the pair above.
        let mut past = drawn;
        past.no_progress = NO_PROGRESS_LIMIT + 1;
        assert_eq!(result(&past), Some(MatchResult::Draw));
        past.no_progress = u16::MAX;
        assert_eq!(result(&past), Some(MatchResult::Draw));
    }

    #[test]
    fn a_capture_and_a_man_advance_reset_the_counter_but_a_king_move_does_not() {
        // All three positions sit one ply short of the draw, so the only variable
        // is the *kind* of move played. That is the entire rule.
        let mut capture = fixture(
            Side::A,
            &[
                (2, 1, Piece::man(Side::A)),
                (3, 2, Piece::man(Side::B)),
                (7, 6, Piece::king(Side::B)),
            ],
        );
        capture.no_progress = NO_PROGRESS_LIMIT - 1;
        let after = apply_move(&capture, legal_moves(&capture)[0]);
        assert_eq!(after.no_progress, 0, "a capture is progress");
        assert_eq!(result(&after), None, "so the game is live past ply 80");

        let mut advance = fixture(
            Side::A,
            &[(2, 1, Piece::man(Side::A)), (7, 6, Piece::king(Side::B))],
        );
        advance.no_progress = NO_PROGRESS_LIMIT - 1;
        let after = apply_move(&advance, legal_moves(&advance)[0]);
        assert_eq!(
            after.no_progress, 0,
            "a man only ever moves forward, so any man move is an advance"
        );
        assert_eq!(result(&after), None);

        // The other side of the branch, and the case the rule exists for.
        let mut shuffle = fixture(
            Side::A,
            &[(0, 1, Piece::king(Side::A)), (7, 6, Piece::king(Side::B))],
        );
        shuffle.no_progress = NO_PROGRESS_LIMIT - 1;
        let after = apply_move(&shuffle, legal_moves(&shuffle)[0]);
        assert_eq!(
            after.no_progress, NO_PROGRESS_LIMIT,
            "a king move is not progress"
        );
        assert_eq!(result(&after), Some(MatchResult::Draw));
    }

    #[test]
    fn the_counter_is_hashed_because_it_changes_the_legal_future() {
        // The assertion that justifies putting the counter in `state_hash` at all:
        // the same men with the same side to move are *not* the same state if one
        // is closer to the draw than the other.
        let near = <Checkers as Adversary>::initial(0);
        let mut nearer = near;
        nearer.no_progress = 1;
        assert_ne!(near, nearer, "the counter is part of the position");
        assert_ne!(
            <Checkers as Adversary>::state_hash(&near),
            <Checkers as Adversary>::state_hash(&nearer),
            "two boards one ply apart from the draw are different states"
        );
    }

    #[test]
    fn a_full_game_replays_to_a_verifiable_hash() {
        use pond_outcome::{attest, verify, Outcome};

        let (moves, terminal) = seeded_game(3, 1_000);
        assert!(result(&terminal).is_some(), "the game reaches a terminal");

        let rec = attest::<Checkers>(3, moves, Outcome::Abandoned, None);
        assert!(verify::<Checkers>(&rec).ok, "an honest match replays");

        // Tamper the opening move with one that is legal in no position anywhere.
        // Replay skips it, so the line diverges from the first ply and the
        // recorded hash cannot be reproduced.
        let mut bad = rec.clone();
        bad.moves[0] = Move {
            from: 0,
            to: 31,
            variant: 0,
        };
        let check = verify::<Checkers>(&bad);
        assert!(!check.ok, "a tampered move list fails verify");
        assert_ne!(check.expected, check.actual);
    }

    /// Run `games` seeded games, returning `(draws, longest game in plies)`.
    fn soak(games: u64, cap: usize) -> (usize, usize) {
        let mut draws = 0;
        let mut longest = 0;
        for seed in 0..games {
            let (moves, terminal) = seeded_game(seed, cap);
            longest = longest.max(moves.len());
            if result(&terminal) == Some(MatchResult::Draw) {
                draws += 1;
            }
        }
        (draws, longest)
    }

    #[test]
    fn a_thousand_seeded_games_all_terminate() {
        // Termination is a *guarantee*, and a guarantee is exactly the property a
        // handful of fixtures cannot establish. Seeded, so any failure is
        // reproducible from the seed in the panic message alone.
        // Measured 2026-08-05 over 10,000 seeded games: every game terminated,
        // 39 draws, longest 289 plies. The cap is ~3.5x that — tight enough that a
        // regression breaking the draw rule fails in seconds rather than grinding
        // through 20k plies a game, loose enough not to flake on a long line.
        let (draws, longest) = soak(1_000, 1_000);
        assert!(
            draws > 0,
            "the draw rule must actually fire somewhere in 1000 games, else this \
             soak proves only that decisive games end"
        );
        assert!(longest < 1_000, "longest game was {longest} plies");
    }

    #[test]
    #[ignore = "10k-game soak: run by hand once per change to the rules; result recorded in the plan"]
    fn ten_thousand_seeded_games_all_terminate() {
        let (draws, longest) = soak(10_000, 1_000);
        println!("10k soak: {draws} draws, longest game {longest} plies");
    }
}
