//! Mid-run deadlock reshuffle. When a move's cascade settles into a board with
//! no legal swap, the core reshuffles the gems **deterministically** (consuming
//! the game RNG) into a live, match-free board — so `Match3::replay` reshuffles
//! identically and the outcome stays verifiable. These tests pin the pure
//! reshuffle op and the post-move invariant it upholds.

use match3_core::rng::DetRng;
use match3_core::{deal, find_matches, has_legal_move, reshuffle_if_dead, Board, Game};

/// A 1×5 row with multiset {0,0,0,1,1}: no swap makes a run, so it is dead, yet
/// it has no rest-matches — a genuine deadlock that a rearrangement can escape
/// (e.g. `00101`, where swapping the middle pair forms a triple).
fn dead_board() -> Board {
    let b = Board::from_rows(&["01010"]).expect("valid board");
    assert!(
        find_matches(&b).is_empty(),
        "fixture is settled (no matches)"
    );
    assert!(!has_legal_move(&b), "fixture is genuinely deadlocked");
    b
}

#[test]
fn reshuffle_turns_a_dead_board_live_and_match_free() {
    let mut board = dead_board();
    let mut rng = DetRng::from_seed(1);

    let live = reshuffle_if_dead(&mut board, &mut rng);

    assert!(live, "the multiset can be rearranged into a live board");
    assert!(has_legal_move(&board), "reshuffled board has a legal move");
    assert!(
        find_matches(&board).is_empty(),
        "reshuffled board has no free matches"
    );
}

#[test]
fn reshuffle_is_deterministic() {
    let mut a = dead_board();
    let mut b = dead_board();
    assert!(reshuffle_if_dead(&mut a, &mut DetRng::from_seed(9)));
    assert!(reshuffle_if_dead(&mut b, &mut DetRng::from_seed(9)));
    assert_eq!(
        a.to_rows(),
        b.to_rows(),
        "same board + seed → same reshuffle"
    );
}

#[test]
fn reshuffle_leaves_an_already_live_board_untouched() {
    // A live, settled board must be returned unchanged, consuming no draws, so
    // normal moves are byte-identical to the pre-reshuffle engine.
    let mut board = deal(7, 8, 8, 6);
    assert!(has_legal_move(&board), "deal guarantees a live start");
    let before = board.to_rows();
    let mut rng = DetRng::from_seed(0);

    let live = reshuffle_if_dead(&mut board, &mut rng);

    assert!(live);
    assert_eq!(board.to_rows(), before, "a live board is untouched");
    assert_eq!(rng.draws(), 0, "no draws consumed for a live board");
}

#[test]
fn play_move_never_leaves_a_reachable_deadlock() {
    // The invariant the reshuffle upholds: after any legal move, the board still
    // has a legal move (across many seeds and the whole greedy line).
    for seed in 0..40u64 {
        let mut game = Game::new(deal(seed, 8, 8, 6), seed, 6);
        for _ in 0..20 {
            let swaps = match3_core::legal_swaps(&game.board);
            let Some(&(from, to)) = swaps.first() else {
                break;
            };
            let report = game.play_move(from, to);
            assert!(report.legal, "seed {seed}: chose a legal swap");
            assert!(
                has_legal_move(&game.board),
                "seed {seed}: board stays live after a move (reshuffled if needed)"
            );
        }
    }
}
