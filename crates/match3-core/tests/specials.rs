//! Special-gem overlay: model + hash + authoring (Track B0, Phase 1). A special
//! is a `Cell::Gem(color)` carrying a marker in a parallel overlay grid — it is
//! orthogonal to matching/legality (which see only the gem colour). These tests
//! pin the representation, the append-only-when-present hashing (the jelly
//! precedent, so gem-only boards hash unchanged), and authoring round-trips.

use match3_core::board::{Board, Cell, SpecialKind};
use match3_core::engine::{apply_gravity, clear_cells, refill, Game};
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
