//! Track B5 — the combo matrix (special + special by swap). RULES.md T1d.
//! Swapping two specials produces a single combined blast (centered on the
//! destination cell `to`), larger than firing each independently, and both specials
//! are consumed. A real firing special the combo sweeps up chains.
//!
//! B5.1 striped/wrapped: striped+striped = a cross, striped+wrapped = a thick cross,
//! wrapped+wrapped = a 5×5. B5.2 colour-bomb: bomb+striped / bomb+wrapped transform
//! the partner's colour, bomb+bomb clears the board. B5.4 fish: fish+fish/striped/
//! wrapped spawn N fish that draw distinct seeded targets and apply the partner's
//! blast; fish+bomb is a colour clear of the fish's colour.

use std::collections::BTreeSet;

use match3_core::board::{Board, Cell};
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

// --- B5.2: colour-bomb combos ----------------------------------------------
//
// The colour-bomb transforms are computed as a DIRECT equivalent clear-set (no
// intermediate specials materialized). These oracles independently reimplement
// the spec formula from the post-swap board so the tests do not just echo the
// engine.

/// Apply a swap (gem + special marker together) to a copy — the post-swap board
/// `resolve_move` computes the combo against.
fn apply_swap(b: &Board, from: Pos, to: Pos) -> Board {
    let mut nb = b.clone();
    let (fc, fs) = (b.get(from.0, from.1), b.special_at(from.0, from.1));
    let (tc, ts) = (b.get(to.0, to.1), b.special_at(to.0, to.1));
    nb.set(from.0, from.1, tc);
    nb.set_special(from.0, from.1, ts);
    nb.set(to.0, to.1, fc);
    nb.set_special(to.0, to.1, fs);
    nb
}

/// bomb + striped: the union of each partner-colour cell's full row + full column
/// (blockers excluded).
fn bomb_striped_expected(post: &Board, color: u8) -> BTreeSet<Pos> {
    let mut s = BTreeSet::new();
    for r in 0..post.height {
        for c in 0..post.width {
            if post.get(r, c) == Cell::Gem(color) {
                for cc in 0..post.width {
                    if !post.get(r, cc).is_blocker() {
                        s.insert((r, cc));
                    }
                }
                for rr in 0..post.height {
                    if !post.get(rr, c).is_blocker() {
                        s.insert((rr, c));
                    }
                }
            }
        }
    }
    s
}

/// bomb + wrapped: the union of each partner-colour cell's 3×3 (clamped, blockers
/// excluded).
fn bomb_wrapped_expected(post: &Board, color: u8) -> BTreeSet<Pos> {
    let mut s = BTreeSet::new();
    for r in 0..post.height {
        for c in 0..post.width {
            if post.get(r, c) == Cell::Gem(color) {
                for rr in r.saturating_sub(1)..=(r + 1).min(post.height - 1) {
                    for cc in c.saturating_sub(1)..=(c + 1).min(post.width - 1) {
                        if !post.get(rr, cc).is_blocker() {
                            s.insert((rr, cc));
                        }
                    }
                }
            }
        }
    }
    s
}

fn gem_color(board: &Board, pos: Pos) -> u8 {
    match board.get(pos.0, pos.1) {
        Cell::Gem(c) => c,
        other => panic!("expected a gem at {pos:?}, got {other:?}"),
    }
}

#[test]
fn bomb_plus_striped_turns_the_partner_colour_into_striped_lines() {
    // ColorBomb at (2,1), StripedH at (2,2); swap. The bomb turns every gem of the
    // partner striped's colour into a striped and fires them all → the union of
    // each such cell's row + column.
    let board = diag_board(&[".....", ".....", ".CH..", ".....", "....."]);
    let post = apply_swap(&board, (2, 1), (2, 2));
    // After swap the striped is at (2,1); its colour is the partner colour.
    let color = gem_color(&post, (2, 1));
    let mut expected = bomb_striped_expected(&post, color);
    expected.insert((2, 2)); // the bomb cell (consumed source)

    let mut game = Game::new(board, 1, 6);
    let report = game.play_move((2, 1), (2, 2));
    assert!(report.legal);
    assert_eq!(
        cleared_set(&report),
        expected,
        "bomb+striped clears every row+column of the partner colour"
    );
}

