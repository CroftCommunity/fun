//! Engine-grounded coaching, with every claim bound to whether it is proven.
//!
//! The tutor is a Tier-1 feature, not a language-model feature: a strong move
//! here is a computable fact, so the coaching ships with no model involved. What
//! a model may later do is *narrate* these facts.
//!
//! ## The honesty gate matters more here than in any shelf game so far
//!
//! Phase 0 measured that **about 70% of a game sits above the exact threshold**.
//! Dots' tutor could prove nearly everything; this one proves the endgame and
//! hedges before it. [`coach_line`] may therefore say a move **threw the game**
//! only when the facts are `exact`; otherwise it hedges. The wording is bound to
//! the flag inside this crate and pinned by tests, so the two cannot drift apart
//! in a caller.
//!
//! ## Two budgets, not one
//!
//! The per-move coach runs on **every tap** and must stay cheap; the tutor panel
//! is opened deliberately and can afford a deeper look. Sharing one budget puts
//! the panel's cost on every tap — the mistake checkers made and then split, and
//! the reason [`COACH_DEPTH`] and [`TUTOR_DEPTH`] are separate constants with
//! separate budgets.

use adversary_solver::NodeBudget;
use furrow_core::{apply_move, legal_pits, Board, Pit, TOTAL_SEEDS};

use crate::search::{class_of, is_affordable, move_values, CAPPED_NODE_BUDGET, EXACT_NODE_BUDGET};

/// Depth for the per-tap coach. Cheap: it runs on every move the player makes.
///
/// Measured from the opening at 714 nodes for depth 4 — the coach's whole cost
/// above the threshold, where it runs at all.
pub const COACH_DEPTH: u32 = 4;

/// Depth for the deliberately-opened tutor panel. Deeper, because depth is what
/// buys a better answer where nothing can be proven.
pub const TUTOR_DEPTH: u32 = 10;

/// The tap path's allowance. Bounded by what a tap can afford, not by what the
/// panel can.
pub const COACH_NODE_BUDGET: u64 = CAPPED_NODE_BUDGET / 4;

/// The panel's allowance.
pub const TUTOR_NODE_BUDGET: u64 = CAPPED_NODE_BUDGET;

/// If these ever converge, every tap starts paying the panel's bill. Asserted at
/// compile time rather than in a test, because a test of two constants is one
/// clippy is right to call out as having a constant value.
const _: () = assert!(TUTOR_DEPTH > COACH_DEPTH);
const _: () = assert!(TUTOR_NODE_BUDGET > COACH_NODE_BUDGET);

/// Seeds needed to make the result arithmetically certain — a majority of 48.
const MAJORITY: u8 = TOTAL_SEEDS / 2 + 1;

/// A move's quality relative to the position's best move.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveClass {
    /// Achieves the position's best value.
    Optimal,
    /// Keeps the same win/draw/loss class as best, but is not the best value.
    ResultPreserving,
    /// Drops the class.
    Blunder,
}

/// One legal move's engine-grounded facts.
///
/// A structural superset of the shared `TutorFactMove` the hybrid player's band
/// builder consumes, so `hybrid-player.ts` is reused unchanged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TutorMove {
    /// The pit this move sows.
    pub pit: Pit,
    /// The move's value: a final seed margin when `exact`, a depth-capped score
    /// otherwise. Higher is better, from the mover's perspective.
    pub value: i32,
    /// The best value available in the position.
    pub best_value: i32,
    /// How far below `best_value` this move is (`0` = optimal).
    pub regret: i32,
    /// Quality relative to the best move.
    pub quality: MoveClass,
    /// This move settles the game now — it takes the mover past a majority of
    /// the 48 seeds, which no later play can overturn. One-ply, so always exact.
    pub immediate_win: bool,
    /// Carried as `false`: mancala has no "block the opponent's winning move"
    /// notion, because there is no single move that wins on the spot to block.
    /// §10 says to carry the Drop-4-flavoured one-ply facts as `false` where the
    /// notion does not exist rather than inventing an analogue.
    pub blocks_opponent_win: bool,
    /// This game's own one-line reason, so the shared banter fallback is not the
    /// only thing a persona can say.
    pub idea: String,
}

