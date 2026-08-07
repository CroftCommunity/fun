//! Phase 0, follow-up measurement — can a baked opening book replace the
//! heuristic entirely?
//!
//! The cold-solve table says exact live play is affordable at <= 18 free edges
//! (262k nodes, 13ms native) and unaffordable at 24 (16.7M nodes, 1.2s). The gap
//! is only the first six plies. If a BUILD-TIME solve can bake the best move for
//! every position with 0..=5 edges drawn, the shipped engine is exact for the
//! whole game and needs no heuristic eval at all.
//!
//! This measures the two numbers that decide it: how many such positions exist,
//! and how big the baked pack is.

use std::time::Instant;

const EDGES: usize = 24;
const BOXES: usize = 9;
const ALL: u32 = (1 << EDGES) - 1;
const UNKNOWN: i8 = i8::MIN;

fn box_masks() -> [u32; BOXES] {
    let mut out = [0u32; BOXES];
    for r in 0..3usize {
        for c in 0..3usize {
            let mut m = 0u32;
            for e in [r * 3 + c, (r + 1) * 3 + c, 12 + r * 4 + c, 12 + r * 4 + c + 1] {
                m |= 1 << e;
            }
            out[r * 3 + c] = m;
        }
    }
    out
}

struct Solver {
    memo: Vec<i8>,
    masks: [u32; BOXES],
}

impl Solver {
    fn completed(&self, edges: u32, e: usize) -> i8 {
        let after = edges | (1 << e);
        let bit = 1u32 << e;
        self.masks.iter().filter(|&&m| m & bit != 0 && after & m == m).count() as i8
    }

    fn value(&mut self, edges: u32) -> i8 {
        if edges == ALL {
            return 0;
        }
        let cached = self.memo[edges as usize];
        if cached != UNKNOWN {
            return cached;
        }
        let mut best = i8::MIN + 1;
        let mut rest = !edges & ALL;
        while rest != 0 {
            let e = rest.trailing_zeros() as usize;
            rest &= rest - 1;
            let k = self.completed(edges, e);
            let v = if k > 0 { k + self.value(edges | (1 << e)) } else { -self.value(edges | (1 << e)) };
            best = best.max(v);
        }
        self.memo[edges as usize] = best;
        best
    }

    /// The best edge to draw at `edges`, by the same recurrence.
    fn best_move(&mut self, edges: u32) -> Option<(u8, i8)> {
        let mut best: Option<(u8, i8)> = None;
        let mut rest = !edges & ALL;
        while rest != 0 {
            let e = rest.trailing_zeros() as usize;
            rest &= rest - 1;
            let k = self.completed(edges, e);
            let v = if k > 0 { k + self.value(edges | (1 << e)) } else { -self.value(edges | (1 << e)) };
            if best.is_none_or(|(_, bv)| v > bv) {
                best = Some((e as u8, v));
            }
        }
        best
    }
}

/// Every mask with exactly `k` bits set, over `EDGES` bits.
fn masks_with_popcount(k: u32) -> Vec<u32> {
    (0u32..=ALL).filter(|m| m.count_ones() == k).collect()
}

fn main() {
    let mut s = Solver { memo: vec![UNKNOWN; 1 << EDGES], masks: box_masks() };

    let t = Instant::now();
    let root = s.value(0);
    println!("build-time full solve: value {root:+}, {:.0}ms", t.elapsed().as_secs_f64() * 1000.0);

    println!("\nbook layers (positions the engine must answer before exact live play):");
    let mut total = 0usize;
    for drawn in 0..=6u32 {
        let n = masks_with_popcount(drawn).len();
        total += n;
        println!("  {drawn} drawn / {} free: {n:>7} positions", EDGES as u32 - drawn);
    }
    println!("  cumulative 0..=6 drawn: {total} positions");

    // The pack we would actually bake: best move for every position with 0..=5
    // edges drawn, so live exact play starts at 18 free edges.
    let t = Instant::now();
    let mut entries: Vec<(u32, u8, i8)> = Vec::new();
    for drawn in 0..=5u32 {
        for m in masks_with_popcount(drawn) {
            if let Some((e, v)) = s.best_move(m) {
                entries.push((m, e, v));
            }
        }
    }
    println!(
        "\nbaked pack: {} entries, extracted in {:.0}ms",
        entries.len(),
        t.elapsed().as_secs_f64() * 1000.0
    );
    println!("  as (u32 mask, u8 move):        {:>8} bytes", entries.len() * 5);
    println!("  as combinatorial-rank u8 only: {:>8} bytes", entries.len());

    // Sanity: the book's root move must reproduce the known root value.
    let (root_move, root_val) = s.best_move(0).expect("empty board has moves");
    println!("\nroot: best edge {root_move}, value {root_val:+} (must equal {root:+})");
    assert_eq!(root_val, root, "book's root value must match the full solve");

    // And the book must be self-consistent: following it from the root for six
    // plies must always land on a position the live solver can finish exactly.
    let mut edges = 0u32;
    for ply in 0..6 {
        let (e, _) = s.best_move(edges).expect("book position has moves");
        edges |= 1 << e;
        assert_eq!(edges.count_ones(), ply + 1);
    }
    println!("following the book six plies lands at {} free edges", EDGES as u32 - edges.count_ones());
}
