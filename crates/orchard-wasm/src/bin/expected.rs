//! Prints the native hashes `check.mjs` compares the wasm build against.
//! Separate binary so the cross-check consumes a machine-readable artifact
//! rather than parsing a human report.

use orchard_core::game::{Game, Move, COOLDOWN_TICKS};

fn main() {
    // A seed with BOTH halves set: a truncation at the u32 boundary would be
    // invisible with a small seed, and that boundary is where wasm's 32-bit
    // usize meets native's 64-bit one.
    let seed: u64 = 0xDEAD_BEEF_1234_5678;
    let mut g = Game::new(seed);
    let mut ticks = Vec::new();
    let mut t = 0;
    for i in 0..8 {
        let _ = g.apply(Move::Drop {
            tick: t,
            x: 60 + 45 * i,
        });
        t += COOLDOWN_TICKS;
        ticks.push((t, g.state_hash()));
    }
    let _ = g.apply(Move::Wait { tick: t + 600 });

    println!("{{");
    println!("  \"seed_lo\": {},", seed & 0xFFFF_FFFF);
    println!("  \"seed_hi\": {},", seed >> 32);
    println!("  \"final_hash\": \"{}\",", g.state_hash());
    println!("  \"score\": {},", g.score());
    println!("  \"tick\": {},", g.tick());
    println!("  \"fruit\": {},", g.fruit_count());
    // The fruit view as the binding will convert it: whole px, milliradians.
    // Compared exactly by the vitest, because a RANGE check cannot see a
    // conversion that is wrong by a factor — mutation testing walked straight
    // through "is an integer" and "is plausibly small".
    let fruit: Vec<String> = g
        .fruit_view()
        .into_iter()
        .map(|f| {
            format!(
                "    {{ \"id\": {}, \"tier\": {}, \"x\": {}, \"y\": {}, \"r\": {}, \"ang\": {} }}",
                f.id,
                f.tier,
                f.x >> 16,
                f.y >> 16,
                f.r >> 16,
                (f.ang * 1000) >> 16
            )
        })
        .collect();
    println!("  \"fruit_view\": [\n{}\n  ],", fruit.join(",\n"));

    let cp: Vec<String> = ticks
        .iter()
        .map(|(t, h)| format!("    {{ \"tick\": {t}, \"hash\": \"{h}\" }}"))
        .collect();
    println!("  \"checkpoints\": [\n{}\n  ]", cp.join(",\n"));
    println!("}}");
}
