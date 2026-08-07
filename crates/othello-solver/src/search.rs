//! Alpha-beta search over the [`crate::eval`] heuristic, with an **exact full
//! solve in the deep endgame**. Othello is not solved from the opening, so the
//! search is heuristic (horizon-capped) early and exact (searched to a terminal,
//! scored by disc differential) once few enough cells remain. The
//! [`TRACTABLE_EMPTIES`] switch is the same honesty boundary the tutor and the
//! difficulty band use.

use std::collections::HashMap;

use adversary_core::Side;
use adversary_solver::NodeBudget;
use othello_core::{apply_move, legal_moves, result, Board, Move, CELLS};

use crate::eval::{heuristic, WEIGHTS};

/// Empties at or below which an exact full solve is cheap enough to be the
/// oracle — searched to a terminal and scored by disc differential (provably
/// right). Above it, the search is depth-capped and horizon-approximate. The
/// decision is the **root's**, made once by [`mode_for`] and carried down.
///
/// **Measured in wasm 2026-08-06** (Node/V8, a real game at Expert, worst single
/// call), once the interior-switch blowup was fixed — before that fix the number
/// below was unmeasurable, because the cost sat at
/// `TRACTABLE_EMPTIES + depth` empties rather than in the exact region at all:
///
/// | empties | exact reports | tutor worst | move worst |
/// |---|---|---|---|
/// | 10 (previous) | 16.7% | 119ms | 2112ms |
/// | **12 — shipped** | **20.0%** | **85ms** | 2114ms |
/// | 14 | 23.3% | 738ms | 2082ms |
///
/// 12 is free: three more points of proven-report rate for no measurable latency,
/// because the worst call is the **midgame** heuristic search (~2.1s at 36
/// empties), not the endgame. 14 buys another three points but the root solve
/// starts to show (738ms), and the honesty flag only means something if the panel
/// answers.
///
/// Anything that wants Othello faster has to look at the midgame depth, not here
/// — the same conclusion checkers reached about its own budget.
pub const TRACTABLE_EMPTIES: usize = 12;

/// Terminal disc-differentials are scaled so a *proven* endgame result outranks
/// any horizon heuristic score near the exact/capped boundary.
const TERMINAL_SCALE: i32 = 100;

/// Difficulty levels — a search depth and (via [`crate::live::live_band`]) a
/// class floor + sloppiness. Othello is unsolved, so even Expert is a strong
/// heuristic player, not a perfect oracle (except in the exact endgame).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    /// Shallow, sloppy, beatable.
    Easy,
    /// Moderate depth.
    Medium,
    /// Deep, class-preserving.
    Hard,
    /// Deepest, tightest.
    Expert,
}

impl Level {
    /// The capped search depth for this level.
    #[must_use]
    pub fn depth(self) -> u32 {
        match self {
            Level::Easy => 1,
            Level::Medium => 3,
            Level::Hard => 5,
            Level::Expert => 7,
        }
    }
}

/// The terminal value from the side-to-move's perspective: the scaled disc
/// differential (positive when the side to move has the majority).
fn terminal_value(board: &Board) -> i32 {
    let me = board.count(board.to_move) as i32;
    let them = board.count(board.to_move.other()) as i32;
    TERMINAL_SCALE * (me - them)
}

/// Legal moves ordered best-first (highest static weight) to sharpen alpha-beta.
/// A lone `Pass` is returned as-is.
fn ordered_moves(board: &Board) -> Vec<Move> {
    let mut moves = legal_moves(board);
    moves.sort_by_key(|m| match m {
        Move::Place(idx) => -WEIGHTS[*idx as usize],
        Move::Pass => 0,
    });
    moves
}

/// How a search treats its horizon, decided **once at the root** — see
/// [`mode_for`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// Ignore `depth`; search every line to a real terminal (the endgame oracle).
    Exact,
    /// Cut off at `depth == 0` with the heuristic, however few empties remain.
    Capped,
}

