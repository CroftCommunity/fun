//! Canonical state hash — the verifiable-outcome anchor.
//!
//! Lowercase-hex SHA-256 over a domain tag, the board shape, the side-to-move
//! byte, then the fourteen seed counts in cell order. Every integer field is
//! little-endian, so the hash is byte-identical on native and `wasm32`.
//!
//! `PITS` and `SEEDS` are hashed as `u32` so that a future variant (a different
//! seed count, a wider board) is **additive**: a 6 × 4 board keeps hashing
//! exactly as it does today, and no golden vector recorded now re-locks.

use sha2::{Digest, Sha256};

use adversary_core::Side;

use crate::board::{Board, PITS, SEEDS};

/// The side byte the hash carries: `1` for A, `2` for B.
const fn side_byte(side: Side) -> u8 {
    match side {
        Side::A => 1,
        Side::B => 2,
    }
}

/// The lowercase-hex SHA-256 of `board`'s canonical encoding.
#[must_use]
pub fn state_hash(board: &Board) -> String {
    let mut h = Sha256::new();
    h.update(b"furrow\x00");
    h.update((PITS as u32).to_le_bytes());
    h.update(u32::from(SEEDS).to_le_bytes());
    h.update([side_byte(board.to_move)]);
    h.update(board.cells);
    hex::encode(h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::A_STORE;

    #[test]
    fn hash_is_stable_for_equal_positions() {
        assert_eq!(state_hash(&Board::opening()), state_hash(&Board::opening()));
    }

    #[test]
    fn hash_is_lowercase_hex_sha256() {
        let h = state_hash(&Board::opening());
        assert_eq!(h.len(), 64, "SHA-256 is 32 bytes = 64 hex chars");
        assert!(
            h.chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
            "lowercase hex only, got {h}"
        );
    }

    #[test]
    fn hash_distinguishes_every_field_it_covers() {
        let base = Board::opening();

        let mut sown = base;
        sown.cells[0] = 0;
        sown.cells[1] = 5;
        assert_ne!(state_hash(&base), state_hash(&sown), "pit counts matter");

        let mut banked = base;
        banked.cells[A_STORE] = 1;
        assert_ne!(state_hash(&base), state_hash(&banked), "stores matter");

        let mut mover = base;
        mover.to_move = Side::B;
        assert_ne!(
            state_hash(&base),
            state_hash(&mover),
            "side to move matters"
        );
    }

    #[test]
    fn two_boards_with_the_same_seeds_in_different_pits_hash_differently() {
        // The check a sum-based encoding would fail. One move writes to many
        // cells here, so an encoding that collapsed the row would call a whole
        // family of distinct positions the same one.
        let mut a = Board::opening();
        let mut b = Board::opening();
        a.cells[0] = 3;
        a.cells[1] = 5;
        b.cells[0] = 5;
        b.cells[1] = 3;
        assert_ne!(state_hash(&a), state_hash(&b));
    }

    #[test]
    fn hash_is_pinned_to_a_recorded_value() {
        // A golden vector: the opening. If this changes, the wire format changed
        // and every previously shared `?r=` record stopped verifying -- so it
        // changes only deliberately, with the reason recorded beside it.
        assert_eq!(
            state_hash(&Board::opening()),
            "d7e6907aed394dc49fc51c19cb7262c13458fb0a89c6c748ff2959223bbc26d8",
            "opening-board hash is a recorded constant"
        );
    }

    #[test]
    fn the_board_shape_is_part_of_the_preimage() {
        // Not observable from outside, so this documents intent: PITS and SEEDS
        // are hashed, which is what makes a future variant additive.
        assert_eq!((PITS, SEEDS), (6, 4));
    }
}
