//! Solver + winnable-daily-pack tests. Fast tests replay the COMMITTED pack (no
//! search); the `#[ignore]` generator writes it and the `#[ignore]` regeneration
//! drill re-runs the solver and asserts byte-identical output.

use std::fs;
use std::path::PathBuf;

use bubble_core::{engine::is_cleared, Game};
use bubble_solver::{find_win, generate_pack, pack_to_doc, Pack, PackEntry};

// Fixed, so the pack regenerates byte-identically. A full year of winnable seeds.
const PACK_MASTER: u64 = 0;
const PACK_COUNT: usize = 365;
const PACK_BUDGET: u64 = 200_000;
const PACK_MAX_SEEDS: u64 = 20_000;

fn pack_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../games/bubble/daily-pack.json")
}

fn replays_to_clear(entry: &PackEntry) -> bool {
    let mut game = Game::new(entry.seed);
    for &angle in &entry.moves {
        game.play(angle);
    }
    is_cleared(game.board())
}

fn read_committed() -> Pack {
    let bytes = fs::read(pack_path())
        .expect("run the `generate_daily_pack` (ignored) test first to create the pack");
    pond_docformat::read_as(&bytes, "bubble-clear-pack", 1).expect("valid bubble-clear-pack v1")
}

#[test]
fn find_win_respects_budget() {
    assert!(
        find_win(0, 1).is_none(),
        "cannot clear within a one-node budget"
    );
}

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
        replays_to_clear(&pack.fixture),
        "fixture seed {} line must clear the board",
        pack.fixture.seed
    );
    assert!(
        pack.fixture.moves.len() <= bubble_core::clear_board_mode::SHOT_BUDGET,
        "fixture line fits the shot budget"
    );
}

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

#[test]
#[ignore = "P10 regeneration drill — runs the solver (slow)"]
fn pack_regenerates_byte_identical() {
    let pack = generate_pack(PACK_MASTER, PACK_COUNT, PACK_BUDGET, PACK_MAX_SEEDS);
    let bytes = pack_to_doc(&pack).expect("serialize pack");
    let committed = fs::read(pack_path()).expect("read committed pack");
    assert_eq!(bytes, committed, "pack must regenerate byte-identically");
}

#[test]
#[ignore = "generator — writes games/bubble/daily-pack.json"]
fn generate_daily_pack() {
    let pack = generate_pack(PACK_MASTER, PACK_COUNT, PACK_BUDGET, PACK_MAX_SEEDS);
    assert_eq!(
        pack.seeds.len(),
        PACK_COUNT,
        "expected a full year of seeds"
    );
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

/// Discovery probe (not a gate): measure acceptance rate + line length on a
/// sample, to calibrate budget/mode before generating the full pack.
#[test]
#[ignore = "probe — acceptance/speed calibration"]
fn probe_acceptance() {
    let sample = 60u64;
    let mut wins = 0;
    let mut total_len = 0usize;
    for seed in 0..sample {
        if let Some(line) = find_win(seed, PACK_BUDGET) {
            wins += 1;
            total_len += line.len();
        }
    }
    let avg = total_len.checked_div(wins).unwrap_or(0);
    println!("PROBE: {wins}/{sample} winnable within budget {PACK_BUDGET}; avg line {avg} shots");
    assert!(wins > 0, "at least some seeds should be winnable");
}
