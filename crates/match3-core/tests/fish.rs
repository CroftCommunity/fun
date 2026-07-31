//! The 2×2 fish (Track B4). Option A: a 2×2 same-colour square is a first-class
//! match — it makes a swap legal, clears (leaving one fish), is avoided by the
//! deal, and creates a `SpecialKind::Fish`. B4.1 covers detection + creation +
//! core consistency (activation is B4.2). These tests pin the new match shape
//! and that the deal never leaves a settled board holding a free fish.

use match3_core::board::{Board, Cell, SpecialKind};
use match3_core::engine::{creations_for, deal, find_matches, find_squares, swap_legal, Game};

fn count_special(b: &Board, kind: SpecialKind) -> usize {
    b.special().iter().filter(|s| **s == Some(kind)).count()
}

#[test]
fn find_squares_detects_a_2x2_block() {
    // A 2×2 of colour 0 at the top-left; no line-3 anywhere.
    let b = Board::from_rows(&["001", "002", "345"]).expect("parses");
    let squares = find_squares(&b);
    assert_eq!(squares.len(), 1, "exactly one 2×2 block");
    assert_eq!(
        squares[0],
        [(0, 0), (0, 1), (1, 0), (1, 1)],
        "the 2×2's four cells in row-major order"
    );
}

#[test]
fn a_2x2_is_a_match() {
    // Option A: the four cells of a 2×2 are in find_matches even with no line-3.
    let b = Board::from_rows(&["001", "002", "345"]).expect("parses");
    let matched = find_matches(&b);
    for cell in [(0, 0), (0, 1), (1, 0), (1, 1)] {
        assert!(matched.contains(&cell), "{cell:?} is part of the 2×2 match");
    }
}

#[test]
fn authoring_a_fish_round_trips() {
    let b = Board::from_rows_with_specials(&["012", "345"], &["F..", "..."]).expect("parses");
    assert_eq!(b.special_at(0, 0), Some(SpecialKind::Fish));
}

#[test]
fn swapping_to_form_a_2x2_is_legal_and_creates_a_fish() {
    // Settled board (no line-3, no 2×2). Swapping (1,1)<->(1,2) brings a 0 to (1,1),
    // completing a 2×2 of 0s at rows 0-1, cols 0-1. Under Option A the swap is legal
    // (a 2×2 is a match); it clears three cells and the fourth (the swapped-in cell)
    // becomes a Fish.
    let b = Board::from_rows(&["003", "010", "245"]).expect("parses");
    assert!(
        swap_legal(&b, (1, 1), (1, 2)),
        "forming a 2×2 makes the swap legal"
    );
    let mut game = Game::new(b, 1, 6);
    let (report, snaps) = game.play_move_traced((1, 1), (1, 2));
    assert!(report.legal);
    assert_eq!(
        report.steps[0].cleared.len(),
        3,
        "three cleared, one transformed"
    );
    assert_eq!(report.steps[0].score_gained, 30, "3 gems x 10");
    assert_eq!(
        snaps[1].special_at(1, 1),
        Some(SpecialKind::Fish),
        "a fish was created at the swapped cell of the 2×2"
    );
    assert_eq!(
        snaps[1].get(1, 1),
        Cell::Gem(0),
        "the fish keeps the square's colour"
    );
}

#[test]
fn a_line_shape_beats_a_2x2_in_creation_priority() {
    // A 2×4 block of colour 0 (rows 0-1, cols 0-3) contains 2×2 squares but also two
    // horizontal 4-runs. It must create striped candies (the line shape), not fish —
    // a fish comes only from a *pure* 2×2 (no ≥3 line through it).
    let b = Board::from_rows(&["00002", "00003", "14512"]).expect("parses");
    let creations = creations_for(&b, None);
    assert!(
        creations.iter().all(|c| c.kind != SpecialKind::Fish),
        "a 2×3 region makes line specials, not a fish"
    );
    assert!(
        creations
            .iter()
            .any(|c| matches!(c.kind, SpecialKind::StripedH | SpecialKind::StripedV)),
        "it does make a striped candy"
    );
}

#[test]
fn a_deal_never_leaves_a_2x2() {
    // A settled deal must contain no match at all — including a 2×2, or the board
    // would start with a free fish. Check a spread of seeds.
    for seed in 1u64..200 {
        let b = deal(seed, 8, 8, 6);
        assert!(
            find_squares(&b).is_empty(),
            "seed {seed}: a fresh deal has no 2×2 block"
        );
        assert!(
            find_matches(&b).is_empty(),
            "seed {seed}: a fresh deal is settled (no match)"
        );
    }
}

