//! The hint oracle: a budgeted win-finder over a live position. RED first.

use mahjong_core::{layout, level_origin, matches, Board, Game, LayoutId, Move, SHUFFLE};
use mahjong_solver::{find_win, hint, Hint, Search};

fn replays_to_clear(board: &Board, line: &[(usize, usize)]) -> bool {
    let mut b = board.clone();
    for &(a, c) in line {
        if !matches(b.face(a), b.face(c)) || b.remove_pair(a, c).is_err() {
            return false;
        }
    }
    b.is_cleared()
}

#[test]
fn a_fresh_pond_is_solved_within_a_small_budget() {
    let g = Game::level(1).unwrap();
    let found = find_win(g.board(), 20_000).expect("a level-1 deal solves");
    assert_eq!(found.line.len(), 18);
    assert!(replays_to_clear(g.board(), &found.line));
    assert!(found.nodes <= 20_000);
}

#[test]
fn a_fresh_turtle_is_solved_within_budget() {
    // Winnable by construction; the oracle should still find *a* line. Measured
    // 2026-08-30 (release): seeds 0–4 in ≤ 4.1k nodes, seed 5 in 557k after the
    // restarts landed (it was unsolved at 3M without them), seed 7 in 56k.
    for seed in 0..6u32 {
        let l = layout(LayoutId::Turtle);
        let d = mahjong_core::deal(&l, seed).unwrap();
        let b = Board::new(l, d.faces);
        let found =
            find_win(&b, 1_000_000).unwrap_or_else(|| panic!("turtle seed {seed} unsolved"));
        assert_eq!(found.line.len(), 72);
        assert!(
            replays_to_clear(&b, &found.line),
            "seed {seed}: the line clears"
        );
    }
}

#[test]
fn a_cleared_board_is_an_empty_line_and_a_zero_budget_finds_nothing() {
    let mut g = Game::level(1).unwrap();
    for &(a, b) in &g.last_line().to_vec() {
        g.play(Move::pair(a, b)).unwrap();
    }
    let found = find_win(g.board(), 10).expect("cleared");
    assert!(found.line.is_empty());

    let fresh = Game::level(1).unwrap();
    assert!(find_win(fresh.board(), 0).is_none(), "no budget, no claim");
}

#[test]
fn a_stuck_position_is_reported_none_and_never_panics() {
    // Play greedily by lowest pair until nothing is legal; then ask.
    let mut g = Game::level(12).unwrap();
    while let Some(&(a, b)) = g.board().legal_moves().first() {
        g.play(Move::pair(a, b)).unwrap();
    }
    if g.board().is_stuck() {
        assert!(find_win(g.board(), 50_000).is_none());
        assert!(hint(g.board(), 50_000).is_none());
    }
}

#[test]
fn the_hint_is_a_legal_pair_proven_when_the_line_was_found() {
    let g = Game::level(1).unwrap();
    let h: Hint = hint(g.board(), 20_000).expect("a hint on a fresh deal");
    assert!(g.board().legal_moves().contains(&(h.a, h.b)));
    assert!(h.proven, "found within budget → proven");

    // With no search budget the hint falls back to the heuristic, honestly unproven.
    let h2 = hint(g.board(), 0).expect("the heuristic still answers");
    assert!(g.board().legal_moves().contains(&(h2.a, h2.b)));
    assert!(!h2.proven);
}

#[test]
fn the_search_is_deterministic_and_memoised_across_transpositions() {
    let g = Game::new(level_origin(7)).unwrap();
    let a = find_win(g.board(), 200_000).unwrap();
    let b = find_win(g.board(), 200_000).unwrap();
    assert_eq!(a.line, b.line);
    assert_eq!(a.nodes, b.nodes);
    // The Search handle exposes the same answer as the free function.
    let mut s = Search::new(200_000);
    assert_eq!(s.find(g.board()).map(|f| f.line), Some(a.line));
}

#[test]
fn after_a_shuffle_the_oracle_still_finds_the_new_line() {
    let mut g = Game::level(5).unwrap();
    for _ in 0..6 {
        let (a, b) = g.board().legal_moves()[0];
        g.play(Move::pair(a, b)).unwrap();
    }
    g.play(SHUFFLE).unwrap();
    let found = find_win(g.board(), 100_000).expect("a re-dealt board solves");
    assert!(replays_to_clear(g.board(), &found.line));
}
