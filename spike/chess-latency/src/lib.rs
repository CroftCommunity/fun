//! The measurement surface: the 50 D2 positions (captured as FENs from the
//! Phase 0 spike) searched through the real chess-solver. The host times the
//! calls; this module only counts nodes.

use chess_core::{Board, Position};
use chess_solver::search::{move_scores_with, search_root, Table};
use chess_solver::NodeBudget;

fn positions() -> &'static Vec<Position> {
    use std::sync::OnceLock;
    static POSITIONS: OnceLock<Vec<Position>> = OnceLock::new();
    POSITIONS.get_or_init(|| {
        include_str!("../positions.txt")
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|fen| {
                Position::from_board(Board::from_fen(fen.trim()).expect("spike FEN parses"))
            })
            .collect()
    })
}

/// Number of measurement positions.
#[no_mangle]
pub extern "C" fn pos_count() -> u32 {
    positions().len() as u32
}

/// One deepening search to `max_depth` under `node_cap` (0 = unlimited);
/// returns nodes consumed. The host times the call.
#[no_mangle]
pub extern "C" fn run_deepened(pos: u32, max_depth: u32, cap_lo: u32, cap_hi: u32) -> u64 {
    let cap = (u64::from(cap_hi) << 32) | u64::from(cap_lo);
    let cap = if cap == 0 { u64::MAX } else { cap };
    let report = search_root(&positions()[pos as usize], max_depth, cap);
    report.nodes
}

/// One fixed-depth search (no deepening), unlimited budget; returns nodes.
#[no_mangle]
pub extern "C" fn run_fixed(pos: u32, depth: u32) -> u64 {
    let mut tt = Table::new();
    let mut budget = NodeBudget::unlimited();
    let _ = move_scores_with(&positions()[pos as usize], depth, &mut tt, &mut budget);
    tt.nodes()
}
