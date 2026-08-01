//! A Drop 4 AI-player trial: play test games between pluggable players and
//! score how well side A plays against the exact solver oracle.
//!
//! Run: `cargo run -p drop4-harness --example trial --release`
//!
//! This is the deterministic (classic-players) trial. The LLM player + WebGPU
//! runtime trial lives in the TS harness and needs a browser.

use drop4_harness::{run_trial, Player};

fn main() {
    let games = 40;
    println!("Drop 4 — AI-player trial  ({games} games/matchup, exact-oracle scoring)");
    println!("Move quality is graded against the perfect solver on endgame");
    println!("positions (early positions are skipped — the expensive solve tail).\n");

    let matchups = [
        (Player::Greedy, Player::Random),
        (Player::Random, Player::Greedy),
        (Player::Random, Player::Random),
    ];
    for (a, b) in matchups {
        let report = run_trial(&a, &b, games, 20260731);
        println!("{}\n", report.render());
    }
}
