//! Level and daily board configuration — pure deterministic functions of the
//! level number / daily seed, ported exactly from the spec's `levelConfig` /
//! `dailyConfig`.
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

/// Campaign level config for `n` (`1..=100`) — the spec's `levelConfig`.
#[must_use]
pub fn level_config(n: u32) -> Config {
    let t = (f64::from(n) - 1.0) / 99.0;
    Config {
        w: jround(5.0 + 13.0 * t),
        h: jround(6.0 + 20.0 * t),
        target: jround(3.0 + 65.0 * t),
        min_len: 2 + jround(t),
        max_len: 4 + jround(t * 8.0),
        seed: level_seed(n),
    }
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
        seed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_config_matches_reference() {
        let c1 = level_config(1);
        assert_eq!(
            (c1.w, c1.h, c1.target, c1.min_len, c1.max_len),
            (5, 6, 3, 2, 4)
        );
        assert_eq!(c1.seed, 3_873_835_247);

        let c100 = level_config(100);
        assert_eq!(
            (c100.w, c100.h, c100.target, c100.min_len, c100.max_len),
            (18, 26, 68, 3, 12)
        );
        assert_eq!(c100.seed, 2_958_177_543);

        let c50 = level_config(50);
        assert_eq!(
            (c50.w, c50.h, c50.target, c50.min_len, c50.max_len),
            (11, 16, 35, 2, 8)
        );
        assert_eq!(c50.seed, 3_273_002_345);
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
    }
}
