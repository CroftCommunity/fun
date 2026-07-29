//! Solver + winnable-daily-pack tests. Fast tests replay the COMMITTED pack
//! (no search); the `#[ignore]` generator writes it and the `#[ignore]`
//! regeneration drill (the P10 check) re-runs the solver.

use std::fs;
use std::path::PathBuf;

use solitaire_core::GameState;
use solitaire_solver::{find_win, generate_pack, pack_to_doc, PackEntry};

// Fixed, so the pack regenerates byte-identically.
const PACK_MASTER: u64 = 0;
const PACK_COUNT: usize = 6;
const PACK_BUDGET: u64 = 2_000_000;
const PACK_MAX_SEEDS: u64 = 60;

fn pack_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../games/solitaire/daily-pack.json")
}

fn replays_to_win(entry: &PackEntry) -> bool {
    let mut game = GameState::new_game(entry.seed);
    for &mv in &entry.moves {
        let _ = game.play_move(mv);
    }
    game.is_won()
}

#[test]
fn find_win_respects_budget() {
    assert!(
        find_win(0, 1).is_none(),
        "cannot win within a one-node budget"
    );
}

#[test]
fn committed_pack_is_all_winnable() {
    let bytes = fs::read(pack_path())
        .expect("run the `generate_daily_pack` (ignored) test first to create the pack");
    let pack: Vec<PackEntry> =
        pond_docformat::read_as(&bytes, "deal-pack", 1).expect("valid deal-pack envelope");
    assert!(!pack.is_empty(), "pack is non-empty");
    for entry in &pack {
        assert!(
            replays_to_win(entry),
            "seed {} line must replay to a win",
            entry.seed
        );
    }
}

/// P10 regeneration drill: regenerate the pack in-memory and assert it is
/// byte-identical to the committed file. Slow (runs the solver).
#[test]
#[ignore = "P10 regeneration drill — runs the solver (slow)"]
fn pack_regenerates_byte_identical() {
    let pack = generate_pack(PACK_MASTER, PACK_COUNT, PACK_BUDGET, PACK_MAX_SEEDS);
    let bytes = pack_to_doc(&pack).expect("serialize pack");
    let committed = fs::read(pack_path()).expect("read committed pack");
    assert_eq!(bytes, committed, "pack must regenerate byte-identically");
}

/// Generator: writes the committed daily-pack.json. Run once with
/// `cargo test -p solitaire-solver --release generate_daily_pack -- --ignored`.
#[test]
#[ignore = "generator — writes games/solitaire/daily-pack.json"]
fn generate_daily_pack() {
    let pack = generate_pack(PACK_MASTER, PACK_COUNT, PACK_BUDGET, PACK_MAX_SEEDS);
    assert_eq!(
        pack.len(),
        PACK_COUNT,
        "expected {PACK_COUNT} winnable seeds"
    );
    let bytes = pack_to_doc(&pack).expect("serialize pack");
    let path = pack_path();
    fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    fs::write(&path, &bytes).expect("write pack");
    println!("wrote {} entries to {}", pack.len(), path.display());
}
