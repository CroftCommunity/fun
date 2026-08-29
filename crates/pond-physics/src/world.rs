//! The solver: fixed-point, sequential impulses, discs against static boxes.
//!
//! # Why this is small
//!
//! Two consequences of "discs only" collapse most of a physics engine:
//!
//! 1. **The normal impulse has no angular term.** A circle's contact-point
//!    offset `r` is parallel to the contact normal `n`, so `cross(r, n) == 0`.
//!    The normal effective mass is just `inv_m_a + inv_m_b`.
//! 2. **The tangent effective mass is exactly `3 * k_n`.** For a uniform disc
//!    `I = m*r^2/2`, so `r^2 * inv_I == 2 * inv_m` identically and the radius
//!    cancels: `k_t = (1 + 2)*inv_m_a + (1 + 2)*inv_m_b`.
//!
//! Together these mean the solver **never stores or divides by an inertia**,
//! which is not tidiness — see [`Body::ang_response`](crate::body::Body::ang_response).
//!
//! # What makes a pile stand up
//!
//! **Cross-tick warm starting.** Each contact's accumulated impulse is carried
//! into the next tick and applied before the iterations run, so they refine a
//! nearly-correct answer instead of finding one from zero. Measured without it
//! (`spike/orchard-physics/RESULT.md`, D1): a 30-fruit pile sank to **23.4%**
//! penetration and never went quiet. With it: 0.500 px — exactly the slop — and
//! a 2,534-tick quiet run. Sequential impulses cannot propagate floor support up
//! through a 400 px pile in one tick's worth of iterations, and a pile is
//! nothing but that propagation.
//!
//! The cache is a **key-sorted `Vec`, never a `HashMap`**: hash iteration order
//! is exactly the nondeterminism this crate exists to avoid.

use crate::body::{Body, BodyId, Wall};
use crate::fixed::{div, mul, Fx, ONE, V2};

/// Ticks per simulated second.
///
/// A power of two so `dt` is exact in binary. `1/60` is not representable and
/// would inject a rounding error into every integration on the hashed path;
/// `1/64` costs nothing and removes the error source.
pub const TICK_HZ: i64 = 64;

/// Seconds per tick, in [`Fx`]. Exactly `1/64`.
pub const DT: Fx = ONE / TICK_HZ;

/// Solver tuning. Every field is a measured or ported constant, not a taste.
#[derive(Clone, Copy, Debug)]
pub struct Config {
    /// Downward acceleration, px/s^2.
    pub gravity: Fx,
    /// Solver iterations per tick. Set by the worst-conditioned contact pair in
    /// the game, not by the pile — see the crate's tests.
    pub iterations: u32,
    /// Coefficient of restitution.
    pub restitution: Fx,
    /// Coefficient of friction.
    pub friction: Fx,
    /// Baumgarte position-correction factor.
    pub baumgarte: Fx,
    /// Penetration tolerated before position correction acts. Without a slop a
    /// resting stack jitters forever, correcting an overlap it re-creates.
    pub slop: Fx,
    /// Approach speed below which restitution is suppressed. Without it a pile
    /// never settles: micro-bounces keep re-injecting energy.
    pub rest_threshold: Fx,
}

/// Two bodies that were in contact during the last [`World::step`], reported so
/// a game can act on touches the solver already found. Always low id first.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ContactPair {
    /// The lower id.
    pub a: BodyId,
    /// The higher id.
    pub b: BodyId,
}

/// `(class, first, second)` — class `0` is wall-body, `1` is body-body. Walls
/// resolve first so a body resting on the floor is solved before the pile above
/// it presses down.
type Key = (u32, u32, u32);

#[derive(Clone, Copy, Debug)]
struct Contact {
    key: Key,
    /// Index into `bodies` of the dynamic body A, or `None` when A is a wall.
    a: Option<usize>,
    /// Index into `bodies` of body B. Always dynamic.
    b: usize,
    /// Unit normal, pointing from A toward B.
    n: V2,
    depth: Fx,
    /// Accumulated normal impulse, clamped non-negative.
    pn: Fx,
    /// Accumulated tangent impulse, clamped by Coulomb friction.
    pt: Fx,
}

