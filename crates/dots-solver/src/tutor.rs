//! Engine-grounded coaching, with every claim bound to whether it is proven.
//!
//! The tutor is a Tier-1 feature, not a language-model feature: a strong move
//! here is a computable fact, so the coaching ships with no model involved. What
//! the model may later do is *narrate* these facts.
//!
//! ## The honesty gate
//!
//! Dots and Boxes is not solved from the opening within a browser's budget, so
//! above [`TRACTABLE_EDGES`](crate::search::TRACTABLE_EDGES) the values are a
//! depth-capped search's and prove nothing. [`coach_line`] may therefore say a
//! move **threw the game** only when the facts are `exact`; otherwise it hedges.
//! The wording is bound to the flag by [`coach_line`] and pinned by tests, so the
//! two cannot drift apart.
//!
//! ## Two budgets, not one
//!
//! The per-move coach runs on **every tap** and must stay cheap; the tutor panel
//! is opened deliberately and can afford a deeper look. Sharing one budget puts
//! the panel's cost on every tap — the mistake checkers made and then split, and
//! the reason [`COACH_DEPTH`] and [`TUTOR_DEPTH`] are separate constants.

use dots_core::{apply_move, completed_boxes, legal_edges, Board, Edge, BOXES};

use crate::live::class_of;
use crate::search::move_values;

/// Depth for the per-tap coach. Cheap: it runs on every move the player makes.
pub const COACH_DEPTH: u32 = 4;

/// Depth for the deliberately-opened tutor panel. Deeper, because depth is what
/// buys proofs and the panel is the only surface allowed to claim one.
pub const TUTOR_DEPTH: u32 = 8;

/// Budgeting the panel separately from the tap path is the point: if these ever
/// converge, every tap starts paying the panel's bill. Asserted at compile time
/// rather than in a test, because a test of two constants is one clippy is right
/// to call out as having a constant value.
const _: () = assert!(TUTOR_DEPTH > COACH_DEPTH);

/// Boxes needed to make the result arithmetically certain (a majority of nine).
const MAJORITY: u8 = (BOXES as u8 / 2) + 1;

/// A move's quality relative to the position's best move.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveClass {
    /// Achieves the position's best value.
    Optimal,
    /// Keeps the same win/loss class as best, but is not the best value.
    ResultPreserving,
    /// Drops the win/loss class.
    Blunder,
}

/// One legal move's engine-grounded facts.
///
/// A structural superset of the shared `TutorFactMove` the hybrid player's band
/// builder consumes, so `hybrid-player.ts` is reused unchanged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TutorMove {
    /// The edge this move draws.
    pub edge: Edge,
    /// The move's value: a final box margin when `exact`, a depth-capped score
    /// otherwise. Higher is better, from the mover's perspective.
    pub value: i32,
    /// The best value available in the position.
    pub best_value: i32,
    /// How far below `best_value` this move is (`0` = optimal).
    pub regret: i32,
    /// Quality relative to the best move.
    pub quality: MoveClass,
    /// This move settles the game now — it takes the mover to a majority of the
    /// nine boxes, which no later play can overturn. One-ply, so always exact.
    pub immediate_win: bool,
    /// Carried as `false`: this game has no "block the opponent's winning move"
    /// notion, because a box is claimed by whoever closes it and cannot be
    /// defended. §10 says to carry the Drop-4-flavoured one-ply facts as `false`
    /// where the notion does not exist rather than inventing an analogue.
    pub blocks_opponent_win: bool,
    /// This game's own one-line reason, so the shared banter fallback is not the
    /// only thing a persona can say. Without it every band move reads "your
    /// strongest line" and the engine's actual insight is dropped on the floor.
    pub idea: String,
}

/// The whole position's assessment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TutorReport {
    /// One entry per legal move; empty when the position is terminal.
    pub moves: Vec<TutorMove>,
    /// The edge achieving `best_value` (the first, if several tie).
    pub best_edge: Option<Edge>,
    /// `true` when the facts are the exact solver's, so a value's sign is a
    /// **proven** class. `false` when they are the depth-capped search's.
    pub exact: bool,
}

/// How many boxes drawing `mv` hands to the **opponent** on their next move: the
/// boxes it leaves standing at three sides.
#[must_use]
fn gives_away(pos: &Board, mv: Edge) -> u32 {
    let after = apply_move(pos, mv);
    if after.to_move == pos.to_move {
        // The mover captured and keeps the turn, so anything at three sides is
        // still theirs to take, not a gift.
        return 0;
    }
    let mut n = 0;
    for e in 0..dots_core::EDGES {
        if !after.is_drawn(e) {
            n += completed_boxes(after.edges, e).count_ones();
        }
    }
    n
}

