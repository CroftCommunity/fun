//! The horizon evaluation — what a position is worth when the search runs out of
//! depth before it runs out of game.
//!
//! Four terms, all integers so `native == wasm`:
//!
//! - **Material**, with a king worth well over a man. This dominates; checkers is
//!   a game about winning the exchange.
//! - **Advancement** — a man two rows from crowning is worth more than one on its
//!   back rank, because it is closer to becoming a king.
//! - **Back rank** — men still home deny the *opponent* a crowning square. It is
//!   a small bonus deliberately: holding the back rank forever is also a way to
//!   lose on mobility.
//! - **Mobility**, the move-count differential. In a game with mandatory capture,
//!   being the side with choices is most of the advantage.

use adversary_core::Side;
use checkers_core::{legal_moves, piece_of_cell, row_col, Board, Rank, SQUARES};

/// A man's material value. The unit the other weights are stated against.
pub const MAN: i32 = 100;

/// A king's material value. Draughts practice puts a king at roughly 1.5–2 men;
/// the midpoint, held as an integer so no float ever touches a compared path.
pub const KING: i32 = 175;

/// Per row advanced toward the crowning row, for a man.
const ADVANCE: i32 = 3;

/// Per own man still standing on its own back rank.
const BACK_RANK: i32 = 6;

/// Per legal move of advantage.
const MOBILITY: i32 = 4;

/// How many legal moves `side` would have in `board`, ignoring whose turn it is.
fn move_count(board: &Board, side: Side) -> i32 {
    let mut probe = *board;
    probe.to_move = side;
    legal_moves(&probe).len() as i32
}

/// The static value of `board` from the **side to move's** perspective; higher is
/// better for them.
#[must_use]
pub fn heuristic(board: &Board) -> i32 {
    let me = board.to_move;
    let mut score = 0i32;

    for idx in 0..SQUARES {
        let Some(piece) = piece_of_cell(board.cells[idx]) else {
            continue;
        };
        let (row, _) = row_col(idx as u8);
        let sign = if piece.side == me { 1 } else { -1 };

        score += sign
            * match piece.rank {
                Rank::King => KING,
                Rank::Man => {
                    // Rows advanced from this side's own back rank. A is at home on
                    // row 0 and advances toward 7; B is the mirror.
                    let advanced = match piece.side {
                        Side::A => row,
                        Side::B => 7 - row,
                    } as i32;
                    let home = i32::from(advanced == 0);
                    MAN + ADVANCE * advanced + BACK_RANK * home
                }
            };
    }

    score + MOBILITY * (move_count(board, me) - move_count(board, me.other()))
}
