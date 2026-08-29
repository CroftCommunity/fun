//! Fixed-point arithmetic for the solver. Shift-16 `i64` throughout, no floats
//! anywhere — the whole point of the spike is that every operation here is
//! exactly specified on every target, so `native == wasm` is arithmetic rather
//! than luck.
//!
//! **Units.** A [`Fx`] is a pixel scaled by `2^16`. A *raw square* (the result of
//! `dx*dx + dy*dy` on two `Fx`) is a pixel-squared scaled by `2^32`; it is kept
//! un-normalised on purpose, because comparing two raw squares needs no shift and
//! `isqrt` of a raw square lands back in `Fx` directly.
//!
//! **The overflow envelope was computed at plan time and holds here:** the worst
//! case separation in a 440x640 crate is 777 px, which is `5.09e7` as `Fx`;
//! `dx*dx + dy*dy` peaks at `2.59e15` against `i64::MAX` `9.22e18` — 3,560x
//! headroom. The precision questions (which are real) are measured in `tests.rs`.

/// A pixel scaled by `2^16`.
pub type Fx = i64;

/// `1.0` in [`Fx`].
pub const ONE: Fx = 1 << 16;

/// Bits of fractional precision.
pub const SHIFT: u32 = 16;

/// Convert whole pixels to [`Fx`].
#[must_use]
pub const fn from_px(px: i64) -> Fx {
    px << SHIFT
}

/// Convert a ratio `num/den` to [`Fx`]. Used for feel constants so they read as
/// the decimal they came from (`from_ratio(35, 100)` is Matter's `friction: .35`).
#[must_use]
pub const fn from_ratio(num: i64, den: i64) -> Fx {
    (num << SHIFT) / den
}

/// Fixed-point multiply. Inputs are `Fx`, output is `Fx`.
#[must_use]
pub const fn mul(a: Fx, b: Fx) -> Fx {
    (a * b) >> SHIFT
}

/// Fixed-point divide. Widened to `i128` for the shift, because `a << 16`
/// overflows `i64` for `|a| > 1.4e14` and an impulse accumulator can get there
/// in a deep pile. The widening is free on the hashed path: `i128` arithmetic is
/// exactly specified in wasm exactly as `i64` is.
#[must_use]
pub fn div(a: Fx, b: Fx) -> Fx {
    debug_assert!(b != 0, "fixed::div by zero");
    (((a as i128) << SHIFT) / (b as i128)) as Fx
}

/// Integer square root of a **raw square** (`2^32`-scaled), returning [`Fx`].
///
/// Newton's method on integers, seeded from the bit length so it converges in a
/// handful of steps rather than walking down from `n`. Every operation is integer
/// division and shift, so the result is bit-identical on any target.
#[must_use]
pub fn sqrt_raw(n: i64) -> Fx {
    if n <= 0 {
        return 0;
    }
    // Seed at 2^ceil(bits/2), which is >= sqrt(n) so Newton descends monotonically.
    let bits = 64 - n.leading_zeros();
    let mut x: i64 = 1 << bits.div_ceil(2);
    loop {
        let y = (x + n / x) >> 1;
        if y >= x {
            return x;
        }
        x = y;
    }
}

/// A 2-vector in [`Fx`].
///
/// `len` here is a magnitude, not a container length, so clippy's
/// `len_without_is_empty` does not apply.
#[allow(clippy::len_without_is_empty)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct V2 {
    /// Horizontal component.
    pub x: Fx,
    /// Vertical component (down is positive, matching canvas coordinates).
    pub y: Fx,
}

impl V2 {
    /// Construct a vector.
    #[must_use]
    pub const fn new(x: Fx, y: Fx) -> Self {
        Self { x, y }
    }

    /// `dx*dx + dy*dy` as a **raw square** (`2^32`-scaled, not `Fx`).
    #[must_use]
    pub const fn len_raw_sq(self) -> i64 {
        self.x * self.x + self.y * self.y
    }

    /// Length in [`Fx`].
    #[must_use]
    pub fn len(self) -> Fx {
        sqrt_raw(self.len_raw_sq())
    }

    /// Dot product of two `Fx` vectors, in `Fx`.
    #[must_use]
    pub const fn dot(self, o: Self) -> Fx {
        mul(self.x, o.x) + mul(self.y, o.y)
    }

    /// Scale by an `Fx` scalar.
    #[must_use]
    pub const fn scale(self, s: Fx) -> Self {
        Self::new(mul(self.x, s), mul(self.y, s))
    }

    /// The left-hand perpendicular — the tangent direction used for friction.
    #[must_use]
    pub const fn perp(self) -> Self {
        Self::new(-self.y, self.x)
    }
}

impl std::ops::Add for V2 {
    type Output = Self;
    fn add(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y)
    }
}

impl std::ops::Sub for V2 {
    type Output = Self;
    fn sub(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y)
    }
}
