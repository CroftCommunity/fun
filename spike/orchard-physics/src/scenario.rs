//! The fixed measurement scenario, its digest, and the settle metrics.
//!
//! The scenario is contact-rich on purpose, for the same reason the rapier spike's
//! was: a pile that never really loads the solver would hash stably and mean
//! nothing. Thirty fruit from the droppable tiers fall into the crate half a
//! second apart, then the world runs on to 3,600 ticks so the pile has time to
//! settle (or to reveal that it does not).

use crate::fixed::{from_px, Fx, V2};
use crate::world::{Body, World, TICK_HZ};

/// The vendored game's ladder radii, in px (`FRUITS[].r`).
pub const RADII: [i64; 11] = [17, 25, 33, 41, 50, 60, 72, 85, 99, 113, 128];

/// Only tiers 0..4 spawn from the top (`DROPPABLE = 5`).
pub const DROPPABLE: usize = 5;

/// Fruit in the settle scenario.
pub const FRUIT_COUNT: u32 = 30;

/// Ticks between drops (half a second).
pub const DROP_INTERVAL: u32 = TICK_HZ as u32 / 2;

/// Total ticks the scenario runs.
pub const TOTAL_TICKS: u32 = 3600;

/// Ticks at the end over which the world must stay quiet for D1 to pass.
pub const QUIET_WINDOW: u32 = 600;

/// The scenario's drop-schedule seed. Arbitrary but fixed — the scenario has to
/// be the same run every time for a digest to mean anything.
pub const SCENARIO_SEED: u64 = 0x0CA5_E50D_1234_5678;

/// A deterministic xorshift, for the spike's drop schedule only. The real core
/// uses seeded ChaCha20 like every other game here; this exists so the scenario
/// is reproducible without pulling a dependency into a throwaway crate.
pub struct Rng(u64);

impl Rng {
    /// Seed the generator.
    #[must_use]
    pub const fn new(seed: u64) -> Self {
        Self(seed ^ 0x9E37_79B9_7F4A_7C15)
    }

    /// Next raw value. Named `next_u64` rather than `next` so it cannot be
    /// confused with `Iterator::next`.
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    /// Next value in `0..n`.
    pub fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }
}

/// Build the settle scenario's world and run it for `ticks`, optionally nudging
/// the first fruit's spawn `x` by `perturb` sub-units (the digest-sensitivity
/// guard) and optionally breaking contact order (D6).
#[must_use]
pub fn run(ticks: u32, perturb: i64, reverse_contacts: bool) -> World {
    let mut world = World::crate_walls();
    world.reverse_contacts = reverse_contacts;
    let mut rng = Rng::new(SCENARIO_SEED);
    let mut dropped = 0u32;
    let mut next_id = 100u32;

    for t in 0..ticks {
        if dropped < FRUIT_COUNT && t % DROP_INTERVAL == 0 {
            let tier = rng.below(DROPPABLE as u64) as usize;
            let r = from_px(RADII[tier]);
            // Keep the whole fruit inside the crate at spawn.
            let span = 440 - 2 * RADII[tier];
            let x = from_px(RADII[tier] + rng.below(span as u64) as i64)
                + if dropped == 0 { perturb } else { 0 };
            world.add(Body::circle(
                next_id,
                tier as u8,
                V2::new(x, from_px(64)),
                r,
            ));
            next_id += 1;
            dropped += 1;
        }
        world.step();
    }
    world
}

/// FNV-1a-64 over the bit patterns of every body's `(x, y, ang)`, in body order.
///
/// Same construction as `discovery/alpha/experiments/rapier-determinism`, so the
/// two results are comparable. Bit patterns rather than values: the question is
/// whether the arithmetic is identical, not whether it is close.
#[must_use]
pub fn digest(world: &World) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in &world.bodies {
        for v in [b.pos.x, b.pos.y, b.ang] {
            for byte in (v as u64).to_le_bytes() {
                h ^= u64::from(byte);
                h = h.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
    }
    h
}

/// What the settle scenario measured. All distances in px (converted out of `Fx`
/// only here, at the reporting boundary).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Settle {
    /// Largest speed of any body, px/s.
    pub max_speed_px: i64,
    /// Sum of all speeds, px/s.
    pub total_speed_px: i64,
    /// Deepest overlap between any two bodies or a body and a wall, in
    /// thousandths of the smaller radius.
    pub max_penetration_permille: i64,
    /// The same overlap in absolute sub-units. This is the honest measure: the
    /// solver's slop is an absolute distance, so a percentage-of-radius bar is
    /// unsatisfiable across a 7.5:1 radius range (1% of a cherry is 0.17px, 1%
    /// of a watermelon is 1.28px — one slop cannot be under both).
    pub max_penetration_sub: i64,
    /// Bodies that left the crate entirely.
    pub escaped: u32,
    /// How high the pile reached, px from the crate floor.
    pub pile_height_px: i64,
}

/// Measure the world's current state.
#[must_use]
pub fn measure(world: &World) -> Settle {
    let mut max_speed: Fx = 0;
    let mut total_speed: Fx = 0;
    let mut escaped = 0;
    let mut min_y: Fx = from_px(640);

    for b in &world.bodies {
        let s = b.vel.len();
        max_speed = max_speed.max(s);
        total_speed += s;
        if b.pos.x < -b.radius
            || b.pos.x > from_px(440) + b.radius
            || b.pos.y > from_px(640) + b.radius
        {
            escaped += 1;
        }
        min_y = min_y.min(b.pos.y - b.radius);
    }

    let mut worst_permille = 0i64;
    let mut worst_sub = 0i64;
    for i in 0..world.bodies.len() {
        let a = &world.bodies[i];
        for w in &world.walls {
            let closest = V2::new(
                a.pos.x.clamp(w.min.x, w.max.x),
                a.pos.y.clamp(w.min.y, w.max.y),
            );
            let depth = a.radius - (a.pos - closest).len();
            if depth > 0 {
                worst_permille = worst_permille.max(depth * 1000 / a.radius);
                worst_sub = worst_sub.max(depth);
            }
        }
        for j in (i + 1)..world.bodies.len() {
            let b = &world.bodies[j];
            let depth = (a.radius + b.radius) - (b.pos - a.pos).len();
            if depth > 0 {
                let smaller = a.radius.min(b.radius);
                worst_permille = worst_permille.max(depth * 1000 / smaller);
                worst_sub = worst_sub.max(depth);
            }
        }
    }

    Settle {
        max_speed_px: max_speed >> 16,
        total_speed_px: total_speed >> 16,
        max_penetration_permille: worst_permille,
        max_penetration_sub: worst_sub,
        escaped,
        pile_height_px: (from_px(640) - min_y) >> 16,
    }
}
