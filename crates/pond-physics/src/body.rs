//! Bodies: dynamic circles and static axis-aligned boxes. That is the whole
//! vocabulary — no polygons, no compound shapes, no joints. See the crate docs
//! for why the shelf's one physics game needs nothing else, and what that
//! narrowness buys.

use crate::fixed::{div, mul, Fx, ONE, V2};

/// Pi, in [`Fx`]. `3.14159265 * 65536`, rounded.
const PI: Fx = 205_887;

/// A body's stable identity.
///
/// Ids are the solver's contact iteration order, so they are load-bearing
/// rather than bookkeeping: the order contacts are resolved in changes the
/// result, and it must be a property of the world's contents rather than of the
/// order they happened to be inserted or removed in.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Hash)]
pub struct BodyId(pub u32);

/// A dynamic circle.
#[derive(Clone, Debug)]
pub struct Body {
    id: BodyId,
    /// Centre position.
    pub pos: V2,
    /// Linear velocity, px/s.
    pub vel: V2,
    /// Orientation, radians. Presentational — the renderer turns the sprite by
    /// it; nothing in the solver reads it.
    pub ang: Fx,
    /// Angular velocity, rad/s.
    pub ang_vel: Fx,
    radius: Fx,
    inv_mass: Fx,
    ang_response: Fx,
}

impl Body {
    /// A circle of `radius` at `pos`, with mass derived from `density`.
    ///
    /// # Panics
    /// Panics in debug builds if `radius` or `density` is zero — a massless or
    /// dimensionless body has no meaning here and would divide by zero.
    #[must_use]
    pub fn circle(id: BodyId, pos: V2, radius: Fx, density: Fx) -> Self {
        debug_assert!(radius > 0, "a circle needs a radius");
        debug_assert!(density > 0, "a circle needs a density");
        let area = mul(PI, mul(radius, radius));
        let mass = mul(area, density);
        let inv_mass = div(ONE, mass);
        Self {
            id,
            pos,
            vel: V2::default(),
            ang: 0,
            ang_vel: 0,
            radius,
            inv_mass,
            // The disc identity, precomputed: the angular velocity change from a
            // unit tangent impulse. For a uniform disc `I = m*r^2/2`, so
            // `r * inv_I == 2 * inv_m / r`. See `ang_response`.
            ang_response: div(2 * inv_mass, radius),
        }
    }

    /// This body's identity.
    #[must_use]
    pub const fn id(&self) -> BodyId {
        self.id
    }

    /// Radius.
    #[must_use]
    pub const fn radius(&self) -> Fx {
        self.radius
    }

    /// Reciprocal mass. Never zero for a dynamic body.
    #[must_use]
    pub const fn inv_mass(&self) -> Fx {
        self.inv_mass
    }

    /// The angular velocity change produced by a unit tangent impulse:
    /// `2 * inv_mass / radius`.
    ///
    /// This is the disc identity doing real work. A general solver stores an
    /// inverse inertia; at shift-16 a watermelon's would be `1.98e-6`, which
    /// **underflows to zero**, and the largest fruit would silently stop
    /// rotating. Because `r^2 * inv_I == 2 * inv_m` for a uniform disc, the
    /// radius cancels and the quantity the solver actually needs stays well
    /// inside the fixed-point range.
    #[must_use]
    pub const fn ang_response(&self) -> Fx {
        self.ang_response
    }
}

/// A static axis-aligned box. Walls only — never dynamic, never rotated.
#[derive(Clone, Copy, Debug)]
pub struct Wall {
    id: BodyId,
    min: V2,
    max: V2,
}

impl Wall {
    /// A box spanning `min..max`.
    #[must_use]
    pub const fn new(id: BodyId, min: V2, max: V2) -> Self {
        Self { id, min, max }
    }

    /// This wall's identity. Walls and bodies share the id space but sort into
    /// separate contact classes, so the two may reuse numbers.
    #[must_use]
    pub const fn id(&self) -> BodyId {
        self.id
    }

