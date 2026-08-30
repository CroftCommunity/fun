//! Budgeted win-finder for Mahjong solitaire positions — the hint oracle.
//!
//! Every **deal** is winnable by construction (`mahjong_core::generate`), but
//! the player leaves the construction line at once, and whether *this*
//! position still clears is NP-complete in general. So the oracle is a
//! depth-first search with a node budget: it returns a winning line when it
//! finds one, and `None` when it runs out — **winnable vs unknown**, never a
//! claim that a position is lost. Two things keep it fast on the positions
//! that matter: memoisation on the present-tile bitset (which pair took which
//! slot is irrelevant once the slots are empty — only *which* tiles are gone),
//! and the classic safe pruning — when every remaining tile of a class is free,
//! take them all without branching, since removing free tiles can only free
//! more.
//!
//! The search is bimodal — measured on fresh Turtles, most clear in ~60 nodes
//! and a few sink millions into one wrong early branch — so the budget is
//! spent as **random restarts with growing caps** (de Bondt's remedy): the
//! first pass follows the heuristic exactly, each later pass perturbs its
//! ordering from a seeded stream, and the dead-position memo carries across
//! passes. Only a position whose subtree was *exhausted* is memoised as dead;
//! one abandoned for budget is not.
//!
//! A [`Hint`] is the first move of a found line (`proven`), or, when the
//! search gives up, the legal pair that frees the most tiles (`!proven`) — and
//! the front end binds its wording to that flag.

#![warn(missing_docs)]

use std::collections::HashSet;

use mahjong_core::{Board, Face, Kind, Rng};

/// A winning line found from a position, and the nodes it cost.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    /// Pairs `(a, b)` in an order that clears the board.
    pub line: Vec<(usize, usize)>,
    /// Search nodes expanded.
    pub nodes: u64,
}

/// A suggested move.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hint {
    /// One tile of the pair (`a < b`).
    pub a: usize,
    /// The other.
    pub b: usize,
    /// `true` when the pair opens a line the search followed to a clear;
    /// `false` when it is the heuristic's best guess.
    pub proven: bool,
}

/// A search with a node budget and a transposition memo.
#[derive(Debug)]
pub struct Search {
    budget: u64,
    nodes: u64,
    cap: u64,
    dead: HashSet<Vec<u8>>,
    noise: Option<Rng>,
}

/// The smallest per-pass cap; passes double from here until the budget is spent.
const FIRST_CAP: u64 = 2_000;

/// The class a face matches within: its own face, or its wild kind.
fn class(face: Face) -> u8 {
    match face.kind() {
        Kind::Flower => 0xF0,
        Kind::Season => 0xF1,
        _ => face.0,
    }
}

impl Search {
    /// A search allowed `budget` node expansions.
    #[must_use]
    pub fn new(budget: u64) -> Self {
        Self {
            budget,
            nodes: 0,
            cap: 0,
            dead: HashSet::new(),
            noise: None,
        }
    }

    /// Find a winning line from `board`, or `None` within the budget.
    pub fn find(&mut self, board: &Board) -> Option<Found> {
        let mut pass = 0u32;
        let mut cap = FIRST_CAP.min(self.budget.max(1));
        while self.nodes < self.budget || pass == 0 {
            self.cap = (self.nodes + cap).min(self.budget);
            self.noise = (pass > 0).then(|| Rng::new(pass));
            let mut path = Vec::new();
            if self.dfs(board, &mut path) {
                return Some(Found {
                    line: path,
                    nodes: self.nodes,
                });
            }
            if self.budget == 0 || self.nodes < self.cap {
                // The subtree was exhausted, not capped: the position is dead.
                return None;
            }
            pass += 1;
            cap = cap.saturating_mul(2);
        }
        None
    }