/// Whether `mv` takes the mover to a majority of the boxes, settling the result.
#[must_use]
fn settles_the_game(pos: &Board, mv: Edge) -> bool {
    let after = apply_move(pos, mv);
    let (a, b) = after.box_counts();
    let mine = match pos.to_move {
        adversary_core::Side::A => a,
        adversary_core::Side::B => b,
    };
    mine >= MAJORITY
}

/// The game's own one-line reason for a move.
#[must_use]
fn idea_for(pos: &Board, mv: Edge) -> String {
    let captures = completed_boxes(pos.edges, mv.0 as usize).count_ones();
    let handed = gives_away(pos, mv);
    match (captures, handed) {
        (2, _) => "closes two boxes with one edge, and you move again".to_string(),
        (1, _) => "closes a box, and you move again".to_string(),
        (_, 0) => "safe: leaves no box on three sides".to_string(),
        (_, 1) => "hands over one box".to_string(),
        (_, n) => format!("hands over {n} boxes"),
    }
}

/// Grade `value` against the position's `best`.
#[must_use]
fn quality(value: i32, best: i32) -> MoveClass {
    if value == best {
        MoveClass::Optimal
    } else if class_of(value) == class_of(best) {
        MoveClass::ResultPreserving
    } else {
        MoveClass::Blunder
    }
}

/// The coach's sentence about a move, **bound to `exact`**.
///
/// The whole point: a blunder may be called out as having *thrown the game* only
/// when the facts prove it. A depth-capped search proves nothing, so it hedges.
/// Never fake an exact verdict from a heuristic.
#[must_use]
pub fn coach_line(quality: MoveClass, exact: bool) -> &'static str {
    match (quality, exact) {
        (MoveClass::Optimal, _) => "That is the best edge available.",
        (MoveClass::ResultPreserving, true) => {
            "Sound — it keeps the result, though a tighter edge existed."
        }
        (MoveClass::ResultPreserving, false) => "Reasonable, as far as the engine can see.",
        (MoveClass::Blunder, true) => "That threw the game.",
        (MoveClass::Blunder, false) => "That looks risky.",
    }
}

