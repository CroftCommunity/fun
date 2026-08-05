//! Alpha-beta search with a transposition table, and the honesty flag.
//!
//! ## What `exact` means here, and the two ways to get it wrong
//!
//! A [`Scored`] value is `exact` when it is a **true value** — not an alpha-beta
//! bound — whose principal variation ends in a **real terminal position** rather
//! than a heuristic evaluation at the horizon. Two traps, both of which would
//! make the flag a lie while looking correct in casual testing, because the
//! win/draw/loss class is usually right anyway:
//!
//! 1. **Alpha-beta returns bounds, not values.** At a cut node the search knows
//!    only "at least this good". A terminal-derived score *there* does not prove
//!    the class, so the flag must not be set. This is why a node tracks whether
//!    it completed its move loop, not merely what its best child returned.
//! 2. **The transposition table must respect the window it is answering.** A
//!    stored exact value is valid at any window — but a *fresh* search under a
//!    narrow window would have cut off and returned a bound. If the table reports
//!    exactness where a fresh search would not, the flag becomes a function of
//!    which order the search happened to visit nodes in. So a table hit reports
//!    exactness only where a fresh search would: strictly inside the window.
//!
//! The table is keyed on `(cells, side to move, no-progress counter)`. The
//! counter belongs in the key for the same reason it belongs in `state_hash`: two
//! boards with identical men have different legal futures if one is closer to the
//! draw, and a table that conflated them would answer from a different position.
//!
//! Phase 0 measured the table as **mandatory, not an optimization** — 1 of 8
//! four-piece endgames solved without it, 8 of 8 with.

use std::collections::HashMap;

use adversary_core::MatchResult;
use checkers_core::{apply_move, legal_moves, result, row_col, Board, Move, SQUARES};

use crate::eval::heuristic;

/// The magnitude of a proven terminal. Far above any reachable heuristic score
/// (24 pieces of material is a few thousand), so a proven win always outranks a
/// horizon evaluation however good the latter looks.
const WIN: i32 = 1_000_000;

/// Total pieces at or below which the search spends a deeper budget hunting for a
/// proof.
///
/// **This is a budget knob, not an exactness switch.** Phase 0's D3 measured that
/// no piece count makes a full checkers solve affordable — a four-piece endgame is
/// ~3.8M nodes even with the table — so nothing here ever declares a position
/// "now solved". It only says *try harder*, and whether a proof was actually found
/// is reported by [`Scored::exact`] either way.
pub const TRACTABLE_PIECES: usize = 8;

/// Extra plies granted below [`TRACTABLE_PIECES`].
const ENDGAME_BONUS: u32 = 4;

/// Difficulty levels — a search depth, and (via the difficulty band) a class floor
/// and sloppiness. Checkers is unsolved, so even Expert is a strong heuristic
/// player that proves what it can inside its horizon.
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
    /// The capped search depth for this level. `const` so a caller can pin a
    /// depth to a level at compile time rather than restating the number.
    #[must_use]
    pub const fn depth(self) -> u32 {
        match self {
            Level::Easy => 2,
            Level::Medium => 4,
            Level::Hard => 6,
            Level::Expert => 8,
        }
    }
}

/// A searched value plus whether its win/draw/loss class is **proven**.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Scored {
    /// The value from the side-to-move's perspective; higher is better.
    pub value: i32,
    /// Whether `value` is a true value tracing to a real terminal position. See
    /// the module docs — a `false` here is not "probably right", it is "the
    /// search does not claim to know".
    pub exact: bool,
}

/// Which side of the search window a stored value sits on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Bound {
    /// A true value.
    Exact,
    /// The real value is at least this (the node cut off).
    Lower,
    /// The real value is at most this (the node failed low).
    Upper,
}

/// A transposition-table key. The no-progress counter is part of the position,
/// not metadata — see the module docs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct TtKey {
    cells: [u8; SQUARES],
    to_move: u8,
    no_progress: u16,
}

