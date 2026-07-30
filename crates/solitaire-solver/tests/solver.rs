//! Solver + winnable-daily-pack tests. Fast tests replay the COMMITTED pack
//! (no search); the `#[ignore]` generator writes it and the `#[ignore]`
//! regeneration drill (the P10 check) re-runs the solver.

use std::fs;
use std::path::PathBuf;

use solitaire_core::GameState;
use solitaire_solver::{find_win, generate_pack, pack_to_doc, Pack, PackEntry};

// Fixed, so the pack regenerates byte-identically. A full year of winnable
// seeds (the daily deal never repeats within a year).
const PACK_MASTER: u64 = 0;
const PACK_COUNT: usize = 365;
const PACK_BUDGET: u64 = 2_000_000;
const PACK_MAX_SEEDS: u64 = 3_000;

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

fn read_committed() -> Pack {
    let bytes = fs::read(pack_path())
        .expect("run the `generate_daily_pack` (ignored) test first to create the pack");
    pond_docformat::read_as(&bytes, "deal-pack", 2).expect("valid deal-pack v2 envelope")
}

#[test]
fn find_win_respects_budget() {
    assert!(
        find_win(0, 1).is_none(),
        "cannot win within a one-node budget"
    );
}

/// Fast (no search): the committed pack has a full year of unique seeds and its
/// fixture line replays to a win. Per-seed winnability is covered by the
/// (ignored) regeneration drill, which re-runs the solver over every seed.
#[test]
fn committed_pack_is_wellformed() {
    let pack = read_committed();
    assert_eq!(pack.seeds.len(), PACK_COUNT, "a full year of seeds");
    let unique: std::collections::HashSet<u64> = pack.seeds.iter().copied().collect();
    assert_eq!(unique.len(), pack.seeds.len(), "seeds are unique");
    assert!(
        pack.seeds.contains(&pack.fixture.seed),
        "the fixture seed is one of the pack seeds"
    );
    assert!(
        replays_to_win(&pack.fixture),
        "fixture seed {} line must replay to a win",
        pack.fixture.seed
    );
}

/// Spot-check: a couple of the committed seeds really are winnable (a cheap
/// guard that the seed list is not stale, without re-solving all 365).
#[test]
fn committed_pack_seeds_are_winnable_spotcheck() {
    let pack = read_committed();
    for &seed in pack.seeds.iter().take(3) {
        assert!(
            find_win(seed, PACK_BUDGET).is_some(),
            "committed seed {seed} must be winnable within budget"
        );
    }
}

/// P10 regeneration drill: regenerate the pack in-memory and assert it is
/// byte-identical to the committed file. Slow (runs the solver over the stream).
#[test]
#[ignore = "P10 regeneration drill — runs the solver (slow)"]
fn pack_regenerates_byte_identical() {
    let pack = generate_pack(PACK_MASTER, PACK_COUNT, PACK_BUDGET, PACK_MAX_SEEDS);
    let bytes = pack_to_doc(&pack).expect("serialize pack");
    let committed = fs::read(pack_path()).expect("read committed pack");
    assert_eq!(bytes, committed, "pack must regenerate byte-identically");
}

/// Generator: writes the committed daily-pack.json. Run once with
/// `cargo test -p solitaire-solver --release generate_daily_pack -- --ignored --nocapture`.
#[test]
#[ignore = "generator — writes games/solitaire/daily-pack.json"]
fn generate_daily_pack() {
    let pack = generate_pack(PACK_MASTER, PACK_COUNT, PACK_BUDGET, PACK_MAX_SEEDS);
    assert_eq!(pack.seeds.len(), PACK_COUNT, "expected {PACK_COUNT} winnable seeds");
    let bytes = pack_to_doc(&pack).expect("serialize pack");
    let path = pack_path();
    fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    fs::write(&path, &bytes).expect("write pack");
    println!(
        "wrote {} seeds (fixture seed {} line {} moves) to {}",
        pack.seeds.len(),
        pack.fixture.seed,
        pack.fixture.moves.len(),
        path.display()
    );
}
