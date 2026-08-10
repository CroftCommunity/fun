//! The heuristic weight sweep. Run explicitly; **not part of the gate**.
//!
//! ```text
//! cargo test --package furrow-solver --release --test weight_sweep -- --ignored --nocapture
//! ```
//!
//! ## Why this exists
//!
//! `eval::Weights::SHIPPED` is `side_seed: 1, extra_turn: 3, capture: 2`. Those
//! numbers were **reasoned and policy-tested, never fitted** — and Phase 0
//! measured that roughly **70% of a game** sits above the exact threshold, where
//! the heuristic and nothing else decides the move. That makes three integers the
//! largest untuned lever on this engine's strength.
//!
//! ## The protocol, and why each clause is here
//!
//! Taken wholesale from `othello-solver/tests/budget_sweep.rs`, where every
//! clause was paid for by a wrong number:
//!
//! 1. **Randomised openings.** `<Furrow as Adversary>::initial(seed)` is the same
//!    6×4 position for *every* seed, and at zero sloppiness neither player draws
//!    from the RNG — so without random opening plies, every game with the same
//!    first player is bit-identical and N games are really two. This game already
//!    shows the symptom: its harness baseline reads 6-0-6 over twelve games,
//!    which is one forced result per seat, counted six times.
//! 2. **A control row.** The candidate set equal to the shipped set is the engine
//!    playing *itself*. Whatever it scores is the noise floor, and it is **not**
//!    an even split, because random openings are not symmetric between seats.
//!    Without this row the table cannot be read.
//! 3. **Alternating seats** across seeds, so a seat advantage cannot be read as a
//!    weight difference.
//! 4. **The sample size travels with the claim.** These game counts cannot
//!    resolve a small difference and must not be reported as if they could. At
//!    n=40 one standard deviation on a 50% rate is ±7.9 percentage points.
//!
//! One clause of its own: **the exact endgame ignores weights entirely**, because
//! a proof has no weights in it. So every game here is decided by the weights only
//! for as long as it stays above `TRACTABLE_SEEDS`, and both sides play the same
//! proven endgame. That *shrinks* the measurable effect and is not a flaw in the
//! rig — it is the same reason the harness grades only 27% of moves.
//!
//! ## Recorded 2026-08-10 — 40 games per row, ~3 minutes for the table
//!
//! ```text
//! candidate (s,e,c)      |      W-D-L |  score
//! control (shipped)      | 17W-2D-21L |  45.0%   (1,3,2)   <- the noise floor
//! scale control (2,6,4)  |  5W-1D-34L |  13.8%   (2,6,4)   <- see below
//! no extra-turn term     | 12W-3D-25L |  33.8%   (1,0,2)
//! no capture term        | 11W-2D-27L |  30.0%   (1,3,0)
//! seeds only             | 10W-2D-28L |  27.5%   (1,0,0)
//! extra turn 1           | 14W-2D-24L |  37.5%   (1,1,2)
//! extra turn 2           | 16W-2D-22L |  42.5%   (1,2,2)
//! extra turn 5           | 16W-2D-22L |  42.5%   (1,5,2)
//! extra turn 8           | 11W-2D-27L |  30.0%   (1,8,2)
//! capture 1              | 14W-4D-22L |  40.0%   (1,3,1)
//! capture 4              | 15W-3D-22L |  41.2%   (1,3,4)
//! capture 6              | 11W-2D-27L |  30.0%   (1,3,6)
//! seeds 2                |  4W-1D-35L |  11.2%   (2,3,2)
//! seeds 0                | 13W-2D-25L |  35.0%   (0,3,2)
//! heavy tempo (1,6,4)    | 13W-3D-24L |  36.2%   (1,6,4)
//! flat (1,1,1)           | 12W-1D-27L |  31.2%   (1,1,1)
//! ```
//!
//! **The control is 45.0%, not 50%** — exactly the asymmetry clause 2 exists to
//! expose. Read every row against 45.0 ± 7.9, i.e. the band 37.1–52.9%.
//!
//! **No candidate beat the shipped weights. Nothing was adopted.** Three things
//! the table does say:
//!
//! 1. **Both non-seed terms are load-bearing.** Dropping the extra-turn term
//!    costs ~11 points, dropping the capture term ~15, dropping both ~17.5 — all
//!    far outside the band. They were reasoned rather than fitted, and they are
//!    now measured to earn their keep.
//! 2. **The shipped values sit in a flat basin.** `extra_turn` 2, 3 and 5 are
//!    indistinguishable at this sample size, as are `capture` 1, 2 and 4. Only the
//!    extremes (8, 6, 0) are clearly worse. Fine-tuning inside the basin would
//!    need roughly 400 games per row to resolve a 3-point difference, and there is
//!    no evidence a 3-point difference is there to find.
//! 3. **`side_seed` is not a knob at all**, and finding that out is what the
//!    scale-control row is for.
//!
//! ### The scale control failed, and that is the best thing in the table
//!
//! `(2,6,4)` was added as a second control, on the reasoning that the capped path
//! only ever *ranks* its values against each other within one position — so
//! scaling every weight by the same factor could not change a move, and this row
//! had to reproduce the control exactly.
//!
//! **The reasoning was wrong.** It scores **13.8%** against the control's 45.0%.
//! The heuristic is not merely ranked: `capped_future` computes
//! `gain ± capped_future(...)`, where `gain` is a real count of seeds banked on
//! that move and the leaf returns the heuristic. The estimate is **added to actual
//! seed counts**, so it is denominated in seeds — and `side_seed: 1` is precisely
//! what sets that unit. Double it and the heuristic counts every seed twice
//! against a real margin that did not change.
//!
//! So `side_seed` is not a free parameter; it is the term that calibrates the
//! other two to the units the search adds them to. `(2,3,2)` at 11.2% is the same
//! effect seen from the other side, and without this row it would have been read
//! as "the seed term wants to be small" rather than "the seed term is a unit".
//!
//! The row is kept, and kept labelled as a failed control, because a table that
//! shows why a knob is not a knob is worth more than one that quietly omits it.
//!
//! At n=40 this rig can report "no collapse, and no improvement found" and
//! nothing finer.

