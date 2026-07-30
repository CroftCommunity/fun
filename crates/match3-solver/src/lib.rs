//! Build-time win-objective solver + winnable-daily-pack generator for match-3.
//!
//! A shared **budgeted** depth-first [`search`] over [`match3_core`] with
//! objective-progress-first move ordering (the greedy line is tried first, so a
//! win is found fast) and state-hash memoization powers the per-objective
//! finders: [`find_clear`] (clear every blocker) and [`find_dejelly`] (scrub all
//! jelly). Each returns a swap line that wins within the mode's move + node
//! budgets, else `None` (classify: winnable vs unknown — it does not try to
//! *prove* unwinnability, the expensive tail).
//!
//! [`generate_pack`] / [`generate_jelly_pack`] walk a deterministic seed stream
//! and collect the winnable **seeds** (the runtime only needs a seed per day)
//! plus one shortest-line `fixture` — a **byte-identically regenerable** pack the
//! runtime indexes by date (the fixture is the board UI's win-path source),
//! mirroring `solitaire-solver`.

use std::cmp::Reverse;
use std::collections::HashSet;

use match3_core::{
    blockers_mode, blockers_remaining, deal_blockers, deal_jelly, jelly_mode, jelly_remaining,
    legal_swaps, Game, MoveReport,
};
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
/// nodes and the blockers-mode move budget, or `None`.
#[must_use]
pub fn find_clear(seed: u64, node_budget: u64) -> Option<Vec<Swap>> {
    use blockers_mode as m;
    let game = Game::new(
        deal_blockers(seed, m::WIDTH, m::HEIGHT, m::COLORS, m::BLOCKERS),
        seed,
        m::COLORS,
    );
    search(
        &game,
        node_budget,
        m::MOVE_BUDGET,
        |g| blockers_remaining(&g.board) == 0,
        |r| r.steps.iter().map(|s| s.blocker_layers_removed).sum(),
    )
}

/// Find a line that scrubs all jelly for `seed` within `node_budget` search nodes
/// and the jelly-mode move budget, or `None`.
#[must_use]
pub fn find_dejelly(seed: u64, node_budget: u64) -> Option<Vec<Swap>> {
    use jelly_mode as m;
    let game = Game::new(
        deal_jelly(seed, m::WIDTH, m::HEIGHT, m::COLORS, m::JELLY),
        seed,
        m::COLORS,
    );
    search(
        &game,
        node_budget,
        m::MOVE_BUDGET,
        |g| jelly_remaining(&g.board) == 0,
        |r| r.steps.iter().map(|s| s.jelly_layers_removed).sum(),
    )
}

/// The shared budgeted DFS: `won` is the objective's win check, `key` is the
/// per-move "progress" the search greedily orders by (blocker layers, jelly
/// layers, …), computed from a probe `MoveReport`. Objective-agnostic.
fn search<W, K>(
    game: &Game,
    node_budget: u64,
    move_budget: usize,
    won: W,
    key: K,
) -> Option<Vec<Swap>>
where
    W: Fn(&Game) -> bool + Copy,
    K: Fn(&MoveReport) -> u32 + Copy,
{
    let mut visited = HashSet::new();
    let mut budget = node_budget;
    let mut path = Vec::new();
    if dfs(
        game,
        &mut visited,
        &mut budget,
        &mut path,
        move_budget,
        won,
        key,
    ) {
        Some(path)
    } else {
        None
    }
}

fn dfs<W, K>(
    game: &Game,
    visited: &mut HashSet<String>,
    budget: &mut u64,
    path: &mut Vec<Swap>,
    move_budget: usize,
    won: W,
    key: K,
) -> bool
where
    W: Fn(&Game) -> bool + Copy,
    K: Fn(&MoveReport) -> u32 + Copy,
{
    if won(game) {
        return true;
    }
    if *budget == 0 || path.len() >= move_budget {
        return false;
    }
    *budget -= 1;
    if !visited.insert(game.state_hash()) {
        return false; // already explored this position
    }
    let mut swaps = legal_swaps(&game.board);
    // Most objective progress first, then score — the clearing line is usually greedy.
    swaps.sort_by_cached_key(|&(from, to)| {
        let mut probe = game.clone();
        let report = probe.play_move(from, to);
        (Reverse(key(&report)), Reverse(report.score_gained))
    });
    for (from, to) in swaps {
        let mut next = game.clone();
        if next.play_move(from, to).legal {
            path.push([from.0, from.1, to.0, to.1]);
            if dfs(&next, visited, budget, path, move_budget, won, key) {
                return true;
            }
            path.pop();
        }
    }
    false
}

/// Walk the deterministic seed stream `master_seed, master_seed+1, …` and keep
/// the first `count` seeds `solve` wins within `node_budget` (stopping after
/// `max_seeds` attempts); the `fixture` is the winnable deal with the shortest
/// found line. Deterministic → byte-identically regenerable.
fn generate(
    master_seed: u64,
    count: usize,
    node_budget: u64,
    max_seeds: u64,
    solve: fn(u64, u64) -> Option<Vec<Swap>>,
) -> Pack {
    let mut seeds = Vec::new();
    let mut fixture: Option<PackEntry> = None;
    let mut i = 0u64;
    while seeds.len() < count && i < max_seeds {
        let seed = master_seed.wrapping_add(i);
        if let Some(moves) = solve(seed, node_budget) {
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

/// Generate a winnable-daily **clear-the-blockers** pack.
#[must_use]
pub fn generate_pack(master_seed: u64, count: usize, node_budget: u64, max_seeds: u64) -> Pack {
    generate(master_seed, count, node_budget, max_seeds, find_clear)
}

/// Generate a winnable-daily **clear-the-jelly** pack.
#[must_use]
pub fn generate_jelly_pack(
    master_seed: u64,
    count: usize,
    node_budget: u64,
    max_seeds: u64,
) -> Pack {
    generate(master_seed, count, node_budget, max_seeds, find_dejelly)
}

fn write_pack(pack: &Pack, kind: &str) -> Result<Vec<u8>, pond_docformat::DocError> {
    pond_docformat::write(kind, 1, pack)
}

/// Serialize a blockers pack (`kind = "match3-blockers-pack"`, v1).
///
/// # Errors
/// Propagates [`pond_docformat::DocError`] on a serialization failure.
pub fn pack_to_doc(pack: &Pack) -> Result<Vec<u8>, pond_docformat::DocError> {
    write_pack(pack, "match3-blockers-pack")
}

/// Serialize a jelly pack (`kind = "match3-jelly-pack"`, v1).
///
/// # Errors
/// Propagates [`pond_docformat::DocError`] on a serialization failure.
pub fn jelly_pack_to_doc(pack: &Pack) -> Result<Vec<u8>, pond_docformat::DocError> {
    write_pack(pack, "match3-jelly-pack")
}
