//! Canonical state hash — the verifiable-outcome anchor (RULES.md "State hash").
//!
//! SHA-256 over a domain tag + every field that defines the run's state, all
//! little-endian fixed-width integers so the hash is byte-identical on native and
//! `wasm32`. The simulation tick is included so the hash pins the whole timeline:
//! a run and its replay agree only if every gravity/lock tick lined up.

use sha2::{Digest, Sha256};

use crate::board::Board;

/// The compact active-piece descriptor folded into the hash (or all-`0` when
/// there is no active piece).
#[derive(Clone, Copy)]
pub struct ActiveDigest {
    /// Colour id (`0` if none).
    pub color: u8,
    /// Rotation index `0..=3`.
    pub rot: u8,
    /// Box-origin x.
    pub x: i32,
    /// Box-origin y.
    pub y: i32,
}

/// Fields folded into the state hash.
#[allow(clippy::struct_excessive_bools)]
pub struct HashInput<'a> {
    /// The board.
    pub board: &'a Board,
    /// RNG draws consumed (binds the bag stream position).
    pub draws: u64,
    /// Score.
    pub score: u64,
    /// Lines cleared.
    pub lines: u32,
    /// Combo counter (`-1` = none), as a signed value.
    pub combo: i64,
    /// Back-to-back active.
    pub b2b: bool,
    /// Simulation tick.
    pub tick: u32,
    /// Game over.
    pub over: bool,
    /// Won.
    pub won: bool,
    /// The active piece (all-`0` if none).
    pub active: ActiveDigest,
    /// Hold colour id (`0` if empty).
    pub hold: u8,
}

/// The canonical hash of a run's current state.
#[must_use]
pub fn state_hash(h: HashInput) -> String {
    let mut d = Sha256::new();
    d.update(b"algn\x00");
    d.update(h.draws.to_le_bytes());
    d.update(h.score.to_le_bytes());
    d.update(h.lines.to_le_bytes());
    d.update(h.combo.to_le_bytes());
    d.update([u8::from(h.b2b)]);
    d.update(h.tick.to_le_bytes());
    d.update([u8::from(h.over), u8::from(h.won)]);
    d.update([h.active.color, h.active.rot]);
    d.update(h.active.x.to_le_bytes());
    d.update(h.active.y.to_le_bytes());
    d.update([h.hold]);
    d.update(h.board.cells());
    hex::encode(d.finalize())
}