/// The mode a search starting from a position with `empties` empty cells runs in.
///
/// Decided from the **root** position and carried down, which is the whole point:
/// deciding it per node meant a capped search flipped to a full solve as soon as
/// its own leaves crossed the boundary, and the cost of that lands at
/// `TRACTABLE_EMPTIES + depth` empties (19s in wasm at Expert — see
/// `a_capped_search_does_not_solve_at_its_leaves`).
fn mode_for(empties: usize) -> Mode {
    if empties <= TRACTABLE_EMPTIES {
        Mode::Exact
    } else {
        Mode::Capped
    }
}

/// The number of empty cells on `board` — the exact/capped boundary's input.
fn empties_of(board: &Board) -> usize {
    board.cells.iter().filter(|&&v| v == 0).count()
}

/// Which side of the search window a stored value sits on.
///
/// Mirrors `checkers-solver`'s. Alpha-beta returns *bounds*, not values, at any
/// node that cut off or failed low, so a table that stored every result as a
/// value would answer later queries with numbers no fresh search would produce.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Bound {
    /// A true value.
    Exact,
    /// The real value is at least this (the node cut off).
    Lower,
    /// The real value is at most this (the node failed low).
    Upper,
}

/// One stored search result.
#[derive(Debug, Clone, Copy)]
struct TtEntry {
    /// The depth this value was searched to. [`Mode::Exact`] searches to a
    /// terminal regardless of `depth`, so it stores [`u32::MAX`] — such an entry
    /// satisfies any depth requirement, which is exactly right: it is the whole
    /// game value, not a horizon estimate.
    depth: u32,
    value: i32,
    bound: Bound,
}

/// A transposition-table key: the full position.
///
/// Othello's `Board` *is* the whole state — 64 cells and the side to move, with
/// no move counter or repetition history — so unlike checkers (which must key on
/// the no-progress counter too) there is nothing else to include.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct TtKey {
    cells: [u8; CELLS],
    to_move: u8,
}

impl TtKey {
    fn of(board: &Board) -> Self {
        TtKey {
            cells: board.cells,
            to_move: match board.to_move {
                Side::A => 0,
                Side::B => 1,
            },
        }
    }
}

/// The transposition table for one top-level search, plus a node counter.
///
/// **Per top-level call, not global.** A shared table would make one move's
/// search depend on which searches ran before it, which is the same class of
/// nondeterminism this repo refuses elsewhere — and it would make two concurrent
/// searches interfere.
#[derive(Debug, Default)]
pub struct Table {
    map: HashMap<TtKey, TtEntry>,
    enabled: bool,
    nodes: u64,
}

impl Table {
    /// A fresh, enabled table.
    #[must_use]
    pub fn new() -> Self {
        Table {
            map: HashMap::new(),
            enabled: true,
            nodes: 0,
        }
    }

    /// A table that stores and answers nothing — the reference search, kept so a
    /// test can assert the table changes only *cost* and never *values*.
    #[must_use]
    pub fn disabled() -> Self {
        Table {
            map: HashMap::new(),
            enabled: false,
            nodes: 0,
        }
    }

    /// Nodes visited by the search that used this table. The only non-vacuous way
    /// to assert that the table is doing anything.
    #[must_use]
    pub fn nodes(&self) -> u64 {
        self.nodes
    }

    /// Stored positions.
    #[must_use]
    pub fn len(&self) -> usize {
        self.map.len()
    }

    /// Whether nothing is stored.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
}

/// What a stored entry may be used for at this `(depth, alpha, beta)`, if
/// anything.
///
/// A shallower entry cannot answer a deeper question. A `Lower` bound is usable
/// only when it already beats `beta` (the fresh search would have cut off there
/// too); an `Upper` bound only when it is at or below `alpha`.
fn table_answer(entry: TtEntry, depth: u32, alpha: i32, beta: i32) -> Option<i32> {
    if entry.depth < depth {
        return None;
    }
    match entry.bound {
        Bound::Exact => Some(entry.value),
        Bound::Lower if entry.value >= beta => Some(entry.value),
        Bound::Upper if entry.value <= alpha => Some(entry.value),
        _ => None,
    }
}

