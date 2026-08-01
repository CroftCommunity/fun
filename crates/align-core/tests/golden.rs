//! Golden vectors pinning Align's mechanics (RULES.md). RED-first: these encode
//! the spec, so a mutation to a table or a rule flips a test.

use align_core::action::Action;
use align_core::board::Board;
use align_core::engine::Engine;
use align_core::gravity::ticks_per_row;
use align_core::mode::ModeConfig;
use align_core::piece::{PieceKind, RotState};
use align_core::scoring::{base_points, clears_lines, is_difficult, label, ClearLabel, TSpin};

// ---- pieces / spawn --------------------------------------------------------

/// Absolute spawn cells match the spec (I/O centred, others rounded left, in the
/// buffer just above the visible field at y≈20).
#[test]
fn spawn_cells_match_spec() {
    let abs = |k: PieceKind| {
        let (x, y) = k.spawn_origin();
        let mut c: Vec<(i32, i32)> = k
            .cells(RotState::Zero)
            .iter()
            .map(|&(dx, dy)| (x + i32::from(dx), y + i32::from(dy)))
            .collect();
        c.sort_unstable();
        c
    };
    assert_eq!(abs(PieceKind::I), vec![(3, 20), (4, 20), (5, 20), (6, 20)]);
    assert_eq!(abs(PieceKind::O), vec![(4, 20), (4, 21), (5, 20), (5, 21)]);
    assert_eq!(abs(PieceKind::T), vec![(3, 20), (4, 20), (4, 21), (5, 20)]);
    // Every spawn is horizontal and its lowest cell sits at y=20 (I/T/O) or 20.
    for k in [PieceKind::S, PieceKind::Z, PieceKind::J, PieceKind::L] {
        let lowest = abs(k).iter().map(|&(_, y)| y).min().unwrap();
        assert_eq!(lowest, 20, "{k:?} spawns with its base at y=20");
    }
}

// ---- 7-bag -----------------------------------------------------------------

/// Each 7-window is a permutation of the seven kinds, and no kind waits more than
/// 12 pieces across bag boundaries.
#[test]
fn bag_is_a_permutation_and_bounds_the_wait() {
    let mut e = Engine::new(12345, ModeConfig::marathon(1));
    // The active piece was already dealt; reconstruct the full stream.
    let active = e.active_view().unwrap().color;
    let mut seq = vec![active];
    seq.extend(e.peek_upcoming(27)); // ~4 bags total
    for chunk in seq.chunks(7).take(4) {
        if chunk.len() == 7 {
            let mut s = chunk.to_vec();
            s.sort_unstable();
            assert_eq!(s, vec![1, 2, 3, 4, 5, 6, 7], "each bag holds all seven");
        }
    }
    // Max wait ≤ 12: every colour appears at least once in any 13-window.
    for start in 0..(seq.len() - 13) {
        let window = &seq[start..start + 13];
        for color in 1..=7u8 {
            assert!(
                window.contains(&color),
                "colour {color} within any 13 pieces"
            );
        }
    }
}

// ---- rotation / kicks ------------------------------------------------------

/// A vertical I flush against the left wall kicks right when rotated to
/// horizontal (I R→0, kick test 2 = (+2, 0)).
#[test]
fn i_wall_kick_pushes_off_the_wall() {
    // I in rot R occupies column x+2; at x=-2 that column is 0 (against the wall).
    let mut e = Engine::test_with(
        Board::empty(),
        ModeConfig::marathon(1),
        PieceKind::I,
        RotState::R,
        -2,
        10,
    );
    let r = e.input(Action::RotCCW); // R -> 0
    assert_eq!(r, align_core::engine::InputResult::Applied);
    let (rot, x, _y) = e.active_pos().unwrap();
    assert_eq!(rot, 0, "rotated to spawn orientation");
    assert_eq!(x, 0, "kicked +2 off the wall to x=0");
}

/// A fully-boxed-in rotation fails silently (piece unchanged).
#[test]
fn blocked_rotation_is_a_noop() {
    // Surround a T so no kick fits: fill everything except the T's own cells.
    let mut rows: Vec<Vec<u8>> = (0..4).map(|_| vec![1u8; 10]).collect();
    // Carve the T (rot 0 at x=3,y=1): cells (3,2),(4,2),(5,2),(4,3).
    for &(x, y) in &[(3, 2), (4, 2), (5, 2), (4, 3)] {
        rows[y][x] = 0;
    }
    let refs: Vec<&[u8]> = rows.iter().map(std::vec::Vec::as_slice).collect();
    let board = Board::from_stack_rows(&refs);
    let mut e = Engine::test_with(
        board,
        ModeConfig::marathon(1),
        PieceKind::T,
        RotState::Zero,
        3,
        1,
    );
    let before = e.active_pos();
    let r = e.input(Action::RotCW);
    assert_eq!(r, align_core::engine::InputResult::Rejected);
    assert_eq!(e.active_pos(), before, "a blocked rotation changes nothing");
}

