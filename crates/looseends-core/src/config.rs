//! Level and daily board configuration — pure deterministic functions of the
//! level number / daily seed. `dailyConfig` is ported exactly from the spec;
//! `levelConfig` was **rebased on 2026-09-08** (mock F Q10, play-surface plan
//! phase 11): the spec's curve started at three arrows on a 5×6 — nothing to
//! read — and the genre's fun is reading a dense knot that resolves in order.
//! Level 1 is now ten arrows on 6×8 with snakes of 3–5; Easy's end (level 15)
//! is ~24 on 8×11; the top of the curve stays where the spec put it (68 on
//! 18×26, snakes up to 12). The daily config is untouched.
//!
//! Sizing uses `f64` exactly as the spec's `Math.round(a + b*t)` does. IEEE-754
//! `+ - * /` are bit-identical on native and `wasm32`, and for the always-
//! positive values here `Math.round(x) == floor(x + 0.5)`. Config never enters
//! `state_hash` — the hashed path (generation + release) stays integer-exact —
//! so this does not put a float on the hashed path.

use crate::rng::{hash_str, Rng};

/// A board's generation parameters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Config {
    /// Grid width in cells.
    pub w: i32,
    /// Grid height in cells.
    pub h: i32,
    /// Desired arrow count (generation may land at 70–100% of this).
    pub target: i32,
    /// Minimum arrow body length.
    pub min_len: i32,
    /// Maximum arrow body length.
    pub max_len: i32,
    /// How many `(locked, key)` pairs the generator draws after placing the
    /// arrows (plan 2026-09-08; none through level 7, none on a daily).
    pub locks: i32,
    /// The RNG seed (FNV-1a of the level/daily key).
    pub seed: u32,
}

/// JS `Math.round` for non-negative `x`: round half up.
fn jround(x: f64) -> i32 {
    (x + 0.5).floor() as i32
}

/// The FNV-1a seed for campaign level `n` (`1..=100`).
#[must_use]
pub fn level_seed(n: u32) -> u32 {
    hash_str(&format!("loose-ends-level-{n}"))
}

/// The FNV-1a seed for the daily board keyed by an ISO `YYYY-MM-DD` date.
#[must_use]
pub fn daily_seed(date_key: &str) -> u32 {
    hash_str(&format!("loose-ends-daily-{date_key}"))
}

/// Campaign level config for `n` (`1..=100`) — the rebased curve (module doc).
#[must_use]
pub fn level_config(n: u32) -> Config {
    let t = (f64::from(n) - 1.0) / 99.0;
    Config {
        w: jround(6.0 + 12.0 * t),
        h: jround(8.0 + 18.0 * t),
        target: jround(10.0 + 58.0 * t),
        min_len: 3,
        max_len: 5 + jround(t * 7.0),
        locks: level_locks(n),
        seed: level_seed(n),
    }
}

/// The lock count for level `n`: none through level 7 (the ray rule alone),
/// one from level 8, then `1 + floor((n − 8) · 7 / 92)` — eight at level 100.
/// Integer arithmetic; it never enters the hashed path either way.
#[must_use]
pub fn level_locks(n: u32) -> i32 {
    if n < 8 {
        return 0;
    }
    1 + ((n as i32 - 8) * 7) / 92
}

/// Daily config derived from the daily `seed` — the spec's `dailyConfig`, whose
/// `W`/`H`/`target` are drawn from a fresh `mulberry32(seed)` stream (the
/// generator later restarts its own stream from the same seed).
#[must_use]
pub fn daily_config(seed: u32) -> Config {
    let mut r = Rng::new(seed);
    let w = 9 + r.below(4) as i32;
    let h = 13 + r.below(6) as i32;
    let target = 20 + r.below(16) as i32;
    Config {
        w,
        h,
        target,
        min_len: 2,
        max_len: 9,
        locks: 0,
        seed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_config_matches_reference() {
        // The curve rebased 2026-09-08 (mock F Q10, play-surface phase 11): level 1
        // is a puzzle to read — ten arrows on 6×8 with snakes of 3–5 — and the top
        // of the curve stays where it was (68 on 18×26, snakes up to 12).
        let c1 = level_config(1);
        assert_eq!(
            (c1.w, c1.h, c1.target, c1.min_len, c1.max_len),
            (6, 8, 10, 3, 5)
        );
        assert_eq!(c1.seed, 3_873_835_247);
        assert_eq!(c1.locks, 0, "seven levels of the ray rule alone");

        let c100 = level_config(100);
        assert_eq!(
            (c100.w, c100.h, c100.target, c100.min_len, c100.max_len),
            (18, 26, 68, 3, 12)
        );
        assert_eq!(c100.seed, 2_958_177_543);

        let c50 = level_config(50);
        assert_eq!(
            (c50.w, c50.h, c50.target, c50.min_len, c50.max_len),
            (12, 17, 39, 3, 8)
        );
        assert_eq!(c50.seed, 3_273_002_345);
    }

    #[test]
    fn locks_start_at_level_8_and_reach_eight_at_100() {
        // Plan 2026-09-08, Q1 at its recommendation: none through level 7, one from
        // level 8, then 1 + floor((n − 8) · 7 / 92) — eight at level 100.
        let locks = |n: u32| level_config(n).locks;
        assert_eq!((1..=7).map(locks).collect::<Vec<_>>(), vec![0; 7]);
        assert_eq!(locks(8), 1);
        assert_eq!(locks(21), 1);
        assert_eq!(locks(22), 2);
        assert_eq!(locks(50), 4);
        assert_eq!(locks(99), 7);
        assert_eq!(locks(100), 8);
        for n in 8..100 {
            assert!(
                locks(n) <= locks(n + 1),
                "the lock count never falls (level {n})"
            );
        }
    }

    #[test]
    fn daily_config_matches_reference() {
        let seed = daily_seed("2026-08-02");
        assert_eq!(seed, 2_028_026_207);
        let c = daily_config(seed);
        assert_eq!(
            (c.w, c.h, c.target, c.min_len, c.max_len),
            (9, 14, 26, 2, 9)
        );
        assert_eq!(c.locks, 0, "no locks on a daily board this pass (Q3)");

        // A second daily whose width draw is not zero, so the `9 +` is graded too
        // (the mutation audit found `+ → -` invisible on the first seed). Recorded
        // 2026-09-08 from the generator.
        let seed = daily_seed("2026-09-14");
        let c = daily_config(seed);
        assert_eq!(
            (seed, c.w, c.h, c.target, c.locks),
            (2_153_557_309, 12, 13, 20, 0)
        );
    }
}
