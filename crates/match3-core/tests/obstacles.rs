//! Track D — the obstacle families (T7). Licorice + meringue are distinct,
//! mechanically-separate obstacle tiles: `Blocker` cells carrying an obstacle
//! flavour. Both clear by the proven adjacency mechanic — a match next to them
//! chips one layer — but meringue is durable (2–3 layers, a multi-hit tile) and
//! licorice is single-hit, and they render distinctly (their own hash tags). A
//! plain blocker carries no flavour, so the clear-blockers mode is byte-identical.

use match3_core::board::{Board, Cell, Obstacle};
use match3_core::engine::{clear_cells, deal_obstacles, Game};
use match3_core::{blockers_remaining, has_legal_move, obstacles_mode};

fn board_obs(rows: &[&str], obstacles: &[&str]) -> Board {
    Board::from_rows_with_obstacles(rows, obstacles).expect("rows parse")
}

// --- the flavour overlay marks a blocker + round-trips -----------------------

#[test]
fn an_obstacle_flavour_marks_a_blocker() {
    let b = board_obs(&["A0", "00"], &["L.", ".."]);
    assert_eq!(b.get(0, 0), Cell::Blocker(1), "`A` is a one-layer blocker");
    assert_eq!(
        b.obstacle_at(0, 0),
        Some(Obstacle::Licorice),
        "marked licorice"
    );
    assert_eq!(b.obstacle_at(0, 1), None, "a gem carries no flavour");
}

#[test]
fn obstacle_tags_are_stable() {
    assert_eq!(Obstacle::Licorice.tag(), 0x01);
    assert_eq!(Obstacle::Meringue.tag(), 0x02);
}

// --- the clear mechanic: meringue is multi-hit, licorice single-hit ----------

#[test]
fn meringue_takes_multiple_adjacent_matches_to_clear() {
    // A 2-layer meringue at (0,0). One adjacent match chips it to one layer (still a
    // blocker, still meringue); a second adjacent match clears it (Empty, marker gone).
    let mut b = board_obs(&["B0", "00"], &["M.", ".."]);
    assert_eq!(b.get(0, 0), Cell::Blocker(2), "`B` is a two-layer blocker");
    clear_cells(&mut b, &[(0, 1)]); // (0,1) is orthogonally adjacent to (0,0)
    assert_eq!(b.get(0, 0), Cell::Blocker(1), "one layer chipped");
    assert_eq!(
        b.obstacle_at(0, 0),
        Some(Obstacle::Meringue),
        "still meringue while a layer remains"
    );
    clear_cells(&mut b, &[(1, 0)]); // (1,0) is orthogonally adjacent to (0,0)
    assert_eq!(b.get(0, 0), Cell::Empty, "the second hit clears it");
    assert_eq!(
        b.obstacle_at(0, 0),
        None,
        "the flavour scrubs with the blocker"
    );
}

#[test]
fn licorice_clears_in_one_adjacent_match() {
    let mut b = board_obs(&["A0", "00"], &["L.", ".."]);
    clear_cells(&mut b, &[(0, 1)]);
    assert_eq!(
        b.get(0, 0),
        Cell::Empty,
        "single-hit: one adjacent match clears it"
    );
    assert_eq!(
        b.obstacle_at(0, 0),
        None,
        "the flavour scrubs with the blocker"
    );
}

// --- additive hashing: no obstacle -> unchanged; flavour distinguishes -------

#[test]
fn a_board_with_no_obstacle_hashes_unchanged() {
    // A plain-blocker board and the same board with an all-`.` obstacle grid hash
    // identically — the obstacle section is appended only when a flavour is present.
    let plain = Game::new(Board::from_rows(&["A0", "00"]).unwrap(), 7, 6);
    let flavourless = Game::new(board_obs(&["A0", "00"], &["..", ".."]), 7, 6);
    assert_eq!(plain.state_hash(), flavourless.state_hash());
}

#[test]
fn two_boards_differing_only_in_obstacle_flavour_hash_differently() {
    let lic = Game::new(board_obs(&["A0", "00"], &["L.", ".."]), 7, 6);
    let mer = Game::new(board_obs(&["A0", "00"], &["M.", ".."]), 7, 6);
    assert_ne!(
        lic.state_hash(),
        mer.state_hash(),
        "the obstacle flavour is part of the fingerprint"
    );
}

// --- the deal ---------------------------------------------------------------

#[test]
fn deal_obstacles_places_both_flavours_with_a_legal_move() {
    use obstacles_mode as m;
    let b = deal_obstacles(42, m::WIDTH, m::HEIGHT, m::COLORS, m::LICORICE, m::MERINGUE);
    let licorice = (0..m::HEIGHT)
        .flat_map(|r| (0..m::WIDTH).map(move |c| (r, c)))
        .filter(|&(r, c)| b.obstacle_at(r, c) == Some(Obstacle::Licorice))
        .count();
    let meringue: Vec<(usize, usize)> = (0..m::HEIGHT)
        .flat_map(|r| (0..m::WIDTH).map(move |c| (r, c)))
        .filter(|&(r, c)| b.obstacle_at(r, c) == Some(Obstacle::Meringue))
        .collect();
    assert_eq!(licorice, m::LICORICE, "licorice count");
    assert_eq!(meringue.len(), m::MERINGUE, "meringue count");
    // Every obstacle is a blocker; meringue is dealt durable (2–3 layers).
    assert_eq!(
        blockers_remaining(&b),
        u32::try_from(m::LICORICE + m::MERINGUE).unwrap(),
        "all obstacles are blockers"
    );
    for (r, c) in meringue {
        assert!(
            matches!(b.get(r, c), Cell::Blocker(l) if (2..=3).contains(&l)),
            "meringue is a durable 2-3 layer blocker at ({r},{c})"
        );
    }
    assert!(has_legal_move(&b), "the deal is not a dead start");
}
