//! Deterministic, headless English draughts (checkers) engine.
//!
//! The Tier-1 core for the `fun.croft.ing` checkers game and the shelf's third
//! two-player adversarial game. Play is on the **32 dark squares** of an 8×8
//! board, carrying the standard 1–32 draughts numbering. Capture is
//! **mandatory** (though the *maximum* capture is not), a capture may chain into
//! a multi-jump, **crowning terminates the move**, and kings are **not flying** —
//! they step and jump one square at a time in any diagonal direction.
//!
//! Implements the shared [`adversary_core::Adversary`] trait, so the harness and
//! a solver are generic over it. ([`pond_outcome::Game`] and the no-progress draw
//! rule arrive in Phase 5; until then a game can in principle cycle, which is
//! exactly the gap that phase closes.)
//!
//! A move is a `(from, to, variant)` triple packed into a single 14-bit integer,
//! so a recorded match is a plain JSON number array like every other game on the
//! shelf. `variant` disambiguates the rare position in which one origin reaches
//! one destination by two different capture paths — see [`game::Move`]. No floats
//! on the hashed path; integer fields are little-endian, so `native == wasm`.

#![warn(missing_docs)]

pub mod board;
pub mod game;
pub mod hash;

pub use board::{
    cell_of, crowning_row, forward, piece_of_cell, row_col, square_at, Board, Piece, Rank, SIZE,
    SQUARES,
};
pub use game::{
    apply_move, chain_for, legal_chains, legal_moves, result, Chain, Checkers, Move, MAX_MOVE_CODE,
};
pub use hash::state_hash;
