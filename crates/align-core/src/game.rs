//! The verifiable-outcome binding (RULES.md "Verifiable outcome").
//!
//! A run is verifiable from `(seed, moves)`. Because the mode + start level change
//! gravity and scoring, they must travel *inside* the record — so a move list is a
//! mandatory [`AlignMove::Begin`] header followed by the tick-stamped
//! [`InputEvent`]s. `replay` reads the header, reconstructs the [`ModeConfig`],
//! and ticks the engine to its terminal, re-deriving the final hash + score. It
//! never trusts a stored field, so any tampered event, header, or hash fails.

use serde::{Deserialize, Serialize};

use crate::action::InputEvent;
use crate::engine::Engine;
use crate::mode::{ModeConfig, ModeId};

/// A move in the verifiable record: a required `Begin` header (first element)
/// carrying the mode + start level, then one entry per applied action.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum AlignMove {
    /// The run header — mode (0 Marathon, 1 Sprint) + start level. Must be first.
    Begin {
        /// Mode id (0 Marathon, 1 Sprint).
        mode: u8,
        /// Start level (Marathon 1..=15; Sprint ignores it).
        start_level: u8,
    },
    /// A tick-stamped atomic action.
    Ev(InputEvent),
}

/// Build a full move list from a finished engine: the `Begin` header + events.
#[must_use]
pub fn moves_of(engine: &Engine) -> Vec<AlignMove> {
    let mode = engine.mode();
    let mode_id = match mode.id {
        ModeId::Marathon => 0,
        ModeId::Sprint => 1,
    };
    let mut out = Vec::with_capacity(engine.moves().len() + 1);
    out.push(AlignMove::Begin {
        mode: mode_id,
        start_level: mode.start_level.min(255) as u8,
    });
    out.extend(engine.moves().iter().copied().map(AlignMove::Ev));
    out
}

/// The verifiable-outcome binding for Align.
pub struct Align;

impl pond_outcome::Game for Align {
    type Move = AlignMove;
    const KIND: &'static str = "align";
    const VERSION: u32 = 1;

    fn replay(seed: u64, moves: &[AlignMove]) -> pond_outcome::Replayed {
        // Read the header; a malformed record (no/late header) yields a fresh
        // Marathon engine whose hash will not match — verification fails.
        let (mode, events): (ModeConfig, Vec<InputEvent>) = match moves.split_first() {
            Some((AlignMove::Begin { mode, start_level }, rest)) => {
                let cfg = ModeConfig::from_ids(u32::from(*mode), u32::from(*start_level));
                let evs = rest
                    .iter()
                    .filter_map(|m| match m {
                        AlignMove::Ev(e) => Some(*e),
                        AlignMove::Begin { .. } => None,
                    })
                    .collect();
                (cfg, evs)
            }
            _ => (ModeConfig::marathon(1), Vec::new()),
        };
        let e = Engine::replay(seed, mode, &events);
        pond_outcome::Replayed {
            final_hash: e.current_hash(),
            won: e.is_won(),
            score: Some(e.score()),
            stars: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::action::Action;
    use pond_outcome::{attest, verify, Game as _, Outcome};

    /// Play a finite game by hard-dropping every piece until top-out.
    fn play_to_topout(seed: u64, mode: ModeConfig) -> Engine {
        let mut e = Engine::new(seed, mode);
        let mut guard = 0;
        while !e.is_over() && guard < 2000 {
            e.input(Action::HardDrop);
            e.tick();
            guard += 1;
        }
        e
    }

    #[test]
    fn verify_roundtrip_holds_and_detects_tamper() {
        let seed = 7;
        let e = play_to_topout(seed, ModeConfig::marathon(1));
        assert!(e.is_over(), "hard-dropping in place tops out");

        let moves = moves_of(&e);
        let record = attest::<Align>(seed, moves, Outcome::Lost, Some(false));
        assert_eq!(record.kind, "align");
        assert!(verify::<Align>(&record).ok, "an honest record verifies");
        assert!(record.score.is_some(), "score is surfaced");

        let mut bad_hash = record.clone();
        bad_hash.final_hash = "0".repeat(64);
        assert!(!verify::<Align>(&bad_hash).ok, "a tampered hash fails");

        // Tamper an action (the second move, an event) → divergent board → fails.
        if record.moves.len() > 2 {
            let mut bad_move = record.clone();
            if let AlignMove::Ev(e) = &mut bad_move.moves[1] {
                e.action = Action::ShiftL; // was a HardDrop → diverges the stack
            }
            assert!(!verify::<Align>(&bad_move).ok, "a tampered action fails");
        }
    }

    #[test]
    fn replay_is_deterministic() {
        let seed = 42;
        let e = play_to_topout(seed, ModeConfig::marathon(1));
        let moves = moves_of(&e);
        let a = Align::replay(seed, &moves);
        let b = Align::replay(seed, &moves);
        assert_eq!(a.final_hash, b.final_hash);
        assert_eq!(
            a.final_hash,
            e.current_hash(),
            "replay reproduces the live hash"
        );
        assert_eq!(a.score, Some(e.score()));
    }

    #[test]
    fn identical_seeds_identical_games() {
        let a = play_to_topout(9, ModeConfig::marathon(1));
        let b = play_to_topout(9, ModeConfig::marathon(1));
        assert_eq!(a.current_hash(), b.current_hash());
        // A different seed almost surely diverges.
        let c = play_to_topout(10, ModeConfig::marathon(1));
        assert_ne!(a.current_hash(), c.current_hash());
    }
}
