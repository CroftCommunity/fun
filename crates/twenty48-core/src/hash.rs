//! Canonical state hash — the verifiable-outcome anchor (RULES.md "State hash").

use sha2::{Digest, Sha256};

use crate::board::Board;

/// Lowercase-hex SHA-256 over the canonical encoding: a domain tag, the board
/// dimensions, the RNG draw count (so the spawn stream position is bound), the
/// score, then the row-major cell exponents. Integer fields are little-endian
/// `u32`/`u64`, so the hash is byte-identical on native and `wasm32`.
#[must_use]
pub fn state_hash(board: &Board, draws: u64, score: u64) -> String {
    let mut h = Sha256::new();
    h.update(b"t48\x00");
    h.update((board.width as u32).to_le_bytes());
    h.update((board.height as u32).to_le_bytes());
    h.update(draws.to_le_bytes());
    h.update(score.to_le_bytes());
    h.update(board.cells());
    hex::encode(h.finalize())
}
