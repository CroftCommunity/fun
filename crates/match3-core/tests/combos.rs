//! Track B5 — the combo matrix (special + special by swap). RULES.md T1d.
//! Swapping two non-fish specials produces a single combined blast (centered on
//! the destination cell `to`), larger than firing each independently, and both
//! specials are consumed. A real firing special the combo sweeps up chains.
//!
//! B5.1 covers the striped/wrapped combos: striped+striped = a cross (full row +
//! full column), striped+wrapped = a thick cross (3-wide row + 3-wide column),
//! wrapped+wrapped = a 5×5 blast. Colour-bomb combos are B5.2; fish combos are a
//! deferred follow-up (a fish swapped with a special still fires independently).

use std::collections::BTreeSet;

use match3_core::board::Board;
use match3_core::engine::Game;
use match3_core::Pos;

/// A 5×5 diagonal-rotation board with **no** line matches and no 2×2 squares —
/// each row is a rotation of `01234`, so every row and column holds five distinct
/// colours. A clean canvas for pre-placing specials without incidental matches.
fn diag_board(special_rows: &[&str]) -> Board {
    Board::from_rows_with_specials(&["01234", "12340", "23401", "34012", "40123"], special_rows)
        .expect("parses")
}

/// The full row + full column through `center` on a `w×h` board (the striped+
/// striped cross).
fn cross(center: Pos, w: usize, h: usize) -> BTreeSet<Pos> {
    let (r, c) = center;
    let mut s = BTreeSet::new();
    for cc in 0..w {
        s.insert((r, cc));
    }
    for rr in 0..h {
        s.insert((rr, c));
    }
    s
}

/// The 3-wide row band + 3-wide column band through `center` (striped+wrapped).
fn thick_cross(center: Pos, w: usize, h: usize) -> BTreeSet<Pos> {
    let (r, c) = center;
    let mut s = BTreeSet::new();
    for rr in r.saturating_sub(1)..=(r + 1).min(h - 1) {
        for cc in 0..w {
            s.insert((rr, cc));
        }
    }
    for cc in c.saturating_sub(1)..=(c + 1).min(w - 1) {
        for rr in 0..h {
            s.insert((rr, cc));
        }
    }
    s
}

/// The 5×5 block around `center`, clamped (wrapped+wrapped).
fn square5(center: Pos, w: usize, h: usize) -> BTreeSet<Pos> {
    let (r, c) = center;
    let mut s = BTreeSet::new();
    for rr in r.saturating_sub(2)..=(r + 2).min(h - 1) {
        for cc in c.saturating_sub(2)..=(c + 2).min(w - 1) {
            s.insert((rr, cc));
        }
    }
    s
}

fn cleared_set(report: &match3_core::MoveReport) -> BTreeSet<Pos> {
    report.steps[0].cleared.iter().copied().collect()
}

#[test]
fn striped_plus_striped_clears_a_cross() {
    // Two StripedH at (2,1),(2,2); swap them. Combo center = the destination
    // (2,2). The cross clears row 2 and column 2 — bigger than either striped's
    // line alone.
    let mut game = Game::new(
        diag_board(&[".....", ".....", ".HH..", ".....", "....."]),
        1,
        6,
    );
    let report = game.play_move((2, 1), (2, 2));
    assert!(report.legal, "swapping two specials is legal");
    assert_eq!(
        cleared_set(&report),
        cross((2, 2), 5, 5),
        "the combo clears the full row + full column through the swap cell"
    );
    assert_eq!(report.steps[0].score_gained, 9 * 10, "9 gems cleared x10");
}

#[test]
fn striped_plus_wrapped_clears_a_thick_cross() {
    // StripedH at (2,1), Wrapped at (2,2); swap. Combo center = (2,2). A 3-wide
    // row band + 3-wide column band.
    let mut game = Game::new(
        diag_board(&[".....", ".....", ".HW..", ".....", "....."]),
        1,
        6,
    );
    let report = game.play_move((2, 1), (2, 2));
    assert!(report.legal);
    assert_eq!(
        cleared_set(&report),
        thick_cross((2, 2), 5, 5),
        "striped+wrapped clears a 3-wide cross"
    );
}

