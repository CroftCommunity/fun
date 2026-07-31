//! Special-gem overlay: model + hash + authoring (Track B0, Phase 1). A special
//! is a `Cell::Gem(color)` carrying a marker in a parallel overlay grid — it is
//! orthogonal to matching/legality (which see only the gem colour). These tests
//! pin the representation, the append-only-when-present hashing (the jelly
//! precedent, so gem-only boards hash unchanged), and authoring round-trips.

use match3_core::board::{Board, Cell, SpecialKind};
use match3_core::engine::{apply_gravity, clear_cells, legal_swaps, refill, swap_legal, Game};
use match3_core::hash::state_hash;
use match3_core::rng::DetRng;

fn board(rows: &[&str]) -> Board {
    Board::from_rows(rows).expect("rows parse")
}

fn count_special(b: &Board, kind: SpecialKind) -> usize {
    b.special().iter().filter(|s| **s == Some(kind)).count()
}

#[test]
fn no_special_by_default() {
    let b = board(&["012", "345", "012"]);
    assert!(b.special().iter().all(std::option::Option::is_none));
    assert_eq!(b.special_at(1, 1), None);
}

#[test]
fn set_and_read_a_special() {
    let mut b = board(&["012", "345", "012"]);
    b.set_special(1, 1, Some(SpecialKind::StripedH));
    assert_eq!(b.special_at(1, 1), Some(SpecialKind::StripedH));
    assert_eq!(b.special_at(0, 0), None);
}

#[test]
fn authoring_round_trips() {
    // '.' none, 'H'/'V' striped, 'W' wrapped, 'C' colour-bomb.
    let b = Board::from_rows_with_specials(&["012", "345", "012"], &["H..", ".W.", "..C"])
        .expect("parses");
    assert_eq!(b.special_at(0, 0), Some(SpecialKind::StripedH));
    assert_eq!(b.special_at(1, 1), Some(SpecialKind::Wrapped));
    assert_eq!(b.special_at(2, 2), Some(SpecialKind::ColorBomb));
    assert_eq!(b.special_at(0, 1), None);
}

#[test]
fn gem_only_hash_is_unchanged_by_the_overlay() {
    // The append-only-when-present guarantee: a board with no specials hashes
    // exactly as it did before the overlay existed. Setting a special then
    // clearing it must return to the original hash (no section emitted when
    // empty), so every pre-specials golden vector stays valid without a re-lock.
    let mut b = board(&["012", "345", "012"]);
    let base = state_hash(&b, 6, 0, 0);
    b.set_special(1, 1, Some(SpecialKind::StripedH));
    assert_ne!(
        state_hash(&b, 6, 0, 0),
        base,
        "a present special must change the hash"
    );
    b.set_special(1, 1, None);
    assert_eq!(
        state_hash(&b, 6, 0, 0),
        base,
        "clearing the only special restores the gem-only hash"
    );
}

#[test]
fn special_hash_is_deterministic_and_kind_sensitive() {
    let mut h = board(&["012", "345", "012"]);
    h.set_special(0, 0, Some(SpecialKind::StripedH));
    let mut v = board(&["012", "345", "012"]);
    v.set_special(0, 0, Some(SpecialKind::StripedV));
    assert_eq!(
        state_hash(&h, 6, 0, 0),
        state_hash(&h, 6, 0, 0),
        "same state hashes identically"
    );
    assert_ne!(
        state_hash(&h, 6, 0, 0),
        state_hash(&v, 6, 0, 0),
        "the special kind is part of the fingerprint"
    );
}

// --- Phase 2: core ops preserve the overlay (clear / gravity / refill) -------

