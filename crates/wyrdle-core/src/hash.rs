//! Canonical state hash — the verifiable-outcome anchor (RULES.md "State hash").
//!
//! Fully determined by `(answer, guesses)`; since the answer is a pure function
//! of the seed, a game replays to a byte-identical hash from `(seed, guesses)`.
//! Patterns are derived from `(answer, guess)`, so they are not hashed. Integer
//! fields are little-endian `u32`, so native == wasm.

use sha2::{Digest, Sha256};

use crate::word::{Word, WORD_LEN};
use crate::MAX_GUESSES;

/// Lowercase-hex SHA-256 over the canonical encoding: a domain tag, the word
/// length and guess budget, the answer's letters, the guess count, then each
/// guess's letters — in order.
#[must_use]
pub fn state_hash(answer: &Word, guesses: &[Word]) -> String {
    let mut h = Sha256::new();
    h.update(b"wyr\x00");
    h.update((WORD_LEN as u32).to_le_bytes());
    h.update((MAX_GUESSES as u32).to_le_bytes());
    h.update(answer.0);
    h.update((guesses.len() as u32).to_le_bytes());
    for g in guesses {
        h.update(g.0);
    }
    hex::encode(h.finalize())
}
