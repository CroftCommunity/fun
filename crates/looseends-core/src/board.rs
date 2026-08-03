//! The board model — arrows over a grid, the FREE test, and release.
//!
//! An arrow occupies a 4-connected self-avoiding path of cells ordered
//! **tail → head**; `dir` is the unit step onto the head cell. An arrow is
//! **FREE** iff the straight ray from `head + dir` to the board edge is clear of
//! every other still-present arrow. Releasing it clears its cells immediately,
//! so the next release sees the updated board (matching the animated game, where
//! occupancy frees the moment a slide starts).

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
}

impl Board {
    /// Build a live board from generated geometry. Cells are laid into occupancy
    /// by id; overlapping input is a programming error (the generator never
    /// produces it), and later cells simply win.
    #[must_use]
    pub fn new(w: i32, h: i32, arrows: Vec<Arrow>) -> Self {
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

    #[inline]
    fn in_bounds(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.w && y < self.h
    }

    /// Is arrow `id` FREE? Walks the exit ray from `head + dir`; FREE iff every
    /// visited cell is empty. A missing / already-released arrow is not FREE.
    #[must_use]
    pub fn is_free(&self, id: usize) -> bool {
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
    /// [`ReleaseError`] if the id is unknown, already gone, or blocked.
    pub fn release(&mut self, id: usize) -> Result<(), ReleaseError> {
        if id >= self.arrows.len() {
            return Err(ReleaseError::NoSuchArrow);
        }
        if !self.present[id] {
            return Err(ReleaseError::AlreadyGone);
        }
        if !self.is_free(id) {
            return Err(ReleaseError::Blocked);
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
