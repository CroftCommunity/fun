//! Alpha-beta search with quiescence, a sound transposition table, node
//! budgets, and the honesty flag.
//!
//! ## What `exact` means here
//!
//! A [`Scored`] value is `exact` when it is a **true value** — not an
//! alpha-beta bound — whose principal variation ends in a **real terminal
//! position** (checkmate, stalemate, insufficient material, the 50-move
//! clock, the third repetition) rather than a heuristic evaluation at the
//! horizon. The two soundness traps are checkers' (its `search.rs` module
//! docs): a cut node's bound proves nothing, and a table hit reports
//! exactness only where a fresh search would — strictly inside the window.
//!
//! ## Chess-specific soundness
//!
//! - **The table key carries the halfmove clock** beside the Zobrist key: two
//!   identical placements at halfmove 10 and 98 have different futures (one
//!   is about to draw), and a table that conflated them would answer from a
//!   different position.
//! - **A repetition-derived value is never stored.** The search walks
//!   [`Position`]s, so threefold inside the tree is judged against the path
//!   the search actually took — a value that traces to one is *path
//!   dependent*, true for this line and meaningless for a transposition.
//!   Storing it would let one line's draw leak into another line's search.
//! - **Quiescence** (captures and promotions, stand-pat) runs at the horizon
//!   and is charged to the same [`NodeBudget`] — a fixed-depth cutoff in the
//!   middle of a capture chain is what makes a shallow chess engine hang its
//!   queen (measured in Phase 0: quiescence costs 2.5–3× nodes, the tax the
//!   D2 table records).
//! - **Budgets abort whole iterations.** A search that runs out of nodes
//!   returns `None` — never a mix of depths across moves — and the deepening
//!   driver keeps the last complete iteration (`adversary_solver::deepen`).

use adversary_solver::{deepen, NodeBudget};
use chess_core::game::{ep_capturable, insufficient_material};
use chess_core::hash::position_key;
use chess_core::{legal_moves, result_given, Move, PieceKind, Position};
use std::collections::HashMap;

use crate::eval::{heuristic, MATE};

/// The search window bound — beyond any mate score at any depth.
const INFINITY: i32 = MATE + 512;

/// A searched value plus whether its win/draw/loss class is **proven**.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Scored {
    /// The value from the side to move's perspective; higher is better.
    pub value: i32,
    /// Whether `value` traces to a real terminal inside the search. A `false`
    /// is not "probably right" — it is "the search does not claim to know".
    pub exact: bool,
}

/// What one deepening search produced: every root move's score from the last
/// **complete** iteration, the depth that iteration reached, and the nodes the
/// whole search consumed. Depth and nodes ride to the wasm surface (Phase 7)
/// so a slow move on a phone is read against numbers the phone produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchReport {
    /// Every legal root move with its score, in `legal_moves` order.
    pub moves: Vec<(Move, Scored)>,
    /// The depth of the last complete iteration (0 when even depth 1 could
    /// not finish — a caller sizes its budget so that cannot happen).
    pub depth: u32,
    /// Search nodes consumed across all iterations, quiescence included.
    pub nodes: u64,
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

/// A transposition-table key: the Zobrist key (capturable-ep aware) plus the
/// halfmove clock — see the module docs for why the clock is position, not
/// metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct TtKey {
    zobrist: u64,
    halfmove: u16,
}