/// Negamax with alpha-beta. Returns the value from `board.to_move`'s perspective.
/// [`Mode::Exact`] ignores `depth` and searches to a terminal; [`Mode::Capped`]
/// cuts off at `depth == 0` with the heuristic. The mode is the root's and does
/// not change as the search descends.
fn negamax(
    board: &Board,
    depth: u32,
    mut alpha: i32,
    beta: i32,
    mode: Mode,
    tt: &mut Table,
    budget: &mut NodeBudget,
) -> i32 {
    tt.nodes += 1;
    // Over the allowance. The value returned here is a placeholder and must never
    // reach a caller: every entry point checks `budget.is_exhausted()` and
    // discards the entire result. Returning the heuristic rather than a sentinel
    // keeps the arithmetic above it well-formed while the stack unwinds.
    if !budget.charge() {
        return heuristic(board);
    }
    if result(board).is_some() {
        return terminal_value(board);
    }
    if mode == Mode::Capped && depth == 0 {
        return heuristic(board);
    }

    // In `Exact` mode `depth` is not what was searched — the search runs to a
    // terminal — so entries are stored and queried at the maximum depth. An exact
    // entry is the game value and answers any question.
    let stored_depth = match mode {
        Mode::Exact => u32::MAX,
        Mode::Capped => depth,
    };

    let key = TtKey::of(board);
    if tt.enabled {
        if let Some(hit) = tt
            .map
            .get(&key)
            .and_then(|e| table_answer(*e, stored_depth, alpha, beta))
        {
            return hit;
        }
    }

    let alpha0 = alpha;
    let next_depth = depth.saturating_sub(1);
    let mut best = i32::MIN + 1;
    let mut cut = false;
    for mv in ordered_moves(board) {
        let score = -negamax(
            &apply_move(board, mv),
            next_depth,
            -beta,
            -alpha,
            mode,
            tt,
            budget,
        );
        if score > best {
            best = score;
        }
        if best > alpha {
            alpha = best;
        }
        if alpha >= beta {
            cut = true;
            break;
        }
        if budget.is_exhausted() {
            break;
        }
    }

    // **Never store the result of a truncated search.** An aborted subtree's
    // value is not a bound on anything; writing it would outlive the search that
    // produced it and be read later as if a real search had produced it. The
    // table would then answer with a number no fresh search would return, which
    // is the failure `checkers-solver`'s module docs exist to prevent.
    if tt.enabled && !budget.is_exhausted() {
        let bound = if cut {
            Bound::Lower
        } else if best <= alpha0 {
            Bound::Upper
        } else {
            Bound::Exact
        };
        tt.map.insert(
            key,
            TtEntry {
                depth: stored_depth,
                value: best,
                bound,
            },
        );
    }

    best
}

/// The value of every legal move to `depth` (side-to-move perspective; higher is
/// better). Exact disc-differentials in the endgame, horizon heuristic earlier.
/// Empty if the position is terminal.
#[must_use]
pub fn move_values(board: &Board, depth: u32) -> Vec<(Move, i32)> {
    move_values_with(board, depth, &mut Table::new())
}

/// Per-move values plus **whether the search that produced them proved
/// anything**.
///
/// The flag has to travel with the values. Before this existed,
/// [`crate::live::choose`] derived it from the empty count alone — sound only for
/// as long as a position at or below [`TRACTABLE_EMPTIES`] was guaranteed to get
/// a completed solve. The moment a budget can cut that solve short, "few empties"
/// stops implying "proven", and a class floor built on `i32::signum` would be
/// claiming a *known* win/draw/loss from *heuristic* numbers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Valued {
    /// Per-move values, side-to-move perspective, higher is better.
    pub values: Vec<(Move, i32)>,
    /// `true` only when these are exact endgame values from a solve that ran to
    /// completion. Never "probably".
    pub exact: bool,
}

