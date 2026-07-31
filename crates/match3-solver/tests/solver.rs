//! Solver + winnable-daily-pack tests. Fast tests replay the COMMITTED pack (no
//! search); the `#[ignore]` generator writes it and the `#[ignore]` regeneration
//! drill (the P10 check) re-runs the solver.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use match3_core::blockers_mode::{BLOCKERS, COLORS, HEIGHT, WIDTH};
use match3_core::{
    blockers_remaining, deal_blockers, deal_ingredients, deal_jelly, ingredients_mode,
    ingredients_remaining, jelly_mode, jelly_remaining, Game,
};
use match3_solver::{
    find_clear, find_dejelly, find_ingredients, generate_ingredients_pack, generate_jelly_pack,
    generate_pack, ingredients_pack_to_doc, jelly_pack_to_doc, pack_to_doc, Pack, PackEntry,
};

// Fixed, so the pack regenerates byte-identically. A full year of clearable
// seeds (the daily board never repeats within a year).
const PACK_MASTER: u64 = 0;
const PACK_COUNT: usize = 365;
const PACK_BUDGET: u64 = 300_000;
const PACK_MAX_SEEDS: u64 = 3_000;

fn pack_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../games/match3/blockers-pack.json")
}

fn replays_to_clear(entry: &PackEntry) -> bool {
    let mut game = Game::new(
        deal_blockers(entry.seed, WIDTH, HEIGHT, COLORS, BLOCKERS),
        entry.seed,
        COLORS,
    );
    for &m in &entry.moves {
        let _ = game.play_move((m[0], m[1]), (m[2], m[3]));
    }
    blockers_remaining(&game.board) == 0
}

fn read_committed() -> Pack {
    let bytes = fs::read(pack_path())
        .expect("run the `generate_blockers_pack` (ignored) test first to create the pack");
    pond_docformat::read_as(&bytes, "match3-blockers-pack", 1).expect("valid pack v1 envelope")
}

#[test]
fn find_clear_respects_budget() {
    assert!(
        find_clear(0, 1).is_none(),
        "cannot clear within a one-node budget"
    );
}

/// Fast (no search): the committed pack has a full year of unique seeds and its
/// fixture line replays to a full blocker clear. Per-seed clearability is
/// covered by the (ignored) regeneration drill, which re-runs the solver.
#[test]
fn committed_pack_is_wellformed() {
    let pack = read_committed();
    assert_eq!(pack.seeds.len(), PACK_COUNT, "a full year of seeds");
    let unique: HashSet<u64> = pack.seeds.iter().copied().collect();
    assert_eq!(unique.len(), pack.seeds.len(), "seeds are unique");
    assert!(
        pack.seeds.contains(&pack.fixture.seed),
        "the fixture seed is one of the pack seeds"
    );
    assert!(
        replays_to_clear(&pack.fixture),
        "fixture seed {} line must replay to a clear",
        pack.fixture.seed
    );
}