/// The whole position's assessment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TutorReport {
    /// One entry per legal move; empty when the position is terminal.
    pub moves: Vec<TutorMove>,
    /// The pit achieving `best_value` (the first, if several tie).
    pub best_pit: Option<Pit>,
    /// `true` when the facts are the exact solver's, so a value's sign is a
    /// **proven** class. `false` when they are the depth-capped search's.
    pub exact: bool,
}

/// Seeds `mv` banks for the mover this move, counting a capture and the sweep.
#[must_use]
fn banks(pos: &Board, mv: Pit) -> i32 {
    let me = pos.to_move;
    let after = apply_move(pos, mv);
    i32::from(after.store(me)) - i32::from(pos.store(me))
}

/// Whether `mv` leaves the turn with the mover.
#[must_use]
fn keeps_turn(pos: &Board, mv: Pit) -> bool {
    apply_move(pos, mv).to_move == pos.to_move
}

/// The largest capture the **opponent** could make in reply to `mv`.
///
/// The move's cost, stated the way a player would: what you are handing over.
#[must_use]
fn exposes(pos: &Board, mv: Pit) -> i32 {
    let after = apply_move(pos, mv);
    if after.to_move == pos.to_move {
        return 0; // the turn was kept, so there is no reply to expose anything to
    }
    crate::eval::best_capture(&after, after.to_move)
}

/// Whether `mv` takes the mover past a majority of the seeds, settling the game.
#[must_use]
fn settles_the_game(pos: &Board, mv: Pit) -> bool {
    apply_move(pos, mv).store(pos.to_move) >= MAJORITY
}

