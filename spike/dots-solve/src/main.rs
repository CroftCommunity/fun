//! Phase 0 discovery spike — what does an exact Dots and Boxes solve cost?
//!
//! Board: 3x3 boxes = 4x4 dots = 24 edges = 9 boxes.
//!
//! Edge indexing (the numbering the real core will adopt if this works):
//!   horizontal H(r,c) = r*3 + c        for r in 0..=3, c in 0..3   -> 0..11
//!   vertical   V(r,c) = 12 + r*4 + c   for r in 0..3,  c in 0..=3  -> 12..23
//! Box (r,c) closes on H(r,c), H(r+1,c), V(r,c), V(r,c+1).
//!
//! The value recurrence, and the reason the memo key is the edge mask ALONE:
//! who owns the already-completed boxes cannot affect future play, only the
//! running score. So `value(edges)` = the best future box margin for the side to
//! move, and the table is a flat Vec<i8> of 2^24 entries (16.7 MB), not a map.
//!
//! Measures, and prints, for a fresh (cold) table:
//!   - the full solve from the empty board: value, nodes, wall time
//!   - the worst cold solve over sampled positions at each free-edge count
//! so `TRACTABLE_EDGES` gets picked from a knee rather than from a guess.

use std::time::Instant;

const EDGES: usize = 24;
const BOXES: usize = 9;
const ALL: u32 = (1 << EDGES) - 1;
const UNKNOWN: i8 = i8::MIN;

/// The four edge indices that close each box, box-major (r*3 + c).
fn box_edges() -> [[u8; 4]; BOXES] {
    let mut out = [[0u8; 4]; BOXES];
    for r in 0..3usize {
        for c in 0..3usize {
            let h_top = (r * 3 + c) as u8;
            let h_bot = ((r + 1) * 3 + c) as u8;
            let v_left = (12 + r * 4 + c) as u8;
            let v_right = (12 + r * 4 + c + 1) as u8;
            out[r * 3 + c] = [h_top, h_bot, v_left, v_right];
        }
    }
    out
}

/// For each edge, the boxes it borders (1 or 2 of them).
fn edge_boxes() -> Vec<Vec<u8>> {
    let be = box_edges();
    let mut out = vec![Vec::new(); EDGES];
    for (b, edges) in be.iter().enumerate() {
        for &e in edges {
            out[e as usize].push(b as u8);
        }
    }
    out
}

struct Solver {
    memo: Vec<i8>,
    box_masks: [u32; BOXES],
    /// Boxes bordering each edge, flattened as (start, len) into `nbr`.
    nbr: Vec<u8>,
    nbr_span: [(u8, u8); EDGES],
    nodes: u64,
}

impl Solver {
    fn new() -> Self {
        let be = box_edges();
        let mut box_masks = [0u32; BOXES];
        for (b, edges) in be.iter().enumerate() {
            let mut m = 0u32;
            for &e in edges {
                m |= 1 << e;
            }
            box_masks[b] = m;
        }
        let eb = edge_boxes();
        let mut nbr = Vec::new();
        let mut nbr_span = [(0u8, 0u8); EDGES];
        for e in 0..EDGES {
            let start = nbr.len() as u8;
            for &b in &eb[e] {
                nbr.push(b);
            }
            nbr_span[e] = (start, (nbr.len() as u8) - start);
        }
        Solver {
            memo: vec![UNKNOWN; 1 << EDGES],
            box_masks,
            nbr,
            nbr_span,
            nodes: 0,
        }
    }

    fn reset(&mut self) {
        self.memo.iter_mut().for_each(|v| *v = UNKNOWN);
        self.nodes = 0;
    }

    /// Boxes that drawing `e` completes, given `edges` already drawn (e not in edges).
    #[inline]
    fn completed(&self, edges: u32, e: u8) -> i8 {
        let after = edges | (1 << e);
        let (start, len) = self.nbr_span[e as usize];
        let mut k = 0i8;
        for i in start..start + len {
            let m = self.box_masks[self.nbr[i as usize] as usize];
            if after & m == m {
                k += 1;
            }
        }
        k
    }

