//! The board model — arrows over a grid, the FREE test, and release.
//!
//! An arrow occupies a 4-connected self-avoiding path of cells ordered
//! **tail → head**; `dir` is the unit step onto the head cell. An arrow is
//! **FREE** iff the straight ray from `head + dir` to the board edge is clear of
//! every other still-present arrow. Releasing it clears its cells immediately,
//! so the next release sees the updated board (matching the animated game, where
//! occupancy frees the moment a slide starts).
//!
//! **Locks** (plan 2026-09-08): a board may carry `(locked, key)` pairs. The
//! locked arrow is not FREE while its key is still on the board — ray clear or
//! not — and unlocks the instant the key is released. A lock is geometry, a
//! function of the seed like the arrows; it never enters the state hash, whose
//! occupancy already says whether the key is present.

use serde::{Deserialize, Serialize};

/// One arrow: its body path (tail → head) and head direction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Arrow {
    /// Cells `[[x, y], ...]` ordered tail → head; 4-connected, self-avoiding.
    pub cells: Vec<[i32; 2]>,
    /// Unit head direction `[dx, dy]` (the step from `cells[len-2]` to the head).
    pub dir: [i32; 2],
}

impl Arrow {
    /// The head cell (last in `cells`).
    #[must_use]
    pub fn head(&self) -> [i32; 2] {
        *self.cells.last().expect("an arrow has at least two cells")
    }
}

/// Why a release did not happen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ReleaseError {
    /// The id is out of range.
    #[error("no such arrow")]
    NoSuchArrow,
    /// The arrow was already released.
    #[error("arrow already released")]
    AlreadyGone,
    /// The arrow's exit ray is not clear.
    #[error("arrow is blocked")]
    Blocked,
    /// The ray is clear but the arrow is locked: its key (the id carried) is
    /// still on the board. Information for the player, not a mistake.
    #[error("arrow is locked by arrow {0}")]
    Locked(usize),
}

/// A live board: fixed arrow geometry plus which arrows are still present.
#[derive(Debug, Clone)]
pub struct Board {
    w: i32,
    h: i32,
    arrows: Vec<Arrow>,
    /// `w*h` occupancy: arrow id, or `-1` for empty.
    occ: Vec<i32>,
    /// Per-arrow present flag (`false` once released).
    present: Vec<bool>,
    remaining: usize,
    /// `(locked, key)` pairs: `locked` stays put while `key` is present.
    locks: Vec<(usize, usize)>,
}

impl Board {
    /// Build a live board from generated geometry. Cells are laid into occupancy
    /// by id; overlapping input is a programming error (the generator never
    /// produces it), and later cells simply win.
    #[must_use]
    pub fn new(w: i32, h: i32, arrows: Vec<Arrow>) -> Self {
        Self::with_locks(w, h, arrows, Vec::new())
    }

    /// [`Board::new`] plus `(locked, key)` pairs. A pair naming an id that does
    /// not exist holds nothing (a key that is not present is a key that is gone).
    #[must_use]
    pub fn with_locks(w: i32, h: i32, arrows: Vec<Arrow>, locks: Vec<(usize, usize)>) -> Self {
        let mut occ = vec![-1i32; (w * h) as usize];
        for (id, a) in arrows.iter().enumerate() {
            for c in &a.cells {
                occ[(c[1] * w + c[0]) as usize] = id as i32;
            }
        }
        let n = arrows.len();
        Self {
            w,
            h,
            arrows,
            occ,
            present: vec![true; n],
            remaining: n,
            locks,
        }
    }

    /// Grid width.
    #[must_use]
    pub fn width(&self) -> i32 {
        self.w
    }
    /// Grid height.
    #[must_use]
    pub fn height(&self) -> i32 {
        self.h
    }
    /// The arrow geometry, by id.
    #[must_use]
    pub fn arrows(&self) -> &[Arrow] {
        &self.arrows
    }
    /// Whether arrow `id` is still on the board.
    #[must_use]
    pub fn is_present(&self, id: usize) -> bool {
        self.present.get(id).copied().unwrap_or(false)
    }
    /// How many arrows remain.
    #[must_use]
    pub fn remaining(&self) -> usize {
        self.remaining
    }
    /// Whether the board is clear (a win).
    #[must_use]
    pub fn is_cleared(&self) -> bool {
        self.remaining == 0
    }
    /// The `(locked, key)` pairs, as generated.
    #[must_use]
    pub fn locks(&self) -> &[(usize, usize)] {
        &self.locks
    }
    /// The key still holding arrow `id` in place, if any.
    #[must_use]
    pub fn key_of(&self, id: usize) -> Option<usize> {
        self.locks
            .iter()
            .find(|&&(locked, key)| locked == id && self.is_present(key))
            .map(|&(_, key)| key)
    }

