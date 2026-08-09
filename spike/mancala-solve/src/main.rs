//! Phase 0 discovery spike for `plans/2026-08-07-mancala.md`.
//!
//! Throwaway measurement code, written independently of the core it will inform,
//! so that when the shipped solver agrees with it that agreement means something
//! (the same posture the dots spike took).
//!
//! Board layout, absolute indices:
//!
//! ```text
//!        12  11  10   9   8   7      <- B's pits (B sows right-to-left here)
//!    13                          6   <- 13 = B's store, 6 = A's store
//!         0   1   2   3   4   5      <- A's pits
//! ```
//!
//! Sowing goes 0 -> 1 -> ... -> 6 -> 7 -> ... -> 13 -> 0, skipping the
//! **opponent's** store. Landing the last seed in your own store keeps the turn.
//! Landing it in an empty pit **on your own side** whose opposite pit is
//! non-empty captures both into your store. When the side to move has no seeds,
//! the opponent sweeps their remaining seeds and the game ends.
//!
//! What is measured:
//!   1. exact-solve cost as a function of **seeds in play** (the tractability knee)
//!   2. branching factor, game length, extra-turn chain length over self-play
//!   3. the game value from the opening, as far as the budget allows
//!   4. the budget-bite rate a fixed node allowance would produce

use std::collections::HashMap;
use std::time::Instant;

const PITS: usize = 6;
const SEEDS: u8 = 4;
const A_STORE: usize = 6;
const B_STORE: usize = 13;

/// Fourteen counts plus whose turn it is. `true` = A to move.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct Pos {
    cells: [u8; 14],
    a_to_move: bool,
}

impl Pos {
    fn initial() -> Self {
        let mut cells = [SEEDS; 14];
        cells[A_STORE] = 0;
        cells[B_STORE] = 0;
        Pos { cells, a_to_move: true }
    }

    /// The mover's pit range.
    fn my_pits(&self) -> std::ops::Range<usize> {
        if self.a_to_move { 0..PITS } else { PITS + 1..PITS + 1 + PITS }
    }
    fn my_store(&self) -> usize {
        if self.a_to_move { A_STORE } else { B_STORE }
    }
    fn their_store(&self) -> usize {
        if self.a_to_move { B_STORE } else { A_STORE }
    }

    fn legal(&self) -> Vec<usize> {
        self.my_pits().filter(|&p| self.cells[p] > 0).collect()
    }

    /// Seeds still outside the stores — the tractability measure, and monotone
    /// non-increasing because a seed in a store never leaves it.
    fn in_play(&self) -> u32 {
        (0..14)
            .filter(|&i| i != A_STORE && i != B_STORE)
            .map(|i| u32::from(self.cells[i]))
            .sum()
    }

    /// Whether the side to move has nothing to sow (the terminal condition).
    fn stuck(&self) -> bool {
        self.my_pits().all(|p| self.cells[p] == 0)
    }

    /// Sow from `pit`. Assumes `pit` is legal.
    fn sow(&self, pit: usize) -> Self {
        let mut next = *self;
        let mut hand = next.cells[pit];
        next.cells[pit] = 0;
        let mut at = pit;
        while hand > 0 {
            at = (at + 1) % 14;
            if at == self.their_store() {
                continue; // never sow into the opponent's store
            }
            next.cells[at] += 1;
            hand -= 1;
        }
        // Extra turn: the last seed landed in the mover's own store.
        if at == self.my_store() {
            return next;
        }
        // Capture: last seed into an empty own pit whose opposite has seeds.
        let mine = self.my_pits().contains(&at);
        if mine && next.cells[at] == 1 {
            let opposite = 12 - at; // 0<->12, 1<->11, ... 5<->7
            if next.cells[opposite] > 0 {
                next.cells[self.my_store()] += next.cells[opposite] + 1;
                next.cells[opposite] = 0;
                next.cells[at] = 0;
            }
        }
        next.a_to_move = !self.a_to_move;
        next
    }
}

/// Exact solver: the best **future** seed margin for the side to move.
///
/// Keyed on the pits and the side only — seeds already in a store cannot affect
/// future play, exactly as already-claimed boxes cannot in dots. So the final
/// margin is `(banked difference) + future margin`, and the memo is smaller for
/// it.
struct Exact {
    memo: HashMap<[u8; 13], i32>,
    nodes: u64,
    budget: u64,
    exhausted: bool,
}

impl Exact {
    fn new(budget: u64) -> Self {
        Exact { memo: HashMap::new(), nodes: 0, budget, exhausted: false }
    }

    fn key(pos: &Pos) -> [u8; 13] {
        let mut k = [0u8; 13];
        let mut w = 0;
        for i in 0..14 {
            if i == A_STORE || i == B_STORE {
                continue;
            }
            k[w] = pos.cells[i];
            w += 1;
        }
        k[12] = u8::from(pos.a_to_move);
        k
    }

