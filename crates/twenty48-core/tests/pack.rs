//! Daily seed-pack tests. Fast tests replay the COMMITTED pack; the `#[ignore]`
//! generator writes it and the `#[ignore]` drill asserts byte-identical regen.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use twenty48_core::pack::{generate_pack, pack_to_doc, Pack, PackEntry};
use twenty48_core::Game;

// Fixed, so the pack regenerates byte-identically. A full year of daily seeds
// drawn from a larger pool for variety.
const PACK_MASTER: u64 = 0;
const PACK_POOL: usize = 4096;
const PACK_COUNT: usize = 365;
const FIXTURE_STEPS: usize = 12;

fn pack_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../games/2048/daily-pack.json")
}

fn read_committed() -> Pack {
    let bytes = fs::read(pack_path())
        .expect("run the `generate_daily_pack` (ignored) test first to create the pack");
    pond_docformat::read_as(&bytes, "2048-daily-pack", 1).expect("valid 2048-daily-pack v1")
}

fn replays_cleanly(entry: &PackEntry) -> bool {
    let mut game = Game::new(entry.seed);
    let before = game.current_hash();
    for &dir in &entry.moves {
        let _ = game.play(dir);
    }
    // A legal line changes the board (unless empty), and never panics.
    entry.moves.is_empty() || game.current_hash() != before
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
}

#[test]
fn fixture_replays_cleanly() {
    let pack = read_committed();
    assert!(
        !pack.fixture.moves.is_empty(),
        "the fixture has a legal line"
    );
    assert!(
        replays_cleanly(&pack.fixture),
        "the fixture line replays and changes the board"
    );
}

#[test]
#[ignore = "generator — writes games/2048/daily-pack.json"]
fn generate_daily_pack() {
    let pack = generate_pack(PACK_MASTER, PACK_POOL, PACK_COUNT, FIXTURE_STEPS);
    assert_eq!(pack.seeds.len(), PACK_COUNT);
    let bytes = pack_to_doc(&pack).expect("serialize pack");
    let path = pack_path();
    fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    fs::write(&path, &bytes).expect("write pack");
    println!(
        "wrote {} seeds (fixture seed {} -> {} moves) to {}",
        pack.seeds.len(),
        pack.fixture.seed,
        pack.fixture.moves.len(),
        path.display()
    );
}

#[test]
#[ignore = "regeneration drill — re-runs the shuffle (must match the committed bytes)"]
fn pack_regenerates_byte_identical() {
    let pack = generate_pack(PACK_MASTER, PACK_POOL, PACK_COUNT, FIXTURE_STEPS);
    let bytes = pack_to_doc(&pack).expect("serialize pack");
    let committed = fs::read(pack_path()).expect("read committed pack");
    assert_eq!(bytes, committed, "pack must regenerate byte-identically");
}