impl TtKey {
    fn of(pos: &Position) -> Self {
        TtKey {
            zobrist: position_key(&pos.board, ep_capturable(&pos.board)),
            halfmove: pos.board.halfmove,
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
    /// The best move's packed code, for ordering on a later probe (ordering
    /// is a speed device only — it can never change a result).
    best: u16,
}

/// The transposition table, plus the node counter the report reads. Created
/// per top-level call (one deepening run shares one), so a search is a pure
/// function of its position, depth and budget.
#[derive(Debug, Default)]
pub struct Table {
    map: HashMap<TtKey, TtEntry>,
    enabled: bool,
    nodes: u64,
}

impl Table {
    /// A working table.
    #[must_use]
    pub fn new() -> Self {
        Table {
            map: HashMap::new(),
            enabled: true,
            nodes: 0,
        }
    }

    /// A table that stores nothing and answers nothing — the control for
    /// asserting the table changes speed, never results.
    #[must_use]
    pub fn disabled() -> Self {
        Table {
            map: HashMap::new(),
            enabled: false,
            nodes: 0,
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

    /// Search nodes counted so far (quiescence included).
    #[must_use]
    pub fn nodes(&self) -> u64 {
        self.nodes
    }
}

/// What a search node learned, negamax-internal.
#[derive(Debug, Clone, Copy)]
struct Node {
    value: i32,
    exact: bool,
    /// Whether the value traces to a repetition terminal — true for this
    /// path, meaningless for a transposition, so never stored.
    path_dep: bool,
}

/// The value of a terminal from the side to move's perspective. `depth` is
/// the remaining depth, so a mate found sooner outranks one found later —
/// both directions: the engine finishes a won game and drags out a lost one.
fn terminal_value(res: adversary_core::MatchResult, pos: &Position, depth: u32) -> i32 {
    match res.winner() {
        None => 0,
        Some(winner) => {
            let mover_won =
                winner == <chess_core::Chess as adversary_core::Adversary>::side_to_move(pos);
            if mover_won {
                MATE + depth as i32
            } else {
                -(MATE + depth as i32)
            }
        }
    }
}

/// Is this terminal's judgement path-dependent? Only repetition reads the
/// carried history; every other terminal is a function of the board alone.
/// `had_moves` is whether the position had legal moves (already generated).
fn terminal_is_repetition(pos: &Position, had_moves: bool) -> bool {
    had_moves && pos.board.halfmove < 100 && !insufficient_material(&pos.board)
}

/// MVV-LVA-ish ordering: the table's best move first, then captures (most
/// valuable victim, least valuable attacker), promotions, quiets. Ordering is
/// a speed device only; `legal_moves`' deterministic order is the stable base.
fn order_moves(pos: &Position, moves: &mut [Move], tt_best: u16) {
    let value = |kind: Option<PieceKind>| match kind {
        Some(PieceKind::Pawn) => 100,
        Some(PieceKind::Knight) => 320,
        Some(PieceKind::Bishop) => 330,
        Some(PieceKind::Rook) => 500,
        Some(PieceKind::Queen) => 900,
        _ => 0,
    };
    let board = &pos.board;
    moves.sort_by_key(|m| {
        if tt_best != 0 && m.code() == tt_best {
            return -1_000_000;
        }
        let victim = chess_core::board::kind_of(board.cells[usize::from(m.to)]);
        let attacker = chess_core::board::kind_of(board.cells[usize::from(m.from)]);
        let mut k = 0;
        if victim.is_some() {
            k -= 10_000 + 10 * value(victim) - value(attacker);
        }
        if m.promo != 0 {
            k -= 9_000;
        }
        k
    });
}

/// Quiescence: resolve the standing captures and promotions, stand-pat at the
/// static evaluation. Charged to the same budget; `None` means it bit.
fn qsearch(
    pos: &Position,
    mut alpha: i32,
    beta: i32,
    tt: &mut Table,
    budget: &mut NodeBudget,
) -> Option<Node> {
    if !budget.charge() {
        return None;
    }
    tt.nodes += 1;
    let board = &pos.board;
    let all = legal_moves(board); // the node's ONE generation
    if let Some(res) = result_given(pos, &all) {
        return Some(Node {
            value: terminal_value(res, pos, 0),
            exact: true,
            path_dep: matches!(res, adversary_core::MatchResult::Draw)
                && terminal_is_repetition(pos, !all.is_empty()),
        });
    }
    let stand = heuristic(pos);
    if stand >= beta {
        return Some(Node {
            value: stand,
            exact: false,
            path_dep: false,
        });
    }
    if stand > alpha {
        alpha = stand;
    }
    let mut noisy: Vec<Move> = all
        .into_iter()
        .filter(|mv| {
            board.cells[usize::from(mv.to)] != 0
                || mv.promo != 0
                || (board.ep == Some(mv.to)
                    && chess_core::board::kind_of(board.cells[usize::from(mv.from)])
                        == Some(PieceKind::Pawn)
                    && mv.from % 8 != mv.to % 8)
        })
        .collect();
    order_moves(pos, &mut noisy, 0);
    let mut best = Node {
        value: stand,
        exact: false,
        path_dep: false,
    };
    for mv in noisy {
        let child = qsearch(&pos.play(mv), -beta, -alpha, tt, budget)?;
        let value = -child.value;
        if value > best.value {
            best = Node {
                value,
                exact: false,
                path_dep: child.path_dep,
            };
        }
        if value > alpha {
            alpha = value;
        }
        if alpha >= beta {
            break;
        }
    }
    Some(best)
}

/// What a stored entry may answer for a probe at `(depth, alpha, beta)` —
/// checkers' policy verbatim: strictly the same depth (a deeper value is a
/// better value, not this depth's value), and exactness only strictly inside
/// the window.
fn table_answer(entry: TtEntry, depth: u32, alpha: i32, beta: i32) -> Option<Node> {
    if entry.depth != depth {
        return None;
    }
    match entry.bound {
        Bound::Exact => Some(Node {
            value: entry.value,
            exact: entry.proven && entry.value > alpha && entry.value < beta,
            path_dep: false,
        }),
        Bound::Lower if entry.value >= beta => Some(Node {
            value: entry.value,
            exact: false,
            path_dep: false,
        }),
        Bound::Upper if entry.value <= alpha => Some(Node {
            value: entry.value,
            exact: false,
            path_dep: false,
        }),
        _ => None,
    }
}

/// Negamax with alpha-beta, the table, quiescence, and the budget. `None`
/// means the budget bit — the whole iteration is void, never partially used.
fn negamax(
    pos: &Position,
    depth: u32,
    mut alpha: i32,
    beta: i32,
    tt: &mut Table,
    budget: &mut NodeBudget,
) -> Option<Node> {
    if !budget.charge() {
        return None;
    }
    tt.nodes += 1;
    let mut moves = legal_moves(&pos.board); // the node's ONE generation
    if let Some(res) = result_given(pos, &moves) {
        return Some(Node {
            value: terminal_value(res, pos, depth),
            exact: true,
            path_dep: matches!(res, adversary_core::MatchResult::Draw)
                && terminal_is_repetition(pos, !moves.is_empty()),
        });
    }
    if depth == 0 {
        // Depth 0 re-derives its own move set in qsearch; the vec above still
        // paid for the terminal judgement. Accepted: the horizon node is the
        // one place the two generations overlap.
        return qsearch(pos, alpha, beta, tt, budget);
    }

    let key = TtKey::of(pos);
    let mut tt_best = 0u16;
    if tt.enabled {
        if let Some(entry) = tt.map.get(&key) {
            tt_best = entry.best;
            if let Some(hit) = table_answer(*entry, depth, alpha, beta) {
                return Some(hit);
            }
        }
    }

    let alpha0 = alpha;
    let mut best = -INFINITY;
    let mut best_proven = false;
    let mut best_code = 0u16;
    let mut path_dep = false;
    let mut cut = false;

    order_moves(pos, &mut moves, tt_best);
    for mv in moves {
        let child = negamax(&pos.play(mv), depth - 1, -beta, -alpha, tt, budget)?;
        let value = -child.value;
        path_dep |= child.path_dep;
        if value > best {
            best = value;
            best_proven = child.exact;
            best_code = mv.code();
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
    // A bound proves nothing about the class; only a completed, in-window
    // search whose best line ends in a terminal is exact.
    let exact = bound == Bound::Exact && best_proven;

    // A repetition-derived value is true for this path only — never stored.
    if tt.enabled && !path_dep {
        tt.map.insert(
            key,
            TtEntry {
                depth,
                value: best,
                bound,
                proven: exact,
                best: best_code,
            },
        );
    }

    Some(Node {
        value: best,
        exact,
        path_dep,
    })
}

/// Every legal root move with its searched value and honesty flag, at one
/// fixed `depth`, against a caller-supplied table and budget. Each root move
/// is searched with a **full window**, so no root value is ever a bound — the
/// tutor and the band compare values *across* moves. `None` when the budget
/// bit: the whole iteration is discarded, never a mix of depths.
#[must_use]
pub fn move_scores_with(
    pos: &Position,
    depth: u32,
    tt: &mut Table,
    budget: &mut NodeBudget,
) -> Option<Vec<(Move, Scored)>> {
    let mut out = Vec::new();
    for mv in <chess_core::Chess as adversary_core::Adversary>::legal_moves(pos) {
        let child = negamax(
            &pos.play(mv),
            depth.saturating_sub(1),
            -INFINITY,
            INFINITY,
            tt,
            budget,
        )?;
        out.push((
            mv,
            Scored {
                value: -child.value,
                exact: child.exact,
            },
        ));
    }
    Some(out)
}

/// [`move_scores_with`] with a fresh table and no budget — the exhaustive
/// form the tests and the tutor's fixed-depth calls use.
///
/// # Panics
///
/// Never in practice: an unlimited budget cannot bite.
#[must_use]
pub fn move_scores(pos: &Position, depth: u32) -> Vec<(Move, Scored)> {
    move_scores_with(pos, depth, &mut Table::new(), &mut NodeBudget::unlimited())
        .expect("not possible: an unlimited budget never bites")
}

/// Every legal move's value only (the band's input shape).
#[must_use]
pub fn move_values(pos: &Position, depth: u32) -> Vec<(Move, i32)> {
    move_scores(pos, depth)
        .into_iter()
        .map(|(mv, s)| (mv, s.value))
        .collect()
}

/// The strongest move at `depth`, or `None` on a terminal position.
#[must_use]
pub fn best_move(pos: &Position, depth: u32) -> Option<Move> {
    move_scores(pos, depth)
        .into_iter()
        .max_by_key(|&(_, s)| s.value)
        .map(|(mv, _)| mv)
}

/// The deepening driver: search 1..=`max_depth` under a node budget, keep the
/// last complete iteration, and report what actually happened — the moves,
/// the depth reached, the nodes consumed. One table lives across iterations
/// (its strict-depth rule keeps that sound; its best-move memory is what
/// makes deepening pay).
#[must_use]
pub fn search_root(pos: &Position, max_depth: u32, node_cap: u64) -> SearchReport {
    let mut tt = Table::new();
    let mut budget = NodeBudget::of(node_cap);
    let deepened = deepen(max_depth, |d| {
        move_scores_with(pos, d, &mut tt, &mut budget)
    });
    match deepened {
        Some(d) => SearchReport {
            moves: d.result,
            depth: d.depth,
            nodes: tt.nodes(),
        },
        None => SearchReport {
            moves: Vec::new(),
            depth: 0,
            nodes: tt.nodes(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::Adversary;
    use chess_core::result;
    use chess_core::{Board, Chess};
    use rand::RngCore;
    use rand_chacha::rand_core::SeedableRng;
    use rand_chacha::ChaCha20Rng;

    fn pos_of(fen: &str) -> Position {
        Position::from_board(Board::from_fen(fen).expect("search test FEN parses"))
    }

    fn uci(pos: &Position, s: &str) -> Move {
        <Chess as Adversary>::parse_move(pos, s).expect("test move is legal")
    }

    fn score_of(scores: &[(Move, Scored)], mv: Move) -> Scored {
        scores
            .iter()
            .find(|(m, _)| *m == mv)
            .map(|&(_, s)| s)
            .expect("move present at the root")
    }

    // ---- the mate ladder (RULES §9; the wiring test is mate-in-two) ----

    #[test]
    fn mate_in_one_is_found_and_exact() {
        // Back-rank: Re8# against f7/g7/h7 pawns.
        let pos = pos_of("6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1");
        let scores = move_scores(&pos, 2);
        let mate = score_of(&scores, uci(&pos, "e1e8"));
        assert!(mate.value >= MATE, "a mate scores as a mate");
        assert!(mate.exact, "and is proven");
        assert_eq!(best_move(&pos, 2), Some(uci(&pos, "e1e8")));
    }

    #[test]
    #[cfg_attr(
        debug_assertions,
        ignore = "release only: a depth-4 ladder in debug is minutes"
    )]
    fn mate_in_two_is_found_and_exact() {
        // The rook ladder: 1.Rb7 (any) 2.Ra8#.
        let pos = pos_of("7k/8/R7/1R6/8/8/8/6K1 w - - 0 1");
        let scores = move_scores(&pos, 4);
        let ladder = score_of(&scores, uci(&pos, "b5b7"));
        assert!(ladder.value >= MATE, "the ladder is a proven win");
        assert!(ladder.exact);
        // The principal-path edge: a quiet king move's subtree is heuristic at
        // this depth, so its root score is NOT exact — one proven child
        // elsewhere in the tree must not leak the flag.
        let quiet = score_of(&scores, uci(&pos, "g1g2"));
        assert!(!quiet.exact, "a heuristic line stays unproven");
    }

    #[test]
    #[cfg_attr(debug_assertions, ignore = "release only: depth 6 in debug is minutes")]
    fn mate_in_three_is_found_and_shorter_mates_are_preferred() {
        // One rank further back: three plies of ladder.
        let pos = pos_of("7k/8/8/R7/1R6/8/8/6K1 w - - 0 1");
        let scores = move_scores(&pos, 6);
        let best = scores.iter().max_by_key(|&&(_, s)| s.value).expect("moves");
        assert!(best.1.value >= MATE, "the mate is found");
        assert!(best.1.exact);

        // Shorter mates outrank longer ones (MATE + remaining depth): from the
        // mate-in-1 position, the immediate mate must beat every slower win.
        let m1 = pos_of("6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1");
        let scores = move_scores(&m1, 4);
        let immediate = score_of(&scores, uci(&m1, "e1e8"));
        for (mv, s) in &scores {
            if *mv != uci(&m1, "e1e8") {
                assert!(
                    s.value < immediate.value,
                    "{mv:?} must rank below the immediate mate"
                );
            }
        }
    }

    // ---- quiescence (the reason it exists, as a test) ----

    #[test]
    fn without_quiescence_depth_one_grabs_a_defended_pawn_and_with_it_does_not() {
        // Qe6 can take f7, defended by the f8 rook. A depth-1 search's leaf is
        // AFTER our move: with quiescence the recapture is resolved and the
        // grab is refused; the same tree cut at the static eval takes it.
        // (Phase 0's sampled positions could not discriminate — this is the
        // constructed one the plan asked for.)
        let pos = pos_of("5r1k/5p2/4Q3/8/8/8/8/7K w - - 0 1");
        let grab = uci(&pos, "e6f7");
        let with_q = move_scores(&pos, 1);
        let refused = score_of(&with_q, grab);
        let best = with_q.iter().map(|&(_, s)| s.value).max().expect("moves");
        assert!(
            refused.value < best,
            "with quiescence the defended-pawn grab is not the best move"
        );
        // The same judgement without quiescence: the raw static eval after the
        // grab REWARDS it (a pawn up, recapture invisible) — the horizon lie
        // quiescence exists to prevent.
        let after_grab = pos.play(grab);
        assert!(
            heuristic(&after_grab) < 0,
            "static eval after the grab reads pawn-up for the mover (negated view)"
        );
        let resolved = qsearch(
            &after_grab,
            -INFINITY,
            INFINITY,
            &mut Table::new(),
            &mut NodeBudget::unlimited(),
        )
        .expect("unlimited");
        assert!(
            resolved.value > 300,
            "quiescence resolves the recapture: the opponent stands a rook-for-pawn better"
        );
    }

    #[test]
    fn quiescence_stands_pat_on_a_quiet_position() {
        let quiet = pos_of("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
        let q = qsearch(
            &quiet,
            -INFINITY,
            INFINITY,
            &mut Table::new(),
            &mut NodeBudget::unlimited(),
        )
        .expect("unlimited");
        assert_eq!(
            q.value,
            heuristic(&quiet),
            "no captures: exactly the static eval"
        );
        // One standing capture: the better of stand-pat and the capture line.
        let one = pos_of("4k3/8/8/3p4/4B3/8/8/4K3 w - - 0 1");
        let q = qsearch(
            &one,
            -INFINITY,
            INFINITY,
            &mut Table::new(),
            &mut NodeBudget::unlimited(),
        )
        .expect("unlimited");
        assert!(q.value >= heuristic(&one), "a free pawn can only help");
    }

    // ---- the independent cross-check (the only thing that makes the
    // alpha-beta a claim) ----

    /// Plain negamax: no alpha-beta, no table — only the same quiescence at
    /// the horizon, so the two searches differ exactly by the machinery under
    /// test.
    fn ref_minimax(pos: &Position, depth: u32) -> i32 {
        if let Some(res) = result(pos) {
            return terminal_value(res, pos, depth);
        }
        if depth == 0 {
            return qsearch(
                pos,
                -INFINITY,
                INFINITY,
                &mut Table::new(),
                &mut NodeBudget::unlimited(),
            )
            .expect("unlimited")
            .value;
        }
        legal_moves(&pos.board)
            .into_iter()
            .map(|mv| -ref_minimax(&pos.play(mv), depth - 1))
            .max()
            .expect("non-terminal has moves")
    }

    #[test]
    #[cfg_attr(debug_assertions, ignore = "release only: 20 full-width searches")]
    fn alpha_beta_agrees_with_a_plain_minimax_on_twenty_positions() {
        // The reference minimax is full-width, so its cost is
        // branching^depth x quiescence. Measured 2026-08-30: depth 3 over 20
        // sampled positions was 123 s (and sampling later plies made it 218 s
        // — random play does not shed material). The sweep therefore runs at
        // depth 2, which exercises the identical window/table/ordering code
        // paths, and one fixed small-branching endgame keeps a depth-3
        // datapoint below.
        let mut rng = ChaCha20Rng::seed_from_u64(0xC4E5);
        let mut checked = 0;
        while checked < 20 {
            let plies = 10 + (rng.next_u32() % 21) as usize;
            let mut pos = Position::start();
            let mut live = true;
            for _ in 0..plies {
                let legal = legal_moves(&pos.board);
                if result(&pos).is_some() || legal.is_empty() {
                    live = false;
                    break;
                }
                pos = pos.play(legal[(rng.next_u32() as usize) % legal.len()]);
            }
            if !live || result(&pos).is_some() {
                continue;
            }
            for (mv, scored) in move_scores(&pos, 2) {
                let reference = -ref_minimax(&pos.play(mv), 1);
                assert_eq!(
                    scored.value, reference,
                    "position {checked}, move {mv:?}: alpha-beta vs plain minimax"
                );
            }
            checked += 1;
        }
        // The depth-3 datapoint, on a branching-poor board where full width
        // is affordable.
        let endgame = pos_of("8/8/4k3/8/8/4K3/4R3/8 w - - 0 1");
        for (mv, scored) in move_scores(&endgame, 3) {
            let reference = -ref_minimax(&endgame.play(mv), 2);
            assert_eq!(scored.value, reference, "endgame depth 3, move {mv:?}");
        }
    }

    // ---- budgets: whole iterations or nothing ----

    #[test]
    fn zero_budget_never_returns_partial() {
        let report = search_root(&Position::start(), 4, 0);
        assert_eq!(report.depth, 0, "nothing completed");
        assert!(report.moves.is_empty(), "and nothing partial is returned");
        // A small budget completes some depth < max and says which.
        let small = search_root(&Position::start(), 6, 5_000);
        assert!(
            small.depth >= 1,
            "a small budget still finishes shallow depths"
        );
        assert!(small.depth < 6, "and honestly reports falling short");
        assert_eq!(
            small.moves.len(),
            20,
            "with every root move valued at that depth"
        );
        // The unlimited-shape run reaches the asked depth.
        let full = search_root(&Position::start(), 3, u64::MAX);
        assert_eq!(full.depth, 3);
        assert!(full.nodes > 0, "nodes are counted");
    }

    #[test]
    #[cfg_attr(debug_assertions, ignore = "release only: Kiwipete searches")]
    fn a_table_polluted_by_an_exhausted_run_does_not_change_results() {
        // Run out of budget mid-search, then reuse the same table for a full
        // search: the values must equal a fresh-table search's exactly (the
        // table changes speed, never results — and an aborted iteration must
        // not have stored anything that lies).
        let pos = pos_of("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
        let mut polluted = Table::new();
        let aborted = move_scores_with(&pos, 4, &mut polluted, &mut NodeBudget::of(2_000));
        assert!(aborted.is_none(), "the tiny budget must bite mid-iteration");
        let with_polluted =
            move_scores_with(&pos, 3, &mut polluted, &mut NodeBudget::unlimited()).expect("runs");
        let fresh = move_scores_with(&pos, 3, &mut Table::new(), &mut NodeBudget::unlimited())
            .expect("runs");
        assert_eq!(with_polluted, fresh);
    }

    // ---- draw handling in the tree ----

    #[test]
    #[cfg_attr(
        debug_assertions,
        ignore = "release only: two depth-4 endgame searches"
    )]
    fn the_clock_bucket_keeps_positions_with_different_clocks_apart() {
        // Identical placement, halfmove 10 vs 98. At 98 every quiet line hits
        // the 50-move draw within two plies and there is no mate that fast,
        // so the best value collapses to the draw; at 10 White is simply a
        // rook up. One table serves both searches — a conflating key would
        // leak the draw into the healthy position.
        let fresh = pos_of("k7/8/8/8/8/8/1R6/1K6 w - - 10 30");
        let stale = pos_of("k7/8/8/8/8/8/1R6/1K6 w - - 98 30");
        let mut tt = Table::new();
        let fresh_scores =
            move_scores_with(&fresh, 4, &mut tt, &mut NodeBudget::unlimited()).expect("runs");
        let stale_scores =
            move_scores_with(&stale, 4, &mut tt, &mut NodeBudget::unlimited()).expect("runs");
        let fresh_best = fresh_scores
            .iter()
            .map(|&(_, s)| s.value)
            .max()
            .expect("moves");
        let stale_best = stale_scores
            .iter()
            .map(|&(_, s)| s.value)
            .max()
            .expect("moves");
        assert!(fresh_best > 300, "at clock 10 the rook-up value shows");
        assert_eq!(stale_best, 0, "at clock 98 everything drains to the draw");
        let stale_exact = stale_scores
            .iter()
            .map(|&(_, s)| s)
            .max_by_key(|s| s.value)
            .expect("moves");
        assert!(
            stale_exact.exact,
            "a clock draw inside the tree is a proven class"
        );
    }

    #[test]
    fn a_third_occurrence_in_the_tree_is_an_exact_draw_and_a_second_is_not() {
        // The D4a shuffle, stopped two plies short: searching from here, the
        // line h2h1 → a7a8 reaches the start's third occurrence — an exact
        // draw the defender (down a rook) gladly takes.
        let start = pos_of("k7/8/8/8/8/8/8/K6R w - - 0 1");
        let mut pos = start;
        for text in ["h1h2", "a8a7", "h2h1", "a7a8", "h1h2", "a8a7"] {
            pos = pos.play(uci(&pos, text));
        }
        let scores = move_scores(&pos, 2);
        let into_rep = score_of(&scores, uci(&pos, "h2h1"));
        assert_eq!(into_rep.value, 0, "the defender chooses the repetition");
        assert!(into_rep.exact, "and it is a proven draw");
        // Two plies earlier the same line is only a SECOND occurrence: live,
        // and the search must not call it a draw.
        let mut earlier = start;
        for text in ["h1h2", "a8a7"] {
            earlier = earlier.play(uci(&earlier, text));
        }
        let scores = move_scores(&earlier, 2);
        let not_yet = score_of(&scores, uci(&earlier, "h2h1"));
        assert!(
            !(not_yet.value == 0 && not_yet.exact),
            "a second occurrence is not a proven draw"
        );
    }

    #[test]
    fn a_repetition_value_is_never_stored_in_the_table() {
        // Search the position where the repetition is reachable; every stored
        // entry must then be reusable — probe the table's soundness by
        // re-searching with the polluted table and comparing to fresh.
        let start = pos_of("k7/8/8/8/8/8/8/K6R w - - 0 1");
        let mut pos = start;
        for text in ["h1h2", "a8a7", "h2h1", "a7a8", "h1h2", "a8a7"] {
            pos = pos.play(uci(&pos, text));
        }
        let mut tt = Table::new();
        let first = move_scores_with(&pos, 3, &mut tt, &mut NodeBudget::unlimited()).expect("runs");
        // A DIFFERENT position with the same placements but a fresh history:
        // the repetition is no longer two plies away, so any leaked
        // repetition-draw entry would misvalue it.
        let fresh_history = Position::from_board(pos.board);
        let with_table = move_scores_with(&fresh_history, 3, &mut tt, &mut NodeBudget::unlimited())
            .expect("runs");
        let without = move_scores_with(
            &fresh_history,
            3,
            &mut Table::new(),
            &mut NodeBudget::unlimited(),
        )
        .expect("runs");
        assert_eq!(with_table, without, "no path-dependent entry leaked");
        let _ = first;
    }

    // ---- the table is a cache, not part of the answer ----

    #[test]
    #[cfg_attr(debug_assertions, ignore = "release only: an untabled midgame search")]
    fn the_table_changes_speed_never_results() {
        let pos = pos_of("r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQ1RK1 w - - 2 7");
        let with = move_scores_with(&pos, 3, &mut Table::new(), &mut NodeBudget::unlimited())
            .expect("runs");
        let without = move_scores_with(
            &pos,
            3,
            &mut Table::disabled(),
            &mut NodeBudget::unlimited(),
        )
        .expect("runs");
        assert_eq!(with, without);
    }
}
