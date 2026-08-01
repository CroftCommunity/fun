//! Canonical state hash — the verifiable-outcome anchor.
//!
//! Lowercase-hex SHA-256 over a domain tag, the board dimensions, the
//! side-to-move byte, then the row-major cell bytes. Every integer field is
//! little-endian, so the hash is byte-identical on native and `wasm32`.

use sha2::{Digest, Sha256};

use crate::board::{Board, HEIGHT, WIDTH};

/// The lowercase-hex SHA-256 of `board`'s canonical encoding.
#[must_use]
pub fn state_hash(board: &Board) -> String {
    let mut h = Sha256::new();
    h.update(b"drop4\x00");
    h.update((WIDTH as u32).to_le_bytes());
    h.update((HEIGHT as u32).to_le_bytes());
    h.update([crate::board::cell_of(board.to_move)]);
    h.update(board.cells);
    hex::encode(h.finalize())
}
