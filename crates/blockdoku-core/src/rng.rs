//! Deterministic, seeded RNG for the piece deal.
//!
//! Same primitive as `twenty48-core`/`bubble-core`/`match3-core`: `ChaCha20`
//! seeded from an explicit `u64`, so the game seed fully determines the deal
//! stream. Draws are counted so the RNG position folds into the state hash, and
//! index sampling goes through a fixed-width `u32` range so native == wasm.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha20Rng;

/// Seeded deterministic RNG. `draws` is the number of index draws consumed.
#[derive(Clone)]
pub struct DetRng {
    inner: ChaCha20Rng,
    draws: u64,
}

impl DetRng {
    /// Construct from an explicit seed.
    #[must_use]
    pub fn from_seed(seed: u64) -> Self {
        Self {
            inner: ChaCha20Rng::seed_from_u64(seed),
            draws: 0,
        }
    }

    /// Uniform index in `0..len`. Counts as one draw.
    ///
    /// Samples a fixed-width `u32` range, not `usize`: `usize` is 32-bit on
    /// `wasm32` and 64-bit native, and `rand`'s `gen_range` consumes the stream
    /// differently per width, which would break native == wasm determinism.
    ///
    /// # Panics
    /// Panics if `len == 0` or `len` does not fit a `u32`.
    pub fn index(&mut self, len: usize) -> usize {
        assert!(len > 0, "index over empty range");
        self.draws += 1;
        let len = u32::try_from(len).expect("index range fits u32");
        self.inner.gen_range(0..len) as usize
    }

    /// Fisher–Yates shuffle, top-down (`i` from `len-1` to `1`, swap with a draw in
    /// `0..=i`), so the draw sequence is canonical and reproducible.
    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        let n = items.len();
        if n < 2 {
            return;
        }
        for i in (1..n).rev() {
            let j = self.index(i + 1);
            items.swap(i, j);
        }
    }

    /// Number of draws consumed so far (folded into the state hash).
    #[must_use]
    pub fn draws(&self) -> u64 {
        self.draws
    }
}
