//! Native driver for the Phase 0 spike (plan 2026-08-30-plan-chess-vs-engine.md).
//!
//! Subcommands:
//!   positions  — print the 50 measurement positions as FENs
//!   measure    — D2: nodes and ms per depth, with and without quiescence,
//!                plus the depth-3 queen-hang probe
//!   fixtures   — D4: validate the draw-rule fixtures (repetition semantics
//!                tracked here; cozy-chess supplies mate/stalemate/50-move)

use chess_search_spike::{positions, quiesce_value, static_value, Search};
use cozy_chess::{Board, GameStatus, Move};
use std::time::Instant;

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("positions") => {
            for (i, b) in positions().iter().enumerate() {
                println!("{i:2}  {b}");
            }
        }
        Some("measure") => measure(),
        Some("fixtures") => fixtures(),
        Some("diffperft") => diffperft(),
        _ => eprintln!("usage: chess-search-spike positions|measure|fixtures|diffperft"),
    }
}

// ---------------------------------------------------------------- D2: measure

fn pct(sorted: &[u64], p: f64) -> u64 {
    let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[idx]
}

fn measure() {
    let boards = positions();
    println!("machine: native (report the host beside these numbers)");
    println!("positions: {}", boards.len());
    for &use_q in &[true, false] {
        println!("\n== quiescence {} ==", if use_q { "ON" } else { "OFF" });
        println!("depth  median-nodes  p95-nodes  worst-nodes  median-ms  p95-ms  worst-ms");
        for depth in 2..=6 {
            let mut nodes: Vec<u64> = Vec::new();
            let mut ms: Vec<u64> = Vec::new();
            for b in boards {
                let mut s = Search::new(use_q);
                let t = Instant::now();
                let _ = s.root(b, depth);
                ms.push(t.elapsed().as_millis() as u64);
                nodes.push(s.nodes);
            }
            nodes.sort_unstable();
            ms.sort_unstable();
            println!(
                "{depth}      {:>12}  {:>9}  {:>11}  {:>9}  {:>6}  {:>8}",
                pct(&nodes, 0.5),
                pct(&nodes, 0.95),
                nodes[nodes.len() - 1],
                pct(&ms, 0.5),
                pct(&ms, 0.95),
                ms[ms.len() - 1],
            );
        }
    }

    // The queen-hang probe: at depth 3, does the chosen move lose >= 700cp of
    // material once the standing captures are played out? Crude by design —
    // it grades the *move*, not the game — and recorded as crude in the plan.
    println!("\n== depth-3 hang probe (>= 700cp capture swing after the chosen move) ==");
    for &use_q in &[false, true] {
        let mut hangs = 0;
        for b in boards {
            let before = static_value(b);
            let mut s = Search::new(use_q);
            let (_, best) = s.root(b, 3);
            let Some(mv) = best else { continue };
            let mut child = b.clone();
            child.play(mv);
            let after = -quiesce_value(&child); // back to the mover's view
            if after - before <= -700 {
                hangs += 1;
            }
        }
        println!(
            "quiescence {}: {hangs} of {} positions hang a piece-or-more",
            if use_q { "ON " } else { "OFF" },
            boards.len()
        );
    }
}

// -------------------------------------------------- Phase 1: differential perft

fn cozy_moves(b: &Board) -> Vec<Move> {
    let mut moves = Vec::new();
    b.generate_moves(|pm| {
        moves.extend(pm);
        false
    });
    moves
}

fn cozy_perft(b: &Board, depth: u32) -> u64 {
    if depth == 0 {
        return 1;
    }
    let moves = cozy_moves(b);
    if depth == 1 {
        return moves.len() as u64;
    }
    moves
        .into_iter()
        .map(|mv| {
            let mut c = b.clone();
            c.play_unchecked(mv);
            cozy_perft(&c, depth - 1)
        })
        .sum()
}