#[test]
fn bomb_plus_wrapped_turns_the_partner_colour_into_wrapped_blasts() {
    // ColorBomb at (2,1), Wrapped at (2,2); swap. Every gem of the partner colour
    // fires a 3×3.
    let board = diag_board(&[".....", ".....", ".CW..", ".....", "....."]);
    let post = apply_swap(&board, (2, 1), (2, 2));
    let color = gem_color(&post, (2, 1));
    let mut expected = bomb_wrapped_expected(&post, color);
    expected.insert((2, 2)); // the bomb cell (consumed source)

    let mut game = Game::new(board, 1, 6);
    let report = game.play_move((2, 1), (2, 2));
    assert!(report.legal);
    assert_eq!(
        cleared_set(&report),
        expected,
        "bomb+wrapped clears a 3×3 around every cell of the partner colour"
    );
}

#[test]
fn bomb_plus_bomb_clears_the_entire_board() {
    // Two colour bombs swapped → every gem on the board clears in step 0.
    let mut game = Game::new(
        diag_board(&[".....", ".....", ".CC..", ".....", "....."]),
        1,
        6,
    );
    let report = game.play_move((2, 1), (2, 2));
    assert!(report.legal);
    let cleared = cleared_set(&report);
    assert_eq!(cleared.len(), 25, "all 25 gem cells cleared");
    assert!(
        cleared.contains(&(0, 0)) && cleared.contains(&(4, 4)),
        "the whole board, corner to corner"
    );
    assert_eq!(report.steps[0].score_gained, 250, "25 gems x10");
}

#[test]
fn a_bomb_bomb_leaves_a_blocker_standing_minus_one_layer() {
    // bomb+bomb clears every GEM; a blocker is not a gem, so it survives, taking
    // exactly one adjacency layer this step (T2), consistent with every other
    // blast. A thick (5-layer) blocker at (0,0) is chipped, not cleared.
    let board = Board::from_rows_with_specials(
        &["E1234", "12340", "23401", "34012", "40123"],
        &[".....", ".....", ".CC..", ".....", "....."],
    )
    .expect("parses");
    let mut game = Game::new(board, 1, 6);
    let report = game.play_move((2, 1), (2, 2));
    assert!(report.legal);
    assert_eq!(
        report.steps[0].blocker_layers_removed, 1,
        "the blocker takes exactly one adjacency layer in the bomb+bomb step (T2)"
    );
    assert!(
        matches!(game.board.get(0, 0), Cell::Blocker(_)),
        "the blocker survived bomb+bomb (not a gem → not cleared)"
    );
}

// --- B5.4: fish combos ------------------------------------------------------
//
// Swapping a fish with another special is a combo too (RULES.md T1d). Fish combos
// spawn N=3 fish that each draw a distinct seeded target and apply the partner's
// blast; fish+bomb is a colour clear of the fish's colour. The two source fish are
// consumed. Targets are RNG-drawn, so these assert structure + determinism (exact
// cells are the golden vectors' recorded job).

#[test]
fn fish_plus_fish_eats_three_distinct_targets() {
    // Two adjacent fish; swap. Three spawned fish eat three distinct targets; the
    // two sources are consumed. No partner blast (plain eat), no jelly → 2 + 3 = 5
    // gem cells clear.
    let mut game = Game::new(
        diag_board(&[".....", ".....", ".FF..", ".....", "....."]),
        1,
        6,
    );
    let report = game.play_move((2, 1), (2, 2));
    assert!(report.legal, "swapping two fish is legal");
    let cleared = cleared_set(&report);
    assert!(
        cleared.contains(&(2, 1)) && cleared.contains(&(2, 2)),
        "both source fish are consumed"
    );
    assert_eq!(
        cleared.len(),
        5,
        "two consumed sources + three distinct eaten targets"
    );
}

