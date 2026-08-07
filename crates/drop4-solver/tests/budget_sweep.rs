//! Phase 3 calibration probe — the strength/latency curve for Drop 4's live
//! budget. Run explicitly; not part of the gate.
//!
//! ```text
//! cargo test --package drop4-solver --release --test budget_sweep -- --ignored --nocapture
//! ```

use adversary_core::{Adversary, Side};
use adversary_solver::NodeBudget;
use drop4_core::{apply_move, legal_cols, winner, Drop4};
use drop4_solver::live::{
    live_band, move_values_capped, move_values_capped_deepened, select_in_band,
};

/// Mirrors the crate-private `capped_class`; the sweep only needs the floor to
/// behave, and duplicating three lines beats widening the API for a probe.
fn capped_class(v: i32) -> i32 {
    if v >= 500_000 {
        1
    } else if v <= -500_000 {
        -1
    } else {
        0
    }
}
use drop4_solver::Level;
use rand_chacha::rand_core::{RngCore, SeedableRng};
use rand_chacha::ChaCha20Rng;

/// Budgeted Perfect against unbudgeted Perfect, alternating who moves first.
fn head_to_head(budget_nodes: u64, games: u64) -> (u32, u32, u32) {
    let depth = live_band(Level::Perfect).depth;
    let (mut w, mut d, mut l) = (0, 0, 0);
    for seed in 0..games {
        let budgeted_is_a = seed % 2 == 0;
        let mut rng = ChaCha20Rng::seed_from_u64(seed);
        let mut board = <Drop4 as Adversary>::initial(seed);

        // **Diversify the opening, or this measures nothing.** Drop 4's
        // `initial(seed)` is the same empty board for every seed, and at zero
        // sloppiness neither player draws from the RNG — so without this every
        // game with the same first player is bit-identical. The first version of
        // this sweep had 8 games and 2 distinct ones, which is why its results
        // arrived in blocks of four and looked non-monotonic.
        let opening_plies = 4 + (seed % 3) as usize;
        for _ in 0..opening_plies {
            if winner(&board).is_some() || legal_cols(&board).is_empty() {
                break;
            }
            let l = legal_cols(&board);
            let i = (rng.next_u32() as usize) % l.len();
            board = apply_move(&board, l[i]);
        }

        while winner(&board).is_none() && !legal_cols(&board).is_empty() {
            let use_budget = (board.to_move == Side::A) == budgeted_is_a;
            let values = if use_budget {
                move_values_capped_deepened(&board, depth, &mut NodeBudget::of(budget_nodes))
                    .map(|x| x.result)
                    .expect("depth 1 always completes")
            } else {
                move_values_capped(&board, depth)
            };
            let col = select_in_band(&values, capped_class, true, 0, &mut rng)
                .expect("a live position has a move");
            board = apply_move(&board, col);
        }
        match winner(&board) {
            None => d += 1,
            Some(side) => {
                if (side == Side::A) == budgeted_is_a {
                    w += 1;
                } else {
                    l += 1;
                }
            }
        }
    }
    (w, d, l)
}

/// The deepest depth the budget reached from the opening, and the worst single
/// root search's node spend, as a latency proxy.
fn depth_reached(budget_nodes: u64) -> u32 {
    let depth = live_band(Level::Perfect).depth;
    let board = <Drop4 as Adversary>::initial(0);
    move_values_capped_deepened(&board, depth, &mut NodeBudget::of(budget_nodes))
        .map(|x| x.depth)
        .unwrap_or(0)
}

#[test]
#[ignore = "calibration probe, run explicitly"]
fn sweep() {
    let full = live_band(Level::Perfect).depth;
    println!("\nbudget      opening depth (of {full})   W-D-L vs unbudgeted Perfect (30 varied-opening games)");
    for nodes in [
        100_000u64, 250_000, 500_000, 1_000_000, 2_000_000, 4_000_000,
    ] {
        let (w, d, l) = head_to_head(nodes, 30);
        println!(
            "{nodes:>9}   {:>2}                      {w}W-{d}D-{l}L",
            depth_reached(nodes)
        );
    }
}
