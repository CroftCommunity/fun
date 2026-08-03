//! The atomic input actions and the tick-stamped record (RULES.md "The record").
//!
//! Handling (DAS/ARR/SDF) lives entirely in the front-end input layer, which
//! resolves held keys into a stream of these **atomic** actions. Recording the
//! resolved actions — not raw key holds — makes replay independent of the
//! viewer's handling settings: a shared record reproduces the exact shifts that
//! happened. Each accepted action is stamped with the simulation tick it applied
//! at, so `replay(seed, events)` reconstructs the run byte-identically.

use serde::{Deserialize, Serialize};

/// A single atomic player action.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum Action {
    /// Shift one cell left.
    ShiftL,
    /// Shift one cell right.
    ShiftR,
    /// Rotate clockwise.
    RotCW,
    /// Rotate counter-clockwise.
    RotCCW,
    /// Rotate 180°.
    Rot180,
    /// Soft-drop one cell (scores 1 per cell).
    SoftStep,
    /// Hard-drop to the landing and lock immediately (scores 2 per cell).
    HardDrop,
    /// Swap the active piece with the hold slot.
    Hold,
    /// Terminal marker: the player ended the run (the recorded stop point).
    Quit,
}

/// A tick-stamped input event — the unit of the verifiable move list.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct InputEvent {
    /// The simulation tick this action was applied at.
    pub tick: u32,
    /// The action.
    pub action: Action,
}
