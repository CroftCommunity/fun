//! Deterministic, seeded RNG for refill draws.
//!
//! Same determinism primitive as `alpha/Proofs/lineage-groups/.../rng.rs`:
//! ChaCha20 seeded from an explicit `u64`, so a game seed fully determines the
//! refill stream. We additionally count draws so the RNG position can be folded
//! into the state hash.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha20Rng;

/// Seeded deterministic RNG. `draws` is the number of colour draws consumed.
#[derive(Clone)]
pub struct DetRng {
    inner: ChaCha20Rng,
    draws: u64,
}

impl DetRng {
    pub fn from_seed(seed: u64) -> Self {
        Self {
            inner: ChaCha20Rng::seed_from_u64(seed),
            draws: 0,
        }
    }

    /// Uniform index in `0..len`. Panics if `len == 0`. Counts as one draw.
    pub fn index(&mut self, len: usize) -> usize {
        assert!(len > 0, "index over empty range");
        self.draws += 1;
        self.inner.gen_range(0..len)
    }

    /// Number of draws consumed so far (folded into the state hash).
    pub fn draws(&self) -> u64 {
        self.draws
    }
}
