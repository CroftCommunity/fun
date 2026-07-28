//! P2 — the version-and-unknown-field document policy (shared substrate).
//!
//! One versioned, forward/unknown-field-tolerant serialization envelope
//! (`{ kind, version, payload }`) governing all three durable document types:
//! saves, deal/level/share codes, and outcome records. Fail-loud on unreadable
//! newer-major documents; a per-version fixture seeds the P10 compatibility
//! matrix.
//!
//! **Stub** — registered in master-plan Phase 1; implemented in master-plan
//! Phase 5. No public API yet, by design.