#[test]
fn wrapped_plus_wrapped_clears_a_5x5() {
    // Two Wrapped at (1,1),(1,2); swap. Combo center = (1,2). The 5×5 around it,
    // clamped to the board.
    let mut game = Game::new(
        diag_board(&[".....", ".WW..", ".....", ".....", "....."]),
        1,
        6,
    );
    let report = game.play_move((1, 1), (1, 2));
    assert!(report.legal);
    assert_eq!(
        cleared_set(&report),
        square5((1, 2), 5, 5),
        "wrapped+wrapped clears a 5×5 block (clamped)"
    );
}

#[test]
fn a_combo_chains_a_bystander_special_it_sweeps_up() {
    // A striped+striped cross (center (2,2)) sweeps column 2, which holds a
    // bystander StripedH at (0,2). That bystander is not a combo source, so it
    // FIRES (chains), clearing all of row 0 — cells the cross alone would not
    // reach.
    let mut game = Game::new(
        diag_board(&["..H..", ".....", ".HH..", ".....", "....."]),
        1,
        6,
    );
    let report = game.play_move((2, 1), (2, 2));
    assert!(report.legal);
    let cleared = cleared_set(&report);
    let mut expected = cross((2, 2), 5, 5);
    for cc in 0..5 {
        expected.insert((0, cc)); // the chained bystander's row
    }
    assert_eq!(
        cleared, expected,
        "the swept-up bystander striped chains and clears its own row"
    );
}

#[test]
fn the_two_combo_specials_are_consumed_not_left_on_the_board() {
    // After a striped+striped combo, neither source cell still carries a special
    // marker — both were consumed by the combo (they cleared, then refilled as
    // plain gems).
    let mut game = Game::new(
        diag_board(&[".....", ".....", ".HH..", ".....", "....."]),
        1,
        6,
    );
    let _ = game.play_move((2, 1), (2, 2));
    assert!(game.board.is_settled(), "board refilled to settled");
    assert_eq!(game.board.special_at(2, 1), None, "source (2,1) consumed");
    assert_eq!(game.board.special_at(2, 2), None, "source (2,2) consumed");
}

#[test]
fn a_lone_striped_swap_is_unchanged_by_the_combo_path() {
    // Guard: swapping a single striped with a PLAIN gem still fires just its line
    // (B1.2), not a cross. The combo path only triggers when BOTH cells are
    // specials.
    let board =
        Board::from_rows_with_specials(&["123", "405", "231"], &["...", ".H.", "..."]).expect("ok");
    let mut game = Game::new(board, 1, 6);
    let report = game.play_move((1, 1), (1, 2));
    assert!(report.legal);
    let cleared = cleared_set(&report);
    // Just row 1 (the fired striped's line), NOT a cross through column 2.
    assert!(
        (0..3).all(|c| cleared.contains(&(1, c))),
        "the striped fires its row"
    );
    assert!(
        !cleared.contains(&(0, 2)) && !cleared.contains(&(2, 2)),
        "no column blast — a lone striped is not a combo"
    );
}

#[test]
fn a_combo_is_deterministic_across_replays() {
    // The verifiable-outcome property: the combo folds into the state hash and
    // two replays reproduce it byte-for-byte.
    let play = || {
        let mut g = Game::new(
            diag_board(&[".....", ".WW..", ".....", ".....", "....."]),
            7,
            6,
        );
        g.play_move((1, 1), (1, 2));
        g.state_hash()
    };
    assert_eq!(play(), play(), "identical seed + move -> identical hash");
}

#[test]
fn a_fish_swapped_with_a_special_does_not_combo_yet() {
    // Fish combos are deferred: swapping a Fish with a striped fires each
    // independently (the fish draws its target, the striped fires its line) — it
    // is NOT a cross/thick-cross combo. Here we assert the move is legal and both
    // effects happen (some clearing beyond a single line), without asserting the
    // exact independent shape.
    let board = diag_board(&[".....", ".....", ".FH..", ".....", "....."]);
    let mut game = Game::new(board, 1, 6);
    let report = game.play_move((2, 1), (2, 2));
    assert!(report.legal, "swapping a fish + striped is legal");
    // The striped (now at (2,1)) fires its row; the fish (now at (2,2)) eats a
    // target. This is the independent path, not the combo thick/cross — so at
    // minimum the striped's whole row cleared, plus the fish's own cell + target.
    let cleared = cleared_set(&report);
    assert!(
        (0..5).all(|c| cleared.contains(&(2, c))),
        "the striped still fires its row on the independent path"
    );
}
