//! The spec's §12 acceptance tests, as native Rust tests over the real core.
//!
//! 1. Solvability — every one of the 100 levels and ≥52 sampled dailies clears
//!    under a greedy "release any FREE arrow" solver. Zero failures.
//! 2. Determinism — the same config generates a byte-identical board twice.
//! 3. Fill — every level yields ≥70% of its target; level 1 yields exactly it.
//! 4. Performance — generating all 100 levels (with retries) is well under 3 s.

use std::time::Instant;

use looseends_core::config::daily_seed;
use looseends_core::{daily_config, generate, level_config};

/// Every calendar day of 2026 as an ISO key (365 days) — the daily seed schedule.
fn all_2026_daykeys() -> Vec<String> {
    let days_in = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut keys = Vec::new();
    for (m, &dim) in days_in.iter().enumerate() {
        for d in 1..=dim {
            keys.push(format!("2026-{:02}-{:02}", m + 1, d));
        }
    }
    keys
}

#[test]
fn all_100_levels_are_solvable() {
    for n in 1..=100u32 {
        let mut board = generate(&level_config(n));
        board.greedy_solve();
        assert!(
            board.is_cleared(),
            "level {n} did not clear under the greedy solver ({} left)",
            board.remaining()
        );
    }
}

#[test]
fn sampled_dailies_are_solvable() {
    // Sample well past the required 52: every day of 2026 (365).
    let keys = all_2026_daykeys();
    assert_eq!(keys.len(), 365);
    let mut checked = 0;
    for key in keys {
        let mut board = generate(&daily_config(daily_seed(&key)));
        board.greedy_solve();
        assert!(board.is_cleared(), "daily {key} did not clear");
        checked += 1;
    }
    assert!(checked >= 52, "sampled at least 52 dailies");
}

#[test]
fn generation_is_deterministic() {
    for n in [1u32, 25, 50, 75, 100] {
        let a = generate(&level_config(n));
        let b = generate(&level_config(n));
        assert_eq!(
            a.arrows(),
            b.arrows(),
            "level {n} is byte-identical across runs"
        );
    }
}

#[test]
fn fill_meets_threshold_and_level1_is_exact() {
    let c1 = level_config(1);
    let b1 = generate(&c1);
    assert_eq!(
        b1.arrows().len() as i32,
        c1.target,
        "level 1 yields exactly its target"
    );

    for n in 1..=100u32 {
        let cfg = level_config(n);
        let board = generate(&cfg);
        let fill = board.arrows().len() as f64 / f64::from(cfg.target);
        assert!(
            fill >= 0.70,
            "level {n} fill {fill:.3} below 0.70 ({} / {})",
            board.arrows().len(),
            cfg.target
        );
    }
}

#[test]
fn generating_all_levels_is_fast() {
    let start = Instant::now();
    let mut total = 0usize;
    for n in 1..=100u32 {
        total += generate(&level_config(n)).arrows().len();
    }
    let elapsed = start.elapsed();
    assert!(total > 0);
    assert!(
        elapsed.as_secs_f64() < 3.0,
        "generating 100 levels took {elapsed:?} (>3s)"
    );
}