#[test]
fn gravity_carries_the_special_with_its_gem() {
    // A 1-wide column: Gem(0) [special] at row 0, hole, Gem(1), hole. Gravity
    // packs the two gems to the bottom preserving order; the marker must travel
    // with Gem(0) to its new row and leave no marker behind on the hole.
    let mut b = Board::from_rows(&["0", ".", "1", "."]).expect("parses");
    b.set_special(0, 0, Some(SpecialKind::StripedH));
    apply_gravity(&mut b);
    assert_eq!(b.get(2, 0), Cell::Gem(0), "Gem(0) fell to row 2");
    assert_eq!(b.get(3, 0), Cell::Gem(1), "Gem(1) fell to row 3");
    assert_eq!(
        b.special_at(2, 0),
        Some(SpecialKind::StripedH),
        "the marker travelled with its gem"
    );
    assert_eq!(
        b.special_at(0, 0),
        None,
        "no marker left on the vacated hole"
    );
    assert_eq!(b.special_at(3, 0), None, "the plain gem gained no marker");
}

#[test]
fn clear_scrubs_the_special_marker() {
    // A horizontal 3-match with a wrapped candy in the middle: clearing the
    // matched cells scrubs the marker (the cell becomes an inert hole).
    let mut b = board(&["000"]);
    b.set_special(0, 1, Some(SpecialKind::Wrapped));
    let out = clear_cells(&mut b, &[(0, 0), (0, 1), (0, 2)]);
    assert_eq!(out.gems_cleared, 3);
    assert_eq!(b.get(0, 1), Cell::Empty, "cleared to a hole");
    assert_eq!(b.special_at(0, 1), None, "marker scrubbed on clear");
}

#[test]
fn refill_produces_no_specials() {
    // Refill only sets colours on holes; a refilled gem is always plain. Holes
    // carry no marker (clear + gravity uphold that), so after refill no cell
    // gains a special that wasn't placed by creation (which is B0.3).
    let mut b = Board::from_rows(&["0.0", "...", "..."]).expect("parses");
    refill(&mut b, &mut DetRng::from_seed(1), 6);
    assert!(b.is_settled(), "every hole filled");
    assert!(
        b.special().iter().all(std::option::Option::is_none),
        "refill never produces a special"
    );
}

#[test]
fn inert_special_survives_a_cascade_move() {
    // The wiring test: a hand-placed special in an untouched column must survive
    // a real `play_move` cascade end to end (clear + gravity + refill all
    // overlay-aware), and be part of the fingerprint. Board + move from golden
    // vector 01 (match clears cols 0-2, row 0); the special sits at (4,4), whose
    // column never gets a hole, so it stays put.
    let rows = &["00102", "34523", "45345", "53453", "34534"];
    let mut with = Game::new(Board::from_rows(rows).expect("parses"), 42, 6);
    with.board.set_special(4, 4, Some(SpecialKind::StripedH));
    let r = with.play_move((0, 2), (0, 3));
    assert!(r.legal, "the vector move is legal");
    assert_eq!(
        with.board.special_at(4, 4),
        Some(SpecialKind::StripedH),
        "the untouched-column special survived the move"
    );
    assert_eq!(
        count_special(&with.board, SpecialKind::StripedH),
        1,
        "exactly one"
    );

    // Determinism through the overlay path: two identical replays match, and the
    // special is threaded through the whole move (drop it and the hash differs).
    let mut with2 = Game::new(Board::from_rows(rows).expect("parses"), 42, 6);
    with2.board.set_special(4, 4, Some(SpecialKind::StripedH));
    with2.play_move((0, 2), (0, 3));
    assert_eq!(
        with.state_hash(),
        with2.state_hash(),
        "replay is deterministic"
    );

    let mut without = Game::new(Board::from_rows(rows).expect("parses"), 42, 6);
    without.play_move((0, 2), (0, 3));
    assert_ne!(
        with.state_hash(),
        without.state_hash(),
        "the surviving special is part of the fingerprint"
    );
}

// --- Phase 3: creation wired into play_move ---------------------------------