// ---- T-spin detection ------------------------------------------------------

/// A T rotated into a 3-corner slot that completes two lines scores a T-Spin
/// Double.
#[test]
fn t_spin_double_is_detected_and_scored() {
    // rows bottom-to-top; 1 = filled.
    let row0: Vec<u8> = (0..10).map(|c| u8::from(c != 4)).collect(); // gap at col4
    let row1: Vec<u8> = (0..10).map(|c| u8::from(!(3..=5).contains(&c))).collect(); // gap 3..5
    let mut row2 = vec![0u8; 10];
    row2[3] = 1; // the back-corner overhang (3rd corner)
    let board = Board::from_stack_rows(&[&row0, &row1, &row2]);

    // Place the T at its final slot (rot Two: 3 across the top, nub down).
    let mut e = Engine::test_with(
        board,
        ModeConfig::marathon(1),
        PieceKind::T,
        RotState::Two,
        3,
        0,
    );
    e.test_set_rotation_flag(0); // the lock's last action was a rotation
    e.input(Action::HardDrop);

    assert_eq!(e.last_label(), ClearLabel::TSpinDouble);
    let (_p, tspins, _a, _c) = e.stats();
    assert_eq!(tspins, 1, "one T-spin recorded");
    assert_eq!(e.lines(), 2, "two lines cleared");
}

/// Without a preceding rotation, the same placement is not a T-spin (the
/// rotation-last requirement).
#[test]
fn no_tspin_without_rotation() {
    let row0: Vec<u8> = (0..10).map(|c| u8::from(c != 4)).collect();
    let row1: Vec<u8> = (0..10).map(|c| u8::from(!(3..=5).contains(&c))).collect();
    let mut row2 = vec![0u8; 10];
    row2[3] = 1;
    let board = Board::from_stack_rows(&[&row0, &row1, &row2]);
    let mut e = Engine::test_with(
        board,
        ModeConfig::marathon(1),
        PieceKind::T,
        RotState::Two,
        3,
        0,
    );
    // No rotation flag set → the last action was not a rotation.
    e.input(Action::HardDrop);
    assert_eq!(
        e.last_label(),
        ClearLabel::Double,
        "a plain double, not a T-spin"
    );
}

// ---- gravity table ---------------------------------------------------------

/// Gravity spot-values (RULES.md gravity table).
#[test]
fn gravity_spot_values() {
    assert_eq!(ticks_per_row(1), 60);
    assert_eq!(ticks_per_row(10), 4);
    assert_eq!(ticks_per_row(14), 1);
    assert_eq!(ticks_per_row(19), 1, "clamped above the table");
}

// ---- scoring ---------------------------------------------------------------

/// The scoring table + difficulty classification.
#[test]
fn scoring_table_and_difficulty() {
    let l = 5u64;
    assert_eq!(base_points(label(1, TSpin::None), l), 100 * l);
    assert_eq!(base_points(label(2, TSpin::None), l), 300 * l);
    assert_eq!(base_points(label(3, TSpin::None), l), 500 * l);
    assert_eq!(base_points(label(4, TSpin::None), l), 800 * l); // Align
    assert_eq!(base_points(label(1, TSpin::Full), l), 800 * l); // TSS
    assert_eq!(base_points(label(2, TSpin::Full), l), 1200 * l); // TSD
    assert_eq!(base_points(label(3, TSpin::Full), l), 1600 * l); // TST
    assert_eq!(base_points(label(0, TSpin::Full), l), 400 * l); // T-spin no lines
    assert_eq!(base_points(label(1, TSpin::Mini), l), 200 * l); // mini TSS

    assert!(is_difficult(ClearLabel::Align));
    assert!(is_difficult(ClearLabel::TSpinDouble));
    assert!(!is_difficult(ClearLabel::Triple));
    assert!(!is_difficult(ClearLabel::TSpin)); // no-line t-spin not difficult
    assert!(!clears_lines(ClearLabel::TSpin));
    assert!(clears_lines(ClearLabel::Single));
}

// ---- board line clear ------------------------------------------------------

/// A full row clears and the rows above shift down.
#[test]
fn full_row_clears_and_shifts() {
    let full = vec![1u8; 10];
    let partial: Vec<u8> = {
        let mut r = vec![0u8; 10];
        r[0] = 2;
        r
    };
    // bottom row full, a marker above it.
    let mut board = Board::from_stack_rows(&[&full, &partial]);
    let cleared = board.clear_full_rows();
    assert_eq!(cleared, 1);
    assert_eq!(board.get(0, 0), 2, "the marker fell to the bottom");
    assert!(board.is_empty() || board.get(0, 0) == 2);
}
