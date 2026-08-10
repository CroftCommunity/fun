//! The value search: exact when few enough seeds are still in play, depth-capped
//! above that.
//!
//! ## The recurrence, and why the memo key excludes the stores
//!
//! Seeds already banked cannot affect future play — they only shift the running
//! score. So the best *future* seed margin for the side to move depends on the
//! twelve pit counts and whose turn it is, and on nothing else:
//!
//! ```text
//! future(pos) = max over the mover's non-empty pits p of
//!     let next = sow(pos, p)
//!     let gain = what that sow banked for the mover
//!     turn kept   ->  gain + future(next)     // landed in own store: same perspective
//!     turn passed ->  gain - future(next)     // flip
//! future(terminal) = 0                        // the sweep is already in `gain`
//! ```
//!
//! The sweep needs no arm of its own because [`furrow_core::apply_move`] applies
//! it, so the move that ends the game already carries it in `gain`.
//!
//! ## `exact` is about the search, never about the position
//!
//! [`move_values`] reports `exact` **iff** the search it ran reached terminals
//! rather than a horizon or a budget wall. It is not derived from seeds-in-play,
//! not from the level, and not from anything the caller passed in. That is the
//! trap Othello's P9 Phase 2 had to close, and it is named here so it stays
//! closed.
//!
//! ## The table is fixed-size and stores only exact values
//!
//! Phase 0's finding was that the constraint here is **memory, not time**: 1.65M
//! distinct positions at the threshold, on a key that is twelve counts rather
//! than a bitmask, which a `HashMap` would turn into tens of megabytes in a
//! browser tab. So the table is a fixed-size open-addressed array with
//! always-replace on a full probe window.
//!
//! **That sizing finding was wrong by about 500×, and this is what it should
//! have said.** Phase 0 counted *distinct reachable positions* under a plain
//! memoized search with no alpha-beta and no window. This search prunes, and it
//! stores only exact-window values — so at the threshold it holds a measured
//! **2,827 entries at its worst over 120 positions**, not 1.65M. The table is
//! therefore `2^16` slots, about 640 KB, rather than the ~10 MB the Phase 0
//! reasoning called for. The packed key survives; the number it was sized
//! against did not.
//!
//! **Correctness does not depend on its size.** The full 61-bit key is stored and
//! compared, so a collision costs a re-search and never returns another
//! position's value; a smaller table is slower and not wronger, which
//! [`Table::disabled`] exists to assert.
//!
//! And it stores a value **only when that value is exact** — when the search of
//! that node neither failed high nor failed low against its window. That is the
//! narrow, safe subset of what a transposition table could hold, and it is chosen
//! deliberately over checkers' bound-carrying entries: checkers' own recorded
//! warning is that an entry must respect the window it was stored under, or the
//! "exact" it reports is a lie about a bound. Here the honesty flag is the whole
//! product, so the table gives up hit rate to make that class of bug
//! unrepresentable.

use adversary_core::Side;
use adversary_solver::NodeBudget;
use furrow_core::{apply_move, legal_pits, Board, Pit, CELLS, PITS};

use crate::eval;

/// The most seeds in play an exact solve is affordable at.
///
/// Measured in Phase 0 (`plans/2026-08-07-mancala.md`) as the knee of a sharp
/// curve: 1,648,032 distinct positions and 315 ms at 16 seeds, against
/// 11,160,700 and 3,537 ms at 18 — a 6.8× jump in positions and 11× in time for
/// one step, where the step before it was 2.2×.
///
/// **Not a speed knob.** Like Othello's `TRACTABLE_EMPTIES`, checkers'
/// `TRACTABLE_PIECES` and dots' `TRACTABLE_EDGES`, it sits at its measured knee.
/// Lowering it to buy latency spends proof coverage, which is the one thing the
/// tutor's honesty rests on.
///
/// **Re-measured in Phase 3 with alpha-beta and the table**, over 120 positions
/// per bucket taken from 400 seeded games, timing the *whole move list* — what
/// one tap actually pays — natively in release:
///
/// | seeds in play | median | p95 | worst | worst nodes |
/// |---|---|---|---|---|
/// | 14 | 0.7 ms | 4.7 ms | 10.6 ms | 138,747 |
/// | 15 | 1.1 ms | 15.6 ms | 52.0 ms | 685,610 |
/// | **16** | **2.6 ms** | **29.4 ms** | **70.2 ms** | **932,193** |
/// | 17 | 4.5 ms | 51.0 ms | **517.2 ms** | 6,079,098 |
/// | 18 | 6.0 ms | 101.7 ms | 500.2 ms | 6,549,939 |
/// | 21 | 112.4 ms | 1,416 ms | 3,225 ms | 29,602,731 |
///
/// Phase 0 put the knee between 16 and 18 by counting distinct positions.
/// Alpha-beta did **not** move the knee up — it moved it *down in cost*, by
/// 4.5×. What sets the threshold is the **worst** case, not the median, and the
/// worst case jumps 7× between 16 and 17 while the median only doubles. 16 leaves
/// a 5.7× margin against the 400 ms per-move target even before wasm's slowdown;
/// 17 would already be over it natively.
pub const TRACTABLE_SEEDS: u32 = 16;

