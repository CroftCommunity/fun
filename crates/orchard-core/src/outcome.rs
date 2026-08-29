//! The verifiable outcome: `pond_outcome::Game` for Orchard Drop.
//!
//! The claim a record makes is **"on seed X this sequence of drops reached score
//! S"** — the same shape 2048 uses, because Orchard Drop is the same kind of
//! game: an endless score-chase rather than a puzzle with a solution.
//!
//! # What `won` means here
//!
//! The trait requires a `won: bool` and Orchard Drop has no terminal victory —
//! the run always ends by overflowing the crate. Rather than invent a condition,
//! `won` is the milestone the game already celebrates: **a watermelon was
//! grown** (`max_tier >= 10`), which is exactly what the wrap's end screen says
//! with "🍉 Watermelon grown!". Score carries the real result.
//!
//! # Why replay is exact
//!
//! Every input is in the move list: `Move` carries its own tick, so replay
//! advances the world to each move before applying it, and the final `Wait`
//! records where the run stopped. Nothing is inferred, and nothing depends on
//! wall-clock time.

use pond_outcome::{Game as OutcomeGame, Replayed};

use crate::game::{Game, Move};
use crate::ladder::TOP;

/// The outcome adapter. A zero-sized type: the trait is a set of functions over
/// `(seed, moves)`, not a thing with state.
pub struct Orchard;

impl OutcomeGame for Orchard {
    type Move = Move;
    const KIND: &'static str = "orchard-drop";
    const VERSION: u32 = 1;

    fn replay(seed: u64, moves: &[Self::Move]) -> Replayed {
        let mut g = Game::new(seed);
        for &mv in moves {
            // A refused move is not an error here. A record may legitimately
            // carry moves that became illegal — the run ended mid-list — and
            // replay's job is to reproduce the state, not to re-litigate the
            // legality of inputs the core already judged once.
            let _ = g.apply(mv);
        }
        Replayed {
            final_hash: g.state_hash(),
            won: g.max_tier() >= TOP,
            score: Some(g.score()),
            stars: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use pond_outcome::{attest, verify, Outcome};

    use super::*;
    use crate::game::COOLDOWN_TICKS;

    /// A short scripted run: eight drops across the crate, then a settle.
    fn scripted(seed: u64) -> (Game, Vec<Move>) {
        let mut g = Game::new(seed);
        let mut moves = Vec::new();
        let mut t = 0;
        for i in 0..8 {
            let mv = Move::Drop {
                tick: t,
                x: 60 + 45 * i,
            };
            if g.apply(mv).is_ok() {
                moves.push(mv);
            }
            t += COOLDOWN_TICKS;
        }
        let end = Move::Wait { tick: t + 600 };
        if g.apply(end).is_ok() {
            moves.push(end);
        }
        (g, moves)
    }

    #[test]
    fn a_recorded_run_replays_to_the_same_hash() {
        // THE wiring test for Phases 1 and 2 together: it proves the rules
        // actually drive the solver rather than sitting beside it, and that a
        // run is reproducible from `(seed, moves)` and nothing else.
        let (played, moves) = scripted(11);
        let replayed = Orchard::replay(11, &moves);
        assert_eq!(replayed.final_hash, played.state_hash());
        assert_eq!(replayed.score, Some(played.score()));
    }

    #[test]
    fn a_record_verifies_against_itself() {
        let (_, moves) = scripted(11);
        let record = attest::<Orchard>(11, moves, Outcome::Abandoned, Some(false));
        assert!(verify::<Orchard>(&record).ok);
        assert!(record.score.is_some(), "a score-chase surfaces its score");
    }

    #[test]
    fn a_tampered_score_is_not_enough_to_pass_verification() {
        // The record carries a score for display, but verification re-derives
        // everything from `(seed, moves)`. Editing the stored hash must fail.
        let (_, moves) = scripted(11);
        let mut record = attest::<Orchard>(11, moves, Outcome::Abandoned, Some(false));
        record.final_hash = "0".repeat(64);
        assert!(!verify::<Orchard>(&record).ok, "a tampered hash verified");
    }

    #[test]
    fn a_record_from_a_different_seed_does_not_verify() {
        let (_, moves) = scripted(11);
        let honest = attest::<Orchard>(11, moves.clone(), Outcome::Abandoned, Some(false));
        let mut lying = honest.clone();
        lying.seed = 12;
        assert!(!verify::<Orchard>(&lying).ok, "the wrong seed verified");
    }

    #[test]
    fn dropping_a_move_from_the_list_breaks_the_record() {
        // The move list is the proof. Removing any of it must be detectable.
        let (_, moves) = scripted(11);
        let mut record = attest::<Orchard>(11, moves, Outcome::Abandoned, Some(false));
        record.moves.pop();
        assert!(!verify::<Orchard>(&record).ok);
    }

    #[test]
    fn a_run_that_never_grew_a_watermelon_is_not_won() {
        let (_, moves) = scripted(11);
        let record = attest::<Orchard>(11, moves, Outcome::Abandoned, Some(false));
        assert_eq!(record.result, Outcome::Abandoned);
    }

    #[test]
    fn move_count_is_the_length_of_the_proof() {
        let (_, moves) = scripted(11);
        let n = moves.len();
        let record = attest::<Orchard>(11, moves, Outcome::Abandoned, Some(false));
        assert_eq!(record.move_count, n);
    }

    #[test]
    fn the_kind_and_version_are_pinned() {
        // A record's envelope names them; changing either is a format change and
        // should be a deliberate commit rather than a drift.
        assert_eq!(Orchard::KIND, "orchard-drop");
        assert_eq!(Orchard::VERSION, 1);
    }
}
