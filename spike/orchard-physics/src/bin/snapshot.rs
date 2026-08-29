//! D5 support: render the scenario at a few ticks as SVG, so the feel judgement
//! is made against something rather than described. D5 is a judgement gate and
//! needs a person; this only makes the comparison possible.
//!
//! Usage: `cargo run --release --bin snapshot > pile.svg`
//!
//! **The art is ported, not invented.** Every shape below comes from the
//! vendored game's `drawFruit` (`src/games/orchard-drop/vendor/index.html`,
//! § *draw a fruit*): a radial-gradient body, a per-`kind` texture, a clipped
//! shine, a stem and leaf (a crown for the pineapple), and the kawaii face.
//! Drawing the same fruit the wrap draws is the whole point — a comparison
//! against different art would be measuring the art.
//!
//! **Positions and rotations are solver output; only the drawing is float.**
//! The `f64` in here is presentational and never touches a hashed value. The
//! fruit's whole group is rotated by the body's real `ang`, so the face and stem
//! turn as it rolls — which is precisely what D5 is asking you to look at.

use orchard_physics_spike::fixed::{from_px, V2};
use orchard_physics_spike::scenario::{measure, Rng, RADII, SCENARIO_SEED};
use orchard_physics_spike::world::{Body, World};

/// `(name, c1, c2, kind)` per ladder tier — the vendored game's `FRUITS` table.
const FRUITS: [(&str, &str, &str, &str); 11] = [
    ("cherry", "#F26D6D", "#D8403F", "cherry"),
    ("strawberry", "#F2708B", "#DB4463", "strawberry"),
    ("grape", "#B07DE0", "#8B54C9", "plain"),
    ("dekopon", "#FFC24D", "#F09E23", "citrus"),
    ("persimmon", "#FA9A4B", "#E8792A", "citrus"),
    ("apple", "#F26060", "#D63C3C", "plain"),
    ("pear", "#CFE06A", "#A9C244", "plain"),
    ("peach", "#FFC3CF", "#F79BB0", "plain"),
    ("pineapple", "#FBD75B", "#E9B92E", "pineapple"),
    ("melon", "#BEE07A", "#98C24E", "melon"),
    ("watermelon", "#5CA84E", "#3E8948", "watermelon"),
];

/// The radial-gradient defs, one per tier. The canvas original seeds the
/// gradient at `(-0.3r, -0.35r)`, which in object-bounding-box units is a focal
/// point at `(0.35, 0.325)`.
fn defs() -> String {
    let mut s = String::from("<defs>\n");
    for (i, (_, c1, c2, _)) in FRUITS.iter().enumerate() {
        s.push_str(&format!(
            r##"<radialGradient id="f{i}" cx="0.5" cy="0.5" r="0.55" fx="0.35" fy="0.325">
<stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></radialGradient>
"##
        ));
    }
    s.push_str("</defs>\n");
    s
}

