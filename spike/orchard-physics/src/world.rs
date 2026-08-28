//! The solver: fixed-point, sequential-impulse, circles against static AABBs.
//!
//! # Why this is small
//!
//! Orchard Drop needs discs in a box and nothing else, and two consequences of
//! "discs only" collapse most of a physics engine:
//!
//! 1. **The normal impulse has no angular term.** For a circle, the contact-point
//!    offset `r` is parallel to the contact normal `n`, so `cross(r, n) == 0`. The
//!    normal effective mass is just `inv_m_a + inv_m_b` — no inertia, no cross terms.
//! 2. **The tangent effective mass is exactly `3x` the normal one.** For a uniform
//!    disc `I = m*r^2/2`, so `r^2 * inv_I = 2 * inv_m` identically — the radius
//!    cancels. `k_t = inv_m_a + inv_m_b + 2*inv_m_a + 2*inv_m_b = 3*k_n`.
//!
//! Together these mean **the solver never stores or divides by an inertia term.**
//! That matters beyond tidiness: `inv_I` for a watermelon is `1.98e-6`, which
//! underflows to **zero** at shift-16 — a real precision failure that the identity
//! above removes rather than works around.
//!
//! # Determinism
//!
//! Contacts are sorted by an explicit integer key before solving, never left in
//! generation order. Body ids are the sort key and are stable across removals, so
//! the iteration order is a property of the world's contents rather than of how it
//! was built. `Solver::reverse_contacts` exists only to *break* that on purpose,
//! so D6's bisect tool can be shown to detect a divergence rather than assumed to.

use crate::fixed::{div, from_px, from_ratio, mul, sqrt_raw, Fx, ONE, V2};

/// Ticks per simulated second. A power of two so `dt` is exact in binary: `1/64`
/// is representable, `1/60` is not. Costs nothing and removes a rounding-error
/// source from the hashed path.
pub const TICK_HZ: i64 = 64;

/// Seconds per tick, in `Fx`. Exactly `1/64`.
pub const DT: Fx = ONE / TICK_HZ;

/// Downward acceleration, px/s^2.
pub const GRAVITY: Fx = from_px(1000);

/// Solver iterations per tick.
///
/// **Measured, not guessed** (`src/bin/sweep.rs`). At 12 the 56.7:1 mass-ratio
/// case — a watermelon resting on a cherry — does not converge: it limit-cycles
/// between 0.1px and 3.75px of penetration for as long as you run it. At 20 it
/// converges and stays converged, and 32/48/64/96 buy nothing further. 24 is 20
/// with margin. The 30-fruit pile was stable at every count tried, so this
/// constant is set by the ill-conditioned pair, not by the pile.
pub const ITERATIONS: u32 = 24;

/// Coefficient of restitution (Matter's `restitution: .12`).
pub const RESTITUTION: Fx = from_ratio(12, 100);

/// Coefficient of friction (Matter's `friction: .35`).
pub const FRICTION: Fx = from_ratio(35, 100);

/// Baumgarte position-correction factor.
pub const BAUMGARTE: Fx = from_ratio(20, 100);

/// Penetration tolerated before position correction kicks in, px. Without a slop
/// a resting stack jitters forever, correcting a sub-pixel overlap it re-creates.
pub const SLOP: Fx = from_ratio(1, 2);

/// Approach speed below which restitution is suppressed. Without this a pile
/// never settles: micro-bounces keep re-injecting energy.
pub const REST_THRESHOLD: Fx = from_px(30);

/// Density (Matter's `density: .0012`).
pub const DENSITY: Fx = from_ratio(12, 10_000);

/// Pi, in `Fx`.
const PI: Fx = 205_887; // 3.14159265 * 65536, rounded