    fn value(&mut self, pos: &Pos) -> Option<i32> {
        if pos.stuck() {
            // The opponent sweeps what they hold; the mover gets none of it.
            let theirs: i32 = if pos.a_to_move {
                (PITS + 1..PITS + 1 + PITS).map(|i| i32::from(pos.cells[i])).sum()
            } else {
                (0..PITS).map(|i| i32::from(pos.cells[i])).sum()
            };
            return Some(-theirs);
        }
        let k = Self::key(pos);
        if let Some(&v) = self.memo.get(&k) {
            return Some(v);
        }
        self.nodes += 1;
        if self.nodes > self.budget {
            self.exhausted = true;
            return None;
        }
        let mut best = i32::MIN;
        for p in pos.legal() {
            let child = pos.sow(p);
            let gained = i32::from(child.cells[pos.my_store()] - pos.cells[pos.my_store()]);
            let v = if child.a_to_move == pos.a_to_move {
                gained + self.value(&child)?
            } else {
                gained - self.value(&child)?
            };
            best = best.max(v);
        }
        self.memo.insert(k, best);
        Some(best)
    }
}

/// A position with exactly `target` seeds in play, reached by *playing* from the
/// opening rather than by sprinkling seeds — a constructed position can be
/// unreachable, and an unreachable position is not what the engine will face.
fn position_with(target: u32, mut rng: u64) -> Option<Pos> {
    let mut pos = Pos::initial();
    for _ in 0..400 {
        if pos.in_play() <= target {
            return Some(pos);
        }
        let moves = pos.legal();
        if moves.is_empty() {
            return None;
        }
        rng = rng.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        pos = pos.sow(moves[(rng >> 33) as usize % moves.len()]);
    }
    None
}

/// Rules checks that run before any measurement. The dots spike found two probe
/// defects that each produced a plausible-looking wrong answer; a number from an
/// unverified implementation is worse than no number.
fn verify() {
    // 1. Conservation. A sow must never create or destroy a seed.
    let mut rng = 12345u64;
    for _ in 0..2000 {
        let mut pos = Pos::initial();
        while !pos.stuck() {
            let total: u32 = pos.cells.iter().map(|&c| u32::from(c)).sum();
            assert_eq!(total, u32::from(SEEDS) * 12, "seeds appeared or vanished");
            let legal = pos.legal();
            rng = rng.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            pos = pos.sow(legal[(rng >> 33) as usize % legal.len()]);
        }
    }

    // 2. The classic Kalah(6,4) opening: pit 2 holds 4 seeds, which reach 3, 4, 5
    // and the store — so it lands in the store and the mover goes again.
    let opening = Pos::initial();
    let after = opening.sow(2);
    assert!(after.a_to_move, "sowing pit 2 must keep A's turn");
    assert_eq!(after.cells[A_STORE], 1);
    assert_eq!(after.cells[2], 0);
    assert_eq!(after.cells[3], 5);

    // 3. The opponent's store is skipped. From pit 5 with 12 seeds the sow lays
    // one in A's store, one in each of B's six pits, steps OVER index 13, and
    // lays five more in A's pits 0-4 — landing on a pit that already had seeds,
    // so no capture muddies the check.
    let mut wrap = Pos::initial();
    wrap.cells[5] = 12;
    let lapped = wrap.sow(5);
    assert_eq!(lapped.cells[B_STORE], 0, "A's sow must skip B's store");
    assert_eq!(lapped.cells[A_STORE], 1, "and must drop one in A's own store");
    assert_eq!(lapped.cells[7], 5, "each of B's pits got exactly one");
    assert_eq!(lapped.cells[4], 5, "the last seed landed here");

    // 3b. A lap that ends in one's own EMPTIED starting pit does capture — the
    // first expectation written here was that it would not, and the check was
    // right and the expectation wrong. Kalah has no self-capture exception: pit 5
    // is emptied at lift, so the 13th seed arrives in an empty own pit.
    let mut lap = Pos::initial();
    lap.cells[5] = 13;
    let round = lap.sow(5);
    assert_eq!(round.cells[5], 0, "the landing pit is emptied by the capture");
    assert_eq!(round.cells[7], 0, "and so is its opposite");
    assert_eq!(round.cells[A_STORE], 7, "1 sown + 1 landed + 5 captured opposite");

    // 4. Capture: last seed into an empty own pit, opposite non-empty.
    let mut cap = Pos { cells: [0; 14], a_to_move: true };
    cap.cells[0] = 1; // one seed, lands in pit 1
    cap.cells[1] = 0; // which is empty
    cap.cells[11] = 7; // and whose opposite holds 7
    let took = cap.sow(0);
    assert_eq!(took.cells[A_STORE], 8, "capture banks the 7 plus the landing seed");
    assert_eq!(took.cells[11], 0);
    assert_eq!(took.cells[1], 0);
    assert!(!took.a_to_move, "a capture does NOT keep the turn");

    // 5. No capture when the opposite pit is empty (the rule this build adopts).
    let mut nocap = Pos { cells: [0; 14], a_to_move: true };
    nocap.cells[0] = 1;
    nocap.cells[11] = 0;
    let quiet = nocap.sow(0);
    assert_eq!(quiet.cells[A_STORE], 0);
    assert_eq!(quiet.cells[1], 1, "the seed stays where it landed");

    // 6. The terminal sweep, hand-derived: A is stuck, B holds 3 seeds, so B banks
    // them and A's future margin is -3.
    let mut stuck = Pos { cells: [0; 14], a_to_move: true };
    stuck.cells[8] = 3;
    assert!(stuck.stuck());
    let mut ex = Exact::new(1_000);
    assert_eq!(ex.value(&stuck), Some(-3), "the sweep goes to the side that has seeds");

    println!("rules verified: conservation, extra turn, store skip, capture, no-capture, sweep\n");
}

