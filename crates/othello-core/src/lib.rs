//! Deterministic, headless Othello (Reversi) engine.
//!
//! The Tier-1 core for the `fun.croft.ing` Othello game and the shelf's second
//! two-player adversarial game (the generality proof for the `Adversary` trait +
//! the shared harness). 8×8 board, place-and-flip moves with **forced passes**,
//! terminal by disc count. Implements the shared [`adversary_core::Adversary`]
//! trait (so the harness and a solver are generic over it) and
//! [`pond_outcome::Game`] (so a match replays from `(seed, moves)` — passes
//! included — to a verifiable state hash). No floats on the hashed path; integer
//! fields are little-endian, so `native == wasm`.

#![warn(missing_docs)]

pub mod board;
pub mod game;
pub mod hash;

pub use board::{cell_of, side_of_cell, Board, CELLS, SIZE};
pub use game::{apply_move, flips_for, legal_moves, legal_places, result, Move, Othello};
pub use hash::state_hash;
