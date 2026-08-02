//! Budgeted best-first search + winnable-daily-pack generator for Color Sort.
//!
//! [`find_win`] is a **budgeted** depth-first search over [`color_sort_core`]
//! with order-agnostic canonical-state memoization (tube order is irrelevant to
//! solvability, so the visited key sorts the tubes) and a colour-break heuristic
//! for move ordering. It searches the player's actual move set ([`ui_moves`]):
//! the UI-blocked "vacuous" monochrome→empty pour leaves the canonical state
//! **identical**, so it can never help solve, and excluding it makes "solvable"
//! and "not deadlocked" the same move set. It returns a solving line if one is
//! found within the node budget, else `None` (winnable vs unknown — it does not
//! prove unwinnability). Par = the returned line's length (not claimed shortest;
//! shortest is NP-complete — brief §1).
//!
//! [`generate`] runs the deterministic attempt loop (brief §4): deal, reject
//! trivial, solve; the first solvable attempt wins. [`generate_pack`] certifies
//! a year of daily deals into a **byte-identically-regenerable** pack indexed by
//! UTC day.

#![warn(missing_docs)]

use std::collections::HashSet;

use color_sort_core::{apply_move, deal, ui_moves, DealParams, Game, Move, State};
use serde::{Deserialize, Serialize};

/// Recursion/stack guard. Solutions at these sizes are far shorter than this.
const MAX_DEPTH: usize = 400;

/// The order-agnostic canonical key of a state: its tubes sorted, flattened with
/// a `0xFF` sentinel between them (colour ids are `< 0xFF`). Two states that
/// differ only in tube arrangement share a key, collapsing the search.
fn canonical(state: &State) -> Vec<u8> {
    let mut tubes = state.tubes.clone();
    tubes.sort_unstable();
    let mut key = Vec::with_capacity(state.tubes.len() * (state.cap as usize + 1));
    for tube in &tubes {
        key.extend_from_slice(tube);
        key.push(0xFF);
    }
    key
}

/// The colour-break heuristic (brief §3): the number of positions where a unit
/// sits directly on a different colour, plus, for each colour, the surplus of
/// tubes whose bottom unit is that colour (`count - 1`, clamped at `≥ 0`). Lower
/// is closer to solved (`0` at a win). Admissible-ish; used here for move ordering.
#[must_use]
pub fn heuristic(state: &State) -> u32 {
    let mut breaks = 0u32;
    let mut bottoms = [0u32; 256];
    for tube in &state.tubes {
        for pair in tube.windows(2) {
            if pair[0] != pair[1] {
                breaks += 1;
            }
        }
        if let Some(&bottom) = tube.first() {
            bottoms[bottom as usize] += 1;
        }
    }
    let surplus: u32 = bottoms.iter().map(|&c| c.saturating_sub(1)).sum();
    breaks + surplus
}

/// Find a solving pour line for `state` within `node_budget`, or `None`.
#[must_use]
pub fn find_win(state: &State, node_budget: u64) -> Option<Vec<Move>> {
    let mut visited = HashSet::new();
    let mut budget = node_budget;
    let mut path = Vec::new();
    if dfs(state, &mut visited, &mut budget, &mut path) {
        Some(path)
    } else {
        None
    }
}

fn dfs(
    state: &State,
    visited: &mut HashSet<Vec<u8>>,
    budget: &mut u64,
    path: &mut Vec<Move>,
) -> bool {
    if state.is_won() {
        return true;
    }
    if *budget == 0 || path.len() >= MAX_DEPTH {
        return false;
    }
    *budget -= 1;
    if !visited.insert(canonical(state)) {
        return false; // this canonical position was already explored
    }
    // Order candidate moves by the heuristic of the resulting state (best first),
    // so a solution is found fast when one is reachable.
    let mut scored: Vec<(u32, Move)> = ui_moves(state)
        .into_iter()
        .map(|mv| {
            let mut next = state.clone();
            let _ = apply_move(&mut next, mv);
            (heuristic(&next), mv)
        })
        .collect();
    scored.sort_by_key(|&(h, _)| h);
    for (_, mv) in scored {
        let mut next = state.clone();
        if apply_move(&mut next, mv).is_err() {
            continue;
        }
        path.push(mv);
        if dfs(&next, visited, budget, path) {
            return true;
        }
        path.pop();
    }
    false
}

