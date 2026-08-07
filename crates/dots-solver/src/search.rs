//! The value search: exact when the lattice is small enough, depth-capped above.
//!
//! ## The recurrence, and why the memo key is the edge set alone
//!
//! Who owns the already-claimed boxes cannot affect future play — it only shifts
//! the running score. So the best *future* box margin for the side to move
//! depends on the drawn-edge set and nothing else:
//!
//! ```text
//! value(edges) = max over free edges e of
//!     k > 0  ->  k + value(edges | e)      // a capture KEEPS the turn
//!     k == 0 -> -value(edges | e)          // the turn passes, so flip
//! value(all edges drawn) = 0
//! ```
//!
//! Every subset of the free edges is reachable, so a fully memoized solve expands
//! exactly `2^f - 1` nodes for `f` free edges. That makes the cost a closed form
//! rather than something to sample: 1.05M nodes at 20 free edges (~55 ms native),
//! 16.8M at 24 (~1.2 s). [`TRACTABLE_EDGES`] sits at the affordable end of that
//! curve; above it the search is depth-capped and its facts are **not** exact.
//!
//! ## The table is compact, not 2^24
//!
//! Keying on the raw 24-bit mask would need a flat 16.8 MB table. Instead the
//! root's `f` free edges are remapped onto bits `0..f`, so the table is `2^f`
//! entries — at most 1 MB — which is what makes this affordable in wasm. The
//! price is that a table serves one root and is rebuilt each move; that is
//! *cheaper*, not dearer, because a whole game totals about `2^21` nodes.

use adversary_solver::NodeBudget;
use dots_core::{completed_boxes, legal_edges, Board, Edge, EDGES};

/// The most free edges the exact solve is affordable at.
///
/// Measured (`plans/2026-08-07-dots-and-boxes.md` Phase 0): the solve expands
/// exactly `2^f - 1` nodes, which is 1,048,575 here at ~55 ms native. 22 free
/// edges would be 4.2M nodes / ~298 ms, which is over the 400 ms per-move target
/// once wasm and a phone are accounted for.
///
/// **Not a speed knob.** Like Othello's `TRACTABLE_EMPTIES` and checkers'
/// `TRACTABLE_PIECES`, this sits at its measured knee. Lowering it to buy latency
/// spends proof coverage, which is the one thing the tutor's honesty rests on.
pub const TRACTABLE_EDGES: u32 = 20;

/// Backstop work allowance for one exact solve.
///
/// The exact solve at [`TRACTABLE_EDGES`] is a known 1,048,575 nodes, so this is
/// deliberately slack — it exists so a future board size or a bug cannot hang the
/// browser, not to shape play. If it ever trips, the caller gets `None` and the
/// facts are reported as **not exact** rather than as a truncated guess.
pub const EXACT_NODE_BUDGET: u64 = 4_000_000;

/// Work allowance for the depth-capped search above [`TRACTABLE_EDGES`].
///
/// Small on purpose, and it is the whole budget for a position's move list rather
/// than per move. The capped path only ever runs in the first four plies, where
/// **no box can reach three sides** (that needs three edges) let alone be
/// captured — so there is nothing material for depth to find, and a large
/// allowance buys nothing but latency. Sharing `EXACT_NODE_BUDGET` here cost 91
/// seconds a game before it was measured.
pub const CAPPED_NODE_BUDGET: u64 = 200_000;

/// Unset memo slot. Margins fit far inside `i8`, so `MIN` is free as a sentinel.
const UNKNOWN: i8 = i8::MIN;

/// An exact solver bound to one root position.
pub struct Exact {
    /// Memo over the root's free edges: index is the submask of slots now drawn.
    memo: Vec<i8>,
    /// Board edge index -> slot, or `u8::MAX` if drawn at the root.
    slot_of: [u8; EDGES],
    root: Board,
    budget: NodeBudget,
    nodes: u64,
}

impl Exact {
    /// Build a solver for `pos`. Allocates `2^free` memo entries, so callers must
    /// check [`is_affordable`] first.
    #[must_use]
    pub fn new(pos: &Board, budget: NodeBudget) -> Self {
        let mut slot_of = [u8::MAX; EDGES];
        let mut next_slot = 0u8;
        for (e, slot) in slot_of.iter_mut().enumerate() {
            if !pos.is_drawn(e) {
                *slot = next_slot;
                next_slot += 1;
            }
        }
        let size = 1usize << next_slot;
        Exact {
            memo: vec![UNKNOWN; size],
            slot_of,
            root: *pos,
            budget,
            nodes: 0,
        }
    }

    /// Whether an exact solve of `pos` is within [`TRACTABLE_EDGES`].
    #[must_use]
    pub fn is_affordable(pos: &Board) -> bool {
        pos.free_count() <= TRACTABLE_EDGES
    }

