//! Difficulty-tunability experiment for the hybrid approach: does the engine
//! "band width" Δ give a smooth, bounded strength knob?
//!
//! For a suite of solved positions we look at the exact value of every legal
//! move (the oracle's judgment). A band of width Δ keeps every move within Δ of
//! the best value; picking uniformly from that band is the hybrid's floor
//! (before the LLM's within-band, personality-driven choice). We report, per Δ:
//! average band size, average **regret** (best value minus the band's mean
//! value — how far below optimal you land), and **blunder rate** (fraction of
//! band moves that drop the win/draw/loss class).
//!
//! Run: `cargo run -p drop4-harness --example difficulty --release`

use adversary_core::Adversary;
use drop4_core::{apply_move, legal_cols, winner, Board, Col, Drop4};
use drop4_solver::Solver;
use rand_chacha::rand_core::{RngCore, SeedableRng};
use rand_chacha::ChaCha20Rng;

/// Exact value (side-to-move perspective) of each legal move in `board`.
fn move_values(board: &Board, solver: &mut Solver) -> Vec<(Col, i32)> {
    let moves = drop4_solver::Position::from_board(board).moves;
    legal_cols(board)
        .into_iter()
        .map(|c| {
            let child = apply_move(board, c);
            let v = if winner(&child) == Some(board.to_move) {
                (42 + 1 - moves as i32) / 2 // immediate win
            } else if legal_cols(&child).is_empty() {
                0 // full board, no winner => draw
            } else {
                -solver.solve(&drop4_solver::Position::from_board(&child))
            };
            (c, v)
        })
        .collect()
}

/// A deterministic non-terminal position with at least `min_discs` discs (so
/// the exact solve is cheap), or `None` if this seed ran into a terminal.
fn late_position(seed: u64, min_discs: usize) -> Option<Board> {
    let mut rng = ChaCha20Rng::seed_from_u64(seed);
    let mut pos = <Drop4 as Adversary>::initial(0);
    while pos.cells.iter().filter(|&&b| b != 0).count() < min_discs {
        let legal = legal_cols(&pos);
        if legal.is_empty() {
            return None;
        }
        pos = <Drop4 as Adversary>::apply(&pos, legal[(rng.next_u32() as usize) % legal.len()]);
        if <Drop4 as Adversary>::result(&pos).is_some() {
            return None;
        }
    }
    (!legal_cols(&pos).is_empty()).then_some(pos)
}

fn main() {
    let mut solver = Solver::new();
    // Suite of ~60 cheap solved positions (>=30 discs => <=12 empties).
    let suite: Vec<Board> = (0..400)
        .filter_map(|s| late_position(s, 30))
        .take(60)
        .collect();

    // Pre-compute each position's move values once.
    let valued: Vec<Vec<(Col, i32)>> = suite.iter().map(|b| move_values(b, &mut solver)).collect();

    println!(
        "Drop 4 — hybrid difficulty tunability ({} solved positions)",
        suite.len()
    );
    println!("band width Δ  | avg band size | avg regret | blunder rate");
    println!("--------------|---------------|------------|-------------");
    for delta in [0i32, 1, 2, 3, 5, 8, 40] {
        let mut band_sizes = 0usize;
        let mut regret_sum = 0.0f64;
        let mut band_moves = 0usize;
        let mut blunders = 0usize;
        for vals in &valued {
            let best = vals.iter().map(|&(_, v)| v).max().unwrap();
            let band: Vec<i32> = vals
                .iter()
                .map(|&(_, v)| v)
                .filter(|&v| v >= best - delta)
                .collect();
            band_sizes += band.len();
            let mean = band.iter().sum::<i32>() as f64 / band.len() as f64;
            regret_sum += best as f64 - mean;
            band_moves += band.len();
            blunders += band.iter().filter(|&&v| v.signum() < best.signum()).count();
        }
        let n = valued.len() as f64;
        println!(
            "{:>12}  | {:>13.2} | {:>10.2} | {:>10.1}%",
            delta,
            band_sizes as f64 / n,
            regret_sum / n,
            100.0 * blunders as f64 / band_moves as f64,
        );
    }
    println!("\nΔ=0 is perfect play (only optimal moves). Wider Δ = weaker but");
    println!("BOUNDED: blunder rate stays 0 until Δ crosses the win/draw/loss gap.");
}