#[test]
fn a_created_fish_survives_its_creating_step() {
    // Like every creation, the fish is transformed (not cleared) — it is on the board
    // after the move settles.
    let b = Board::from_rows(&["003", "010", "245"]).expect("parses");
    let mut game = Game::new(b, 1, 6);
    let report = game.play_move((1, 1), (1, 2));
    assert!(report.legal);
    assert_eq!(
        count_special(&game.board, SpecialKind::Fish),
        1,
        "the created fish is on the settled board"
    );
}

// --- B4.2: fish activation (seeded targeting) --------------------------------

use match3_core::engine::{jelly_remaining, legal_swaps};

fn fish_swap_board() -> Board {
    // A Fish (colour 0) at (1,1); no line/2×2 match, and swapping it forms none
    // either — so only swap-activation can fire it.
    Board::from_rows_with_specials(&["123", "405", "231"], &["...", ".F.", "..."]).expect("parses")
}

#[test]
fn swapping_a_fish_is_legal_and_fires_it() {
    // Swapping the fish is legal (swap-activation), and firing eats a target so at
    // least two cells clear (the fish + its target) and the fish is consumed.
    assert!(
        swap_legal(&fish_swap_board(), (1, 1), (1, 2)),
        "swapping a fish is legal (it fires)"
    );
    let mut game = Game::new(fish_swap_board(), 1, 6);
    let report = game.play_move((1, 1), (1, 2));
    assert!(report.legal);
    assert!(
        report.steps[0].cleared.len() >= 2,
        "fish + its target cleared"
    );
    assert!(report.steps[0].score_gained >= 20, "at least two gems x 10");
    assert_eq!(
        count_special(&game.board, SpecialKind::Fish),
        0,
        "the fired fish is consumed"
    );
}

#[test]
fn legal_swaps_includes_the_fish_swap() {
    let swaps = legal_swaps(&fish_swap_board());
    assert!(
        swaps.iter().any(|&(f, t)| f == (1, 1) || t == (1, 1)),
        "the fish at (1,1) is swappable"
    );
}

#[test]
fn a_fired_fish_eats_the_only_jellied_cell() {
    // With exactly one jellied cell on the board, a fired fish must target it
    // (tier 1 = jelly; a single candidate is forced), scrubbing that jelly.
    let mut b = fish_swap_board();
    b.set_jelly(0, 0, 1);
    assert_eq!(jelly_remaining(&b), 1);
    let mut game = Game::new(b, 1, 6);
    let report = game.play_move((1, 1), (1, 2));
    assert!(report.legal);
    assert!(
        report.steps[0].cleared.contains(&(0, 0)),
        "the fish ate the jellied cell (0,0)"
    );
    assert_eq!(
        jelly_remaining(&game.board),
        0,
        "the fish scrubbed the only jelly by eating that cell"
    );
}

#[test]
fn fish_targeting_is_deterministic_and_in_the_fingerprint() {
    // The seeded target draw reproduces identically on replay, and dropping the fish
    // changes the outcome (it is part of the verifiable state).
    let mut a = Game::new(fish_swap_board(), 7, 6);
    a.play_move((1, 1), (1, 2));
    let mut b = Game::new(fish_swap_board(), 7, 6);
    b.play_move((1, 1), (1, 2));
    assert_eq!(
        a.state_hash(),
        b.state_hash(),
        "fish targeting replays identically"
    );

    // A board identical but for the fish marker: swapping is illegal (no fire), so
    // the move is a no-op and the hash differs.
    let plain = Board::from_rows(&["123", "405", "231"]).expect("parses");
    let mut c = Game::new(plain, 7, 6);
    c.play_move((1, 1), (1, 2));
    assert_ne!(
        a.state_hash(),
        c.state_hash(),
        "the fish's activation is part of the fingerprint"
    );
}

#[test]
fn a_matched_fish_fires() {
    // A Fish (colour 0) at (1,1). Swapping (2,0)<->(2,1) forms a vertical 3-run of
    // 0s in column 1 that includes the fish, so it is match-activated: it eats a
    // target beyond the 3-match and is consumed.
    let b = Board::from_rows_with_specials(&["102", "304", "056"], &["...", ".F.", "..."])
        .expect("parses");
    let mut game = Game::new(b, 1, 6);
    let report = game.play_move((2, 0), (2, 1));
    assert!(report.legal, "the swap forms a 3-run through the fish");
    assert_eq!(
        count_special(&game.board, SpecialKind::Fish),
        0,
        "the matched fish fired and was consumed"
    );
    assert!(
        report.steps[0].score_gained >= 30,
        "the 3-match plus the fish's target cleared"
    );
}
