//! Deterministic, headless Drop 4 (Four-in-a-Row) engine.
//!
//! The Tier-1 core for the `fun.croft.ing` Drop 4 game and the first
//! **two-player adversarial** game on the shelf. See `RULES.md` for the board,
//! the drop-a-column move, four-in-a-row / draw, and the state hash. Implements
//! the shared [`adversary_core::Adversary`] trait (so the harness and the
//! solver are generic over it) and [`pond_outcome::Game`] (so a match replays
//! from `(seed, moves)` to a verifiable state hash). No floats on the hashed
//! path; integer fields are little-endian, so `native == wasm`.

#![warn(missing_docs)]

pub mod board;
pub mod game;
pub mod hash;

pub use board::{cell_of, side_of_cell, Board, CELLS, HEIGHT, WIDTH};
pub use game::{apply_move, legal_cols, winner, Col, Drop4};
pub use hash::state_hash;