#[test]
fn fish_plus_striped_fires_a_line_at_each_target() {
    // Fish + StripedH; swap. Three spawned fish each fire a full ROW at their
    // target — a multi-line blast far bigger than a plain fish+fish.
    let mut game = Game::new(
        diag_board(&[".....", ".....", ".FH..", ".....", "....."]),
        1,
        6,
    );
    let report = game.play_move((2, 1), (2, 2));
    assert!(report.legal);
    let cleared = cleared_set(&report);
    // Three target rows (5 wide each), minus any shared row / source overlap — well
    // above the 5 a plain fish+fish clears.
    assert!(
        cleared.len() >= 10,
        "fish+striped fires a line per target (got {})",
        cleared.len()
    );
}

#[test]
fn fish_plus_wrapped_blasts_a_3x3_at_each_target() {
    // Fish + Wrapped; swap. Three spawned fish each fire a 3×3 at their target.
    let mut game = Game::new(
        diag_board(&[".....", ".....", ".FW..", ".....", "....."]),
        1,
        6,
    );
    let report = game.play_move((2, 1), (2, 2));
    assert!(report.legal);
    let cleared = cleared_set(&report);
    assert!(
        cleared.len() >= 9,
        "fish+wrapped fires a 3×3 per target (got {})",
        cleared.len()
    );
}

#[test]
fn fish_plus_colour_bomb_clears_the_fish_colour() {
    // Fish + ColorBomb; swap. The bomb clears every gem of the fish's colour (the
    // fish supplies the colour). On the diag board a colour appears once per row →
    // five such cells, plus the consumed sources.
    let board = diag_board(&[".....", ".....", ".FC..", ".....", "....."]);
    // The fish's colour is the gem under the fish; after the swap the fish lands at
    // (2,2). Its colour = pre-swap gem at (2,1).
    let color = match board.get(2, 1) {
        Cell::Gem(c) => c,
        other => panic!("expected gem, got {other:?}"),
    };
    let mut game = Game::new(board.clone(), 1, 6);
    let report = game.play_move((2, 1), (2, 2));
    assert!(report.legal);
    let cleared = cleared_set(&report);
    // Every cell of that colour on the (post-swap) board is cleared.
    for r in 0..5 {
        for c in 0..5 {
            if board.get(r, c) == Cell::Gem(color) && (r, c) != (2, 1) {
                assert!(
                    cleared.contains(&(r, c)),
                    "colour-{color} cell {:?} cleared by fish+bomb",
                    (r, c)
                );
            }
        }
    }
    assert!(cleared.contains(&(2, 2)), "the bomb source is consumed");
}

#[test]
fn a_fish_combo_is_deterministic() {
    // The spawned fish draw their targets from the seeded RNG in a pinned order, so
    // two replays reproduce the same hash.
    let play = || {
        let mut g = Game::new(
            diag_board(&[".....", ".....", ".FF..", ".....", "....."]),
            9,
            6,
        );
        g.play_move((2, 1), (2, 2));
        g.state_hash()
    };
    assert_eq!(
        play(),
        play(),
        "fish combo folds its target draws into the hash"
    );
}

#[test]
fn a_fish_swapped_with_a_plain_gem_is_still_the_independent_path() {
    // Guard: one fish + a plain neighbour is NOT a combo — it is the B4 independent
    // fish (draws one target). Here we just confirm the swap is legal and clears the
    // fish's own cell + a target (a small clear, not a multi-fish combo).
    let mut game = Game::new(
        diag_board(&[".....", ".....", ".F...", ".....", "....."]),
        1,
        6,
    );
    let report = game.play_move((2, 1), (2, 2));
    assert!(report.legal, "swapping a lone fish is legal (fires it)");
    let cleared = cleared_set(&report);
    assert!(
        cleared.len() <= 3,
        "a lone fish eats one target (small clear), not a 3-fish combo (got {})",
        cleared.len()
    );
}