#[test]
fn line4_swap_creates_a_striped_and_scores_three() {
    // 0 0 2 0 / 3 4 0 5 ; swapping (0,2)<->(1,2) fills row 0 with four 0s -> a
    // horizontal 4-run. Step 0 creates a StripedH at the swapped cell, clears
    // the other three (score 30, not 40 -- the special is transformed, not
    // cleared), and the striped candy is on the board in the after-clear frame.
    let mut game = Game::new(board(&["0020", "3405"]), 1, 6);
    let (report, snaps) = game.play_move_traced((0, 2), (1, 2));
    assert!(report.legal, "the swap forms a 4-run");
    assert_eq!(
        report.steps[0].cleared.len(),
        3,
        "three cleared, one transformed"
    );
    assert_eq!(report.steps[0].score_gained, 30, "3 gems x 10");
    // snaps[0] = after swap; snaps[1] = after step-0 clear + creation.
    assert_eq!(
        snaps[1].get(0, 2),
        Cell::Gem(0),
        "placement keeps its colour"
    );
    assert_eq!(
        snaps[1].special_at(0, 2),
        Some(SpecialKind::StripedH),
        "a striped candy was created at the swapped cell"
    );
}

// --- B1.1: match-activation (a matched striped fires its line blast) --------

#[test]
fn matched_striped_clears_its_whole_row() {
    // Row 0 holds a StripedH (colour 0) at (0,0). Swapping (0,2)<->(1,2) makes a
    // line-3 of colour 0 that includes it -> it fires: the entire row 0 clears
    // (5 cells), not just the 3-match.
    let b =
        Board::from_rows_with_specials(&["00234", "12045", "23451"], &["H....", ".....", "....."])
            .expect("parses");
    let mut game = Game::new(b, 1, 6);
    let (report, snaps) = game.play_move_traced((0, 2), (1, 2));
    assert!(report.legal, "the swap forms a 3-run including the striped");
    let cleared0 = &report.steps[0].cleared;
    for c in 0..5 {
        assert!(
            cleared0.contains(&(0, c)),
            "row-0 cell {c} cleared by the blast"
        );
    }
    assert_eq!(report.steps[0].score_gained, 50, "5 gems x 10");
    for c in 0..5 {
        assert_eq!(
            snaps[1].get(0, c),
            Cell::Empty,
            "row 0 emptied in the after-clear frame"
        );
    }
}

#[test]
fn a_blast_chains_into_another_special() {
    // StripedH (colour 0) at (0,0) and StripedV (colour 5) at (0,3). Firing the
    // StripedH clears row 0, whose blast hits the StripedV -> it fires too,
    // clearing column 3. Both a row and a column go: 7 cells.
    let b =
        Board::from_rows_with_specials(&["00254", "12045", "23413"], &["H..V.", ".....", "....."])
            .expect("parses");
    let mut game = Game::new(b, 1, 6);
    let report = game.play_move((0, 2), (1, 2));
    assert!(report.legal);
    let cleared0 = &report.steps[0].cleared;
    for c in 0..5 {
        assert!(cleared0.contains(&(0, c)), "row-0 cell {c} cleared");
    }
    assert!(
        cleared0.contains(&(1, 3)) && cleared0.contains(&(2, 3)),
        "column 3 chained"
    );
    assert_eq!(report.steps[0].score_gained, 70, "7 gems x 10");
}

#[test]
fn a_blast_scrubs_jelly_under_the_cells_it_clears() {
    // The StripedH blast clears row 0; jelly beneath a blasted (non-matched) cell
    // is scrubbed just like a normal clear.
    let b =
        Board::from_rows_with_specials(&["00234", "12045", "23451"], &["H....", ".....", "....."])
            .expect("parses");
    let mut b = b;
    b.set_jelly(0, 4, 1); // (0,4) is only reached by the blast, not the 3-match
    let mut game = Game::new(b, 1, 6);
    let report = game.play_move((0, 2), (1, 2));
    assert!(
        report.steps[0].jelly_layers_removed >= 1,
        "blast scrubbed the jelly it passed"
    );
}

