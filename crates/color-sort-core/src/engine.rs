//! Move legality, the maximal-run pour, and deadlock detection (brief §2.2–2.5).
//!
//! Water-move semantics everywhere: a pour moves the maximal contiguous top-colour
//! run of the source, truncated by the target's free space. Ball and bolt skins
//! are pure rendering of the same move (the equivalence theorem, Ito et al.), so
//! this is the only move engine.

use serde::{Deserialize, Serialize};

use crate::board::State;

/// A pour from tube `from` to tube `to`.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash, Serialize, Deserialize)]
pub struct Move {
    /// Source tube index.
    pub from: usize,
    /// Destination tube index.
    pub to: usize,
}

/// Why a pour could not be applied.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MoveError {
    /// The pour is not legal in the current state (the core decides legality).
    #[error("that pour is not legal")]
    Illegal,
    /// The game is already won — no further pours are accepted.
    #[error("the game is already won")]
    GameOver,
}

/// Whether a pour `from → to` is **formally** legal (brief §2.2): `from ≠ to`,
/// `from` non-empty, `to` not full, and (`to` empty or `top(to) == top(from)`).
#[must_use]
pub fn is_legal(state: &State, mv: Move) -> bool {
    let Move { from, to } = mv;
    if from == to || from >= state.tube_count() || to >= state.tube_count() {
        return false;
    }
    if state.is_empty_tube(from) || state.is_full_tube(to) {
        return false;
    }
    match (state.top(from), state.top(to)) {
        (Some(src), Some(dst)) => src == dst,
        (Some(_), None) => true, // pouring onto an empty tube
        _ => false,
    }
}

/// Every formally-legal pour (brief §2.2). Used by the solver and to validate
/// applied moves.
#[must_use]
pub fn legal_moves(state: &State) -> Vec<Move> {
    let n = state.tube_count();
    let mut moves = Vec::new();
    for from in 0..n {
        for to in 0..n {
            let mv = Move { from, to };
            if is_legal(state, mv) {
                moves.push(mv);
            }
        }
    }
    moves
}

/// The pours the **UI** offers (brief §2.5 rulings, on top of formal legality):
/// a locked (full-monochrome) source is dropped entirely, and a monochrome
/// source into an empty tube is dropped (a vacuous pour that only wastes a move).
/// A monochrome source onto a matching non-empty top stays allowed. This is the
/// set the board glows and the set deadlock detection uses.
#[must_use]
pub fn ui_moves(state: &State) -> Vec<Move> {
    legal_moves(state)
        .into_iter()
        .filter(|mv| {
            if state.is_locked(mv.from) {
                return false; // locked tubes cannot be selected as source
            }
            if state.is_monochrome(mv.from) && state.is_empty_tube(mv.to) {
                return false; // vacuous: monochrome → empty
            }
            true
        })
        .collect()
}

/// Apply a pour to `state`, moving the maximal contiguous top-colour run of the
/// source truncated by the target's free space (brief §2.3). Partial pours are
/// real: a run of 3 into 1 free slot moves exactly 1.
///
/// # Errors
/// - [`MoveError::GameOver`] if the game is already won (nothing changes).
/// - [`MoveError::Illegal`] if the pour is not formally legal (nothing changes) —
///   so a tampered move in a record is a no-op and diverges the state hash.
pub fn apply_move(state: &mut State, mv: Move) -> Result<usize, MoveError> {
    if state.is_won() {
        return Err(MoveError::GameOver);
    }
    if !is_legal(state, mv) {
        return Err(MoveError::Illegal);
    }
    let run = state.top_run(mv.from);
    let free = state.cap as usize - state.tubes[mv.to].len();
    let count = run.min(free);
    let color = state.tubes[mv.from][state.tubes[mv.from].len() - 1];
    for _ in 0..count {
        state.tubes[mv.from].pop();
        state.tubes[mv.to].push(color);
    }
    Ok(count)
}

/// The game is **deadlocked**: no UI-legal (non-blocked) pour exists and the win
/// condition is unmet (brief §2.5). O((n+k)²), trivial at this size.
#[must_use]
pub fn is_deadlocked(state: &State) -> bool {
    !state.is_won() && ui_moves(state).is_empty()
}
