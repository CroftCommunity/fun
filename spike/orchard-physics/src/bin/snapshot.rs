//! D5 support: render the scenario at a few ticks as SVG, so the feel judgement
//! is made against something rather than described. D5 is a judgement gate and
//! needs a person; this only makes the comparison possible.
//!
//! Usage: `cargo run --release --bin snapshot > pile.svg`

use orchard_physics_spike::fixed::{from_px, V2};
use orchard_physics_spike::scenario::{measure, Rng, RADII, SCENARIO_SEED};
use orchard_physics_spike::world::{Body, World};

/// The vendored game's palette (`FRUITS[].c1`), so the shapes read as the fruit
/// they are rather than as circles.
const COLORS: [&str; 11] = [
    "#F26D6D", "#F2708B", "#B07DE0", "#FFC24D", "#FA9A4B", "#F26060", "#CFE06A", "#FFC3CF",
    "#FBD75B", "#BEE07A", "#5CA84E",
];

fn main() {
    let frames = [200u32, 500, 900, 1400, 2000, 3600];
    let (w, h) = (440i64, 640i64);
    let cols = frames.len() as i64;
    println!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{}" height="{}" viewBox="0 0 {} {}">"##,
        cols * (w + 20),
        h + 40,
        cols * (w + 20),
        h + 40
    );
    println!(r##"<rect width="100%" height="100%" fill="#2b2b2b"/>"##);

    let mut world = World::crate_walls();
    let mut rng = Rng::new(SCENARIO_SEED);
    let (mut dropped, mut id) = (0u32, 100u32);
    let mut frame = 0i64;

    for t in 0..=*frames.last().unwrap() {
        if dropped < 30 && t % 32 == 0 {
            let tier = rng.below(5) as usize;
            let span = 440 - 2 * RADII[tier];
            let x = from_px(RADII[tier] + rng.below(span as u64) as i64);
            world.add(Body::circle(
                id,
                tier as u8,
                V2::new(x, from_px(64)),
                from_px(RADII[tier]),
            ));
            id += 1;
            dropped += 1;
        }
        world.step();

        if frames.contains(&t) {
            let ox = frame * (w + 20);
            println!(r##"<g transform="translate({ox},20)">"##);
            println!(r##"<rect width="{w}" height="{h}" fill="#FBEED2"/>"##);
            println!(
                r##"<line x1="0" y1="112" x2="{w}" y2="112" stroke="#D8403F" stroke-dasharray="6 6"/>"##
            );
            for b in &world.bodies {
                let (cx, cy, r) = (b.pos.x >> 16, b.pos.y >> 16, b.radius >> 16);
                // A radius line, so rotation is visible — the thing D5 is asking about.
                println!(
                    r##"<circle cx="{cx}" cy="{cy}" r="{r}" fill="{}" stroke="#00000033"/>"##,
                    COLORS[b.tier as usize]
                );
                let a = b.ang as f64 / 65536.0;
                println!(
                    r##"<line x1="{cx}" y1="{cy}" x2="{:.1}" y2="{:.1}" stroke="#00000066"/>"##,
                    cx as f64 + a.cos() * r as f64,
                    cy as f64 + a.sin() * r as f64
                );
            }
            let m = measure(&world);
            println!(
                r##"<text x="6" y="{}" font-family="monospace" font-size="13" fill="#5a4632">tick {t} · {} fruit · max {} px/s</text>"##,
                h - 8,
                world.bodies.len(),
                m.max_speed_px
            );
            println!("</g>");
            frame += 1;
        }
    }
    println!("</svg>");
}
