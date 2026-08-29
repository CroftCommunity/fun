//! Clear-the-jelly substrate (parity Track A). Jelly is a per-cell overlay that
//! sits *under* the gems: a match on a jellied cell scrubs one jelly layer, and
//! the objective is met when no jelly remains. Jelly is orthogonal to the gem/
//! blocker content, so it lives in a parallel grid on `Board` and is folded into
//! `state_hash` **only when present** — gem-only boards hash exactly as before
//! (the existing golden vectors are untouched; that is asserted by their suite).

use trio_tumble_core::{clear_cells, deal_jelly, find_matches, jelly_remaining, Board, Cell, Game};

const W: usize = 8;
const H: usize = 8;
const COLORS: usize = 6;
const JELLY: usize = 6;

#[test]
fn deal_jelly_is_settled_matchless_live_with_the_right_jelly_count() {
    let board = deal_jelly(7, W, H, COLORS, JELLY);
    assert_eq!(board.width, W);
    assert_eq!(board.height, H);
    assert!(board.is_settled(), "no holes at rest");
    assert!(
        find_matches(&board).is_empty(),
        "no free matches in the deal"
    );
    assert!(
        trio_tumble_core::has_legal_move(&board),
        "the deal has at least one legal swap"
    );
    assert_eq!(
        jelly_remaining(&board),
        JELLY as u32,
        "the deal jellies exactly the requested cell count"
    );
    // Every cell is a gem (v1 jelly boards have no blockers).
    assert!(
        board.cells().iter().all(Cell::is_gem),
        "jelly sits under gems"
    );
}

#[test]
fn deal_jelly_is_deterministic() {
    let a = deal_jelly(42, W, H, COLORS, JELLY);
    let b = deal_jelly(42, W, H, COLORS, JELLY);
    assert_eq!(a.to_rows(), b.to_rows(), "same cells");
    assert_eq!(a.jelly(), b.jelly(), "same jelly layout");
}

#[test]
fn jelly_remaining_counts_jellied_cells() {
    let plain = Board::from_rows(&["012", "120", "201"]).expect("valid");
    assert_eq!(jelly_remaining(&plain), 0, "a plain board has no jelly");

    let jellied =
        Board::from_rows_with_jelly(&["012", "120", "201"], &["100", "001", "000"]).expect("valid");
    assert_eq!(jelly_remaining(&jellied), 2, "two cells carry jelly");
}

#[test]
fn a_match_over_jelly_scrubs_one_layer() {
    // Row 0 "001.." with jelly under (0,0) and (0,1). Swap (0,2)/(0,3) lines up
    // three 0s across row 0; clearing them removes the jelly beneath.
    let mut board = Board::from_rows_with_jelly(
        &["00102", "34523", "45345", "53453", "34534"],
        &["11000", "00000", "00000", "00000", "00000"],
    )
    .expect("valid");
    assert_eq!(jelly_remaining(&board), 2);

    // Perform the swap by hand, then clear the resulting match.
    let tmp = board.get(0, 2);
    board.set(0, 2, board.get(0, 3));
    board.set(0, 3, tmp);
    let matched = find_matches(&board);
    assert!(!matched.is_empty(), "the swap forms a match");
    let out = clear_cells(&mut board, &matched);

    assert_eq!(
        out.jelly_layers_removed, 2,
        "both jellied cells were in the match"
    );
    assert_eq!(
        jelly_remaining(&board),
        0,
        "the jelly under the match is gone"
    );
    assert_eq!(board.jelly_at(0, 0), 0, "cleared cell's jelly is scrubbed");
}

#[test]
fn jelly_changes_the_state_hash_but_gem_only_boards_are_unchanged() {
    // A jellied board hashes differently from the same board with no jelly …
    let plain = Game::new(
        Board::from_rows(&["012", "120", "201"]).expect("v"),
        1,
        COLORS,
    );
    let jellied = Game::new(
        Board::from_rows_with_jelly(&["012", "120", "201"], &["100", "000", "000"]).expect("v"),
        1,
        COLORS,
    );
    assert_ne!(
        plain.state_hash(),
        jellied.state_hash(),
        "jelly is part of the verifiable state"
    );
    // … while a board with an all-zero jelly grid hashes identically to a plain
    // one (this is what keeps every pre-jelly golden vector valid).
    let zero_jelly = Game::new(
        Board::from_rows_with_jelly(&["012", "120", "201"], &["000", "000", "000"]).expect("v"),
        1,
        COLORS,
    );
    assert_eq!(
        plain.state_hash(),
        zero_jelly.state_hash(),
        "no jelly => identical to the pre-jelly hash"
    );
}
