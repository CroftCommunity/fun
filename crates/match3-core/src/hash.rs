//! Canonical state hash — the verifiable-outcome anchor (RULES.md "State hash").

use sha2::{Digest, Sha256};

use crate::board::{Board, Cell};

/// Lowercase-hex SHA-256 over the canonical encoding in RULES.md.
pub fn state_hash(board: &Board, colors: usize, draws: u64, score: u64) -> String {
    let mut h = Sha256::new();
    h.update(b"m3\x00");
    h.update((board.width as u32).to_le_bytes());
    h.update((board.height as u32).to_le_bytes());
    h.update((colors as u32).to_le_bytes());
    h.update(draws.to_le_bytes());
    h.update(score.to_le_bytes());
    for cell in board.cells() {
        match cell {
            Cell::Empty => h.update([0x00]),
            Cell::Gem(c) => h.update([0x01, *c]),
            Cell::Blocker(l) => h.update([0x02, *l]),
        }
    }
    hex::encode(h.finalize())
}
