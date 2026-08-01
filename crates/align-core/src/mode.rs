//! Game modes on one engine via [`ModeConfig`] (RULES.md "Modes").
//!
//! v1 ships the two **state-terminal** modes — the run ends on a board/line
//! condition, so `replay(seed, events)` runs to that terminal with no wall-clock
//! budget. Rush (a tick budget) and Zen (endless) are follow-ups (they need the
//! stop-tick plumbed through the record; see the plan / `TODO/align.md`).

use serde::{Deserialize, Serialize};

/// Which mode a run is.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum ModeId {
    /// Level 1 → 15, 150 lines; score-focused.
    Marathon,
    /// Clear 40 lines fastest; the tick count is the metric; gravity fixed low.
    Sprint,
}

/// A mode's tunable rules.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct ModeConfig {
    /// Which mode.
    pub id: ModeId,
    /// Starting level (selectable in Marathon; `1` in Sprint).
    pub start_level: u32,
    /// Lines to finish the run (Marathon 150, Sprint 40). `is_won` when reached.
    pub goal_lines: u32,
    /// Level cap (Marathon 15); the gravity/scoring level never exceeds it.
    pub level_cap: u32,
    /// If set, the level is fixed here regardless of lines (Sprint: fixed low
    /// gravity). `None` → the fixed-goal 10-lines-per-level curve.
    pub fixed_level: Option<u32>,
    /// Bias the very first piece away from S/Z/O.
    pub first_piece_not_szo: bool,
}

impl ModeConfig {
    /// Marathon starting at `start_level` (clamped to 1..=15).
    #[must_use]
    pub fn marathon(start_level: u32) -> Self {
        Self {
            id: ModeId::Marathon,
            start_level: start_level.clamp(1, 15),
            goal_lines: 150,
            level_cap: 15,
            fixed_level: None,
            first_piece_not_szo: true,
        }
    }

    /// Sprint 40 — fixed low gravity, time (ticks) is the metric.
    #[must_use]
    pub fn sprint() -> Self {
        Self {
            id: ModeId::Sprint,
            start_level: 1,
            goal_lines: 40,
            level_cap: 15,
            fixed_level: Some(1),
            first_piece_not_szo: true,
        }
    }

    /// Construct from a numeric mode id (0 Marathon, else Sprint) + start level.
    #[must_use]
    pub fn from_ids(mode: u32, start_level: u32) -> Self {
        match mode {
            0 => Self::marathon(start_level),
            _ => Self::sprint(),
        }
    }

    /// The effective level for `lines` cleared — used for both gravity and
    /// scoring. Fixed-goal: `start + lines/10`, capped; or `fixed_level`.
    #[must_use]
    pub fn level_for(&self, lines: u32) -> u32 {
        if let Some(fixed) = self.fixed_level {
            return fixed.min(self.level_cap);
        }
        (self.start_level + lines / 10).min(self.level_cap)
    }
}
