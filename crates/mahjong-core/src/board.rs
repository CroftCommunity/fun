//! A board: a layout with a face in each slot and a present/removed flag, plus
//! the two rules that decide everything — FREE and the legal pair.

use thiserror::Error;

use crate::layout::Layout;
use crate::tiles::{matches, Face};

/// Why a removal was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum MoveError {
    /// The slot id is not on this layout.
    #[error("no such slot")]
    NoSuchSlot,
    /// The tile was already removed.
    #[error("tile already removed")]
    Gone,
    /// The tile is covered or touched on both long sides.
    #[error("tile is not free")]
    Blocked,
    /// The two faces do not match.
    #[error("faces do not match")]
    NoMatch,
    /// A pair needs two distinct slots.
    #[error("a pair needs two different tiles")]
    SameSlot,
    /// The shuffle found no arrangement (never observed; kept honest).
    #[error("the shuffle found no arrangement")]
    Redeal,
}

/// The tiles on a layout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Board {
    layout: Layout,
    faces: Vec<Face>,
    present: Vec<bool>,
}

impl Board {
    /// A full board: one face per slot, in slot order.
    ///
    /// # Panics
    /// If `faces.len()` is not the layout's slot count — a programming error,
    /// never a runtime input (deals come from the generator).
    #[must_use]
    pub fn new(layout: Layout, faces: Vec<Face>) -> Self {
        assert_eq!(faces.len(), layout.len(), "one face per slot");
        let present = vec![true; faces.len()];
        Self {
            layout,
            faces,
            present,
        }
    }

    /// The layout.
    #[must_use]
    pub fn layout(&self) -> &Layout {
        &self.layout
    }

    /// The face in `slot` (present or not).
    #[must_use]
    pub fn face(&self, slot: usize) -> Face {
        self.faces[slot]
    }

    /// Every face, in slot order.
    #[must_use]
    pub fn faces(&self) -> &[Face] {
        &self.faces
    }

    /// Whether the tile in `slot` is still on the board.
    #[must_use]
    pub fn is_present(&self, slot: usize) -> bool {
        self.present.get(slot).copied().unwrap_or(false)
    }

    /// Tiles still on the board.
    #[must_use]
    pub fn remaining(&self) -> usize {
        self.present.iter().filter(|&&p| p).count()
    }

    /// Whether every tile is gone.
    #[must_use]
    pub fn is_cleared(&self) -> bool {
        self.remaining() == 0
    }

    /// The FREE predicate: present, nothing on top (not even partially), and at
    /// least one long side with no present tile touching it.
    #[must_use]
    pub fn is_free(&self, slot: usize) -> bool {
        if !self.is_present(slot) {
            return false;
        }
        let l = &self.layout;
        if l.above[slot].iter().any(|&j| self.present[j]) {
            return false;
        }
        let touched = |side: &[usize]| side.iter().any(|&j| self.present[j]);
        !touched(&l.left[slot]) || !touched(&l.right[slot])
    }

    /// The ids of every free tile.
    #[must_use]
    pub fn free_slots(&self) -> Vec<usize> {
        (0..self.faces.len()).filter(|&i| self.is_free(i)).collect()
    }

    /// The free tiles that could pair with `slot` (which need not itself be free).
    #[must_use]
    pub fn matches_for(&self, slot: usize) -> Vec<usize> {
        if !self.is_present(slot) {
            return Vec::new();
        }
        let face = self.faces[slot];
        self.free_slots()
            .into_iter()
            .filter(|&j| j != slot && matches(face, self.faces[j]))
            .collect()
    }

    /// Every legal pair `(a, b)` with `a < b`.
    #[must_use]
    pub fn legal_moves(&self) -> Vec<(usize, usize)> {
        let free = self.free_slots();
        let mut out = Vec::new();
        for (i, &a) in free.iter().enumerate() {
            for &b in &free[i + 1..] {
                if matches(self.faces[a], self.faces[b]) {
                    out.push((a, b));
                }
            }
        }
        out
    }

    /// Whether the position has no legal pair but tiles remain.
    #[must_use]
    pub fn is_stuck(&self) -> bool {
        !self.is_cleared() && self.legal_moves().is_empty()
    }

    /// Remove one free tile (the generator and the tests use this; play goes
    /// through [`Board::remove_pair`]).
    ///
    /// # Errors
    /// [`MoveError::NoSuchSlot`], [`MoveError::Gone`] or [`MoveError::Blocked`].
    pub fn remove(&mut self, slot: usize) -> Result<(), MoveError> {
        if slot >= self.faces.len() {
            return Err(MoveError::NoSuchSlot);
        }
        if !self.present[slot] {
            return Err(MoveError::Gone);
        }
        if !self.is_free(slot) {
            return Err(MoveError::Blocked);
        }
        self.present[slot] = false;
        Ok(())
    }

    /// Remove a matching pair of free tiles.
    ///
    /// # Errors
    /// Any [`MoveError`]; on error the board is unchanged.
    pub fn remove_pair(&mut self, a: usize, b: usize) -> Result<(), MoveError> {
        if a == b {
            return Err(MoveError::SameSlot);
        }
        for s in [a, b] {
            if s >= self.faces.len() {
                return Err(MoveError::NoSuchSlot);
            }
            if !self.present[s] {
                return Err(MoveError::Gone);
            }
            if !self.is_free(s) {
                return Err(MoveError::Blocked);
            }
        }
        if !matches(self.faces[a], self.faces[b]) {
            return Err(MoveError::NoMatch);
        }
        self.present[a] = false;
        self.present[b] = false;
        Ok(())
    }

    /// Replace the faces of the present tiles (the shuffle). `assign` maps a
    /// present slot id to its new face; every present slot must be covered.
    pub(crate) fn reface(&mut self, assign: &[(usize, Face)]) {
        for &(slot, face) in assign {
            self.faces[slot] = face;
        }
    }

    /// The present flags, in slot order.
    #[must_use]
    pub fn present(&self) -> &[bool] {
        &self.present
    }

    /// A canonical byte encoding: per slot the face id, or `0xFF` when removed.
    #[must_use]
    pub fn occupancy_bytes(&self) -> Vec<u8> {
        self.faces
            .iter()
            .zip(&self.present)
            .map(|(f, &p)| if p { f.0 } else { 0xFF })
            .collect()
    }
}
