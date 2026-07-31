//! Deterministic, headless daily word-guessing engine (Wordle-family).
//!
//! The determinism foundation for the `fun.croft.ing` daily word game (Tier-1,
//! build-fresh). See RULES.md for the guess-pattern rules (correct / present /
//! absent with standard duplicate handling), the seed->answer map, the word-list
//! provenance, and the state hash this crate implements verbatim. There is **no
//! RNG on the runtime path** — the answer for a seed is `ANSWERS[seed % N]` — so
//! a game replays exactly from `(seed, guesses)` against the state hash, and
//! native == wasm by construction.

#![warn(missing_docs)]

pub mod game;
pub mod hash;
pub mod pack;
pub mod pattern;
pub mod word;
pub mod words;

pub use game::{Game, GuessError, Wyrdle};
pub use hash::state_hash;
pub use pack::{Pack, PackEntry};
pub use pattern::{score, Mark};
pub use word::{Word, WordError, WORD_LEN};
pub use words::{answer_for, answers_len, is_allowed};

/// The maximum number of guesses in the default mode.
pub const MAX_GUESSES: usize = 6;