/// Assess every legal move in `pos`, searching to `capped_depth` when the
/// position is above the exact threshold.
///
/// Never panics; a terminal position yields an empty report.
#[must_use]
pub fn assess(pos: &Board, capped_depth: u32) -> TutorReport {
    let moves = legal_edges(pos);
    if moves.is_empty() {
        return TutorReport {
            moves: Vec::new(),
            best_edge: None,
            exact: false,
        };
    }
    let (values, exact) = move_values(pos, capped_depth);
    let best_value = values.iter().map(|&(_, v)| v).max().unwrap_or(0);
    let best_edge = values
        .iter()
        .find(|&&(_, v)| v == best_value)
        .map(|&(m, _)| m);

    let facts = values
        .iter()
        .map(|&(mv, value)| TutorMove {
            edge: mv,
            value,
            best_value,
            regret: best_value - value,
            quality: quality(value, best_value),
            immediate_win: settles_the_game(pos, mv),
            blocks_opponent_win: false,
            idea: idea_for(pos, mv),
        })
        .collect();

    TutorReport {
        moves: facts,
        best_edge,
        exact,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::{Adversary, Side};
    use dots_core::{v_edge, Dots, ALL_EDGES};

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
    fn coach_wording_is_bound_to_the_exact_flag() {
        // The honesty gate, asserted on the function directly. Above the exact
        // threshold no real position can produce a proven blunder, so testing
        // this through a played position would leave half the table unreached --
        // the same reason `dots_core::result_of` is a free function.
        assert_eq!(
            coach_line(MoveClass::Blunder, true),
            "That threw the game.",
            "a proven blunder may be named"
        );
        assert_eq!(
            coach_line(MoveClass::Blunder, false),
            "That looks risky.",
            "an unproven blunder must hedge"
        );
        assert_ne!(
            coach_line(MoveClass::Blunder, true),
            coach_line(MoveClass::Blunder, false),
            "the two cases must not collapse into one sentence"
        );
    }

    #[test]
    fn no_wording_claims_a_result_without_the_proof() {
        for quality in [
            MoveClass::Optimal,
            MoveClass::ResultPreserving,
            MoveClass::Blunder,
        ] {
            let hedged = coach_line(quality, false);
            assert!(
                !hedged.contains("threw"),
                "{quality:?} must not claim a thrown game from a capped search: {hedged}"
            );
        }
    }

    #[test]
    fn a_terminal_position_assesses_to_an_empty_report() {
        let done = from_open(&[], Side::A);
        let report = assess(&done, COACH_DEPTH);
        assert!(report.moves.is_empty());
        assert_eq!(report.best_edge, None);
        assert!(!report.exact, "no facts means nothing was proven");
    }

    #[test]
    fn every_legal_move_is_assessed_and_the_best_is_optimal() {
        let pos = from_open(&(6..24).collect::<Vec<_>>(), Side::A);
        let report = assess(&pos, COACH_DEPTH);
        assert_eq!(report.moves.len(), legal_edges(&pos).len());
        let best = report.best_edge.expect("a live position has a best edge");
        let best_fact = report
            .moves
            .iter()
            .find(|m| m.edge == best)
            .expect("the best edge is among the facts");
        assert_eq!(best_fact.quality, MoveClass::Optimal);
        assert_eq!(best_fact.regret, 0);
    }

    #[test]
    fn regret_is_the_gap_to_the_best_value() {
        let pos = from_open(&(4..24).collect::<Vec<_>>(), Side::A);
        let report = assess(&pos, COACH_DEPTH);
        for m in &report.moves {
            assert_eq!(m.regret, m.best_value - m.value);
            assert!(m.regret >= 0, "no move beats the best value");
        }
    }

    #[test]
    fn the_endgame_report_is_exact_and_the_opening_is_not() {
        let opening = <Dots as Adversary>::initial(0);
        assert!(
            !assess(&opening, COACH_DEPTH).exact,
            "24 free edges proves nothing"
        );
        let endgame = from_open(&(20..24).collect::<Vec<_>>(), Side::A);
        assert!(
            assess(&endgame, COACH_DEPTH).exact,
            "four free edges is a completed exact solve"
        );
    }

    #[test]
    fn immediate_win_marks_the_move_that_secures_a_majority() {
        // A owns four boxes; one more settles it at five of nine.
        // Boxes 0 and 1 are the ones edge V(0,1) closes, so A must already own
        // four OTHER boxes -- crediting 0 and 1 up front would mean the closing
        // move gained nothing and the fixture would prove nothing.
        let mut pos = from_open(&[v_edge(0, 1)], Side::A);
        for b in 2..6 {
            pos.owners[b] = 1;
        }
        let report = assess(&pos, COACH_DEPTH);
        let closing = report
            .moves
            .iter()
            .find(|m| m.edge == Edge(v_edge(0, 1) as u8))
            .expect("the closing edge is assessed");
        assert!(
            closing.immediate_win,
            "closing two more boxes takes A past a majority"
        );
    }

    #[test]
    fn blocks_opponent_win_is_always_false_and_says_why() {
        let pos = from_open(&(8..24).collect::<Vec<_>>(), Side::A);
        let report = assess(&pos, COACH_DEPTH);
        assert!(
            report.moves.iter().all(|m| !m.blocks_opponent_win),
            "a box cannot be defended, so the notion does not exist here"
        );
    }

    #[test]
    fn a_capturing_move_reads_as_a_capture_and_keeps_the_turn() {
        // Only the shared edge is open, so drawing it closes BOTH boxes it
        // borders. Leaving another of box 0's edges open too would drop this to a
        // single capture -- which is what a first version of this fixture did.
        let pos = from_open(&[v_edge(0, 1)], Side::A);
        let report = assess(&pos, COACH_DEPTH);
        let capture = report
            .moves
            .iter()
            .find(|m| m.edge == Edge(v_edge(0, 1) as u8))
            .expect("assessed");
        assert!(
            capture.idea.contains("two boxes"),
            "the shared edge closes both: {}",
            capture.idea
        );
        assert!(capture.idea.contains("move again"));
    }

    #[test]
    fn a_quiet_move_reads_as_safe_and_a_giving_move_names_the_cost() {
        let empty = <Dots as Adversary>::initial(0);
        let report = assess(&empty, 2);
        assert!(
            report.moves.iter().all(|m| m.idea.contains("safe")),
            "no opening edge can leave a box on three sides"
        );

        // One edge short of a third side on box 0: drawing it hands the box over.
        let pos = from_open(&[0, 3, 12, 13, 14], Side::A);
        let report = assess(&pos, COACH_DEPTH);
        let giving = report
            .moves
            .iter()
            .find(|m| m.idea.contains("hands over"))
            .expect("some move must hand a box over here");
        assert!(giving.idea.contains("box"), "{}", giving.idea);
    }

    #[test]
    fn gives_away_is_zero_when_the_mover_keeps_the_turn() {
        // A capture keeps the turn, so boxes left on three sides are still the
        // mover's to take -- not a gift. The distinction is easy to get backwards.
        let pos = from_open(&[v_edge(0, 1), v_edge(1, 1)], Side::A);
        let capture = Edge(v_edge(0, 1) as u8);
        assert_eq!(gives_away(&pos, capture), 0);
    }
}
