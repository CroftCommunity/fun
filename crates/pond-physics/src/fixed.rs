//! Fixed-point arithmetic for the solver. Shift-16 `i64` throughout, no floats
//! anywhere — every operation here is exactly specified on every target, which
//! is what makes `native == wasm` arithmetic rather than luck.
//!
//! # Units
//!
//! An [`Fx`] is a pixel scaled by `2^16`. A **raw square** — the result of
//! `dx*dx + dy*dy` on two `Fx` — is a pixel-squared scaled by `2^32`, and is
//! deliberately left un-normalised: comparing two raw squares needs no shift,
//! and [`sqrt_raw`] of a raw square lands back in `Fx` directly.
//!
//! # The envelope
//!
//! Measured, not assumed (`spike/orchard-physics/RESULT.md`, D2). The worst-case
//! separation in a 440x640 crate is 776.66 px = `5.09e7` as `Fx`; the raw square
//! peaks at `2.59e15` against `i64::MAX` `9.22e18` — **3,560x headroom**. The
//! precision risk lives in [`div`], not in range.

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

/// Convert the ratio `num/den` to [`Fx`], so a feel constant reads as the decimal
/// it came from: `from_ratio(35, 100)` is the vendored game's `friction: .35`.
///
/// # Panics
/// Panics if `den` is zero (a constant expression, so at compile time).
#[must_use]
pub const fn from_ratio(num: i64, den: i64) -> Fx {
    (num << SHIFT) / den
}

/// Fixed-point multiply: `Fx * Fx -> Fx`.
#[must_use]
pub const fn mul(a: Fx, b: Fx) -> Fx {
    (a * b) >> SHIFT
}

/// Fixed-point divide: `Fx / Fx -> Fx`.
///
/// Widened to `i128` for the shift because `a << 16` overflows `i64` above
/// `|a| > 1.4e14`, which an accumulated impulse in a deep pile reaches. The
/// widening costs nothing on the hashed path — `i128` is as exactly specified in
/// wasm as `i64` is.
///
/// # Panics
/// Panics in debug builds if `b` is zero. Callers in the solver guard the only
/// case that can produce it (a contact between two static bodies).
#[must_use]
pub fn div(a: Fx, b: Fx) -> Fx {
    debug_assert!(b != 0, "fixed::div by zero");
    ((i128::from(a) << SHIFT) / i128::from(b)) as Fx
}

/// Integer square root of a **raw square** (`2^32`-scaled), returning [`Fx`].
///
/// Newton's method on integers, seeded from the bit length so it converges in a
/// handful of steps rather than walking down from `n`. Every operation is an
/// integer divide or shift, so the result is bit-identical on any target.
/// Returns `0` for zero or negative input rather than panicking: a degenerate
/// contact (two centres in the same place) is a case the solver must survive.
#[must_use]
pub fn sqrt_raw(n: i64) -> Fx {
    if n <= 0 {
        return 0;
    }
    // Seed at 2^ceil(bits/2), which is >= sqrt(n), so Newton descends monotonically.
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
/// `len` is a magnitude, not a container length, so clippy's
/// `len_without_is_empty` does not apply.
#[allow(clippy::len_without_is_empty)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct V2 {
    /// Horizontal component.
    pub x: Fx,
    /// Vertical component. Down is positive, matching canvas coordinates.
    pub y: Fx,
}

impl V2 {
    /// Construct a vector.
    #[must_use]
    pub const fn new(x: Fx, y: Fx) -> Self {
        Self { x, y }
    }

    /// `x*x + y*y` as a **raw square** (`2^32`-scaled, not `Fx`).
    #[must_use]
    pub const fn len_raw_sq(self) -> i64 {
        self.x * self.x + self.y * self.y
    }

    /// Length, in [`Fx`].
    #[must_use]
    pub fn len(self) -> Fx {
        sqrt_raw(self.len_raw_sq())
    }

    /// Dot product, in [`Fx`].
    #[must_use]
    pub const fn dot(self, o: Self) -> Fx {
        mul(self.x, o.x) + mul(self.y, o.y)
    }

    /// Scale by an [`Fx`] scalar.
    #[must_use]
    pub const fn scale(self, s: Fx) -> Self {
        Self::new(mul(self.x, s), mul(self.y, s))
    }

    /// The left-hand perpendicular — the tangent direction friction acts along.
    #[must_use]
    pub const fn perp(self) -> Self {
        Self::new(-self.y, self.x)
    }

