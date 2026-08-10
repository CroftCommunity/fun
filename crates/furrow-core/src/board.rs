//! The Furrow board: fourteen counts and whose turn it is.
//!
//! **Cell numbering** (fixed, and the geometry every rule is written against):
//!
//! ```text
//!        12  11  10   9   8   7      <- B's pits (B's sowing runs right-to-left here)
//!    13                          6   <- 13 is B's store, 6 is A's store
//!         0   1   2   3   4   5      <- A's pits
//! ```
//!
//! Sowing runs `0 -> 1 -> ... -> 13 -> 0` and **skips the opponent's store**, so
//! the cycle a mover actually walks is thirteen cells long, not fourteen.
//!
//! Two properties of this layout carry weight elsewhere:
//!
//! - **Opposite pits sum to twelve** (`0<->12`, `1<->11`, ... `5<->7`), which is
//!   what makes the capture rule one subtraction rather than a table.
//! - **Seeds in play only ever decrease.** A seed that enters a store never
//!   leaves it, so [`Board::in_play`] is a monotone non-increasing measure of how
//!   much game is left — the property the solver's tractability threshold rests
//!   on, and the one checkers lacks.
//!
//! Counts are `u8` and the whole board is `Copy`, so a search branches by
//! cloning fourteen bytes. No `usize` reaches the hashed path.

use adversary_core::Side;

/// Pits per side (not counting the store).
pub const PITS: usize = 6;
/// Seeds each pit starts with.
pub const SEEDS: u8 = 4;
/// Cells in total: `2 * PITS` pits plus two stores.
pub const CELLS: usize = 2 * PITS + 2;
/// Side A's store.
pub const A_STORE: usize = PITS;
/// Side B's store.
pub const B_STORE: usize = CELLS - 1;
/// Seeds on the board at the opening — the constant the sweep conserves.
pub const TOTAL_SEEDS: u8 = 2 * PITS as u8 * SEEDS;

/// The store belonging to `side`.
#[must_use]
pub const fn store_of(side: Side) -> usize {
    match side {
        Side::A => A_STORE,
        Side::B => B_STORE,
    }
}

/// The first pit belonging to `side`; its pits are `first .. first + PITS`.
#[must_use]
pub const fn first_pit_of(side: Side) -> usize {
    match side {
        Side::A => 0,
        Side::B => PITS + 1,
    }
}

/// Whether `cell` is a pit belonging to `side` (stores are not pits).
#[must_use]
pub fn is_pit_of(side: Side, cell: usize) -> bool {
    let first = first_pit_of(side);
    (first..first + PITS).contains(&cell)
}

/// The pit facing `pit` across the board.
///
/// Opposite pits sum to `2 * PITS`, so this is one subtraction. Passing a store
/// is a caller error; the capture rule only ever asks about a pit.
#[must_use]
pub const fn opposite_pit(pit: usize) -> usize {
    2 * PITS - pit
}

/// The board: fourteen seed counts plus the side to move.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Board {
    /// Seed counts, indexed by the cell numbering above.
    pub cells: [u8; CELLS],
    /// Whose turn it is.
    pub to_move: Side,
}

impl Board {
    /// The opening position: every pit holds [`SEEDS`], both stores empty, A to
    /// move.
    #[must_use]
    pub fn opening() -> Self {
        let mut cells = [SEEDS; CELLS];
        cells[A_STORE] = 0;
        cells[B_STORE] = 0;
        Board {
            cells,
            to_move: Side::A,
        }
    }

    /// The pits belonging to `side`, as absolute cell indices.
    #[must_use]
    pub fn pits_of(side: Side) -> std::ops::Range<usize> {
        let first = first_pit_of(side);
        first..first + PITS
    }

    /// Seeds `side` has banked in their store.
    #[must_use]
    pub fn store(&self, side: Side) -> u8 {
        self.cells[store_of(side)]
    }

    /// Seeds still outside both stores.
    ///
    /// Monotone non-increasing over a game, which is what lets the solver decide
    /// tractability from the position alone.
    #[must_use]
    pub fn in_play(&self) -> u32 {
        (0..CELLS)
            .filter(|&i| i != A_STORE && i != B_STORE)
            .map(|i| u32::from(self.cells[i]))
            .sum()
    }

    /// Whether `side` has no seeds left to sow.
    #[must_use]
    pub fn side_is_empty(&self, side: Side) -> bool {
        Board::pits_of(side).all(|p| self.cells[p] == 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_opening_is_forty_eight_seeds_in_play_and_two_empty_stores() {
        let b = Board::opening();
        assert_eq!(b.in_play(), u32::from(TOTAL_SEEDS));
        assert_eq!(b.store(Side::A), 0);
        assert_eq!(b.store(Side::B), 0);
        assert_eq!(b.to_move, Side::A);
    }

    #[test]
    fn each_side_owns_six_pits_and_neither_owns_a_store() {
        assert_eq!(
            Board::pits_of(Side::A).collect::<Vec<_>>(),
            vec![0, 1, 2, 3, 4, 5]
        );
        assert_eq!(
            Board::pits_of(Side::B).collect::<Vec<_>>(),
            vec![7, 8, 9, 10, 11, 12]
        );
        assert!(!is_pit_of(Side::A, A_STORE), "a store is not a pit");
        assert!(!is_pit_of(Side::B, B_STORE), "a store is not a pit");
        assert!(!is_pit_of(Side::A, B_STORE), "the far store is not A's pit");
    }

    #[test]
    fn opposite_pits_face_each_other_and_the_relation_is_involutive() {
        assert_eq!(opposite_pit(0), 12);
        assert_eq!(opposite_pit(5), 7);
        for p in Board::pits_of(Side::A).chain(Board::pits_of(Side::B)) {
            assert_eq!(opposite_pit(opposite_pit(p)), p);
            assert_ne!(p, A_STORE);
            assert_ne!(p, B_STORE);
        }
    }

    #[test]
    fn a_side_is_empty_only_when_every_one_of_its_pits_is() {
        let mut b = Board::opening();
        assert!(!b.side_is_empty(Side::A));
        for p in Board::pits_of(Side::A) {
            b.cells[p] = 0;
        }
        assert!(b.side_is_empty(Side::A));
        assert!(!b.side_is_empty(Side::B), "emptying A says nothing about B");
        // A full store is not seeds to sow.
        b.cells[A_STORE] = TOTAL_SEEDS;
        assert!(b.side_is_empty(Side::A));
    }

    #[test]
    fn seeds_in_a_store_are_not_seeds_in_play() {
        let mut b = Board::opening();
        b.cells[0] = 0;
        b.cells[A_STORE] = SEEDS;
        assert_eq!(
            b.in_play(),
            u32::from(TOTAL_SEEDS - SEEDS),
            "banking four seeds takes four out of play"
        );
    }
}
