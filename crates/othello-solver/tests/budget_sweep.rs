//! P9 Part B, Phase B2 — the strength/latency curve for Othello's midgame
//! budget. Run explicitly; not part of the gate.
//!
//! ```text
//! cargo test --package othello-solver --release --test budget_sweep -- --ignored --nocapture
//! ```
//!
//! ## The protocol, and why each clause is here
//!
//! Every one of these was paid for by a wrong number in P9 Phase 3:
//!
//! 1. **Randomised openings.** `<Othello as Adversary>::initial(seed)` is the
//!    standard opening for *every* seed, and at zero sloppiness neither player
//!    draws from the RNG — so without random opening plies, every game with the
//!    same first player is bit-identical and N games are really two. Drop 4 had
//!    this exact bug and reported a false 0W-4D-4L "collapse".
//! 2. **A control row.** A budget too large to bite is the unbudgeted engine
//!    playing *itself*. Whatever it scores is the noise floor, and it is not
//!    an even split, because random openings are not symmetric between seats.
//!    Without this row the table cannot be read.
//! 3. **Alternating seats** across seeds.
//! 4. **The sample size travels with the claim.** These game counts cannot
//!    resolve a small difference and must not be reported as if they could.
//!
//! ## Recorded 2026-08-07 — 40 games per row (~14 minutes each)
//!
//! ```text
//! budget       depth min/avg   W-D-L vs unbudgeted Expert
//!     50000    5/6            17W-1D-22L   (43%)
//!    100000    6/6            22W-2D-16L   (55%)
//!    200000    7/7            18W-1D-21L   (45%)
//!   (none)     7/7            20W-1D-19L   (50%)  <- control
//! ```
//!
//! Every row sits within one standard deviation of the control. For n=40 that
//! band is ±7.9 percentage points (42–58%), so this rig can report "no collapse"
//! and nothing finer; resolving a 5-point difference would take roughly 400 games
//! per row. **No budget was adopted** on the strength of this — see
//! `plans/2026-08-07-othello-midgame.md` Phase B2.
//!
//! The `depth min/avg` column is sampled from **one** game, not the 40 played.
//! That is why 200000 reads 7/7 "never bites" and yet does not exactly reproduce
//! the control: it bites in positions the single sample missed. Indicative, not a
//! census.

use adversary_core::{Adversary, Side};
use adversary_solver::NodeBudget;
use othello_core::{apply_move, legal_moves, result, Board, Othello};
use othello_solver::search::{capped_values_deepened, Level, Table, TRACTABLE_EMPTIES};
use othello_solver::{move_values, select_in_band};
use rand_chacha::rand_core::{RngCore, SeedableRng};
use rand_chacha::ChaCha20Rng;

const GAMES: u64 = 40;

fn empties(board: &Board) -> usize {
    board.cells.iter().filter(|&&v| v == 0).count()
}

/// One side's move: budgeted midgame deepening, or the shipped unbudgeted
/// search. The exact endgame is identical either way — this compares midgames.
fn pick(board: &Board, budget_nodes: Option<u64>, rng: &mut ChaCha20Rng) -> othello_core::Move {
    let depth = Level::Expert.depth();
    let values = match budget_nodes {
        Some(n) if empties(board) > TRACTABLE_EMPTIES => {
            let mut tt = Table::new();
            capped_values_deepened(board, depth, &mut tt, &mut NodeBudget::of(n))
                .map(|d| d.result)
                .expect("depth 1 always completes")
        }
        _ => move_values(board, depth),
    };
    // Expert's band: class floor on, no sloppiness. Comparing searches, not luck.
    select_in_band(&values, |_| 0, true, 0, rng).expect("a live position has a move")
}

/// Budgeted Expert against unbudgeted Expert over varied openings.
fn head_to_head(budget_nodes: Option<u64>) -> (u32, u32, u32) {
    let (mut w, mut d, mut l) = (0, 0, 0);
    for seed in 0..GAMES {
        let budgeted_is_a = seed % 2 == 0;
        let mut rng = ChaCha20Rng::seed_from_u64(seed);
        let mut board = <Othello as Adversary>::initial(seed);

        // Clause 1: diversify, or this measures two games.
        for _ in 0..6 + (seed % 5) as usize {
            if result(&board).is_some() {
                break;
            }
            let l = legal_moves(&board);
            board = apply_move(&board, l[(rng.next_u32() as usize) % l.len()]);
        }

        while result(&board).is_none() {
            let use_budget = (board.to_move == Side::A) == budgeted_is_a;
            let mv = pick(
                &board,
                if use_budget { budget_nodes } else { None },
                &mut rng,
            );
            board = apply_move(&board, mv);
        }

        match result(&board) {
            Some(adversary_core::MatchResult::Draw) | None => d += 1,
            Some(adversary_core::MatchResult::WinA) => {
                if budgeted_is_a {
                    w += 1;
                } else {
                    l += 1;
                }
            }
            Some(adversary_core::MatchResult::WinB) => {
                if budgeted_is_a {
                    l += 1;
                } else {
                    w += 1;
                }
            }
        }
    }
    (w, d, l)
}

/// The midgame depth the budget reaches, worst and typical, over a real game.
fn depths_reached(budget_nodes: u64) -> (u32, u32) {
    let depth = Level::Expert.depth();
    let mut rng = ChaCha20Rng::seed_from_u64(3);
    let mut board = <Othello as Adversary>::initial(0);
    let (mut worst, mut sum, mut n) = (depth, 0u32, 0u32);
    while result(&board).is_none() {
        if empties(&board) > TRACTABLE_EMPTIES {
            let mut tt = Table::new();
            if let Some(d) =
                capped_values_deepened(&board, depth, &mut tt, &mut NodeBudget::of(budget_nodes))
            {
                worst = worst.min(d.depth);
                sum += d.depth;
                n += 1;
            }
        }
        let l = legal_moves(&board);
        board = apply_move(&board, l[(rng.next_u32() as usize) % l.len()]);
    }
    // `checked_div` rather than a zero test: clippy::manual_checked_div, and it
    // says the intent better — "the average, or the full depth if nothing was
    // sampled" (which happens only if the walk never leaves the exact region).
    (worst, sum.checked_div(n).unwrap_or(depth))
}

#[test]
#[ignore = "calibration probe, run explicitly"]
fn sweep() {
    println!(
        "\nOthello Expert (depth {}), midgame budget sweep, {GAMES} varied-opening games",
        Level::Expert.depth()
    );
    println!("budget       depth min/avg   W-D-L vs unbudgeted Expert");

    for nodes in [50_000u64, 100_000, 200_000] {
        let (w, d, l) = head_to_head(Some(nodes));
        let (worst, avg) = depths_reached(nodes);
        println!("{nodes:>9}    {worst}/{avg}            {w}W-{d}D-{l}L");
    }

    // Clause 2: the control. No budget at all — the shipped engine against
    // itself. This row is the noise floor every row above must be read against.
    let (w, d, l) = head_to_head(None);
    println!("  (none)     7/7            {w}W-{d}D-{l}L   <- control");
}
