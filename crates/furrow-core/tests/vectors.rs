//! Golden vectors — the locked `(seed, moves) -> state_hash` corpus.
//!
//! These files are the shared truth between two checks that must agree:
//!
//! - **this test**, which replays each vector natively and asserts the recorded
//!   hash, so the files cannot drift from the core; and
//! - **`crates/xbuild`**, which replays the same vectors inside
//!   `wasm32-unknown-unknown` and asserts the same recorded hash, which is what
//!   makes `native == wasm` a checked property rather than a claim.
//!
//! A vector is parsed with a deliberately small hand-rolled reader rather than a
//! JSON dependency: the corpus shape is three fields, and a test that pulls in a
//! parser to read its own fixtures is testing the parser too.

use adversary_core::Side;
use furrow_core::{apply_move, legal_pits, state_hash, Board, Pit, TOTAL_SEEDS};

struct Vector {
    name: String,
    moves: Vec<u8>,
    final_state_hash: String,
}

/// Pull `"key": value` out of a flat JSON object. Returns the raw slice.
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
    let moves_raw = {
        let at = src.find("\"moves\"").expect("vector has moves");
        let open = src[at..].find('[').expect("moves is an array") + at;
        let close = src[open..].find(']').expect("moves array closes") + open;
        src[open + 1..close].to_string()
    };
    let moves = moves_raw
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.parse::<u8>().expect("a move is a small integer"))
        .collect();
    Vector {
        name: unquote(field(src, "name")),
        moves,
        final_state_hash: unquote(field(src, "final_state_hash")),
    }
}

/// Replay a move list the way `pond_outcome::verify` does: skip anything that
/// could not legally have been played.
fn replay(moves: &[u8]) -> Board {
    let mut pos = Board::opening();
    for &p in moves {
        let mv = Pit(p);
        if legal_pits(&pos).contains(&mv) {
            pos = apply_move(&pos, mv);
        }
    }
    pos
}

const VECTORS: [&str; 3] = [
    include_str!("../vectors/01-opening.json"),
    include_str!("../vectors/02-lowest-legal-game.json"),
    include_str!("../vectors/03-extra-turn-chain.json"),
];

#[test]
fn every_vector_replays_to_its_recorded_hash() {
    for src in VECTORS {
        let v = parse(src);
        let pos = replay(&v.moves);
        assert_eq!(
            state_hash(&pos),
            v.final_state_hash,
            "vector {} replayed to a different hash than it records",
            v.name
        );
    }
}

#[test]
fn the_opening_vector_is_the_opening_position() {
    let v = parse(VECTORS[0]);
    assert!(v.moves.is_empty());
    assert_eq!(replay(&v.moves), Board::opening());
}

#[test]
fn both_game_vectors_really_finish_and_really_sweep() {
    // Guards against a fixture that looks like a full game but is not -- the kind
    // that passes forever while covering nothing. A finished game here holds
    // nothing outside the stores, because the sweep put it all away.
    for src in [VECTORS[1], VECTORS[2]] {
        let v = parse(src);
        let pos = replay(&v.moves);
        assert!(
            legal_pits(&pos).is_empty(),
            "vector {} does not reach a terminal",
            v.name
        );
        assert_eq!(pos.in_play(), 0, "vector {} was not swept", v.name);
        assert_eq!(
            pos.store(Side::A) + pos.store(Side::B),
            TOTAL_SEEDS,
            "vector {} lost or invented seeds",
            v.name
        );
    }
}

#[test]
fn the_chain_vector_really_contains_a_long_extra_turn_chain() {
    // The reason this vector exists: it must walk the path where the turn does
    // not pass. A vector that never chained would cross-check the easy half of
    // the rules and call it native == wasm.
    let v = parse(VECTORS[2]);
    let mut pos = Board::opening();
    let mut longest = 1;
    let mut run = 1;
    for w in v.moves.windows(2) {
        let before = pos.to_move;
        pos = apply_move(&pos, Pit(w[0]));
        if pos.to_move == before {
            run += 1;
            longest = std::cmp::max(longest, run);
        } else {
            run = 1;
        }
        let _ = w[1];
    }
    assert!(
        longest >= 4,
        "the chain vector's longest extra-turn run was {longest}, expected at least 4"
    );
}

#[test]
fn the_sweep_vector_ends_on_a_side_emptying_rather_than_a_full_board() {
    // The lowest-legal game ends the way only this shelf game can: A runs out of
    // seeds with 36 still sitting on B's side, and B takes them all. If the
    // sweep ever stopped firing, this vector's score would be the accumulated
    // one and the hash would move.
    let v = parse(VECTORS[1]);
    let pos = replay(&v.moves);
    assert_eq!(pos.store(Side::A), 12);
    assert_eq!(pos.store(Side::B), 36);
}
