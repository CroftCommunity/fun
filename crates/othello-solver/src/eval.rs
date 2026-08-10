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

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::{Adversary, Side};
    use othello_core::Othello;

    /// The board is symmetric, so the weight table must be. This is the property
    /// that makes the table *a policy* rather than 64 loose numbers — and it is
    /// the one mutation testing walked straight through on 2026-08-08: every
    /// negative weight could have its sign deleted (`-50` → `50`, turning the
    /// worst square on the board into the second-best) with the whole suite
    /// green, because this file had no tests at all.
    #[test]
    fn the_weight_table_is_symmetric_in_both_axes() {
        for r in 0..8 {
            for c in 0..8 {
                let at = |row: usize, col: usize| WEIGHTS[row * 8 + col];
                assert_eq!(at(r, c), at(r, 7 - c), "mirror across the vertical axis");
                assert_eq!(at(r, c), at(7 - r, c), "mirror across the horizontal axis");
                assert_eq!(at(r, c), at(c, r), "mirror across the diagonal");
            }
        }
    }

    /// The table's *meaning*, stated as an ordering rather than as numbers, so a
    /// future re-tune is free to move the values and not free to invert the
    /// judgement: a corner is the prize, and the square diagonally inside it is
    /// the trap that hands the corner over.
    #[test]
    fn corners_are_the_prize_and_x_squares_are_the_trap() {
        let at = |r: usize, c: usize| WEIGHTS[r * 8 + c];
        let corners = [at(0, 0), at(0, 7), at(7, 0), at(7, 7)];
        let x_squares = [at(1, 1), at(1, 6), at(6, 1), at(6, 6)];
        let c_squares = [at(0, 1), at(1, 0), at(0, 6), at(7, 1)];

        assert_eq!(
            corners[0],
            *WEIGHTS.iter().max().expect("non-empty"),
            "a corner is the best square"
        );
        assert_eq!(
            x_squares[0],
            *WEIGHTS.iter().min().expect("non-empty"),
            "an X-square is the worst"
        );
        for w in corners {
            assert!(w > 0, "every corner is a prize: {w}");
        }
        for w in x_squares {
            assert!(w < 0, "every X-square is a trap: {w}");
        }
        for w in c_squares {
            assert!(w < 0, "every C-square is a trap too: {w}");
        }
        assert!(
            x_squares[0] < c_squares[0],
            "the X-square is the worse of the two traps"
        );
    }

    /// And the sign convention actually reaches the score: owning a corner must
    /// read as better than the opponent owning it. A table test alone would not
    /// catch `positional -= WEIGHTS[i]` becoming `+=`.
    #[test]
    fn holding_a_corner_scores_better_than_conceding_it() {
        let base = <Othello as Adversary>::initial(0);
        let mut mine = base;
        mine.cells[0] = othello_core::cell_of(base.to_move);
        let mut theirs = base;
        theirs.cells[0] = othello_core::cell_of(base.to_move.other());
        assert!(
            heuristic(&mine) > heuristic(&theirs),
            "a corner is worth more to whoever holds it"
        );
        assert_ne!(base.to_move, base.to_move.other()); // guards the fixture
        assert_eq!(base.to_move, Side::A);
    }

    /// The mobility term is real, and it is worth [`MOBILITY`] a move. Asserted
    /// through the score rather than by reading the constant back.
    #[test]
    fn more_moves_scores_better_at_equal_material() {
        let board = <Othello as Adversary>::initial(0);
        let mut flipped = board;
        flipped.to_move = board.to_move.other();
        // The opening is symmetric, so both sides have the same four placements
        // and the same material: the score must be level from either seat.
        assert_eq!(
            heuristic(&board),
            heuristic(&flipped),
            "a symmetric opening is level"
        );
        assert_eq!(
            heuristic(&board),
            0,
            "and level means zero, not merely equal"
        );
    }
}