/// Backstop work allowance for one exact solve.
///
/// Measured worst case at [`TRACTABLE_SEEDS`] over 120 positions: **932,193
/// nodes** for a whole move list. This is a little over 4× that — slack on
/// purpose, because it exists so a bug cannot hang the browser, not to shape
/// play. If it trips, the caller gets `exact: false` rather than a truncated
/// guess dressed as a proof.
pub const EXACT_NODE_BUDGET: u64 = 4_000_000;

/// Work allowance for the depth-capped search above [`TRACTABLE_SEEDS`].
///
/// The whole budget for a position's move list, not per move. Phase 0 measured
/// branching at **4.11**, which is narrow enough that depth is affordable and
/// move ordering is worth having. From the opening, a full move list costs a
/// measured 21,711 nodes at depth 8, 79,347 at depth 10 and 248,997 at depth 12,
/// so this covers the deepest level with room over it.
pub const CAPPED_NODE_BUDGET: u64 = 600_000;

/// Bits per pit count in the packed key.
///
/// Twelve counts at five bits is sixty bits, plus one for the side to move — so
/// the key fits a `u64` with three to spare. Five bits caps a pit at 31 seeds,
/// which the exact path can never exceed: it only runs at 16 seeds in play or
/// fewer, and one pit cannot hold more than all of them. [`pack_key`] returns
/// `None` above that rather than wrapping, so the capped path simply goes
/// unmemoized instead of aliasing two positions.
const KEY_BITS: u32 = 5;

/// The largest pit count the key can carry.
const MAX_PACKABLE: u8 = (1 << KEY_BITS) - 1;

/// Slots in the transposition table, as a power of two.
///
/// `2^16` slots is about 640 KB (8 bytes of key plus 2 of value per slot).
/// Measured over 120 positions at [`TRACTABLE_SEEDS`], the search stores at
/// most **2,827** entries — a 4% load factor — and even at 24 seeds in play,
/// far above anything the exact path runs at, it stores 35,296. Sized against
/// what the search measurably holds rather than against how many positions
/// exist, which is the correction Phase 0's estimate needed.
const TABLE_BITS: u32 = 16;

/// How far a probe walks before it gives up and replaces.
const PROBES: usize = 4;

/// The empty-slot sentinel. Real margins fit far inside `i16`.
const EMPTY: i16 = i16::MIN;

/// The open search window: beyond any reachable margin, with room to be shifted.
///
/// **Not `i32::MIN`/`i32::MAX`, and that is the whole point.** Each recursion
/// shifts the child's window by the move's `gain`, so a sentinel at the edge of
/// the type overflows on the first shift. In release that wraps silently — an
/// alpha of `i32::MIN + 1` becomes a large *positive* alpha, the child fails high
/// immediately, and the search returns a bound dressed as a value. The bug was
/// invisible to this repo's gate, which runs `--release` for speed, and surfaced
/// only under `cargo mutants`, which builds in debug where overflow is checked.
///
/// A real margin cannot exceed 48 (every seed to one side), so this is three
/// orders of magnitude of headroom and still 15 bits clear of overflow.
pub const INF: i32 = 1 << 16;

