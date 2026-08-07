//! The difficulty band + live move selection. The engine produces per-move
//! values (exact in the endgame, heuristic earlier); the band keeps the player
//! from throwing the game at higher levels and adds beatable sloppiness at lower
//! ones.
//!
//! The selector itself lives in `adversary-solver`, shared with every adversarial
//! game on the shelf. It was duplicated here under the rule of three until
//! checkers became the third consumer (2026-08-05); what stays behind is the part
//! that is genuinely Othello's — `capped_class` and the per-level tuning.

use othello_core::{legal_moves, result, Board, Move};
use rand_chacha::rand_core::RngCore;

// Re-exported so `othello_solver::live::*` keeps naming them: the wasm binding
// imports them from here, and the extraction is not meant to be visible.
pub use adversary_solver::{select_in_band, LiveBand, NodeBudget};

use crate::search::{move_values_honest, Level, LIVE_EXACT_NODE_BUDGET};

/// The win/draw/loss class of a value. **Exact** values (endgame disc
/// differentials) classify by [`i32::signum`]. **Capped** (heuristic, early)
/// values are always unresolved (`0`): Othello is unsolved from the opening, so
/// a positive heuristic is *not* a proven win — the honest class is "unknown",
/// and the tutor/band never claim otherwise until the exact endgame.
#[must_use]
pub fn capped_class(_v: i32) -> i32 {
    0
}

/// The [`LiveBand`] for a [`Level`]: Easy/Medium are shallow, sloppy and
/// beatable; Hard/Expert are deep and class-preserving (never throw a known
/// endgame), Expert with no sloppiness (always the tightest in-class move).
#[must_use]
pub fn live_band(level: Level) -> LiveBand {
    match level {
        Level::Easy => LiveBand {
            depth: level.depth(),
            preserve_class: false,
            sloppiness_pct: 60,
        },
        Level::Medium => LiveBand {
            depth: level.depth(),
            preserve_class: false,
            sloppiness_pct: 30,
        },
        Level::Hard => LiveBand {
            depth: level.depth(),
            preserve_class: true,
            sloppiness_pct: 40,
        },
        Level::Expert => LiveBand {
            depth: level.depth(),
            preserve_class: true,
            sloppiness_pct: 0,
        },
    }
}

/// A live opponent move at `level`, or `None` if terminal. Selects within a
/// class-floored, sloppiness-tuned band of the move values (exact in the
/// endgame, heuristic earlier). A forced pass is the lone value and is returned.
#[must_use]
pub fn choose(board: &Board, level: Level, rng: &mut impl RngCore) -> Option<Move> {
    if result(board).is_some() || legal_moves(board).is_empty() {
        return None;
    }
    let band = live_band(level);
    // The class floor follows **the search**, not the position. It used to read
    // `empties <= TRACTABLE_EMPTIES`, which was sound only while a position in
    // the exact region was guaranteed a completed solve. Now that the solve is
    // budgeted, "few empties" no longer implies "proven", and an `i32::signum`
    // floor over heuristic values would claim to preserve a class nothing had
    // established.
    let searched = move_values_honest(
        board,
        band.depth,
        &mut NodeBudget::of(LIVE_EXACT_NODE_BUDGET),
    );
    let class_of: fn(i32) -> i32 = if searched.exact {
        i32::signum
    } else {
        capped_class
    };
    select_in_band(
        &searched.values,
        class_of,
        band.preserve_class,
        band.sloppiness_pct,
        rng,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::Adversary;
    use othello_core::Othello;
    use rand_chacha::rand_core::SeedableRng;
    use rand_chacha::ChaCha20Rng;

    #[test]
    fn select_in_band_class_floor_never_drops_a_known_class() {
        // Synthetic exact values: Place(0) wins (+), 1/2 neutral (0), 3 loses (-).
        let values = [
            (Move::Place(0), 500),
            (Move::Place(1), 0),
            (Move::Place(2), 0),
            (Move::Place(3), -500),
        ];
        let class = |v: i32| v.signum();
        // Even at full sloppiness, preserve_class never returns the losing move.
        let mut rng = ChaCha20Rng::seed_from_u64(3);
        for _ in 0..200 {
            let mv = select_in_band(&values, class, true, 100, &mut rng).unwrap();
            assert_ne!(
                mv,
                Move::Place(3),
                "the class floor must never admit the loss"
            );
        }
        // With no sloppiness it plays the tightest (best-value) move.
        let mut rng = ChaCha20Rng::seed_from_u64(4);
        assert_eq!(
            select_in_band(&values, class, true, 0, &mut rng),
            Some(Move::Place(0))
        );
        // With no floor, full sloppiness eventually admits the class-dropping move.
        let mut rng = ChaCha20Rng::seed_from_u64(5);
        let mut saw_drop = false;
        for _ in 0..200 {
            if select_in_band(&values, class, false, 100, &mut rng) == Some(Move::Place(3)) {
                saw_drop = true;
                break;
            }
        }
        assert!(saw_drop, "no floor may admit a class-dropping move");
    }

    #[test]
    fn expert_is_deterministic_and_returns_a_legal_move() {
        let pos = <Othello as Adversary>::initial(0);
        let mut rng1 = ChaCha20Rng::seed_from_u64(1);
        let mut rng2 = ChaCha20Rng::seed_from_u64(2);
        // Expert has zero sloppiness, so its move is independent of the rng.
        let a = choose(&pos, Level::Expert, &mut rng1).unwrap();
        let b = choose(&pos, Level::Expert, &mut rng2).unwrap();
        assert_eq!(a, b, "Expert (no sloppiness) is deterministic");
        assert!(legal_moves(&pos).contains(&a), "and returns a legal move");
    }
}
