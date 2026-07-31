//! Track D — the mixed/order **Checklist** objective (RULES.md T6).
//!
//! The checklist win is **path-accumulated**: it is met by what the run produces
//! (gems of a target colour cleared, striped/wrapped candies made), not by the
//! current board. These tests cover the two new neutral per-step `StepReport`
//! signals (`gems_cleared_by_color`, `striped_created`, `wrapped_created`) and the
//! `ChecklistTargets` / `ChecklistProgress` accumulator that reads them.

use match3_core::board::Board;
use match3_core::checklist::{checklist_targets, ChecklistProgress, ChecklistTargets};
use match3_core::engine::Game;

fn board(rows: &[&str]) -> Board {
    Board::from_rows(rows).expect("rows parse")
}

// --- the neutral per-step StepReport signals --------------------------------

#[test]
fn a_line4_swap_tallies_the_colour_cleared_and_one_striped_made() {
    // 0 0 2 0 / 3 4 0 5 ; swapping (0,2)<->(1,2) fills row 0 with four 0s -> a
    // horizontal 4-run: a StripedH is created (one survivor transformed) and the
    // other three colour-0 gems clear. So step 0 tallies three colour-0 cleared
    // and one striped made, no wrapped.
    let mut game = Game::new(board(&["0020", "3405"]), 1, 6);
    let report = game.play_move((0, 2), (1, 2));
    assert!(report.legal, "the swap forms a 4-run");
    let s0 = &report.steps[0];
    assert_eq!(
        s0.gems_cleared_by_color[0], 3,
        "three colour-0 gems cleared"
    );
    assert_eq!(
        s0.gems_cleared_by_color.iter().sum::<u32>(),
        3,
        "and nothing of any other colour"
    );
    assert_eq!(s0.striped_created, 1, "the line-4 made one striped");
    assert_eq!(s0.wrapped_created, 0, "no wrapped from a line-4");
}

#[test]
fn an_lt_swap_tallies_one_wrapped_made() {
    // The wrapped-from-LT golden vector: swapping (0,1)<->(1,1) forms an L/T of
    // colour 0 (a horizontal 3 in row 1 meeting a vertical 3 in col 1), creating a
    // Wrapped at the junction and clearing the four arm gems (all colour 0).
    let mut game = Game::new(board(&["102", "030", "405", "607"]), 1, 6);
    let report = game.play_move((0, 1), (1, 1));
    assert!(report.legal, "the swap forms an L/T");
    let s0 = &report.steps[0];
    assert_eq!(s0.wrapped_created, 1, "the L/T made one wrapped");
    assert_eq!(s0.striped_created, 0, "no striped from an L/T");
    assert_eq!(
        s0.gems_cleared_by_color[0], 4,
        "four colour-0 arm gems cleared"
    );
}

#[test]
fn the_per_colour_tally_sums_to_the_step_cleared_gem_count() {
    // Invariant: every truly-cleared cell is a gem, so the per-colour tally sums to
    // the reported cleared count, on every step of every move.
    for (rows, from, to) in [
        (vec!["0020", "3405"], (0, 2), (1, 2)),
        (vec!["102", "030", "405", "607"], (0, 1), (1, 1)),
    ] {
        let mut game = Game::new(board(&rows), 1, 6);
        let report = game.play_move(from, to);
        for step in &report.steps {
            assert_eq!(
                step.gems_cleared_by_color.iter().sum::<u32>(),
                u32::try_from(step.cleared.len()).unwrap(),
                "per-colour tally sums to the cleared gem count for {rows:?}"
            );
        }
    }
}

// --- ChecklistTargets: the deterministic seed template ----------------------

#[test]
fn checklist_targets_are_deterministic_and_in_range() {
    let a = checklist_targets(12345, 6);
    let b = checklist_targets(12345, 6);
    assert_eq!(a, b, "same seed -> same targets");
    assert!(a.color < 6, "target colour is in 0..colors");
    assert!(a.color_count > 0 && a.striped > 0, "non-trivial goals");
}

// --- ChecklistProgress: path accumulation + the win check -------------------

#[test]
fn progress_accumulates_a_move_into_the_running_tally() {
    // Applying the line-4 move's report (target colour 0) advances colour_cleared
    // by the three cleared and striped_made by the one created.
    let mut game = Game::new(board(&["0020", "3405"]), 1, 6);
    let report = game.play_move((0, 2), (1, 2));
    let mut progress = ChecklistProgress::default();
    progress.apply(&report, 0);
    assert_eq!(progress.color_cleared, 3, "colour-0 cleared accumulated");
    assert_eq!(progress.striped_made, 1, "striped made accumulated");
    assert_eq!(progress.wrapped_made, 0, "no wrapped this move");
}

#[test]
fn progress_only_counts_the_target_colour() {
    // A line-4 of colour 0 with target colour 1 advances no colour progress (but
    // still counts the striped made — that goal is colour-agnostic).
    let mut game = Game::new(board(&["0020", "3405"]), 1, 6);
    let report = game.play_move((0, 2), (1, 2));
    let mut progress = ChecklistProgress::default();
    progress.apply(&report, 1);
    assert_eq!(
        progress.color_cleared, 0,
        "none of the target colour 1 cleared"
    );
    assert_eq!(progress.striped_made, 1, "striped is colour-agnostic");
}

#[test]
fn met_is_true_only_when_every_goal_is_reached() {
    let targets = ChecklistTargets {
        color: 0,
        color_count: 3,
        striped: 1,
        wrapped: 0,
    };
    let mut short = ChecklistProgress {
        color_cleared: 3,
        striped_made: 0,
        wrapped_made: 0,
    };
    assert!(!short.met(&targets), "striped goal not yet reached");
    short.striped_made = 1;
    assert!(short.met(&targets), "all goals reached");
    // Over-shooting a goal still counts as met.
    short.color_cleared = 99;
    assert!(short.met(&targets), "exceeding a goal is still met");
}
