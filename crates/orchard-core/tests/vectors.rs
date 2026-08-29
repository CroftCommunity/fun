//! Golden vectors — the recorded behaviour a change to the rules has to
//! acknowledge.
//!
//! These lock the whole stack, not one function: a vector fails if the ladder,
//! the merge tie-break, the scoring, the cooldown, the game-over dwell, the
//! seeded stream, the physics underneath, or the hash changes. That breadth is
//! the point — it is what makes them the artifact the Phase 6 cross-build check
//! compares native against wasm.
//!
//! Regenerate with `ORCHARD_RECORD=1` and paste the printed hashes — and only
//! when a behaviour change is *intended*. A vector updated to make a test pass
//! has stopped being a vector.

use orchard_core::game::{Game, Move, COOLDOWN_TICKS};
use orchard_core::ladder;
use orchard_core::outcome::Orchard;
use pond_outcome::{attest, verify, Outcome};

/// Play a scripted run: `drops` drops walking across the crate, then settle.
fn scripted(seed: u64, drops: u32, settle: u32) -> Game {
    let mut g = Game::new(seed);
    let mut t = 0;
    for i in 0..drops {
        let _ = g.apply(Move::Drop {
            tick: t,
            x: 60 + 40 * (i as i32 % 8),
        });
        t += COOLDOWN_TICKS;
    }
    let _ = g.apply(Move::Wait { tick: t + settle });
    g
}

/// Play down one column until the crate overflows.
fn to_game_over(seed: u64) -> Game {
    let mut g = Game::new(seed);
    let mut t = 0;
    for _ in 0..400 {
        if g.is_over() {
            break;
        }
        let _ = g.apply(Move::Drop { tick: t, x: 220 });
        let _ = g.apply(Move::Wait {
            tick: t + COOLDOWN_TICKS,
        });
        t += COOLDOWN_TICKS;
    }
    g
}

fn v01_fresh() -> Game {
    Game::new(1)
}
fn v02_one_drop() -> Game {
    scripted(1, 1, 400)
}
fn v03_short_run() -> Game {
    scripted(11, 8, 600)
}
fn v04_merges() -> Game {
    scripted(3, 24, 900)
}
fn v05_to_game_over() -> Game {
    to_game_over(5)
}

type Vector = (&'static str, &'static str, fn() -> Game, &'static str);

const VECTORS: [Vector; 5] = [
    (
        "01-fresh",
        "A new game on seed 1: an empty crate, a held and a previewed fruit.",
        v01_fresh,
        "41529b8d41188465553a2881afe2bae850717fa7fb8d111e49108e2e011bacba",
    ),
    (
        "02-one-drop",
        "One drop, settled. The simplest state the physics contributes to.",
        v02_one_drop,
        "6326672fe5432dde37220dedf98bb815a326d606c94c6b3c0aa67647072da978",
    ),
    (
        "03-short-run",
        "Eight drops across the crate, then settling. Locks the cooldown and the stream.",
        v03_short_run,
        "a8c8979d0d1c350691a0707b661e71d1c7d8b8ddc9b4ee4c65f845fd4e788d53",
    ),
    (
        "04-merges",
        "Twenty-four drops: enough for the ladder to climb. Locks the merge tie-break and scoring.",
        v04_merges,
        "d11ccd669b72d58b209487efa911e610ad937309f5fbeff50d61bae713fdcafb",
    ),
    (
        "05-to-game-over",
        "One column until the crate overflows. Locks the grace and the dwell.",
        v05_to_game_over,
        "38d82d08243f88e883d36aa4575a2caf808c35227b94bcb42ef937c57529b05c",
    ),
];

#[test]
fn golden_vectors_hold() {
    let record = std::env::var("ORCHARD_RECORD").is_ok();
    let mut drift = Vec::new();
    for (name, note, build, expected) in VECTORS {
        let got = build().state_hash();
        if record {
            println!("        \"{got}\",  // {name}");
        } else if got != *expected {
            drift.push(format!(
                "  {name}\n    expected {expected}\n    got      {got}\n    ({note})"
            ));
        }
    }
    assert!(
        drift.is_empty(),
        "golden vectors drifted:\n{}\n\nIf the change was intended, re-record with \
         ORCHARD_RECORD=1 and say why in the commit.",
        drift.join("\n")
    );
}

// ── believability guards ───────────────────────────────────────────────────
// A vector that hashes stably because nothing happened proves nothing.

#[test]
fn the_merge_vector_actually_climbed_the_ladder() {
    let g = v04_merges();
    assert!(g.score() > 0, "no merge scored across twenty-four drops");
    assert!(
        g.max_tier() > 0,
        "the ladder never climbed above the droppable tiers"
    );
    assert!(
        g.fruit_count() < 24,
        "24 drops left {} fruit — nothing merged",
        g.fruit_count()
    );
}

#[test]
fn the_game_over_vector_actually_ended() {
    let g = v05_to_game_over();
    assert!(g.is_over(), "the crate never overflowed");
    assert!(g.tick() > 0);
}

#[test]
fn the_fresh_vector_is_a_fresh_game() {
    let g = v01_fresh();
    assert_eq!(g.tick(), 0);
    assert_eq!(g.fruit_count(), 0);
    assert_eq!(g.score(), 0);
    assert!(!g.is_over());
    assert!(ladder::is_droppable(g.held()) && ladder::is_droppable(g.next()));
}

#[test]
fn every_vector_hashes_differently() {
    // Five scenarios that collided would look locked while testing one thing.
    let mut hashes: Vec<String> = VECTORS
        .iter()
        .map(|(_, _, b, _)| b().state_hash())
        .collect();
    let n = hashes.len();
    hashes.sort();
    hashes.dedup();
    assert_eq!(hashes.len(), n, "two vectors reach the same state");
}

// ── the record round-trip ──────────────────────────────────────────────────

#[test]
fn a_full_run_attests_and_verifies() {
    let mut g = Game::new(5);
    let mut moves = Vec::new();
    let mut t = 0;
    for _ in 0..400 {
        if g.is_over() {
            break;
        }
        let d = Move::Drop { tick: t, x: 220 };
        if g.apply(d).is_ok() {
            moves.push(d);
        }
        let w = Move::Wait {
            tick: t + COOLDOWN_TICKS,
        };
        if g.apply(w).is_ok() {
            moves.push(w);
        }
        t += COOLDOWN_TICKS;
    }
    assert!(g.is_over(), "the run did not finish");

    let record = attest::<Orchard>(5, moves, Outcome::Lost, Some(false));
    assert!(verify::<Orchard>(&record).ok, "a real run failed to verify");
    assert_eq!(record.final_hash, g.state_hash());
    assert_eq!(record.score, Some(g.score()));
}