    #[inline]
    fn in_bounds(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.w && y < self.h
    }

    /// Is arrow `id` FREE? Its exit ray is clear ([`Board::ray_clear`]) and no
    /// key holds it. A missing / already-released arrow is not FREE.
    #[must_use]
    pub fn is_free(&self, id: usize) -> bool {
        self.ray_clear(id) && self.key_of(id).is_none()
    }

    /// Is arrow `id`'s exit ray clear? Walks from `head + dir` to the edge; clear
    /// iff every visited cell is empty. Ignores locks; a missing / already-
    /// released arrow has no ray.
    #[must_use]
    pub fn ray_clear(&self, id: usize) -> bool {
        if !self.is_present(id) {
            return false;
        }
        let a = &self.arrows[id];
        let [hx, hy] = a.head();
        let [dx, dy] = a.dir;
        let (mut x, mut y) = (hx + dx, hy + dy);
        while self.in_bounds(x, y) {
            if self.occ[(y * self.w + x) as usize] != -1 {
                return false;
            }
            x += dx;
            y += dy;
        }
        true
    }

    /// Every currently-FREE arrow id, ascending.
    #[must_use]
    pub fn free_arrows(&self) -> Vec<usize> {
        (0..self.arrows.len())
            .filter(|&id| self.is_free(id))
            .collect()
    }

    /// Release arrow `id` if it is FREE. Clears its cells from occupancy and
    /// decrements the remaining count.
    ///
    /// # Errors
    /// [`ReleaseError`] if the id is unknown, already gone, blocked, or locked.
    /// A blocked ray is reported before a lock: the ray is the visible fault.
    pub fn release(&mut self, id: usize) -> Result<(), ReleaseError> {
        if id >= self.arrows.len() {
            return Err(ReleaseError::NoSuchArrow);
        }
        if !self.present[id] {
            return Err(ReleaseError::AlreadyGone);
        }
        if !self.ray_clear(id) {
            return Err(ReleaseError::Blocked);
        }
        if let Some(key) = self.key_of(id) {
            return Err(ReleaseError::Locked(key));
        }
        for c in &self.arrows[id].cells {
            self.occ[(c[1] * self.w + c[0]) as usize] = -1;
        }
        self.present[id] = false;
        self.remaining -= 1;
        Ok(())
    }