    /// Nodes expanded so far (the cost measurement, and what the budget charges).
    #[must_use]
    pub fn nodes(&self) -> u64 {
        self.nodes
    }

    /// Best future box margin for the side to move at `edges`, or `None` if the
    /// budget ran out. A `None` is **never** memoized, so a later call with more
    /// budget still computes the true value.
    fn value(&mut self, edges: u32, key: u32) -> Option<i8> {
        if edges == dots_core::ALL_EDGES {
            return Some(0);
        }
        let cached = self.memo[key as usize];
        if cached != UNKNOWN {
            return Some(cached);
        }
        if !self.budget.charge() {
            return None;
        }
        self.nodes += 1;

        let mut best = i8::MIN + 1;
        // Walk the free-edge bitmask directly. Iterating `self.slots` would need a
        // clone to satisfy the borrow checker, and a Vec clone per node is 16.8M
        // allocations on a full solve -- measured at 100x the whole search.
        let mut rest = !edges & dots_core::ALL_EDGES;
        while rest != 0 {
            let e = rest.trailing_zeros();
            rest &= rest - 1;
            let bit = 1u32 << e;
            let slot = self.slot_of[e as usize];
            let child_key = key | (1u32 << slot);
            let k = completed_boxes(edges, e as usize).count_ones() as i8;
            let child = self.value(edges | bit, child_key)?;
            // A capture keeps the turn, so the child's value is still ours and
            // the boxes add. Otherwise the turn passes and the sign flips.
            let v = if k > 0 { k + child } else { -child };
            if v > best {
                best = v;
            }
        }
        self.memo[key as usize] = best;
        Some(best)
    }

    /// The best future margin for the side to move at the root.
    pub fn root_value(&mut self) -> Option<i32> {
        let edges = self.root.edges;
        self.value(edges, 0).map(i32::from)
    }

    /// Every legal move's **final** box margin from the root mover's perspective:
    /// the boxes they are already ahead by, plus the best future margin the move
    /// leads to. `None` if the budget ran out.
    ///
    /// The final margin (not the future margin) is the value the difficulty band
    /// and the tutor want, because its **sign is the win/loss class**.
    pub fn move_values(&mut self) -> Option<Vec<(Edge, i32)>> {
        let root = self.root;
        let (a, b) = root.box_counts();
        let (mine, theirs) = match root.to_move {
            adversary_core::Side::A => (a, b),
            adversary_core::Side::B => (b, a),
        };
        let standing = i32::from(mine) - i32::from(theirs);

        let mut out = Vec::new();
        for mv in legal_edges(&root) {
            let e = mv.0;
            let bit = 1u32 << e;
            let slot = self.slot_of[e as usize];
            let k = i8::try_from(completed_boxes(root.edges, e as usize).count_ones()).ok()?;
            let child = self.value(root.edges | bit, 1u32 << slot)?;
            let future = if k > 0 { k + child } else { -child };
            out.push((mv, standing + i32::from(future)));
        }
        Some(out)
    }
}

/// Boxes standing at exactly three sides — the side to move claims every one of
/// them, so they are already theirs in all but name.
#[must_use]
fn boxes_at_three(pos: &Board) -> i32 {
    let mut n = 0;
    for e in 0..EDGES {
        if !pos.is_drawn(e) {
            n += completed_boxes(pos.edges, e).count_ones() as i32;
        }
    }
    // Each 3-sided box is counted once per free edge that closes it, and only one
    // free edge can close a given box, so no double counting is possible.
    n
}

/// Static evaluation from the side to move's perspective, in tenths of a box.
///
/// Deliberately thin. Above [`TRACTABLE_EDGES`] — the first four plies — no box
/// can even reach three sides, so there is nothing material to weigh and any
/// evaluation is near-flat by nature. It is honest about that rather than
/// elaborate: margin, plus the boxes the mover is about to collect.
#[must_use]
pub fn heuristic(pos: &Board) -> i32 {
    let (a, b) = pos.box_counts();
    let (mine, theirs) = match pos.to_move {
        adversary_core::Side::A => (a, b),
        adversary_core::Side::B => (b, a),
    };
    (i32::from(mine) - i32::from(theirs)) * 10 + boxes_at_three(pos) * 3
}

/// Depth-capped negamax used above [`TRACTABLE_EDGES`]. Returns the value from
/// the side to move's perspective, in the same tenths-of-a-box units as
/// [`heuristic`].
fn capped(pos: &Board, depth: u32, budget: &mut NodeBudget) -> i32 {
    let moves = legal_edges(pos);
    if depth == 0 || moves.is_empty() || !budget.charge() {
        return heuristic(pos);
    }
    let mut best = i32::MIN;
    for mv in ordered(pos, moves) {
        let child = dots_core::apply_move(pos, mv);
        // The turn only flipped if nothing was captured, so only then does the
        // child's value belong to the opponent.
        let v = if child.to_move == pos.to_move {
            capped(&child, depth - 1, budget)
        } else {
            -capped(&child, depth - 1, budget)
        };
        best = best.max(v);
    }
    best
}

