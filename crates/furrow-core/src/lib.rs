//! Deterministic, headless mancala engine — the shelf's **fifth** two-player
//! adversarial game, played as Kalah with six pits and four seeds a pit.
//!
//! See `RULES.md` for the layout, the sow, the capture, the extra turn, the
//! sweep, and the state hash.
//!
//! Three things here are new to the shelf's adversarial family:
//!
//! - **One move writes to many cells.** A sow lifts every seed from one pit and
//!   drops them one at a time around the board — up to thirteen writes from a
//!   single move code. Every other game's move touches one or two cells, so this
//!   is the first core where replay correctness depends on a loop.
//! - **A terminal rule rewrites the score.** When one side runs out of seeds the
//!   other **sweeps** their remaining seeds into their store, so the final score
//!   is not what accumulated during play.
//! - **All three result classes are reachable.** Forty-eight seeds can split,
//!   so unlike dots the draw arm is live in real play.
//!
//! The extra turn is **inherited, not introduced**: landing your last seed in
//! your own store gives you another move, which is the rule Dots and Boxes
//! proved the shared spine already carries.
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
    first_pit_of, is_pit_of, opposite_pit, store_of, Board, A_STORE, B_STORE, CELLS, PITS, SEEDS,
    TOTAL_SEEDS,
};
pub use game::{apply_move, legal_pits, result_of, sweep, Furrow, Pit};
pub use hash::state_hash;
