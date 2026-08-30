//! Deterministic RNG — the shelf's integer-exact FNV-1a + `mulberry32` pair
//! (the same primitives Loose Ends uses). The core keeps the `u32` state and
//! never touches a float, so native and `wasm32` draw the same stream.

/// FNV-1a over a string's bytes (ASCII keys only: `mahjong-level-<n>`,
/// `mahjong-daily-<YYYY-MM-DD>`).
#[must_use]
pub fn hash_str(s: &str) -> u32 {
    let mut h: u32 = 2_166_136_261;
    for b in s.bytes() {
        h ^= u32::from(b);
        h = h.wrapping_mul(16_777_619);
    }
    h
}

/// `mulberry32`, carried as its raw `u32` output stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rng {
    a: u32,
}

impl Rng {
    /// Seed the stream.
    #[must_use]
    pub fn new(seed: u32) -> Self {
        Self { a: seed }
    }

    /// The next raw draw.
    pub fn next_u32(&mut self) -> u32 {
        self.a = self.a.wrapping_add(0x6D2B_79F5);
        let mut t = (self.a ^ (self.a >> 15)).wrapping_mul(1 | self.a);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(0x3D | t)) ^ t;
        t ^ (t >> 14)
    }

    /// A uniform index in `0..n` (`n > 0`, small). One draw.
    pub fn below(&mut self, n: u32) -> u32 {
        ((u64::from(self.next_u32()) * u64::from(n)) >> 32) as u32
    }
}

/// Fisher–Yates over a slice, drawing from `rng`.
pub fn shuffle<T>(items: &mut [T], rng: &mut Rng) {
    let n = items.len();
    for i in (1..n).rev() {
        let j = rng.below(i as u32 + 1) as usize;
        items.swap(i, j);
    }
}
