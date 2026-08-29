//! Golden vectors — the locked `(seed, moves) -> state_hash` corpus, shared
//! with `crates/xbuild`, which replays the same files inside
//! `wasm32-unknown-unknown` and asserts the same hash (`native == wasm`).
//!
//! The reader is hand-rolled on purpose (the furrow precedent): three fields,
//! and a test that pulls in a parser to read its own fixtures tests the parser.

use cribbage_core::{replay, state_hash, Move, Phase, Seat};

struct Vector {
    name: String,
    seed: u64,
    moves: Vec<Move>,
    final_state_hash: String,
}

fn field<'a>(src: &'a str, key: &str) -> &'a str {
    let needle = format!("\"{key}\"");
    let at = src
        .find(&needle)
        .unwrap_or_else(|| panic!("vector is missing {key}"));
    let rest = &src[at + needle.len()..];
    let colon = rest.find(':').expect("key is followed by a colon");
    let value = &rest[colon + 1..];
    let end = value.find([',', '\n', '}']).unwrap_or(value.len());
    value[..end].trim()
}

fn parse(src: &str) -> Vector {
    let unquote = |s: &str| s.trim().trim_matches('"').to_string();
    let at = src.find("\"moves\"").expect("vector has moves");
    let open = src[at..].find('[').expect("moves is an array") + at;
    let close = src[open..].find(']').expect("moves array closes") + open;
    let moves = src[open + 1..close]
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| Move::from_code(s.parse::<u8>().expect("a move is a small integer")).expect("a real move code"))
        .collect();
    Vector {
        name: unquote(field(src, "name")),
        seed: field(src, "seed").parse().expect("seed is an integer"),
        moves,
        final_state_hash: unquote(field(src, "final_state_hash")),
    }
}

const VECTORS: [&str; 3] = [
    include_str!("../vectors/01-opening.json"),
    include_str!("../vectors/02-full-game-with-gos-and-muggins.json"),
    include_str!("../vectors/03-skunk.json"),
];

#[test]
fn every_vector_replays_to_its_recorded_hash() {
    for src in VECTORS {
        let v = parse(src);
        assert_eq!(
            state_hash(&replay(v.seed, &v.moves)),
            v.final_state_hash,
            "vector {} replayed to a different hash than it records",
            v.name
        );
    }
}

#[test]
fn the_opening_vector_is_a_fresh_deal() {
    let v = parse(VECTORS[0]);
    assert!(v.moves.is_empty());
    let s = replay(v.seed, &v.moves);
    assert_eq!(s.phase(), Phase::Discard);
    assert_eq!(s.deal_no(), 1);
}

#[test]
fn the_game_vectors_really_finish_and_the_skunk_is_worth_two() {
    let full = replay(7, &parse(VECTORS[1]).moves);
    let out = full.outcome().expect("vector 2 reaches 121");
    assert_eq!(out.winner, Seat::B);
    assert_eq!(out.value, 1);
    assert!(parse(VECTORS[1]).moves.contains(&Move::Go), "vector 2 declares a go");

    let skunk = replay(5, &parse(VECTORS[2]).moves);
    let out = skunk.outcome().expect("vector 3 reaches 121");
    assert_eq!(out.value, 2, "A on {} is a skunk", skunk.scores()[0]);
    assert_eq!(skunk.scores(), [81, 121]);
}

#[test]
fn every_move_in_the_corpus_was_legal_when_played() {
    // Replay skips refused moves silently by design; a vector that leans on
    // that would lock a lie. Check each move was accepted.
    for src in &VECTORS[1..] {
        let v = parse(src);
        let mut s = cribbage_core::GameState::new(v.seed);
        for (i, &m) in v.moves.iter().enumerate() {
            s = cribbage_core::apply(&s, m).unwrap_or_else(|e| panic!("{}: move {i} ({m:?}) refused: {e}", v.name));
        }
    }
}