/// A certified winnable deal: the parameters that produce it, plus its par.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DailyEntry {
    /// The 32-bit deal base seed.
    pub base: u32,
    /// The generator attempt index that produced this winnable deal.
    pub attempt: u16,
    /// The solver line length for the deal (par).
    pub par: u32,
}

/// One certified deal that keeps its full solving line, for replay tests.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fixture {
    /// The 32-bit deal base seed.
    pub base: u32,
    /// The winnable attempt index.
    pub attempt: u16,
    /// Par (the line length).
    pub par: u32,
    /// The solving line (replays to a win).
    pub moves: Vec<Move>,
}

/// The winnable-daily pack: a year of certified deals (indexed by UTC day at
/// runtime) plus one `fixture` with its solving line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pack {
    /// Number of colours (`n`) every daily deal uses.
    pub colors: u8,
    /// Number of empty tubes (`k`) every daily deal uses.
    pub empties: u8,
    /// Certified daily deals, indexed by date at runtime (`entries[day % len]`).
    pub entries: Vec<DailyEntry>,
    /// One certified deal with its full solving line, for tests + the board E2E.
    pub fixture: Fixture,
}

/// The result of generating a winnable deal: the winning attempt + its line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Generated {
    /// The winnable attempt index.
    pub attempt: u16,
    /// The solving line (par = `moves.len()`).
    pub moves: Vec<Move>,
}

/// Run the deterministic attempt loop for `(base, colors, empties)` (brief §4):
/// deal, reject trivial, solve; return the first solvable attempt within
/// `max_attempts`, or `None` if none solved inside the budget.
#[must_use]
pub fn generate(
    base: u32,
    colors: u8,
    empties: u8,
    node_budget: u64,
    max_attempts: u16,
) -> Option<Generated> {
    for attempt in 0..max_attempts {
        let params = DealParams {
            base,
            attempt,
            colors,
            empties,
        };
        let state = deal(params);
        if state.is_trivial_deal() {
            continue;
        }
        if let Some(moves) = find_win(&state, node_budget) {
            return Some(Generated { attempt, moves });
        }
    }
    None
}

/// A deterministic `splitmix64` step — a self-contained PRNG for the build-time
/// base-seed schedule (no `rand` dependency, so the pack regenerates byte-identically).
fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Generate the winnable-daily pack: walk a `splitmix64` schedule of distinct
/// base seeds from `master_seed`, certify each winnable, and collect `count`
/// entries. The `fixture` keeps the shortest-line certified deal. Deterministic
/// → byte-identically regenerable.
///
/// # Panics
/// Panics if fewer than `count` seeds certify within `max_seeds` (a build-time
/// misconfiguration). Never reached at runtime; the pack is generated offline.
#[must_use]
pub fn generate_pack(
    master_seed: u64,
    colors: u8,
    empties: u8,
    count: usize,
    node_budget: u64,
    max_attempts: u16,
    max_seeds: usize,
) -> Pack {
    let mut entries = Vec::new();
    let mut fixture: Option<Fixture> = None;
    let mut seen = HashSet::new();
    let mut state = master_seed;
    let mut tries = 0;
    while entries.len() < count && tries < max_seeds {
        tries += 1;
        let base = (splitmix64(&mut state) & 0xFFFF_FFFF) as u32;
        if !seen.insert(base) {
            continue; // keep base seeds distinct
        }
        if let Some(g) = generate(base, colors, empties, node_budget, max_attempts) {
            let par = u32::try_from(g.moves.len()).unwrap_or(u32::MAX);
            if fixture.as_ref().is_none_or(|f| par < f.par) {
                fixture = Some(Fixture {
                    base,
                    attempt: g.attempt,
                    par,
                    moves: g.moves,
                });
            }
            entries.push(DailyEntry {
                base,
                attempt: g.attempt,
                par,
            });
        }
    }
    assert!(
        entries.len() == count,
        "only certified {} of {count} daily deals in {max_seeds} seeds",
        entries.len()
    );
    Pack {
        colors,
        empties,
        entries,
        fixture: fixture.expect("at least one certified deal"),
    }
}