/// The twelve pit counts and the side to move, packed into a `u64`.
///
/// Returns `None` when any pit holds more than [`MAX_PACKABLE`] seeds — see
/// [`KEY_BITS`] for why that cannot happen on the path that needs the key.
#[must_use]
pub fn pack_key(pos: &Board) -> Option<u64> {
    let mut key = 0u64;
    let mut shift = 0;
    for i in 0..CELLS {
        if i == PITS || i == CELLS - 1 {
            continue; // the stores are deliberately not in the key
        }
        let c = pos.cells[i];
        if c > MAX_PACKABLE {
            return None;
        }
        key |= u64::from(c) << shift;
        shift += KEY_BITS;
    }
    if pos.to_move == Side::B {
        key |= 1u64 << shift;
    }
    Some(key)
}

/// `SplitMix64` — a cheap avalanche so sequential keys do not cluster in the table.
const fn scramble(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9e37_79b9_7f4a_7c15);
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

/// A fixed-size transposition table over packed positions.
pub struct Table {
    keys: Vec<u64>,
    vals: Vec<i16>,
    enabled: bool,
    stored: usize,
}

impl Table {
    /// A working table of `2^TABLE_BITS` slots.
    #[must_use]
    pub fn new() -> Self {
        let size = 1usize << TABLE_BITS;
        Table {
            keys: vec![0; size],
            vals: vec![EMPTY; size],
            enabled: true,
            stored: 0,
        }
    }

    /// A table that stores nothing and answers nothing — the control for
    /// asserting that the table changes speed and not results.
    #[must_use]
    pub fn disabled() -> Self {
        Table {
            keys: Vec::new(),
            vals: Vec::new(),
            enabled: false,
            stored: 0,
        }
    }

    /// How many values are live in the table (a search-cost signal for tests).
    #[must_use]
    pub fn len(&self) -> usize {
        self.stored
    }

    /// Whether the table holds nothing.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.stored == 0
    }

    fn slot(&self, key: u64) -> usize {
        (scramble(key) as usize) & (self.keys.len() - 1)
    }

    /// The stored value for `key`, or `None` if this table cannot answer.
    #[must_use]
    pub fn get(&self, key: u64) -> Option<i32> {
        if !self.enabled {
            return None;
        }
        let at = self.slot(key);
        let mask = self.keys.len() - 1;
        for i in 0..PROBES {
            let s = (at + i) & mask;
            if self.vals[s] == EMPTY {
                return None;
            }
            if self.keys[s] == key {
                return Some(i32::from(self.vals[s]));
            }
        }
        None
    }

    /// Store `value` for `key`, replacing the last probed slot if the window is
    /// full. Replacement is safe because the full key is stored beside the value.
    pub fn put(&mut self, key: u64, value: i32) {
        if !self.enabled {
            return;
        }
        let at = self.slot(key);
        let mask = self.keys.len() - 1;
        let mut target = at;
        for i in 0..PROBES {
            let s = (at + i) & mask;
            target = s;
            if self.vals[s] == EMPTY || self.keys[s] == key {
                break;
            }
        }
        if self.vals[target] == EMPTY {
            self.stored += 1;
        }
        self.keys[target] = key;
        self.vals[target] = value as i16;
    }
}

impl Default for Table {
    fn default() -> Self {
        Table::new()
    }
}

/// `side`'s banked lead at `pos`.
fn margin_for(pos: &Board, side: Side) -> i32 {
    i32::from(pos.store(side)) - i32::from(pos.store(side.other()))
}

/// Whether an exact solve of `pos` is within [`TRACTABLE_SEEDS`].
#[must_use]
pub fn is_affordable(pos: &Board) -> bool {
    pos.in_play() <= TRACTABLE_SEEDS
}

/// The class of a final seed margin: its sign.
///
/// All three classes are live here, unlike dots — forty-eight seeds can split.
#[must_use]
pub fn class_of(margin: i32) -> i32 {
    margin.signum()
}

/// The class of a value from the **depth-capped** search: always `0`.
///
/// Deliberate, and the same answer Othello gives. Above [`TRACTABLE_SEEDS`]
/// nothing has been proven — Phase 0 could not solve the opening at 100M nodes —
/// so a positive heuristic is not a proven win and treating it as one would let
/// the band's class floor claim a guarantee it does not have. With every capped
/// move in one class the floor is inert, and difficulty above the threshold is
/// carried by search depth and sloppiness alone. That is a real limitation, and
/// it covers about 70% of a game.
#[must_use]
pub fn capped_class(_value: i32) -> i32 {
    0
}

