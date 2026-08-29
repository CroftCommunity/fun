//! The golden scenarios, as library code.
//!
//! They live here rather than in `tests/` because **three consumers need the
//! same run**: the crate's own vector test, the `xbuild` cross-build check
//! (which must replay them inside `wasm32` and cannot call test code), and any
//! future harness. A scenario defined in a test is a scenario the cross-build
//! check cannot see, and Phase 2's audit already showed what happens when one
//! harness cannot run what another asserts.
//!
//! The expected hashes are **not** here. They live in `vectors/*.json` beside
//! the crate, so the data and the code that produces it stay separable and a
//! re-lock is visible in a diff as data rather than as a changed constant.

use crate::game::{Game, Move, COOLDOWN_TICKS};
use crate::ladder::RADII;

/// How many golden scenarios there are.
pub const COUNT: usize = 5;

/// The scenario names, in index order. `xbuild` addresses them by index.
pub const NAMES: [&str; COUNT] = [
    "01-fresh",
    "02-one-drop",
    "03-short-run",
    "04-merges",
    "05-to-game-over",
];

/// Play a scripted run: `drops` drops walking across the crate, then settle.
fn scripted(seed: u64, drops: u32, settle: u32) -> Game {
    let mut g = Game::new(seed);
    let mut t = 0;
    for i in 0..drops {
        let _ = g.apply(Move::Drop {
            tick: t,
            x: 60 + 40 * (i as i32 % 8),
        });
        t += COOLDOWN_TICKS;
    }
    let _ = g.apply(Move::Wait { tick: t + settle });
    g
}

/// Play down one column until the crate overflows.
fn to_game_over(seed: u64) -> Game {
    let mut g = Game::new(seed);
    let mut t = 0;
    for _ in 0..400 {
        if g.is_over() {
            break;
        }
        let _ = g.apply(Move::Drop { tick: t, x: 220 });
        let _ = g.apply(Move::Wait {
            tick: t + COOLDOWN_TICKS,
        });
        t += COOLDOWN_TICKS;
    }
    g
}

/// Build scenario `index`, or `None` if there is no such scenario.
///
/// Returning `Option` rather than panicking because one caller is a wasm export,
/// where a panic aborts the whole module.
#[must_use]
pub fn scenario(index: usize) -> Option<Game> {
    let _ = RADII;
    Some(match index {
        0 => Game::new(1),
        1 => scripted(1, 1, 400),
        2 => scripted(11, 8, 600),
        3 => scripted(3, 24, 900),
        4 => to_game_over(5),
        _ => return None,
    })
}

/// The `state_hash` of scenario `index`, or an empty string if there is none.
#[must_use]
pub fn scenario_hash(index: usize) -> String {
    scenario(index).map_or_else(String::new, |g| g.state_hash())
}
