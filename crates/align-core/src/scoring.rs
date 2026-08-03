//! Guideline scoring (RULES.md "Scoring"): line clears, T-spins, back-to-back,
//! combo, and perfect clear. `level` is the level **before** the clear. All
//! integer arithmetic.

use serde::{Deserialize, Serialize};

/// The T-spin classification of a locking move.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum TSpin {
    /// Not a T-spin.
    None,
    /// A mini T-spin (3 corners, but not both front corners).
    Mini,
    /// A full T-spin (both front corners + ≥1 back, or a kick-5 upgrade).
    Full,
}

/// The named clear, for the HUD callout and per-run stats.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum ClearLabel {
    /// No lines and no T-spin — nothing scored beyond drops.
    Nothing,
    /// 1 line.
    Single,
    /// 2 lines.
    Double,
    /// 3 lines.
    Triple,
    /// 4 lines — the branded **Align**.
    Align,
    /// A T-spin with no lines.
    TSpin,
    /// A mini T-spin with no lines.
    TSpinMini,
    /// A T-spin single.
    TSpinSingle,
    /// A T-spin double.
    TSpinDouble,
    /// A T-spin triple.
    TSpinTriple,
    /// A mini T-spin single.
    TSpinMiniSingle,
    /// A mini T-spin double.
    TSpinMiniDouble,
}

impl ClearLabel {
    /// A short display string for the callout (no trademarked terms).
    #[must_use]
    pub fn text(self) -> &'static str {
        match self {
            ClearLabel::Nothing => "",
            ClearLabel::Single => "Single",
            ClearLabel::Double => "Double",
            ClearLabel::Triple => "Triple",
            ClearLabel::Align => "Align",
            ClearLabel::TSpin => "T-Spin",
            ClearLabel::TSpinMini => "Mini T-Spin",
            ClearLabel::TSpinSingle => "T-Spin Single",
            ClearLabel::TSpinDouble => "T-Spin Double",
            ClearLabel::TSpinTriple => "T-Spin Triple",
            ClearLabel::TSpinMiniSingle => "Mini T-Spin Single",
            ClearLabel::TSpinMiniDouble => "Mini T-Spin Double",
        }
    }
}

/// Classify a lock into its named clear from the lines cleared and T-spin type.
#[must_use]
pub fn label(lines: usize, tspin: TSpin) -> ClearLabel {
    match (tspin, lines) {
        (TSpin::None, 0) => ClearLabel::Nothing,
        (TSpin::None, 1) => ClearLabel::Single,
        (TSpin::None, 2) => ClearLabel::Double,
        (TSpin::None, 3) => ClearLabel::Triple,
        (TSpin::None, _) => ClearLabel::Align,
        (TSpin::Full, 0) => ClearLabel::TSpin,
        (TSpin::Full, 1) => ClearLabel::TSpinSingle,
        (TSpin::Full, 2) => ClearLabel::TSpinDouble,
        (TSpin::Full, _) => ClearLabel::TSpinTriple,
        (TSpin::Mini, 0) => ClearLabel::TSpinMini,
        (TSpin::Mini, 1) => ClearLabel::TSpinMiniSingle,
        (TSpin::Mini, _) => ClearLabel::TSpinMiniDouble,
    }
}

/// The base action points (before the ×1.5 back-to-back multiplier), for a clear
/// at `level`.
#[must_use]
pub fn base_points(label: ClearLabel, level: u64) -> u64 {
    let per = match label {
        ClearLabel::Nothing => 0,
        ClearLabel::Single => 100,
        ClearLabel::Double => 300,
        ClearLabel::Triple => 500,
        ClearLabel::Align => 800,
        ClearLabel::TSpinMini => 100,
        ClearLabel::TSpin => 400,
        ClearLabel::TSpinMiniSingle => 200,
        ClearLabel::TSpinSingle => 800,
        ClearLabel::TSpinMiniDouble => 400,
        ClearLabel::TSpinDouble => 1200,
        ClearLabel::TSpinTriple => 1600,
    };
    per * level
}

/// Whether a clear is "difficult" (drives back-to-back): an Align or any
/// line-clearing T-spin. No-line T-spins are **not** difficult but do not break
/// the chain (handled by the caller).
#[must_use]
pub fn is_difficult(label: ClearLabel) -> bool {
    matches!(
        label,
        ClearLabel::Align
            | ClearLabel::TSpinSingle
            | ClearLabel::TSpinDouble
            | ClearLabel::TSpinTriple
            | ClearLabel::TSpinMiniSingle
            | ClearLabel::TSpinMiniDouble
    )
}

/// Whether a clear removed at least one line (advances / breaks combo, and
/// whether a plain clear breaks back-to-back).
#[must_use]
pub fn clears_lines(label: ClearLabel) -> bool {
    !matches!(
        label,
        ClearLabel::Nothing | ClearLabel::TSpin | ClearLabel::TSpinMini
    )
}

/// The combo bonus for a placement that continued a combo. `combo` is the combo
/// count (0 for the first clear in a chain, then 1, 2, …).
#[must_use]
pub fn combo_points(combo: u64, level: u64) -> u64 {
    50 * combo * level
}

/// The perfect-clear bonus added when the board is empty after a clear. `b2b`
/// indicates the clear was itself a back-to-back Align perfect clear.
#[must_use]
pub fn perfect_clear_bonus(lines: usize, b2b_align: bool, level: u64) -> u64 {
    let per = match lines {
        1 => 800,
        2 => 1200,
        3 => 1800,
        _ if b2b_align => 3200,
        _ => 2000,
    };
    per * level
}
