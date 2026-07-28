//! Browser binding over [`solitaire-core`] for the games drawer UI.
//!
//! Exposes `new_game(seed) -> board JSON`, `legal_moves(state) -> JSON`,
//! `play_move(state, mv) -> board JSON`, `is_won(state)`, plus the state-hash /
//! outcome hooks — a string-in/string-out surface marshalled by wasm-bindgen.
//! The UI renders the board; it never re-implements rules.
//!
//! **Stub** — registered in master-plan Phase 1; implemented in the front-end
//! plan (`2026-07-28-games-drawer-solitaire-ui.md`) Phase 3, once
//! `solitaire-core` exists (master-plan Phase 4). No public API yet, by design.