/// The budget for a **live opponent's** exact endgame solve.
///
/// Phase 0 measured that solve as level-independent — `Mode::Exact` ignores
/// `depth`, so Easy pays exactly what Expert pays — at 510–580ms worst over six
/// seeds and up to 965ms on an unlucky position. On Easy, whose median move is
/// **0.1ms**, that is the whole game's latency budget spent in one stall by an
/// opponent advertised as shallow.
///
/// Calibrated 2026-08-07; see the plan's Review Log for the node/ms table. When
/// the solve does not fit, the search falls back to a capped one and says so,
/// which costs proof rate in a few endgames and never costs correctness.
///
/// **Deliberately not applied to the analysis oracle or the tutor.** A panel
/// opening can afford what a tap cannot, and the oracle must stay stronger than
/// the player it grades — budgeting it would re-open the P8 defect where
/// "optimal" became true by construction.
pub const LIVE_EXACT_NODE_BUDGET: u64 = 200_000;

/// Values for a live opponent move: the exact endgame solve if it fits inside
/// `budget`, otherwise a capped search, with `exact` reporting which happened.
///
/// The fallback is whole-result, never partial: a solve that overruns is thrown
/// away and redone capped, because a half-solved move list mixes proven values
/// with horizon estimates and the difficulty band compares values *across* moves.
#[must_use]
pub fn move_values_honest(board: &Board, depth: u32, budget: &mut NodeBudget) -> Valued {
    if mode_for(empties_of(board)) == Mode::Exact {
        let mut tt = Table::new();
        let values = search_all(board, depth, Mode::Exact, &mut tt, budget);
        if !budget.is_exhausted() {
            return Valued {
                values,
                exact: true,
            };
        }
    }
    let mut tt = Table::new();
    let mut unbounded = NodeBudget::unlimited();
    Valued {
        values: search_all(board, depth, Mode::Capped, &mut tt, &mut unbounded),
        exact: false,
    }
}

/// [`move_values`] against a caller-supplied table, so a test can read the node
/// count and a future iterative-deepening driver can carry one table across
/// depths. The table is shared across the root moves, which is where most of the
/// saving is: sibling root moves transpose into each other constantly.
///
/// Each root move is searched with a **full window**, so no root value is ever an
/// alpha-beta bound — the tutor and the difficulty band compare values across
/// moves, and comparing bounds against values would be meaningless.
#[must_use]
pub fn move_values_with(board: &Board, depth: u32, tt: &mut Table) -> Vec<(Move, i32)> {
    // The mode is fixed here, from the position the caller actually asked about.
    let mode = mode_for(empties_of(board));
    search_all(board, depth, mode, tt, &mut NodeBudget::unlimited())
}

/// Value every legal move at a fixed `mode`, sharing one table and one budget.
fn search_all(
    board: &Board,
    depth: u32,
    mode: Mode,
    tt: &mut Table,
    budget: &mut NodeBudget,
) -> Vec<(Move, i32)> {
    legal_moves(board)
        .into_iter()
        .map(|mv| {
            let v = -negamax(
                &apply_move(board, mv),
                depth.saturating_sub(1),
                i32::MIN + 1,
                i32::MAX - 1,
                mode,
                tt,
                budget,
            );
            (mv, v)
        })
        .collect()
}

