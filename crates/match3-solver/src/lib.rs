//! Build-time clear-the-blockers solver + winnable-daily-pack generator.
//!
//! [`find_clear`] is a **budgeted** depth-first search over [`match3_core`]'s
//! clear-the-blockers deal with blocker-damage-first move ordering (so the
//! greedy line is tried first and a clear is found fast) and state-hash
//! memoization. It returns a swap line that clears every blocker within the move
//! and node budgets, else `None` (classify: winnable vs unknown — it does not
//! try to *prove* unclearability, the expensive tail).
//!
//! [`generate_pack`] walks a deterministic seed stream and collects the winnable
//! **seeds** (the runtime only needs a seed per day) plus one shortest-line
//! `fixture` — a **byte-identically regenerable** pack the runtime indexes by
//! date (the fixture is the board UI's win-path source), mirroring
//! `solitaire-solver`.

use std::cmp::Reverse;
use std::collections::HashSet;

use match3_core::blockers_mode::{BLOCKERS, COLORS, HEIGHT, MOVE_BUDGET, WIDTH};
use match3_core::{blockers_remaining, deal_blockers, legal_swaps, Game};
use serde::{Deserialize, Serialize};

/// A swap `[from_row, from_col, to_row, to_col]`.
pub type Swap = [usize; 4];

/// A winnable clear-the-blockers deal: its seed and a verified clearing line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackEntry {
    /// The deal seed.
    pub seed: u64,
    /// A swap list that replays to a full blocker clear.
    pub moves: Vec<Swap>,
}

/// The winnable-daily pack. The runtime only needs a **seed** per day (the
/// player clears the deal themselves), so the pack stores a list of winnable
/// seeds — cheap to scale to a full year — plus one `fixture` entry that keeps
/// its clearing line for tests and the board's win-path E2E.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pack {
    /// Winnable seeds, indexed by date at runtime (`seeds[dayIndex % len]`).
    pub seeds: Vec<u64>,
    /// One winnable deal with its verified line — the shortest found, so the
    /// fixture (and its replay/share) stays small.
    pub fixture: PackEntry,
}

/// Find a line that clears every blocker for `seed` within `node_budget` search
/// nodes and the mode's move budget, or `None`.
#[must_use]
pub fn find_clear(seed: u64, node_budget: u64) -> Option<Vec<Swap>> {
    let game = Game::new(
        deal_blockers(seed, WIDTH, HEIGHT, COLORS, BLOCKERS),
        seed,
        COLORS,
    );
    let mut visited = HashSet::new();
    let mut budget = node_budget;
    let mut path = Vec::new();
    if dfs(&game, &mut visited, &mut budget, &mut path) {
        Some(path)
    } else {
        None
    }
}

fn dfs(game: &Game, visited: &mut HashSet<String>, budget: &mut u64, path: &mut Vec<Swap>) -> bool {
    if blockers_remaining(&game.board) == 0 {
        return true;
    }
    if *budget == 0 || path.len() >= MOVE_BUDGET {
        return false;
    }
    *budget -= 1;
    if !visited.insert(game.state_hash()) {
        return false; // already explored this position
    }
    let mut swaps = legal_swaps(&game.board);
    // Blocker-damage first, then score — the clearing line is usually greedy.
    swaps.sort_by_cached_key(|&(from, to)| {
        let mut probe = game.clone();
        let report = probe.play_move(from, to);
        let damage: u32 = report.steps.iter().map(|s| s.blocker_layers_removed).sum();
        (Reverse(damage), Reverse(report.score_gained))
    });
    for (from, to) in swaps {
        let mut next = game.clone();
        if next.play_move(from, to).legal {
            path.push([from.0, from.1, to.0, to.1]);
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
#[must_use]
pub fn generate_pack(master_seed: u64, count: usize, node_budget: u64, max_seeds: u64) -> Pack {
    let mut seeds = Vec::new();
    let mut fixture: Option<PackEntry> = None;
    let mut i = 0u64;
    while seeds.len() < count && i < max_seeds {
        let seed = master_seed.wrapping_add(i);
        if let Some(moves) = find_clear(seed, node_budget) {
            if fixture.as_ref().is_none_or(|f| moves.len() < f.moves.len()) {
                fixture = Some(PackEntry { seed, moves });
            }
            seeds.push(seed);
        }
        i += 1;
    }
    Pack {
        seeds,
        fixture: fixture.expect("at least one clearable seed in the stream"),
    }
}

/// Serialize a pack through the `pond-docformat` envelope
/// (`kind = "match3-blockers-pack"`, version 1).
///
/// # Errors
/// Propagates [`pond_docformat::DocError`] on a serialization failure.
pub fn pack_to_doc(pack: &Pack) -> Result<Vec<u8>, pond_docformat::DocError> {
    pond_docformat::write("match3-blockers-pack", 1, pack)
}
