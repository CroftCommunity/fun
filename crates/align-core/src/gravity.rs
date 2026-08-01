//! The gravity speed curve as an **integer** ticks-per-row table (RULES.md
//! "Gravity"). The guideline "Worlds" formula
//! `secondsPerRow = (0.8 − (level−1)·0.007)^(level−1)` is a float; we bake it into
//! whole ticks at 60 ticks/second so **no float ever runs on the hashed path**.
//! Levels 1..=15 (Marathon's cap); higher levels clamp to level 15's value.

/// Ticks the simulation runs per second — the fixed timestep.
pub const TICKS_PER_SECOND: u32 = 60;

/// Lock-delay duration in ticks (~0.5 s).
pub const LOCK_DELAY_TICKS: u32 = 30;

/// Maximum lock-delay resets (move-reset cap) before the piece locks regardless.
pub const MAX_LOCK_RESETS: u32 = 15;

/// `TICKS_PER_ROW[level-1]` — whole ticks the active piece waits before gravity
/// drops it one row, for levels 1..=15. Derived from the guideline formula
/// (`round(secondsPerRow · 60)`, floored to a minimum of 1 tick = 1G).
const TICKS_PER_ROW: [u32; 15] = [
    60, // L1  1.000 s
    48, // L2  0.793 s
    37, // L3  0.618 s
    28, // L4  0.473 s
    21, // L5  0.355 s
    16, // L6  0.262 s
    11, // L7  0.190 s
    8,  // L8  0.135 s
    6,  // L9  0.095 s
    4,  // L10 0.066 s
    3,  // L11 0.045 s
    2,  // L12 0.030 s
    1,  // L13 0.020 s → floored to 1 tick
    1,  // L14
    1,  // L15
];

/// Ticks per gravity row-drop at `level` (clamped to `1..=15`).
#[must_use]
pub fn ticks_per_row(level: u32) -> u32 {
    let idx = level.clamp(1, 15) as usize - 1;
    TICKS_PER_ROW[idx]
}
