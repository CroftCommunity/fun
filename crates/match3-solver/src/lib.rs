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
    blockers_mode, blockers_remaining, checklist_mode, checklist_targets, deal, deal_blockers,
    deal_ingredients, deal_jelly, ingredients_mode, ingredients_remaining, jelly_mode,
    jelly_remaining, legal_swaps, random_score, reference_score, reference_score_specials,
    target_score_mode, ChecklistProgress, ChecklistTargets, Game, MoveReport,
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

/// Find a line that drops every ingredient to the bottom (Track D) for `seed`
/// within `node_budget` search nodes and the ingredients-mode move budget, or
/// `None`. Progress = ingredients collected, so the search greedily prefers moves
/// that advance one toward the exit.
#[must_use]
pub fn find_ingredients(seed: u64, node_budget: u64) -> Option<Vec<Swap>> {
    use ingredients_mode as m;
    let game = Game::new(
        deal_ingredients(seed, m::WIDTH, m::HEIGHT, m::COLORS, m::INGREDIENTS),
        seed,
        m::COLORS,
    );
    search(
        &game,
        node_budget,
        m::MOVE_BUDGET,
        |g| ingredients_remaining(&g.board) == 0,
        |r| r.steps.iter().map(|s| s.ingredients_collected).sum(),
    )
}

/// Find a line that completes the mixed **checklist** (clear N of a colour, make
/// N striped, make N wrapped) for `seed` within `node_budget` search nodes and the
/// checklist move budget, or `None` (Track D, T6).
///
/// The checklist win is **path-accumulated**, so — unlike [`find_clear`] /
/// [`find_dejelly`] / [`find_ingredients`], whose win is a function of the current
/// board — this uses its own DFS carrying a [`ChecklistProgress`]. Memoization keys
/// on `(state_hash, clamped progress)` (progress is monotone + bounded by the
/// targets, so the state space stays finite); move-ordering prefers the swap that
/// advances the checklist most, then score.
#[must_use]
pub fn find_checklist(seed: u64, node_budget: u64) -> Option<Vec<Swap>> {
    use checklist_mode as m;
    let targets = checklist_targets(seed, m::COLORS);
    let game = Game::new(deal(seed, m::WIDTH, m::HEIGHT, m::COLORS), seed, m::COLORS);
    let mut visited = HashSet::new();
    let mut budget = node_budget;
    let mut path = Vec::new();
    if checklist_dfs(
        &game,
        ChecklistProgress::default(),
        &targets,
        &mut visited,
        &mut budget,
        &mut path,
        m::MOVE_BUDGET,
    ) {
        Some(path)
    } else {
        None
    }
}

/// How far a progress is toward the targets, each goal clamped so overshoot does
/// not distinguish states or inflate move-ordering (a met goal contributes its
/// full target and no more).
fn clamped_progress(p: &ChecklistProgress, t: &ChecklistTargets) -> (u32, u32, u32) {
    (
        p.color_cleared.min(t.color_count),
        p.striped_made.min(t.striped),
        p.wrapped_made.min(t.wrapped),
    )
}

