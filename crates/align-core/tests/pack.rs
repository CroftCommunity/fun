//! The daily seed-pack: fast tests over the committed pack + an ignored
//! generator that writes it (byte-identically regenerable). Mirrors 2048/wyrdle.

use align_core::game::Align;
use align_core::pack::{generate_pack, pack_from_doc, pack_to_doc};
use pond_outcome::{attest, verify, Outcome};

const MASTER: u64 = 0xA119_0000_0000_0001; // "align" master seed
const POOL: usize = 4096;
const COUNT: usize = 365;
const FIXTURE_STEPS: usize = 12;
const PACK_PATH: &str = "../../games/align/daily-pack.json";

fn committed() -> Vec<u8> {
    std::fs::read(PACK_PATH).expect("committed daily-pack.json exists (run the generator)")
}

#[test]
fn committed_pack_is_wellformed() {
    let pack = pack_from_doc(&committed()).expect("valid envelope");
    assert_eq!(pack.seeds.len(), COUNT, "a year of dailies");
    let mut uniq = pack.seeds.clone();
    uniq.sort_unstable();
    uniq.dedup();
    assert_eq!(uniq.len(), COUNT, "seeds are distinct");
    assert!(
        pack.fixture.moves.len() > 1,
        "fixture has a header + events"
    );
}

#[test]
fn committed_fixture_verifies() {
    let pack = pack_from_doc(&committed()).expect("valid envelope");
    let record = attest::<Align>(
        pack.fixture.seed,
        pack.fixture.moves.clone(),
        Outcome::Abandoned,
        None,
    );
    assert!(
        verify::<Align>(&record).ok,
        "the fixture replays + verifies"
    );
}

#[test]
fn regen_is_byte_identical() {
    let a = pack_to_doc(&generate_pack(MASTER, POOL, COUNT, FIXTURE_STEPS)).unwrap();
    let b = pack_to_doc(&generate_pack(MASTER, POOL, COUNT, FIXTURE_STEPS)).unwrap();
    assert_eq!(a, b, "the generator is deterministic");
}

/// Regenerate the committed pack. Run with:
/// `cargo test -p align-core --test pack -- --ignored write_pack`
#[test]
#[ignore]
fn write_pack() {
    let pack = generate_pack(MASTER, POOL, COUNT, FIXTURE_STEPS);
    let doc = pack_to_doc(&pack).expect("serialize");
    std::fs::create_dir_all("../../games/align").expect("mkdir");
    std::fs::write(PACK_PATH, &doc).expect("write pack");
    eprintln!("wrote {} bytes, {} seeds", doc.len(), pack.seeds.len());
}