    /// This vector scaled to unit length, or `None` if it has no direction.
    /// Returning `Option` rather than a fallback keeps the degenerate-contact
    /// decision at the call site, where the solver knows what to do about it.
    #[must_use]
    pub fn normalize(self) -> Option<Self> {
        let len = self.len();
        if len == 0 {
            return None;
        }
        Some(Self::new(div(self.x, len), div(self.y, len)))
    }
}

impl core::ops::Add for V2 {
    type Output = Self;
    fn add(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y)
    }
}

impl core::ops::Sub for V2 {
    type Output = Self;
    fn sub(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whole_pixels_round_trip() {
        assert_eq!(from_px(1), ONE);
        assert_eq!(from_px(440), 440 * ONE);
        assert_eq!(from_px(-17), -17 * ONE);
    }

    #[test]
    fn a_ratio_reads_as_the_decimal_it_came_from() {
        // Matter's friction: .35 — the feel constants must read as themselves.
        assert_eq!(from_ratio(35, 100), (35 * ONE) / 100);
        assert_eq!(from_ratio(1, 2), ONE / 2);
    }

    #[test]
    fn sqrt_of_a_raw_square_is_exact_for_every_whole_pixel_in_range() {
        // The crate is 440x640, so separations run to 777px. Exactness here is
        // what keeps a contact normal from drifting.
        for px in 1..=900i64 {
            let v = from_px(px);
            assert_eq!(sqrt_raw(v * v), v, "sqrt_raw round-trip failed at {px}px");
        }
    }

    #[test]
    fn sqrt_of_zero_and_of_a_negative_is_zero() {
        // A degenerate contact (two centres in the same place) must not panic.
        assert_eq!(sqrt_raw(0), 0);
        assert_eq!(sqrt_raw(-1), 0);
    }

    #[test]
    fn sqrt_floors_between_whole_pixels() {
        // Boundary behaviour, not just the happy points: one sub-unit below a
        // perfect square must floor to the pixel below.
        let v = from_px(100);
        assert_eq!(sqrt_raw(v * v - 1), v - 1);
        assert_eq!(sqrt_raw(v * v + 1), v);
    }

    #[test]
    fn the_worst_case_separation_does_not_overflow() {
        // 440x640 crate: the diagonal is 777px. dx*dx + dy*dy must stay inside
        // i64 with room to spare, or the whole shift-16 choice is wrong.
        let (dx, dy) = (from_px(440), from_px(640));
        let raw = dx * dx + dy * dy;
        assert!(raw > 0, "overflowed into a negative");
        assert!(raw < i64::MAX / 1000, "less than 1000x headroom: {raw}");
        assert_eq!(sqrt_raw(raw), from_px(776) + 43_221); // 776.6595px, computed
    }

    #[test]
    fn divide_survives_the_mass_extreme() {
        // A cherry (r=17) against a watermelon (r=128) is 56.7:1. The impulse
        // divide at that ratio is the worst-conditioned operation in the solver.
        let k_n = 60_648 + 1_069; // the two inv_masses, from the ladder
        let target = from_px(100);
        let lost = target - mul(div(target, k_n), k_n);
        assert!(lost.abs() <= 4, "divide lost {lost} sub-units of {target}");
    }

    #[test]
    fn normalize_returns_a_unit_vector_along_the_original_direction() {
        // Axis-aligned first, where the answer is exact.
        assert_eq!(V2::new(from_px(5), 0).normalize(), Some(V2::new(ONE, 0)));
        assert_eq!(V2::new(0, from_px(-9)).normalize(), Some(V2::new(0, -ONE)));
        // Then a diagonal, where it must land within a sub-unit of unit length.
        let n = V2::new(from_px(3), from_px(4))
            .normalize()
            .expect("has direction");
        assert!((n.len() - ONE).abs() <= 2, "not unit length: {}", n.len());
        // Direction is preserved: a 3-4 vector normalizes to (0.6, 0.8).
        assert!((n.x - mul(from_ratio(6, 10), ONE)).abs() <= 2);
        assert!((n.y - mul(from_ratio(8, 10), ONE)).abs() <= 2);
    }

    #[test]
    fn normalize_of_a_zero_vector_is_none_not_a_panic() {
        // Two circle centres in exactly the same place. The solver has to decide
        // what to do about that; `fixed` must not decide for it, and must not
        // divide by zero deciding.
        assert_eq!(V2::default().normalize(), None);
    }

    #[test]
    fn divide_does_not_overflow_on_a_large_numerator() {
        // `a << 16` overflows i64 above ~1.4e14, which an accumulated impulse in
        // a deep pile can reach. The widening is load-bearing, not defensive.
        let big = 1_i64 << 50;
        assert_eq!(div(big, ONE), big);
    }
}