#[allow(clippy::too_many_arguments)] // a self-contained recursive worker; grouping would obscure it
fn checklist_dfs(
    game: &Game,
    progress: ChecklistProgress,
    targets: &ChecklistTargets,
    visited: &mut HashSet<String>,
    budget: &mut u64,
    path: &mut Vec<Swap>,
    move_budget: usize,
) -> bool {
    if progress.met(targets) {
        return true;
    }
    if *budget == 0 || path.len() >= move_budget {
        return false;
    }
    *budget -= 1;
    let (pc, ps, pw) = clamped_progress(&progress, targets);
    if !visited.insert(format!("{}|{pc}|{ps}|{pw}", game.state_hash())) {
        return false; // this board with this progress was already explored
    }
    let mut swaps = legal_swaps(&game.board);
    // Most checklist progress first, then score — the winning line is usually greedy.
    swaps.sort_by_cached_key(|&(from, to)| {
        let mut probe = game.clone();
        let report = probe.play_move(from, to);
        let mut next = progress;
        next.apply(&report, targets.color);
        let (nc, ns, nw) = clamped_progress(&next, targets);
        let advance = (nc - pc) + (ns - ps) + (nw - pw);
        (Reverse(advance), Reverse(report.score_gained))
    });
    for (from, to) in swaps {
        let mut next = game.clone();
        let report = next.play_move(from, to);
        if report.legal {
            let mut next_progress = progress;
            next_progress.apply(&report, targets.color);
            path.push([from.0, from.1, to.0, to.1]);
            if checklist_dfs(
                &next,
                next_progress,
                targets,
                visited,
                budget,
                path,
                move_budget,
            ) {
                return true;
            }
            path.pop();
        }
    }
    false
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

/// Generate a winnable-daily **clear-the-ingredients** pack (Track D).
#[must_use]
pub fn generate_ingredients_pack(
    master_seed: u64,
    count: usize,
    node_budget: u64,
    max_seeds: u64,
) -> Pack {
    generate(master_seed, count, node_budget, max_seeds, find_ingredients)
}

/// Generate a winnable-daily **checklist** pack (Track D, T6). Only seeds whose
/// checklist the solver completes in budget are kept — the winnability guarantee.
#[must_use]
pub fn generate_checklist_pack(
    master_seed: u64,
    count: usize,
    node_budget: u64,
    max_seeds: u64,
) -> Pack {
    generate(master_seed, count, node_budget, max_seeds, find_checklist)
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

/// Serialize an ingredients pack (`kind = "match3-ingredients-pack"`, v1).
///
/// # Errors
/// Propagates [`pond_docformat::DocError`] on a serialization failure.
pub fn ingredients_pack_to_doc(pack: &Pack) -> Result<Vec<u8>, pond_docformat::DocError> {
    write_pack(pack, "match3-ingredients-pack")
}

/// Serialize a checklist pack (`kind = "match3-checklist-pack"`, v1).
///
/// # Errors
/// Propagates [`pond_docformat::DocError`] on a serialization failure.
pub fn checklist_pack_to_doc(pack: &Pack) -> Result<Vec<u8>, pond_docformat::DocError> {
    write_pack(pack, "match3-checklist-pack")
}

// --- target-score par table (parity Track P-now / C1) ---

/// The 1★/2★/3★ score thresholds for a target-score `seed`, from the **player
/// ladder** (weak / medium / strong), so stars mean "you played as well as a
/// {weak, competent, strong} solver". Deterministic. Strong is too slow to run
/// live at verify, so this is computed **offline** into the baked par table.
///
/// Rungs (provisional, tunable — validated later by the offline model-calibration
/// study): **1★ = a random-legal-move player** (a gentle floor most players pass),
/// **2★ = greedy** (competent), **3★ = the specials-exploiting player** (B6 —
/// a beam that deliberately builds and combos specials; strong-but-attainable).
/// It carries the plain beam as a floor, so 3★ ≥ beam-8 ≥ greedy. Tiers are forced
/// strictly increasing so 0–3 stars are always distinct.
#[must_use]
pub fn par_tiers(seed: u64) -> [u64; 3] {
    use target_score_mode as m;
    let weak = random_score(seed, m::WIDTH, m::HEIGHT, m::COLORS, m::MOVE_BUDGET);
    let medium = reference_score(seed, m::WIDTH, m::HEIGHT, m::COLORS, m::MOVE_BUDGET);
    let strong = reference_score_specials(seed, m::WIDTH, m::HEIGHT, m::COLORS, m::MOVE_BUDGET, 8);
    // weak <= medium <= strong holds by construction (the specials player carries the
    // beam, which carries greedy); nudge the rare tie so thresholds strictly increase.
    let t1 = weak.min(medium);
    let t2 = medium.max(t1 + 1);
    let t3 = strong.max(t2 + 1);
    [t1, t2, t3]
}

/// One target-score deal's par: its seed and the baked star thresholds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParEntry {
    /// The deal seed.
    pub seed: u64,
    /// 1★ / 2★ / 3★ score thresholds.
    pub tiers: [u64; 3],
}

/// The baked target-score par table — the daily seeds and their ladder tiers.
/// Embedded in the binding so play-time and verify-time look up the same par
/// without running the (slow) strong player live.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParPack {
    /// Par per daily seed; the runtime indexes seeds by date (`seeds[dayIndex % len]`).
    pub entries: Vec<ParEntry>,
}

/// Generate the target-score par table over the deterministic seed stream
/// `master_seed, master_seed+1, …` (`count` entries). Byte-identically regenerable.
#[must_use]
pub fn generate_par_pack(master_seed: u64, count: usize) -> ParPack {
    let entries = (0..count as u64)
        .map(|i| {
            let seed = master_seed.wrapping_add(i);
            ParEntry {
                seed,
                tiers: par_tiers(seed),
            }
        })
        .collect();
    ParPack { entries }
}

/// Serialize the par table (`kind = "match3-par-pack"`, v1).
///
/// # Errors
/// Propagates [`pond_docformat::DocError`] on a serialization failure.
pub fn par_pack_to_doc(pack: &ParPack) -> Result<Vec<u8>, pond_docformat::DocError> {
    pond_docformat::write("match3-par-pack", 1, pack)
}