/// A dynamic circle.
#[derive(Clone, Debug)]
pub struct Body {
    /// Stable identity. The contact sort key, so it is load-bearing.
    pub id: u32,
    /// Centre position.
    pub pos: V2,
    /// Linear velocity, px/s.
    pub vel: V2,
    /// Orientation, radians. Presentational — never hashed.
    pub ang: Fx,
    /// Angular velocity, rad/s.
    pub ang_vel: Fx,
    /// Radius.
    pub radius: Fx,
    /// Reciprocal mass. Zero would mean static; dynamic bodies are never zero.
    pub inv_mass: Fx,
    /// Precomputed `2 * inv_mass / radius` — the angular response to a unit
    /// tangent impulse, with the disc identity already folded in.
    pub ang_response: Fx,
    /// Ladder tier, carried for the harness's benefit only.
    pub tier: u8,
}

impl Body {
    /// A fruit of `radius` at `pos`, with mass derived from [`DENSITY`].
    #[must_use]
    pub fn circle(id: u32, tier: u8, pos: V2, radius: Fx) -> Self {
        let area = mul(PI, mul(radius, radius));
        let mass = mul(area, DENSITY);
        let inv_mass = div(ONE, mass);
        Self {
            id,
            pos,
            vel: V2::default(),
            ang: 0,
            ang_vel: 0,
            radius,
            inv_mass,
            ang_response: div(2 * inv_mass, radius),
            tier,
        }
    }
}

/// A static axis-aligned box. Walls only — never dynamic, never rotated.
#[derive(Clone, Copy, Debug)]
pub struct Wall {
    /// Sort key, disjoint from body ids by construction (walls sort first).
    pub id: u32,
    /// Minimum corner.
    pub min: V2,
    /// Maximum corner.
    pub max: V2,
}

/// One resolved contact, with its within-tick accumulated impulses.
#[derive(Clone, Copy, Debug)]
struct Contact {
    /// Sort key. See [`ContactKey`].
    key: ContactKey,
    /// Index into `bodies` of the dynamic body A, or `None` for a wall.
    a: Option<usize>,
    /// Index into `bodies` of the dynamic body B. Always dynamic.
    b: usize,
    /// Unit normal, pointing from A toward B.
    n: V2,
    /// Penetration depth.
    depth: Fx,
    /// Accumulated normal impulse (clamped `>= 0`).
    pn: Fx,
    /// Accumulated tangent impulse (clamped by Coulomb friction).
    pt: Fx,
}

/// The simulated world.
#[derive(Clone, Debug, Default)]
pub struct World {
    /// Dynamic bodies, in insertion order. `id` is the identity, not the index.
    pub bodies: Vec<Body>,
    /// Static walls.
    pub walls: Vec<Wall>,
    /// Ticks stepped so far.
    pub tick: u32,
    /// D6 only: solve contacts in reverse order, to manufacture a divergence.
    pub reverse_contacts: bool,
    /// Solver iterations per tick. Defaults to [`ITERATIONS`]; a field rather
    /// than a constant so Phase 0 can sweep it.
    pub iterations: u32,
    /// Last tick's accumulated impulses, keyed by contact key and kept sorted.
    ///
    /// **This is what makes a pile stand up.** Without it every tick re-derives
    /// the stack's support impulse from zero, and 12 Gauss-Seidel iterations
    /// cannot propagate support from the floor to the top of a 400px pile — the
    /// measured result was 23.4% penetration and a pile that never went quiet.
    /// A `Vec` kept sorted rather than a `HashMap`: hash iteration order is
    /// exactly the nondeterminism this crate exists to avoid.
    cache: Vec<(ContactKey, Fx, Fx)>,
}

/// `(kind, first, second)` — `kind` 0 = wall-body, 1 = body-body.
type ContactKey = (u32, u32, u32);

impl World {
    /// An empty world.
    #[must_use]
    pub fn new() -> Self {
        Self {
            iterations: ITERATIONS,
            ..Self::default()
        }
    }

