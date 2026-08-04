//! The positional + mobility heuristic — the horizon evaluation for the
//! depth-capped search (Othello is unsolved from the opening, so early play is
//! judged, not solved). Integer-only so `native == wasm` move choice.

use othello_core::{cell_of, legal_places, Board, CELLS};

/// The classic Othello static square weights (row-major, r0=top): corners are
/// prizes (permanent), the diagonal-adjacent "X-squares" and edge-adjacent
/// "C-squares" are traps (they hand the opponent a corner).
#[rustfmt::skip]
pub const WEIGHTS: [i32; CELLS] = [
    100, -20, 10, 5, 5, 10, -20, 100,
    -20, -50, -2, -2, -2, -2, -50, -20,
     10,  -2,  0,  0,  0,  0,  -2,  10,
      5,  -2,  0,  0,  0,  0,  -2,   5,
      5,  -2,  0,  0,  0,  0,  -2,   5,
     10,  -2,  0,  0,  0,  0,  -2,  10,
    -20, -50, -2, -2, -2, -2, -50, -20,
    100, -20, 10, 5, 5, 10, -20, 100,
];

/// Per-legal-move mobility weight — how much a free move is worth vs a square's
/// static value. Mobility dominates the opening; the static table dominates late.
const MOBILITY: i32 = 5;

/// A positional score from the side-to-move's perspective: the static
/// square-weight differential plus a mobility differential (how many legal
/// placements each side has). Higher is better for the side to move.
#[must_use]
pub fn heuristic(board: &Board) -> i32 {
    let me = cell_of(board.to_move);
    let opp = cell_of(board.to_move.other());
    let mut positional = 0i32;
    for (i, &v) in board.cells.iter().enumerate() {
        if v == me {
            positional += WEIGHTS[i];
        } else if v == opp {
            positional -= WEIGHTS[i];
        }
    }
    let my_moves = legal_places(board).len() as i32;
    let mut opp_board = *board;
    opp_board.to_move = board.to_move.other();
    let opp_moves = legal_places(&opp_board).len() as i32;
    positional + MOBILITY * (my_moves - opp_moves)
}
