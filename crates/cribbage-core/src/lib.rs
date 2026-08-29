//! Deterministic, headless two-hand cribbage engine — the shelf's first
//! **hidden-information** game.
//!
//! See `RULES.md` for the deal, the discard, the cut, pegging, the show, the
//! claims (manual counting), the game value, the move codes, and the state hash.
//!
//! What is new to the shelf here, and why the shape differs from the versus
//! stack the five perfect-information games share:
//!
//! - **The state is not the observation.** [`GameState`] holds both hands, the
//!   crib and the cut; a seat sees a [`View`]. The engine (in `cribbage-solver`)
//!   takes a `View` and nothing else, which is the type-level half of the
//!   "never peeks" property; the measurement rig supplies the other half.
//! - **Chance after the seed.** Every deal reshuffles from the seed and the deal
//!   number, so `(seed, moves)` still replays exactly.
//! - **Counting is a move.** Each hand at the show is scored by a
//!   [`Move::Claim`] from its owner; the core grades it, so manual counting and
//!   automatic counting produce the same record.
//!
//! Implements [`pond_outcome::Game`] so a game replays from `(seed, moves)` to a
//! verifiable state hash. It deliberately does **not** implement
//! `adversary_core::Adversary`: that trait's contract is that both sides see
//! the whole position. No floats on the hashed path; integer fields are
//! little-endian, so `native == wasm`.

#![warn(missing_docs)]

pub mod card;
pub mod rng;
pub mod score;

pub use card::{Card, Rank, Suit, DECK_SIZE};
pub use score::{score_hand, score_peg, HandScore, PegScore};
