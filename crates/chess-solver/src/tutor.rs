//! Engine-grounded tutor facts — the ground truth the tutor panel (and an LLM
//! narrator) surfaces. Every fact comes from the search, so it cannot be
//! wrong about what it claims.
//!
//! Chess takes checkers' honesty shape: exactness is a property of a *move's*
//! value (a proven terminal on its line), never of the position, so grading a
//! move a `Blunder` needs **two** proofs — this move's class and the best
//! move's. Everything unproven grades `ResultPreserving` at worst: the tutor
//! says "there was better", never "that threw the game", because early on it
//! does not know.

use adversary_core::MatchResult;
use chess_core::board::kind_of;
use chess_core::{attacked, king_square, result, san_of, PieceKind, Position};

use crate::live::Level;
use crate::search::search_root;

/// Search ceiling for the tutor panel — one ply deeper than the strongest
/// opponent, because the panel is opened deliberately, once, and is the only
/// surface allowed to say a move threw the game.
const TUTOR_DEPTH: u32 = Level::Expert.depth() + 1;

/// The panel's node budget. Chromium at ~730k nps (Phase 4's table) makes
/// this a worst case well under a second — a panel, not a hang.
const TUTOR_BUDGET: u64 = 600_000;

/// Search ceiling for the **per-move** coach — the note about the move just
/// tapped, which sits on the tap path and shares Hard's measured budget.
const COACH_DEPTH: u32 = Level::Hard.depth();

/// The coach's node budget (= Hard's, 170 ms worst in Chromium).
const COACH_BUDGET: u64 = Level::Hard.budget();

// The relationships the two surfaces depend on, checked by the compiler.
const _: () = assert!(
    TUTOR_DEPTH > Level::Expert.depth(),
    "the tutor panel must search deeper than the strongest opponent"
);
const _: () = assert!(
    COACH_DEPTH < TUTOR_DEPTH,
    "the per-move coach is on the tap path and must be cheaper than the panel"
);

/// A move's quality relative to the position's best move.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveClass {
    /// Achieves the position's best value.
    Optimal,
    /// Not the best value, but does not provably drop the win/draw/loss class.
    ResultPreserving,
    /// Provably drops the class — only reachable when both values are proven.
    Blunder,
}

/// One legal move's engine-grounded tutor facts.
// The booleans are the shared `TutorFactMove` wire shape plus chess's own
// one-ply facts — each is a distinct fact the panel and the hybrid band read
// by name, not a state machine in disguise.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TutorMove {
    /// The packed move code. Named `col` for the shared `TutorFactMove` wire
    /// shape all the shelf bindings speak; for chess it is a 15-bit
    /// `(from, to, promo)` code, not a column.
    pub col: u16,
    /// The move in SAN — what a player reads (`Nf3`, `exd8=Q#`).
    pub san: String,
    /// This move's value (side-to-move perspective; higher is better).
    pub value: i32,
    /// The best value available in the position.
    pub best_value: i32,
    /// How far below `best_value` this move is (`0` = optimal).
    pub regret: i32,
    /// This move's quality relative to the best move.
    pub quality: MoveClass,
    /// Whether this move's value is a **proven** one. Per move, not per position.
    pub exact: bool,
    /// This move mates on the spot (the shared band's one-ply boolean).
    pub immediate_win: bool,
    /// Carried `false`: chess has no one-ply "blocks the opponent's win" fact
    /// (the shared `TutorFactMove` shape requires the field).
    pub blocks_opponent_win: bool,
    /// This move gives check.
    pub gives_check: bool,
    /// The captured piece kind (`0` none; `1..=6` = P N B R Q K cell order —
    /// an en-passant capture reads `1`).
    pub captures: u8,
    /// The promotion piece code (`0` none; `1..=4` = N B R Q).
    pub promotes: u8,
    /// This move castles.
    pub castles: bool,
}

/// The whole position's engine-grounded tutor assessment.
#[derive(Debug, Clone)]
pub struct TutorReport {
    /// One entry per legal move. Empty when the position is terminal.
    pub moves: Vec<TutorMove>,
    /// The move code achieving the best value (the first, if several tie).
    pub best_col: Option<u16>,
    /// `true` only when **every** move in the report is proven — what the UI
    /// uses to pick provable vs hedged wording for the report as a whole.
    pub exact: bool,
    /// The depth the search actually reached (a ceiling, not a promise —
    /// `docs/AI-PLAYERS.md`'s deepening rule; rides onto the wasm JSON).
    pub depth: u32,
    /// Search nodes consumed.
    pub nodes: u64,
}

/// Grade `value` against `best`: equal is `Optimal`; a `Blunder` requires
/// both values proven **and** a class drop; everything else preserves.
fn quality(value: i32, value_exact: bool, best: i32, best_exact: bool) -> MoveClass {
    if value == best {
        return MoveClass::Optimal;
    }
    if !(value_exact && best_exact) {
        return MoveClass::ResultPreserving;
    }
    if value.signum() == best.signum() {
        MoveClass::ResultPreserving
    } else {
        MoveClass::Blunder
    }
}

