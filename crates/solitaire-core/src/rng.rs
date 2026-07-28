//! Deterministic, seeded RNG for the deal shuffle.
//!
//! The same determinism primitive `match3-core` and
//! `alpha/Proofs/lineage-groups/.../rng.rs` use: ChaCha20 seeded from an
//! explicit `u64`, so a game seed fully determines the shuffle. Draws are
//! counted so the RNG position can be folded into the state hash.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha20Rng;

/// Seeded deterministic RNG. `draws` counts the values consumed.
#[derive(Clone)]
pub struct DetRng {
    inner: ChaCha20Rng,
    draws: u64,
}

impl DetRng {
    /// Seed from an explicit `u64` game seed.
    #[must_use]
    pub fn from_seed(seed: u64) -> Self {
        Self {
            inner: ChaCha20Rng::seed_from_u64(seed),
            draws: 0,
        }
    }

    /// Uniform index in `0..len`. Counts as one draw.
    ///
    /// # Panics
    /// Panics if `len == 0`.
    pub fn index(&mut self, len: usize) -> usize {
        assert!(len > 0, "index over empty range");
        self.draws += 1;
        self.inner.gen_range(0..len)
    }

    /// In-place Fisher–Yates shuffle, top index down (RULES.md → "the
    /// deterministic deal"): for `i` from `len-1` down to `1`, swap
    /// `slice[i]` with `slice[rng.index(i+1)]`.
    pub fn shuffle<T>(&mut self, slice: &mut [T]) {
        for i in (1..slice.len()).rev() {
            let j = self.index(i + 1);
            slice.swap(i, j);
        }
    }

    /// Number of draws consumed so far (folded into the state hash).
    #[must_use]
    pub fn draws(&self) -> u64 {
        self.draws
    }
}
