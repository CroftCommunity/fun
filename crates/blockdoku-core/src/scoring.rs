//! Scoring — ported 1:1 from the original `scoring.js`, frozen (§ RULES).
//!
//! These are pure functions over the frozen constants; the game state machine
//! ([`crate::game`], B4) orchestrates the streak counter and the reference's
//! evaluation order. Change a constant only with explicit human approval —
//! score-compatibility with the original depends on them, and golden vectors lock
//! them.
//!
//! **Combo event.** A single placement is a *combo event* iff it clears **2 or
//! more** regions total (rows + columns + 3×3 boxes). The original's
//! `clearTypes.length >= 2 || totalClears >= 2` reduces to `totalClears >= 2`.
//!
//! **No floats on the hashed path.** The difficulty multiplier is an exact
//! rational ([`Multiplier`]); `floor(base × mult)` is computed as integer
//! `base × num / den`. For the four values used (3/2, 1/1, 4/5, 1/2) this equals
//! the original's `Math.floor(base × mult)` for every non-negative `base`.

/// Points per cleared row or column.
pub const LINE_POINTS: u32 = 15;
/// Points per cleared 3×3 box.
pub const SQUARE_POINTS: u32 = 20;

/// The difficulty score multiplier, as an exact fraction to keep integer math.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Multiplier {
    /// Numerator.
    pub num: u32,
    /// Denominator (never zero).
    pub den: u32,
}

impl Multiplier {
    /// easy — 1.5×.
    pub const EASY: Self = Self { num: 3, den: 2 };
    /// normal — 1.0×.
    pub const NORMAL: Self = Self { num: 1, den: 1 };
    /// hard — 0.8×.
    pub const HARD: Self = Self { num: 4, den: 5 };
    /// expert — 0.5×.
    pub const EXPERT: Self = Self { num: 1, den: 2 };

    /// `floor(base × self)`, integer-only.
    #[must_use]
    pub fn apply(self, base: u32) -> u32 {
        base * self.num / self.den
    }
}

/// The combo bonus for a placement that clears `total_clears` regions.
///
/// Per the original `calculateComboBonus`: for each cleared region `i = 2..=N`,
/// add `+10` (2nd), `+15` (3rd, 4th), `+50` (5th), `+100` (6th and beyond).
/// Returns `0` for fewer than 2 clears (not a combo event).
#[must_use]
pub fn combo_bonus(total_clears: usize) -> u32 {
    let mut bonus = 0;
    let mut i = 2;
    while i <= total_clears {
        bonus += match i {
            2 => 10,
            3 | 4 => 15,
            5 => 50,
            _ => 100,
        };
        i += 1;
    }
    bonus
}

/// The streak bonus for a consecutive-combo `streak_count`.
///
/// Per the original `calculateStreakBonus`: `< 2 → 0`; `2..=10 → streak_count *
/// 10`; `11+ → 100 + (streak_count - 10) * 100`. The caller passes the streak
/// count as it stands **before** this event's increment (the reference computes
/// the bonus in `calculateScore`, then increments `streakCount` afterward).
#[must_use]
pub fn streak_bonus(streak_count: u32) -> u32 {
    if streak_count < 2 {
        0
    } else if streak_count <= 10 {
        streak_count * 10
    } else {
        100 + (streak_count - 10) * 100
    }
}

/// A placement's score, broken down by component. Each component is floored by the
/// difficulty multiplier **independently** (matching the original's per-component
/// `Math.floor`), then summed.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct PlacementScore {
    /// The shape's own points for being placed.
    pub placement: u32,
    /// Row + column clears × [`LINE_POINTS`].
    pub line: u32,
    /// Box clears × [`SQUARE_POINTS`].
    pub square: u32,
    /// Combo bonus (combo events only).
    pub combo: u32,
    /// Streak bonus (combo events only).
    pub streak: u32,
}

impl PlacementScore {
    /// The total points added by this placement.
    #[must_use]
    pub fn total(&self) -> u32 {
        self.placement + self.line + self.square + self.combo + self.streak
    }
}

/// Compute a placement's score.
///
/// `shape_points` is the placed shape's own value; `rows`/`cols`/`boxes` are the
/// counts of regions this placement cleared; `streak_before` is the streak counter
/// **before** this event increments it. Every component is floored by `mult`
/// independently. Combo and streak bonuses apply only on a combo event
/// (`rows + cols + boxes >= 2`).
#[must_use]
pub fn score_placement(
    shape_points: u32,
    rows: usize,
    cols: usize,
    boxes: usize,
    streak_before: u32,
    mult: Multiplier,
) -> PlacementScore {
    let total_clears = rows + cols + boxes;
    let is_combo = total_clears >= 2;
    let line_base = u32::try_from(rows + cols).unwrap_or(u32::MAX) * LINE_POINTS;
    let square_base = u32::try_from(boxes).unwrap_or(u32::MAX) * SQUARE_POINTS;
    let combo_base = if is_combo {
        combo_bonus(total_clears)
    } else {
        0
    };
    let streak_base = if is_combo {
        streak_bonus(streak_before)
    } else {
        0
    };
    PlacementScore {
        placement: mult.apply(shape_points),
        line: mult.apply(line_base),
        square: mult.apply(square_base),
        combo: mult.apply(combo_base),
        streak: mult.apply(streak_base),
    }
}
