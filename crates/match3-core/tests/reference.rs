//! The reference greedy playout used to set per-deal score targets: play the
//! highest-scoring legal swap each turn for the move budget. Deterministic from
//! the seed, so both play-time and verify-time derive the same targets.

use match3_core::reference_score;

#[test]
fn reference_score_is_deterministic_and_positive() {
    let a = reference_score(7, 8, 8, 6, 20);
    let b = reference_score(7, 8, 8, 6, 20);
    assert_eq!(a, b, "same seed + budget => same reference score");
    assert!(a >= 30, "a legal swap scores at least one 3-match (>=30)");
}

#[test]
fn reference_score_grows_with_a_bigger_budget() {
    let small = reference_score(7, 8, 8, 6, 3);
    let big = reference_score(7, 8, 8, 6, 20);
    assert!(big >= small, "more swaps can only score at least as much");
}

#[test]
fn reference_score_varies_by_seed() {
    // Not all seeds score the same — the whole point of per-deal targets.
    let scores: Vec<u64> = (0..6).map(|s| reference_score(s, 8, 8, 6, 20)).collect();
    assert!(
        scores.windows(2).any(|w| w[0] != w[1]),
        "different deals should not all reference-score identically: {scores:?}"
    );
}
