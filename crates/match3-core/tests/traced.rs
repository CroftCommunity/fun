//! `play_move_traced` — the additive, animation-oriented sibling of `play_move`.
//! It must resolve **identically** (same RNG stream → byte-identical final board,
//! `state_hash`, and `MoveReport`) while also emitting a board snapshot per
//! cascade phase so the UI can animate clear→fall→refill. These tests are the
//! determinism proof: the trace is a *view* of the same resolution, never a
//! second code path that could drift.

use match3_core::{find_matches, Board, Game};

/// A board whose move (0,2)→(0,3) completes a horizontal three at row 0
/// (the `01-horizontal-match-basic` golden vector), seed 42.
fn cascading_game() -> Game {
    let board =
        Board::from_rows(&["00102", "34523", "45345", "53453", "34534"]).expect("valid board");
    Game::new(board, 42, 6)
}

#[test]
fn traced_ends_in_the_same_state_as_atomic() {
    let mut atomic = cascading_game();
    let mut traced = cascading_game();

    let report_atomic = atomic.play_move((0, 2), (0, 3));
    let (report_traced, snapshots) = traced.play_move_traced((0, 2), (0, 3));

    assert_eq!(report_traced, report_atomic, "MoveReport must be identical");
    assert_eq!(
        traced.board, atomic.board,
        "traced final board must equal atomic final board"
    );
    assert_eq!(
        traced.state_hash(),
        atomic.state_hash(),
        "traced final state_hash must equal atomic (determinism anchor)"
    );
    assert!(!snapshots.is_empty(), "a legal move emits snapshots");
}

#[test]
fn snapshots_run_from_the_swap_to_the_settled_board() {
    let mut traced = cascading_game();
    let start = traced.board.clone();
    let (_report, snapshots) = traced.play_move_traced((0, 2), (0, 3));

    // The first snapshot is the board *right after the swap*, before any clear —
    // so it still contains the freshly-formed match.
    assert_ne!(snapshots[0], start, "first snapshot reflects the swap");
    assert!(
        !find_matches(&snapshots[0]).is_empty(),
        "first snapshot still holds the un-cleared match"
    );

    // Enough phases to animate a full clear→fall→refill (swap + ≥3 phases).
    assert!(snapshots.len() >= 4, "at least swap + one cascade step");

    // The last snapshot is the settled board the move commits to.
    let last = snapshots.last().expect("non-empty");
    assert_eq!(last, &traced.board, "last snapshot is the committed board");
    assert!(
        find_matches(last).is_empty(),
        "the committed board is settled (no matches)"
    );
}

#[test]
fn an_illegal_move_traces_nothing_and_leaves_the_board() {
    let mut traced = cascading_game();
    let before = traced.board.clone();
    // (0,3)→(0,4) forms no match on this board (the `02-illegal-no-match` vector).
    let (report, snapshots) = traced.play_move_traced((0, 3), (0, 4));

    assert!(!report.legal, "no-match swap is illegal");
    assert!(snapshots.is_empty(), "an illegal move emits no snapshots");
    assert_eq!(traced.board, before, "an illegal move leaves the board");
}