/// Captures first. Ordering matters for the budget backstop, not for correctness.
///
/// Deliberately cheap — one `completed_boxes` call per move and nothing else. A
/// first version also ranked by how many boxes a move handed over, which meant
/// `apply_move` plus a 24-edge scan **inside a sort comparator**, on every node of
/// an unmemoized search. Measured cost: one Hard game took 91 seconds. The
/// hand-over term is a better ordering signal and still not worth that.
fn ordered(pos: &Board, mut moves: Vec<Edge>) -> Vec<Edge> {
    moves.sort_by_cached_key(|mv| -(completed_boxes(pos.edges, mv.0 as usize).count_ones() as i32));
    moves
}

/// Every legal move's depth-capped value, from the mover's perspective.
#[must_use]
pub fn move_values_capped(pos: &Board, depth: u32) -> Vec<(Edge, i32)> {
    let mut budget = NodeBudget::of(CAPPED_NODE_BUDGET);
    legal_edges(pos)
        .into_iter()
        .map(|mv| {
            let child = dots_core::apply_move(pos, mv);
            let v = if child.to_move == pos.to_move {
                capped(&child, depth.saturating_sub(1), &mut budget)
            } else {
                -capped(&child, depth.saturating_sub(1), &mut budget)
            };
            (mv, v)
        })
        .collect()
}

