//! Where a deal comes from: the level ladder and the daily key. Pure functions
//! of the level number / date, so everyone gets the same board.

use crate::game::Origin;
use crate::layout::LayoutId;
use crate::rng::hash_str;

/// The layout for campaign level `n` (`1..`): three Ponds, five Bridges, seven
/// Fortresses, ten Steps, five Turtles, then the five layouts in a cycle.
#[must_use]
pub fn level_layout(n: u32) -> LayoutId {
    match n {
        0..=3 => LayoutId::Pond,
        4..=8 => LayoutId::Bridge,
        9..=15 => LayoutId::Fortress,
        16..=25 => LayoutId::Steps,
        26..=30 => LayoutId::Turtle,
        _ => LayoutId::ALL[((n - 31) % 5) as usize],
    }
}

/// The deal for campaign level `n`.
#[must_use]
pub fn level_origin(n: u32) -> Origin {
    Origin {
        layout: level_layout(n),
        seed: hash_str(&format!("mahjong-level-{n}")),
    }
}

/// The daily seed for an ISO `YYYY-MM-DD` date; the daily is always the Turtle.
#[must_use]
pub fn daily_seed(date_key: &str) -> u32 {
    hash_str(&format!("mahjong-daily-{date_key}"))
}

/// The daily deal for a date key.
#[must_use]
pub fn daily_origin(date_key: &str) -> Origin {
    Origin {
        layout: LayoutId::Turtle,
        seed: daily_seed(date_key),
    }
}