/// The [`TutorReport`] at the **panel** budget.
#[must_use]
pub fn assess(pos: &Position) -> TutorReport {
    assess_at(pos, TUTOR_DEPTH, TUTOR_BUDGET)
}

/// The [`TutorReport`] at the **per-move coach** budget — cheap enough for
/// the tap path.
#[must_use]
pub fn assess_for_move(pos: &Position) -> TutorReport {
    assess_at(pos, COACH_DEPTH, COACH_BUDGET)
}

fn assess_at(pos: &Position, depth: u32, budget: u64) -> TutorReport {
    let report = search_root(pos, depth, budget);
    let Some(&(_, best)) = report.moves.iter().max_by_key(|&&(_, s)| s.value) else {
        return TutorReport {
            moves: Vec::new(),
            best_col: None,
            exact: false,
            depth: report.depth,
            nodes: report.nodes,
        };
    };

    let board = &pos.board;
    let moves: Vec<TutorMove> = report
        .moves
        .iter()
        .map(|&(mv, s)| {
            let after = pos.play(mv);
            let mover = board.side;
            let immediate_win = match result(&after) {
                Some(MatchResult::WinA) => mover == chess_core::Color::White,
                Some(MatchResult::WinB) => mover == chess_core::Color::Black,
                _ => false,
            };
            let gives_check = attacked(
                &after.board,
                king_square(&after.board, after.board.side),
                mover,
            );
            let is_ep = kind_of(board.cells[usize::from(mv.from)]) == Some(PieceKind::Pawn)
                && board.cells[usize::from(mv.to)] == 0
                && mv.from % 8 != mv.to % 8;
            let captures = if is_ep {
                1
            } else {
                board.cells[usize::from(mv.to)] & 7
            };
            let castles = kind_of(board.cells[usize::from(mv.from)]) == Some(PieceKind::King)
                && mv.to.abs_diff(mv.from) == 2;
            TutorMove {
                col: mv.code(),
                san: san_of(pos, mv),
                value: s.value,
                best_value: best.value,
                regret: best.value - s.value,
                quality: quality(s.value, s.exact, best.value, best.exact),
                exact: s.exact,
                immediate_win,
                blocks_opponent_win: false,
                gives_check,
                captures,
                promotes: mv.promo,
                castles,
            }
        })
        .collect();

    let best_col = moves.iter().find(|m| m.value == best.value).map(|m| m.col);
    TutorReport {
        exact: moves.iter().all(|m| m.exact),
        best_col,
        moves,
        depth: report.depth,
        nodes: report.nodes,
    }
}