/// One fruit, drawn centred on the origin. The caller supplies the translate and
/// rotate, so every element here turns with the body.
#[allow(clippy::too_many_lines)]
fn fruit(tier: usize, r: f64) -> String {
    let (_, _, _, kind) = FRUITS[tier];
    let mut s = String::new();
    let lw = (r * 0.06).max(1.5);

    // ── body ────────────────────────────────────────────────────────────────
    s.push_str(&format!(r##"<circle r="{r:.1}" fill="url(#f{tier})"/>"##));

    // ── per-kind texture ────────────────────────────────────────────────────
    match kind {
        "watermelon" => {
            for i in -2..=2 {
                let x = f64::from(i) * r * 0.38;
                let h = (r * r - x * x).max(0.0).sqrt();
                s.push_str(&format!(
                    r##"<path d="M{x:.1} {:.1} Q{:.1} 0 {x:.1} {h:.1}" fill="none" stroke="rgba(30,80,40,.55)" stroke-width="{lw:.1}"/>"##,
                    -h,
                    f64::from(i) * r * 0.55
                ));
            }
        }
        "melon" => {
            s.push_str(&format!(
                r##"<path d="M{:.1} {:.1} Q0 0 {:.1} {:.1}" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="{lw:.1}"/>"##,
                -r * 0.7, -r * 0.5, -r * 0.5, r * 0.7
            ));
            s.push_str(&format!(
                r##"<path d="M{:.1} {:.1} Q0 0 {:.1} {:.1}" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="{lw:.1}"/>"##,
                r * 0.5, -r * 0.7, r * 0.7, r * 0.5
            ));
        }
        "pineapple" => {
            for i in -2..=2 {
                let y = f64::from(i) * r * 0.4;
                s.push_str(&format!(
                    r##"<path d="M{:.1} {:.1} L{r:.1} {:.1}" stroke="rgba(160,110,20,.35)" stroke-width="{lw:.1}"/>"##,
                    -r, y - r * 0.2, y + r * 0.6
                ));
                s.push_str(&format!(
                    r##"<path d="M{:.1} {:.1} L{r:.1} {:.1}" stroke="rgba(160,110,20,.35)" stroke-width="{lw:.1}"/>"##,
                    -r, y + r * 0.6, y - r * 0.2
                ));
            }
        }
        "strawberry" => {
            for i in 0..7 {
                let a = f64::from(i) / 7.0 * std::f64::consts::TAU + 0.4;
                let (cx, cy) = (a.cos() * r * 0.55, a.sin() * r * 0.55);
                s.push_str(&format!(
                    r##"<ellipse cx="{cx:.1}" cy="{cy:.1}" rx="{:.1}" ry="{:.1}" fill="rgba(255,240,180,.8)" transform="rotate({:.1} {cx:.1} {cy:.1})"/>"##,
                    r * 0.06,
                    r * 0.09,
                    a.to_degrees()
                ));
            }
        }
        _ => {}
    }

    // ── shine ───────────────────────────────────────────────────────────────
    s.push_str(&format!(
        r##"<ellipse cx="{:.1}" cy="{:.1}" rx="{:.1}" ry="{:.1}" fill="rgba(255,255,255,.35)" transform="rotate(-34.4 {:.1} {:.1})"/>"##,
        -r * 0.38,
        -r * 0.42,
        r * 0.22,
        r * 0.13,
        -r * 0.38,
        -r * 0.42
    ));

    // ── stem + leaf, or the pineapple's crown ───────────────────────────────
    if kind == "pineapple" {
        for i in -1..=1 {
            let f = f64::from(i);
            s.push_str(&format!(
                r##"<path d="M{:.1} {:.1} Q{:.1} {:.1} {:.1} {:.1} Q{:.1} {:.1} {:.1} {:.1}" fill="#5F9E4A"/>"##,
                f * r * 0.18, -r * 0.85,
                f * r * 0.5,  -r * 1.35,
                f * r * 0.12, -r * 1.3,
                f * r * 0.05, -r * 1.0,
                f * r * 0.18, -r * 0.85
            ));
        }
    } else {
        s.push_str(&format!(
            r##"<path d="M0 {:.1} Q{:.1} {:.1} {:.1} {:.1}" fill="none" stroke="#6B4226" stroke-width="{:.1}" stroke-linecap="round"/>"##,
            -r * 0.92,
            r * 0.08, -r * 1.12,
            r * 0.16, -r * 1.18,
            (r * 0.07).max(2.0)
        ));
        s.push_str(&format!(
            r##"<ellipse cx="{:.1}" cy="{:.1}" rx="{:.1}" ry="{:.1}" fill="#6FA84F" transform="rotate(28.6 {:.1} {:.1})"/>"##,
            r * 0.3, -r * 1.08, r * 0.2, r * 0.1, r * 0.3, -r * 1.08
        ));
    }

    // ── the face. This is what turns an orb into a fruit, and because it
    //    rotates with the body it is also how rolling becomes visible. ───────
    let er = (r * 0.075).max(1.8);
    for sx in [-1.0_f64, 1.0] {
        s.push_str(&format!(
            r##"<circle cx="{:.1}" cy="{:.1}" r="{er:.1}" fill="#3A2430"/>"##,
            sx * r * 0.28,
            -r * 0.05
        ));
        s.push_str(&format!(
            r##"<circle cx="{:.1}" cy="{:.1}" r="{:.1}" fill="#fff"/>"##,
            sx * r * 0.28 - er * 0.3,
            -r * 0.05 - er * 0.3,
            er * 0.35
        ));
        s.push_str(&format!(
            r##"<circle cx="{:.1}" cy="{:.1}" r="{:.1}" fill="rgba(255,120,120,.45)"/>"##,
            sx * r * 0.5,
            r * 0.12,
            r * 0.11
        ));
    }
    // Smile: the canvas arc from .15pi to .85pi about (0, .12r), bowing downward.
    let (rr, cy) = (r * 0.16, r * 0.12);
    let (sx, sy) = (
        rr * (0.15 * std::f64::consts::PI).cos(),
        cy + rr * (0.15 * std::f64::consts::PI).sin(),
    );
    s.push_str(&format!(
        r##"<path d="M{sx:.1} {sy:.1} A{rr:.1} {rr:.1} 0 0 1 {:.1} {sy:.1}" fill="none" stroke="#3A2430" stroke-width="{:.1}" stroke-linecap="round"/>"##,
        -sx,
        (r * 0.05).max(1.5)
    ));
    s
}

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
    print!("{}", defs());
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
            // Painter's order: bottom of the crate first, so a fruit's stem and
            // crown sit behind whatever rests on top of it rather than in front.
            let mut order: Vec<&Body> = world.bodies.iter().collect();
            order.sort_by_key(|b| -b.pos.y);
            for b in order {
                let (cx, cy) = (b.pos.x as f64 / 65536.0, b.pos.y as f64 / 65536.0);
                let r = b.radius as f64 / 65536.0;
                let deg = (b.ang as f64 / 65536.0).to_degrees();
                println!(
                    r##"<g transform="translate({cx:.1} {cy:.1}) rotate({deg:.1})">{}</g>"##,
                    fruit(b.tier as usize, r)
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