fn main() {
    // Sections are selectable (`cargo run --release -- 4`) so re-running one does
    // not repeat an eight-minute measurement that already has its answer.
    let want: Vec<String> = std::env::args().skip(1).collect();
    let run = |n: &str| want.is_empty() || want.iter().any(|w| w == n);

    verify();
    if run("1") {
    println!("== 1. exact-solve cost vs seeds in play (the tractability knee)\n");
    println!("{:>6}  {:>10}  {:>10}  {:>9}  {}", "seeds", "nodes", "memo", "ms", "note");
    for target in [4u32, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48] {
        let mut worst_ms = 0.0f64;
        let mut worst_nodes = 0u64;
        let mut worst_memo = 0usize;
        let mut gave_up = false;
        for seed in 0..5u64 {
            let Some(pos) = position_with(target, seed * 7919 + 1) else { continue };
            let mut ex = Exact::new(400_000_000);
            let t = Instant::now();
            let v = ex.value(&pos);
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            if v.is_none() {
                gave_up = true;
            }
            if ms > worst_ms {
                worst_ms = ms;
                worst_nodes = ex.nodes;
                worst_memo = ex.memo.len();
            }
        }
        println!(
            "{target:>6}  {worst_nodes:>10}  {worst_memo:>10}  {worst_ms:>9.1}  {}",
            if gave_up { "BUDGET EXHAUSTED" } else { "" }
        );
        if worst_ms > 60_000.0 || gave_up {
            println!("        (stopping: past the knee)");
            break;
        }
    }

    }

    if run("2") {
    println!("\n== 2. shape of the game (self-play, random legal moves)\n");
    let mut lengths = Vec::new();
    let mut branches = Vec::new();
    let mut chains = Vec::new();
    for seed in 0..200u64 {
        let mut pos = Pos::initial();
        let mut rng = seed * 104_729 + 7;
        let mut moves = 0u32;
        let mut chain = 0u32;
        while !pos.stuck() && moves < 500 {
            let legal = pos.legal();
            branches.push(legal.len() as u32);
            rng = rng.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let before = pos.a_to_move;
            pos = pos.sow(legal[(rng >> 33) as usize % legal.len()]);
            moves += 1;
            if pos.a_to_move == before {
                chain += 1;
            } else {
                chains.push(chain + 1);
                chain = 0;
            }
        }
        lengths.push(moves);
    }
    let mean = |v: &[u32]| v.iter().map(|&x| f64::from(x)).sum::<f64>() / v.len() as f64;
    println!("  moves per game   mean {:.1}  max {}", mean(&lengths), lengths.iter().max().unwrap());
    println!("  branching factor mean {:.2} max {}", mean(&branches), branches.iter().max().unwrap());
    println!(
        "  moves per TURN   mean {:.2} max {}  (an extra-turn chain)",
        mean(&chains),
        chains.iter().max().unwrap()
    );

    }

    if run("3") {
    println!("\n== 3. the value of the opening position\n");
    for budget in [10_000_000u64, 100_000_000] {
        let mut ex = Exact::new(budget);
        let t = Instant::now();
        let v = ex.value(&Pos::initial());
        let secs = t.elapsed().as_secs_f64();
        match v {
            Some(margin) => {
                println!(
                    "  budget {budget:>11}: SOLVED, first player margin {margin:+}  ({} nodes, {} memo, {secs:.1}s)",
                    ex.nodes,
                    ex.memo.len()
                );
                break;
            }
            None => println!(
                "  budget {budget:>11}: exhausted after {} nodes ({} memo, {secs:.1}s)",
                ex.nodes,
                ex.memo.len()
            ),
        }
    }

    }

    if run("4") {
    println!("\n== 4. budget-bite rate: how often a fixed allowance truncates a real move\n");
    for budget in [200_000u64, 1_000_000, 4_000_000] {
        let mut bit = 0u32;
        let mut total = 0u32;
        for seed in 0..12u64 {
            let mut pos = Pos::initial();
            let mut rng = seed * 15_485_863 + 3;
            while !pos.stuck() && total < 100_000 {
                let mut ex = Exact::new(budget);
                total += 1;
                if ex.value(&pos).is_none() {
                    bit += 1;
                }
                let legal = pos.legal();
                rng = rng.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                pos = pos.sow(legal[(rng >> 33) as usize % legal.len()]);
            }
        }
        println!(
            "  budget {budget:>9} nodes: bites on {:.1}% of positions ({bit}/{total})",
            100.0 * f64::from(bit) / f64::from(total)
        );
    }
    }
}
