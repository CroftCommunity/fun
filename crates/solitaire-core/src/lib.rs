//! Deterministic, headless Klondike draw-1 solitaire engine (the games pond's
//! first new game).
//!
//! The determinism foundation from the per-pond build discipline. See RULES.md
//! for the rules and the tie-break/ordering tables this crate implements. A
//! `(seed, move list)` fully determines every state; replaying reproduces the
//! same [`state_hash`].
//!
//! **Build status:** the deterministic deal + state hash are implemented and
//! green (deal-determinism corpus). The legal-move engine (T1–T5) is grown
//! red-first next; until then only [`GameState::new_game`] and [`state_hash`]
//! are wired.

pub mod board;
pub mod card;
pub mod hash;
pub mod rng;

pub use board::{GameState, TableauCard, TABLEAU_PILES};
pub use card::{Card, Color};
pub use hash::state_hash;
