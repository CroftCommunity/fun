//! Outcome attest/verify exercised two ways: a trivial `Game` (covering the
//! Won / not-won / tamper branches generically) and the **real** `solitaire-core`
//! (a partial record replayed through the actual engine — not a mock).

use pond_outcome::{attest, clean_clear, from_doc, to_doc, verify, Game, Outcome, Replayed};
use solitaire_core::{state_hash, GameState, Move};

// --- a trivial Game to cover the generic branches deterministically ---
struct Counter;
impl Game for Counter {
    type Move = u8;
    const KIND: &'static str = "counter";
    const VERSION: u32 = 1;
    fn replay(seed: u64, moves: &[u8]) -> Replayed {
        let sum: u64 = moves.iter().map(|&m| u64::from(m)).sum();
        Replayed::new(format!("{seed}:{sum}"), moves.last() == Some(&255))
    }
}

#[test]
fn won_record_verifies_and_tamper_is_detected() {
    let record = attest::<Counter>(1, vec![1, 2, 255], Outcome::Abandoned, Some(false));
    assert_eq!(record.result, Outcome::Won);
    assert!(verify::<Counter>(&record).ok);
    assert!(clean_clear(&record));

    // Tamper the stored hash → verify fails, and reports expected vs actual.
    let mut bad = record.clone();
    bad.final_hash = "1:999".into();
    let v = verify::<Counter>(&bad);
    assert!(!v.ok);
    assert_eq!(v.actual, "1:258");

    // Tamper a move → the replay hash diverges → verify fails.
    let mut bad_moves = record.clone();
    bad_moves.moves = vec![9, 9, 255];
    assert!(!verify::<Counter>(&bad_moves).ok);
}

#[test]
fn unfinished_game_records_the_declared_outcome() {
    let stuck = attest::<Counter>(2, vec![1, 2, 3], Outcome::Stuck, Some(false));
    assert_eq!(stuck.result, Outcome::Stuck);
    assert!(!clean_clear(&stuck)); // not a win
    assert!(verify::<Counter>(&stuck).ok); // still a faithful record of where it ended
}

#[test]
fn assistance_declaration_gates_clean_clear() {
    let assisted = attest::<Counter>(1, vec![255], Outcome::Abandoned, Some(true));
    assert!(!clean_clear(&assisted)); // won but assisted
    let undeclared = attest::<Counter>(1, vec![255], Outcome::Abandoned, None);
    assert!(!clean_clear(&undeclared)); // won but assistance not declared
}

#[test]
fn record_round_trips_through_the_envelope() {
    let record = attest::<Counter>(7, vec![1, 255], Outcome::Abandoned, Some(false));
    let bytes = to_doc::<Counter>(&record).unwrap();
    let back = from_doc::<Counter>(&bytes).unwrap();
    assert_eq!(back, record);
}

// --- the real solitaire engine (not a mock) ---
struct Solitaire;
impl Game for Solitaire {
    type Move = Move;
    const KIND: &'static str = "solitaire";
    const VERSION: u32 = 1;
    fn replay(seed: u64, moves: &[Move]) -> Replayed {
        let mut game = GameState::new_game(seed);
        for &mv in moves {
            let _ = game.play_move(mv); // illegal moves are no-ops; the hash still diverges if tampered
        }
        Replayed::new(state_hash(&game), game.is_won())
    }
}

#[test]
fn real_solitaire_partial_record_verifies_and_tamper_is_detected() {
    // A partial (unfinished) game through the actual engine — a full Klondike
    // win line is captured from the solver fixture in Phase S; here we prove
    // attest/verify run through solitaire-core and detect tampering.
    let moves = vec![Move::Draw, Move::Draw, Move::Draw];
    let record = attest::<Solitaire>(0, moves, Outcome::Abandoned, Some(false));
    assert_eq!(record.result, Outcome::Abandoned);
    assert!(verify::<Solitaire>(&record).ok);

    // Tamper: drop a move → the replayed solitaire hash diverges → verify fails.
    let mut tampered = record.clone();
    tampered.moves = vec![Move::Draw];
    assert!(!verify::<Solitaire>(&tampered).ok);
}
