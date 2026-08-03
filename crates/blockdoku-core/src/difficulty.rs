//! Difficulty presets and pool resolution — ported from the original
//! `difficulty-manager.js` (§ RULES).
//!
//! Each preset filters the dealable pool by an **allowed-shape list** and a
//! **bounding-box size range**, and sets the score [`Multiplier`], the hints
//! default, and (expert) a move limit. Faithful to `generateRandomBlocks`: an
//! allowed-list filters **standard and wild** shapes; **magic is always kept**
//! (only size-filtered).

use serde::{Deserialize, Serialize};

use crate::scoring::Multiplier;
use crate::shapes::{catalog, ShapeDef, Tier};

/// The four difficulty presets.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum Difficulty {
    /// Larger blocks, hints on, 1.5× score.
    Easy,
    /// All shapes, 1.0× score.
    Normal,
    /// Smaller blocks, restricted list, 0.8× score.
    Hard,
    /// All shapes, 0.5× score, 50-move limit.
    Expert,
}

/// The allowed-shape rule for a preset.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Allowed {
    /// Every shape (subject only to the size range).
    All,
    /// Only these standard/wild keys (magic is always kept).
    List(&'static [&'static str]),
}

impl Difficulty {
    /// The score multiplier.
    #[must_use]
    pub fn multiplier(self) -> Multiplier {
        match self {
            Self::Easy => Multiplier::EASY,
            Self::Normal => Multiplier::NORMAL,
            Self::Hard => Multiplier::HARD,
            Self::Expert => Multiplier::EXPERT,
        }
    }

    /// The bounding-box size range `[min, max]` a shape's `max_dimension` must lie
    /// within to be dealable.
    #[must_use]
    pub fn size_range(self) -> (usize, usize) {
        match self {
            Self::Easy => (2, 4),
            Self::Normal => (1, 5),
            Self::Hard => (1, 3),
            Self::Expert => (1, 4),
        }
    }

    /// The allowed-shape rule.
    ///
    /// Note easy's list names `square3x3`, which does **not** exist in the catalog
    /// (a latent bug in the original). [`Difficulty::resolve_pool`] drops unknown
    /// keys silently (see the plan's Decisions Log).
    #[must_use]
    pub fn allowed(self) -> Allowed {
        match self {
            Self::Easy => Allowed::List(&["square2x2", "square3x3", "l2x2", "line2", "line3"]),
            Self::Hard => Allowed::List(&["single", "line2", "line3", "l2x2", "t3x2", "z3x2"]),
            Self::Normal | Self::Expert => Allowed::All,
        }
    }

    /// Whether hints default on for this preset.
    #[must_use]
    pub fn hints_default(self) -> bool {
        matches!(self, Self::Easy)
    }

    /// The move limit, if any (expert = 50).
    #[must_use]
    pub fn move_limit(self) -> Option<u32> {
        match self {
            Self::Expert => Some(50),
            _ => None,
        }
    }

    /// Resolve the dealable pools for this preset: `(standard, wild, magic)` key
    /// lists, each filtered by the allowed-list (standard + wild only) and the
    /// size range (all three). Unknown allowed-list keys are dropped silently.
    #[must_use]
    pub fn resolve_pool(self) -> (Vec<&'static str>, Vec<&'static str>, Vec<&'static str>) {
        let (min, max) = self.size_range();
        let in_size = |s: &ShapeDef| s.max_dimension() >= min && s.max_dimension() <= max;
        let in_allowed = |key: &str| match self.allowed() {
            Allowed::All => true,
            Allowed::List(list) => list.contains(&key),
        };

        let mut standard = Vec::new();
        let mut wild = Vec::new();
        let mut magic = Vec::new();
        for s in catalog() {
            match s.tier {
                Tier::Standard if in_allowed(s.key) && in_size(s) => standard.push(s.key),
                Tier::Wild if in_allowed(s.key) && in_size(s) => wild.push(s.key),
                Tier::Magic if in_size(s) => magic.push(s.key), // magic always kept
                _ => {}
            }
        }
        (standard, wild, magic)
    }
}