/// Phase 1's risk mitigation, run once: perft(3) on 200 random-play positions,
/// chess-core vs cozy-chess. Positions travel between the engines as FEN, so a
/// disagreement can also mean a FEN chess-core rejects — reported distinctly.
fn diffperft() {
    use rand::{RngCore, SeedableRng};
    use rand_chacha::ChaCha20Rng;
    let mut rng = ChaCha20Rng::seed_from_u64(0xD1FF);
    let mut checked = 0u32;
    let mut disagreements = 0u32;
    while checked < 200 {
        let target = rng.next_u32() % 61;
        let mut b = Board::default();
        let mut ok = true;
        for _ in 0..target {
            if b.status() != GameStatus::Ongoing {
                ok = false;
                break;
            }
            let moves = cozy_moves(&b);
            let mv = moves[(rng.next_u32() as usize) % moves.len()];
            b.play(mv);
        }
        if !ok || b.status() != GameStatus::Ongoing {
            continue;
        }
        let fen = format!("{b}");
        let ours = match chess_core::Board::from_fen(&fen) {
            Ok(board) => board,
            Err(e) => {
                println!("REJECTED {fen}: {e}");
                disagreements += 1;
                checked += 1;
                continue;
            }
        };
        let mine = chess_core::perft(&ours, 3);
        let theirs = cozy_perft(&b, 3);
        if mine != theirs {
            println!("DISAGREE {fen}: chess-core {mine}, cozy {theirs}");
            disagreements += 1;
        }
        checked += 1;
    }
    println!("{checked} positions, {disagreements} disagreements");
    if disagreements > 0 {
        std::process::exit(1);
    }
}

// --------------------------------------------------------------- D4: fixtures

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Expect {
    Live,
    Draw,
    Won,
}

/// The core-to-be's terminal semantics: mate/stalemate/50-move from cozy-chess
/// (whose `status()` already gives checkmate precedence over the clock), plus
/// automatic threefold counted over `same_position` — the FIDE 9.2 definition,
/// castling rights and en-passant possibility included.
fn verdict(board: &Board, history: &[Board]) -> Expect {
    match board.status() {
        GameStatus::Won => Expect::Won,
        GameStatus::Drawn => Expect::Draw,
        GameStatus::Ongoing => {
            let occurrences = history
                .iter()
                .filter(|b| b.same_position(board))
                .count();
            if occurrences >= 3 {
                Expect::Draw
            } else {
                Expect::Live
            }
        }
    }
}

struct Fixture {
    name: &'static str,
    fen: &'static str,
    moves: &'static str,
    /// (ply, expected verdict AFTER that ply's move)
    expects: &'static [(usize, Expect)],
    /// (ply, expected halfmove clock AFTER that ply's move)
    clocks: &'static [(usize, u8)],
}

const FIXTURES: &[Fixture] = &[
    Fixture {
        name: "(a) threefold: live at ply 7, draw at exactly ply 8",
        fen: "k7/8/8/8/8/8/8/K6R w - - 0 1",
        moves: "h1h2 a8a7 h2h1 a7a8 h1h2 a8a7 h2h1 a7a8",
        expects: &[(4, Expect::Live), (7, Expect::Live), (8, Expect::Draw)],
        clocks: &[],
    },
    Fixture {
        // The visual repetition of the start at ply 8 does not count (rights
        // differ, 9.2.3.2). The draw then lands at ply 10 — the position after
        // ply 2 is the EARLIEST-SEEN member of the 4-ply cycle, so it is the
        // first to occur three times (plies 2, 6, 10). A lesson for Phase 2's
        // tests: in a shuffle, the earliest-seen position draws first.
        name: "(a') lost castling right: the ply-8 visual repetition does not count; draw at ply 10",
        fen: "r3k3/8/8/8/8/8/8/4K2R w Kq - 0 1",
        moves: "h1h2 e8d8 h2h1 d8e8 h1h2 e8d8 h2h1 d8e8 h1h2 e8d8",
        expects: &[(8, Expect::Live), (9, Expect::Live), (10, Expect::Draw)],
        clocks: &[],
    },
    Fixture {
        // The ply-1 occurrence (ep capturable) does not count (9.2.3.1), so
        // the board B seen at plies 1/5/9 is NOT a third occurrence at ply 9.
        // The draw lands at ply 10 via the earliest-seen cycle member (the
        // position after ply 2, recurring at plies 2, 6, 10).
        name: "(b) en-passant possibility: the ply-1 occurrence does not count; live at ply 9, draw at ply 10",
        fen: "k7/8/8/8/3p4/8/4P3/K7 w - - 0 1",
        moves: "e2e4 a8b8 a1b1 b8a8 b1a1 a8b8 a1b1 b8a8 b1a1 a8b8",
        expects: &[(9, Expect::Live), (10, Expect::Draw)],
        clocks: &[],
    },
    Fixture {
        name: "(c) 50-move: live at clock 99 (ply 9), draw at clock 100 (ply 10)",
        fen: "k7/p7/8/8/8/8/8/K6R w - - 90 60",
        moves: "h1h2 a8b8 h2h3 b8a8 h3h4 a8b8 h4h5 b8a8 h5h6 a8b8",
        expects: &[(9, Expect::Live), (10, Expect::Draw)],
        clocks: &[(9, 99), (10, 100)],
    },
    Fixture {
        name: "(c-reset-pawn) a pawn move at clock 99 resets to 0 and the game runs on",
        fen: "k7/p7/8/8/8/8/8/K6R w - - 90 60",
        moves: "h1h2 a8b8 h2h3 b8a8 h3h4 a8b8 h4h5 b8a8 h5h6 a7a6 h6h5 a8b7",
        expects: &[(10, Expect::Live), (12, Expect::Live)],
        clocks: &[(9, 99), (10, 0), (12, 2)],
    },
    Fixture {
        name: "(c-reset-capture) a capture at clock 99 resets to 0",
        fen: "k7/8/8/8/8/8/1p6/KR6 w - - 99 60",
        moves: "b1b2",
        expects: &[(1, Expect::Live)],
        clocks: &[(1, 0)],
    },
    Fixture {
        name: "(d) checkmate on the move that reaches clock 100 is a WIN, not a draw",
        fen: "7k/8/6K1/8/8/8/8/R7 w - - 99 60",
        moves: "a1a8",
        expects: &[(1, Expect::Won)],
        clocks: &[],
    },
];

