//! D1/D2/D4 measurement run. Prints; asserts nothing. The tests pin what this
//! finds, in that order — a spike measures first and encodes the result second,
//! because there is no prior expectation to go RED against.

use std::time::Instant;

use orchard_physics_spike::fixed::{div, from_px, from_ratio, mul, sqrt_raw, ONE};
use orchard_physics_spike::scenario::{
    digest, measure, run, Rng, DROP_INTERVAL, FRUIT_COUNT, QUIET_WINDOW, RADII, SCENARIO_SEED,
    TOTAL_TICKS,
};
use orchard_physics_spike::world::{Body, World, DENSITY, ITERATIONS, TICK_HZ};
use orchard_physics_spike::{fixed::V2, world::GRAVITY};

fn main() {
    println!("== configuration ==");
    println!(
        "  tick rate {TICK_HZ} Hz, {ITERATIONS} solver iterations, gravity {} px/s^2",
        GRAVITY >> 16
    );
    println!("  {FRUIT_COUNT} fruit, one every {DROP_INTERVAL} ticks, {TOTAL_TICKS} ticks total");

    // ---- D1: does the pile settle and stay settled? ----
    println!("\n== D1: settle ==");
    let mut world = World::crate_walls();
    let mut rng = Rng::new(SCENARIO_SEED);
    let mut dropped = 0u32;
    let mut next_id = 100u32;
    let mut quiet_run = 0u32;
    let mut best_quiet_run = 0u32;
    let mut samples = Vec::new();

    for t in 0..TOTAL_TICKS {
        if dropped < FRUIT_COUNT && t % DROP_INTERVAL == 0 {
            let tier = rng.below(5) as usize;
            let r = from_px(RADII[tier]);
            let span = 440 - 2 * RADII[tier];
            let x = from_px(RADII[tier] + rng.below(span as u64) as i64);
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

        let m = measure(&world);
        // "Quiet" = nothing moving faster than 2 px/s anywhere.
        if m.max_speed_px <= 2 {
            quiet_run += 1;
            best_quiet_run = best_quiet_run.max(quiet_run);
        } else {
            quiet_run = 0;
        }
        if t % 400 == 0 || t == TOTAL_TICKS - 1 {
            samples.push((t, m));
        }
    }

    println!("  tick   bodies  max_speed  total_speed  pen(permille)  escaped  pile_h");
    for (t, m) in &samples {
        println!(
            "  {:5}  {:6}  {:9}  {:11}  {:13}  {:7}  {:6}",
            t,
            world.bodies.len(),
            m.max_speed_px,
            m.total_speed_px,
            m.max_penetration_permille,
            m.escaped,
            m.pile_height_px
        );
    }
    let fin = measure(&world);
    println!("\n  final: {fin:?}");
    println!(
        "  final penetration: {} sub-units = {:.3} px, against a slop of {:.3} px",
        fin.max_penetration_sub,
        fin.max_penetration_sub as f64 / 65536.0,
        orchard_physics_spike::world::SLOP as f64 / 65536.0
    );
    println!("  longest quiet run: {best_quiet_run} ticks (need {QUIET_WINDOW})");
    println!("  trailing quiet run: {quiet_run} ticks");

    // ---- D2: precision ----
    println!("\n== D2: precision ==");
    let cherry = Body::circle(1, 0, V2::default(), from_px(17));
    let melon = Body::circle(2, 10, V2::default(), from_px(128));
    println!(
        "  cherry     inv_mass {:>8} ({:.4})  ang_response {:>8}",
        cherry.inv_mass,
        cherry.inv_mass as f64 / ONE as f64,
        cherry.ang_response
    );
    println!(
        "  watermelon inv_mass {:>8} ({:.4})  ang_response {:>8}",
        melon.inv_mass,
        melon.inv_mass as f64 / ONE as f64,
        melon.ang_response
    );
    println!(
        "  mass ratio {:.1}:1",
        (ONE as f64 / melon.inv_mass as f64).recip().recip()
            / (ONE as f64 / cherry.inv_mass as f64)
    );
    // What inv_inertia WOULD have been, had the disc identity not removed it.
    let melon_mass = div(ONE, melon.inv_mass);
    let inertia = mul(mul(melon_mass, from_px(128)), from_px(128)) / 2;
    println!(
        "  watermelon inertia {inertia}, inv_inertia at shift-16 = {} <-- the underflow avoided",
        div(ONE, inertia)
    );

    // sqrt error sweep
    let mut worst_sqrt_err = 0i64;
    for px in 1..=900i64 {
        let v = from_px(px);
        let got = sqrt_raw(v * v);
        worst_sqrt_err = worst_sqrt_err.max((got - v).abs());
    }
    println!("  sqrt_raw round-trip error over 1..900 px: {worst_sqrt_err} sub-units (max)");

    // impulse divide at the mass extreme
    let k_n = cherry.inv_mass + melon.inv_mass;
    let target = from_px(100);
    let dpn = div(target, k_n);
    let back = mul(dpn, k_n);
    println!(
        "  impulse divide at 56.7:1 -> recovers {} of {} ({} sub-units lost)",
        back,
        target,
        target - back
    );

    // ---- D2b: the mass-ratio extreme ----
    // NOT "a cherry pinned between two watermelons" as the plan proposed: two
    // watermelons do not fit side by side in a 440px crate (2*256 > 440), so
    // that scenario cannot occur in this game. The real extreme available here
    // is a watermelon resting ON a cherry against the floor — a 56.7:1 mass
    // ratio through a single contact, which is where the impulse divide is
    // worst-conditioned.
    println!("\n== D2b: watermelon resting on a cherry (56.7:1 through one contact) ==");
    let mut pinned = World::crate_walls();
    pinned.add(Body::circle(
        1,
        0,
        V2::new(from_px(220), from_px(640 - 17)),
        from_px(17),
    ));
    pinned.add(Body::circle(
        2,
        10,
        V2::new(from_px(220), from_px(640 - 34 - 128)),
        from_px(128),
    ));
    let start = (pinned.bodies[0].pos, pinned.bodies[1].pos);
    let mut worst_pen = 0i64;
    println!("  tick   cherry_y   melon_y  max_speed  pen_sub");
    for t in 0..1200 {
        pinned.step();
        let m = measure(&pinned);
        worst_pen = worst_pen.max(m.max_penetration_permille);
        if t < 5 || t % 200 == 0 || t == 1199 {
            println!(
                "  {:5}  {:9}  {:8}  {:9}  {:7}",
                t,
                pinned.bodies[0].pos.y >> 16,
                pinned.bodies[1].pos.y >> 16,
                m.max_speed_px,
                m.max_penetration_sub
            );
        }
    }
    println!(
        "  cherry     drift ({}, {}) sub-units",
        pinned.bodies[0].pos.x - start.0.x,
        pinned.bodies[0].pos.y - start.0.y
    );
    println!(
        "  watermelon drift ({}, {}) sub-units",
        pinned.bodies[1].pos.x - start.1.x,
        pinned.bodies[1].pos.y - start.1.y
    );
    println!("  worst penetration over 1200 ticks: {worst_pen} permille");
    println!("  {:?}", measure(&pinned));

    // ---- D4: replay cost ----
    println!("\n== D4: replay cost ==");
    for ticks in [TOTAL_TICKS, 18_000] {
        let t0 = Instant::now();
        let w = run(ticks, 0, false);
        let dt = t0.elapsed();
        println!(
            "  {ticks:6} ticks, {} bodies: {:?}  (digest {:#018x})",
            w.bodies.len(),
            dt,
            digest(&w)
        );
    }

    // ---- D3 native half ----
    println!("\n== D3: native digests ==");
    println!("  scenario   {:#018x}", digest(&run(TOTAL_TICKS, 0, false)));
    println!("  perturbed  {:#018x}", digest(&run(TOTAL_TICKS, 1, false)));
    println!("  reversed   {:#018x}", digest(&run(TOTAL_TICKS, 0, true)));

    let _ = from_ratio(1, 2);
    let _ = DENSITY;
}
