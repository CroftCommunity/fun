//! B5: the verifiable outcome — attest a real run, verify by replay, and prove a
//! tampered record fails. The seed is config-packed so options travel with it.

use blockdoku_core::config::pack_seed;
use blockdoku_core::deal::DealOptions;
use blockdoku_core::difficulty::Difficulty;
use blockdoku_core::game::{Blockdoku, GameState};
use pond_outcome::{attest, verify, Outcome};

fn play_a_run(base: u64, opts: DealOptions) -> GameState {
    let mut g = GameState::new_game(base, opts);
    for _ in 0..30 {
        match g.legal_moves().into_iter().next() {
            Some(mv) => g.play_move(mv).unwrap(),
            None => break,
        }
    }
    g
}

#[test]
fn an_honest_record_verifies_and_carries_the_score() {
    let base = 20_260_802;
    let opts = DealOptions::default();
    let g = play_a_run(base, opts);
    let packed = pack_seed(base, opts);

    let record = attest::<Blockdoku>(packed, g.moves().to_vec(), Outcome::Stuck, Some(false));
    let v = verify::<Blockdoku>(&record);
    assert!(
        v.ok,
        "honest record verifies: {} vs {}",
        v.expected, v.actual
    );
    assert_eq!(record.score, Some(g.score()), "score surfaced");
    assert_eq!(record.kind, "blockdoku");
}

#[test]
fn a_tampered_hash_fails_verification() {
    let base = 7;
    let opts = DealOptions::default();
    let g = play_a_run(base, opts);
    let packed = pack_seed(base, opts);
    let mut record = attest::<Blockdoku>(packed, g.moves().to_vec(), Outcome::Stuck, Some(false));
    record.final_hash = "0".repeat(64);
    assert!(!verify::<Blockdoku>(&record).ok, "tampered hash rejected");
}

#[test]
fn options_travel_with_the_packed_seed() {
    // A hard-mode run packs its difficulty into the seed; replay reconstructs it,
    // so the record verifies without the options being carried separately.
    let base = 555;
    let opts = DealOptions {
        difficulty: Difficulty::Hard,
        ..DealOptions::default()
    };
    let g = play_a_run(base, opts);
    let packed = pack_seed(base, opts);
    let record = attest::<Blockdoku>(packed, g.moves().to_vec(), Outcome::Stuck, Some(false));
    assert!(
        verify::<Blockdoku>(&record).ok,
        "hard-mode record verifies via packed seed"
    );
}
