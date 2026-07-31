//! The bubble-shooter engine: the seeded deal (B1), and — landing in B2 — the
//! shot resolution (place → pop → drop) and the `Game` wrapper.

use std::collections::HashSet;

use crate::board::{Board, Cell, Pos};
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

/// What a shot did (RULES.md "The shot").
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShotReport {
    /// Bubbles removed by the connected same-colour pop (0 if the cluster was < 3).
    pub popped: usize,
    /// Bubbles removed as floating clusters after the pop.
    pub dropped: usize,
    /// Score gained: `popped + 2 * dropped`.
    pub score_gain: u64,
}

/// A shot was aimed at a cell that is not a legal landing cell.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ShotError {
    /// The target is not empty, or not reachable (top row / adjacent to a bubble).
    #[error("target is not a legal landing cell")]
    IllegalTarget,
}

/// Is `(r, c)` a legal landing cell: empty, and either in the top row or
/// adjacent to a bubble (RULES.md "Aim")?
#[must_use]
pub fn is_legal_target(board: &Board, target: Pos) -> bool {
    let (r, c) = target;
    if board.get(r, c) != Some(Cell::Empty) {
        return false;
    }
    if r == 0 {
        return true;
    }
    board
        .neighbors(r, c)
        .into_iter()
        .any(|(nr, nc)| matches!(board.get(nr, nc), Some(Cell::Bubble(_))))
}

/// Every legal landing cell on the board (the UI glows exactly these).
#[must_use]
pub fn legal_targets(board: &Board) -> Vec<Pos> {
    let mut out = Vec::new();
    for r in 0..board.height {
        for c in 0..Board::row_len(board.width, r) {
            if is_legal_target(board, (r, c)) {
                out.push((r, c));
            }
        }
    }
    out
}

/// True when the board holds no bubbles (the clear-the-board objective is met).
#[must_use]
pub fn is_cleared(board: &Board) -> bool {
    board.cells().iter().all(|&cell| cell == Cell::Empty)
}

/// The connected same-`color` cluster containing `start` (six-neighbour flood).
fn connected_same_color(board: &Board, start: Pos, color: u8) -> Vec<Pos> {
    let mut visited = HashSet::new();
    let mut out = Vec::new();
    let mut stack = vec![start];
    while let Some(p) = stack.pop() {
        if !visited.insert(p) {
            continue;
        }
        if board.get(p.0, p.1) != Some(Cell::Bubble(color)) {
            continue;
        }
        out.push(p);
        for n in board.neighbors(p.0, p.1) {
            if !visited.contains(&n) {
                stack.push(n);
            }
        }
    }
    out
}

/// Clear every bubble not connected to a filled top-row cell through filled
/// six-neighbours; return how many dropped. Membership-only set use, so the
/// result (board + count) is order-independent and deterministic.
fn drop_floating(board: &mut Board) -> usize {
    let mut connected: HashSet<Pos> = HashSet::new();
    let mut stack: Vec<Pos> = (0..Board::row_len(board.width, 0))
        .filter(|&c| matches!(board.get(0, c), Some(Cell::Bubble(_))))
        .map(|c| (0, c))
        .collect();
    while let Some(p) = stack.pop() {
        if !connected.insert(p) {
            continue;
        }
        for n in board.neighbors(p.0, p.1) {
            if matches!(board.get(n.0, n.1), Some(Cell::Bubble(_))) && !connected.contains(&n) {
                stack.push(n);
            }
        }
    }
    let mut dropped = 0;
    for r in 0..board.height {
        for c in 0..Board::row_len(board.width, r) {
            if matches!(board.get(r, c), Some(Cell::Bubble(_))) && !connected.contains(&(r, c)) {
                board.set(r, c, Cell::Empty);
                dropped += 1;
            }
        }
    }
    dropped
}

/// Fire a `color` bubble at `target`: place, pop the connected same-colour
/// cluster if ≥ 3, then drop any now-floating clusters (RULES.md "The shot").
///
/// # Errors
/// Returns `IllegalTarget` if `target` is not a legal landing cell; the board is
/// left unchanged in that case.
pub fn shoot(board: &mut Board, target: Pos, color: u8) -> Result<ShotReport, ShotError> {
    if !is_legal_target(board, target) {
        return Err(ShotError::IllegalTarget);
    }
    board.set(target.0, target.1, Cell::Bubble(color));
    let cluster = connected_same_color(board, target, color);
    let popped = if cluster.len() >= 3 {
        for &(r, c) in &cluster {
            board.set(r, c, Cell::Empty);
        }
        cluster.len()
    } else {
        0
    };
    let dropped = drop_floating(board);
    let score_gain = popped as u64 + 2 * dropped as u64;
    Ok(ShotReport {
        popped,
        dropped,
        score_gain,
    })
}

