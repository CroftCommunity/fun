//! Build-time clear-the-board solver + winnable-daily-pack generator.
//!
//! [`find_win`] is a **budgeted** greedy depth-first search over
//! [`bubble_core::Game`] with state-hash memoization and pop/drop-first move
//! ordering. It returns a shot line that clears the board if one is found within
//! the node budget, else `None` (it classifies winnable vs unknown — it does not
//! prove unwinnability). Because the launcher only ever loads a colour present
//! on the board (see `bubble_core::Game`), a shot can always make progress,
//! which keeps a healthy fraction of deals clearable.
//!
//! [`generate_pack`] walks a deterministic seed stream and collects the winnable
//! **seeds** (the runtime only needs a seed per day) plus one shortest-line
//! `fixture` — a **byte-identically regenerable** pack the runtime indexes by
//! date.

#![warn(missing_docs)]

use std::collections::HashSet;

use bubble_core::engine::legal_targets;
use bubble_core::{Cell, Game, Pos};
use serde::{Deserialize, Serialize};

/// Recursion/stack guard. A clear-the-board line is bounded by the shot budget
/// (`Game::shots_left`), well under this.
const MAX_DEPTH: usize = 200;

/// A winnable deal: its seed and a verified clearing shot line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackEntry {
    /// The deal seed.
    pub seed: u64,
    /// A shot line (tap targets) that replays to a cleared board.
    pub moves: Vec<Pos>,
}

/// The winnable-daily pack: winnable seeds (indexed by date at runtime) plus one
/// `fixture` entry keeping its shortest clearing line for tests and the board's
/// win-path E2E. Seeds keep the served asset tiny.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pack {
    /// Winnable seeds, indexed by date at runtime (`seeds[day % len]`).
    pub seeds: Vec<u64>,
    /// One winnable deal with its verified shortest-found clearing line.
    pub fixture: PackEntry,
}

/// True if placing the current colour at `target` is adjacent to a same-colour
/// bubble (a setup or pop move) — used to prune pure dead placements.
fn adjacent_to_current(game: &Game, target: Pos) -> bool {
    let board = game.board();
    let color = game.current_color();
    board
        .neighbors(target.0, target.1)
        .into_iter()
        .any(|(nr, nc)| board.get(nr, nc) == Some(Cell::Bubble(color)))
}

/// Find a clearing shot line for `seed` within `node_budget` nodes, or `None`.
#[must_use]
pub fn find_win(seed: u64, node_budget: u64) -> Option<Vec<Pos>> {
    let game = Game::new(seed);
    let mut visited = HashSet::new();
    let mut budget = node_budget;
    let mut path = Vec::new();
    if dfs(&game, &mut visited, &mut budget, &mut path) {
        Some(path)
    } else {
        None
    }
}

fn dfs(game: &Game, visited: &mut HashSet<String>, budget: &mut u64, path: &mut Vec<Pos>) -> bool {
    if game.is_won() {
        return true;
    }
    if *budget == 0 || game.shots_left() == 0 || path.len() >= MAX_DEPTH {
        return false;
    }
    *budget -= 1;
    if !visited.insert(game.current_hash()) {
        return false; // already explored this position
    }
    // Candidate targets: those that pop/drop, or at least build toward the
    // current colour. Pure dead placements are pruned. Score each by simulating,
    // then try highest pop+drop first (greedy — finds a clear fast when one is
    // reachable, and drops cascade whole sections).
    let mut scored: Vec<(usize, Pos)> = Vec::new();
    for t in legal_targets(game.board()) {
        let mut probe = game.clone();
        if let Ok(rep) = probe.play(t) {
            let gain = rep.popped + rep.dropped;
            if gain > 0 || adjacent_to_current(game, t) {
                scored.push((gain, t));
            }
        }
    }
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, t) in scored {
        let mut next = game.clone();
        if next.play(t).is_ok() {
            path.push(t);
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
/// clears within `node_budget` (stopping after `max_seeds` attempts). The
/// `fixture` is the winnable deal with the **shortest** found line. Deterministic
/// → byte-identically regenerable.
///
/// # Panics
/// Panics if the seed stream yields no winnable seed within `max_seeds` (a
/// misconfiguration — the mode is unclearable or the budget is far too small).
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

/// Serialize a pack through the `pond-docformat` envelope
/// (`kind = "bubble-clear-pack"`, version 1).
///
/// # Errors
/// Propagates [`pond_docformat::DocError`] on a serialization failure.
pub fn pack_to_doc(pack: &Pack) -> Result<Vec<u8>, pond_docformat::DocError> {
    pond_docformat::write("bubble-clear-pack", 1, pack)
}
