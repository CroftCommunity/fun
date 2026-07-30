//! Build-time Klondike draw-1 solver + winnable-daily-pack generator.
//!
//! [`find_win`] is a **budgeted** depth-first search over [`solitaire_core`]
//! with state-hash memoization (kills draw-cycle loops) and foundation-first
//! move ordering (finds wins fast). It returns a winning move list if one is
//! found within the node budget, else `None` (classify: winnable vs unknown —
//! it does not attempt to *prove* unwinnability, which is the expensive tail).
//!
//! [`generate_pack`] iterates a deterministic seed stream and collects the
//! winnable **seeds** (the runtime only needs a seed per day) plus one shortest-
//! line `fixture` — a **byte-identically regenerable** pack the runtime indexes
//! by date (the fixture is the board UI's win-path source).

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

/// The winnable-daily pack. The runtime only needs a **seed** per day (the
/// player plays the deal themselves), so the pack stores a list of winnable
/// seeds — cheap to scale to a full year — plus one `fixture` entry that keeps
/// its winning line for tests and the board's win-path E2E. Storing a line per
/// day would make the served asset multiple megabytes; seeds keep it tiny.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pack {
    /// Winnable seeds, indexed by date at runtime (`seeds[dayIndex % len]`).
    pub seeds: Vec<u64>,
    /// One winnable deal with its verified line — the shortest found, so the
    /// fixture (and its replay/share) stays small.
    pub fixture: PackEntry,
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
/// `master_seed, master_seed+1, …`, keep the first `count` seeds the solver wins
/// within `node_budget` (stopping after `max_seeds` attempts). The `fixture` is
/// the winnable deal with the **shortest** found line. Deterministic →
/// byte-identically regenerable.
#[must_use]
pub fn generate_pack(master_seed: u64, count: usize, node_budget: u64, max_seeds: u64) -> Pack {
    let mut seeds = Vec::new();
    let mut fixture: Option<PackEntry> = None;
    let mut i = 0u64;
    while seeds.len() < count && i < max_seeds {
        let seed = master_seed.wrapping_add(i);
        if let Some(moves) = find_win(seed, node_budget) {
            if fixture.as_ref().is_none_or(|f| moves.len() < f.moves.len()) {
                fixture = Some(PackEntry { seed, moves });
            }
            seeds.push(seed);
        }
        i += 1;
    }
    Pack {
        seeds,
        fixture: fixture.expect("at least one winnable seed in the stream"),
    }
}

/// Serialize a pack through the `pond-docformat` envelope (`kind = "deal-pack"`,
/// version 2 — the seeds-lean format).
///
/// # Errors
/// Propagates [`pond_docformat::DocError`] on a serialization failure.
pub fn pack_to_doc(pack: &Pack) -> Result<Vec<u8>, pond_docformat::DocError> {
    pond_docformat::write("deal-pack", 2, pack)
}
