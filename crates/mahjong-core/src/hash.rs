//! Canonical state hash — the verifiable-outcome anchor.

use sha2::{Digest, Sha256};

use crate::board::Board;

/// Lowercase-hex SHA-256 over a domain tag, the layout id and size, the count
/// of tiles remaining, then per slot the face id or `0xFF` when removed. Every
/// integer is a byte or little-endian, so native and `wasm32` agree. A cleared
/// board hashes to one value per layout.
#[must_use]
pub fn state_hash(board: &Board) -> String {
    let l = board.layout();
    let mut h = Sha256::new();
    h.update(b"mahjong\x00");
    h.update([l.id as u8, l.width, l.height]);
    h.update((board.remaining() as u32).to_le_bytes());
    h.update(board.occupancy_bytes());
    hex::encode(h.finalize())
}
