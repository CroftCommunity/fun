//! Canonical state hash — the verifiable-outcome anchor.

use sha2::{Digest, Sha256};

use crate::board::Board;

/// Lowercase-hex SHA-256 over a canonical encoding: a domain tag, the board
/// dimensions, the count of arrows still present, then the row-major occupancy
/// (`i32` LE per cell: arrow id, or `-1` for empty). Integer fields are
/// little-endian, so the hash is byte-identical on native and `wasm32`. A
/// cleared board (all `-1`) hashes to one fixed value per size.
#[must_use]
pub fn state_hash(board: &Board) -> String {
    let mut h = Sha256::new();
    h.update(b"loose\x00");
    h.update(board.width().to_le_bytes());
    h.update(board.height().to_le_bytes());
    h.update((board.remaining() as u32).to_le_bytes());
    h.update(board.occupancy_bytes());
    hex::encode(h.finalize())
}