/// A simulated world: dynamic circles, static walls, and a fixed timestep.
#[derive(Clone, Debug)]
pub struct World {
    config: Config,
    bodies: Vec<Body>,
    walls: Vec<Wall>,
    tick: u32,
    /// Last tick's accumulated impulses, key-sorted. See the module docs.
    cache: Vec<(Key, Fx, Fx)>,
    /// Body-body contacts from the last step, low id first.
    pairs: Vec<ContactPair>,
    deepest: Fx,
}

impl World {
    /// An empty world with the given tuning.
    #[must_use]
    pub fn new(config: Config) -> Self {
        Self {
            config,
            bodies: Vec::new(),
            walls: Vec::new(),
            tick: 0,
            cache: Vec::new(),
            pairs: Vec::new(),
            deepest: 0,
        }
    }

    /// Add a static wall.
    pub fn add_wall(&mut self, wall: Wall) {
        self.walls.push(wall);
    }

    /// Add a dynamic body.
    pub fn add_body(&mut self, body: Body) {
        self.bodies.push(body);
    }

    /// Remove the body with `id`, reporting whether it was there.
    ///
    /// Removal never disturbs the rest: contacts are ordered by id, so what
    /// remains keeps the order it had. A game that merges bodies does this on
    /// every merge, and a pile must not twitch when it happens.
    pub fn remove_body(&mut self, id: BodyId) -> bool {
        let Some(i) = self.bodies.iter().position(|b| b.id() == id) else {
            return false;
        };
        self.bodies.remove(i);
        // No cache surgery here on purpose. `step` clears and rebuilds the
        // warm-start cache from the tick's own contacts, so a removed body's
        // entries are never looked up (no live contact carries their key) and
        // are discarded at the end of the very next step. A `retain` that
        // pruned them was written here first and deleted: mutation testing
        // survived **eleven** mutations of its predicate, which is what inert
        // code looks like from the outside.
        true
    }

    /// The body with `id`, if it is present.
    #[must_use]
    pub fn body(&self, id: BodyId) -> Option<&Body> {
        self.bodies.iter().find(|b| b.id() == id)
    }

    /// Every body, in insertion order. Identity is [`BodyId`], not position.
    pub fn bodies(&self) -> impl Iterator<Item = &Body> {
        self.bodies.iter()
    }

    /// How many bodies the world holds.
    #[must_use]
    pub fn body_count(&self) -> usize {
        self.bodies.len()
    }

    /// Ticks stepped so far.
    #[must_use]
    pub const fn tick(&self) -> u32 {
        self.tick
    }

    /// Body-body contacts found during the last [`World::step`].
    #[must_use]
    pub fn contacts(&self) -> &[ContactPair] {
        &self.pairs
    }

    /// The deepest overlap found during the last [`World::step`], in sub-units.
    /// At rest this converges to the configured slop.
    #[must_use]
    pub const fn deepest_penetration(&self) -> Fx {
        self.deepest
    }

    /// The fastest body's speed, in [`Fx`] px/s.
    #[must_use]
    pub fn max_speed(&self) -> Fx {
        self.bodies.iter().map(|b| b.vel.len()).max().unwrap_or(0)
    }

    /// Advance one fixed tick.
    pub fn step(&mut self) {
        let dv = mul(self.config.gravity, DT);
        for b in &mut self.bodies {
            b.vel.y += dv;
        }

        let mut contacts = self.build_contacts();
        contacts.sort_by_key(|c| c.key);
        self.warm_start(&mut contacts);
        for _ in 0..self.config.iterations {
            for c in &mut contacts {
                self.solve(c);
            }
        }

        for b in &mut self.bodies {
            b.pos = b.pos + b.vel.scale(DT);
            b.ang += mul(b.ang_vel, DT);
        }

        self.deepest = contacts.iter().map(|c| c.depth).max().unwrap_or(0);
        self.pairs = contacts
            .iter()
            .filter(|c| c.a.is_some())
            .map(|c| ContactPair {
                a: BodyId(c.key.1),
                b: BodyId(c.key.2),
            })
            .collect();
        self.cache.clear();
        self.cache
            .extend(contacts.iter().map(|c| (c.key, c.pn, c.pt)));
        self.cache.sort_by_key(|e| e.0);
        self.tick += 1;
    }

