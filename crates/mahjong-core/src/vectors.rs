//! Golden scenarios — the cross-build determinism vectors.
//!
//! Each scenario is a `(packed origin, move list)` replayed through
//! [`crate::Mahjong`]; its native `state_hash` is recorded in
//! `crates/mahjong-core/vectors/<name>.json` and `crates/xbuild` recomputes the
//! same replay inside `wasm32` and compares. The scenarios are chosen to walk
//! the paths where a `usize` on the hashed path would show: a deal, a full
//! clear, a mid-game, a shuffle (the RNG stream continuing past the deal), and
//! a move list with refusals in it (which replay as no-ops).

use pond_outcome::Game as _;

use crate::config::{daily_origin, level_origin};
use crate::game::{Game, Mahjong, Move, SHUFFLE};

/// A named scenario.
#[derive(Debug, Clone)]
pub struct Scenario {
    /// Position in [`SCENARIOS`].
    pub index: usize,
    /// The vector file's stem.
    pub name: &'static str,
    /// What the scenario exercises.
    pub note: &'static str,
    /// The packed origin.
    pub seed: u64,
    /// The move list.
    pub moves: Vec<Move>,
}

/// Play the lowest legal pair `n` times (a deterministic walk that leaves the
/// construction line).
fn lowest_legal(g: &mut Game, n: usize) {
    for _ in 0..n {
        let Some(&(a, b)) = g.board().legal_moves().first() else {
            return;
        };
        let _ = g.play(Move::pair(a, b));
    }
}

/// The scenarios, in index order.
///
/// # Panics
/// Never for the shipped layouts (the generator is pinned to succeed on them).
#[must_use]
pub fn scenarios() -> Vec<Scenario> {
    let mut out = Vec::new();

    let fresh = Game::level(1).expect("level 1 deals");
    out.push(Scenario {
        index: 0,
        name: "01-fresh-pond",
        note: "Level 1 (Pond, 36 tiles) as dealt: no moves.",
        seed: fresh.packed_seed(),
        moves: Vec::new(),
    });

    let mut cleared = Game::level(1).expect("level 1 deals");
    for &(a, b) in &cleared.last_line().to_vec() {
        let _ = cleared.play(Move::pair(a, b));
    }
    out.push(Scenario {
        index: 1,
        name: "02-pond-cleared",
        note: "Level 1 played down its construction line to a clear.",
        seed: cleared.packed_seed(),
        moves: cleared.moves().to_vec(),
    });

    let mut mid = Game::new(daily_origin("2026-08-30")).expect("daily deals");
    lowest_legal(&mut mid, 20);
    out.push(Scenario {
        index: 2,
        name: "03-turtle-midgame",
        note: "The 2026-08-30 daily Turtle after twenty lowest-legal pairs.",
        seed: mid.packed_seed(),
        moves: mid.moves().to_vec(),
    });

    let mut shuffled = Game::new(level_origin(20)).expect("level 20 deals");
    lowest_legal(&mut shuffled, 10);
    let _ = shuffled.play(SHUFFLE);
    lowest_legal(&mut shuffled, 5);
    out.push(Scenario {
        index: 3,
        name: "04-shuffle",
        note: "Level 20 (Steps): ten pairs, a shuffle (the RNG stream continues), five more.",
        seed: shuffled.packed_seed(),
        moves: shuffled.moves().to_vec(),
    });

    let mut noisy = Game::level(3).expect("level 3 deals");
    lowest_legal(&mut noisy, 3);
    let mut moves = noisy.moves().to_vec();
    // Refusals a tampered or replayed-out-of-order record might carry: the same
    // slot twice, a slot past the layout, an unknown code, and a pair already gone.
    moves.insert(1, Move::pair(0, 0));
    moves.push(Move::pair(200, 201));
    moves.push(Move::from_u32(0x7_FFFF));
    moves.push(moves[0]);
    out.push(Scenario {
        index: 4,
        name: "05-refusals-are-noops",
        note: "Level 3 with illegal codes spliced in: each replays as a no-op.",
        seed: noisy.packed_seed(),
        moves,
    });

    out
}

/// The number of scenarios.
pub const COUNT: usize = 5;

/// The `state_hash` after replaying scenario `index`, or `""` past the end.
#[must_use]
pub fn scenario_hash(index: usize) -> String {
    let all = scenarios();
    all.get(index)
        .map(|s| Mahjong::replay(s.seed, &s.moves).final_hash)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};
    use std::fs;
    use std::path::PathBuf;

    #[derive(Serialize, Deserialize)]
    struct Vector {
        index: usize,
        name: String,
        note: String,
        seed: u64,
        moves: Vec<u32>,
        final_state_hash: String,
    }

    fn dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vectors")
    }

    #[test]
    fn count_matches_scenarios() {
        assert_eq!(scenarios().len(), COUNT);
        assert_eq!(scenario_hash(COUNT), "");
    }

    #[test]
    fn committed_vectors_match_native_replay() {
        for s in scenarios() {
            let path = dir().join(format!("{}.json", s.name));
            let bytes = fs::read(&path).unwrap_or_else(|_| {
                panic!("run `write_vectors` (ignored) first: {}", path.display())
            });
            let v: Vector = serde_json::from_slice(&bytes).expect("vector json");
            assert_eq!(v.index, s.index);
            assert_eq!(v.seed, s.seed, "{}: seed", s.name);
            assert_eq!(
                v.moves,
                s.moves.iter().map(|m| m.to_u32()).collect::<Vec<_>>(),
                "{}: moves",
                s.name
            );
            assert_eq!(
                v.final_state_hash,
                scenario_hash(s.index),
                "{}: hash",
                s.name
            );
        }
    }

    #[test]
    #[ignore = "writer — records the native hashes into vectors/"]
    fn write_vectors() {
        fs::create_dir_all(dir()).expect("mkdir");
        for s in scenarios() {
            let v = Vector {
                index: s.index,
                name: s.name.to_owned(),
                note: s.note.to_owned(),
                seed: s.seed,
                moves: s.moves.iter().map(|m| m.to_u32()).collect(),
                final_state_hash: scenario_hash(s.index),
            };
            let json = serde_json::to_string_pretty(&v).expect("json");
            fs::write(dir().join(format!("{}.json", s.name)), json + "\n").expect("write");
        }
    }
}
