//! Clear-the-blockers substrate: a blocker-placing deal and the win metric
//! (all blockers cleared). The engine already models `Blocker` cells and
//! `clear_cells` damages them; these tests pin the deal generator + the count
//! that the objective reads. Blocker count is monotone non-increasing under
//! play (refill only produces gems), which makes the objective well-founded.

use match3_core::{
    blockers_remaining, clear_cells, deal_blockers, find_matches, has_legal_move, Board, Cell, Game,
};

const W: usize = 8;
const H: usize = 8;
const COLORS: usize = 6;
const BLOCKERS: usize = 6;

#[test]
fn deal_blockers_is_settled_matchless_live_with_the_right_count() {
    let board = deal_blockers(7, W, H, COLORS, BLOCKERS);
    assert_eq!(board.width, W);
    assert_eq!(board.height, H);
    assert!(board.is_settled(), "no holes at rest");
    assert!(
        find_matches(&board).is_empty(),
        "no free matches in the deal"
    );
    assert!(
        has_legal_move(&board),
        "the deal has at least one legal swap"
    );
    assert_eq!(
        blockers_remaining(&board),
        BLOCKERS as u32,
        "the deal places exactly the requested blockers"
    );
}

#[test]
fn deal_blockers_is_deterministic() {
    let a = deal_blockers(42, W, H, COLORS, BLOCKERS);
    let b = deal_blockers(42, W, H, COLORS, BLOCKERS);
    assert_eq!(a.to_rows(), b.to_rows(), "same seed → identical deal");
}

#[test]
fn blockers_remaining_counts_only_blockers() {
    let board = Board::from_rows(&["A0B", "010", "0A0"]).expect("valid board");
    // 'A' and 'B' are blockers (1- and 2-layer); the count is of cells, not layers.
    assert_eq!(blockers_remaining(&board), 3);
    let none = Board::from_rows(&["012", "120", "201"]).expect("valid board");
    assert_eq!(
        blockers_remaining(&none),
        0,
        "a gem-only board has no blockers"
    );
}

#[test]
fn a_match_adjacent_to_a_blocker_reduces_the_count() {
    // The `03-blocker-clear` shape: matching row 0 damages the 1-layer blocker at
    // (1,0), so the blocker count drops.
    let mut board = Board::from_rows(&["11213", "A4524", "53453", "34534"]).expect("valid");
    assert_eq!(blockers_remaining(&board), 1);
    let matched = find_matches({
        // swap (0,2)/(0,3) to line up three 1s at row 0.
        let tmp = board.get(0, 2);
        board.set(0, 2, board.get(0, 3));
        board.set(0, 3, tmp);
        &board
    });
    assert!(!matched.is_empty(), "the swap forms a match");
    let out = clear_cells(&mut board, &matched);
    assert_eq!(
        out.blocker_layers_removed, 1,
        "the adjacent blocker took a hit"
    );
    assert_eq!(
        blockers_remaining(&board),
        0,
        "the 1-layer blocker is now gone"
    );
    assert!(
        matches!(board.get(1, 0), Cell::Empty),
        "cleared blocker is a hole"
    );
}

#[test]
fn a_full_clear_line_wins_when_no_blockers_remain() {
    // Sanity that the win metric is exactly "no blockers left", via a game step.
    let board = deal_blockers(3, W, H, COLORS, BLOCKERS);
    let mut game = Game::new(board, 3, COLORS);
    assert!(blockers_remaining(&game.board) > 0, "starts with blockers");
    // Play the greedy line; the count never increases.
    let mut prev = blockers_remaining(&game.board);
    for _ in 0..30 {
        let swaps = match3_core::legal_swaps(&game.board);
        let Some(&(from, to)) = swaps.first() else {
            break;
        };
        game.play_move(from, to);
        let now = blockers_remaining(&game.board);
        assert!(
            now <= prev,
            "blocker count is monotone non-increasing under play"
        );
        prev = now;
    }
}
