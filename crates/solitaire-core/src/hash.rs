//! Canonical state hash — the verifiable-outcome anchor (RULES.md → "State
//! hash").

use sha2::{Digest, Sha256};

use crate::board::GameState;

/// Lowercase-hex SHA-256 over the canonical encoding in RULES.md.
#[must_use]
pub fn state_hash(state: &GameState) -> String {
    let mut h = Sha256::new();
    h.update(b"sk1\x00");
    h.update(state.draws.to_le_bytes());
    for &top in &state.foundations {
        h.update([top]);
    }
    // stock (face-down) then waste (face-up), each bottom->top.
    encode_pile(&mut h, state.stock.iter().map(|c| c.index()));
    encode_pile(&mut h, state.waste.iter().map(|c| c.index()));
    // seven tableau piles, bottom->top, each card (face_up, index).
    for pile in &state.tableau {
        h.update([u8::try_from(pile.len()).expect("pile len <= 52")]);
        for tc in pile {
            h.update([u8::from(tc.face_up), tc.card.index()]);
        }
    }
    hex::encode(h.finalize())
}

fn encode_pile(h: &mut Sha256, indices: impl ExactSizeIterator<Item = u8>) {
    h.update([u8::try_from(indices.len()).expect("pile len <= 52")]);
    for idx in indices {
        h.update([idx]);
    }
}