/// Legal moves ordered so the promising ones come first, sharpening alpha-beta.
///
/// Ordering is a **speed device only** and can never change a result. The proxy:
/// a move that lands in your own store keeps the turn, which is the cheapest
/// good thing in this game, so those go first; the rest go by pit descending,
/// which favours sows that stay on your own side.
fn ordered_moves(pos: &Board) -> Vec<Pit> {
    let mut moves = legal_pits(pos);
    let me = pos.to_move;
    moves.sort_by_key(|&mv| {
        let keeps = apply_move(pos, mv).to_move == me;
        (std::cmp::Reverse(keeps), std::cmp::Reverse(mv.0))
    });
    moves
}

/// A search bound to one root position.
pub struct Search {
    table: Table,
    budget: NodeBudget,
    nodes: u64,
}

impl Search {
    /// A search with a working table and `budget`.
    #[must_use]
    pub fn new(budget: NodeBudget) -> Self {
        Search {
            table: Table::new(),
            budget,
            nodes: 0,
        }
    }

    /// A search with a caller-supplied table — the seam `Table::disabled()` uses.
    #[must_use]
    pub fn with_table(table: Table, budget: NodeBudget) -> Self {
        Search {
            table,
            budget,
            nodes: 0,
        }
    }

    /// Nodes expanded so far (the cost measurement, and what the budget charges).
    #[must_use]
    pub fn nodes(&self) -> u64 {
        self.nodes
    }

    /// Positions memoized so far.
    #[must_use]
    pub fn table_len(&self) -> usize {
        self.table.len()
    }

    /// The best **future** seed margin for the side to move, exactly, or `None`
    /// if the budget ran out.
    ///
    /// A `None` is never memoized, so a later call with more allowance is not
    /// poisoned by an earlier one that gave up.
    pub fn exact_future(&mut self, pos: &Board, alpha: i32, beta: i32) -> Option<i32> {
        if !self.budget.charge() {
            return None;
        }
        self.nodes += 1;

        let moves = ordered_moves(pos);
        if moves.is_empty() {
            // Terminal. The sweep is already in the gain of the move that got
            // here, so there is nothing further to come.
            return Some(0);
        }

        let key = pack_key(pos);
        if let Some(k) = key {
            if let Some(v) = self.table.get(k) {
                return Some(v);
            }
        }

        let me = pos.to_move;
        let mut best = -INF - 1;
        let mut a = alpha;
        for mv in moves {
            let next = apply_move(pos, mv);
            let gain = margin_for(&next, me) - margin_for(pos, me);
            let v = if next.to_move == me {
                gain + self.exact_future(&next, a - gain, beta - gain)?
            } else {
                gain - self.exact_future(&next, gain - beta, gain - a)?
            };
            best = best.max(v);
            a = a.max(best);
            if a >= beta {
                break; // fail-high: `best` is only a lower bound from here
            }
        }

        // Store only a value the window proved exactly. A fail-high or fail-low
        // result is a bound, and a bound stored as a value is the bug checkers
        // wrote its warning about.
        if let Some(k) = key {
            if alpha < best && best < beta {
                self.table.put(k, best);
            }
        }
        Some(best)
    }

    /// The best future seed margin for the side to move, searched `depth` plies
    /// deep and estimated by the heuristic at the horizon.
    ///
    /// Never exact, whatever it returns.
    pub fn capped_future(&mut self, pos: &Board, depth: u32, alpha: i32, beta: i32) -> Option<i32> {
        if !self.budget.charge() {
            return None;
        }
        self.nodes += 1;

        let moves = ordered_moves(pos);
        if moves.is_empty() {
            return Some(0);
        }
        if depth == 0 {
            return Some(eval::future_margin(pos));
        }

        let me = pos.to_move;
        let mut best = -INF - 1;
        let mut a = alpha;
        for mv in moves {
            let next = apply_move(pos, mv);
            let gain = margin_for(&next, me) - margin_for(pos, me);
            let v = if next.to_move == me {
                gain + self.capped_future(&next, depth - 1, a - gain, beta - gain)?
            } else {
                gain - self.capped_future(&next, depth - 1, gain - beta, gain - a)?
            };
            best = best.max(v);
            a = a.max(best);
            if a >= beta {
                break;
            }
        }
        Some(best)
    }
}

