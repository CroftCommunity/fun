//! Alpha-beta search over the [`crate::eval`] heuristic, with an **exact full
//! solve in the deep endgame**. Othello is not solved from the opening, so the
//! search is heuristic (horizon-capped) early and exact (searched to a terminal,
//! scored by disc differential) once few enough cells remain. The
//! [`TRACTABLE_EMPTIES`] switch is the same honesty boundary the tutor and the
//! difficulty band use.

use othello_core::{apply_move, legal_moves, result, Board, Move};

use crate::eval::{heuristic, WEIGHTS};

/// Empties at or below which an exact full solve is cheap enough to be the
/// oracle — searched to a terminal and scored by disc differential (provably
/// right). Above it, the search is depth-capped and horizon-approximate.
///
/// Conservative for the browser: the shipped solve runs in wasm (slower than a
/// native `cargo` measurement), so this is chosen below the native breakpoint.
/// Phase 3 validates the in-wasm wall-clock; see the plan's D2.
pub const TRACTABLE_EMPTIES: usize = 10;

/// Terminal disc-differentials are scaled so a *proven* endgame result outranks
/// any horizon heuristic score near the exact/capped boundary.
const TERMINAL_SCALE: i32 = 100;

/// Difficulty levels — a search depth and (via [`crate::live::live_band`]) a
/// class floor + sloppiness. Othello is unsolved, so even Expert is a strong
/// heuristic player, not a perfect oracle (except in the exact endgame).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    /// Shallow, sloppy, beatable.
    Easy,
    /// Moderate depth.
    Medium,
    /// Deep, class-preserving.
    Hard,
    /// Deepest, tightest.
    Expert,
}

impl Level {
    /// The capped search depth for this level.
    #[must_use]
    pub fn depth(self) -> u32 {
        match self {
            Level::Easy => 1,
            Level::Medium => 3,
            Level::Hard => 5,
            Level::Expert => 7,
        }
    }
}

/// The terminal value from the side-to-move's perspective: the scaled disc
/// differential (positive when the side to move has the majority).
fn terminal_value(board: &Board) -> i32 {
    let me = board.count(board.to_move) as i32;
    let them = board.count(board.to_move.other()) as i32;
    TERMINAL_SCALE * (me - them)
}

/// Legal moves ordered best-first (highest static weight) to sharpen alpha-beta.
/// A lone `Pass` is returned as-is.
fn ordered_moves(board: &Board) -> Vec<Move> {
    let mut moves = legal_moves(board);
    moves.sort_by_key(|m| match m {
        Move::Place(idx) => -WEIGHTS[*idx as usize],
        Move::Pass => 0,
    });
    moves
}

/// Negamax with alpha-beta. Returns the value from `board.to_move`'s perspective.
/// In the exact region (empties ≤ [`TRACTABLE_EMPTIES`]) it ignores `depth` and
/// searches to a terminal; otherwise it cuts off at `depth == 0` with the
/// heuristic.
fn negamax(board: &Board, depth: u32, mut alpha: i32, beta: i32) -> i32 {
    if result(board).is_some() {
        return terminal_value(board);
    }
    let empties = board.cells.iter().filter(|&&v| v == 0).count();
    let exact = empties <= TRACTABLE_EMPTIES;
    if !exact && depth == 0 {
        return heuristic(board);
    }
    let next_depth = depth.saturating_sub(1);
    let mut best = i32::MIN + 1;
    for mv in ordered_moves(board) {
        let score = -negamax(&apply_move(board, mv), next_depth, -beta, -alpha);
        if score > best {
            best = score;
        }
        if best > alpha {
            alpha = best;
        }
        if alpha >= beta {
            break;
        }
    }
    best
}

/// The value of every legal move to `depth` (side-to-move perspective; higher is
/// better). Exact disc-differentials in the endgame, horizon heuristic earlier.
/// Empty if the position is terminal.
#[must_use]
pub fn move_values(board: &Board, depth: u32) -> Vec<(Move, i32)> {
    legal_moves(board)
        .into_iter()
        .map(|mv| {
            let v = -negamax(
                &apply_move(board, mv),
                depth.saturating_sub(1),
                i32::MIN + 1,
                i32::MAX - 1,
            );
            (mv, v)
        })
        .collect()
}

