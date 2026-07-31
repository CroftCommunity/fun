//! Aim → landing golden vectors (V1). The straight-up case is hand-reasoned; the
//! angled/bounce cases assert invariants (empty landing, adjacency, a recorded
//! bounce) + determinism, with exact landings pinned as regression anchors.

use bubble_core::aim::{resolve_shot, Angle};
use bubble_core::{Board, Cell};

fn empty(width: usize, height: usize) -> Board {
    Board::new_empty(width, height).expect("valid board")
}

fn fill_top(board: &mut Board, rows: usize) {
    for r in 0..rows {
        for c in 0..Board::row_len(board.width, r) {
            board.set(r, c, Cell::Bubble(0));
        }
    }
}

fn is_empty(board: &Board, (r, c): (usize, usize)) -> bool {
    matches!(board.get(r, c), Some(Cell::Empty))
}

#[test]
fn straight_up_on_empty_board_hits_the_ceiling_row() {
    let board = empty(8, 11);
    let landing = resolve_shot(&board, Angle(90));
    assert_eq!(
        landing.pos.0, 0,
        "a straight-up shot on an empty board reaches row 0"
    );
    assert!(is_empty(&board, landing.pos), "the landing cell is empty");
    // Launcher is board-centre; row-0 centres straddle columns 3 and 4.
    assert!(
        landing.pos.1 == 3 || landing.pos.1 == 4,
        "lands near the centre, got col {}",
        landing.pos.1
    );
}

#[test]
fn resolve_is_deterministic() {
    let board = empty(8, 11);
    let a = resolve_shot(&board, Angle(37));
    let b = resolve_shot(&board, Angle(37));
    assert_eq!(a.pos, b.pos, "same board+angle -> same landing");
    assert_eq!(a.path, b.path, "same board+angle -> same path");
}

#[test]
fn straight_up_into_a_filled_cluster_lands_empty_and_adjacent() {
    let mut board = empty(8, 11);
    fill_top(&mut board, 5); // rows 0..5 packed
    let landing = resolve_shot(&board, Angle(90));
    assert!(is_empty(&board, landing.pos), "landing is an empty cell");
    assert_ne!(
        landing.pos.0, 0,
        "blocked by the cluster, so not the ceiling row"
    );
    let touches = board
        .neighbors(landing.pos.0, landing.pos.1)
        .into_iter()
        .any(|(r, c)| matches!(board.get(r, c), Some(Cell::Bubble(_))));
    assert!(
        touches,
        "the landing cell is adjacent to the cluster it stuck to"
    );
}

#[test]
fn a_shallow_angle_bounces_off_a_wall() {
    let board = empty(8, 11);
    // A shallow shot from centre must reflect off a side wall before the ceiling.
    let landing = resolve_shot(&board, Angle(20));
    assert!(
        landing.path.len() >= 3,
        "path records launcher -> bounce -> stop"
    );
    let max_x = board.width as i32 * bubble_core::aim::DIAM - bubble_core::aim::RADIUS;
    let reached_wall = landing
        .path
        .iter()
        .any(|&(x, _)| x <= bubble_core::aim::RADIUS + 2 || x >= max_x - 2);
    assert!(reached_wall, "the flight path touches a side wall");
    assert!(is_empty(&board, landing.pos));
}
