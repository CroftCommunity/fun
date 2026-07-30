//! The reference greedy playout used to set per-deal score targets: play the
//! highest-scoring legal swap each turn for the move budget. Deterministic from
//! the seed, so both play-time and verify-time derive the same targets.

use match3_core::{reference_score, reference_score_beam};

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

// --- the stronger (less myopic) reference: a beam playout (item 4) ---
// Built and validated, but deliberately NOT yet wired into `targets_for` —
// adopting it re-grades every seed, so it waits for real play data + a
// `Match3::VERSION` bump. See plans/2026-07-30-match3-followups.md.

#[test]
fn beam_reference_is_deterministic() {
    let a = reference_score_beam(7, 8, 8, 6, 20, 8);
    let b = reference_score_beam(7, 8, 8, 6, 20, 8);
    assert_eq!(a, b, "same args => same beam reference score");
}

#[test]
fn beam_reference_dominates_greedy_every_seed() {
    // A beam that also carries the greedy line can only match or beat greedy —
    // the whole point of a less-myopic par (never a weaker one).
    for seed in 0..40u64 {
        let greedy = reference_score(seed, 8, 8, 6, 20);
        let beam = reference_score_beam(seed, 8, 8, 6, 20, 8);
        assert!(
            beam >= greedy,
            "seed {seed}: beam {beam} >= greedy {greedy}"
        );
    }
}

#[test]
fn beam_reference_grows_with_a_bigger_budget() {
    let small = reference_score_beam(7, 8, 8, 6, 3, 8);
    let big = reference_score_beam(7, 8, 8, 6, 20, 8);
    assert!(big >= small, "more swaps can only score at least as much");
}

#[test]
fn beam_reference_beats_greedy_on_some_seed() {
    // The beam is not a no-op: on at least one deal its lookahead finds a
    // strictly higher-scoring line than the greedy par (myopia caught).
    let improved = (0..40u64)
        .any(|s| reference_score_beam(s, 8, 8, 6, 20, 8) > reference_score(s, 8, 8, 6, 20));
    assert!(improved, "the beam should beat greedy on at least one seed");
}