/// The best move to `depth` (the highest-valued; the first on a tie), or `None`
/// if the position is terminal.
#[must_use]
pub fn best_move(board: &Board, depth: u32) -> Option<Move> {
    move_values(board, depth)
        .into_iter()
        .reduce(|a, b| if b.1 > a.1 { b } else { a })
        .map(|(mv, _)| mv)
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::{Adversary, MatchResult, Side};
    use othello_core::{legal_places, Othello, CELLS};
    use rand_chacha::rand_core::{RngCore, SeedableRng};
    use rand_chacha::ChaCha20Rng;

    /// An independent, plain (no alpha-beta) exact minimax — the cross-check the
    /// endgame solver must agree with on a tractable position.
    fn ref_exact(board: &Board) -> i32 {
        if result(board).is_some() {
            let me = board.count(board.to_move) as i32;
            let them = board.count(board.to_move.other()) as i32;
            return TERMINAL_SCALE * (me - them);
        }
        legal_moves(board)
            .into_iter()
            .map(|mv| -ref_exact(&apply_move(board, mv)))
            .max()
            .unwrap()
    }

    #[test]
    fn heuristic_player_clearly_beats_random() {
        // A modest-depth heuristic as A vs a seeded-random B, over several games.
        // Depth 3 already crushes random and keeps the debug test fast (the deep
        // levels are exercised by the responsiveness test and live play).
        let depth = Level::Medium.depth();
        let mut wins = 0;
        for seed in 0..8u64 {
            let mut rng = ChaCha20Rng::seed_from_u64(seed);
            let mut pos = <Othello as Adversary>::initial(0);
            while result(&pos).is_none() {
                let mv = if pos.to_move == Side::A {
                    best_move(&pos, depth).unwrap()
                } else {
                    let l = legal_moves(&pos);
                    l[(rng.next_u32() as usize) % l.len()]
                };
                pos = apply_move(&pos, mv);
            }
            if result(&pos) == Some(MatchResult::WinA) {
                wins += 1;
            }
        }
        assert!(wins >= 6, "heuristic should crush random (won {wins}/8)");
    }

    #[test]
    fn exact_endgame_agrees_with_an_independent_minimax() {
        // Reach a position with few empties by first-legal play, then confirm the
        // alpha-beta exact values equal a plain minimax's on every legal move.
        let mut pos = <Othello as Adversary>::initial(0);
        while pos.cells.iter().filter(|&&v| v == 0).count() > TRACTABLE_EMPTIES {
            let mv = legal_moves(&pos)[0];
            pos = apply_move(&pos, mv);
            if result(&pos).is_some() {
                break;
            }
        }
        assert!(result(&pos).is_none(), "stopped at a live endgame position");
        assert!(pos.cells.iter().filter(|&&v| v == 0).count() <= TRACTABLE_EMPTIES);
        for (mv, v) in move_values(&pos, 0) {
            let reference = -ref_exact(&apply_move(&pos, mv));
            assert_eq!(
                v, reference,
                "exact value must match the independent minimax for {mv:?}"
            );
        }
    }

    #[test]
    fn responsive_from_the_opening() {
        let pos = <Othello as Adversary>::initial(0);
        let t = std::time::Instant::now();
        let mv = best_move(&pos, Level::Expert.depth());
        let ms = t.elapsed().as_millis();
        assert!(mv.is_some(), "returns a move from the opening");
        assert!(ms < 5000, "Expert opening move took {ms}ms (debug bound)");
    }

    #[test]
    fn takes_a_free_corner_over_a_c_square() {
        // A can play the (0,0) corner (flips (0,1)) or a C-square at (1,0) (flips
        // (2,0)). The corner is permanent and far stronger — the engine takes it.
        let mut cells = [0u8; CELLS];
        cells[2] = 1; // (0,2) A
        cells[1] = 2; // (0,1) B  -> A at (0,0) flips it (corner move)
        cells[24] = 1; // (3,0) A
        cells[16] = 2; // (2,0) B -> A at (1,0)=idx8 flips it (C-square move)
        let board = Board {
            cells,
            to_move: Side::A,
        };
        assert!(
            legal_places(&board).contains(&0),
            "the corner is a legal move"
        );
        assert!(
            legal_places(&board).contains(&8),
            "the C-square is a legal move"
        );
        assert_eq!(
            best_move(&board, Level::Hard.depth()),
            Some(Move::Place(0)),
            "takes the corner"
        );
    }
}