    fn dfs(&mut self, board: &Board, path: &mut Vec<(usize, usize)>) -> bool {
        if board.is_cleared() {
            return true;
        }
        if self.nodes >= self.cap {
            return false;
        }
        self.nodes += 1;
        let key = key_of(board);
        if self.dead.contains(&key) {
            return false;
        }

        // Safe pruning: a class whose every remaining tile is free comes off now.
        let forced = forced_pairs(board);
        if !forced.is_empty() {
            let mut next = board.clone();
            let before = path.len();
            for &(a, b) in &forced {
                if next.remove_pair(a, b).is_err() {
                    path.truncate(before);
                    self.dead.insert(key);
                    return false;
                }
                path.push((a, b));
            }
            if self.dfs(&next, path) {
                return true;
            }
            path.truncate(before);
            if self.nodes < self.cap {
                self.dead.insert(key);
            }
            return false;
        }

        let mut moves: Vec<(usize, (usize, usize))> = board
            .legal_moves()
            .into_iter()
            .map(|(a, b)| {
                let mut next = board.clone();
                let _ = next.remove_pair(a, b);
                (next.free_slots().len(), (a, b))
            })
            .collect();
        // Most newly-freed tiles first; ties by slot id, so the first pass is
        // stable. Later passes add seeded noise to the score so they diverge.
        if let Some(rng) = self.noise.as_mut() {
            for m in &mut moves {
                m.0 += rng.below(3) as usize;
            }
        }
        moves.sort_by(|x, y| y.0.cmp(&x.0).then(x.1.cmp(&y.1)));
        for (_, (a, b)) in moves {
            let mut next = board.clone();
            if next.remove_pair(a, b).is_err() {
                continue;
            }
            path.push((a, b));
            if self.dfs(&next, path) {
                return true;
            }
            path.pop();
            if self.nodes >= self.cap {
                return false;
            }
        }
        self.dead.insert(key);
        false
    }
}

/// The present-tile bitset — the transposition key.
fn key_of(board: &Board) -> Vec<u8> {
    let present = board.present();
    let mut key = vec![0u8; present.len().div_ceil(8)];
    for (i, &p) in present.iter().enumerate() {
        if p {
            key[i / 8] |= 1 << (i % 8);
        }
    }
    key
}

/// Pairs that are safe to take without branching: every remaining tile of the
/// class is free (two → one pair; four → two pairs, any pairing).
fn forced_pairs(board: &Board) -> Vec<(usize, usize)> {
    let n = board.layout().len();
    let mut present_by_class: Vec<Vec<usize>> = vec![Vec::new(); 256];
    for i in 0..n {
        if board.is_present(i) {
            present_by_class[class(board.face(i)) as usize].push(i);
        }
    }
    let mut out = Vec::new();
    for group in present_by_class.iter().filter(|g| !g.is_empty()) {
        if group.iter().all(|&i| board.is_free(i)) {
            for pair in group.chunks(2) {
                if pair.len() == 2 {
                    out.push((pair[0], pair[1]));
                }
            }
        }
    }
    out
}

/// Find a winning line from `board` within `node_budget` nodes.
#[must_use]
pub fn find_win(board: &Board, node_budget: u64) -> Option<Found> {
    Search::new(node_budget).find(board)
}

/// The legal pair that frees the most tiles (ties by slot id).
fn greedy(board: &Board) -> Option<(usize, usize)> {
    let mut best: Option<(usize, (usize, usize))> = None;
    for (a, b) in board.legal_moves() {
        let mut next = board.clone();
        if next.remove_pair(a, b).is_err() {
            continue;
        }
        let freed = next.free_slots().len();
        if best.is_none_or(|(f, _)| freed > f) {
            best = Some((freed, (a, b)));
        }
    }
    best.map(|(_, m)| m)
}

/// A hint for `board`: the first move of a found line, else the greedy pair,
/// else `None` (cleared or stuck).
#[must_use]
pub fn hint(board: &Board, node_budget: u64) -> Option<Hint> {
    if board.is_cleared() {
        return None;
    }
    if let Some(found) = find_win(board, node_budget) {
        if let Some(&(a, b)) = found.line.first() {
            return Some(Hint { a, b, proven: true });
        }
    }
    greedy(board).map(|(a, b)| Hint {
        a,
        b,
        proven: false,
    })
}
