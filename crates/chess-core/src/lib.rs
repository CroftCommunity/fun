//! Deterministic, headless chess engine core.
//!
//! The Tier-1 core for the `fun.croft.ing` chess game and the shelf's sixth
//! two-player adversarial game. FIDE rules with the draws decided automatic
//! (threefold repetition and the 50-move rule — a claim needs a claimant, and a
//! tap-first board against an engine has none); insufficient material as the
//! computable subset of the dead-position rule; checkmate preceding every draw.
//! The authority for every rule, with FIDE article numbers, is `RULES.md` in
//! this crate — the tests cite its sections.
//!
//! A move is `(from, to, promo)` packed into a single 15-bit integer, so a
//! recorded match is a plain JSON number array like every other game on the
//! shelf. Move generation is pseudo-legal + make-and-check, verified by perft
//! against the six published reference positions. No floats on the hashed
//! path; integer fields serialize little-endian, so `native == wasm`.

#![warn(missing_docs)]

pub mod board;
pub mod movegen;

pub use board::{Board, Color, FenError, PieceKind, START_FEN};
pub use movegen::{
    apply_move, attacked, divide, king_square, legal_moves, perft, Move, MAX_MOVE_CODE,
};
