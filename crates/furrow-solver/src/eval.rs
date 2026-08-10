//! The heuristic, for positions above the exact threshold.
//!
//! **This one is load-bearing**, which is what separates it from dots'. Phase 0
//! measured that roughly **70% of a game sits above the exact threshold** — so
//! unlike dots, where the capped path turned out to be value-flat and any
//! heuristic would have played the same moves, here the heuristic decides most of
//! the game. It gets policy tests for that reason.
//!
//! It estimates the **future** margin — what is still to come — and never the
//! banked score, because the banked score is already known and the search adds it
//! back. That is the same split the exact solver's memo key uses, and it is what
//! keeps a heuristic value and an exact value on the same scale.
//!
//! The formula, in full:
//!
//! ```text
//! eval(pos) =  SIDE_SEED   * (seeds on my side  - seeds on theirs)
//!            + EXTRA_TURN  * (my free turns     - theirs)
//!            + CAPTURE     * (my best capture   - theirs)
//! ```
//!
//! from the side-to-move's perspective. Each term names something a mancala
//! player would actually say out loud, which is the bar the tutor's `idea`
//! strings have to clear anyway.

use adversary_core::Side;
use furrow_core::{opposite_pit, store_of, Board, CELLS};

/// Weight on holding seeds rather than having fed them across.
///
/// Seeds on your own side are seeds you still get to spend; seeds on the
/// opponent's are seeds they will mostly bank. The unit the other two weights are
/// stated against.
pub const SIDE_SEED: i32 = 1;

/// Weight on a pit that lands its last seed in your store — a free extra turn.
///
/// Worth more than the one seed it banks, because it is also a tempo the
/// opponent never gets. Phase 0 measured chains up to five moves long, so these
/// compound.
pub const EXTRA_TURN: i32 = 3;

/// Weight on the largest capture currently available, per seed captured.
///
/// A capture moves seeds from their side to your store in one step, so it is
/// worth about twice a plain seed — it is both a gain and a denial.
pub const CAPTURE: i32 = 2;

/// Seeds sitting in `side`'s pits (their store is not counted).
#[must_use]
pub fn seeds_on(pos: &Board, side: Side) -> i32 {
    Board::pits_of(side).map(|p| i32::from(pos.cells[p])).sum()
}

/// How many cells forward the sow from `pit` would have to travel to land in
/// `side`'s store, given that the opponent's store is skipped.
#[must_use]
pub fn steps_to_store(side: Side, pit: usize) -> u32 {
    let store = store_of(side);
    // The mover walks CELLS - 1 cells per lap (their opponent's store is skipped),
    // and the store is always ahead of every one of that side's own pits within
    // one lap.
    let raw = (store + CELLS - pit) % CELLS;
    raw as u32
}

/// How many of `side`'s pits would land their last seed in `side`'s store.
///
/// Only the first lap counts. A pit holding exactly a full lap more would also
/// land there, but by then it has fed the opponent six seeds on the way, which
/// is not the cheap tempo this term is trying to name.
#[must_use]
pub fn free_turns(pos: &Board, side: Side) -> i32 {
    Board::pits_of(side)
        .filter(|&p| {
            let seeds = u32::from(pos.cells[p]);
            seeds > 0 && seeds == steps_to_store(side, p)
        })
        .count() as i32
}

/// The largest capture `side` could make right now, in seeds.
///
/// Zero when no move captures. Only first-lap landings are considered, for the
/// same reason [`free_turns`] stops there.
#[must_use]
pub fn best_capture(pos: &Board, side: Side) -> i32 {
    Board::pits_of(side)
        .filter_map(|p| {
            let seeds = u32::from(pos.cells[p]);
            if seeds == 0 {
                return None;
            }
            let steps = steps_to_store(side, p);
            // Landing beyond the store crosses onto the opponent's row, where
            // nothing can be captured; landing short of it stays on this row.
            if seeds >= steps {
                return None;
            }
            let landing = p + seeds as usize;
            // The landing pit must be empty before the seed arrives, and the pit
            // facing it must hold something.
            if pos.cells[landing] != 0 {
                return None;
            }
            let facing = i32::from(pos.cells[opposite_pit(landing)]);
            (facing > 0).then_some(facing + 1)
        })
        .max()
        .unwrap_or(0)
}

/// The estimated **future** margin at `pos`, from the side-to-move's perspective.
///
/// Positive means the side to move expects to out-bank the opponent from here on.
/// It says nothing about who is ahead — that is the banked score, which the
/// search already knows.
#[must_use]
pub fn future_margin(pos: &Board) -> i32 {
    let me = pos.to_move;
    let them = me.other();
    SIDE_SEED * (seeds_on(pos, me) - seeds_on(pos, them))
        + EXTRA_TURN * (free_turns(pos, me) - free_turns(pos, them))
        + CAPTURE * (best_capture(pos, me) - best_capture(pos, them))
}

#[cfg(test)]
mod tests {
    use super::*;
    use furrow_core::{A_STORE, B_STORE, PITS};