// --- B1.2: swap-activation (fire a striped by swapping it, no match needed) --

fn striped_board() -> Board {
    // A StripedH (colour 0) at (1,1); no line matches, and swapping it with any
    // neighbour forms no match either — so only swap-activation can fire it.
    Board::from_rows_with_specials(&["123", "405", "231"], &["...", ".H.", "..."]).expect("parses")
}

#[test]
fn swap_legal_allows_firing_a_striped_without_a_match() {
    let b = striped_board();
    // No plain swap here makes a match, but swapping the striped is legal — it
    // fires. (A control: a plain non-firing swap stays illegal.)
    assert!(
        swap_legal(&b, (1, 1), (1, 2)),
        "swapping the striped is legal (it fires)"
    );
    assert!(
        !swap_legal(&b, (0, 0), (0, 1)),
        "a plain no-match swap is still illegal"
    );
}

#[test]
fn legal_swaps_includes_the_special_swap() {
    let swaps = legal_swaps(&striped_board());
    assert!(
        swaps.iter().any(|&(f, t)| f == (1, 1) || t == (1, 1)),
        "the striped at (1,1) can be swapped with a neighbour"
    );
}

#[test]
fn swapping_a_striped_fires_it_and_carries_the_marker() {
    // Swap the StripedH (1,1)<->(1,2): no line match forms, but the striped —
    // now carried to (1,2) — fires, clearing its row. If the swap failed to move
    // the marker, the gem at (1,2) would be plain and nothing would fire.
    let mut game = Game::new(striped_board(), 1, 6);
    let report = game.play_move((1, 1), (1, 2));
    assert!(report.legal, "the special swap is legal");
    let cleared0 = &report.steps[0].cleared;
    for c in 0..3 {
        assert!(
            cleared0.contains(&(1, c)),
            "row-1 cell {c} cleared by the fired striped"
        );
    }
    assert_eq!(report.steps[0].score_gained, 30, "row of 3 x 10");
}

// --- B2.1: wrapped match-activation (the canon double 3×3) ------------------

fn wrapped_board() -> Board {
    // A Wrapped candy (colour 0) at the interior cell (2,2), on a 5×5 board with
    // no initial matches. Swapping (3,1)<->(3,2) brings a 0 to (3,2), forming a
    // vertical 3-run of 0s in column 2 (rows 1-3) that includes the wrapped — so
    // the wrapped is match-activated. Its 3×3 is fully interior (a clean 8-ring).
    Board::from_rows_with_specials(
        &["12345", "54021", "23045", "40132", "31254"],
        &[".....", ".....", "..W..", ".....", "....."],
    )
    .expect("parses")
}

// The 8 ring cells of the 3×3 around (2,2), excluding the centre — sorted.
const WRAPPED_RING: [(usize, usize); 8] = [
    (1, 1),
    (1, 2),
    (1, 3),
    (2, 1),
    (2, 3),
    (3, 1),
    (3, 2),
    (3, 3),
];

#[test]
fn matched_wrapped_clears_its_ring_and_its_centre_survives_the_first_blast() {
    // First blast: the wrapped clears the 8 cells around it (the 3×3 minus its
    // own cell) — its centre SURVIVES to explode a second time (the reference's
    // "explodes twice"). So step 0 clears 8 gems (80), not the whole 3×3, and the
    // wrapped candy is still on the board in the after-clear frame.
    let mut game = Game::new(wrapped_board(), 1, 6);
    let (report, snaps) = game.play_move_traced((3, 1), (3, 2));
    assert!(
        report.legal,
        "the swap forms a vertical 3-run through the wrapped"
    );
    let cleared0 = &report.steps[0].cleared;
    for cell in WRAPPED_RING {
        assert!(
            cleared0.contains(&cell),
            "ring cell {cell:?} cleared by blast 1"
        );
    }
    assert!(
        !cleared0.contains(&(2, 2)),
        "the wrapped's own centre is NOT cleared by its first blast (it survives)"
    );
    assert_eq!(report.steps[0].score_gained, 80, "8 ring gems x 10");
    // snaps[0] = after swap; snaps[1] = after step-0 clear.
    assert_eq!(snaps[1].get(2, 2), Cell::Gem(0), "centre still a gem");
    assert_eq!(
        snaps[1].special_at(2, 2),
        Some(SpecialKind::Wrapped),
        "the wrapped survived its first blast, marker intact"
    );
}

