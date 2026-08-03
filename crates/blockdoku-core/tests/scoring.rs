//! B2 golden: the frozen scoring constants, ported 1:1 from the original
//! `scoring.js`. These lock score-compatibility with the original game.

use blockdoku_core::scoring::{
    combo_bonus, score_placement, streak_bonus, Multiplier, LINE_POINTS, SQUARE_POINTS,
};

#[test]
fn base_points_are_frozen() {
    assert_eq!(LINE_POINTS, 15);
    assert_eq!(SQUARE_POINTS, 20);
}

#[test]
fn combo_bonus_ladder_matches_the_original() {
    // calculateComboBonus: i=2 +10, i=3/4 +15, i=5 +50, i=6+ +100 each.
    assert_eq!(combo_bonus(0), 0);
    assert_eq!(combo_bonus(1), 0, "1 clear is not a combo");
    assert_eq!(combo_bonus(2), 10);
    assert_eq!(combo_bonus(3), 25); // 10 + 15
    assert_eq!(combo_bonus(4), 40); // 10 + 15 + 15
    assert_eq!(combo_bonus(5), 90); // + 50
    assert_eq!(combo_bonus(6), 190); // + 100
    assert_eq!(combo_bonus(7), 290); // + 100
}

#[test]
fn streak_bonus_matches_the_original() {
    // calculateStreakBonus: <2 -> 0; 2..=10 -> streak*10; 11+ -> 100+(s-10)*100.
    assert_eq!(streak_bonus(0), 0);
    assert_eq!(streak_bonus(1), 0);
    assert_eq!(streak_bonus(2), 20);
    assert_eq!(streak_bonus(3), 30);
    assert_eq!(streak_bonus(10), 100);
    assert_eq!(streak_bonus(11), 200);
    assert_eq!(streak_bonus(12), 300);
}

#[test]
fn difficulty_multipliers_floor_per_component() {
    // 1.5 / 1.0 / 0.8 / 0.5, floored.
    assert_eq!(Multiplier::EASY.apply(15), 22); // floor(22.5)
    assert_eq!(Multiplier::NORMAL.apply(15), 15);
    assert_eq!(Multiplier::HARD.apply(15), 12); // floor(12.0)
    assert_eq!(Multiplier::HARD.apply(4), 3); // floor(3.2)
    assert_eq!(Multiplier::EXPERT.apply(15), 7); // floor(7.5)
    assert_eq!(Multiplier::EXPERT.apply(1), 0); // floor(0.5)
}

#[test]
fn hard_mode_floors_a_placement_at_0_8x() {
    // Place a t3x2 (points 4) that clears one row (15) + one box (20), no combo.
    // Wait: one row + one box = 2 regions -> IS a combo of 2 (+10). Use a single
    // row clear to keep it non-combo for this flooring check.
    let s = score_placement(4, 1, 0, 0, 0, Multiplier::HARD);
    assert_eq!(s.placement, 3); // floor(4 * 0.8) = 3
    assert_eq!(s.line, 12); // floor(15 * 0.8) = 12
    assert_eq!(s.square, 0);
    assert_eq!(s.combo, 0, "1 region is not a combo");
    assert_eq!(s.streak, 0);
    assert_eq!(s.total(), 15);
}

#[test]
fn a_two_region_combo_adds_ten() {
    // One row + one box cleared together = 2 regions -> combo +10. Normal mult.
    let s = score_placement(4, 1, 0, 1, 0, Multiplier::NORMAL);
    assert_eq!(s.placement, 4);
    assert_eq!(s.line, 15); // 1 row
    assert_eq!(s.square, 20); // 1 box
    assert_eq!(s.combo, 10);
    assert_eq!(s.streak, 0, "streak_before=0 -> no streak bonus");
    assert_eq!(s.total(), 49);
}

#[test]
fn a_six_region_combo_adds_the_full_ladder() {
    // 3 rows + 3 cols = 6 regions -> combo ladder 190. Normal mult, no streak.
    let s = score_placement(0, 3, 3, 0, 0, Multiplier::NORMAL);
    assert_eq!(s.line, 6 * 15);
    assert_eq!(s.combo, 190);
    assert_eq!(s.total(), 90 + 190);
}

#[test]
fn a_streak_of_three_before_adds_thirty() {
    // A combo event (2 regions) while streak_before = 3 -> streak bonus 30.
    let s = score_placement(0, 2, 0, 0, 3, Multiplier::NORMAL);
    assert_eq!(s.combo, 10); // 2 regions
    assert_eq!(s.streak, 30);
    assert_eq!(s.total(), 30 + 10 + 30); // 2 rows*15 + combo10 + streak30
}

#[test]
fn easy_multiplier_rounds_the_ladder_up_per_component() {
    // Combo +10 at easy 1.5 -> floor(15) = 15; a 2-row clear -> floor(30*1.5)=45.
    let s = score_placement(0, 2, 0, 0, 0, Multiplier::EASY);
    assert_eq!(s.line, 45);
    assert_eq!(s.combo, 15);
    assert_eq!(s.total(), 60);
}
