//! Canonical state hash — the verifiable-outcome anchor (§ RULES "State hash").

use sha2::{Digest, Sha256};

use crate::board::{Board, SIZE};

/// Lowercase-hex SHA-256 over the canonical encoding: a domain tag, the board
/// size, the RNG draw count (so the deal-stream position is bound), the score,
/// then the row-major occupancy cells. Integer fields are little-endian, so the
/// hash is byte-identical on native and `wasm32`.
///
/// The encoding is deliberately additive (§2 overlay pattern): future per-cell
/// facets (e.g. magic-block state) append only when present, so pre-facet golden
/// vectors never re-lock.
#[must_use]
pub fn state_hash(board: &Board, draws: u64, score: u64) -> String {
    let mut h = Sha256::new();
    h.update(b"bdk\x00");
    h.update((SIZE as u32).to_le_bytes());
    h.update(draws.to_le_bytes());
    h.update(score.to_le_bytes());
    h.update(board.cells());
    hex::encode(h.finalize())
}