impl TtKey {
    fn of(board: &Board) -> Self {
        TtKey {
            cells: board.cells,
            to_move: match board.to_move {
                adversary_core::Side::A => 1,
                adversary_core::Side::B => 2,
            },
            no_progress: board.no_progress,
        }
    }
}

/// One stored search result.
#[derive(Debug, Clone, Copy)]
struct TtEntry {
    depth: u32,
    value: i32,
    bound: Bound,
    proven: bool,
}

/// The transposition table. Created per top-level call, so a search is a pure
/// function of its position and depth — a table that outlived a call would make
/// results depend on what was searched before.
#[derive(Debug, Default)]
pub struct Table {
    map: HashMap<TtKey, TtEntry>,
    enabled: bool,
}

impl Table {
    /// A working table.
    #[must_use]
    pub fn new() -> Self {
        Table {
            map: HashMap::new(),
            enabled: true,
        }
    }

    /// A table that stores nothing and answers nothing — the control for
    /// asserting that the table changes speed and not results.
    #[must_use]
    pub fn disabled() -> Self {
        Table {
            map: HashMap::new(),
            enabled: false,
        }
    }

    /// How many positions are stored (a search-cost signal for tests).
    #[must_use]
    pub fn len(&self) -> usize {
        self.map.len()
    }

    /// Whether the table holds nothing.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
}

/// The value of a terminal position from the side-to-move's perspective.
///
/// `depth` is the search depth *remaining*, so a win found sooner scores higher —
/// which is what makes the engine finish a won game rather than shuffle inside it.
fn terminal_value(board: &Board, res: MatchResult, depth: u32) -> i32 {
    let distance = WIN + depth as i32;
    match res.winner() {
        None => 0,
        Some(side) if side == board.to_move => distance,
        Some(_) => -distance,
    }
}

/// Legal moves ordered longest-jump-first, to sharpen alpha-beta.
///
/// Ordering is a **speed device only** — it can never change a result, so the
/// ranking uses a cheap proxy rather than regenerating every chain: a hop crosses
/// two rows and a step crosses one, so row distance ranks longer captures first.
/// (A cyclic king capture has `from == to` and so ranks last despite taking
/// several pieces. That costs a little search time in a rare position and is
/// still correct, which is the trade a move ordering is allowed to make.)
fn ordered_moves(board: &Board) -> Vec<Move> {
    let mut moves = legal_moves(board);
    moves.sort_by_key(|m| {
        let (from_row, _) = row_col(m.from);
        let (to_row, _) = row_col(m.to);
        std::cmp::Reverse(from_row.abs_diff(to_row))
    });
    moves
}

/// What a stored entry may answer for a probe at `(depth, alpha, beta)`, or
/// `None` when it cannot answer and the node must search.
///
/// Split out of [`negamax`] so the policy is **reachable from a test at all**.
/// Two of its rules cannot be provoked through the public API — a sweep of ~6400
/// searches over 160 seeded positions, ten no-progress counters and four depths
/// could not make either of them change a single root value:
///
/// - **the counter in the key.** Two lines reaching identical cells with the same
///   side to move and *different* counters need both sides to hold both a man and
///   a king and to interleave an advance against a king move. Constructible;
///   vanishingly rare in play.
/// - **the window clamp on an exact hit.** A child whose value falls outside the
///   window cannot decide its parent's best when the parent completes in-window —
///   that is what the window means — so a wrong answer here is swallowed.
///
/// Both are still *right*, and unreachable-but-wrong is how a table starts
/// answering from a different position the day the search around it changes. So
/// they are asserted here rather than assumed there.
fn table_answer(entry: TtEntry, depth: u32, alpha: i32, beta: i32) -> Option<Scored> {
    // **Strictly the same depth, not `>=`.** Reusing a deeper entry is the
    // textbook optimization and it is wrong here: a deeper value is a *better*
    // value, not the value a depth-`d` search computes, so the table would stop
    // being a cache and start being part of the answer. Measured — with `>=`, a
    // six-piece endgame at depth 8 returned 587 for four different root moves
    // whose true depth-8 values were 562, 562, 586 and 562. The table-free search
    // agreed with a plain minimax; the table did not.
    //
    // Two things fall out of the strict match, and both are why it stays:
    // `Level::depth()` means what it says rather than "at least this, more if the
    // search happened to transpose"; and terminal scores need no ply re-anchoring,
    // because the same remaining depth is the same distance. Relaxing this gate
    // requires putting that adjustment back *and* giving up "the table changes
    // speed, not results".
    if entry.depth != depth {
        return None;
    }
    match entry.bound {
        // A stored exact value is valid at any window — but a *fresh* search under
        // a narrow window would have cut off and returned a bound. Report
        // exactness only where a fresh search would, or the flag becomes a
        // function of what order the search happened to visit nodes in.
        Bound::Exact => Some(Scored {
            value: entry.value,
            exact: entry.proven && entry.value > alpha && entry.value < beta,
        }),
        Bound::Lower if entry.value >= beta => Some(Scored {
            value: entry.value,
            exact: false,
        }),
        Bound::Upper if entry.value <= alpha => Some(Scored {
            value: entry.value,
            exact: false,
        }),
        _ => None,
    }
}