use adversary_core::{Adversary, MatchResult, Side};
use adversary_solver::{select_in_band, NodeBudget};
use furrow_core::{legal_pits, Board, Furrow, Pit};
use furrow_solver::eval::Weights;
use furrow_solver::live::{live_band, Level};
use furrow_solver::search::{
    capped_class, class_of, is_affordable, move_values_with, CAPPED_NODE_BUDGET, EXACT_NODE_BUDGET,
};
use rand_chacha::rand_core::{RngCore, SeedableRng};
use rand_chacha::ChaCha20Rng;

/// Games per row. Stated with every claim, per clause 4.
const GAMES: u64 = 40;
/// Random plies before the engines take over, per clause 1.
const OPENING_PLIES: usize = 6;

/// One move at `level` under `weights`, through the same band the engine ships.
fn choose_with(pos: &Board, level: Level, weights: Weights, rng: &mut ChaCha20Rng) -> Option<Pit> {
    let band = live_band(level);
    let budget = if is_affordable(pos) {
        NodeBudget::of(EXACT_NODE_BUDGET)
    } else {
        NodeBudget::of(CAPPED_NODE_BUDGET)
    };
    let report = move_values_with(pos, band.depth, budget, weights);
    let class: fn(i32) -> i32 = if is_affordable(pos) {
        class_of
    } else {
        capped_class
    };
    select_in_band(
        &report.values,
        class,
        band.preserve_class,
        band.sloppiness_pct,
        rng,
    )
}

/// A position reached by `OPENING_PLIES` random legal moves.
fn random_opening(seed: u64) -> Board {
    let mut rng = ChaCha20Rng::seed_from_u64(seed);
    let mut pos = <Furrow as Adversary>::initial(0);
    for _ in 0..OPENING_PLIES {
        let moves = legal_pits(&pos);
        if moves.is_empty() {
            break;
        }
        let pick = (rng.next_u32() as usize) % moves.len();
        pos = furrow_core::apply_move(&pos, moves[pick]);
    }
    pos
}

/// Play `candidate` against `Weights::SHIPPED` over `GAMES` randomised openings,
/// alternating which weight set takes which seat. Returns (W, D, L) for the
/// candidate.
fn play_row(candidate: Weights, level: Level) -> (u32, u32, u32) {
    let (mut w, mut d, mut l) = (0, 0, 0);
    for game in 0..GAMES {
        // Clause 3: the candidate takes Side A on even games and Side B on odd.
        let candidate_is_a = game % 2 == 0;
        let mut pos = random_opening(game);
        let mut rng_a = ChaCha20Rng::seed_from_u64(game * 2 + 1);
        let mut rng_b = ChaCha20Rng::seed_from_u64(game * 2 + 2);
        let mut guard = 0;
        while <Furrow as Adversary>::result(&pos).is_none() && guard < 400 {
            let side_is_candidate = (pos.to_move == Side::A) == candidate_is_a;
            let weights = if side_is_candidate {
                candidate
            } else {
                Weights::SHIPPED
            };
            let rng = if pos.to_move == Side::A {
                &mut rng_a
            } else {
                &mut rng_b
            };
            let Some(mv) = choose_with(&pos, level, weights, rng) else {
                break;
            };
            pos = furrow_core::apply_move(&pos, mv);
            guard += 1;
        }
        let candidate_side = if candidate_is_a { Side::A } else { Side::B };
        match <Furrow as Adversary>::result(&pos) {
            Some(MatchResult::Draw) | None => d += 1,
            Some(r) if r.winner() == Some(candidate_side) => w += 1,
            Some(_) => l += 1,
        }
    }
    (w, d, l)
}

