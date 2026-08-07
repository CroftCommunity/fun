//! Canonical state hash — the verifiable-outcome anchor.
//!
//! Lowercase-hex SHA-256 over a domain tag, the board dimensions, the
//! side-to-move byte, the drawn-edge mask, then the box-owner bytes. Every
//! integer field is little-endian, so the hash is byte-identical on native and
//! `wasm32`.
//!
//! The dimensions are hashed as `u32` so that adding a board size later is
//! **additive**: a 3x3 board keeps hashing exactly as it does today, and no
//! golden vector recorded now re-locks.

use sha2::{Digest, Sha256};

use crate::board::{owner_of, Board, COLS, ROWS};

/// The lowercase-hex SHA-256 of `board`'s canonical encoding.
#[must_use]
pub fn state_hash(board: &Board) -> String {
    let mut h = Sha256::new();
    h.update(b"dots\x00");
    h.update((ROWS as u32).to_le_bytes());
    h.update((COLS as u32).to_le_bytes());
    h.update([owner_of(board.to_move)]);
    h.update(board.edges.to_le_bytes());
    h.update(board.owners);
    hex::encode(h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::{owner_of, ALL_EDGES};
    use adversary_core::Side;

    #[test]
    fn hash_is_stable_for_equal_positions() {
        assert_eq!(state_hash(&Board::empty()), state_hash(&Board::empty()));
    }

    #[test]
    fn hash_is_lowercase_hex_sha256() {
        let h = state_hash(&Board::empty());
        assert_eq!(h.len(), 64, "SHA-256 is 32 bytes = 64 hex chars");
        assert!(
            h.chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
            "lowercase hex only, got {h}"
        );
    }

    #[test]
    fn hash_distinguishes_every_field_it_covers() {
        let base = Board::empty();

        let mut edges = base;
        edges.edges = 1;
        assert_ne!(state_hash(&base), state_hash(&edges), "drawn edges matter");

        let mut owners = base;
        owners.owners[4] = owner_of(Side::B);
        assert_ne!(state_hash(&base), state_hash(&owners), "box owners matter");

        let mut mover = base;
        mover.to_move = Side::B;
        assert_ne!(
            state_hash(&base),
            state_hash(&mover),
            "side to move matters"
        );
    }

    #[test]
    fn who_owns_a_box_changes_the_hash_even_at_the_same_edge_mask() {
        // The search's memo key is the edge mask alone, because ownership cannot
        // affect future play. The HASH is not the memo key and must still
        // separate these two positions -- they are different game states.
        let a = Board {
            edges: ALL_EDGES,
            owners: [owner_of(Side::A); 9],
            to_move: Side::A,
        };
        let mut b = a;
        b.owners[0] = owner_of(Side::B);
        assert_ne!(state_hash(&a), state_hash(&b));
    }

    #[test]
    fn hash_is_pinned_to_a_recorded_value() {
        // A golden vector: the empty board. If this changes, the wire format
        // changed and every previously shared `?r=` record stopped verifying --
        // so it changes only deliberately, with the reason recorded beside it.
        assert_eq!(
            state_hash(&Board::empty()),
            "d936e0ed1e855da2c5e97ac257433e0603ea6e11b7bddff19e4dcd830a0dc103",
            "empty-board hash is a recorded constant"
        );
    }

    #[test]
    fn dimensions_are_part_of_the_preimage() {
        // Not directly observable from outside, so this documents intent: ROWS
        // and COLS are hashed, which is what makes a future board size additive.
        assert_eq!((ROWS, COLS), (3, 3));
    }
}