    fn board(a: [u8; PITS], b: [u8; PITS], to_move: Side) -> Board {
        let mut cells = [0u8; CELLS];
        cells[..PITS].copy_from_slice(&a);
        cells[PITS + 1..PITS + 1 + PITS].copy_from_slice(&b);
        cells[A_STORE] = 0;
        cells[B_STORE] = 0;
        Board { cells, to_move }
    }

    #[test]
    fn the_opening_is_symmetric_so_the_heuristic_calls_it_level() {
        // The sharpest single check on the whole formula: every term is a
        // difference, and the opening is a mirror, so anything that is not
        // perfectly antisymmetric shows up here as a non-zero.
        assert_eq!(future_margin(&Board::opening()), 0);
    }

    #[test]
    fn the_heuristic_is_antisymmetric_in_the_side_to_move() {
        // Whatever it says for me, it must say the negative of for you. A term
        // that read the wrong side's pits would break this and nothing else.
        let pos = board([3, 0, 5, 1, 0, 2], [1, 4, 0, 0, 6, 2], Side::A);
        let flipped = Board {
            to_move: Side::B,
            ..pos
        };
        assert_eq!(future_margin(&pos), -future_margin(&flipped));
    }

    #[test]
    fn steps_to_store_counts_forward_and_is_shortest_from_the_last_pit() {
        // A's pit 5 is next to A's store; pit 0 is six cells away.
        assert_eq!(steps_to_store(Side::A, 5), 1);
        assert_eq!(steps_to_store(Side::A, 0), 6);
        // The same shape on B's side, which is what a hard-coded A-only version
        // would get wrong.
        assert_eq!(steps_to_store(Side::B, 12), 1);
        assert_eq!(steps_to_store(Side::B, 7), 6);
    }

    #[test]
    fn a_pit_that_reaches_the_store_exactly_is_a_free_turn_and_others_are_not() {
        // Pit 5 with one seed lands in the store. Pit 4 with one seed does not.
        let pos = board([0, 0, 0, 0, 1, 1], [0; PITS], Side::A);
        assert_eq!(free_turns(&pos, Side::A), 1);
        // An empty pit is not a free turn however the arithmetic falls out.
        let empty = board([0; PITS], [0; PITS], Side::A);
        assert_eq!(free_turns(&empty, Side::A), 0);
        // The opening has exactly one: pit 2, four away from the store. That is
        // the classic opening every mancala player knows, so if this number
        // moves, the term stopped meaning what it says.
        assert_eq!(free_turns(&Board::opening(), Side::A), 1);
        assert_eq!(free_turns(&Board::opening(), Side::B), 1);
    }

    #[test]
    fn best_capture_finds_the_biggest_one_and_zero_when_there_is_none() {
        // Pit 0 with 1 seed lands in pit 1 (empty), facing pit 11 which holds 5.
        // Pit 3 with 1 seed lands in pit 4 (empty), facing pit 8 which holds 2.
        let pos = board([1, 0, 0, 1, 0, 0], [0, 2, 0, 0, 5, 0], Side::A);
        assert_eq!(
            best_capture(&pos, Side::A),
            6,
            "the 5-seed pit, plus the lander"
        );
        // Nothing to take: every facing pit is empty.
        let barren = board([1, 0, 0, 0, 0, 0], [0; PITS], Side::A);
        assert_eq!(best_capture(&barren, Side::A), 0);
        // Landing on a pile is not a capture.
        let occupied = board([1, 3, 0, 0, 0, 0], [0, 0, 0, 0, 5, 0], Side::A);
        assert_eq!(best_capture(&occupied, Side::A), 0);
    }

    #[test]
    fn a_sow_that_crosses_the_store_is_not_counted_as_a_capture() {
        // Pit 5 with 3 seeds runs store, 7, 8 -- it lands on the opponent's row,
        // where no capture is possible. A version that only checked "the landing
        // pit is empty" would claim one here.
        let pos = board([0, 0, 0, 0, 0, 3], [0, 0, 4, 0, 0, 0], Side::A);
        assert_eq!(best_capture(&pos, Side::A), 0);
    }

    #[test]
    fn holding_seeds_scores_better_than_having_fed_them_across() {
        let holding = board([4, 4, 4, 4, 4, 4], [0; PITS], Side::A);
        let fed = board([0; PITS], [4, 4, 4, 4, 4, 4], Side::A);
        assert!(
            future_margin(&holding) > future_margin(&fed),
            "the side with the seeds is the side with the moves"
        );
    }

    #[test]
    fn a_free_turn_outweighs_the_single_seed_it_banks() {
        // The reason EXTRA_TURN is not 1: the tempo is worth more than the seed.
        // Two boards with the same seeds on each side, one of which has a pit
        // that reaches the store.
        let with = board([0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0], Side::A);
        let without = board([0, 0, 0, 1, 0, 0], [1, 0, 0, 0, 0, 0], Side::A);
        assert_eq!(seeds_on(&with, Side::A), seeds_on(&without, Side::A));
        assert!(future_margin(&with) > future_margin(&without));
    }
}