/// Negamax with alpha-beta and the transposition table.
fn negamax(board: &Board, depth: u32, mut alpha: i32, beta: i32, tt: &mut Table) -> Scored {
    if let Some(res) = result(board) {
        return Scored {
            value: terminal_value(board, res, depth),
            exact: true,
        };
    }
    if depth == 0 {
        return Scored {
            value: heuristic(board),
            exact: false,
        };
    }

    let key = TtKey::of(board);
    if tt.enabled {
        if let Some(hit) = tt
            .map
            .get(&key)
            .and_then(|e| table_answer(*e, depth, alpha, beta))
        {
            return hit;
        }
    }

    let alpha0 = alpha;
    let mut best = i32::MIN + 1;
    let mut best_proven = false;
    let mut cut = false;

    for mv in ordered_moves(board) {
        let child = negamax(&apply_move(board, mv), depth - 1, -beta, -alpha, tt);
        let value = -child.value;
        if value > best {
            best = value;
            best_proven = child.exact;
        }
        if best > alpha {
            alpha = best;
        }
        if alpha >= beta {
            cut = true;
            break;
        }
    }

    let bound = if cut {
        Bound::Lower
    } else if best <= alpha0 {
        Bound::Upper
    } else {
        Bound::Exact
    };
    // Trap 1 (module docs): a bound proves nothing about the class, however the
    // value was derived. Only a completed, in-window search whose best line ends
    // in a terminal is `exact`.
    let exact = bound == Bound::Exact && best_proven;

    if tt.enabled {
        tt.map.insert(
            key,
            TtEntry {
                depth,
                value: best,
                bound,
                proven: exact,
            },
        );
    }

    Scored { value: best, exact }
}

/// The search depth actually used from `board` at nominal `depth`: deeper once
/// few enough pieces remain, because that is where a proof is within reach. See
/// [`TRACTABLE_PIECES`] — this buys attempts, never claims.
pub(crate) fn budgeted_depth(board: &Board, depth: u32) -> u32 {
    let pieces = board.cells.iter().filter(|&&c| c != 0).count();
    if pieces <= TRACTABLE_PIECES {
        depth + ENDGAME_BONUS
    } else {
        depth
    }
}

/// Every legal move with its searched value and honesty flag, using `tt`.
///
/// Each move is searched with a **full window**, so no root value is ever an
/// alpha-beta bound — the tutor and the difficulty band both compare values
/// across moves, and comparing bounds against values would be meaningless.
#[must_use]
pub fn move_scores_with(board: &Board, depth: u32, tt: &mut Table) -> Vec<(Move, Scored)> {
    let depth = budgeted_depth(board, depth);
    legal_moves(board)
        .into_iter()
        .map(|mv| {
            let child = negamax(
                &apply_move(board, mv),
                depth.saturating_sub(1),
                i32::MIN + 1,
                i32::MAX - 1,
                tt,
            );
            (
                mv,
                Scored {
                    value: -child.value,
                    exact: child.exact,
                },
            )
        })
        .collect()
}

