//! P8 — the verifiable-outcome record (shared substrate).
//!
//! Given `(game kind, seed, initial state, move list)`, replay via the game's
//! core and emit an outcome record (`{ kind, seed, result, final_hash,
//! move_count }`) that anyone can re-verify by replaying — the record carries
//! its own proof. Serialized via [`pond-docformat`]. Local only; the
//! follow-chain leaderboard that reads these is out of scope and gated.
//!
//! **Stub** — registered in master-plan Phase 1; implemented in master-plan
//! Phase 6. No public API yet, by design.