/// Spot-check: a couple of committed seeds really are clearable (a cheap guard
/// that the seed list is not stale, without re-solving all 365).
#[test]
fn committed_pack_seeds_are_clearable_spotcheck() {
    let pack = read_committed();
    for &seed in pack.seeds.iter().take(3) {
        assert!(
            find_clear(seed, PACK_BUDGET).is_some(),
            "committed seed {seed} must be clearable within budget"
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

/// Generator: writes the committed blockers-pack.json. Run once with
/// `cargo test -p match3-solver --release generate_blockers_pack -- --ignored --nocapture`.
#[test]
#[ignore = "generator — writes games/match3/blockers-pack.json"]
fn generate_blockers_pack() {
    let pack = generate_pack(PACK_MASTER, PACK_COUNT, PACK_BUDGET, PACK_MAX_SEEDS);
    assert_eq!(
        pack.seeds.len(),
        PACK_COUNT,
        "expected {PACK_COUNT} clearable seeds"
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

// --- clear-the-jelly pack (parity Track A / A2) ---

const JPACK_MASTER: u64 = 0;
const JPACK_COUNT: usize = 365;
const JPACK_BUDGET: u64 = 300_000;
const JPACK_MAX_SEEDS: u64 = 3_000;

fn jelly_pack_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../games/match3/jelly-pack.json")
}

fn jelly_replays_to_clear(entry: &PackEntry) -> bool {
    let mut game = Game::new(
        deal_jelly(
            entry.seed,
            jelly_mode::WIDTH,
            jelly_mode::HEIGHT,
            jelly_mode::COLORS,
            jelly_mode::JELLY,
        ),
        entry.seed,
        jelly_mode::COLORS,
    );
    for &m in &entry.moves {
        let _ = game.play_move((m[0], m[1]), (m[2], m[3]));
    }
    jelly_remaining(&game.board) == 0
}

fn read_committed_jelly() -> Pack {
    let bytes = fs::read(jelly_pack_path())
        .expect("run the `generate_jelly_pack_file` (ignored) test first to create the pack");
    pond_docformat::read_as(&bytes, "match3-jelly-pack", 1).expect("valid jelly pack v1 envelope")
}

#[test]
fn find_dejelly_respects_budget() {
    assert!(
        find_dejelly(0, 1).is_none(),
        "cannot scrub all jelly within a one-node budget"
    );
}

#[test]
fn committed_jelly_pack_is_wellformed() {
    let pack = read_committed_jelly();
    assert_eq!(pack.seeds.len(), JPACK_COUNT, "a full year of seeds");
    let unique: HashSet<u64> = pack.seeds.iter().copied().collect();
    assert_eq!(unique.len(), pack.seeds.len(), "seeds are unique");
    assert!(
        pack.seeds.contains(&pack.fixture.seed),
        "the fixture seed is one of the pack seeds"
    );
    assert!(
        jelly_replays_to_clear(&pack.fixture),
        "fixture seed {} line must replay to all-jelly-cleared",
        pack.fixture.seed
    );
}

#[test]
fn committed_jelly_seeds_are_clearable_spotcheck() {
    let pack = read_committed_jelly();
    for &seed in pack.seeds.iter().take(3) {
        assert!(
            find_dejelly(seed, JPACK_BUDGET).is_some(),
            "committed jelly seed {seed} must be clearable within budget"
        );
    }
}

#[test]
#[ignore = "P10 regeneration drill — runs the solver (slow)"]
fn jelly_pack_regenerates_byte_identical() {
    let pack = generate_jelly_pack(JPACK_MASTER, JPACK_COUNT, JPACK_BUDGET, JPACK_MAX_SEEDS);
    let bytes = jelly_pack_to_doc(&pack).expect("serialize pack");
    let committed = fs::read(jelly_pack_path()).expect("read committed pack");
    assert_eq!(
        bytes, committed,
        "jelly pack must regenerate byte-identically"
    );
}

#[test]
#[ignore = "generator — writes games/match3/jelly-pack.json"]
fn generate_jelly_pack_file() {
    let pack = generate_jelly_pack(JPACK_MASTER, JPACK_COUNT, JPACK_BUDGET, JPACK_MAX_SEEDS);
    assert_eq!(
        pack.seeds.len(),
        JPACK_COUNT,
        "expected a full year of seeds"
    );
    let bytes = jelly_pack_to_doc(&pack).expect("serialize pack");
    let path = jelly_pack_path();
    fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    fs::write(&path, &bytes).expect("write pack");
    println!(
        "wrote {} jelly seeds (fixture seed {} line {} moves) to {}",
        pack.seeds.len(),
        pack.fixture.seed,
        pack.fixture.moves.len(),
        path.display()
    );
}

// --- clear-the-ingredients pack (parity Track D) ---

const IPACK_MASTER: u64 = 0;
const IPACK_COUNT: usize = 365;
const IPACK_BUDGET: u64 = 400_000;
const IPACK_MAX_SEEDS: u64 = 4_000;

fn ingredients_pack_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../games/match3/ingredients-pack.json")
}

fn ingredients_replays_to_clear(entry: &PackEntry) -> bool {
    use ingredients_mode as m;
    let mut game = Game::new(
        deal_ingredients(entry.seed, m::WIDTH, m::HEIGHT, m::COLORS, m::INGREDIENTS),
        entry.seed,
        m::COLORS,
    );
    for &mv in &entry.moves {
        let _ = game.play_move((mv[0], mv[1]), (mv[2], mv[3]));
    }
    ingredients_remaining(&game.board) == 0
}

fn read_committed_ingredients() -> Pack {
    let bytes = fs::read(ingredients_pack_path())
        .expect("run the `generate_ingredients_pack_file` (ignored) test first to create the pack");
    pond_docformat::read_as(&bytes, "match3-ingredients-pack", 1)
        .expect("valid ingredients pack v1 envelope")
}

#[test]
fn find_ingredients_respects_budget() {
    assert!(
        find_ingredients(0, 1).is_none(),
        "cannot drop every ingredient within a one-node budget"
    );
}

#[test]
fn committed_ingredients_pack_is_wellformed() {
    let pack = read_committed_ingredients();
    assert_eq!(pack.seeds.len(), IPACK_COUNT, "a full year of seeds");
    let unique: HashSet<u64> = pack.seeds.iter().copied().collect();
    assert_eq!(unique.len(), pack.seeds.len(), "seeds are unique");
    assert!(
        pack.seeds.contains(&pack.fixture.seed),
        "the fixture seed is one of the pack seeds"
    );
    assert!(
        ingredients_replays_to_clear(&pack.fixture),
        "fixture seed {} line must replay to all-ingredients-collected",
        pack.fixture.seed
    );
}

#[test]
fn committed_ingredients_seeds_are_clearable_spotcheck() {
    let pack = read_committed_ingredients();
    for &seed in pack.seeds.iter().take(3) {
        assert!(
            find_ingredients(seed, IPACK_BUDGET).is_some(),
            "committed ingredients seed {seed} must be clearable within budget"
        );
    }
}

#[test]
#[ignore = "P10 regeneration drill — runs the solver (slow)"]
fn ingredients_pack_regenerates_byte_identical() {
    let pack = generate_ingredients_pack(IPACK_MASTER, IPACK_COUNT, IPACK_BUDGET, IPACK_MAX_SEEDS);
    let bytes = ingredients_pack_to_doc(&pack).expect("serialize pack");
    let committed = fs::read(ingredients_pack_path()).expect("read committed pack");
    assert_eq!(
        bytes, committed,
        "ingredients pack must regenerate byte-identically"
    );
}

#[test]
#[ignore = "generator — writes games/match3/ingredients-pack.json"]
fn generate_ingredients_pack_file() {
    let pack = generate_ingredients_pack(IPACK_MASTER, IPACK_COUNT, IPACK_BUDGET, IPACK_MAX_SEEDS);
    assert_eq!(
        pack.seeds.len(),
        IPACK_COUNT,
        "expected a full year of seeds"
    );
    let bytes = ingredients_pack_to_doc(&pack).expect("serialize pack");
    let path = ingredients_pack_path();
    fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    fs::write(&path, &bytes).expect("write pack");
    println!(
        "wrote {} ingredient seeds (fixture seed {} line {} moves) to {}",
        pack.seeds.len(),
        pack.fixture.seed,
        pack.fixture.moves.len(),
        path.display()
    );
}

// --- target-score par table (parity Track P-now / C1) ---

use match3_core::{reference_score, target_score_mode};
use match3_solver::{generate_par_pack, par_pack_to_doc, par_tiers, ParPack};

const PAR_MASTER: u64 = 0;
const PAR_COUNT: usize = 365;

fn par_pack_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../games/match3/par-pack.json")
}

fn read_committed_par() -> ParPack {
    let bytes = fs::read(par_pack_path())
        .expect("run the `generate_par_pack_file` (ignored) test first to create the table");
    pond_docformat::read_as(&bytes, "match3-par-pack", 1).expect("valid par pack v1 envelope")
}

#[test]
fn par_tiers_is_deterministic_and_strictly_increasing() {
    let a = par_tiers(7);
    let b = par_tiers(7);
    assert_eq!(a, b, "same seed => same tiers");
    assert!(
        a[0] < a[1] && a[1] < a[2],
        "tiers strictly increasing: {a:?}"
    );
}

#[test]
fn par_3star_is_harder_than_the_old_90pct_of_greedy() {
    use target_score_mode as m;
    for seed in 0..12u64 {
        let greedy = reference_score(seed, m::WIDTH, m::HEIGHT, m::COLORS, m::MOVE_BUDGET);
        let tiers = par_tiers(seed);
        // The strong rung is at least the greedy score, so 3★ clears the old bar
        // (90% of greedy) by a real margin — 3★ is no longer trivial.
        assert!(
            tiers[2] >= greedy,
            "seed {seed}: 3★ {} >= greedy {greedy}",
            tiers[2]
        );
        assert!(
            tiers[2] > greedy * 9 / 10,
            "seed {seed}: 3★ beats the old 90% bar"
        );
    }
}

#[test]
fn committed_par_pack_is_wellformed() {
    let pack = read_committed_par();
    assert_eq!(pack.entries.len(), PAR_COUNT, "a full year of par entries");
    let unique: HashSet<u64> = pack.entries.iter().map(|e| e.seed).collect();
    assert_eq!(unique.len(), pack.entries.len(), "seeds are unique");
    for e in &pack.entries {
        assert!(
            e.tiers[0] < e.tiers[1] && e.tiers[1] < e.tiers[2],
            "entry {e:?} increasing"
        );
    }
    // Spot-check a couple of entries against a fresh recompute (not stale).
    for e in pack.entries.iter().take(3) {
        assert_eq!(
            e.tiers,
            par_tiers(e.seed),
            "committed tiers match recompute"
        );
    }
}

#[test]
#[ignore = "P10 regeneration drill — recomputes the ladder (slow)"]
fn par_pack_regenerates_byte_identical() {
    let pack = generate_par_pack(PAR_MASTER, PAR_COUNT);
    let bytes = par_pack_to_doc(&pack).expect("serialize");
    let committed = fs::read(par_pack_path()).expect("read committed");
    assert_eq!(
        bytes, committed,
        "par table must regenerate byte-identically"
    );
}

#[test]
#[ignore = "generator — writes games/match3/par-pack.json"]
fn generate_par_pack_file() {
    let pack = generate_par_pack(PAR_MASTER, PAR_COUNT);
    let bytes = par_pack_to_doc(&pack).expect("serialize");
    let path = par_pack_path();
    fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    fs::write(&path, &bytes).expect("write");
    println!(
        "wrote {} par entries to {}",
        pack.entries.len(),
        path.display()
    );
}
