//! Canonical state hash — the verifiable-outcome anchor (RULES.md "State hash").

use sha2::{Digest, Sha256};

use crate::board::{Board, Cell, SpecialKind};

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
            // Track D: a new tag, additive — no board without an ingredient carries
            // it, so pre-ingredient boards hash exactly as before.
            Cell::Ingredient => h.update([0x03]),
        }
    }
    // Jelly overlay — appended ONLY when some cell is jellied, so a gem-only
    // board hashes exactly as it did before jelly existed (pre-jelly golden
    // vectors stay valid). The `j\x00` marker + one layer byte per cell.
    if board.jelly().iter().any(|&l| l > 0) {
        h.update(b"j\x00");
        h.update(board.jelly());
    }
    // Special-candy overlay — appended ONLY when some cell carries a special
    // (the same append-only-when-present rule), so a plain gem-only board hashes
    // exactly as before the overlay existed. The `s\x00` marker + one tag byte
    // per cell (`0x00` = no special; see `SpecialKind::tag`). Appended after the
    // jelly section so a jelly-only board is unaffected.
    if board.special().iter().any(std::option::Option::is_some) {
        h.update(b"s\x00");
        for s in board.special() {
            h.update([s.map_or(0x00, SpecialKind::tag)]);
        }
    }
    hex::encode(h.finalize())
}
