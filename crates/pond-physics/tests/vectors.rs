//! Golden vectors — the recorded behaviour a change to the solver has to
//! acknowledge. Each names a scenario, the ticks to run, and the `state_hash`
//! that must come out.
//!
//! **These lock the whole pipeline, not one function.** A vector fails if the
//! integrator, the contact search, the impulse solver, the warm-start cache, the
//! id ordering or the hash changes — which is why they are the artifact the
//! Phase 6 cross-build check compares native against wasm.
//!
//! Regenerating: run with `POND_PHYSICS_RECORD=1` and paste the printed hashes.
//! Regenerate only when a change to behaviour is *intended* — a vector that is
//! updated to make a test pass has stopped being a vector.

use pond_physics::body::{Body, BodyId, Wall};
use pond_physics::fixed::{from_px, from_ratio, Fx, V2};
use pond_physics::hash::state_hash;
use pond_physics::world::{Config, World};

/// The vendored game's density, `.0012`.
const DENSITY: Fx = from_ratio(12, 10_000);

/// Orchard Drop's tuning. Constants ported from the wrap; `iterations` measured.
const CFG: Config = Config {
    gravity: from_px(1000),
    iterations: 24,
    restitution: from_ratio(12, 100),
    friction: from_ratio(35, 100),
    baumgarte: from_ratio(20, 100),
    slop: from_ratio(1, 2),
    rest_threshold: from_px(30),
};

/// The ladder radii, in px.
const RADII: [i64; 11] = [17, 25, 33, 41, 50, 60, 72, 85, 99, 113, 128];

fn empty() -> World {
    World::new(CFG)
}

/// The 440x640 crate: floor and two side walls.
fn crate_world() -> World {
    let mut w = empty();
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

fn fruit(id: u32, x: i64, y: i64, tier: usize) -> Body {
    Body::circle(
        BodyId(id),
        V2::new(from_px(x), from_px(y)),
        from_px(RADII[tier]),
        DENSITY,
    )
}

/// A deterministic xorshift, so the settle vector's drop schedule is fixed
/// without pulling an RNG dependency into a crate that needs none.
struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed ^ 0x9E37_79B9_7F4A_7C15)
    }
    fn below(&mut self, n: u64) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x % n
    }
}

// ── the scenarios ──────────────────────────────────────────────────────────

/// `01-free-fall`: one body, no contacts, 64 ticks. Locks the integrator alone.
fn v01_free_fall() -> World {
    let mut w = empty();
    w.add_body(fruit(100, 220, 100, 0));
    for _ in 0..64 {
        w.step();
    }
    w
}

/// `02-one-bounce`: a persimmon dropped onto the floor, through the bounce and
/// down to rest. Locks restitution, the rest threshold and the slop together.
fn v02_one_bounce() -> World {
    let mut w = crate_world();
    w.add_body(fruit(100, 220, 200, 4));
    for _ in 0..400 {
        w.step();
    }
    w
}

/// `03-two-body-rest`: two persimmons stacked, settled. The simplest state where
/// warm starting is doing work.
fn v03_two_body_rest() -> World {
    let mut w = crate_world();
    w.add_body(fruit(100, 220, 570, 4));
    w.add_body(fruit(101, 220, 400, 4));
    for _ in 0..600 {
        w.step();
    }
    w
}

/// `04-mass-ratio`: a watermelon resting on a cherry, 56.7:1 through one
/// contact. The case that set `iterations`; at 12 it limit-cycles forever.
fn v04_mass_ratio() -> World {
    let mut w = crate_world();
    w.add_body(fruit(100, 220, 623, 0));
    w.add_body(fruit(101, 220, 478, 10));
    for _ in 0..1200 {
        w.step();
    }
    w
}

/// `05-thirty-fruit-settle`: the D1 scenario — thirty fruit dropped half a
/// second apart, then left to settle. Contact-rich on purpose: a pile that never
/// really loaded the solver would hash stably and mean nothing.
fn v05_thirty_fruit_settle() -> World {
    let mut w = crate_world();
    let mut rng = Rng::new(0x0CA5_E50D_1234_5678);
    let mut dropped = 0u32;
    for t in 0..3600 {
        if dropped < 30 && t % 32 == 0 {
            let tier = rng.below(5) as usize;
            let span = 440 - 2 * RADII[tier];
            let x = RADII[tier] + rng.below(span as u64) as i64;
            w.add_body(fruit(100 + dropped, x, 64, tier));
            dropped += 1;
        }
        w.step();
    }
    w
}