#[cfg(test)]
mod b2_tests {
    use super::*;
    use crate::board::{Board, Cell};
    use crate::hash::state_hash;

    /// A 3-wide, 3-tall board from an explicit `(r, c, color)` fill.
    fn board_3x3(filled: &[(usize, usize, u8)]) -> Board {
        let mut b = Board::new_empty(3, 3).expect("valid dims");
        for &(r, c, col) in filled {
            b.set(r, c, Cell::Bubble(col));
        }
        b
    }

    #[test]
    fn legal_targets_are_empty_and_reachable() {
        // Top rows filled deal: the row just below the filled block is reachable;
        // a deep-empty cell is not; every legal target is empty.
        let d = deal(1, 8, 11, 5, 5);
        let targets = legal_targets(&d.board);
        assert!(
            targets.contains(&(5, 0)),
            "cell below the filled block is legal"
        );
        assert!(
            !targets.contains(&(8, 3)),
            "a deep-empty, non-adjacent cell is not legal"
        );
        for &(r, c) in &targets {
            assert_eq!(
                d.board.get(r, c),
                Some(Cell::Empty),
                "({r},{c}) must be empty"
            );
        }
    }

    #[test]
    fn illegal_target_is_rejected_and_board_unchanged() {
        let mut b = board_3x3(&[(0, 0, 0)]);
        let before = b.clone();
        // (2,2) is empty, not top row, not adjacent to the single bubble at (0,0).
        assert!(!is_legal_target(&b, (2, 2)));
        assert_eq!(shoot(&mut b, (2, 2), 0), Err(ShotError::IllegalTarget));
        assert_eq!(b, before, "a rejected shot must not mutate the board");
    }

    #[test]
    fn shot_without_a_trio_just_places_the_bubble() {
        let mut b = board_3x3(&[(0, 0, 0)]);
        let rep = shoot(&mut b, (1, 0), 1).expect("legal");
        assert_eq!(
            rep,
            ShotReport {
                popped: 0,
                dropped: 0,
                score_gain: 0
            }
        );
        assert_eq!(b.get(1, 0), Some(Cell::Bubble(1)));
        assert_eq!(b.get(0, 0), Some(Cell::Bubble(0)));
    }

    #[test]
    fn shot_completing_a_trio_pops_the_cluster() {
        // (0,0),(0,1) are colour 0; firing 0 into (1,0) connects all three.
        let mut b = board_3x3(&[(0, 0, 0), (0, 1, 0)]);
        let rep = shoot(&mut b, (1, 0), 0).expect("legal");
        assert_eq!(rep.popped, 3, "the connected trio pops");
        assert_eq!(rep.dropped, 0);
        assert_eq!(rep.score_gain, 3);
        assert!(is_cleared(&b), "the board is empty after the pop");
    }

    #[test]
    fn popping_a_bridge_drops_the_now_floating_bubble() {
        // Anchor trio of colour 0 at (0,0),(0,1),(1,0); a colour-1 bubble at (2,0)
        // hangs off (1,0). Firing 0 into (1,1) pops the 4-cluster of 0s, which
        // strands (2,0) from the ceiling, so it drops.
        let mut b = board_3x3(&[(0, 0, 0), (0, 1, 0), (1, 0, 0), (2, 0, 1)]);
        let rep = shoot(&mut b, (1, 1), 0).expect("legal");
        assert_eq!(rep.popped, 4, "the 4-cluster of colour 0 pops");
        assert_eq!(rep.dropped, 1, "the stranded colour-1 bubble drops");
        assert_eq!(rep.score_gain, 4 + 2, "dropped bubbles score double");
        assert!(is_cleared(&b));
    }

    #[test]
    fn shot_pipeline_golden_hash() {
        // A fixed board + fixed shot pins the place->pop->drop->score->hash path.
        let mut b = board_3x3(&[(0, 0, 0), (0, 1, 0), (1, 0, 0), (2, 0, 1)]);
        let rep = shoot(&mut b, (1, 1), 0).expect("legal");
        let h = state_hash(&b, 5, 0, rep.score_gain);
        assert_eq!(
            h, "0b91fba92d82091d1d32307484d2f9b266db2e3ea8d9eb575bb5c6be69049f37",
            "golden shot-pipeline hash (regenerate deliberately)"
        );
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