    /// Best future box margin for the side to move at `edges`.
    fn value(&mut self, edges: u32) -> i8 {
        if edges == ALL {
            return 0;
        }
        let cached = self.memo[edges as usize];
        if cached != UNKNOWN {
            return cached;
        }
        self.nodes += 1;
        let mut best = i8::MIN + 1;
        let free = !edges & ALL;
        let mut rest = free;
        while rest != 0 {
            let e = rest.trailing_zeros() as u8;
            rest &= rest - 1;
            let k = self.completed(edges, e);
            let v = if k > 0 {
                // A capture keeps the turn: same perspective, plus the boxes.
                k + self.value(edges | (1 << e))
            } else {
                // No capture: the turn passes, so the child's value is the
                // opponent's and flips sign.
                -self.value(edges | (1 << e))
            };
            if v > best {
                best = v;
            }
        }
        self.memo[edges as usize] = best;
        best
    }
}

/// A tiny deterministic LCG — the spike takes no dependencies.
struct Lcg(u64);
impl Lcg {
    fn next_u32(&mut self) -> u32 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 33) as u32
    }
}

/// Play `n` random legal edges from empty, returning the edge mask.
fn random_position(rng: &mut Lcg, n: usize) -> u32 {
    let mut edges = 0u32;
    for _ in 0..n {
        let free: Vec<u8> = (0..EDGES as u8).filter(|e| edges & (1 << e) == 0).collect();
        if free.is_empty() {
            break;
        }
        let pick = free[(rng.next_u32() as usize) % free.len()];
        edges |= 1 << pick;
    }
    edges
}

fn main() {
    let mut s = Solver::new();

    // How expensive is clearing the table? It is paid on every cold solve, so it
    // is part of the cost, not overhead to exclude.
    let t = Instant::now();
    s.reset();
    let memset_ms = t.elapsed().as_secs_f64() * 1000.0;
    println!("table: {} entries, {:.1} MB, clear {memset_ms:.1}ms", 1u64 << EDGES, (1u64 << EDGES) as f64 / 1e6);

    // 1. The whole game, from the empty board.
    s.reset();
    let t = Instant::now();
    let v = s.value(0);
    let ms = t.elapsed().as_secs_f64() * 1000.0;
    let filled = s.memo.iter().filter(|&&x| x != UNKNOWN).count();
    println!(
        "\nfull solve from empty: value={v:+} (margin for the opening player), nodes={}, {ms:.0}ms, memo filled={filled}",
        s.nodes
    );

    // 2. Cold solve cost by free-edge count — the number TRACTABLE_EDGES comes from.
    println!("\ncold exact solve by free edges (worst of 8 sampled positions):");
    println!("{:>5}  {:>12}  {:>9}  {:>9}", "free", "worst nodes", "worst ms", "med ms");
    let mut rng = Lcg(0x5EED);
    for free_target in [24usize, 22, 20, 18, 16, 14, 12, 10] {
        let drawn = EDGES - free_target;
        let mut worst_nodes = 0u64;
        let mut times: Vec<f64> = Vec::new();
        for _ in 0..8 {
            let pos = random_position(&mut rng, drawn);
            s.reset();
            let t = Instant::now();
            let _ = s.value(pos);
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            times.push(ms);
            worst_nodes = worst_nodes.max(s.nodes);
        }
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let worst = times[times.len() - 1];
        let med = times[times.len() / 2];
        println!("{free_target:>5}  {worst_nodes:>12}  {worst:>9.1}  {med:>9.1}");
    }

    // 3. Warm-table cost: within one game the table persists across moves, so
    //    the second solve at the same depth is much cheaper. Measure that too --
    //    it is the real in-game cost after the first exact move.
    println!("\nwarm-table solve (table kept across 8 positions at 16 free edges):");
    s.reset();
    let mut rng = Lcg(0xC0FFEE);
    for i in 0..8 {
        let pos = random_position(&mut rng, EDGES - 16);
        let before = s.nodes;
        let t = Instant::now();
        let _ = s.value(pos);
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        println!("  #{i}: nodes={:>9}  {ms:>7.2}ms", s.nodes - before);
    }
}
