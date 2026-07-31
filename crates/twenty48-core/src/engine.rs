//! Slide/merge mechanics + seeded spawns (RULES.md "The move" / "The spawn").

use serde::{Deserialize, Serialize};

use crate::board::{Board, Pos};
use crate::rng::DetRng;

/// A slide direction — the game's move.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum Direction {
    /// Slide toward the top.
    Up,
    /// Slide toward the bottom.
    Down,
    /// Slide toward the left.
    Left,
    /// Slide toward the right.
    Right,
}

/// Every direction, for legality/stuck checks.
pub const ALL_DIRECTIONS: [Direction; 4] = [
    Direction::Up,
    Direction::Down,
    Direction::Left,
    Direction::Right,
];

/// The effect of a slide.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct SlideReport {
    /// Whether any tile moved or merged (a slide that changes nothing is illegal).
    pub changed: bool,
    /// Score gained (the sum of the values of tiles created by merges this move).
    pub score_gain: u64,
}

/// The ordered cell positions of each line, in the direction of travel (the
/// first position in each inner list is where tiles pile up).
fn lines(board: &Board, dir: Direction) -> Vec<Vec<Pos>> {
    let (w, h) = (board.width, board.height);
    match dir {
        Direction::Left => (0..h).map(|r| (0..w).map(|c| (r, c)).collect()).collect(),
        Direction::Right => (0..h)
            .map(|r| (0..w).rev().map(|c| (r, c)).collect())
            .collect(),
        Direction::Up => (0..w).map(|c| (0..h).map(|r| (r, c)).collect()).collect(),
        Direction::Down => (0..w)
            .map(|c| (0..h).rev().map(|r| (r, c)).collect())
            .collect(),
    }
}

/// Compact + merge a single line's exponents toward index 0. Returns the new
/// line (same length, zero-padded at the end) and the score gained. Each tile
/// merges at most once per move.
fn slide_line(vals: &[u8]) -> (Vec<u8>, u64) {
    let packed: Vec<u8> = vals.iter().copied().filter(|&v| v != 0).collect();
    let mut out = Vec::with_capacity(vals.len());
    let mut gain = 0u64;
    let mut i = 0;
    while i < packed.len() {
        if i + 1 < packed.len() && packed[i] == packed[i + 1] {
            let merged = packed[i] + 1;
            out.push(merged);
            gain += 1u64 << merged; // the value of the created tile = 2^merged
            i += 2;
        } else {
            out.push(packed[i]);
            i += 1;
        }
    }
    out.resize(vals.len(), 0);
    (out, gain)
}

/// Slide the board in `dir`, merging equal adjacent tiles once each.
pub fn slide(board: &mut Board, dir: Direction) -> SlideReport {
    let mut changed = false;
    let mut score_gain = 0u64;
    for line in lines(board, dir) {
        let before: Vec<u8> = line.iter().map(|&(r, c)| board.get(r, c)).collect();
        let (after, gain) = slide_line(&before);
        if after != before {
            changed = true;
        }
        score_gain += gain;
        for (&(r, c), &v) in line.iter().zip(after.iter()) {
            board.set(r, c, v);
        }
    }
    SlideReport {
        changed,
        score_gain,
    }
}

/// Place a new tile (exponent 1 = "2" with p≈0.9, else exponent 2 = "4") at a
/// seeded empty cell. Draws position then value. Returns `false` if the board is
/// full (no spawn).
pub fn spawn(board: &mut Board, rng: &mut DetRng) -> bool {
    let empties = board.empties();
    if empties.is_empty() {
        return false;
    }
    let (r, c) = empties[rng.index(empties.len())];
    let value = if rng.index(10) < 9 { 1 } else { 2 };
    board.set(r, c, value);
    true
}

/// Whether any direction changes the board (else the game is stuck).
#[must_use]
pub fn has_any_move(board: &Board) -> bool {
    ALL_DIRECTIONS.iter().any(|&dir| {
        let mut probe = board.clone();
        slide(&mut probe, dir).changed
    })
}
