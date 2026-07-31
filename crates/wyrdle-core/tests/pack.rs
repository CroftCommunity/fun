//! Answer daily-pack tests. Fast tests replay the COMMITTED pack (no
//! generation); the `#[ignore]` generator writes it and the `#[ignore]`
//! regeneration drill re-runs the shuffle and asserts byte-identical output.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use wyrdle_core::pack::{generate_pack, pack_to_doc, Pack, PackEntry};
use wyrdle_core::{Game, MAX_GUESSES};

// Fixed, so the pack regenerates byte-identically. A full year of daily seeds.
const PACK_MASTER: u64 = 0;
const PACK_COUNT: usize = 365;

fn pack_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../games/wyrdle/daily-pack.json")
}

fn read_committed() -> Pack {
    let bytes = fs::read(pack_path())
        .expect("run the `generate_daily_pack` (ignored) test first to create the pack");
    pond_docformat::read_as(&bytes, "wyrdle-answer-pack", 1).expect("valid wyrdle-answer-pack v1")
}

fn replays_to_win(entry: &PackEntry) -> bool {
    let mut game = Game::new(entry.seed);
    for &guess in &entry.moves {
        let _ = game.play(guess);
    }
    game.is_won()
}

#[test]
fn committed_pack_is_wellformed() {
    let pack = read_committed();
    assert_eq!(pack.seeds.len(), PACK_COUNT, "a full year of seeds");
    let unique: HashSet<u64> = pack.seeds.iter().copied().collect();
    assert_eq!(
        unique.len(),
        pack.seeds.len(),
        "seeds are unique (no repeats)"
    );
    assert!(
        pack.seeds.contains(&pack.fixture.seed),
        "the fixture seed is one of the daily seeds"
    );
    assert!(
        pack.fixture.moves.len() <= MAX_GUESSES,
        "the fixture line fits the guess budget"
    );
}

#[test]
fn fixture_replays_to_a_win() {
    let pack = read_committed();
    assert!(
        replays_to_win(&pack.fixture),
        "the committed fixture line must solve its seed"
    );
}

#[test]
#[ignore = "generator — writes games/wyrdle/daily-pack.json"]
fn generate_daily_pack() {
    let pack = generate_pack(PACK_MASTER, PACK_COUNT);
    assert_eq!(pack.seeds.len(), PACK_COUNT);
    let bytes = pack_to_doc(&pack).expect("serialize pack");
    let path = pack_path();
    fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    fs::write(&path, &bytes).expect("write pack");
    println!(
        "wrote {} seeds (fixture seed {} -> {}) to {}",
        pack.seeds.len(),
        pack.fixture.seed,
        pack.fixture.moves[0],
        path.display()
    );
}

#[test]
#[ignore = "regeneration drill — re-runs the shuffle (must match the committed bytes)"]
fn pack_regenerates_byte_identical() {
    let pack = generate_pack(PACK_MASTER, PACK_COUNT);
    let bytes = pack_to_doc(&pack).expect("serialize pack");
    let committed = fs::read(pack_path()).expect("read committed pack");
    assert_eq!(bytes, committed, "pack must regenerate byte-identically");
}