    /// The Orchard Drop crate: floor plus two side walls, sized to the vendored
    /// game's logical playfield (`W = 440`, `H = 640`, `WALL = 26`).
    #[must_use]
    pub fn crate_walls() -> Self {
        let w = from_px(440);
        let h = from_px(640);
        let t = from_px(200); // thick enough that nothing can tunnel through
        let mut world = Self::new();
        world.walls.push(Wall {
            id: 0,
            min: V2::new(-t, h),
            max: V2::new(w + t, h + t),
        }); // floor
        world.walls.push(Wall {
            id: 1,
            min: V2::new(-t, -t),
            max: V2::new(0, h + t),
        }); // left
        world.walls.push(Wall {
            id: 2,
            min: V2::new(w, -t),
            max: V2::new(w + t, h + t),
        }); // right
        world
    }

    /// Add a body, returning its index.
    pub fn add(&mut self, body: Body) -> usize {
        self.bodies.push(body);
        self.bodies.len() - 1
    }

    /// Advance one fixed tick.
    pub fn step(&mut self) {
        self.integrate_velocity();
        let mut contacts = self.build_contacts();
        contacts.sort_by_key(|c| c.key);
        if self.reverse_contacts {
            contacts.reverse();
        }
        self.warm_start(&mut contacts);
        for _ in 0..self.iterations {
            for c in &mut contacts {
                self.solve(c);
            }
        }
        self.integrate_position();
        self.store_cache(&contacts);
        self.tick += 1;
    }

    /// Seed each contact from last tick's accumulated impulse and apply it, so
    /// the iterations refine a nearly-correct answer instead of finding one.
    fn warm_start(&mut self, contacts: &mut [Contact]) {
        for c in contacts.iter_mut() {
            let Ok(i) = self.cache.binary_search_by_key(&c.key, |e| e.0) else {
                continue;
            };
            let (_, pn, pt) = self.cache[i];
            c.pn = pn;
            c.pt = pt;
            let p = c.n.scale(pn) + c.n.perp().scale(pt);
            self.apply(c.a, c.b, p, pt);
        }
    }

    /// Replace the cache with this tick's impulses. Rebuilt rather than merged,
    /// so a contact that ended does not leave a stale entry behind; `contacts` is
    /// already key-sorted unless D6 reversed it, hence the explicit re-sort.
    fn store_cache(&mut self, contacts: &[Contact]) {
        self.cache.clear();
        self.cache
            .extend(contacts.iter().map(|c| (c.key, c.pn, c.pt)));
        self.cache.sort_by_key(|e| e.0);
    }

    fn integrate_velocity(&mut self) {
        let dv = mul(GRAVITY, DT);
        for b in &mut self.bodies {
            b.vel.y += dv;
        }
    }

    fn integrate_position(&mut self) {
        for b in &mut self.bodies {
            b.pos = b.pos + b.vel.scale(DT);
            b.ang += mul(b.ang_vel, DT);
        }
    }

    fn build_contacts(&self) -> Vec<Contact> {
        let mut out = Vec::new();

        // Wall contacts first (kind 0), so a body resting on the floor is solved
        // before the pile above it pushes down on it.
        for w in &self.walls {
            for (bi, b) in self.bodies.iter().enumerate() {
                let closest = V2::new(
                    b.pos.x.clamp(w.min.x, w.max.x),
                    b.pos.y.clamp(w.min.y, w.max.y),
                );
                let d = b.pos - closest;
                let raw = d.len_raw_sq();
                if raw >= b.radius * b.radius {
                    continue;
                }
                let dist = sqrt_raw(raw);
                // A centre exactly on the surface has no direction to separate
                // along; push straight out of the nearest face instead of
                // dividing by zero.
                let n = if dist == 0 {
                    V2::new(0, -ONE)
                } else {
                    V2::new(div(d.x, dist), div(d.y, dist))
                };
                out.push(Contact {
                    key: (0, w.id, b.id),
                    a: None,
                    b: bi,
                    n,
                    depth: b.radius - dist,
                    pn: 0,
                    pt: 0,
                });
            }
        }

        // Body-body contacts (kind 1). O(N^2) is deliberate: N is at most a few
        // dozen fruit, so ~800 pairs per tick, and a spatial grid would be a
        // subsystem to get deterministically right for no measurable gain.
        for i in 0..self.bodies.len() {
            for j in (i + 1)..self.bodies.len() {
                let (a, b) = (&self.bodies[i], &self.bodies[j]);
                let d = b.pos - a.pos;
                let raw = d.len_raw_sq();
                let sum = a.radius + b.radius;
                if raw >= sum * sum {
                    continue;
                }
                let dist = sqrt_raw(raw);
                let n = if dist == 0 {
                    V2::new(0, -ONE)
                } else {
                    V2::new(div(d.x, dist), div(d.y, dist))
                };
                let (lo, hi) = if a.id <= b.id {
                    (a.id, b.id)
                } else {
                    (b.id, a.id)
                };
                out.push(Contact {
                    key: (1, lo, hi),
                    a: Some(i),
                    b: j,
                    n,
                    depth: sum - dist,
                    pn: 0,
                    pt: 0,
                });
            }
        }
        out
    }