/// The best move to `depth` (the highest-valued; the first on a tie), or `None`
/// if the position is terminal.
#[must_use]
pub fn best_move(board: &Board, depth: u32) -> Option<Move> {
    move_values(board, depth)
        .into_iter()
        .reduce(|a, b| if b.1 > a.1 { b } else { a })
        .map(|(mv, _)| mv)
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::{Adversary, MatchResult, Side};
    use othello_core::{legal_places, Othello, CELLS};
    use rand_chacha::rand_core::{RngCore, SeedableRng};
    use rand_chacha::ChaCha20Rng;

    /// An independent, plain (no alpha-beta) exact minimax — the cross-check the
    /// endgame solver must agree with on a tractable position.
    fn ref_exact(board: &Board) -> i32 {
        if result(board).is_some() {
            let me = board.count(board.to_move) as i32;
            let them = board.count(board.to_move.other()) as i32;
            return TERMINAL_SCALE * (me - them);
        }
        legal_moves(board)
            .into_iter()
            .map(|mv| -ref_exact(&apply_move(board, mv)))
            .max()
            .unwrap()
    }

    /// A **capped** search must stay capped, even when its own leaves fall into
    /// the exact region.
    ///
    /// `negamax` used to re-decide exactness at every node from that node's
    /// empty count, so a depth-7 Expert search from 17 empties reached 10 empties
    /// at its leaves and turned each one into a full solve-to-terminal. Measured
    /// in wasm 2026-08-06: **19,187ms for a single `live_move`**, with the spike
    /// sitting exactly at `TRACTABLE_EMPTIES + Expert.depth()`. Lowering the
    /// constant only moves the spike; the mode has to be decided once, at the
    /// root, and carried down.
    #[test]
    fn a_capped_search_does_not_solve_at_its_leaves() {
        // A position inside the exact region, so the two modes visibly disagree.
        let mut pos = <Othello as Adversary>::initial(0);
        let mut rng = ChaCha20Rng::seed_from_u64(4);
        while pos.cells.iter().filter(|&&v| v == 0).count() > TRACTABLE_EMPTIES {
            let l = legal_moves(&pos);
            pos = apply_move(&pos, l[(rng.next_u32() as usize) % l.len()]);
            if result(&pos).is_some() {
                break;
            }
        }
        assert!(
            result(&pos).is_none(),
            "the fixture must be a live position"
        );

        // Capped at depth 0: the heuristic, whatever the empty count says.
        assert_eq!(
            negamax(
                &pos,
                0,
                i32::MIN + 1,
                i32::MAX - 1,
                Mode::Capped,
                &mut Table::new(),
                &mut NodeBudget::unlimited()
            ),
            heuristic(&pos),
            "a capped search must cut off at its depth, not solve because the position is small"
        );
        // Exact mode ignores depth and searches to a terminal, agreeing with an
        // independent plain minimax.
        assert_eq!(
            negamax(
                &pos,
                0,
                i32::MIN + 1,
                i32::MAX - 1,
                Mode::Exact,
                &mut Table::new(),
                &mut NodeBudget::unlimited()
            ),
            ref_exact(&pos),
            "exact mode still solves"
        );
    }

    #[test]
    fn the_root_decides_the_mode_from_its_own_position() {
        assert_eq!(mode_for(TRACTABLE_EMPTIES), Mode::Exact);
        assert_eq!(mode_for(TRACTABLE_EMPTIES - 1), Mode::Exact);
        assert_eq!(mode_for(TRACTABLE_EMPTIES + 1), Mode::Capped);
    }

    /// Play `plies` of first-legal Othello, to reach a position of a given phase.
    fn position_after(plies: usize) -> Board {
        let mut pos = <Othello as Adversary>::initial(0);
        for _ in 0..plies {
            if result(&pos).is_some() {
                break;
            }
            pos = apply_move(&pos, legal_moves(&pos)[0]);
        }
        pos
    }

    /// **The safety net, and the strongest regression test available here.** A
    /// transposition table is a pure speed change: it must alter what the search
    /// *costs* and never what it *answers*. Asserted across the opening, the
    /// midgame (where the 2,115ms worst call lives) and the exact endgame, at the
    /// real Expert depth, because the exact/capped modes store entries under
    /// different rules and only the endgame exercises the second.
    #[test]
    fn the_table_changes_the_cost_and_never_the_values() {
        for plies in [0, 12, 24, 40, 52] {
            let pos = position_after(plies);
            if result(&pos).is_some() {
                continue;
            }
            let depth = Level::Expert.depth();
            let with = move_values_with(&pos, depth, &mut Table::new());
            let without = move_values_with(&pos, depth, &mut Table::disabled());
            assert_eq!(
                with,
                without,
                "the table must not change a single value (after {plies} plies, \
                 {} empties)",
                empties_of(&pos)
            );
        }
    }

    /// ...and it must actually *do* something. Without this the test above passes
    /// for a table that is never read, which is precisely the stub this was
    /// written against.
    ///
    /// The midgame is the case that matters: Phase 0 measured Othello's worst
    /// single move at 2,115ms with 36 empties, against checkers' 337ms at a ply
    /// deeper — and the difference between those two searches is this table.
    /// A realistic midgame position: a seeded-random walk down to `empties`.
    ///
    /// **Not** first-legal play, which is what the first version of this test
    /// used and why it measured nothing. First-legal walks the game into a
    /// lopsided board with very few legal moves — the depth-7 search there costs
    /// ~1,200 nodes, against the many millions in the position Phase 0 measured
    /// at 2,115ms. A fixture that cheap cannot show a search optimization
    /// working or failing.
    fn midgame(seed: u64, empties: usize) -> Board {
        let mut pos = <Othello as Adversary>::initial(0);
        let mut rng = ChaCha20Rng::seed_from_u64(seed);
        while empties_of(&pos) > empties && result(&pos).is_none() {
            let l = legal_moves(&pos);
            pos = apply_move(&pos, l[(rng.next_u32() as usize) % l.len()]);
        }
        pos
    }

    /// The table must actually save work on the position class that hurts.
    ///
    /// **The threshold is a floor under a measurement, not a target.** Measured
    /// 2026-08-07 at 36 empties, Expert depth 7, release: seed 7 saved 31%
    /// (761,478 → 529,081 nodes). 20% is set below that so ordinary variation in
    /// the fixture does not redden the gate, while still failing loudly for a
    /// table that is never read (0%) — which is the stub this was written
    /// against.
    ///
    /// Worth recording what this number is *not*: Phase 0 guessed the missing
    /// table was why checkers searches a ply deeper six times faster. At 31% it
    /// is not. Othello's tree is genuinely wider — checkers' mandatory captures
    /// narrow its search in a way no table can imitate.
    ///
    /// Also measured and then reverted: storing each entry's best move and
    /// searching it first saved a further **0.4%** (526,877 nodes). Best-move
    /// ordering pays off across the *iterations of an iterative deepening
    /// search*, where a shallower pass orders the next deeper one; inside one
    /// fixed-depth search there are too few re-visits for it to matter. It
    /// belongs with the deepening driver, not here.
    #[test]
    fn the_table_cuts_the_work_the_midgame_search_does() {
        // 36 empties is where Phase 0 measured the worst single move (2,115ms).
        for seed in [7, 11, 23] {
            let pos = midgame(seed, 36);
            assert!(
                result(&pos).is_none(),
                "the fixture must be a live position"
            );
            assert!(
                empties_of(&pos) > TRACTABLE_EMPTIES,
                "the fixture must be a capped (midgame) search, not an endgame solve"
            );

            let mut with = Table::new();
            let mut without = Table::disabled();
            let a = move_values_with(&pos, Level::Expert.depth(), &mut with);
            let b = move_values_with(&pos, Level::Expert.depth(), &mut without);
            assert_eq!(a, b, "and still the same values on seed {seed}");

            assert!(!with.is_empty(), "an enabled table must store something");
            assert!(
                without.is_empty(),
                "a disabled table must store nothing, or it is not a reference"
            );
            assert!(
                with.nodes() * 5 <= without.nodes() * 4,
                "the table must save at least 20% of midgame nodes on seed {seed} \
                 (with {}, without {})",
                with.nodes(),
                without.nodes()
            );
        }
    }

    /// A live endgame position inside the exact region.
    fn endgame(seed: u64) -> Board {
        let pos = midgame(seed, TRACTABLE_EMPTIES);
        assert!(result(&pos).is_none(), "the fixture must be live");
        assert!(empties_of(&pos) <= TRACTABLE_EMPTIES);
        pos
    }

    /// A budget large enough for the solve leaves the answer exactly as it was.
    #[test]
    fn a_solve_that_fits_is_unchanged_and_says_it_is_exact() {
        for seed in [7, 11, 23] {
            let pos = endgame(seed);
            let got = move_values_honest(&pos, 0, &mut NodeBudget::unlimited());
            assert!(got.exact, "an unbounded solve in the exact region is exact");
            assert_eq!(
                got.values,
                move_values(&pos, 0),
                "and matches the unbudgeted search on seed {seed}"
            );
        }
    }

    /// **The honesty property.** A solve that does not fit must not be reported
    /// as exact, and must not leak the partial values it had computed — it falls
    /// back to a whole capped search.
    ///
    /// Before `Valued` existed, `live::choose` derived this flag from the empty
    /// count alone. Under a budget that is a lie: the position is still in the
    /// exact region, so the old code would have applied an `i32::signum` class
    /// floor to numbers that are horizon heuristics. The floor would have claimed
    /// to preserve a *known* win/draw/loss it had never proven.
    #[test]
    fn a_solve_that_does_not_fit_falls_back_whole_and_admits_it() {
        for seed in [7, 11, 23] {
            let pos = endgame(seed);
            // One node: enough to enter the search and not to finish it.
            let mut tiny = NodeBudget::of(1);
            let got = move_values_honest(&pos, Level::Easy.depth(), &mut tiny);

            assert!(
                !got.exact,
                "an aborted solve must never be reported as exact (seed {seed})"
            );
            // Not "some values" — *the* capped values. A partial exact result
            // would mix proven numbers with horizon ones, and the band compares
            // values across moves.
            let mut tt = Table::new();
            let capped = search_all(
                &pos,
                Level::Easy.depth(),
                Mode::Capped,
                &mut tt,
                &mut NodeBudget::unlimited(),
            );
            assert_eq!(
                got.values, capped,
                "the fallback must be a whole capped search (seed {seed})"
            );
            assert_eq!(
                got.values.len(),
                legal_moves(&pos).len(),
                "and must value every legal move"
            );
        }
    }

    /// An aborted search must leave nothing **unsound** behind in the table.
    ///
    /// A truncated subtree's value is not a bound on anything. Stored, it would
    /// outlive the search that produced it and later be read as if a real search
    /// had produced it — the table would answer with a number no fresh search
    /// would return.
    ///
    /// Note what is *not* claimed: that the table is empty. This test first
    /// asserted that and was wrong — an overrun search legitimately stores the
    /// subtrees it finished **before** the budget ran out, and 29 of them here
    /// are real values. What the latching exhaustion flag guarantees is that
    /// nothing is stored from the moment of overrun onward, which covers every
    /// truncated node and every ancestor of one. Soundness, not emptiness, is
    /// the property — so the reuse assertion below is the test, not a follow-up
    /// to it.
    #[test]
    fn an_aborted_search_stores_nothing_unsound_and_poisons_no_later_search() {
        let pos = endgame(7);

        let mut poisoned = Table::new();
        let mut tiny = NodeBudget::of(50);
        let _ = search_all(&pos, 0, Mode::Exact, &mut poisoned, &mut tiny);
        assert!(tiny.is_exhausted(), "the fixture must actually overrun");

        // A full search reusing the overrun search's table must agree with one
        // from a fresh table. If any truncated value had been stored, this is
        // where it would surface.
        let reused = search_all(
            &pos,
            0,
            Mode::Exact,
            &mut poisoned,
            &mut NodeBudget::unlimited(),
        );
        let fresh = search_all(
            &pos,
            0,
            Mode::Exact,
            &mut Table::new(),
            &mut NodeBudget::unlimited(),
        );
        assert_eq!(reused, fresh, "a reused table must not change the answer");
    }

    #[test]
    fn heuristic_player_clearly_beats_random() {
        // A modest-depth heuristic as A vs a seeded-random B, over several games.
        // Depth 3 already crushes random and keeps the debug test fast (the deep
        // levels are exercised by the responsiveness test and live play).
        let depth = Level::Medium.depth();
        let mut wins = 0;
        for seed in 0..8u64 {
            let mut rng = ChaCha20Rng::seed_from_u64(seed);
            let mut pos = <Othello as Adversary>::initial(0);
            while result(&pos).is_none() {
                let mv = if pos.to_move == Side::A {
                    best_move(&pos, depth).unwrap()
                } else {
                    let l = legal_moves(&pos);
                    l[(rng.next_u32() as usize) % l.len()]
                };
                pos = apply_move(&pos, mv);
            }
            if result(&pos) == Some(MatchResult::WinA) {
                wins += 1;
            }
        }
        assert!(wins >= 6, "heuristic should crush random (won {wins}/8)");
    }

    #[test]
    fn exact_endgame_agrees_with_an_independent_minimax() {
        // Reach a position with few empties by first-legal play, then confirm the
        // alpha-beta exact values equal a plain minimax's on every legal move.
        let mut pos = <Othello as Adversary>::initial(0);
        while pos.cells.iter().filter(|&&v| v == 0).count() > TRACTABLE_EMPTIES {
            let mv = legal_moves(&pos)[0];
            pos = apply_move(&pos, mv);
            if result(&pos).is_some() {
                break;
            }
        }
        assert!(result(&pos).is_none(), "stopped at a live endgame position");
        assert!(pos.cells.iter().filter(|&&v| v == 0).count() <= TRACTABLE_EMPTIES);
        for (mv, v) in move_values(&pos, 0) {
            let reference = -ref_exact(&apply_move(&pos, mv));
            assert_eq!(
                v, reference,
                "exact value must match the independent minimax for {mv:?}"
            );
        }
    }

    #[test]
    fn responsive_from_the_opening() {
        let pos = <Othello as Adversary>::initial(0);
        let t = std::time::Instant::now();
        let mv = best_move(&pos, Level::Expert.depth());
        let ms = t.elapsed().as_millis();
        assert!(mv.is_some(), "returns a move from the opening");
        assert!(ms < 5000, "Expert opening move took {ms}ms (debug bound)");
    }

    #[test]
    fn takes_a_free_corner_over_a_c_square() {
        // A can play the (0,0) corner (flips (0,1)) or a C-square at (1,0) (flips
        // (2,0)). The corner is permanent and far stronger — the engine takes it.
        let mut cells = [0u8; CELLS];
        cells[2] = 1; // (0,2) A
        cells[1] = 2; // (0,1) B  -> A at (0,0) flips it (corner move)
        cells[24] = 1; // (3,0) A
        cells[16] = 2; // (2,0) B -> A at (1,0)=idx8 flips it (C-square move)
        let board = Board {
            cells,
            to_move: Side::A,
        };
        assert!(
            legal_places(&board).contains(&0),
            "the corner is a legal move"
        );
        assert!(
            legal_places(&board).contains(&8),
            "the C-square is a legal move"
        );
        assert_eq!(
            best_move(&board, Level::Hard.depth()),
            Some(Move::Place(0)),
            "takes the corner"
        );
    }
}