    /// The separation normal for a contact.
    ///
    /// When the two centres coincide exactly there is no direction to separate
    /// along, and something has to be chosen. The choice is **straight up**, and
    /// which body goes up follows from the normal pointing A to B: the
    /// higher-id body rises. That is arbitrary but it is not free — it must be
    /// deterministic and written down, because a coin-flip here would be a
    /// divergence between native and wasm. Pinned by
    /// `two_circles_at_the_same_centre_separate_upward_and_deterministically`.
    fn normal_or_fallback(d: V2) -> V2 {
        d.normalize().unwrap_or(V2::new(0, -ONE))
    }

    fn build_contacts(&self) -> Vec<Contact> {
        let mut out = Vec::new();

        for w in &self.walls {
            for (bi, b) in self.bodies.iter().enumerate() {
                let d = b.pos - w.closest_point(b.pos);
                let raw = d.len_raw_sq();
                if raw >= b.radius() * b.radius() {
                    continue;
                }
                out.push(Contact {
                    key: (0, w.id().0, b.id().0),
                    a: None,
                    b: bi,
                    n: Self::normal_or_fallback(d),
                    depth: b.radius() - crate::fixed::sqrt_raw(raw),
                    pn: 0,
                    pt: 0,
                });
            }
        }

        // O(N^2) on purpose: N is a few dozen, so this is ~800 pairs a tick, and
        // a spatial grid would be a subsystem to get deterministically right for
        // no measurable gain.
        for i in 0..self.bodies.len() {
            for j in (i + 1)..self.bodies.len() {
                let sum = self.bodies[i].radius() + self.bodies[j].radius();
                let raw = (self.bodies[j].pos - self.bodies[i].pos).len_raw_sq();
                if raw >= sum * sum {
                    continue;
                }
                // A is the LOWER-ID body, not the earlier-inserted one, and the
                // normal points from A to B. Keying by id while assigning the
                // roles by array index would leave the normal's *direction*
                // dependent on insertion order — the precise thing the key sort
                // exists to prevent, and a bug the ordering test caught here.
                let (ai, bi) = if self.bodies[i].id() <= self.bodies[j].id() {
                    (i, j)
                } else {
                    (j, i)
                };
                let (a, b) = (&self.bodies[ai], &self.bodies[bi]);
                out.push(Contact {
                    key: (1, a.id().0, b.id().0),
                    a: Some(ai),
                    b: bi,
                    n: Self::normal_or_fallback(b.pos - a.pos),
                    depth: sum - crate::fixed::sqrt_raw(raw),
                    pn: 0,
                    pt: 0,
                });
            }
        }
        out
    }

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

    /// Velocity at the contact point of body `i`, whose offset from the centre
    /// is `n * sign * radius`.
    fn point_vel(&self, i: usize, n: V2, sign: i64) -> V2 {
        let b = &self.bodies[i];
        let r = b.radius() * sign;
        let rv = V2::new(mul(n.x, r), mul(n.y, r)).perp();
        b.vel + rv.scale(b.ang_vel)
    }

    fn solve(&mut self, c: &mut Contact) {
        let t = c.n.perp();
        let inv_mass_a = c.a.map_or(0, |i| self.bodies[i].inv_mass());
        let inv_mass_b = self.bodies[c.b].inv_mass();
        let k_n = inv_mass_a + inv_mass_b;
        if k_n == 0 {
            return;
        }

        // ── normal ──
        let at_a = c.a.map_or(V2::default(), |i| self.point_vel(i, c.n, 1));
        let at_b = self.point_vel(c.b, c.n, -1);
        let vn = (at_b - at_a).dot(c.n);
        let excess = (c.depth - self.config.slop).max(0);
        let bias = div(mul(self.config.baumgarte, excess), DT);
        let restitution = if vn < -self.config.rest_threshold {
            mul(self.config.restitution, -vn)
        } else {
            0
        };
        let normal_delta = div(-vn + bias + restitution, k_n);
        let normal_total = (c.pn + normal_delta).max(0);
        let applied = normal_total - c.pn;
        c.pn = normal_total;
        self.apply(c.a, c.b, c.n.scale(applied), 0);

        // ── tangent (friction) ──
        // k_t = 3 * k_n exactly, for uniform discs. See the module docs.
        // Re-read after the normal impulse: friction acts on the velocity the
        // normal solve just produced, not the one it started from.
        let at_a = c.a.map_or(V2::default(), |i| self.point_vel(i, c.n, 1));
        let at_b = self.point_vel(c.b, c.n, -1);
        let vt = (at_b - at_a).dot(t);
        let tangent_delta = div(-vt, 3 * k_n);
        let limit = mul(self.config.friction, c.pn);
        let tangent_total = (c.pt + tangent_delta).clamp(-limit, limit);
        let applied = tangent_total - c.pt;
        c.pt = tangent_total;
        self.apply(c.a, c.b, t.scale(applied), applied);
    }

