//! Iteration-count sweep for D1 and D2b. The D2b pair (a watermelon resting on
//! a cherry, 56.7:1 through one contact) limit-cycles at 12 iterations rather
//! than converging; this asks whether that is an iteration budget problem or a
//! solver-formulation problem. The answer decides whether Phase 1 needs split
//! impulses.

use orchard_physics_spike::fixed::{from_px, V2};
use orchard_physics_spike::scenario::{measure, Rng, RADII, SCENARIO_SEED};
use orchard_physics_spike::world::{Body, World};

fn d2b(iterations: u32) -> (i64, i64, i64) {
    let mut w = World::crate_walls();
    w.iterations = iterations;
    w.add(Body::circle(
        1,
        0,
        V2::new(from_px(220), from_px(623)),
        from_px(17),
    ));
    w.add(Body::circle(
        2,
        10,
        V2::new(from_px(220), from_px(478)),
        from_px(128),
    ));
    let mut worst = 0i64;
    let mut worst_speed = 0i64;
    for t in 0..1200 {
        w.step();
        let m = measure(&w);
        // Ignore the first 200 ticks: the question is whether it SETTLES, not
        // whether the initial transient is small.
        if t >= 200 {
            worst = worst.max(m.max_penetration_sub);
            worst_speed = worst_speed.max(m.max_speed_px);
        }
    }
    let m = measure(&w);
    (worst, worst_speed, m.max_penetration_sub)
}

fn d1(iterations: u32) -> (i64, i64, u32) {
    let mut w = World::crate_walls();
    w.iterations = iterations;
    let mut rng = Rng::new(SCENARIO_SEED);
    let (mut dropped, mut id, mut quiet) = (0u32, 100u32, 0u32);
    for t in 0..3600u32 {
        if dropped < 30 && t % 32 == 0 {
            let tier = rng.below(5) as usize;
            let span = 440 - 2 * RADII[tier];
            let x = from_px(RADII[tier] + rng.below(span as u64) as i64);
            w.add(Body::circle(
                id,
                tier as u8,
                V2::new(x, from_px(64)),
                from_px(RADII[tier]),
            ));
            id += 1;
            dropped += 1;
        }
        w.step();
        if measure(&w).max_speed_px <= 2 {
            quiet += 1;
        } else {
            quiet = 0;
        }
    }
    let m = measure(&w);
    (m.max_penetration_sub, m.max_speed_px, quiet)
}

fn main() {
    let slop = orchard_physics_spike::world::SLOP;
    println!(
        "slop = {slop} sub-units ({:.3} px)\n",
        slop as f64 / 65536.0
    );

    println!("== D2b: watermelon on cherry, ticks 200..1200 ==");
    println!("  iters   worst_pen  worst_speed  final_pen   settled?");
    for it in [12u32, 20, 32, 48, 64, 96] {
        let (worst, speed, fin) = d2b(it);
        let ok = worst <= slop * 2 && speed <= 2;
        println!(
            "  {it:5}   {worst:9}  {speed:11}  {fin:9}   {}",
            if ok { "yes" } else { "NO" }
        );
    }

    println!("\n== D1: 30-fruit settle ==");
    println!("  iters   final_pen  final_speed  trailing_quiet");
    for it in [12u32, 20, 32, 48, 64] {
        let (pen, speed, quiet) = d1(it);
        println!("  {it:5}   {pen:9}  {speed:11}  {quiet:14}");
    }
}
