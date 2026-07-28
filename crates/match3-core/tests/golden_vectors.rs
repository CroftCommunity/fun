//! Golden-vector replay: the corpus-first deliverable. Asserts hand-computable
//! step-0 expectations, replay determinism (the verifiable-outcome property),
//! and — once locked — the recorded final state hash.

use std::fs;
use std::path::PathBuf;

use match3_core::vectors::Vector;

fn vectors_dir() -> PathBuf {
    // Self-contained crate: vectors travel inside crates/match3-core/vectors
    // (promoted from the discovery match3-p1 experiment, 2026-07-28).
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vectors")
}

fn load_all() -> Vec<(String, Vector)> {
    let mut out = Vec::new();
    for entry in fs::read_dir(vectors_dir()).expect("vectors dir readable") {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let text = fs::read_to_string(&path).unwrap();
        let v =
            Vector::from_json(&text).unwrap_or_else(|e| panic!("{} parses: {e}", path.display()));
        out.push((path.file_name().unwrap().to_string_lossy().into_owned(), v));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    assert!(!out.is_empty(), "corpus is non-empty");
    out
}

#[test]
fn corpus_step0_expectations_hold() {
    for (file, v) in load_all() {
        let obs = v.replay();
        assert_eq!(obs.move_legal, v.expect.move_legal, "{file}: move_legal");

        let expected_cleared: Vec<Vec<(usize, usize)>> = v
            .expect
            .step0_cleared
            .iter()
            .map(|m| m.iter().map(|p| (p[0], p[1])).collect())
            .collect();
        assert_eq!(obs.step0_cleared, expected_cleared, "{file}: step0_cleared");
        assert_eq!(obs.step0_score, v.expect.step0_score, "{file}: step0_score");
    }
}

#[test]
fn corpus_replay_is_deterministic() {
    // The verifiable-outcome property: (seed, board, moves) -> identical hash.
    for (file, v) in load_all() {
        let a = v.replay().final_state_hash;
        let b = v.replay().final_state_hash;
        assert_eq!(a, b, "{file}: two replays must match");
    }
}

#[test]
fn corpus_final_hash_matches_when_locked() {
    for (file, v) in load_all() {
        if let Some(expected) = &v.expect.final_state_hash {
            let obs = v.replay().final_state_hash;
            assert_eq!(&obs, expected, "{file}: final_state_hash regression");
        }
    }
}

/// Not a test assertion — run with `--ignored --nocapture` to print the current
/// final hashes so they can be locked into the vectors after the engine is green.
#[test]
#[ignore]
fn print_final_hashes() {
    for (file, v) in load_all() {
        println!("{file}\t{}", v.replay().final_state_hash);
    }
}
