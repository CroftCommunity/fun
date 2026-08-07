//! Deterministic, headless Dots and Boxes engine.
//!
//! The Tier-1 core for the `fun.croft.ing` Dots and Boxes game and the shelf's
//! **fourth** two-player adversarial game. See `RULES.md` for the lattice, the
//! draw-an-edge move, the capture-grants-another-turn rule, and the state hash.
//!
//! Two things here are new to the shelf's adversarial family:
//!
//! - **A move need not pass the turn.** Closing a box claims it and the mover
//!   moves again, so `side_to_move` is not a function of move parity. The shared
//!   [`adversary_core::Adversary`] spine already allowed this; this is the first
//!   game to use it.
//! - **The game value is a box margin**, not a win/draw/loss class, and at nine
//!   boxes **no draw is reachable** — so the class a difficulty band preserves is
//!   the *sign* of a margin.
//!
//! Implements [`adversary_core::Adversary`] (so the harness and solver are
//! generic over it) and [`pond_outcome::Game`] (so a match replays from
//! `(seed, moves)` to a verifiable state hash). No floats on the hashed path;
//! integer fields are little-endian, so `native == wasm`.

#![warn(missing_docs)]

pub mod board;
pub mod game;
pub mod hash;

pub use board::{
    box_mask, completed_boxes, h_edge, owner_of, side_of_owner, v_edge, Board, ALL_EDGES, BOXES,
    COLS, EDGES, H_EDGES, ROWS, V_EDGES,
};
pub use game::{apply_move, legal_edges, result_of, Dots, Edge};
pub use hash::state_hash;
