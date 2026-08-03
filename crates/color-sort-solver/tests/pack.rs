//! Winnable-daily-pack tests. Fast tests replay the COMMITTED pack; the
//! `#[ignore]` generator writes it and the `#[ignore]` drill asserts byte-identical
//! regen. Every daily deal is solver-certified winnable (brief §3, §5.1).

use std::fs;
use std::path::PathBuf;

use color_sort_core::{daily, DealParams};
use color_sort_solver::{generate_pack, line_wins, pack_to_doc, Pack};

// Fixed inputs, so the pack regenerates byte-identically. A full year of daily
// deals at the daily size (n = 10, k = 2, h = 4).
const PACK_MASTER: u64 = 0x_C010_5024;
const PACK_COUNT: usize = 365;
const PACK_BUDGET: u64 = 500_000;
const PACK_MAX_ATTEMPTS: u16 = 128;
const PACK_MAX_SEEDS: usize = 4000;

fn pack_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../games/color-sort/daily-pack.json")
}

fn read_committed() -> Pack {
    let bytes = fs::read(pack_path())
        .expect("run the `generate_daily_pack` (ignored) test first to create the pack");
    pond_docformat::read_as(&bytes, "color-sort-daily-pack", 1).expect("valid pack v1")
}

#[test]
fn committed_pack_is_wellformed_and_daily_size() {
    let pack = read_committed();
    assert_eq!(pack.colors, daily::COLORS);
    assert_eq!(pack.empties, daily::EMPTIES);
    assert_eq!(pack.entries.len(), PACK_COUNT, "a full year of daily deals");
    // Base seeds are distinct (no repeated daily within the year).
    let mut bases: Vec<u32> = pack.entries.iter().map(|e| e.base).collect();
    bases.sort_unstable();
    bases.dedup();
    assert_eq!(bases.len(), PACK_COUNT, "daily base seeds are distinct");
    // Every entry has a positive par.
    assert!(pack.entries.iter().all(|e| e.par > 0));
}

#[test]
fn fixture_line_wins() {
    let pack = read_committed();
    let params = DealParams {
        base: pack.fixture.base,
        attempt: pack.fixture.attempt,
        colors: pack.colors,
        empties: pack.empties,
    };
    assert!(
        !pack.fixture.moves.is_empty(),
        "the fixture has a solving line"
    );
    assert!(
        line_wins(params, &pack.fixture.moves),
        "the committed fixture line replays to a win"
    );
    assert_eq!(pack.fixture.par as usize, pack.fixture.moves.len());
}

#[test]
#[ignore = "generator — writes games/color-sort/daily-pack.json"]
fn generate_daily_pack() {
    let pack = generate_pack(
        PACK_MASTER,
        daily::COLORS,
        daily::EMPTIES,
        PACK_COUNT,
        PACK_BUDGET,
        PACK_MAX_ATTEMPTS,
        PACK_MAX_SEEDS,
    );
    assert_eq!(pack.entries.len(), PACK_COUNT);
    let bytes = pack_to_doc(&pack).expect("serialize pack");
    let path = pack_path();
    fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    fs::write(&path, &bytes).expect("write pack");
    println!(
        "wrote {} daily deals (fixture base {} attempt {} -> {} moves) to {}",
        pack.entries.len(),
        pack.fixture.base,
        pack.fixture.attempt,
        pack.fixture.moves.len(),
        path.display()
    );
}

#[test]
#[ignore = "regeneration drill — re-runs generation (must match the committed bytes)"]
fn pack_regenerates_byte_identical() {
    let pack = generate_pack(
        PACK_MASTER,
        daily::COLORS,
        daily::EMPTIES,
        PACK_COUNT,
        PACK_BUDGET,
        PACK_MAX_ATTEMPTS,
        PACK_MAX_SEEDS,
    );
    let bytes = pack_to_doc(&pack).expect("serialize pack");
    let committed = fs::read(pack_path()).expect("read committed pack");
    assert_eq!(bytes, committed, "pack must regenerate byte-identically");
}