/// The game's own one-line reason for a move.
///
/// Every branch names something a mancala player would say out loud, and the
/// order is the order a player weighs them: the free turn first, then the take,
/// then the ending, then what it costs.
#[must_use]
fn idea_for(pos: &Board, mv: Pit) -> String {
    let after = apply_move(pos, mv);
    let gained = banks(pos, mv);
    let kept = keeps_turn(pos, mv);
    let handed = exposes(pos, mv);
    let ends_it = legal_pits(&after).is_empty();

    // The ending outranks the extra turn, and that order is load-bearing: a move
    // that banks your last seed both lands in your store *and* empties your side,
    // and telling a player "you go again" as the game ends is simply false.
    if ends_it {
        return format!("ends the game and sweeps, banking {gained}");
    }
    if kept {
        return "lands in your store — you go again".to_string();
    }
    // A capture banks the landing seed plus the facing pit, so more than the one
    // seed a sow can drop in passing.
    if gained >= 2 {
        return format!("captures {}", gained - 1);
    }
    match handed {
        0 => "safe: nothing on your row is exposed to a capture".to_string(),
        n => format!("leaves {n} seeds open to a capture"),
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
/// Never fake an exact verdict from a heuristic — and here that guard is doing
/// real work about 70% of the time, not covering a rare corner.
#[must_use]
pub fn coach_line(quality: MoveClass, exact: bool) -> &'static str {
    match (quality, exact) {
        (MoveClass::Optimal, _) => "That is the best pit available.",
        (MoveClass::ResultPreserving, true) => {
            "Sound — it keeps the result, though a tighter pit existed."
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
    if legal_pits(pos).is_empty() {
        return TutorReport {
            moves: Vec::new(),
            best_pit: None,
            exact: false,
        };
    }
    // The two budgets are the whole reason they are two constants: the tap path
    // must not pay the panel's bill. `capped_depth` is how the caller says which
    // path it is on, so the budget follows it rather than being fixed here.
    let budget = if is_affordable(pos) {
        NodeBudget::of(EXACT_NODE_BUDGET)
    } else if capped_depth <= COACH_DEPTH {
        NodeBudget::of(COACH_NODE_BUDGET)
    } else {
        NodeBudget::of(TUTOR_NODE_BUDGET)
    };
    let report = move_values(pos, capped_depth, budget);
    let best_value = report.values.iter().map(|&(_, v)| v).max().unwrap_or(0);
    let best_pit = report
        .values
        .iter()
        .find(|&&(_, v)| v == best_value)
        .map(|&(m, _)| m);

    let moves = report
        .values
        .iter()
        .map(|&(mv, value)| TutorMove {
            pit: mv,
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
        moves,
        best_pit,
        exact: report.exact,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::Side;
    use furrow_core::{opposite_pit, A_STORE, B_STORE, CELLS, PITS};

    use crate::eval::steps_to_store;

    fn board(a: [u8; PITS], b: [u8; PITS], stores: (u8, u8), to_move: Side) -> Board {
        let mut cells = [0u8; CELLS];
        cells[..PITS].copy_from_slice(&a);
        cells[A_STORE] = stores.0;
        cells[PITS + 1..PITS + 1 + PITS].copy_from_slice(&b);
        cells[B_STORE] = stores.1;
        Board { cells, to_move }
    }

    #[test]
    fn coach_wording_is_bound_to_the_exact_flag() {
        // The honesty gate, asserted on the function directly. The capped path
        // covers ~70% of a game, so both columns of this table are load-bearing.
        assert_eq!(coach_line(MoveClass::Blunder, true), "That threw the game.");
        assert_eq!(coach_line(MoveClass::Blunder, false), "That looks risky.");
        assert_ne!(
            coach_line(MoveClass::ResultPreserving, true),
            coach_line(MoveClass::ResultPreserving, false),
            "a hedged verdict must not read as a proven one"
        );
        // The optimal line makes no claim about proof, so it needs no hedge.
        assert_eq!(
            coach_line(MoveClass::Optimal, true),
            coach_line(MoveClass::Optimal, false)
        );
    }

    #[test]
    fn no_unproven_verdict_ever_uses_the_word_threw() {
        // The property, not just the table: nothing the capped path can produce
        // may be worded as a proof.
        for q in [
            MoveClass::Optimal,
            MoveClass::ResultPreserving,
            MoveClass::Blunder,
        ] {
            assert!(
                !coach_line(q, false).contains("threw"),
                "unproven {q:?} claimed a proof"
            );
        }
    }

    #[test]
    fn a_terminal_position_yields_an_empty_report_rather_than_a_panic() {
        let over = board([0; PITS], [0; PITS], (24, 24), Side::A);
        let r = assess(&over, TUTOR_DEPTH);
        assert!(r.moves.is_empty());
        assert_eq!(r.best_pit, None);
        assert!(!r.exact, "a report with no facts proves nothing");
    }

    #[test]
    fn the_best_pit_is_the_one_with_the_best_value_and_zero_regret() {
        let pos = board([1, 0, 2, 0, 1, 1], [1, 0, 1, 0, 1, 1], (19, 19), Side::A);
        let r = assess(&pos, TUTOR_DEPTH);
        assert!(r.exact, "nine seeds in play is inside the threshold");
        let best = r.best_pit.expect("a non-terminal position has a best move");
        let fact = r
            .moves
            .iter()
            .find(|m| m.pit == best)
            .expect("it is listed");
        assert_eq!(fact.regret, 0);
        assert_eq!(fact.quality, MoveClass::Optimal);
        assert!(r.moves.iter().all(|m| m.value <= fact.value));
        assert!(
            r.moves.iter().all(|m| m.regret >= 0),
            "regret is never negative"
        );
    }

    #[test]
    fn an_extra_turn_is_the_idea_the_tutor_names_first() {
        // Pit 5 with one seed lands in A's store.
        let pos = board([1, 0, 0, 0, 0, 1], [1, 1, 0, 0, 0, 0], (0, 0), Side::A);
        let r = assess(&pos, TUTOR_DEPTH);
        let fact = r
            .moves
            .iter()
            .find(|m| m.pit == Pit(5))
            .expect("pit 5 is legal");
        assert_eq!(fact.idea, "lands in your store — you go again");
    }

    #[test]
    fn a_capture_is_named_with_the_number_of_seeds_it_takes() {
        // Pit 0's single seed lands in empty pit 1, facing pit 11 which holds 5.
        // Pit 3 holds seeds so the capture does not also empty A's side and end
        // the game, which would be a different (and truer) thing to say.
        let pos = board([1, 0, 0, 3, 0, 0], [1, 0, 0, 0, 5, 0], (0, 0), Side::A);
        let r = assess(&pos, TUTOR_DEPTH);
        let fact = r
            .moves
            .iter()
            .find(|m| m.pit == Pit(0))
            .expect("pit 0 is legal");
        assert_eq!(fact.idea, "captures 5");
    }

    #[test]
    fn a_move_that_ends_the_game_says_so_and_says_what_it_banks() {
        // A's last seed goes to the store, emptying A's side; B sweeps.
        let pos = board([0, 0, 0, 0, 0, 1], [2, 0, 0, 0, 0, 0], (20, 20), Side::A);
        let r = assess(&pos, TUTOR_DEPTH);
        let fact = r
            .moves
            .iter()
            .find(|m| m.pit == Pit(5))
            .expect("pit 5 is legal");
        assert!(
            fact.idea.starts_with("ends the game and sweeps"),
            "got {}",
            fact.idea
        );
    }

    #[test]
    fn a_quiet_move_says_whether_it_leaves_anything_exposed() {
        // A sows pit 0's two seeds to pits 1 and 2. B's pit 12 holds one seed and
        // faces A's pit 0, which the sow just emptied -- so B can capture it.
        let pos = board([2, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1], (20, 20), Side::A);
        let r = assess(&pos, TUTOR_DEPTH);
        let fact = r
            .moves
            .iter()
            .find(|m| m.pit == Pit(0))
            .expect("pit 0 is legal");
        assert!(
            fact.idea.contains("safe") || fact.idea.contains("open to a capture"),
            "a quiet move should be described by what it risks, got {}",
            fact.idea
        );
    }

    #[test]
    fn settling_the_game_is_a_one_ply_fact_and_needs_no_search() {
        // Banking a 25th seed of 48 cannot be overturned however the rest falls.
        let winning = board([0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0], (24, 0), Side::A);
        let r = assess(&winning, TUTOR_DEPTH);
        assert!(r.moves.iter().any(|m| m.immediate_win));
        // And it is not claimed where it is not true.
        let level = board([0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0], (10, 10), Side::A);
        let r = assess(&level, TUTOR_DEPTH);
        assert!(r.moves.iter().all(|m| !m.immediate_win));
    }

    #[test]
    fn a_majority_is_more_than_half_and_a_tie_is_not_one() {
        // The boundary, because `MAJORITY` is `TOTAL_SEEDS / 2 + 1` and the `+ 1`
        // is the whole rule. Banking the 24th of 48 seeds is a *tie*, not a win,
        // and a version that dropped the `+ 1` would tell a player the game was
        // settled when the opponent could still draw it.
        assert_eq!(MAJORITY, 25);
        let ties = board([0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0], (23, 0), Side::A);
        let r = assess(&ties, TUTOR_DEPTH);
        assert!(
            r.moves.iter().all(|m| !m.immediate_win),
            "banking the 24th seed of 48 settles nothing"
        );
        let wins = board([0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0], (24, 0), Side::A);
        let r = assess(&wins, TUTOR_DEPTH);
        assert!(
            r.moves.iter().any(|m| m.immediate_win),
            "banking the 25th does settle it"
        );
    }

    #[test]
    fn exposes_counts_the_reply_capture_it_hands_over() {
        // Phase 4 found `exposes` surviving replacement by 0, 1 and -1, because
        // the only test that used it accepted either wording. It is pinned as a
        // number now, and the fixture had to be built carefully: B's pit 12 sits
        // one step from B's store, so a lone seed there banks rather than
        // captures. The reply that actually threatens pit 0 comes from pit 11,
        // landing in the empty pit 12 that faces it.
        //
        // A sows pit 3 (one seed, to pit 4) and leaves three seeds in pit 0. B
        // then sows pit 11 into the empty pit 12, taking those three and the
        // lander: four.
        let pos = board([3, 0, 0, 1, 0, 0], [0, 0, 0, 0, 1, 0], (22, 21), Side::A);
        assert_eq!(
            exposes(&pos, Pit(3)),
            4,
            "the three it left plus the lander"
        );
        // A move that keeps the turn exposes nothing, because there is no reply.
        let keeps = board([1, 0, 0, 0, 0, 1], [1, 1, 0, 0, 0, 0], (0, 0), Side::A);
        assert!(keeps_turn(&keeps, Pit(5)));
        assert_eq!(exposes(&keeps, Pit(5)), 0);
    }

    #[test]
    fn the_coach_and_the_panel_do_not_share_a_budget() {
        // The checkers lesson. That the two constants differ is already a
        // compile-time assertion at the top of this file -- clippy is right that
        // repeating it in a test asserts nothing. What a test *can* add is that
        // the split is wired through: `assess` picks its budget from the depth it
        // was handed, so the tap path and the panel really do run differently on
        // the same position.
        let opening = Board::opening();
        let coach = assess(&opening, COACH_DEPTH);
        let panel = assess(&opening, TUTOR_DEPTH);
        assert_eq!(coach.moves.len(), panel.moves.len());
        assert!(!coach.exact && !panel.exact);
    }

    #[test]
    fn no_move_claims_to_block_an_opponent_win() {
        // Carried as false on purpose: the notion does not exist in this game,
        // and inventing an analogue would put a fact in a persona's mouth that
        // nothing computed.
        let r = assess(&Board::opening(), COACH_DEPTH);
        assert!(r.moves.iter().all(|m| !m.blocks_opponent_win));
    }

    #[test]
    fn above_the_threshold_the_report_is_not_exact_and_grades_nothing_as_proven() {
        let r = assess(&Board::opening(), COACH_DEPTH);
        assert!(!r.exact, "the opening is far above the threshold");
        assert_eq!(r.moves.len(), 6);
        for m in &r.moves {
            assert!(!coach_line(m.quality, r.exact).contains("threw"));
        }
    }

    #[test]
    fn quality_grades_by_class_first_and_value_second() {
        // Same-class-but-worse is not a blunder; class-dropping is, whatever the
        // gap. A version that graded on the gap alone would call a two-seed
        // difference inside a won position a thrown game.
        assert_eq!(quality(5, 5), MoveClass::Optimal);
        assert_eq!(quality(1, 20), MoveClass::ResultPreserving);
        assert_eq!(quality(-1, 1), MoveClass::Blunder);
        assert_eq!(quality(0, 1), MoveClass::Blunder, "a draw is not a win");
        assert_eq!(quality(-1, 0), MoveClass::Blunder, "a loss is not a draw");
    }

    #[test]
    fn steps_to_store_is_the_arithmetic_the_idea_strings_rest_on() {
        // Re-asserted here because the tutor imports it: if this shifted, every
        // "lands in your store" claim would be about a different pit.
        assert_eq!(steps_to_store(Side::A, 5), 1);
        assert_eq!(steps_to_store(Side::B, 12), 1);
        assert_eq!(opposite_pit(1), 11);
    }
}