fn fixtures() {
    let mut failed = 0;
    for f in FIXTURES {
        let mut board: Board = f.fen.parse().expect("fixture FEN parses");
        let mut history = vec![board.clone()];
        let mut results: Vec<(usize, Expect, u8)> = Vec::new();
        for (i, mv) in f.moves.split_whitespace().enumerate() {
            let ply = i + 1;
            let mv: Move = mv.parse().expect("fixture move parses");
            if let Err(e) = board.try_play(mv) {
                println!("FAIL {} — ply {ply} {mv} illegal: {e}", f.name);
                failed += 1;
                results.clear();
                break;
            }
            history.push(board.clone());
            results.push((ply, verdict(&board, &history), board.halfmove_clock()));
        }
        let mut ok = true;
        for &(ply, want) in f.expects {
            match results.iter().find(|r| r.0 == ply) {
                Some(&(_, got, _)) if got == want => {}
                Some(&(_, got, _)) => {
                    println!("FAIL {} — ply {ply}: expected {want:?}, got {got:?}", f.name);
                    ok = false;
                }
                None => {
                    println!("FAIL {} — ply {ply} was never reached", f.name);
                    ok = false;
                }
            }
        }
        for &(ply, want) in f.clocks {
            match results.iter().find(|r| r.0 == ply) {
                Some(&(_, _, clock)) if clock == want => {}
                Some(&(_, _, clock)) => {
                    println!("FAIL {} — ply {ply}: expected clock {want}, got {clock}", f.name);
                    ok = false;
                }
                None => {
                    println!("FAIL {} — ply {ply} was never reached (clock)", f.name);
                    ok = false;
                }
            }
        }
        // Every ply before the first expected terminal must be live.
        let first_terminal = f
            .expects
            .iter()
            .filter(|(_, e)| *e != Expect::Live)
            .map(|&(p, _)| p)
            .min()
            .unwrap_or(usize::MAX);
        for &(ply, got, _) in &results {
            if ply < first_terminal && got != Expect::Live {
                println!("FAIL {} — ply {ply} terminal ({got:?}) before ply {first_terminal}", f.name);
                ok = false;
            }
        }
        if ok && !results.is_empty() {
            println!("PASS {}", f.name);
        } else if !results.is_empty() {
            failed += 1;
        }
    }
    if failed > 0 {
        println!("\n{failed} fixture(s) FAILED");
        std::process::exit(1);
    }
    println!("\nall fixtures pass");
}