    /// The canonical occupancy bytes (row-major `i32` LE per cell) for hashing.
    #[must_use]
    pub fn occupancy_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.occ.len() * 4);
        for v in &self.occ {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out
    }

    /// Greedily release every FREE arrow until none remain (used by the
    /// solvability proof and as the reference solver). Returns the release order.
    pub fn greedy_solve(&mut self) -> Vec<usize> {
        let mut order = Vec::new();
        loop {
            let free = self.free_arrows();
            if free.is_empty() {
                break;
            }
            for id in free {
                if self.release(id).is_ok() {
                    order.push(id);
                }
            }
        }
        order
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arrow(cells: &[[i32; 2]], dir: [i32; 2]) -> Arrow {
        Arrow {
            cells: cells.to_vec(),
            dir,
        }
    }

    #[test]
    fn free_when_ray_clear_blocked_when_not() {
        // Two horizontal arrows on a 5-wide row: A at x0..1 pointing right into
        // B at x3..4. A's ray hits B, so A is blocked; B points right off-board.
        let a = arrow(&[[0, 0], [1, 0]], [1, 0]); // head (1,0) dir +x -> ray hits x2,x3(B)
        let b = arrow(&[[3, 0], [4, 0]], [1, 0]); // head (4,0) dir +x -> off board
        let mut board = Board::new(5, 1, vec![a, b]);
        assert!(!board.is_free(0), "A's ray runs into B");
        assert!(board.is_free(1), "B's ray exits the board");

        // Releasing B clears the row; now A is free.
        board.release(1).expect("B is free");
        assert!(board.is_free(0), "A is free once B is gone");
        assert_eq!(board.remaining(), 1);
    }

    // ---- Locks (plan 2026-09-08, phase 1): a locked arrow needs its key freed first ----

    /// A 5×2 board: A across row 0 with a clear ray to the right, K under it on
    /// row 1 (their bodies touch), and A locked by K.
    fn locked_pair() -> Board {
        let a = arrow(&[[0, 0], [1, 0]], [1, 0]);
        let k = arrow(&[[0, 1], [1, 1]], [1, 0]);
        Board::with_locks(5, 2, vec![a, k], vec![(0, 1)])
    }

    #[test]
    fn a_locked_arrow_with_a_clear_ray_is_not_free_until_its_key_goes() {
        let mut board = locked_pair();
        assert!(!board.is_free(0), "A's ray is clear but K holds it");
        assert!(board.is_free(1), "K itself is free");
        assert_eq!(board.free_arrows(), vec![1]);
        assert_eq!(
            board.release(0),
            Err(ReleaseError::Locked(1)),
            "the error names the key"
        );
        assert_eq!(board.remaining(), 2, "a locked tap changes nothing");
        board.release(1).expect("the key is free");
        assert!(board.is_free(0), "the lock falls off with its key");
        board.release(0).expect("unlocked, ray clear");
        assert!(board.is_cleared());
    }

    #[test]
    fn a_locked_arrow_whose_ray_is_blocked_reports_blocked_not_locked() {
        // A on row 0 runs into B; K under A locks it. The ray is the visible
        // fault, so the tap is a mistake (Q2), not a lock lesson.
        let a = arrow(&[[0, 0], [1, 0]], [1, 0]);
        let b = arrow(&[[3, 0], [4, 0]], [1, 0]);
        let k = arrow(&[[0, 1], [1, 1]], [1, 0]);
        let mut board = Board::with_locks(5, 2, vec![a, b, k], vec![(0, 2)]);
        assert_eq!(board.release(0), Err(ReleaseError::Blocked));
        board.release(1).expect("B is free");
        assert_eq!(
            board.release(0),
            Err(ReleaseError::Locked(2)),
            "ray clear, still locked"
        );
    }

    #[test]
    fn a_lock_on_a_gone_or_unknown_key_is_inert() {
        let a = arrow(&[[0, 0], [1, 0]], [1, 0]);
        let k = arrow(&[[0, 1], [1, 1]], [1, 0]);
        let board = Board::with_locks(5, 2, vec![a.clone(), k.clone()], vec![(0, 99)]);
        assert!(board.is_free(0), "a key that does not exist holds nothing");
        assert_eq!(board.key_of(0), None);

        let mut board = Board::with_locks(5, 2, vec![a, k], vec![(0, 1)]);
        assert_eq!(board.key_of(0), Some(1));
        assert_eq!(board.key_of(1), None, "the key is not itself locked");
        board.release(1).expect("K is free");
        assert_eq!(board.key_of(0), None, "a released key holds nothing");
        assert!(board.is_free(0));
    }

    #[test]
    fn locks_are_readable_and_never_enter_the_hash() {
        use crate::hash::state_hash;
        let plain = Board::new(5, 2, locked_pair().arrows().to_vec());
        let locked = locked_pair();
        assert_eq!(locked.locks(), &[(0, 1)]);
        assert_eq!(plain.locks(), &[]);
        assert_eq!(
            state_hash(&plain),
            state_hash(&locked),
            "a lock is a function of the seed, not state"
        );
        let mut plain = plain;
        let mut locked = locked;
        plain.release(1).expect("free");
        locked.release(1).expect("free");
        assert_eq!(
            state_hash(&plain),
            state_hash(&locked),
            "and stays out after a release"
        );
    }

    #[test]
    fn greedy_solve_releases_the_key_before_the_lock() {
        // A (id 0) is ray-free from the start but locked by K (id 2), whose ray
        // runs into B (id 1). The only order that clears is B, K, A.
        let a = arrow(&[[0, 0], [1, 0]], [1, 0]);
        let b = arrow(&[[3, 1], [4, 1]], [0, 1]);
        let k = arrow(&[[0, 1], [1, 1]], [1, 0]);
        let mut board = Board::with_locks(5, 2, vec![a, b, k], vec![(0, 2)]);
        assert_eq!(board.greedy_solve(), vec![1, 2, 0]);
        assert!(board.is_cleared());
    }

    #[test]
    fn release_errors_are_reported_not_panicked() {
        let a = arrow(&[[0, 0], [1, 0]], [1, 0]);
        let b = arrow(&[[3, 0], [4, 0]], [1, 0]);
        let mut board = Board::new(5, 1, vec![a, b]);
        assert_eq!(board.release(0), Err(ReleaseError::Blocked));
        assert_eq!(board.release(9), Err(ReleaseError::NoSuchArrow));
        board.release(1).expect("free");
        assert_eq!(board.release(1), Err(ReleaseError::AlreadyGone));
    }
}