/// A weight set, as `(side_seed, extra_turn, capture)` — one row per line, so the
/// table in the source reads like the table in the output.
const fn w(side_seed: i32, extra_turn: i32, capture: i32) -> Weights {
    Weights {
        side_seed,
        extra_turn,
        capture,
    }
}

/// The rows. The control is first so a broken rig is obvious before any candidate
/// is read (clause 2).
///
/// Split out of the test only to keep clippy's line budget happy; the long
/// comments in here are the point of the file, not padding.
fn rows() -> Vec<(&'static str, Weights)> {
    vec![
        ("control (shipped)", Weights::SHIPPED),
        // Added as a second *control*, and it failed — see the module note.
        ("scale control (2,6,4)", w(2, 6, 4)),
        ("no extra-turn term", w(1, 0, 2)),
        ("no capture term", w(1, 3, 0)),
        ("seeds only", w(1, 0, 0)),
        ("extra turn 1", w(1, 1, 2)),
        ("extra turn 2", w(1, 2, 2)),
        ("extra turn 5", w(1, 5, 2)),
        ("extra turn 8", w(1, 8, 2)),
        ("capture 1", w(1, 3, 1)),
        ("capture 4", w(1, 3, 4)),
        ("capture 6", w(1, 3, 6)),
        ("seeds 2", w(2, 3, 2)),
        ("seeds 0", w(0, 3, 2)),
        ("heavy tempo (1,6,4)", w(1, 6, 4)),
        ("flat (1,1,1)", w(1, 1, 1)),
    ]
}

#[test]
#[ignore = "explicit sweep; minutes per row, not part of the gate"]
fn weight_sweep() {
    println!("\nweight sweep vs SHIPPED (1,3,2) — Expert, {GAMES} games/row, {OPENING_PLIES} random opening plies");
    println!(
        "{:<22} | {:>10} | {:>6}",
        "candidate (s,e,c)", "W-D-L", "score"
    );
    for (name, w) in rows() {
        let (win, draw, loss) = play_row(w, Level::Expert);
        let score = (f64::from(win) + 0.5 * f64::from(draw)) / GAMES as f64 * 100.0;
        println!(
            "{:<22} | {:>10} | {:>5.1}%   ({},{},{})",
            name,
            format!("{win}W-{draw}D-{loss}L"),
            score,
            w.side_seed,
            w.extra_turn,
            w.capture
        );
    }
    println!(
        "\nOne standard deviation on a 50% rate at n={GAMES} is ±{:.1} points. Nothing\ninside that band is a finding.",
        50.0 / (GAMES as f64).sqrt()
    );
}

#[test]
fn the_sweep_rig_actually_varies_the_game() {
    // The rig check, on the gate rather than behind `--ignored`, because a sweep
    // that silently plays the same game every row is the failure mode that looks
    // most like success. Two things must hold: random openings differ, and a
    // different weight set really produces a different move somewhere.
    let a = random_opening(1);
    let b = random_opening(2);
    assert_ne!(a.cells, b.cells, "randomised openings must actually differ");

    let flat = w(1, 1, 1);
    let mut differed = false;
    for seed in 0..12u64 {
        let pos = random_opening(seed);
        if legal_pits(&pos).is_empty() {
            continue;
        }
        let mut r1 = ChaCha20Rng::seed_from_u64(7);
        let mut r2 = ChaCha20Rng::seed_from_u64(7);
        let shipped = choose_with(&pos, Level::Expert, Weights::SHIPPED, &mut r1);
        let other = choose_with(&pos, Level::Expert, flat, &mut r2);
        if shipped != other {
            differed = true;
            break;
        }
    }
    assert!(
        differed,
        "no weight set changed a single move — the sweep would measure nothing"
    );
}