#[test]
fn a_surviving_wrapped_is_pinned_through_gravity() {
    // The reference wrapped stays in its cell while candies fall in around it. Its
    // first blast cleared the cells below it (row 3), so plain gravity would drop
    // it — but it is PINNED for that one gravity pass. snaps[2] is the post-step-0
    // gravity frame: the wrapped must still be at (2,2), not fallen.
    let mut game = Game::new(wrapped_board(), 1, 6);
    let (_report, snaps) = game.play_move_traced((3, 1), (3, 2));
    assert_eq!(
        snaps[2].special_at(2, 2),
        Some(SpecialKind::Wrapped),
        "the wrapped held its cell through gravity (pinned), rather than falling"
    );
    assert_eq!(snaps[2].get(2, 2), Cell::Gem(0), "still its coloured gem");
}

#[test]
fn a_wrapped_reblasts_its_full_3x3_and_is_consumed() {
    // Second blast: on the next cascade step the pinned wrapped fires again — this
    // time the full 3×3 INCLUDING its own cell (it is consumed). So there is a
    // step 1 whose cleared set contains the centre (2,2), and no wrapped remains.
    let mut game = Game::new(wrapped_board(), 1, 6);
    let report = game.play_move((3, 1), (3, 2));
    assert!(
        report.steps.len() >= 2,
        "the double blast is a second cascade step"
    );
    assert!(
        report.steps[1].cleared.contains(&(2, 2)),
        "the second blast clears the wrapped's own centre (consumed)"
    );
    assert_eq!(
        count_special(&game.board, SpecialKind::Wrapped),
        0,
        "the wrapped is gone after its double blast"
    );
}

#[test]
fn a_blast_chaining_into_a_wrapped_fires_its_double_and_the_survivor_is_protected() {
    // A StripedH (colour 0) at (2,0) and a Wrapped (colour 3) at (2,3) in the same
    // row. Swapping (2,2)<->(1,2) makes a 3-run of 0s in row 2 that fires the
    // striped, whose row blast hits the wrapped -> the wrapped fires its own 3×3
    // double. The striped's blast also covers the wrapped's cell (2,3), but the
    // wrapped SURVIVES its first blast (protected), then re-blasts.
    let b = Board::from_rows_with_specials(
        &["12452", "24013", "00132", "45241", "12452"],
        &[".....", ".....", "H..W.", ".....", "....."],
    )
    .expect("parses");
    let mut game = Game::new(b, 1, 6);
    let (report, snaps) = game.play_move_traced((2, 2), (1, 2));
    assert!(report.legal, "the swap forms a 3-run through the striped");
    let cleared0 = &report.steps[0].cleared;
    // The striped's row (minus the surviving wrapped centre) and the wrapped's ring.
    for cell in [
        (2, 0),
        (2, 1),
        (2, 2),
        (2, 4), // the striped row (2,3) survives
        (1, 2),
        (1, 3),
        (1, 4),
        (3, 2),
        (3, 3),
        (3, 4), // the wrapped ring above/below its row
    ] {
        assert!(
            cleared0.contains(&cell),
            "{cell:?} cleared by the chained blast"
        );
    }
    assert!(
        !cleared0.contains(&(2, 3)),
        "the chained wrapped survives its first blast (protected from the striped's row)"
    );
    assert_eq!(
        snaps[1].special_at(2, 3),
        Some(SpecialKind::Wrapped),
        "the wrapped is still on the board after step 0"
    );
    assert_eq!(
        snaps[1].special_at(2, 0),
        None,
        "the striped that fired is consumed"
    );
    assert!(
        report.steps.len() >= 2 && report.steps[1].cleared.contains(&(2, 3)),
        "the wrapped re-blasts and is consumed on the next step"
    );
}