    /// Velocity at the contact point of body `i`, whose offset from the centre is
    /// `n * sign * radius`.
    fn point_vel(&self, i: usize, n: V2, sign: i64) -> V2 {
        let b = &self.bodies[i];
        let r = b.radius * sign;
        // w x r, in 2D: ang_vel * perp(r)
        let rv = V2::new(mul(n.x, r), mul(n.y, r)).perp();
        b.vel + rv.scale(b.ang_vel)
    }

    fn solve(&mut self, c: &mut Contact) {
        let t = c.n.perp();

        // A's contact point sits at +r along the normal; B's at -r.
        let va = c.a.map_or(V2::default(), |i| self.point_vel(i, c.n, 1));
        let vb = self.point_vel(c.b, c.n, -1);
        let rv = vb - va;

        let inv_ma = c.a.map_or(0, |i| self.bodies[i].inv_mass);
        let inv_mb = self.bodies[c.b].inv_mass;
        let k_n = inv_ma + inv_mb;
        if k_n == 0 {
            return;
        }

        // ---- normal ----
        let vn = rv.dot(c.n);
        let excess = (c.depth - SLOP).max(0);
        let bias = div(mul(BAUMGARTE, excess), DT);
        let restitution = if vn < -REST_THRESHOLD {
            mul(RESTITUTION, -vn)
        } else {
            0
        };
        let dpn = div(-vn + bias + restitution, k_n);
        let new_pn = (c.pn + dpn).max(0);
        let applied_n = new_pn - c.pn;
        c.pn = new_pn;
        let p = c.n.scale(applied_n);
        self.apply(c.a, c.b, p, 0);

        // ---- tangent (friction) ----
        // k_t = 3 * k_n exactly, for uniform discs. See the module doc.
        let va = c.a.map_or(V2::default(), |i| self.point_vel(i, c.n, 1));
        let vb = self.point_vel(c.b, c.n, -1);
        let vt = (vb - va).dot(t);
        let k_t = 3 * k_n;
        let dpt = div(-vt, k_t);
        let limit = mul(FRICTION, c.pn);
        let new_pt = (c.pt + dpt).clamp(-limit, limit);
        let applied_t = new_pt - c.pt;
        c.pt = new_pt;
        let p = t.scale(applied_t);
        self.apply(c.a, c.b, p, applied_t);
    }

    /// Apply impulse `p` (and its angular part, from the tangent magnitude
    /// `pt`) as `-p` on A and `+p` on B.
    fn apply(&mut self, a: Option<usize>, b: usize, p: V2, pt: Fx) {
        if let Some(i) = a {
            let inv_m = self.bodies[i].inv_mass;
            let resp = self.bodies[i].ang_response;
            self.bodies[i].vel = self.bodies[i].vel - p.scale(inv_m);
            self.bodies[i].ang_vel -= mul(pt, resp);
        }
        let inv_m = self.bodies[b].inv_mass;
        let resp = self.bodies[b].ang_response;
        self.bodies[b].vel = self.bodies[b].vel + p.scale(inv_m);
        self.bodies[b].ang_vel -= mul(pt, resp);
    }
}
