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

use dots_core::{apply_move, legal_edges, state_hash, Board, Edge};

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
    let mut pos = Board::empty();
    for &e in moves {
        let mv = Edge(e);
        if legal_edges(&pos).contains(&mv) {
            pos = apply_move(&pos, mv);
        }
    }
    pos
}

const VECTORS: [&str; 2] = [
    include_str!("../vectors/01-empty.json"),
    include_str!("../vectors/02-lowest-legal-game.json"),
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
fn the_full_game_vector_really_finishes_the_board() {
    // Guards against a vector that looks like a full game but is not -- the kind
    // of fixture that passes forever while covering nothing.
    let v = parse(VECTORS[1]);
    let pos = replay(&v.moves);
    assert!(
        pos.is_complete(),
        "the full-game vector must draw every edge"
    );
    let (a, b) = pos.box_counts();
    assert_eq!(a + b, 9, "every box is claimed");
    assert_eq!(v.moves.len(), 24, "a full game is exactly 24 moves");
}

#[test]
fn the_empty_vector_is_the_opening_position() {
    let v = parse(VECTORS[0]);
    assert!(v.moves.is_empty());
    assert_eq!(replay(&v.moves), Board::empty());
}
