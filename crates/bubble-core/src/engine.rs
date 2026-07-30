//! The bubble-shooter engine: the seeded deal (B1), and — landing in B2 — the
//! shot resolution (place → pop → drop) and the `Game` wrapper.

use crate::board::{Board, Cell};
use crate::rng::DetRng;

/// The result of dealing a board: the board plus the number of RNG draws
/// consumed (folded into the state hash).
#[derive(Clone, Debug)]
pub struct Deal {
    /// The dealt board.
    pub board: Board,
    /// RNG draws consumed by the deal.
    pub draws: u64,
}

/// Deal a starting board: fill the top `rows_filled` rows with seeded random
/// bubbles from `0..colors`, leaving the rest empty (RULES.md "The deal").
///
/// # Panics
/// Panics if dimensions are zero or `colors == 0` (invariants the caller's mode
/// constants uphold; a zero here is a programming error, not user input).
#[must_use]
pub fn deal(seed: u64, width: usize, height: usize, rows_filled: usize, colors: usize) -> Deal {
    assert!(width > 0 && height > 0, "deal dimensions must be non-zero");
    assert!(colors > 0, "deal needs at least one colour");
    let mut rng = DetRng::from_seed(seed);
    let mut board = Board::new_empty(width, height).expect("dimensions checked non-zero");
    let fill_rows = rows_filled.min(height);
    for r in 0..fill_rows {
        for c in 0..Board::row_len(width, r) {
            let color = u8::try_from(rng.index(colors)).expect("colour index fits u8");
            board.set(r, c, Cell::Bubble(color));
        }
    }
    Deal {
        board,
        draws: rng.draws(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::Cell;
    use crate::hash::state_hash;

    const W: usize = 8;
    const H: usize = 11;
    const ROWS_FILLED: usize = 5;
    const COLORS: usize = 5;

    fn deal_default(seed: u64) -> Deal {
        deal(seed, W, H, ROWS_FILLED, COLORS)
    }

    #[test]
    fn deal_fills_top_rows_and_empties_the_rest() {
        let Deal { board, draws } = deal_default(1);
        // Every cell in the top ROWS_FILLED rows is a bubble; the rest empty.
        let mut filled = 0usize;
        for r in 0..H {
            for c in 0..Board::row_len(W, r) {
                let cell = board.get(r, c).expect("in bounds");
                if r < ROWS_FILLED {
                    assert!(
                        matches!(cell, Cell::Bubble(_)),
                        "({r},{c}) should be filled"
                    );
                    filled += 1;
                } else {
                    assert_eq!(cell, Cell::Empty, "({r},{c}) should be empty");
                }
            }
        }
        // draws == number of filled cells (one colour draw each).
        assert_eq!(draws, filled as u64);
    }

    #[test]
    fn deal_colors_are_in_range() {
        let Deal { board, .. } = deal_default(7);
        for cell in board.cells() {
            if let Cell::Bubble(c) = cell {
                assert!((*c as usize) < COLORS, "colour {c} out of range");
            }
        }
    }

    #[test]
    fn deal_is_deterministic_for_a_seed() {
        let a = deal_default(42);
        let b = deal_default(42);
        assert_eq!(
            state_hash(&a.board, COLORS, a.draws, 0),
            state_hash(&b.board, COLORS, b.draws, 0),
            "same seed must reproduce the same board+hash"
        );
    }

    #[test]
    fn different_seeds_differ() {
        let a = deal_default(1);
        let b = deal_default(2);
        assert_ne!(
            state_hash(&a.board, COLORS, a.draws, 0),
            state_hash(&b.board, COLORS, b.draws, 0),
            "different seeds should (almost surely) differ"
        );
    }
}