#[test]
fn a_blocker_in_the_3x3_is_not_cleared_but_takes_one_layer() {
    // A blocker inside the wrapped's 3×3 is spared from the blast (like a match)
    // but takes exactly one layer of adjacency damage.
    let mut b = wrapped_board();
    b.set(1, 1, Cell::Blocker(2)); // (1,1) is a ring cell of the wrapped at (2,2)
    let mut game = Game::new(b, 1, 6);
    let (report, snaps) = game.play_move_traced((3, 1), (3, 2));
    assert!(report.legal);
    assert!(
        !report.steps[0].cleared.contains(&(1, 1)),
        "the blocker is not cleared by the blast"
    );
    assert!(
        report.steps[0].blocker_layers_removed >= 1,
        "the blocker took a layer of blast damage"
    );
    assert_eq!(
        snaps[1].get(1, 1),
        Cell::Blocker(1),
        "one layer removed, blocker still standing after blast 1"
    );
}

// --- B2.2: wrapped swap-activation (fire a wrapped by swapping it) -----------

fn wrapped_swap_board() -> Board {
    // A Wrapped (colour 0) at (1,1); no line matches, and swapping it with any
    // neighbour forms no match either — so only swap-activation can fire it (the
    // striped_board layout, marker changed H -> W).
    Board::from_rows_with_specials(&["123", "405", "231"], &["...", ".W.", "..."]).expect("parses")
}

#[test]
fn swap_legal_allows_firing_a_wrapped_without_a_match() {
    let b = wrapped_swap_board();
    assert!(
        swap_legal(&b, (1, 1), (1, 2)),
        "swapping the wrapped is legal (it fires)"
    );
    assert!(
        !swap_legal(&b, (0, 0), (0, 1)),
        "a plain no-match swap is still illegal"
    );
}

#[test]
fn legal_swaps_includes_the_wrapped_swap() {
    let swaps = legal_swaps(&wrapped_swap_board());
    assert!(
        swaps.iter().any(|&(f, t)| f == (1, 1) || t == (1, 1)),
        "the wrapped at (1,1) can be swapped with a neighbour"
    );
}

#[test]
fn swapping_a_wrapped_fires_its_double_and_carries_the_marker() {
    // Swap the Wrapped (1,1)<->(1,2): no line match forms, but the wrapped — now
    // carried to (1,2) — fires its 3×3 double from there. Its first blast clears
    // the 3×3 around (1,2) minus its own (surviving) centre; it then re-blasts.
    let mut game = Game::new(wrapped_swap_board(), 1, 6);
    let (report, snaps) = game.play_move_traced((1, 1), (1, 2));
    assert!(report.legal, "the wrapped swap is legal");
    let cleared0 = &report.steps[0].cleared;
    for cell in [(0, 1), (0, 2), (1, 1), (2, 1), (2, 2)] {
        assert!(
            cleared0.contains(&cell),
            "{cell:?} cleared by the fired wrapped's first blast"
        );
    }
    assert!(
        !cleared0.contains(&(1, 2)),
        "the wrapped's own centre survives its first blast"
    );
    assert_eq!(report.steps[0].score_gained, 50, "5 ring gems x 10");
    assert_eq!(
        snaps[1].special_at(1, 2),
        Some(SpecialKind::Wrapped),
        "the wrapped carried to (1,2) and survived — the marker moved with the swap"
    );
    assert!(
        report.steps.len() >= 2 && report.steps[1].cleared.contains(&(1, 2)),
        "the wrapped re-blasts and is consumed on the next step"
    );
}