    /// The point on or inside this box nearest to `p`.
    ///
    /// For a point outside the box this is the contact point. For a point
    /// *inside* it, the clamp is a no-op and returns `p` itself — the caller
    /// must recognise that case, because it means there is no direction to
    /// separate along.
    #[must_use]
    pub fn closest_point(&self, p: V2) -> V2 {
        V2::new(
            p.x.clamp(self.min.x, self.max.x),
            p.y.clamp(self.min.y, self.max.y),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixed::{div, from_px, from_ratio, mul, ONE};

    /// The vendored game's density, `.0012`.
    const DENSITY: Fx = from_ratio(12, 10_000);

    fn fruit(px: i64) -> Body {
        Body::circle(BodyId(1), V2::default(), from_px(px), DENSITY)
    }

    #[test]
    fn mass_comes_from_area_and_density_so_a_bigger_fruit_is_heavier() {
        let cherry = fruit(17);
        let melon = fruit(128);
        // Heavier means a SMALLER reciprocal mass. Stated as the ratio rather
        // than two magic numbers, so the assertion survives a density change.
        assert!(melon.inv_mass() < cherry.inv_mass());
        let ratio = div(cherry.inv_mass(), melon.inv_mass());
        // Area ratio is (128/17)^2 = 56.7.
        assert!(
            (ratio - from_ratio(567, 10)).abs() < ONE,
            "mass ratio was {}, expected ~56.7",
            ratio as f64 / ONE as f64
        );
    }

    #[test]
    fn a_unit_disc_of_unit_density_has_mass_pi() {
        // Pins the area formula itself, not just the ratio between two fruit.
        let b = Body::circle(BodyId(1), V2::default(), from_px(1), ONE);
        let mass = div(ONE, b.inv_mass());
        assert!(
            (mass - 205_887).abs() < 64,
            "mass {mass} is not pi in Fx (205887)"
        );
    }

    #[test]
    fn ang_response_is_the_disc_identity_two_inv_mass_over_radius() {
        // For a uniform disc I = m*r^2/2, so r^2 * inv_I === 2 * inv_m and the
        // radius cancels. This is why the solver stores no inertia at all.
        for px in [17i64, 41, 128] {
            let b = fruit(px);
            let expected = div(2 * b.inv_mass(), from_px(px));
            assert_eq!(b.ang_response(), expected, "radius {px}");
        }
    }

    #[test]
    fn inv_inertia_would_underflow_which_is_why_no_inertia_is_stored() {
        // A standing record, not a behaviour test. A watermelon's inertia is
        // 3.3e10, so its reciprocal is 1.98e-6 — below one sub-unit at shift-16.
        // Anyone who "tidies up" by adding an inertia field back gets this.
        let melon = fruit(128);
        let mass = div(ONE, melon.inv_mass());
        let inertia = mul(mul(mass, from_px(128)), from_px(128)) / 2;
        assert_eq!(
            div(ONE, inertia),
            0,
            "inv_inertia is representable after all — re-check whether the \
             disc identity is still load-bearing"
        );
        // ... while ang_response, which routes around it, is not zero.
        assert!(melon.ang_response() > 0);
    }

    #[test]
    fn a_wall_clamps_a_point_to_its_nearest_surface() {
        let w = Wall::new(
            BodyId(0),
            V2::new(0, from_px(640)),
            V2::new(from_px(440), from_px(840)),
        );
        // Above the floor: clamps down to the top face.
        assert_eq!(
            w.closest_point(V2::new(from_px(220), from_px(600))),
            V2::new(from_px(220), from_px(640))
        );
        // Past the right edge: clamps in both axes, to the corner.
        assert_eq!(
            w.closest_point(V2::new(from_px(500), from_px(600))),
            V2::new(from_px(440), from_px(640))
        );
        // Inside the box: clamping is a no-op, which is the degenerate case the
        // solver must notice rather than divide by.
        let inside = V2::new(from_px(220), from_px(700));
        assert_eq!(w.closest_point(inside), inside);
    }

    #[test]
    fn ids_order_bodies_for_the_solver() {
        // Contact iteration order is sorted by id, so ordering is load-bearing.
        assert!(BodyId(1) < BodyId(2));
        let mut ids = vec![BodyId(7), BodyId(2), BodyId(30)];
        ids.sort_unstable();
        assert_eq!(ids, vec![BodyId(2), BodyId(7), BodyId(30)]);
    }
}
