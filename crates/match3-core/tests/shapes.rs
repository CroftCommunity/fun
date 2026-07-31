//! Shape detection + special creation classification (Track B0, Phase 3), the
//! pure hand-computable core: `find_runs` (run-structured detection, preserving
//! `find_matches`'s flat union) and `creations_for` (which shape → which special
//! → placed where, with the priority table). Wiring into `play_move` and the
//! golden vectors live in `specials.rs`.

use match3_core::board::{Board, SpecialKind};
use match3_core::engine::{creations_for, find_matches, find_runs, Orientation};

fn board(rows: &[&str]) -> Board {
    Board::from_rows(rows).expect("rows parse")
}

// --- find_runs: run structure, and it preserves find_matches's flat union ----

#[test]
fn find_runs_returns_a_horizontal_run() {
    let runs = find_runs(&board(&["000", "123", "145"]));
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].orientation, Orientation::Horizontal);
    assert_eq!(runs[0].cells, vec![(0, 0), (0, 1), (0, 2)]);
}

#[test]
fn find_runs_returns_a_vertical_run() {
    let runs = find_runs(&board(&["10", "10", "10", "23"]));
    // col 0 is a vertical 3-run; col 1 is a vertical 3-run.
    assert_eq!(runs.len(), 2);
    assert!(runs.iter().all(|r| r.orientation == Orientation::Vertical));
    assert_eq!(runs[0].cells, vec![(0, 0), (1, 0), (2, 0)]);
}

#[test]
fn find_runs_union_equals_find_matches() {
    // The determinism guard (Phase 0 D2): the flat clear set is unchanged. On
    // every shape, Union(find_runs) must equal find_matches exactly.
    for rows in [
        vec!["000", "123", "145"],       // horizontal
        vec!["10", "10", "10", "23"],    // vertical
        vec!["010", "111", "010"],       // plus (intersecting)
        vec!["0000", "1234", "1234"],    // line-4
        vec!["00000", "12341", "23412"], // line-5
    ] {
        let b = board(&rows);
        let mut union: Vec<(usize, usize)> =
            find_runs(&b).into_iter().flat_map(|r| r.cells).collect();
        union.sort_unstable();
        union.dedup();
        assert_eq!(
            union,
            find_matches(&b),
            "union(find_runs) == find_matches for {rows:?}"
        );
    }
}

// --- creations_for: shape -> special -> placement ----------------------------

#[test]
fn line4_horizontal_makes_a_striped_h() {
    let c = creations_for(&board(&["0000"]), None);
    assert_eq!(c.len(), 1);
    assert_eq!(c[0].kind, SpecialKind::StripedH);
    assert_eq!(c[0].color, 0);
    assert_eq!(
        c[0].pos,
        (0, 2),
        "cascade placement = the run's median cell"
    );
}

#[test]
fn line4_vertical_makes_a_striped_v() {
    let c = creations_for(&board(&["0", "0", "0", "0"]), None);
    assert_eq!(c.len(), 1);
    assert_eq!(c[0].kind, SpecialKind::StripedV);
    assert_eq!(c[0].pos, (2, 0), "median of the 4-run");
}

#[test]
fn creation_spawns_at_the_swapped_cell_on_step_0() {
    // When the swap formed the run, the special spawns at the moved candy (the
    // `to` endpoint preferred), not the median.
    let c = creations_for(&board(&["0000"]), Some(((0, 9), (0, 1))));
    assert_eq!(
        c[0].pos,
        (0, 1),
        "spawns at the swapped `to` cell in the run"
    );
}

#[test]
fn l_shape_makes_a_wrapped_at_the_junction() {
    // A T: vertical col0 (3) meets horizontal row1 (3) at (1,0).
    let c = creations_for(&board(&["0..", "000", "0.."]), None);
    assert_eq!(c.len(), 1);
    assert_eq!(c[0].kind, SpecialKind::Wrapped);
    assert_eq!(c[0].pos, (1, 0), "wrapped spawns at the run intersection");
}

#[test]
fn line5_makes_a_color_bomb() {
    let c = creations_for(&board(&["00000"]), None);
    assert_eq!(c.len(), 1);
    assert_eq!(c[0].kind, SpecialKind::ColorBomb);
    assert_eq!(c[0].pos, (0, 2), "median of the 5-run");
}

#[test]
fn priority_line5_beats_wrapped() {
    // A plus whose horizontal arm is 5 long: colour-bomb wins over wrapped.
    let c = creations_for(&board(&["..0..", "00000", "..0.."]), None);
    assert_eq!(c.len(), 1);
    assert_eq!(c[0].kind, SpecialKind::ColorBomb);
    assert_eq!(c[0].pos, (1, 2), "median of the dominant 5-run");
}

#[test]
fn priority_l_with_a_4_beats_striped() {
    // A horizontal 4-run with a vertical 3-run off its start: L/T -> wrapped
    // (not striped), because a component with both orientations is wrapped.
    let c = creations_for(&board(&["0000", "..0.", "..0."]), None);
    assert_eq!(c.len(), 1);
    assert_eq!(c[0].kind, SpecialKind::Wrapped);
    assert_eq!(c[0].pos, (0, 2), "the junction cell");
}

#[test]
fn line3_makes_no_special() {
    assert!(creations_for(&board(&["000"]), None).is_empty());
}

#[test]
fn two_disjoint_line4s_make_two_stripeds() {
    // Independent components each get their own special.
    let c = creations_for(&board(&["0000", "1111"]), None);
    assert_eq!(c.len(), 2);
    assert!(c.iter().all(|cr| cr.kind == SpecialKind::StripedH));
}
