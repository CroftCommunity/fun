//! Deterministic, seeded RNG for the next-fruit stream.
//!
//! `ChaCha20` seeded from an explicit `u64`, matching every other core on the
//! shelf, so a game seed fully determines which fruit arrives when. Draws are
//! counted so the RNG's position folds into the state hash — two boards that
//! look identical but have consumed different amounts of stream are not the same
//! game, and a replay must be able to tell.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha20Rng;

use crate::ladder::DROPPABLE;

/// Seeded deterministic RNG. `draws` counts the tiers drawn.
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

    /// The next droppable tier, in `0..DROPPABLE`. Counts as one draw.
    ///
    /// Samples a fixed-width `u32` range rather than `usize`: `usize` is 32-bit
    /// on `wasm32` and 64-bit native, and `rand` consumes the stream differently
    /// per width — which would break `native == wasm` silently, in a way only a
    /// cross-build check would ever catch.
    pub fn next_tier(&mut self) -> u8 {
        self.draws += 1;
        self.inner.gen_range(0..u32::from(DROPPABLE)) as u8
    }

    /// How many tiers have been drawn. Part of the hashed state.
    #[must_use]
    pub const fn draws(&self) -> u64 {
        self.draws
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_seed_produces_the_same_stream() {
        let mut a = DetRng::from_seed(42);
        let mut b = DetRng::from_seed(42);
        let one: Vec<u8> = (0..50).map(|_| a.next_tier()).collect();
        let two: Vec<u8> = (0..50).map(|_| b.next_tier()).collect();
        assert_eq!(one, two);
    }

    #[test]
    fn different_seeds_produce_different_streams() {
        let mut a = DetRng::from_seed(1);
        let mut b = DetRng::from_seed(2);
        let one: Vec<u8> = (0..50).map(|_| a.next_tier()).collect();
        let two: Vec<u8> = (0..50).map(|_| b.next_tier()).collect();
        assert_ne!(one, two);
    }

    #[test]
    fn every_drawn_tier_is_droppable() {
        // The stream must never hand out a fruit that can only be merged into
        // existence — that would break the ladder's central rule.
        let mut r = DetRng::from_seed(7);
        for _ in 0..2000 {
            let t = r.next_tier();
            assert!(t < DROPPABLE, "drew tier {t}, which is not droppable");
        }
    }

    #[test]
    fn the_stream_uses_the_whole_droppable_range() {
        // A generator that only ever returned 0 would pass the test above.
        let mut r = DetRng::from_seed(7);
        let mut seen = [false; DROPPABLE as usize];
        for _ in 0..2000 {
            seen[r.next_tier() as usize] = true;
        }
        assert!(
            seen.iter().all(|&s| s),
            "some droppable tier never appeared"
        );
    }

    #[test]
    fn draws_are_counted_so_the_rng_position_can_be_hashed() {
        let mut r = DetRng::from_seed(1);
        assert_eq!(r.draws(), 0);
        r.next_tier();
        r.next_tier();
        assert_eq!(r.draws(), 2);
    }
}