/// What one search produced: a value per legal move, and whether it is proven.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    /// Each legal move and the **final** seed margin it leads to for the mover,
    /// counting seeds already banked — so its class is its sign.
    pub values: Vec<(Pit, i32)>,
    /// Whether the search reached terminals rather than a horizon or a budget
    /// wall. Derived from the search, never from the position.
    pub exact: bool,
    /// Nodes expanded.
    pub nodes: u64,
}

/// Value every legal move at `pos`.
///
/// Runs the exact solve when [`is_affordable`], else a `depth`-capped search.
/// `exact` is true only if the exact solve ran **and** completed every move
/// within `budget`.
#[must_use]
pub fn move_values(pos: &Board, depth: u32, budget: NodeBudget) -> Report {
    let mut search = Search::new(budget);
    let me = pos.to_move;
    let banked = margin_for(pos, me);
    let affordable = is_affordable(pos);

    let mut values = Vec::new();
    let mut complete = true;
    for mv in legal_pits(pos) {
        let next = apply_move(pos, mv);
        let gain = margin_for(&next, me) - margin_for(pos, me);
        let sub = if affordable {
            search.exact_future(&next, -INF, INF)
        } else {
            search.capped_future(&next, depth, -INF, INF)
        };
        let Some(child) = sub else {
            complete = false;
            break;
        };
        let future = if next.to_move == me {
            gain + child
        } else {
            gain - child
        };
        values.push((mv, banked + future));
    }

    Report {
        values,
        exact: affordable && complete,
        nodes: search.nodes(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use furrow_core::{A_STORE, B_STORE, TOTAL_SEEDS};

    fn board(a: [u8; PITS], b: [u8; PITS], stores: (u8, u8), to_move: Side) -> Board {
        let mut cells = [0u8; CELLS];
        cells[..PITS].copy_from_slice(&a);
        cells[A_STORE] = stores.0;
        cells[PITS + 1..PITS + 1 + PITS].copy_from_slice(&b);
        cells[B_STORE] = stores.1;
        Board { cells, to_move }
    }

    fn exact_of(pos: &Board) -> Report {
        move_values(pos, 6, NodeBudget::of(EXACT_NODE_BUDGET))
    }

    #[test]
    fn the_key_separates_positions_and_ignores_the_stores() {
        // Two positions with identical pits and different stores are the same
        // *future*, which is the whole reason the key excludes them -- and it is
        // what shrinks the state space enough to solve an endgame in a tab.
        let a = board([1, 2, 3, 0, 0, 0], [0, 0, 1, 0, 0, 0], (0, 0), Side::A);
        let b = board([1, 2, 3, 0, 0, 0], [0, 0, 1, 0, 0, 0], (20, 17), Side::A);
        assert_eq!(pack_key(&a), pack_key(&b));

        // Everything else separates.
        let moved = board([1, 2, 0, 3, 0, 0], [0, 0, 1, 0, 0, 0], (0, 0), Side::A);
        assert_ne!(pack_key(&a), pack_key(&moved));
        let other_side = Board {
            to_move: Side::B,
            ..a
        };
        assert_ne!(pack_key(&a), pack_key(&other_side));
    }

    #[test]
    fn the_key_refuses_a_pit_it_cannot_hold_rather_than_wrapping() {
        // The alternative is two different positions sharing a key, which would
        // make the table return another position's value and call it exact.
        let too_big = board([32, 0, 0, 0, 0, 0], [0; PITS], (0, 0), Side::A);
        assert_eq!(pack_key(&too_big), None);
        let just_fits = board([31, 0, 0, 0, 0, 0], [0; PITS], (0, 0), Side::A);
        assert!(pack_key(&just_fits).is_some());
    }

    #[test]
    fn the_table_returns_what_it_stored_and_nothing_it_did_not() {
        let mut t = Table::new();
        assert!(t.is_empty());
        t.put(0xdead_beef, -7);
        assert_eq!(t.get(0xdead_beef), Some(-7));
        assert_eq!(t.get(0xdead_bee0), None);
        assert_eq!(t.len(), 1);
    }

    #[test]
    fn a_disabled_table_answers_nothing_and_stores_nothing() {
        let mut t = Table::disabled();
        t.put(1, 5);
        assert_eq!(t.get(1), None);
        assert!(t.is_empty());
    }

    #[test]
    fn the_table_changes_speed_and_not_results() {
        // The property that makes the table an optimization rather than part of
        // the rules. If a bound were ever stored as a value, this is the test
        // that would catch it.
        // A position at the threshold itself -- 16 seeds in play. A small endgame
        // does not transpose enough to show the effect at all.
        let pos = board([2, 1, 2, 1, 2, 1], [1, 2, 1, 2, 1, 0], (16, 16), Side::A);
        assert_eq!(pos.in_play(), TRACTABLE_SEEDS);
        assert!(is_affordable(&pos));

        let mut with = Search::new(NodeBudget::of(EXACT_NODE_BUDGET));
        let hot = with.exact_future(&pos, -INF, INF);

        let mut without = Search::with_table(Table::disabled(), NodeBudget::of(EXACT_NODE_BUDGET));
        let cold = without.exact_future(&pos, -INF, INF);

        assert_eq!(hot, cold, "the table must not change the value");
        assert!(
            with.nodes() < without.nodes(),
            "and it must be worth having: {} nodes with, {} without",
            with.nodes(),
            without.nodes()
        );
    }

    #[test]
    fn a_position_one_move_from_the_end_is_solved_by_hand() {
        // A has one seed in pit 5, which lands in the store; that empties A's
        // side, so B sweeps their four. Final 20 -> 21, 20 -> 24, margin -3.
        let pos = board([0, 0, 0, 0, 0, 1], [4, 0, 0, 0, 0, 0], (20, 20), Side::A);
        let r = exact_of(&pos);
        assert!(r.exact, "eleven seeds in play is well inside the threshold");
        assert_eq!(r.values, vec![(Pit(5), -3)]);
        assert_eq!(class_of(-3), -1);
    }

    #[test]
    fn the_search_takes_the_extra_turn_that_wins_rather_than_the_move_that_loses() {
        // A can bank one and move again (pit 5), or feed B (pit 4). The exact
        // value must separate them, and it must prefer the chain. This is the
        // hand-derivable position the plan asks for: if the extra-turn arm ever
        // flipped its sign, the engine would prefer the gift.
        let pos = board([0, 0, 0, 0, 1, 1], [1, 0, 0, 0, 0, 0], (0, 0), Side::A);
        let r = exact_of(&pos);
        assert!(r.exact);
        let best = r.values.iter().max_by_key(|&&(_, v)| v).copied();
        assert_eq!(
            best.map(|(m, _)| m),
            Some(Pit(5)),
            "values were {:?}",
            r.values
        );
    }

    #[test]
    fn every_result_class_is_reachable_from_a_real_exact_solve() {
        // Dots could not say this: nine boxes cannot split. Forty-eight seeds can.
        // A sows its last seed into its own store to reach 24, which empties A's
        // side; B sweeps its own last seed to reach 24 as well.
        let drawn = board([0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 1], (23, 23), Side::A);
        let r = exact_of(&drawn);
        assert!(r.exact);
        assert!(
            r.values.iter().any(|&(_, v)| class_of(v) == 0),
            "a draw is a reachable exact outcome, got {:?}",
            r.values
        );
    }

    #[test]
    fn above_the_threshold_the_search_is_capped_and_says_so() {
        let opening = Board::opening();
        assert!(!is_affordable(&opening), "48 seeds is far above the knee");
        let r = move_values(&opening, 4, NodeBudget::of(CAPPED_NODE_BUDGET));
        assert!(!r.exact, "a horizon is not a proof");
        assert_eq!(r.values.len(), 6, "all six opening pits are legal");
    }

    #[test]
    fn exact_is_false_when_the_budget_runs_out_rather_than_true_with_fewer_moves() {
        // The honesty flag has to survive the failure path, not only the happy
        // one -- a truncated list reported as exact is the worst outcome here.
        let pos = board([2, 2, 2, 2, 2, 2], [1, 1, 1, 1, 0, 0], (0, 0), Side::A);
        assert!(is_affordable(&pos));
        let r = move_values(&pos, 6, NodeBudget::of(50));
        assert!(!r.exact, "an overrun search proves nothing");
    }

    #[test]
    fn exact_never_comes_from_the_position_alone() {
        // Same affordable position, two budgets. If `exact` were derived from
        // seeds-in-play -- the named trap -- both would claim a proof.
        let pos = board([2, 1, 1, 2, 1, 1], [1, 1, 1, 1, 1, 1], (16, 18), Side::A);
        assert!(is_affordable(&pos));
        assert!(move_values(&pos, 6, NodeBudget::of(EXACT_NODE_BUDGET)).exact);
        assert!(!move_values(&pos, 6, NodeBudget::of(20)).exact);
    }

    #[test]
    fn capped_class_puts_every_capped_move_in_one_class() {
        // Stated as a test because it is a decision, not an accident: above the
        // threshold nothing is proven, so the band's class floor is inert and
        // difficulty is carried by depth and sloppiness alone.
        assert_eq!(capped_class(9), capped_class(-9));
        assert_eq!(capped_class(0), 0);
    }

    #[test]
    fn move_values_counts_the_seeds_already_banked() {
        // The value is the FINAL margin, so its sign is the result class. A
        // version that returned only the future would call a won position lost
        // whenever the remaining seeds happened to favour the opponent.
        let ahead = board([0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0], (30, 16), Side::A);
        let behind = board([0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0], (16, 30), Side::A);
        let a = exact_of(&ahead);
        let b = exact_of(&behind);
        assert!(a.exact && b.exact);
        assert!(a.values.iter().all(|&(_, v)| v > 0), "got {:?}", a.values);
        assert!(b.values.iter().all(|&(_, v)| v < 0), "got {:?}", b.values);
    }

    #[test]
    fn deeper_capped_search_is_not_free_and_does_something() {
        // Dots' capped path was measurably value-flat, so deepening bought
        // nothing there. This game's Phase 0 predicted the opposite. Assert the
        // weaker, checkable half: depth changes the work and the values are not
        // all identical, which is what makes the heuristic load-bearing.
        let pos = board([4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4], (0, 0), Side::A);
        let shallow = move_values(&pos, 1, NodeBudget::of(CAPPED_NODE_BUDGET));
        let deep = move_values(&pos, 5, NodeBudget::of(CAPPED_NODE_BUDGET));
        assert!(deep.nodes > shallow.nodes, "depth costs work");
        let distinct: std::collections::BTreeSet<i32> =
            deep.values.iter().map(|&(_, v)| v).collect();
        assert!(
            distinct.len() > 1,
            "the heuristic must tell the opening moves apart, got {:?}",
            deep.values
        );
    }

    #[test]
    fn the_window_sentinel_survives_being_shifted_by_a_move() {
        // The invariant behind `INF`, stated where a reader will find it. Every
        // recursion shifts the child's window by the move's gain, which is at
        // most the whole board; a sentinel at the edge of the type would
        // overflow on the first shift, and in release that wraps rather than
        // panicking -- turning alpha into a large positive and the search into a
        // bound reported as a value.
        let max_gain = i32::from(TOTAL_SEEDS);
        assert!(
            INF > max_gain,
            "the window must be wider than any real margin"
        );
        assert!(
            INF.checked_add(max_gain).is_some() && (-INF).checked_sub(max_gain).is_some(),
            "shifting the open window by a whole board must not overflow"
        );
    }

    #[test]
    fn a_wide_window_and_a_tight_one_agree_on_the_value() {
        // The observable half of the same property: a window that merely contains
        // the true value must not change it. If a shift ever wrapped, this is
        // where it would show up as a different answer rather than a panic.
        let pos = board([1, 2, 1, 0, 2, 1], [1, 0, 2, 1, 1, 1], (17, 18), Side::A);
        assert!(is_affordable(&pos));
        let mut wide = Search::new(NodeBudget::of(EXACT_NODE_BUDGET));
        let mut tight = Search::new(NodeBudget::of(EXACT_NODE_BUDGET));
        assert_eq!(
            wide.exact_future(&pos, -INF, INF),
            tight.exact_future(&pos, -100, 100)
        );
    }

    #[test]
    fn ordering_puts_the_extra_turn_first_and_changes_no_value() {
        let pos = board([1, 0, 0, 0, 2, 1], [1, 1, 0, 0, 0, 0], (0, 0), Side::A);
        // Pit 5 with one seed lands in the store.
        assert_eq!(ordered_moves(&pos).first().copied(), Some(Pit(5)));
        // And ordering is a speed device: the same set, whatever the order.
        let mut ordered: Vec<u8> = ordered_moves(&pos).iter().map(|p| p.0).collect();
        let mut plain: Vec<u8> = legal_pits(&pos).iter().map(|p| p.0).collect();
        ordered.sort_unstable();
        plain.sort_unstable();
        assert_eq!(ordered, plain);
    }
}
