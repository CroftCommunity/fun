//! Golden vectors — the locked `(level, releases) -> state_hash` corpus.
//!
//! These files are the shared truth between two checks that must agree:
//!
//! - **this test**, which replays each vector natively and asserts the recorded
//!   hash, so the files cannot drift from the core; and
//! - **`crates/xbuild`**, which replays the same vectors inside
//!   `wasm32-unknown-unknown` and asserts the same recorded hash, which is what
//!   makes `native == wasm` a checked property rather than a claim.
//!
//! Enrolled with the locks (plan 2026-09-08, phase 2): the generator's lock
//! draw and the lock rule in `release` are integer-only, and these vectors are
//! where a `usize` or a float reaching either would show as a divergence.
//!
//! A vector's `moves` may be a **directive** while it is being recorded —
//! `GREEDY-ALL`, `GREEDY-THROUGH-<id>`, or `<id>+GREEDY-THROUGH-<id>` — and the
//! test then fails with the concrete list and hash to write into the file. A
//! committed vector carries the concrete list; a directive left in a file is a
//! red test, never a green one that graded nothing.

use looseends_core::{state_hash, Origin};

const VECTORS: &[(&str, &str)] = &[
    (
        "01-level-8-fresh.json",
        include_str!("../vectors/01-level-8-fresh.json"),
    ),
    (
        "02-level-8-key-then-lock.json",
        include_str!("../vectors/02-level-8-key-then-lock.json"),
    ),
    (
        "03-level-8-lock-tapped-first.json",
        include_str!("../vectors/03-level-8-lock-tapped-first.json"),
    ),
    (
        "04-level-100-greedy-clear.json",
        include_str!("../vectors/04-level-100-greedy-clear.json"),
    ),
];

/// Replay a release list the way `pond_outcome::verify` does: a blocked, locked,
/// gone or unknown id is a no-op.
fn replay(level: u32, moves: &[u8]) -> looseends_core::Board {
    let mut board = Origin::Level(level).board();
    for &id in moves {
        let _ = board.release(id as usize);
    }
    board
}

/// The greedy release order for a level (the solvability proof's order).
fn greedy_order(level: u32) -> Vec<u8> {
    let mut board = Origin::Level(level).board();
    board
        .greedy_solve()
        .into_iter()
        .map(|id| u8::try_from(id).expect("an id fits a byte"))
        .collect()
}

#[test]
fn every_vector_replays_natively_to_its_recorded_hash() {
    let mut to_record = Vec::new();
    for (file, src) in VECTORS {
        let v: serde_json::Value = serde_json::from_str(src).expect("vector parses");
        let level = v["level"].as_u64().expect("level") as u32;
        let want = v["final_state_hash"].as_str().expect("hash");
        let moves: Vec<u8> = match &v["moves"] {
            serde_json::Value::Array(a) => a
                .iter()
                .map(|m| u8::try_from(m.as_u64().expect("id")).expect("byte"))
                .collect(),
            serde_json::Value::String(directive) => {
                let (prefix, rest) = match directive.split_once('+') {
                    Some((p, r)) => (Some(p.parse::<u8>().expect("prefix id")), r),
                    None => (None, directive.as_str()),
                };
                let order = greedy_order(level);
                let mut list: Vec<u8> = prefix.into_iter().collect();
                if rest == "GREEDY-ALL" {
                    list.extend(order);
                } else if let Some(through) = rest.strip_prefix("GREEDY-THROUGH-") {
                    let through: u8 = through.parse().expect("through id");
                    let cut = order
                        .iter()
                        .position(|&id| id == through)
                        .expect("id in order");
                    list.extend(&order[..=cut]);
                } else {
                    panic!("{file}: unknown directive {directive}");
                }
                let hash = state_hash(&replay(level, &list));
                to_record.push(format!(
                    "{file}: RECORD moves {list:?} final_state_hash {hash}"
                ));
                continue;
            }
            other => panic!("{file}: moves is {other}"),
        };
        if want == "TBD" {
            to_record.push(format!(
                "{file}: RECORD final_state_hash {}",
                state_hash(&replay(level, &moves))
            ));
            continue;
        }
        let got = state_hash(&replay(level, &moves));
        assert_eq!(got, want, "{file}: native replay hash");
    }
    assert!(
        to_record.is_empty(),
        "vectors still to record:\n{}",
        to_record.join("\n")
    );
}

#[test]
fn the_lock_vectors_agree_and_level_100_clears() {
    // 02 and 03 must hash the same: a locked tap in front is a no-op.
    let read = |i: usize| -> serde_json::Value { serde_json::from_str(VECTORS[i].1).unwrap() };
    assert_eq!(read(1)["final_state_hash"], read(2)["final_state_hash"]);
    // 04 is a cleared board.
    let v = read(3);
    if let serde_json::Value::Array(a) = &v["moves"] {
        let moves: Vec<u8> = a.iter().map(|m| m.as_u64().unwrap() as u8).collect();
        assert!(replay(100, &moves).is_cleared(), "level 100 clears");
    }
}