/// The one-line coach verdict for a played move, **bound to `exact`**: "threw
/// the game" only when the drop is proven (a `Blunder`), a hedge for a large
/// unproven regret, silence when there is nothing honest to flag.
#[must_use]
pub fn coach_line(m: &TutorMove) -> Option<String> {
    match m.quality {
        MoveClass::Blunder => Some(format!(
            "{} threw the game — the position was provably better.",
            m.san
        )),
        _ if !m.exact && m.regret >= 300 => Some(format!(
            "{} looks risky — the engine saw a stronger line.",
            m.san
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::Adversary;
    use chess_core::{Board, Chess};

    fn pos_of(fen: &str) -> Position {
        Position::from_board(Board::from_fen(fen).expect("tutor test FEN parses"))
    }

    #[test]
    #[cfg_attr(
        debug_assertions,
        ignore = "release only: a budgeted d4 search in debug"
    )]
    fn the_opening_is_capped_and_never_grades_a_blunder() {
        // The invariant hedged wording rests on: a heuristic proves no class.
        let report = assess_for_move(&<Chess as Adversary>::initial(0));
        assert_eq!(report.moves.len(), 20);
        assert!(!report.exact, "nothing is proven this early");
        assert!(report.moves.iter().all(|m| m.quality != MoveClass::Blunder));
        assert!(report.best_col.is_some());
        assert!(
            report.depth >= 1 && report.nodes > 0,
            "the report says what it did"
        );
    }

    #[test]
    fn a_mate_in_one_is_proven_immediate_and_optimal() {
        let report = assess_for_move(&pos_of("6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1"));
        let mate = report
            .moves
            .iter()
            .find(|m| m.immediate_win)
            .expect("the mate is flagged immediate");
        assert!(mate.exact, "a mate on the spot is proven");
        assert_eq!(mate.quality, MoveClass::Optimal);
        assert_eq!(
            report.best_col,
            Some(mate.col),
            "best_col names the best move"
        );
        assert_eq!(mate.san, "Re8#");
        assert!(mate.gives_check, "a mate is a check");
    }

    #[test]
    fn the_one_ply_facts_read_from_the_board() {
        // A capture, a check, a castle, a promotion — each from a position
        // where the fact is unambiguous.
        let cap = assess_for_move(&pos_of("k7/8/8/3q4/4P3/8/8/K7 w - - 0 1"));
        let take = cap
            .moves
            .iter()
            .find(|m| m.captures != 0)
            .expect("exd5 exists");
        assert_eq!(take.captures, 5, "a queen is taken (kind 5)");
        assert_eq!(take.san, "exd5");

        let castle = assess_for_move(&pos_of("4k3/8/8/8/8/8/8/4K2R w K - 0 1"));
        let flagged: Vec<&TutorMove> = castle.moves.iter().filter(|m| m.castles).collect();
        assert_eq!(
            flagged.len(),
            1,
            "exactly the castle is flagged — no king step, no rook move"
        );
        assert_eq!(flagged[0].san, "O-O");

        let promo = assess_for_move(&pos_of("7k/4P3/8/8/8/8/8/4K3 w - - 0 1"));
        assert_eq!(
            promo.moves.iter().filter(|m| m.promotes != 0).count(),
            4,
            "the four promotions carry their piece"
        );

        let check = assess_for_move(&pos_of("4k3/8/8/8/8/8/8/4K2R w - - 0 1"));
        let rook_check = check
            .moves
            .iter()
            .find(|m| m.san == "Rh8+")
            .expect("Rh8+ is in the report");
        assert!(rook_check.gives_check);

        // En passant reads as a pawn capture (kind 1), and regret is the gap
        // to the best value on every entry.
        let start = pos_of("4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1");
        let push = <Chess as Adversary>::parse_move(&start, "d7d5").expect("legal");
        let ep_report = assess_for_move(&<Chess as Adversary>::apply(&start, push));
        let ep = ep_report
            .moves
            .iter()
            .find(|m| m.san == "exd6")
            .expect("exd6 offered");
        assert_eq!(ep.captures, 1);
        for m in &ep_report.moves {
            assert_eq!(m.regret, m.best_value - m.value);
        }

        // A BLACK mate in one is flagged immediate too (the other arm).
        let black = assess_for_move(&pos_of("kr6/8/8/8/8/8/r7/6K1 b - - 0 1"));
        let mate = black
            .moves
            .iter()
            .find(|m| m.immediate_win)
            .expect("Rb1# flagged");
        assert_eq!(mate.san, "Rb1#");
    }

    #[test]
    fn coach_for_the_three_branches() {
        // Branch 1 — "threw the game" needs a proven Blunder, both values
        // proven: stated at the seam like checkers, because a real reachable
        // double-proof is vanishingly rare in an unsolved game.
        let blunder = TutorMove {
            col: 0,
            san: "Kb1".into(),
            value: -(crate::eval::MATE + 2),
            best_value: 0,
            regret: crate::eval::MATE + 2,
            quality: quality(-(crate::eval::MATE + 2), true, 0, true),
            exact: true,
            immediate_win: false,
            blocks_opponent_win: false,
            gives_check: false,
            captures: 0,
            promotes: 0,
            castles: false,
        };
        assert_eq!(blunder.quality, MoveClass::Blunder);
        let line = coach_line(&blunder).expect("a proven throw is called out");
        assert!(line.contains("threw the game"), "{line}");

        // Branch 2 — hedged for a big unproven regret.
        let risky = TutorMove {
            regret: 450,
            exact: false,
            quality: MoveClass::ResultPreserving,
            ..blunder.clone()
        };
        let line = coach_line(&risky).expect("a big unproven regret is hedged");
        assert!(line.contains("looks risky"), "{line}");
        assert!(
            !line.contains("threw"),
            "an unproven drop must never claim a throw"
        );

        // Branch 3 — silence when there is nothing honest to flag.
        let fine = TutorMove {
            regret: 40,
            exact: false,
            quality: MoveClass::ResultPreserving,
            ..blunder
        };
        assert_eq!(coach_line(&fine), None);
    }

    #[test]
    fn a_blunder_needs_both_values_proven() {
        // The seam test, every combination (checkers' shape).
        assert_eq!(quality(5, true, 5, true), MoveClass::Optimal);
        assert_eq!(
            quality(-9_000, false, 9_000, false),
            MoveClass::ResultPreserving
        );
        assert_eq!(
            quality(-9_000, true, 9_000, false),
            MoveClass::ResultPreserving
        );
        assert_eq!(
            quality(-9_000, false, 9_000, true),
            MoveClass::ResultPreserving
        );
        let mate = crate::eval::MATE + 1;
        assert_eq!(quality(-mate, true, mate, true), MoveClass::Blunder);
        assert_eq!(
            quality(-mate, true, 0, true),
            MoveClass::Blunder,
            "win to loss via draw class"
        );
        assert_eq!(
            quality(100, true, 9_000, true),
            MoveClass::ResultPreserving,
            "same class, worse value"
        );
    }

    #[test]
    fn a_terminal_position_assesses_to_nothing() {
        let report = assess_for_move(&pos_of("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"));
        assert!(report.moves.is_empty());
        assert_eq!(report.best_col, None);
        assert!(!report.exact, "an empty report claims nothing");
    }
}
