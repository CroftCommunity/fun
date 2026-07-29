//! Build-time Klondike draw-1 solver + winnable-daily-pack generator.
//!
//! [`find_win`] is a **budgeted** depth-first search over [`solitaire_core`]
//! with state-hash memoization (kills draw-cycle loops) and foundation-first
//! move ordering (finds wins fast). It returns a winning move list if one is
//! found within the node budget, else `None` (classify: winnable vs unknown —
//! it does not attempt to *prove* unwinnability, which is the expensive tail).
//!
//! [`generate_pack`] iterates a deterministic seed stream and collects the
//! winnable ones with their lines — a **byte-identically regenerable** pack the
//! runtime indexes by date (and the source of the board UI's win-path fixture).

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use solitaire_core::{state_hash, GameState, Move};

/// Maximum search depth (a Klondike win is well under this; bounds recursion so
/// the DFS cannot overflow the stack and steers toward short solutions).
const MAX_DEPTH: usize = 500;

/// A winnable deal: its seed and a verified winning move list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackEntry {
    /// The deal seed.
    pub seed: u64,
    /// A move list that replays to a win.
    pub moves: Vec<Move>,
}

/// Find a winning line for `seed` within `node_budget` search nodes, or `None`.
#[must_use]
pub fn find_win(seed: u64, node_budget: u64) -> Option<Vec<Move>> {
    let game = GameState::new_game(seed);
    let mut visited = HashSet::new();
    let mut budget = node_budget;
    let mut path = Vec::new();
    if dfs(&game, &mut visited, &mut budget, &mut path) {
        Some(path)
    } else {
        None
    }
}

/// Try foundation moves first, then face-down-revealing tableau moves, then
/// other builds, then waste→tableau, then draw last. Lower = tried first.
fn priority(game: &GameState, mv: Move) -> u8 {
    match mv {
        Move::WasteToFoundation | Move::TableauToFoundation { .. } => 0,
        Move::TableauToTableau { from, count, .. } => {
            let pile = &game.tableau[from];
            let reveals = count < pile.len() && !pile[pile.len() - count - 1].face_up;
            if reveals {
                1
            } else {
                3
            }
        }
        Move::WasteToTableau { .. } => 2,
        Move::Draw => 4,
    }
}

fn dfs(
    game: &GameState,
    visited: &mut HashSet<String>,
    budget: &mut u64,
    path: &mut Vec<Move>,
) -> bool {
    if game.is_won() {
        return true;
    }
    if *budget == 0 || path.len() >= MAX_DEPTH {
        return false;
    }
    *budget -= 1;
    if !visited.insert(state_hash(game)) {
        return false; // already explored this position
    }
    let mut moves = game.legal_moves();
    moves.sort_by_key(|&m| priority(game, m));
    for mv in moves {
        let mut next = game.clone();
        if next.play_move(mv).is_ok() {
            path.push(mv);
            if dfs(&next, visited, budget, path) {
                return true;
            }
            path.pop();
        }
    }
    false
}

/// Generate a winnable-daily pack: walk the deterministic seed stream
/// `master_seed, master_seed+1, …`, keep the first `count` seeds the solver
/// wins within `node_budget` (stopping after `max_seeds` attempts). Deterministic
/// → byte-identically regenerable.
#[must_use]
pub fn generate_pack(
    master_seed: u64,
    count: usize,
    node_budget: u64,
    max_seeds: u64,
) -> Vec<PackEntry> {
    let mut out = Vec::new();
    let mut i = 0u64;
    while out.len() < count && i < max_seeds {
        let seed = master_seed.wrapping_add(i);
        if let Some(moves) = find_win(seed, node_budget) {
            out.push(PackEntry { seed, moves });
        }
        i += 1;
    }
    out
}

/// Serialize a pack through the `pond-docformat` envelope (`kind = "deal-pack"`).
///
/// # Errors
/// Propagates [`pond_docformat::DocError`] on a serialization failure.
pub fn pack_to_doc(pack: &[PackEntry]) -> Result<Vec<u8>, pond_docformat::DocError> {
    pond_docformat::write("deal-pack", 1, &pack)
}
