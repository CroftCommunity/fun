//! Mahjong solitaire — a deterministic, headless tile-matching engine.
//!
//! The 144-tile set (flowers and seasons as wild classes), layouts on a
//! half-tile grid, the **FREE** predicate (nothing on top, a long side open),
//! deals built by **reverse construction** so every board is winnable, a
//! recorded shuffle that re-deals the remainder the same way, and a
//! [`hash::state_hash`] plus the ordered move list that make a cleared board a
//! verifiable [`pond_outcome`] record. Integer-exact throughout, so native and
//! `wasm32` agree bit-for-bit.

#![warn(missing_docs)]

pub mod board;
pub mod config;
pub mod game;
pub mod generate;
pub mod hash;
pub mod layout;
pub mod rng;
pub mod tiles;
pub mod vectors;

pub use board::{Board, MoveError};
pub use config::{daily_origin, daily_seed, level_layout, level_origin};
pub use game::{Game, Mahjong, Move, Origin, SHUFFLE, UNVERIFIABLE_HASH};
pub use generate::{deal, deal_with, redeal, Deal, DealError, Redeal, MAX_ATTEMPTS};
pub use hash::state_hash;
pub use layout::{layout, overlaps, Layout, LayoutId, Slot};
pub use rng::{hash_str, shuffle, Rng};
pub use tiles::{matches, pair_up, pairs, Face, Kind, FACE_COUNT, TILE_COUNT};
