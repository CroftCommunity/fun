//! The Phase 0 findings, pinned so a later change to the solver has to
//! acknowledge them. These were written *after* the measurements, not before —
//! a spike has no prior expectation to go RED against, and pretending otherwise
//! would be inventing a red phase rather than observing one. Every number here
//! was read off `src/bin/measure.rs` or `src/bin/sweep.rs` first.

use orchard_physics_spike::fixed::{div, from_px, mul, sqrt_raw, ONE, V2};
use orchard_physics_spike::scenario::{
    digest, measure, run, Rng, RADII, SCENARIO_SEED, TOTAL_TICKS,
};
use orchard_physics_spike::world::{Body, World, ITERATIONS, SLOP};

/// Build the D1 scenario and return the world plus its longest trailing quiet run.
fn settle_run(iterations: u32) -> (World, u32) {
    let mut w = World::crate_walls();
    w.iterations = iterations;
    let mut rng = Rng::new(SCENARIO_SEED);
    let (mut dropped, mut id, mut quiet) = (0u32, 100u32, 0u32);
    for t in 0..TOTAL_TICKS {
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
    (w, quiet)
}

// ── D1 ──────────────────────────────────────────────────────────────────────

#[test]
fn d1_a_thirty_fruit_pile_settles_and_stays_settled() {
    let (world, quiet) = settle_run(ITERATIONS);
    let m = measure(&world);
    assert_eq!(world.bodies.len(), 30, "all fruit still present");
    assert_eq!(m.escaped, 0, "nothing left the crate");
    assert_eq!(m.max_speed_px, 0, "the pile is at rest");
    assert!(
        quiet >= 600,
        "quiet run {quiet} ticks, need 600 (measured 2534)"
    );
    assert!(
        m.pile_height_px > 300,
        "pile is {}px — a pile that never formed would settle stably and mean nothing",
        m.pile_height_px
    );
}

#[test]
fn d1_penetration_rests_at_the_slop_not_below_one_percent_of_radius() {
    // The plan's original bar — "no circle penetrates another by more than 1% of
    // its radius" — is unsatisfiable by construction: the solver's slop is an
    // ABSOLUTE distance, and 1% of a cherry (0.17px) is below it while 1% of a
    // watermelon (1.28px) is above it. One slop cannot be under both. The honest
    // bar is "penetration converges to the slop", which is what resting contact
    // means in every Baumgarte solver.
    let (world, _) = settle_run(ITERATIONS);
    let m = measure(&world);
    assert!(
        m.max_penetration_sub <= SLOP + SLOP / 16,
        "penetration {} sub-units exceeds slop {SLOP} (measured 32774 against 32768)",
        m.max_penetration_sub
    );
    // ... and it is genuinely 2.9% of a cherry's radius, which is why the
    // percentage bar would have failed a solver that is behaving correctly.
    assert!(m.max_penetration_permille > 10);
}

// ── D2 ──────────────────────────────────────────────────────────────────────

#[test]
fn d2_integer_sqrt_is_exact_for_every_whole_pixel_in_range() {
    for px in 1..=900i64 {
        let v = from_px(px);
        assert_eq!(sqrt_raw(v * v), v, "sqrt_raw round-trip failed at {px}px");
    }
}

#[test]
fn d2_the_impulse_divide_holds_at_the_mass_extreme() {
    let cherry = Body::circle(1, 0, V2::default(), from_px(17));
    let melon = Body::circle(2, 10, V2::default(), from_px(128));
    let k_n = cherry.inv_mass + melon.inv_mass;
    let target = from_px(100);
    let lost = target - mul(div(target, k_n), k_n);
    assert!(
        lost.abs() <= 4,
        "impulse divide lost {lost} sub-units of {target} at the 56.7:1 ratio"
    );
}

#[test]
fn d2_inv_inertia_would_underflow_which_is_why_the_disc_identity_matters() {
    // Not a behaviour test — a standing record of why `world.rs` stores no
    // inertia term. If someone later "tidies up" by adding one back at shift-16,
    // this is the failure they will get.
    let melon = Body::circle(2, 10, V2::default(), from_px(128));
    let mass = div(ONE, melon.inv_mass);
    let inertia = mul(mul(mass, from_px(128)), from_px(128)) / 2;
    assert_eq!(
        div(ONE, inertia),
        0,
        "a watermelon's inv_inertia is representable at shift-16 after all — \
         re-check whether the disc identity is still load-bearing"
    );
}

#[test]
fn d2b_the_mass_ratio_extreme_converges_at_the_chosen_iteration_count() {
    // A watermelon resting on a cherry: 56.7:1 through one contact. NOT the
    // plan's "cherry pinned between two watermelons" — two watermelons do not
    // fit side by side in a 440px crate (2 * 256 > 440), so that case cannot
    // occur in this game.
    let mut w = World::crate_walls();
    w.iterations = ITERATIONS;
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
    let (mut worst_pen, mut worst_speed) = (0i64, 0i64);
    for t in 0..1200 {
        w.step();
        if t >= 200 {
            let m = measure(&w);
            worst_pen = worst_pen.max(m.max_penetration_sub);
            worst_speed = worst_speed.max(m.max_speed_px);
        }
    }
    assert!(
        worst_speed <= 2,
        "still moving at {worst_speed} px/s after 200 ticks — it is limit-cycling"
    );
    assert!(
        worst_pen <= SLOP * 2,
        "penetration reached {worst_pen} sub-units, over twice the slop"
    );
}

#[test]
fn d2b_twelve_iterations_is_not_enough_which_is_what_set_the_constant() {
    // The measurement that chose ITERATIONS. If a future change makes 12 work,
    // this test fails and the constant should be revisited downward.
    let mut w = World::crate_walls();
    w.iterations = 12;
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
    let mut worst_speed = 0i64;
    for t in 0..1200 {
        w.step();
        if t >= 200 {
            worst_speed = worst_speed.max(measure(&w).max_speed_px);
        }
    }
    assert!(
        worst_speed > 2,
        "12 iterations now converges (worst speed {worst_speed}); ITERATIONS = {ITERATIONS} \
         may be higher than it needs to be"
    );
}

// ── D3 (native half; the cross-target half is verify.mjs) ───────────────────

#[test]
fn d3_the_scenario_hashes_identically_across_runs_in_one_process() {
    // Rules out the boring failure — global state or unstable iteration order
    // masquerading as a platform result.
    let a = digest(&run(TOTAL_TICKS, 0, false));
    let b = digest(&run(TOTAL_TICKS, 0, false));
    assert_eq!(a, b);
}

#[test]
fn d3_one_sub_unit_of_spawn_x_changes_the_digest() {
    // The believability guard the rapier spike used: a digest that cannot detect
    // the smallest representable change is not measuring the simulation.
    assert_ne!(
        digest(&run(TOTAL_TICKS, 0, false)),
        digest(&run(TOTAL_TICKS, 1, false))
    );
}

#[test]
fn d3_the_scenario_actually_does_work() {
    // A pile that never moved would hash stably and prove nothing.
    let w = run(TOTAL_TICKS, 0, false);
    let m = measure(&w);
    assert_eq!(w.bodies.len(), 30);
    assert!(m.pile_height_px > 300, "the pile formed");
    assert!(
        w.bodies.iter().any(|b| b.pos.y > from_px(500)),
        "fruit reached the bottom of the crate"
    );
}

// ── D6 ──────────────────────────────────────────────────────────────────────

#[test]
fn d6_breaking_contact_order_diverges_and_the_first_bad_tick_is_findable() {
    assert_ne!(
        digest(&run(TOTAL_TICKS, 0, false)),
        digest(&run(TOTAL_TICKS, 0, true)),
        "reversing contact order must change the result, or the sort is not load-bearing"
    );
    // Bisect, exactly as verify.mjs does across targets.
    let (mut lo, mut hi) = (0u32, TOTAL_TICKS);
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        if digest(&run(mid, 0, false)) == digest(&run(mid, 0, true)) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    assert_eq!(hi, 140, "first divergent tick moved; re-check the scenario");
}
