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
//!
//! The move set at each node is the **reachable-landing** set — the distinct
//! cells a fan of angles actually lands on from the current board (see
//! [`reachable_landings`]) — each carried with the angle that reaches it. So the
//! search space is the physical aim space and every line it finds is recorded as
//! angles a real aim game replays exactly; there are no unreachable "tucked"
//! cells and no post-hoc mapping.

#![warn(missing_docs)]

use std::collections::HashSet;

use bubble_core::{fan, resolve_shot, Angle, Board, Cell, Game, Pos};
use serde::{Deserialize, Serialize};

/// Recursion/stack guard. A clear-the-board line is bounded by the shot budget
/// (`Game::shots_left`), well under this.
const MAX_DEPTH: usize = 200;

/// A winnable deal: its seed and a verified clearing aim line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackEntry {
    /// The deal seed.
    pub seed: u64,
    /// An aim line (angles) that replays to a cleared board.
    pub moves: Vec<Angle>,
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

/// The distinct landings **reachable by the fan** from `board`, each paired with
/// the lowest angle that reaches it (ascending scan → deterministic). These are
/// exactly the shots an aim game can make — the search space is the physical one,
/// so every line it finds is replayable by a real angle game (no post-hoc
/// mapping, no unreachable cells).
fn reachable_landings(board: &Board) -> Vec<(Angle, Pos)> {
    let (lo, hi) = fan();
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for deg in lo..=hi {
        let angle = Angle(deg);
        let pos = resolve_shot(board, angle).pos;
        if seen.insert(pos) {
            out.push((angle, pos));
        }
    }
    out
}

/// Find a clearing **aim line** (angles) for `seed` within `node_budget` nodes,
/// or `None`. A budgeted greedy DFS over the reachable-landing move set with
/// state-hash memoization; the returned angles replay to a cleared board.
#[must_use]
pub fn find_win(seed: u64, node_budget: u64) -> Option<Vec<Angle>> {
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

fn dfs(
    game: &Game,
    visited: &mut HashSet<String>,
    budget: &mut u64,
    path: &mut Vec<Angle>,
) -> bool {
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
    // Candidate angles: reachable landings that pop/drop, or at least build
    // toward the current colour. Pure dead placements are pruned. Score each by
    // simulating, then try highest pop+drop first (greedy — finds a clear fast
    // when one is reachable, and drops cascade whole sections).
    let mut scored: Vec<(usize, Angle)> = Vec::new();
    for (angle, pos) in reachable_landings(game.board()) {
        let mut probe = game.clone();
        let rep = probe.play(angle);
        let gain = rep.popped.len() + rep.dropped.len();
        if gain > 0 || adjacent_to_current(game, pos) {
            scored.push((gain, angle));
        }
    }
    scored.sort_by_key(|&(gain, _)| core::cmp::Reverse(gain));
    for (_, angle) in scored {
        let mut next = game.clone();
        next.play(angle);
        path.push(angle);
        if dfs(&next, visited, budget, path) {
            return true;
        }
        path.pop();
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