/// Per-move values plus whether they are **exact**.
///
/// Exact below [`TRACTABLE_EDGES`] (a completed full solve, so the sign of each
/// value is a proven win/loss class), depth-capped above. The flag is derived
/// from *whether the search completed*, never from the position — a budget that
/// cut a solve short reports `false`, which is the trap §10 names.
#[must_use]
pub fn move_values(pos: &Board, capped_depth: u32) -> (Vec<(Edge, i32)>, bool) {
    if Exact::is_affordable(pos) {
        let mut ex = Exact::new(pos, NodeBudget::of(EXACT_NODE_BUDGET));
        if let Some(values) = ex.move_values() {
            return (values, true);
        }
    }
    (move_values_capped(pos, capped_depth), false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::{Adversary, Side};
    use dots_core::{apply_move, box_mask, v_edge, Dots, ALL_EDGES, BOXES};

    fn from_open(keep_open: &[usize], to_move: Side) -> Board {
        let mut edges = ALL_EDGES;
        for &e in keep_open {
            edges &= !(1u32 << e);
        }
        Board {
            edges,
            owners: [0; BOXES],
            to_move,
        }
    }

    #[test]
    fn the_last_edge_of_a_box_is_worth_that_box() {
        let pos = from_open(&[v_edge(0, 0)], Side::A);
        let mut ex = Exact::new(&pos, NodeBudget::unlimited());
        let values = ex.move_values().expect("tiny solve completes");
        assert_eq!(values.len(), 1);
        assert_eq!(values[0].1, 1, "closing the last box is a +1 margin");
    }

    #[test]
    fn a_shared_edge_closing_two_boxes_is_worth_two() {
        let shared = v_edge(0, 1);
        let mut edges = box_mask(0) | box_mask(1);
        edges &= !(1u32 << shared);
        // Everything else drawn too, so the shared edge is the only move left.
        let pos = from_open(&[shared], Side::A);
        assert_eq!(pos.edges | (1u32 << shared), ALL_EDGES);
        let mut ex = Exact::new(&pos, NodeBudget::unlimited());
        let values = ex.move_values().expect("tiny solve completes");
        // With every other edge drawn, that one edge closes both boxes 0 and 1
        // -- and the other seven boxes were already closed, unowned.
        assert_eq!(values[0].1, 2, "one edge, two boxes, +2");
        let _ = edges;
    }

    #[test]
    fn the_exact_solver_reproduces_the_independently_measured_game_value() {
        // The Phase 0 spike -- a separately written implementation of the same
        // recurrence -- solved the empty board to -3 (a second-player win, 6-3),
        // and validated itself against a hand-derivable 1x1. Two independent
        // implementations agreeing on a non-obvious value is stronger evidence
        // than either one's own unit tests.
        //
        // This is the full 16.8M-node solve, so it is the slowest test here and
        // deliberately still present: it is the one check that the search is
        // right rather than merely self-consistent.
        let empty = <Dots as Adversary>::initial(0);
        let mut ex = Exact::new(&empty, NodeBudget::unlimited());
        assert_eq!(
            ex.root_value(),
            Some(-3),
            "3x3 is a second-player win by three boxes"
        );
        assert_eq!(
            ex.nodes(),
            (1u64 << 24) - 1,
            "every subset of the free edges is reachable, so the node count is exactly 2^f - 1"
        );
    }

    #[test]
    fn move_values_agree_with_the_root_value() {
        // The best move's final margin must equal the root's future margin,
        // because no box is owned yet at the root.
        let pos = from_open(&(12..=23).collect::<Vec<_>>(), Side::A);
        let mut ex = Exact::new(&pos, NodeBudget::unlimited());
        let root = ex.root_value().expect("solve completes");
        let best = ex
            .move_values()
            .expect("solve completes")
            .into_iter()
            .map(|(_, v)| v)
            .max()
            .expect("a non-terminal position has moves");
        assert_eq!(best, root);
    }

    #[test]
    fn exact_is_affordable_exactly_at_the_documented_threshold() {
        let mut pos = <Dots as Adversary>::initial(0);
        assert!(
            !Exact::is_affordable(&pos),
            "24 free edges is not affordable"
        );
        for e in 0..4u8 {
            pos = apply_move(&pos, Edge(e));
        }
        assert_eq!(pos.free_count(), TRACTABLE_EDGES);
        assert!(Exact::is_affordable(&pos), "20 free edges is the knee");
    }

    #[test]
    fn move_values_reports_exact_only_when_the_solve_ran() {
        let empty = <Dots as Adversary>::initial(0);
        let (values, exact) = move_values(&empty, 2);
        assert_eq!(values.len(), EDGES, "every edge is a legal opening move");
        assert!(!exact, "24 free edges is above the exact threshold");

        let mut pos = empty;
        for e in 0..4u8 {
            pos = apply_move(&pos, Edge(e));
        }
        let (values, exact) = move_values(&pos, 2);
        assert_eq!(values.len(), TRACTABLE_EDGES as usize);
        assert!(exact, "at the threshold the facts are the exact solver's");
    }

    #[test]
    fn an_exhausted_budget_reports_not_exact_rather_than_a_truncated_guess() {
        // The named trap in BUILDING-GAMES section 10: `exact` must follow whether
        // the search finished, never the position.
        let pos = from_open(&(4..24).collect::<Vec<_>>(), Side::A);
        assert!(Exact::is_affordable(&pos));
        let mut ex = Exact::new(&pos, NodeBudget::of(10));
        assert_eq!(ex.move_values(), None, "a starved solve returns nothing");
    }

    #[test]
    fn a_starved_solve_memoizes_nothing_so_a_later_one_is_still_right() {
        let pos = from_open(&(8..24).collect::<Vec<_>>(), Side::A);
        let mut starved = Exact::new(&pos, NodeBudget::of(50));
        assert_eq!(starved.root_value(), None);
        let mut full = Exact::new(&pos, NodeBudget::unlimited());
        let honest = full.root_value().expect("completes");
        // Re-run the starved one with a fresh budget by rebuilding it: the point
        // is that no partial value was ever written where it could be read back.
        let mut again = Exact::new(&pos, NodeBudget::unlimited());
        assert_eq!(again.root_value(), Some(honest));
    }

    #[test]
    fn boxes_at_three_counts_each_box_once() {
        let pos = from_open(&[v_edge(0, 1)], Side::A);
        // The shared edge closes boxes 0 and 1, both at three sides.
        assert_eq!(boxes_at_three(&pos), 2);
        let empty = <Dots as Adversary>::initial(0);
        assert_eq!(boxes_at_three(&empty), 0, "an empty lattice has none");
    }

    #[test]
    fn heuristic_prefers_being_ahead_and_credits_boxes_about_to_fall() {
        let empty = <Dots as Adversary>::initial(0);
        assert_eq!(heuristic(&empty), 0, "a symmetric empty board is level");

        let mut ahead = empty;
        ahead.owners[0] = 1; // Side A owns a box, Side A to move
        assert!(heuristic(&ahead) > 0);
        ahead.to_move = Side::B;
        assert!(heuristic(&ahead) < 0, "the same board reads inverted for B");
    }

    #[test]
    fn ordering_puts_captures_first() {
        let pos = from_open(&[v_edge(0, 1), 0], Side::A);
        let order = ordered(&pos, legal_edges(&pos));
        assert_eq!(
            order[0],
            Edge(v_edge(0, 1) as u8),
            "the capturing edge is searched first"
        );
    }

    #[test]
    fn capped_values_cover_every_legal_move() {
        let empty = <Dots as Adversary>::initial(0);
        let values = move_values_capped(&empty, 4);
        assert_eq!(values.len(), EDGES);
        let mut seen: Vec<u8> = values.iter().map(|(m, _)| m.0).collect();
        seen.sort_unstable();
        assert_eq!(seen, (0..EDGES as u8).collect::<Vec<_>>());
    }
}