/// Every legal move with its searched value and honesty flag. Empty when the
/// position is terminal.
#[must_use]
pub fn move_scores(board: &Board, depth: u32) -> Vec<(Move, Scored)> {
    move_scores_with(board, depth, &mut Table::new())
}

/// Every legal move with its value (side-to-move perspective; higher is better),
/// dropping the honesty flag — what the difficulty band consumes.
#[must_use]
pub fn move_values(board: &Board, depth: u32) -> Vec<(Move, i32)> {
    move_scores(board, depth)
        .into_iter()
        .map(|(mv, s)| (mv, s.value))
        .collect()
}

/// The highest-valued move (the first on a tie), or `None` if terminal.
#[must_use]
pub fn best_move(board: &Board, depth: u32) -> Option<Move> {
    move_scores(board, depth)
        .into_iter()
        .reduce(|a, b| if b.1.value > a.1.value { b } else { a })
        .map(|(mv, _)| mv)
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::{Adversary, Side};
    use checkers_core::{cell_of, square_at, Checkers, Piece};
    use rand_chacha::rand_core::{RngCore, SeedableRng};
    use rand_chacha::ChaCha20Rng;

    /// Wall-clock ceiling for a top-level opening move on the **debug** profile.
    /// Named rather than inline because the number is a judgement about what a tap
    /// may cost, and a future reader has to be able to argue with it. The shipped
    /// build is release-in-wasm and Phase 11 measures that separately.
    const OPENING_BUDGET_MS: u128 = 4_000;

    fn sq(row: isize, col: isize) -> u8 {
        square_at(row, col).expect("fixture coordinate is a dark square")
    }

    fn fixture(to_move: Side, pieces: &[(isize, isize, Piece)]) -> Board {
        let mut board = Board::empty(to_move);
        for &(row, col, piece) in pieces {
            board.cells[sq(row, col) as usize] = cell_of(piece);
        }
        board
    }

    /// An independent plain minimax: no alpha-beta, no table, no move ordering.
    /// The cross-check that makes `exact` a claim about the game rather than a
    /// claim about our own search by our own search.
    fn ref_minimax(board: &Board, depth: u32) -> i32 {
        if let Some(res) = result(board) {
            return terminal_value(board, res, depth);
        }
        if depth == 0 {
            return heuristic(board);
        }
        legal_moves(board)
            .into_iter()
            .map(|mv| -ref_minimax(&apply_move(board, mv), depth - 1))
            .max()
            .expect("a live position has moves")
    }

    /// A won-in-one position: A's man takes B's last piece.
    fn win_in_one() -> Board {
        fixture(
            Side::A,
            &[(2, 1, Piece::man(Side::A)), (3, 2, Piece::man(Side::B))],
        )
    }

    #[test]
    fn a_forced_win_inside_the_horizon_is_proven_and_wins() {
        let only = move_scores(&win_in_one(), 2);
        assert_eq!(only.len(), 1, "capture is mandatory");
        let (_, capture) = only[0];
        assert!(capture.exact, "a reachable terminal is a proof");
        assert!(capture.value > WIN, "and the class is a win");
    }

    #[test]
    fn the_opening_is_not_proven() {
        // The other side of the branch. Nothing terminates within a few plies of
        // the opening, so every value is a horizon judgement and the flag must say
        // so — this is what the tutor's hedged wording rests on.
        let scores = move_scores(&Board::start(), Level::Medium.depth());
        assert_eq!(scores.len(), 7, "the seven textbook opening moves");
        assert!(
            scores.iter().all(|(_, s)| !s.exact),
            "no opening move is proven"
        );
        assert!(
            scores.iter().all(|(_, s)| s.value.abs() < WIN),
            "and none carries a terminal magnitude"
        );
    }

    #[test]
    fn a_terminal_score_at_a_cut_node_is_not_proven() {
        // THE trap. The same position, the same terminal, two windows. With a full
        // window the search returns a true value and the proof stands; with a
        // window the win overshoots, the node cuts off and knows only "at least
        // this good" — which proves nothing, however the number was derived.
        //
        // A search that sets the flag on every terminal it touches passes the test
        // above and fails this one, which is the entire point of having it.
        let pos = win_in_one();

        let wide = negamax(&pos, 3, i32::MIN + 1, i32::MAX - 1, &mut Table::new());
        assert!(wide.exact, "a completed in-window search proves the class");
        assert!(wide.value > WIN);

        let narrow = negamax(&pos, 3, -1, 0, &mut Table::new());
        assert_eq!(narrow.value, wide.value, "the value is the same number");
        assert!(
            !narrow.exact,
            "but at a cut node it is a bound, and a bound proves nothing"
        );
    }

    #[test]
    fn the_table_changes_speed_not_results() {
        // The table is a cache, so it must be invisible in the answers — values
        // *and* honesty flags. An unsound table is not loud: it returns a
        // plausible number from a position that merely looks like this one.
        //
        // A handful of hand-built positions is not enough to establish that, and
        // this test learned it the hard way: four fixed fixtures at depth 5 caught
        // none of the four ways to break the table (drop the no-progress counter
        // from the key, drop the depth gate, ignore the search window on a hit,
        // reuse deeper entries). Transposition bugs need positions dense in
        // transpositions, which means real play, several depths, and — for the
        // counter — positions near the draw horizon.
        let mut checked = 0;
        for seed in 0..40u64 {
            let mut rng = ChaCha20Rng::seed_from_u64(seed);
            let mut pos = <Checkers as Adversary>::initial(0);
            for _ in 0..(20 + seed % 45) {
                if result(&pos).is_some() {
                    break;
                }
                let legal = legal_moves(&pos);
                pos = apply_move(&pos, legal[(rng.next_u32() as usize) % legal.len()]);
            }
            if result(&pos).is_some() {
                continue;
            }
            // The counter is in the key because it changes the legal future. That
            // only bites within a search when the horizon is close enough to cross,
            // so the sweep has to include positions that are.
            for no_progress in [0u16, 60, 74, 76] {
                let mut probe = pos;
                probe.no_progress = no_progress;
                if result(&probe).is_some() {
                    continue;
                }
                for depth in [4u32, 6] {
                    let mut on = Table::new();
                    let with = move_scores_with(&probe, depth, &mut on);
                    let without = move_scores_with(&probe, depth, &mut Table::disabled());
                    assert_eq!(
                        with, without,
                        "seed {seed}, no_progress {no_progress}, depth {depth}"
                    );
                    checked += 1;
                }
            }
        }
        assert!(checked > 200, "the sweep only compared {checked} searches");

        // ...and the table is not vacuously agreeing by never being consulted.
        // Measured 2026-08-05: 583 distinct positions at depth 5 from the opening.
        let mut opening = Table::new();
        let _ = move_scores_with(&Board::start(), 5, &mut opening);
        assert!(
            opening.len() > 100,
            "the table stored only {} positions",
            opening.len()
        );
    }

    #[test]
    fn proven_values_agree_with_an_independent_minimax() {
        // The wiring test. Wherever the search claims a proof, a plain minimax at
        // the same depth must produce the same number — and since both are
        // side-to-move relative, agreeing on the number is stronger than agreeing
        // on the class.
        let positions = [
            win_in_one(),
            fixture(
                Side::A,
                &[
                    (2, 1, Piece::man(Side::A)),
                    (3, 2, Piece::man(Side::B)),
                    (5, 2, Piece::man(Side::B)),
                ],
            ),
            fixture(
                Side::A,
                &[
                    (4, 3, Piece::king(Side::A)),
                    (5, 2, Piece::man(Side::B)),
                    (1, 2, Piece::man(Side::B)),
                ],
            ),
        ];
        let mut proofs = 0;
        for (i, pos) in positions.iter().enumerate() {
            let depth = 3;
            let effective = budgeted_depth(pos, depth);
            for (mv, scored) in move_scores(pos, depth) {
                let reference = -ref_minimax(&apply_move(pos, mv), effective - 1);
                assert_eq!(
                    scored.value, reference,
                    "position {i}, move {mv:?}: alpha-beta must not change the value"
                );
                if scored.exact {
                    proofs += 1;
                    assert!(
                        reference.abs() > WIN || reference == 0,
                        "a proof is a terminal magnitude or a draw, got {reference}"
                    );
                }
            }
        }
        assert!(proofs > 0, "the fixtures must actually exercise a proof");
    }

    #[test]
    fn only_mandated_captures_are_valued_and_a_quiet_position_values_its_quiet_moves() {
        // Both branches, the same rule as `checkers-core`: a search that only ever
        // sees captures passes the one-sided version of this.
        let forced = fixture(
            Side::A,
            &[
                (2, 1, Piece::man(Side::A)),
                (2, 7, Piece::man(Side::A)),
                (3, 2, Piece::man(Side::B)),
                (7, 6, Piece::king(Side::B)),
            ],
        );
        let scores = move_scores(&forced, 2);
        assert_eq!(scores.len(), 1, "only the mandated capture is valued");
        assert_eq!(scores[0].0.from, sq(2, 1));

        let quiet = fixture(
            Side::A,
            &[
                (2, 1, Piece::man(Side::A)),
                (2, 7, Piece::man(Side::A)),
                (7, 6, Piece::king(Side::B)),
            ],
        );
        assert_eq!(move_scores(&quiet, 2).len(), 3, "its three simple moves");
        assert!(best_move(&quiet, 2).is_some());
    }

    #[test]
    fn a_heuristic_player_beats_a_seeded_random_player() {
        // A fixed seed list, so a failure is reproducible from the seed and a flake
        // is never mistaken for a regression.
        const SEEDS: u64 = 20;
        const FLOOR: u32 = 18;
        let mut wins = 0;
        for seed in 0..SEEDS {
            let mut rng = ChaCha20Rng::seed_from_u64(seed);
            let mut pos = <Checkers as Adversary>::initial(0);
            while result(&pos).is_none() {
                let mv = if pos.to_move == Side::A {
                    best_move(&pos, 3).expect("a live position has a best move")
                } else {
                    let legal = legal_moves(&pos);
                    legal[(rng.next_u32() as usize) % legal.len()]
                };
                pos = apply_move(&pos, mv);
            }
            if result(&pos) == Some(MatchResult::WinA) {
                wins += 1;
            }
        }
        assert!(
            wins >= FLOOR,
            "depth-3 should crush random (won {wins}/{SEEDS})"
        );
    }

    #[test]
    fn the_opening_returns_within_the_debug_budget() {
        let pos = <Checkers as Adversary>::initial(0);
        let started = std::time::Instant::now();
        let mv = best_move(&pos, Level::Expert.depth());
        let ms = started.elapsed().as_millis();
        assert!(mv.is_some(), "returns a move from the opening");
        assert!(
            ms < OPENING_BUDGET_MS,
            "Expert opening move took {ms}ms (debug budget {OPENING_BUDGET_MS}ms)"
        );
    }

    #[test]
    fn proofs_fire_often_enough_for_the_game_to_be_gradeable() {
        // Risk (b) from the plan, measured here rather than discovered in Phase 15.
        // `scorer.ts` grades a move only where the engine reports `exact`, so a
        // game that never proves anything has `scoredMoves == 0` forever: Phase 15
        // would run, pass, and measure nothing. The rate is printed so a *marginal*
        // rate is visible rather than merely non-zero.
        // Measured at **Expert**, because that is the level the harness grades at
        // (Phase 15 runs top-level self-play) — the rate at a shallower level is
        // not the number that decides whether Phase 15 measures anything.
        for level in [Level::Medium, Level::Expert] {
            let mut pos = <Checkers as Adversary>::initial(0);
            let mut rng = ChaCha20Rng::seed_from_u64(7);
            let (mut plies, mut proven_plies) = (0u32, 0u32);
            while result(&pos).is_none() && plies < 200 {
                if move_scores(&pos, level.depth())
                    .iter()
                    .any(|(_, s)| s.exact)
                {
                    proven_plies += 1;
                }
                plies += 1;
                let legal = legal_moves(&pos);
                pos = apply_move(&pos, legal[(rng.next_u32() as usize) % legal.len()]);
            }
            println!("proof rate at {level:?}: {proven_plies}/{plies} plies had a proven move");
            assert!(
                proven_plies > 0,
                "{level:?}: no ply in a full game proved anything — checkers would be ungradeable"
            );
        }
    }

    #[test]
    fn the_table_key_separates_positions_the_counter_makes_different() {
        // The counter is position state: identical men with the same side to move
        // are *not* the same state if one is closer to the no-progress draw. A key
        // that conflated them would answer from a different position — and a
        // plausible number from the wrong position is the quietest bug a search
        // can have.
        let near = Board::start();
        let mut nearer = near;
        nearer.no_progress = 1;
        assert_ne!(TtKey::of(&near), TtKey::of(&nearer));

        // ...and the two fields that obviously belong are in there too, so this
        // test fails if the key is ever narrowed rather than only if it is widened.
        let mut other_side = near;
        other_side.to_move = Side::B;
        assert_ne!(TtKey::of(&near), TtKey::of(&other_side));
        let mut moved = near;
        moved.cells[8] = 0;
        assert_ne!(TtKey::of(&near), TtKey::of(&moved));
        assert_eq!(TtKey::of(&near), TtKey::of(&Board::start()));
    }

    #[test]
    fn a_table_hit_answers_only_what_this_window_asked() {
        let entry = |bound, value, proven| TtEntry {
            depth: 4,
            value,
            bound,
            proven,
        };

        // Wrong depth: cannot answer at all. Not even a deeper one — see the
        // policy's own comment for the measurement behind that.
        assert_eq!(
            table_answer(entry(Bound::Exact, 50, true), 3, -999, 999),
            None
        );
        assert_eq!(
            table_answer(entry(Bound::Exact, 50, true), 5, -999, 999),
            None
        );

        // An exact value inside the window answers, and carries its proof.
        assert_eq!(
            table_answer(entry(Bound::Exact, 50, true), 4, -999, 999),
            Some(Scored {
                value: 50,
                exact: true
            })
        );
        // The same value at the window's edges is still the right *number*, but a
        // fresh search there would have returned a bound — so the proof is not
        // reported. Both edges, because `>` and `>=` are one character apart.
        assert_eq!(
            table_answer(entry(Bound::Exact, 50, true), 4, 50, 999),
            Some(Scored {
                value: 50,
                exact: false
            })
        );
        assert_eq!(
            table_answer(entry(Bound::Exact, 50, true), 4, -999, 50),
            Some(Scored {
                value: 50,
                exact: false
            })
        );
        // ...and an unproven exact value never becomes proven by being in-window.
        assert_eq!(
            table_answer(entry(Bound::Exact, 50, false), 4, -999, 999),
            Some(Scored {
                value: 50,
                exact: false
            })
        );

        // A lower bound answers only when it forces a cutoff, and a bound never
        // carries a proof however it was derived.
        assert_eq!(
            table_answer(entry(Bound::Lower, 50, true), 4, -999, 50),
            Some(Scored {
                value: 50,
                exact: false
            })
        );
        assert_eq!(
            table_answer(entry(Bound::Lower, 50, true), 4, -999, 51),
            None
        );

        // An upper bound, mirrored.
        assert_eq!(
            table_answer(entry(Bound::Upper, 50, true), 4, 50, 999),
            Some(Scored {
                value: 50,
                exact: false
            })
        );
        assert_eq!(
            table_answer(entry(Bound::Upper, 50, true), 4, 49, 999),
            None
        );
    }
}
