//! Golden vectors — the recorded behaviour a change to the rules has to
//! acknowledge.
//!
//! The scenarios live in `orchard_core::vectors` rather than here, because the
//! `xbuild` cross-build check has to replay the same runs inside `wasm32` and
//! cannot call test code. The expected hashes live in `vectors/*.json`, read by
//! this test and by `check.mjs` alike — one source, so the two harnesses cannot
//! disagree about what the right answer is.
//!
//! These lock the whole stack: a vector fails if the ladder, the merge
//! tie-break, the scoring, the cooldown, the game-over dwell, the seeded stream,
//! the physics underneath, or the hash changes.
//!
//! Re-record only when a behaviour change is *intended*. A vector updated to
//! make a test pass has stopped being a vector.

use orchard_core::game::{Game, Move, COOLDOWN_TICKS};
use orchard_core::outcome::Orchard;
use orchard_core::{ladder, vectors};
use pond_outcome::{attest, verify, Outcome};

/// One committed vector file.
#[derive(serde::Deserialize)]
struct Vector {
    index: usize,
    name: String,
    note: String,
    final_state_hash: String,
}

/// The committed vectors, in index order.
const FILES: [&str; vectors::COUNT] = [
    include_str!("../vectors/01-fresh.json"),
    include_str!("../vectors/02-one-drop.json"),
    include_str!("../vectors/03-short-run.json"),
    include_str!("../vectors/04-merges.json"),
    include_str!("../vectors/05-to-game-over.json"),
];

fn load() -> Vec<Vector> {
    FILES
        .iter()
        .map(|raw| serde_json::from_str::<Vector>(raw).expect("a committed vector is valid JSON"))
        .collect()
}

#[test]
fn golden_vectors_hold() {
    let mut drift = Vec::new();
    for v in load() {
        let got = vectors::scenario_hash(v.index);
        if got != v.final_state_hash {
            drift.push(format!(
                "  {}\n    expected {}\n    got      {got}\n    ({})",
                v.name, v.final_state_hash, v.note
            ));
        }
    }
    assert!(
        drift.is_empty(),
        "golden vectors drifted:\n{}\n\nIf the change was intended, update the \
         vectors/*.json files and say why in the commit.",
        drift.join("\n")
    );
}

#[test]
fn the_vector_files_and_the_scenario_list_agree() {
    // A file without a scenario, or a scenario without a file, would leave one
    // of them silently unchecked.
    let loaded = load();
    assert_eq!(loaded.len(), vectors::COUNT);
    for (i, v) in loaded.iter().enumerate() {
        assert_eq!(v.index, i, "vector {} is out of order", v.name);
        assert_eq!(v.name, vectors::NAMES[i], "name mismatch at index {i}");
    }
    assert!(
        vectors::scenario(vectors::COUNT).is_none(),
        "an index past the end must be None"
    );
}

// ── believability guards ───────────────────────────────────────────────────
// A vector that hashes stably because nothing happened proves nothing.

#[test]
fn the_merge_vector_actually_climbed_the_ladder() {
    let g = vectors::scenario(3).expect("scenario 3 exists");
    assert!(g.score() > 0, "no merge scored across twenty-four drops");
    assert!(
        g.max_tier() > 0,
        "the ladder never climbed above the droppable tiers"
    );
    assert!(
        g.fruit_count() < 24,
        "24 drops left {} fruit — nothing merged",
        g.fruit_count()
    );
}

#[test]
fn the_game_over_vector_actually_ended() {
    let g = vectors::scenario(4).expect("scenario 4 exists");
    assert!(g.is_over(), "the crate never overflowed");
    assert!(g.tick() > 0);
}

#[test]
fn the_fresh_vector_is_a_fresh_game() {
    let g = vectors::scenario(0).expect("scenario 0 exists");
    assert_eq!(g.tick(), 0);
    assert_eq!(g.fruit_count(), 0);
    assert_eq!(g.score(), 0);
    assert!(!g.is_over());
    assert!(ladder::is_droppable(g.held()) && ladder::is_droppable(g.next()));
}

#[test]
fn every_vector_hashes_differently() {
    // Five scenarios that collided would look locked while testing one thing.
    let mut hashes: Vec<String> = (0..vectors::COUNT).map(vectors::scenario_hash).collect();
    let n = hashes.len();
    hashes.sort();
    hashes.dedup();
    assert_eq!(hashes.len(), n, "two vectors reach the same state");
}

// ── the record round-trip ──────────────────────────────────────────────────

#[test]
fn a_full_run_attests_and_verifies() {
    let mut g = Game::new(5);
    let mut moves = Vec::new();
    let mut t = 0;
    for _ in 0..400 {
        if g.is_over() {
            break;
        }
        let d = Move::Drop { tick: t, x: 220 };
        if g.apply(d).is_ok() {
            moves.push(d);
        }
        let w = Move::Wait {
            tick: t + COOLDOWN_TICKS,
        };
        if g.apply(w).is_ok() {
            moves.push(w);
        }
        t += COOLDOWN_TICKS;
    }
    assert!(g.is_over(), "the run did not finish");

    let record = attest::<Orchard>(5, moves, Outcome::Lost, Some(false));
    assert!(verify::<Orchard>(&record).ok, "a real run failed to verify");
    assert_eq!(record.final_hash, g.state_hash());
    assert_eq!(record.score, Some(g.score()));
}
