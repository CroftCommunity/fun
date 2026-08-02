//! Canonical state hash — the verifiable-outcome anchor (RULES.md "State hash").

use sha2::{Digest, Sha256};

use crate::board::State;

/// Lowercase-hex SHA-256 over the canonical encoding: the domain tag `b"cs1\x00"`,
/// `cap`, `colors`, the tube count, then each tube **in play order** as
/// `(len, unit bytes bottom→top)`. Tube order is fixed for the life of a level,
/// so the arrangement is part of the state (unlike the solver's order-agnostic
/// dedup key). Integer fields are single bytes / `u32` LE → byte-identical on
/// native and `wasm32`.
#[must_use]
pub fn state_hash(state: &State) -> String {
    let mut h = Sha256::new();
    h.update(b"cs1\x00");
    h.update([state.cap, state.colors]);
    h.update((state.tube_count() as u32).to_le_bytes());
    for tube in &state.tubes {
        h.update([u8::try_from(tube.len()).unwrap_or(u8::MAX)]);
        h.update(tube);
    }
    hex::encode(h.finalize())
}
