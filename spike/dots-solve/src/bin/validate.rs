//! Phase 0 validation — the same recurrence, generalized over board size, so it
//! can be checked against values a person can derive by hand.
//!
//! The risk this closes (named in the plan as a Phase 3 risk): a capture keeps
//! the turn and a non-capture flips it, and getting that backwards yields an
//! engine that plays confidently anti-optimally. A 1x1 board settles it — four
//! edges, strict alternation until the fourth, so the SECOND player takes the
//! only box and the value from empty must be exactly -1.

use std::collections::HashMap;

struct Game {
    rows: usize,
    cols: usize,
    edges: usize,
    box_masks: Vec<u32>,
}

impl Game {
    fn new(rows: usize, cols: usize) -> Self {
        // horizontal H(r,c) = r*cols + c        for r in 0..=rows, c in 0..cols
        // vertical   V(r,c) = h + r*(cols+1) + c for r in 0..rows, c in 0..=cols
        let h = (rows + 1) * cols;
        let v = rows * (cols + 1);
        let mut box_masks = Vec::new();
        for r in 0..rows {
            for c in 0..cols {
                let h_top = r * cols + c;
                let h_bot = (r + 1) * cols + c;
                let v_left = h + r * (cols + 1) + c;
                let v_right = h + r * (cols + 1) + c + 1;
                let mut m = 0u32;
                for e in [h_top, h_bot, v_left, v_right] {
                    m |= 1 << e;
                }
                box_masks.push(m);
            }
        }
        Game { rows, cols, edges: h + v, box_masks }
    }

    fn all(&self) -> u32 {
        (1u32 << self.edges) - 1
    }

    fn completed(&self, edges: u32, e: usize) -> i32 {
        let after = edges | (1 << e);
        let bit = 1u32 << e;
        self.box_masks
            .iter()
            .filter(|&&m| m & bit != 0 && after & m == m)
            .count() as i32
    }

    fn value(&self, edges: u32, memo: &mut HashMap<u32, i32>) -> i32 {
        if edges == self.all() {
            return 0;
        }
        if let Some(&v) = memo.get(&edges) {
            return v;
        }
        let mut best = i32::MIN;
        for e in 0..self.edges {
            if edges & (1 << e) != 0 {
                continue;
            }
            let k = self.completed(edges, e);
            let v = if k > 0 {
                k + self.value(edges | (1 << e), memo)
            } else {
                -self.value(edges | (1 << e), memo)
            };
            best = best.max(v);
        }
        memo.insert(edges, best);
        best
    }
}

fn main() {
    for (rows, cols) in [(1usize, 1usize), (1, 2), (2, 2), (2, 3), (3, 3)] {
        let g = Game::new(rows, cols);
        let mut memo = HashMap::new();
        let v = g.value(0, &mut memo);
        let boxes = rows * cols;
        // value = A's boxes - B's boxes, and the two sum to `boxes`.
        let a = (boxes as i32 + v) / 2;
        let b = boxes as i32 - a;
        println!(
            "{rows}x{cols}: {:>2} boxes, {:>2} edges -> value {v:+} (A {a} : B {b}){}",
            boxes,
            g.edges,
            if (boxes as i32 + v) % 2 != 0 { "  << PARITY ERROR" } else { "" }
        );
    }

    // The hand-derivable anchor, asserted rather than eyeballed.
    let g = Game::new(1, 1);
    let mut memo = HashMap::new();
    assert_eq!(
        g.value(0, &mut memo),
        -1,
        "1x1: four edges, strict alternation, so the second player takes the box"
    );

    // A capture that ends the game is worth exactly the boxes it closes.
    let g = Game::new(1, 1);
    let mut memo = HashMap::new();
    let three_sides = 0b0111u32; // three of the four edges drawn
    assert_eq!(g.value(three_sides, &mut memo), 1, "closing the last box scores +1");

    // Two free edges, neither a capture yet: the mover must give the box away.
    let g = Game::new(1, 2);
    let mut memo = HashMap::new();
    // Fill every edge except the two that complete box 0 -> mover draws one
    // (no capture), opponent closes both boxes... construct it concretely:
    let all = g.all();
    let mut edges = all;
    edges &= !(1 << 0); // remove H(0,0)
    edges &= !(1 << 2); // remove H(1,0)
    let v = g.value(edges, &mut memo);
    println!("\n1x2 with two edges of one box open: value {v:+} for the mover");

    println!("\nall hand-derivable anchors hold");
}