/// `(name, note, builder, expected hash)`.
type Vector = (&'static str, &'static str, fn() -> World, &'static str);

const VECTORS: [Vector; 5] = [
    (
        "01-free-fall",
        "One cherry, no contacts, one simulated second. Locks the integrator.",
        v01_free_fall,
        "a9e28c95dcc328d378937f0af0a383acda92b2418a04a88dfe10340a7f2f1a07",
    ),
    (
        "02-one-bounce",
        "A persimmon dropped onto the floor, through its bounce to rest.",
        v02_one_bounce,
        "f3fdeb114c18b379097ae5ab167626b46a463f15722263968490eb408ffefd43",
    ),
    (
        "03-two-body-rest",
        "Two persimmons stacked and settled. Warm starting is load-bearing here.",
        v03_two_body_rest,
        "8240a1de3f8f24ad9cfa88d5ba7a90bf70a66dc9b2a5324e5a6a714f3d7532ba",
    ),
    (
        "04-mass-ratio",
        "A watermelon resting on a cherry: 56.7:1 through one contact.",
        v04_mass_ratio,
        "dee8de1f6cdbb56963961112bac8dab59fe2ff9e06571f5c85cca46af316d902",
    ),
    (
        "05-thirty-fruit-settle",
        "Thirty fruit dropped half a second apart, then 2,600 ticks of settling.",
        v05_thirty_fruit_settle,
        "27c0b925529de13c5cf37c71e3ad98f9c5951d70ccf256a9c57b97063cc8eb40",
    ),
];

#[test]
fn golden_vectors_hold() {
    let record = std::env::var("POND_PHYSICS_RECORD").is_ok();
    let mut drift = Vec::new();
    for (name, note, build, expected) in VECTORS {
        let got = state_hash(&build());
        if record {
            println!("        \"{got}\",  // {name}");
        } else if got != *expected {
            drift.push(format!(
                "  {name}\n    expected {expected}\n    got      {got}\n    ({note})"
            ));
        }
    }
    assert!(
        drift.is_empty(),
        "golden vectors drifted:\n{}\n\nIf the change was intended, re-record with \
         POND_PHYSICS_RECORD=1 and say why in the commit.",
        drift.join("\n")
    );
}

#[test]
fn the_settle_vector_is_not_inert() {
    // A vector that hashes stably because nothing happened proves nothing. This
    // is the believability guard for `05`.
    let w = v05_thirty_fruit_settle();
    assert_eq!(w.body_count(), 30, "all thirty fruit are present");
    // "Settled" is below 1 px/s, not exactly zero. The Phase 0 spike reported
    // `max_speed_px: 0` for this pile, but that figure was truncated to whole
    // pixels; the true residue is ~0.36 px/s. A thirty-body pile holds a little
    // creep that a two-body stack does not, and pretending otherwise would be
    // asserting the measurement's rounding rather than the behaviour.
    assert!(
        w.max_speed() < from_px(1),
        "the pile is still moving at {} sub-units/s",
        w.max_speed()
    );
    assert!(
        w.bodies().any(|b| b.pos.y > from_px(500)),
        "fruit reached the bottom of the crate"
    );
    assert!(
        w.bodies().any(|b| b.pos.y < from_px(350)),
        "the pile has height — it did not all lie flat"
    );
    assert!(
        w.deepest_penetration() <= CFG.slop + CFG.slop / 8,
        "resting penetration {} exceeds the slop {}",
        w.deepest_penetration(),
        CFG.slop
    );
}

#[test]
fn a_one_sub_unit_change_moves_the_settle_hash() {
    // The vectors are only worth having if they can see the smallest change.
    let mut a = crate_world();
    a.add_body(fruit(100, 220, 300, 4));
    let mut b = crate_world();
    b.add_body(Body::circle(
        BodyId(100),
        V2::new(from_px(220) + 1, from_px(300)),
        from_px(RADII[4]),
        DENSITY,
    ));
    for _ in 0..400 {
        a.step();
        b.step();
    }
    assert_ne!(state_hash(&a), state_hash(&b));
}