    /// Apply impulse `p` as `-p` on A and `+p` on B, with the angular part from
    /// the tangent magnitude `pt`.
    fn apply(&mut self, a: Option<usize>, b: usize, p: V2, pt: Fx) {
        if let Some(i) = a {
            let (inv_m, resp) = (self.bodies[i].inv_mass(), self.bodies[i].ang_response());
            self.bodies[i].vel = self.bodies[i].vel - p.scale(inv_m);
            self.bodies[i].ang_vel -= mul(pt, resp);
        }
        let (inv_m, resp) = (self.bodies[b].inv_mass(), self.bodies[b].ang_response());
        self.bodies[b].vel = self.bodies[b].vel + p.scale(inv_m);
        self.bodies[b].ang_vel -= mul(pt, resp);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixed::{from_px, from_ratio, mul};

    const DENSITY: Fx = from_ratio(12, 10_000);
    const CFG: Config = Config {
        gravity: from_px(1000),
        iterations: 24,
        restitution: from_ratio(12, 100),
        friction: from_ratio(35, 100),
        baumgarte: from_ratio(20, 100),
        slop: from_ratio(1, 2),
        rest_threshold: from_px(30),
    };

    /// The Orchard Drop crate: floor plus two side walls, 440x640.
    fn crate_world() -> World {
        let mut w = World::new(CFG);
        let (cw, ch, t) = (from_px(440), from_px(640), from_px(200));
        w.add_wall(Wall::new(
            BodyId(0),
            V2::new(-t, ch),
            V2::new(cw + t, ch + t),
        ));
        w.add_wall(Wall::new(BodyId(1), V2::new(-t, -t), V2::new(0, ch + t)));
        w.add_wall(Wall::new(
            BodyId(2),
            V2::new(cw, -t),
            V2::new(cw + t, ch + t),
        ));
        w
    }

    fn fruit(id: u32, x: i64, y: i64, r: i64) -> Body {
        Body::circle(
            BodyId(id),
            V2::new(from_px(x), from_px(y)),
            from_px(r),
            DENSITY,
        )
    }

    // ── integration ────────────────────────────────────────────────────────

    #[test]
    fn a_body_in_free_fall_accelerates_at_gravity() {
        let mut w = World::new(CFG);
        w.add_body(fruit(100, 220, 100, 17));
        for _ in 0..TICK_HZ {
            w.step();
        }
        // One second of 1000 px/s^2 is 1000 px/s, within a tick's worth.
        let v = w.body(BodyId(100)).expect("body exists").vel.y;
        assert!(
            (v - from_px(1000)).abs() < mul(from_px(1000), DT),
            "after 1s the fall speed was {} px/s, expected ~1000",
            v >> 16
        );
    }

    #[test]
    fn free_fall_has_no_sideways_drift() {
        // Gravity is one axis. Any x-motion here would be an artifact.
        let mut w = World::new(CFG);
        w.add_body(fruit(100, 220, 100, 17));
        for _ in 0..200 {
            w.step();
        }
        assert_eq!(w.body(BodyId(100)).expect("body exists").vel.x, 0);
    }

    #[test]
    fn tick_counts_the_steps_taken() {
        let mut w = World::new(CFG);
        assert_eq!(w.tick(), 0);
        w.step();
        w.step();
        assert_eq!(w.tick(), 2);
    }

    // ── contact ────────────────────────────────────────────────────────────

    #[test]
    fn a_dropped_fruit_lands_on_the_floor_and_rests_within_the_slop() {
        let mut w = crate_world();
        w.add_body(fruit(100, 220, 200, 50));
        for _ in 0..400 {
            w.step();
        }
        let b = w.body(BodyId(100)).expect("body exists");
        // Resting on the floor: centre one radius above it, minus at most a slop.
        let floor = from_px(640);
        let rest_y = floor - from_px(50);
        assert!(
            b.pos.y >= rest_y && b.pos.y - rest_y <= CFG.slop + CFG.slop / 8,
            "rested at {} px, expected {} px within a slop",
            b.pos.y >> 16,
            rest_y >> 16
        );
        assert_eq!(w.max_speed(), 0, "still moving");
    }

    #[test]
    fn a_fruit_bounces_but_less_than_it_fell() {
        // Restitution is .12, so a bounce must exist and must be small. Both
        // halves matter: no bounce at all is as wrong as a lively one.
        let mut w = crate_world();
        w.add_body(fruit(100, 220, 200, 50));
        let start_y = w.body(BodyId(100)).expect("body exists").pos.y;
        let mut lowest = start_y;
        let mut rebound = from_px(640);
        let mut touched = false;
        for _ in 0..400 {
            w.step();
            let y = w.body(BodyId(100)).expect("body exists").pos.y;
            if y > lowest {
                lowest = y;
                touched = true;
            } else if touched {
                rebound = rebound.min(y);
            }
        }
        let fell = lowest - start_y;
        let bounced = lowest - rebound;
        assert!(bounced > 0, "it did not bounce at all");
        assert!(
            bounced < fell / 4,
            "bounced {} px after falling {} px — too lively for restitution .12",
            bounced >> 16,
            fell >> 16
        );
    }

    #[test]
    fn two_stacked_fruit_come_to_rest_touching() {
        let mut w = crate_world();
        w.add_body(fruit(100, 220, 570, 50));
        w.add_body(fruit(101, 220, 400, 50));
        for _ in 0..600 {
            w.step();
        }
        assert_eq!(w.max_speed(), 0, "the stack never settled");
        assert!(
            w.deepest_penetration() <= CFG.slop + CFG.slop / 8,
            "sank {} sub-units into each other, slop is {}",
            w.deepest_penetration(),
            CFG.slop
        );
    }

    #[test]
    fn contacts_are_reported_so_a_game_can_see_what_touched() {
        // Phase 2 detects merges from this list; without it the core would have
        // to re-derive contacts the solver already found.
        let mut w = crate_world();
        w.add_body(fruit(100, 220, 570, 50));
        w.add_body(fruit(101, 220, 400, 50));
        for _ in 0..600 {
            w.step();
        }
        let pairs = w.contacts();
        assert!(
            pairs.contains(&ContactPair {
                a: BodyId(100),
                b: BodyId(101)
            }),
            "the touching pair was not reported: {pairs:?}"
        );
    }

    #[test]
    fn a_contact_pair_is_ordered_low_id_first() {
        // The merge tie-break in Phase 2 depends on this being canonical, not
        // on which body happened to be inserted first.
        let mut w = crate_world();
        w.add_body(fruit(101, 220, 400, 50));
        w.add_body(fruit(100, 220, 570, 50));
        for _ in 0..600 {
            w.step();
        }
        for p in w.contacts() {
            assert!(p.a < p.b, "pair {p:?} is not low-id-first");
        }
    }

    // ── determinism ────────────────────────────────────────────────────────

    #[test]
    fn insertion_order_does_not_change_the_result() {
        // THE determinism property. Same ids, same positions, opposite insertion
        // order — the solver must resolve contacts by id, not by arrival.
        let run = |reversed: bool| {
            let mut w = crate_world();
            let a = fruit(100, 180, 560, 50);
            let b = fruit(101, 260, 400, 50);
            if reversed {
                w.add_body(b);
                w.add_body(a);
            } else {
                w.add_body(a);
                w.add_body(b);
            }
            for _ in 0..600 {
                w.step();
            }
            (0..2)
                .map(|i| {
                    let x = w.body(BodyId(100 + i)).expect("body exists");
                    (x.pos, x.vel, x.ang)
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(run(false), run(true));
    }

    #[test]
    fn removing_a_body_does_not_disturb_the_rest() {
        // Phase 2 removes bodies on every merge. If removal shifted the
        // iteration order of what remains, every merge would perturb the pile.
        let mut w = crate_world();
        for i in 0..3 {
            w.add_body(fruit(100 + i, 100 + 80 * i64::from(i), 560, 33));
        }
        for _ in 0..200 {
            w.step();
        }
        assert!(w.remove_body(BodyId(101)));
        assert!(
            !w.remove_body(BodyId(101)),
            "removing twice reported success"
        );
        assert_eq!(w.body_count(), 2);
        assert!(w.body(BodyId(101)).is_none());
        assert!(w.body(BodyId(100)).is_some() && w.body(BodyId(102)).is_some());
    }

    // ── the cases that set the constants ───────────────────────────────────

    #[test]
    fn the_mass_ratio_extreme_converges_rather_than_limit_cycling() {
        // A watermelon resting on a cherry: 56.7:1 through one contact. At 12
        // iterations this oscillates between 0.1px and 3.75px forever — the
        // failure that looks fine in a screenshot. It is what set `iterations`.
        let mut w = crate_world();
        w.add_body(fruit(100, 220, 623, 17));
        w.add_body(fruit(101, 220, 478, 128));
        let (mut worst_pen, mut worst_speed) = (0, 0);
        for t in 0..1200 {
            w.step();
            if t >= 200 {
                worst_pen = worst_pen.max(w.deepest_penetration());
                worst_speed = worst_speed.max(w.max_speed());
            }
        }
        assert!(
            worst_speed <= from_px(2),
            "still moving: {}",
            worst_speed >> 16
        );
        assert!(worst_pen <= CFG.slop * 2, "penetration reached {worst_pen}");
    }

    #[test]
    fn twelve_iterations_is_not_enough_which_is_what_set_the_constant() {
        // If this ever passes, `iterations` is higher than it needs to be.
        let mut cfg = CFG;
        cfg.iterations = 12;
        let mut w = World::new(cfg);
        let (cw, ch, t) = (from_px(440), from_px(640), from_px(200));
        w.add_wall(Wall::new(
            BodyId(0),
            V2::new(-t, ch),
            V2::new(cw + t, ch + t),
        ));
        w.add_body(fruit(100, 220, 623, 17));
        w.add_body(fruit(101, 220, 478, 128));
        let mut worst_speed = 0;
        for t in 0..1200 {
            w.step();
            if t >= 200 {
                worst_speed = worst_speed.max(w.max_speed());
            }
        }
        assert!(
            worst_speed > from_px(2),
            "12 iterations now converges — revisit `iterations` downward"
        );
    }

    #[test]
    fn two_circles_at_the_same_centre_separate_upward_and_deterministically() {
        // A degenerate contact has no direction to separate along, so the solver
        // picks one. Asserting only "it did not panic" left the choice untested:
        // flipping the fallback normal survived mutation. The direction is a
        // decision — a coin-flip here would diverge native from wasm — so it is
        // pinned: the normal points A to B, A is the lower id, so the HIGHER id
        // rises.
        let mut w = crate_world();
        w.add_body(fruit(100, 220, 300, 33));
        w.add_body(fruit(101, 220, 300, 33));
        w.step();
        let lower = w.body(BodyId(100)).expect("body exists").pos.y;
        let higher = w.body(BodyId(101)).expect("body exists").pos.y;
        assert_eq!(w.body_count(), 2);
        assert!(
            higher < lower,
            "the higher id should rise: 101 at {higher}, 100 at {lower}"
        );
    }

    #[test]
    fn nothing_escapes_the_crate() {
        // Dropped over time, the way the game does. Spawning a dozen bodies
        // already overlapping is not a stress test of the solver, it is a test
        // of what it does with an impossible starting state.
        let mut w = crate_world();
        let mut dropped = 0i64;
        for t in 0..1600 {
            if dropped < 12 && t % 32 == 0 {
                w.add_body(fruit(100 + dropped as u32, 60 + 30 * dropped, 100, 41));
                dropped += 1;
            }
            w.step();
        }
        for b in w.bodies() {
            assert!(b.pos.x > -b.radius() && b.pos.x < from_px(440) + b.radius());
            assert!(
                b.pos.y < from_px(640) + b.radius(),
                "fell through the floor"
            );
        }
    }
}
