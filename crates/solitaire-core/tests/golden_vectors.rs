//! Golden-vector replay: cross-build determinism (native == wasm, asserted by
//! master-plan Phase 2 which runs this corpus through the wasm build) +
//! locked-hash regression. See RULES.md → "Golden-vector corpus".

use std::fs;
use std::path::PathBuf;

use solitaire_core::state_hash;
use solitaire_core::vectors::Vector;

fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vectors")
}

fn load_all() -> Vec<(String, Vector)> {
    let mut out = Vec::new();
    for entry in fs::read_dir(vectors_dir()).expect("vectors dir readable") {
        let path = entry.expect("dir entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let text = fs::read_to_string(&path).expect("read vector");
        let v: Vector = serde_json::from_str(&text).expect("parse vector");
        let name = path
            .file_name()
            .expect("file name")
            .to_string_lossy()
            .into_owned();
        out.push((name, v));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

#[test]
fn corpus_is_non_empty() {
    assert!(!load_all().is_empty(), "expected golden vectors on disk");
}

#[test]
fn vectors_replay_deterministically() {
    for (name, v) in load_all() {
        let a = state_hash(&v.replay().expect("replay must be legal"));
        let b = state_hash(&v.replay().expect("replay must be legal"));
        assert_eq!(a, b, "{name}: replay must be deterministic");
    }
}

#[test]
fn vectors_match_locked_hash() {
    for (name, v) in load_all() {
        if v.final_state_hash.is_empty() {
            continue; // not yet locked
        }
        let got = state_hash(&v.replay().expect("replay must be legal"));
        assert_eq!(got, v.final_state_hash, "{name}: locked-hash regression");
    }
}

/// Re-record locked hashes:
/// `cargo test -p solitaire-core --test golden_vectors print_hashes -- --ignored --nocapture`
#[test]
#[ignore = "recording helper, run with --ignored to (re)lock hashes"]
fn print_hashes() {
    for (name, v) in load_all() {
        println!("{name}\t{}", state_hash(&v.replay().expect("replay legal")));
    }
}
