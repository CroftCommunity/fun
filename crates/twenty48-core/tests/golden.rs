//! Golden vectors for slide/merge + the state hash (T1). Merge results are
//! hand-derived (see comments); the hash golden is a regression anchor.

use twenty48_core::rng::DetRng;
use twenty48_core::{has_any_move, slide, spawn, state_hash, Board, Direction};

fn rows(r: &[&[u8]]) -> Board {
    Board::from_rows(r)
}

#[test]
fn merge_left_is_once_per_pair_and_scores() {
    // [2,2,2,2] left -> [4,4,_,_]; two merges; score += 2^2 + 2^2 = 8.
    let mut b = rows(&[&[1, 1, 1, 1]]);
    let rep = slide(&mut b, Direction::Left);
    assert_eq!(b.cells(), &[2, 2, 0, 0]);
    assert!(rep.changed);
    assert_eq!(rep.score_gain, 8);

    // [2,2,4,_] left -> the pair merges to a 4, which does NOT merge again with
    // the existing 4 this move -> [4,4,_,_]; score += 2^2 = 4.
    let mut b = rows(&[&[1, 1, 2, 0]]);
    let rep = slide(&mut b, Direction::Left);
    assert_eq!(
        b.cells(),
        &[2, 2, 0, 0],
        "merge-once: produced tile is inert"
    );
    assert_eq!(rep.score_gain, 4);
}

#[test]
fn slide_without_merge_and_no_op() {
    // A gap-closing slide with no merge: changed, zero gain.
    let mut b = rows(&[&[0, 1, 0, 2]]);
    let rep = slide(&mut b, Direction::Left);
    assert_eq!(b.cells(), &[1, 2, 0, 0]);
    assert!(rep.changed);
    assert_eq!(rep.score_gain, 0);

    // Already packed left with no merge: unchanged (an illegal move).
    let mut b = rows(&[&[1, 2, 0, 0]]);
    let rep = slide(&mut b, Direction::Left);
    assert!(!rep.changed, "a slide that changes nothing is not a move");
    assert_eq!(b.cells(), &[1, 2, 0, 0]);
}

#[test]
fn right_up_down_directions() {
    // [2,2,4,_] right -> [_,_,4,4]; score 4.
    let mut b = rows(&[&[1, 1, 2, 0]]);
    let rep = slide(&mut b, Direction::Right);
    assert_eq!(b.cells(), &[0, 0, 2, 2]);
    assert_eq!(rep.score_gain, 4);

    // A column merge up: two 2s in a column -> a 4 at the top.
    let mut b = rows(&[&[1, 0], &[1, 0]]);
    let rep = slide(&mut b, Direction::Up);
    assert_eq!(b.cells(), &[2, 0, 0, 0]);
    assert_eq!(rep.score_gain, 4);

    // Same column, down -> the 4 at the bottom.
    let mut b = rows(&[&[1, 0], &[1, 0]]);
    slide(&mut b, Direction::Down);
    assert_eq!(b.cells(), &[0, 0, 2, 0]);
}

#[test]
fn whole_board_left_accumulates_score() {
    // rows: [2,2,_,_] gain 4 ; [4,_,4,_] gain 8 ; [8,8,8,8] gain 16+16=32 ; empty.
    let mut b = rows(&[&[1, 1, 0, 0], &[2, 0, 2, 0], &[3, 3, 3, 3], &[0, 0, 0, 0]]);
    let rep = slide(&mut b, Direction::Left);
    assert_eq!(b.cells(), &[2, 0, 0, 0, 3, 0, 0, 0, 4, 4, 0, 0, 0, 0, 0, 0]);
    assert_eq!(rep.score_gain, 4 + 8 + 32);
}

#[test]
fn win_is_exponent_eleven() {
    let mut b = rows(&[&[10, 10, 0, 0]]);
    slide(&mut b, Direction::Left);
    assert_eq!(b.max_exponent(), 11, "two 1024s merge to 2048 (exp 11)");
}

#[test]
fn stuck_detection() {
    // A full board with no equal neighbours: no move changes it.
    let full = rows(&[&[1, 2, 1, 2], &[2, 1, 2, 1], &[1, 2, 1, 2], &[2, 1, 2, 1]]);
    assert!(full.is_full());
    assert!(!has_any_move(&full), "checkerboard-full board is stuck");

    // A full board with an equal adjacent pair still has a move.
    let full_pair = rows(&[&[1, 1, 1, 2], &[2, 1, 2, 1], &[1, 2, 1, 2], &[2, 1, 2, 1]]);
    assert!(full_pair.is_full());
    assert!(has_any_move(&full_pair));
}

#[test]
fn spawn_is_seed_deterministic() {
    let mut b1 = Board::empty(4, 4);
    let mut r1 = DetRng::from_seed(42);
    let mut b2 = Board::empty(4, 4);
    let mut r2 = DetRng::from_seed(42);
    for _ in 0..3 {
        assert!(spawn(&mut b1, &mut r1));
        assert!(spawn(&mut b2, &mut r2));
    }
    assert_eq!(b1.cells(), b2.cells(), "same seed -> same spawns");
    // Spawns only ever place a 2 (exp 1) or a 4 (exp 2).
    assert!(b1.cells().iter().all(|&v| v == 0 || v == 1 || v == 2));
    assert_eq!(b1.cells().iter().filter(|&&v| v != 0).count(), 3);
}

#[test]
fn state_hash_is_pinned_and_sensitive() {
    let b = rows(&[&[1, 1, 0, 0], &[0, 2, 0, 0], &[0, 0, 3, 0], &[0, 0, 0, 4]]);
    let h = state_hash(&b, 7, 128);
    assert_eq!(h.len(), 64);
    assert_eq!(
        h, "d3151811341e41ac787983c30a35d963b7006dd01956d489a2237cec9c40649b",
        "canonical state-hash encoding is stable"
    );
    // Score and draws are bound into the hash.
    assert_ne!(state_hash(&b, 7, 129), h);
    assert_ne!(state_hash(&b, 8, 128), h);
}
