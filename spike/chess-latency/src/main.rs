//! Native driver: the deepen verdict (nodes with vs without deepening, per
//! depth) and native per-level wall clocks.

use chess_latency::{pos_count, run_deepened, run_fixed};
use std::time::Instant;

fn pct(sorted: &[u64], p: f64) -> u64 {
    sorted[((sorted.len() as f64 - 1.0) * p).round() as usize]
}

fn main() {
    let n = pos_count();
    println!("machine: native (record the host beside these numbers); positions: {n}");
    println!("\n== the deepen verdict: nodes, deepening 1..=d vs fixed d (unlimited budget) ==");
    println!("depth  deepened-total  fixed-total  ratio");
    for depth in 2..=5 {
        let (mut a, mut b) = (0u64, 0u64);
        for p in 0..n {
            a += run_deepened(p, depth, 0, 0);
            b += run_fixed(p, depth);
        }
        println!("{depth}      {a:>13}  {b:>11}  {:.3}", a as f64 / b as f64);
    }
    println!("\n== native ms per provisional level (deepening, Expert budget 500k) ==");
    println!("level   depth  cap      median  p95  worst");
    for (name, depth, cap) in [
        ("Easy", 2u32, 0u64),
        ("Medium", 3, 0),
        ("Hard", 4, 0),
        ("Expert", 5, 500_000),
    ] {
        let mut ms: Vec<u64> = (0..n)
            .map(|p| {
                let t = Instant::now();
                let _ = run_deepened(p, depth, (cap & 0xFFFF_FFFF) as u32, (cap >> 32) as u32);
                t.elapsed().as_millis() as u64
            })
            .collect();
        ms.sort_unstable();
        println!(
            "{name:<7} {depth}      {cap:<8} {:>5}  {:>4}  {:>5}",
            pct(&ms, 0.5),
            pct(&ms, 0.95),
            ms[ms.len() - 1]
        );
    }
}
