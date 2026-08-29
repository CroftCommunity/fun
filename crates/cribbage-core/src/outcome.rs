//! The verifiable record: `(seed, moves)` replays to the final hash.

use pond_outcome::{Game, Replayed};

use crate::game::{apply, GameState, Move, Seat};
use crate::hash::state_hash;

/// The `pond_outcome::Game` marker for cribbage.
#[derive(Debug, Clone, Copy)]
pub struct Cribbage;

/// Replay `moves` from `seed` the way verification does: a move the position
/// refuses is skipped, so a tampered record diverges from the honest hash.
#[must_use]
pub fn replay(seed: u64, moves: &[Move]) -> GameState {
    moves
        .iter()
        .fold(GameState::new(seed), |s, &m| apply(&s, m).unwrap_or(s))
}

impl Game for Cribbage {
    type Move = Move;
    const KIND: &'static str = "cribbage";
    const VERSION: u32 = 1;

    fn replay(seed: u64, moves: &[Move]) -> Replayed {
        let s = replay(seed, moves);
        // `won` means "Seat A won"; `score` is the game's value (1 / 2 / 3).
        let outcome = s.outcome();
        Replayed {
            final_hash: state_hash(&s),
            won: outcome.is_some_and(|o| o.winner == Seat::A),
            score: outcome.map(|o| u64::from(o.value)),
            stars: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::legal_moves;

    fn some_game(seed: u64) -> (GameState, Vec<Move>) {
        let mut s = GameState::new(seed);
        let mut moves = Vec::new();
        let mut n = 0usize;
        while s.outcome().is_none() {
            let legal = legal_moves(&s);
            let m = legal[(n * 7) % legal.len()];
            moves.push(m);
            s = apply(&s, m).unwrap();
            n += 1;
        }
        (s, moves)
    }

    #[test]
    fn a_record_replays_to_its_hash_and_a_tampered_one_does_not() {
        let (s, moves) = some_game(5);
        assert_eq!(state_hash(&replay(5, &moves)), state_hash(&s));
        let mut tampered = moves.clone();
        tampered.truncate(moves.len() / 2);
        assert_ne!(state_hash(&replay(5, &tampered)), state_hash(&s));
        let mut illegal = moves.clone();
        illegal.insert(0, Move::Go); // refused at the discard: skipped, then identical
        assert_eq!(state_hash(&replay(5, &illegal)), state_hash(&s));
    }

    #[test]
    fn attest_and_verify_round_trip_with_the_game_value_as_the_score() {
        let (s, moves) = some_game(5);
        let record = pond_outcome::attest::<Cribbage>(
            5,
            moves,
            pond_outcome::Outcome::Abandoned,
            Some(false),
        );
        assert_eq!(record.kind, "cribbage");
        let outcome = s.outcome().unwrap();
        assert_eq!(
            record.result == pond_outcome::Outcome::Won,
            outcome.winner == Seat::A
        );
        assert_eq!(record.score, Some(u64::from(outcome.value)));
        assert!(pond_outcome::verify::<Cribbage>(&record).ok);
        let mut forged = record.clone();
        forged.final_hash = "0".repeat(64);
        assert!(!pond_outcome::verify::<Cribbage>(&forged).ok);
    }

    #[test]
    fn moves_serialize_as_their_wire_codes() {
        let json = serde_json::to_string(&vec![
            Move::Discard(3),
            Move::Play(1),
            Move::Go,
            Move::Claim(12),
        ])
        .unwrap();
        assert_eq!(json, "[3,17,20,44]");
        let back: Vec<Move> = serde_json::from_str(&json).unwrap();
        assert_eq!(
            back,
            vec![Move::Discard(3), Move::Play(1), Move::Go, Move::Claim(12)]
        );
        assert!(serde_json::from_str::<Vec<Move>>("[15]").is_err());
    }
}
