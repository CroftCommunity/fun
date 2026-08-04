//! The difficulty band + live move selection. The engine produces per-move
//! values (exact in the endgame, heuristic earlier); the band keeps the player
//! from throwing the game at higher levels and adds beatable sloppiness at lower
//! ones.
//!
//! The selector is the same ~30-line game-agnostic logic Drop 4 uses. Per the
//! rule-of-three it is **duplicated** here (not extracted to a shared crate)
//! rather than destabilise shipped Drop 4 for a second consumer; extraction to
//! an `adversary-solver` crate is a named follow-on once a third game lands.

use othello_core::{legal_moves, result, Board, Move};
use rand_chacha::rand_core::RngCore;

use crate::search::{move_values, Level};

/// The win/draw/loss class of a value. **Exact** values (endgame disc
/// differentials) classify by [`i32::signum`]. **Capped** (heuristic, early)
/// values are always unresolved (`0`): Othello is unsolved from the opening, so
/// a positive heuristic is *not* a proven win — the honest class is "unknown",
/// and the tutor/band never claim otherwise until the exact endgame.
#[must_use]
pub fn capped_class(_v: i32) -> i32 {
    0
}

/// The two difficulty knobs per [`Level`]: search depth, a **class floor**
/// (`preserve_class` = never admit a move that drops the win/draw/loss class →
/// never throws the game, once the class is known in the exact endgame), and
/// **within-class sloppiness** (percent chance of a random in-class move).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LiveBand {
    /// Bounded search depth (ignored in the exact endgame, which solves fully).
    pub depth: u32,
    /// Keep only moves in the best available class (never throw a known game).
    pub preserve_class: bool,
    /// Percent chance (0-100) of a random in-class move instead of the tightest.
    pub sloppiness_pct: u32,
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

/// Pick a move from a difficulty band over per-move `values`, bucketing each
/// value's class with `class_of`. With `preserve_class`, only moves in the best
/// available class are eligible (so the pick never drops the class). With
/// probability `sloppiness_pct` a random eligible move is chosen; otherwise the
/// tightest (highest-value) eligible move. `None` only if `values` is empty.
///
/// The shared selector for both the exact path (`class_of = i32::signum`) and
/// the capped path (`class_of = capped_class`).
pub fn select_in_band(
    values: &[(Move, i32)],
    class_of: impl Fn(i32) -> i32,
    preserve_class: bool,
    sloppiness_pct: u32,
    rng: &mut impl RngCore,
) -> Option<Move> {
    let best = values.iter().map(|&(_, v)| v).max()?;
    let best_class = class_of(best);
    let eligible: Vec<(Move, i32)> = values
        .iter()
        .copied()
        .filter(|&(_, v)| !preserve_class || class_of(v) == best_class)
        .collect();
    if eligible.is_empty() {
        return None; // unreachable: the best move is always eligible
    }
    if sloppiness_pct > 0 && rng.next_u32() % 100 < sloppiness_pct {
        return Some(eligible[(rng.next_u32() as usize) % eligible.len()].0);
    }
    eligible.iter().max_by_key(|&&(_, v)| v).map(|&(m, _)| m)
}

/// A live opponent move at `level`, or `None` if terminal. Selects within a
/// class-floored, sloppiness-tuned band of the move values (exact in the
/// endgame, heuristic earlier). A forced pass is the lone value and is returned.
#[must_use]
pub fn choose(board: &Board, level: Level, rng: &mut impl RngCore) -> Option<Move> {
    if result(board).is_some() || legal_moves(board).is_empty() {
        return None;
    }
    let empties = board.cells.iter().filter(|&&v| v == 0).count();
    let exact = empties <= crate::search::TRACTABLE_EMPTIES;
    let band = live_band(level);
    let values = move_values(board, band.depth);
    let class_of: fn(i32) -> i32 = if exact { i32::signum } else { capped_class };
    select_in_band(
        &values,
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