/// Serialize a pack through the `pond-docformat` envelope
/// (`kind = "color-sort-daily-pack"`, version 1).
///
/// # Errors
/// Propagates [`pond_docformat::DocError`] on a serialization failure.
pub fn pack_to_doc(pack: &Pack) -> Result<Vec<u8>, pond_docformat::DocError> {
    pond_docformat::write("color-sort-daily-pack", 1, pack)
}

/// Replay a certified line through a fresh game and confirm it wins — the
/// property the pack promises (used by tests).
#[must_use]
pub fn line_wins(params: DealParams, moves: &[Move]) -> bool {
    let mut game = Game::new(color_sort_core::pack_seed(params));
    for &mv in moves {
        if game.play(mv).is_err() {
            return false;
        }
    }
    game.is_won()
}

#[cfg(test)]
mod tests {
    use super::*;
    use color_sort_core::pack_seed;

    #[test]
    fn solves_a_trivial_hand_built_deal() {
        // One colour away from solved: [red,red,red] + one red elsewhere + empty.
        let state = State::from_tubes(vec![vec![0, 0, 0], vec![0], vec![]], 1, 4);
        let line = find_win(&state, 10_000).expect("solvable");
        // Replay the line and confirm the win.
        let mut s = state.clone();
        for &mv in &line {
            apply_move(&mut s, mv).expect("legal");
        }
        assert!(s.is_won());
    }

    #[test]
    fn flags_an_unsolvable_deal() {
        // Two colours interleaved with k = 0 (no empty tube): each tube is
        // [a,b,a,b], tops mismatch, no empty — no legal move at all. Unsolvable.
        let state = State::from_tubes(vec![vec![0, 1, 0, 1], vec![1, 0, 1, 0]], 2, 4);
        assert!(ui_moves(&state).is_empty(), "no move available");
        assert!(find_win(&state, 10_000).is_none(), "flagged unsolvable");
    }

    #[test]
    fn generate_finds_a_winnable_daily_deal_and_par_matches() {
        let g = generate(1234, 10, 2, 300_000, 64).expect("a base seed certifies");
        let params = DealParams {
            base: 1234,
            attempt: g.attempt,
            colors: 10,
            empties: 2,
        };
        assert!(line_wins(params, &g.moves), "the certified line wins");
        // Par recorded equals the returned move-list length.
        let record = pond_outcome::attest::<color_sort_core::ColorSort>(
            pack_seed(params),
            g.moves.clone(),
            pond_outcome::Outcome::Won,
            Some(false),
        );
        assert_eq!(record.move_count, g.moves.len());
    }

    #[test]
    fn small_pack_regenerates_identically() {
        let a = generate_pack(42, 4, 2, 3, 100_000, 32, 200);
        let b = generate_pack(42, 4, 2, 3, 100_000, 32, 200);
        assert_eq!(a, b, "same inputs → byte-identical pack");
        assert_eq!(a.entries.len(), 3);
        // The fixture line wins.
        let params = DealParams {
            base: a.fixture.base,
            attempt: a.fixture.attempt,
            colors: 4,
            empties: 2,
        };
        assert!(line_wins(params, &a.fixture.moves));
    }
}
