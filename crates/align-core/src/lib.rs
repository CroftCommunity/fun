//! Deterministic, headless falling-block engine for **Align** (Tier-1,
//! build-fresh) — see RULES.md for the tick model, the 7-bag + SRS rules, the
//! integer gravity table, lock delay, guideline scoring, and the state hash.
//!
//! The engine is a fixed-timestep tick simulation whose recorded artifact is a
//! tick-stamped stream of atomic actions, so a run replays byte-identically from
//! `(seed, moves)` and native == wasm — which is what makes the outcome
//! verifiable ([`game::Align`] implements [`pond_outcome::Game`]). No floats ever
//! run on the hashed path; no wall clock ever drives a state transition.

#![warn(missing_docs)]

pub mod action;
pub mod board;
pub mod engine;
pub mod game;
pub mod gravity;
pub mod hash;
pub mod mode;
pub mod pack;
pub mod piece;
pub mod rng;
pub mod scoring;

pub use action::{Action, InputEvent};
pub use engine::{ActiveView, Engine, InputResult, PREVIEW};
pub use game::{moves_of, Align, AlignMove};
pub use mode::{ModeConfig, ModeId};
pub use piece::{PieceKind, RotState};
pub use scoring::{ClearLabel, TSpin};
