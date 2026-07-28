//! Deterministic, headless Klondike draw-1 solitaire engine (the games pond's
//! first new game).
//!
//! The determinism foundation from the per-pond build discipline. See RULES.md
//! for the rules and the tie-break/ordering tables this crate implements. A
//! `(seed, move list)` fully determines every state; replaying reproduces the
//! same [`state_hash`].
//!
//! **Build status:** the deterministic deal, `state_hash`, and the full
//! legal-move engine (T1–T5 [`GameState::play_move`] / [`GameState::legal_moves`])
//! are implemented and green (deal corpus + tie-break unit tests + golden
//! vectors).

pub mod board;
pub mod card;
pub mod engine;
pub mod hash;
pub mod rng;
pub mod vectors;

pub use board::{GameState, TableauCard, TABLEAU_PILES};
pub use card::{Card, Color};
pub use engine::{Move, MoveError};
pub use hash::state_hash;
