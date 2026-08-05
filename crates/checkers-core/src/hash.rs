//! Canonical state hash — the verifiable-outcome anchor.
//!
//! Lowercase-hex SHA-256 over a domain tag, the playable-square count, the
//! side-to-move byte, the 32 square bytes, and the no-progress counter. Every
//! integer field is little-endian, so the hash is byte-identical on native and
//! `wasm32`.
//!
//! The counter is in the hash because it is **position state**: two boards with
//! identical men and the same side to move have different legal futures if one is
//! closer to the no-progress draw than the other. Leaving it out would let two
//! genuinely different states share a hash — and a transposition table keyed on
//! that hash would then answer from the wrong position.

use adversary_core::Side;
use sha2::{Digest, Sha256};

use crate::board::{Board, SQUARES};

/// The byte the side-to-move contributes to the hash.
fn side_byte(side: Side) -> u8 {
    match side {
        Side::A => 1,
        Side::B => 2,
    }
}

/// The lowercase-hex SHA-256 of `board`'s canonical encoding.
#[must_use]
pub fn state_hash(board: &Board) -> String {
    let mut h = Sha256::new();
    h.update(b"checkers\x00");
    h.update((SQUARES as u32).to_le_bytes());
    h.update([side_byte(board.to_move)]);
    h.update(board.cells);
    h.update(board.no_progress.to_le_bytes());
    hex::encode(h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hash_is_stable_and_covers_every_field_of_the_position() {
        let a = Board::start();
        assert_eq!(state_hash(&a), state_hash(&Board::start()), "stable");

        // Whose turn it is is part of the position, not a presentational detail:
        // the same men with the other side to move is a different game state.
        let mut other_side = a;
        other_side.to_move = Side::B;
        assert_ne!(state_hash(&a), state_hash(&other_side), "to_move is hashed");

        let mut moved = a;
        moved.cells[8] = 0;
        moved.cells[12] = 1;
        assert_ne!(state_hash(&a), state_hash(&moved), "the squares are hashed");
    }
}
