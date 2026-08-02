//! Deterministic RNG for Loose Ends — an **integer-exact** port of the spec's
//! `hashStr` (FNV-1a) and `mulberry32`.
//!
//! `mulberry32` returns `k / 2^32` with `k` a `u32`. Every use in the generator
//! is either `(rng() * n) | 0` or `rng() < 0.5`, and both are exact integer
//! facts of `k`:
//!
//! - `(rng() * n) | 0 == ((k as u64 * n as u64) >> 32)` — for the small `n` the
//!   generator uses (`n <= max grid dim`), `k * n < 2^36 < 2^53`, so the float
//!   product is exact and its floor equals the 64-bit integer product shifted
//!   right by 32.
//! - `rng() < 0.5  <=>  k < 2^31`.
//!
//! So the core keeps the `u32` state and never touches a float on the
//! generation path: byte-identical on native and `wasm32`, and byte-identical
//! to the spec's JS reference.

/// FNV-1a over a string's char codes, as the spec's `hashStr`. Loose Ends only
/// ever hashes ASCII keys (`"loose-ends-level-<n>"`, `"loose-ends-daily-<iso>"`),
/// for which a byte iteration equals JS `charCodeAt`.
#[must_use]
pub fn hash_str(s: &str) -> u32 {
    let mut h: u32 = 2_166_136_261;
    for b in s.bytes() {
        h ^= u32::from(b);
        h = h.wrapping_mul(16_777_619);
    }
    h
}

/// The spec's `mulberry32`, carried as its raw `u32` output stream.
#[derive(Clone)]
pub struct Rng {
    a: u32,
}

impl Rng {
    /// Seed the stream (matches `mulberry32(seed)`).
    #[must_use]
    pub fn new(seed: u32) -> Self {
        Self { a: seed }
    }

    /// The next raw draw `k` — exactly `round(mulberry32() * 2^32)`.
    pub fn next_u32(&mut self) -> u32 {
        self.a = self.a.wrapping_add(0x6D2B_79F5);
        let mut t = (self.a ^ (self.a >> 15)).wrapping_mul(1 | self.a);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        t ^ (t >> 14)
    }

    /// `(rng() * n) | 0` — a uniform index in `0..n`. One draw. `n` must be
    /// small enough that `k * n` fits in `u64` (always true here: `n` is a grid
    /// dimension or option count).
    pub fn below(&mut self, n: u32) -> u32 {
        ((u64::from(self.next_u32()) * u64::from(n)) >> 32) as u32
    }

    /// `rng() < 0.5`. One draw.
    pub fn lt_half(&mut self) -> bool {
        self.next_u32() < 0x8000_0000
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Golden vectors captured from the spec's exact JS reference.
    #[test]
    fn fnv_matches_reference() {
        assert_eq!(hash_str("loose-ends-level-1"), 3_873_835_247);
        assert_eq!(hash_str("loose-ends-level-100"), 2_958_177_543);
        assert_eq!(hash_str("loose-ends-daily-2026-08-02"), 2_028_026_207);
        assert_eq!(hash_str("abc"), 440_920_331);
        assert_eq!(hash_str(""), 2_166_136_261);
    }

    #[test]
    fn mulberry32_raw_stream_matches_reference() {
        let mut r = Rng::new(12345);
        let got: Vec<u32> = (0..6).map(|_| r.next_u32()).collect();
        assert_eq!(
            got,
            vec![
                4_207_900_869,
                1_317_490_944,
                2_079_646_450,
                3_513_001_552,
                2_187_978_186,
                1_492_380_277
            ]
        );
    }

    #[test]
    fn below_and_lt_half_are_exact() {
        // below(n) == floor(k * n / 2^32); lt_half == k < 2^31.
        let ks = [4_207_900_869u64, 1_317_490_944, 2_079_646_450];
        let mut r = Rng::new(12345);
        for k in ks {
            let mut probe = r.clone();
            let n = 7u32;
            assert_eq!(u64::from(probe.below(n)), (k * u64::from(n)) >> 32);
            let mut probe2 = r.clone();
            assert_eq!(probe2.lt_half(), k < 0x8000_0000);
            r.next_u32();
        }
    }
}
