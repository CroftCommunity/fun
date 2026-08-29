//! Deterministic, seeded RNG for the deal — the same ChaCha20 primitive every
//! shelf core uses (`solitaire-core/src/rng.rs`), copied rather than imported so
//! the game-isolation rule holds (a core depends on no other game's crate).

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha20Rng;

/// Seeded deterministic RNG.
#[derive(Clone)]
pub struct DetRng {
    inner: ChaCha20Rng,
}

impl DetRng {
    /// Seed from an explicit `u64`.
    #[must_use]
    pub fn from_seed(seed: u64) -> Self {
        Self {
            inner: ChaCha20Rng::seed_from_u64(seed),
        }
    }

    /// Uniform index in `0..len`. Samples a fixed-width `u32` range so the stream
    /// is consumed identically on native and `wasm32` (`usize` differs in width).
    ///
    /// # Panics
    /// Panics if `len == 0` or `len` does not fit in a `u32`.
    pub fn index(&mut self, len: usize) -> usize {
        assert!(len > 0, "index over empty range");
        let len = u32::try_from(len).expect("index range fits u32");
        self.inner.gen_range(0..len) as usize
    }

    /// In-place Fisher–Yates shuffle, top index down.
    pub fn shuffle<T>(&mut self, slice: &mut [T]) {
        for i in (1..slice.len()).rev() {
            let j = self.index(i + 1);
            slice.swap(i, j);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_shuffle_different_seed_different() {
        let mut a: Vec<u8> = (0..52).collect();
        let mut b: Vec<u8> = (0..52).collect();
        let mut c: Vec<u8> = (0..52).collect();
        DetRng::from_seed(7).shuffle(&mut a);
        DetRng::from_seed(7).shuffle(&mut b);
        DetRng::from_seed(8).shuffle(&mut c);
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_ne!(a, (0..52).collect::<Vec<u8>>());
    }
}
