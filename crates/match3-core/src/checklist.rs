//! Track D — the mixed/order **Checklist** objective (RULES.md T6).
//!
//! Unlike blockers/jelly/ingredients (whose win is a function of the *current*
//! board), a checklist is met by what has happened **across the run**: it is a
//! small heterogeneous list of goals — clear `N` gems of a target colour, make
//! `S` striped candies, make `W` wrapped candies — ticked off as play produces
//! them. So the win is **path-accumulated**: a [`ChecklistProgress`] accumulator
//! folds each move's [`MoveReport`] (via the neutral per-step signals
//! `gems_cleared_by_color` / `striped_created` / `wrapped_created`), and the
//! objective is met once every target is reached ([`ChecklistProgress::met`]).
//!
//! The target list is a deterministic **template** of the seed: the target colour
//! is drawn from a seed-derived stream and the counts are fixed (tunable) knobs,
//! so play-time, the solver, and outcome replay agree bit-for-bit. Winnability is
//! guaranteed by the solver pack (only seeds it completes in budget are kept),
//! exactly like the other winnable-daily modes.

use crate::engine::MoveReport;
use crate::rng::DetRng;

/// A distinct RNG-stream tag so the target-colour draw does not collide with the
/// game/jelly streams (mirrors `deal_jelly`'s tag).
const TARGET_TAG: u64 = 0x0063_686b_6c73; // "chkls"

/// Gems of the target colour to clear (tunable knob; the solver keeps only
/// winnable seeds).
pub const COLOR_TARGET: u32 = 12;
/// Striped candies to make (tunable knob).
pub const STRIPED_TARGET: u32 = 2;
/// Wrapped candies to make (tunable knob).
pub const WRAPPED_TARGET: u32 = 1;

/// One seed's checklist goals: a target colour + the three counts. A pure,
/// deterministic function of the seed (see [`checklist_targets`]).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ChecklistTargets {
    /// The colour whose gems must be cleared (`0..colors`).
    pub color: u8,
    /// How many gems of `color` to clear.
    pub color_count: u32,
    /// How many striped candies to make.
    pub striped: u32,
    /// How many wrapped candies to make.
    pub wrapped: u32,
}

/// The checklist goals for `seed`: the target colour is drawn from a seed-derived
/// stream (so it varies by day but is fixed per seed) and the counts are the
/// tunable knobs. Deterministic — the binding, solver, and replay all call this.
#[must_use]
pub fn checklist_targets(seed: u64, colors: usize) -> ChecklistTargets {
    let mut rng = DetRng::from_seed(seed ^ TARGET_TAG);
    let color = u8::try_from(rng.index(colors)).unwrap_or(0);
    ChecklistTargets {
        color,
        color_count: COLOR_TARGET,
        striped: STRIPED_TARGET,
        wrapped: WRAPPED_TARGET,
    }
}

/// Running progress toward a [`ChecklistTargets`], accumulated across a run's
/// moves. Monotone non-decreasing (goals only ever advance).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ChecklistProgress {
    /// Gems of the target colour cleared so far.
    pub color_cleared: u32,
    /// Striped candies made so far.
    pub striped_made: u32,
    /// Wrapped candies made so far.
    pub wrapped_made: u32,
}

impl ChecklistProgress {
    /// Fold one move's [`MoveReport`] into the running progress: sum, over every
    /// cascade step, the target-colour gems cleared and the striped/wrapped made.
    pub fn apply(&mut self, report: &MoveReport, target_color: u8) {
        let ti = target_color as usize;
        for step in &report.steps {
            self.color_cleared += step.gems_cleared_by_color.get(ti).copied().unwrap_or(0);
            self.striped_made += step.striped_created;
            self.wrapped_made += step.wrapped_created;
        }
    }

    /// Whether every goal has been reached.
    #[must_use]
    pub fn met(&self, targets: &ChecklistTargets) -> bool {
        self.color_cleared >= targets.color_count
            && self.striped_made >= targets.striped
            && self.wrapped_made >= targets.wrapped
    }
}
