//! The sort-puzzle state — a fixed-order array of tubes, each a colour-id stack.
//!
//! A tube is a stack of colour ids (`0..colors`), index `0` = bottom. Capacity
//! `cap` is `4` in every mode. `colors` (= the number of initially-full tubes,
//! each colour appearing exactly `cap` times) plus `empties` empty tubes make up
//! `colors + empties` tubes total. Tube order is fixed for the life of a level,
//! so the game/replay hash is over the tubes **in play order** (the solver dedups
//! on a sorted copy; the game does not — the arrangement is the state).

use serde::{Deserialize, Serialize};

/// Capacity of every tube (units), fixed across all modes (brief §2.1, `h`).
pub const CAP: usize = 4;

/// A sort-puzzle position: the tubes in fixed play order.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct State {
    /// Each tube bottom→top; a colour id `0..colors`. An empty tube is `[]`.
    pub tubes: Vec<Vec<u8>>,
    /// Number of distinct colours (`n`) — also the count of initially-full tubes.
    pub colors: u8,
    /// Tube capacity (`h`) — always [`CAP`], carried so the hash binds it.
    pub cap: u8,
}

impl State {
    /// Build from explicit tubes (tests, the pack, and the deal). `colors` is the
    /// distinct-colour count; `cap` is the per-tube capacity.
    #[must_use]
    pub fn from_tubes(tubes: Vec<Vec<u8>>, colors: u8, cap: u8) -> Self {
        Self { tubes, colors, cap }
    }

    /// The number of tubes (`colors + empties`).
    #[must_use]
    pub fn tube_count(&self) -> usize {
        self.tubes.len()
    }

    /// The top colour of tube `t`, or `None` if it is empty.
    #[must_use]
    pub fn top(&self, t: usize) -> Option<u8> {
        self.tubes.get(t).and_then(|tube| tube.last().copied())
    }

    /// The length of the contiguous top-colour run of tube `t` (`0` if empty).
    #[must_use]
    pub fn top_run(&self, t: usize) -> usize {
        let Some(tube) = self.tubes.get(t) else {
            return 0;
        };
        let Some(&top) = tube.last() else { return 0 };
        tube.iter().rev().take_while(|&&c| c == top).count()
    }

    /// Tube `t` holds no units.
    #[must_use]
    pub fn is_empty_tube(&self, t: usize) -> bool {
        self.tubes.get(t).is_some_and(Vec::is_empty)
    }

    /// Tube `t` is full (`cap` units).
    #[must_use]
    pub fn is_full_tube(&self, t: usize) -> bool {
        self.tubes
            .get(t)
            .is_some_and(|tube| tube.len() == self.cap as usize)
    }

    /// Tube `t` is non-empty and every unit in it is the same colour.
    #[must_use]
    pub fn is_monochrome(&self, t: usize) -> bool {
        match self.tubes.get(t) {
            Some(tube) if !tube.is_empty() => tube.iter().all(|&c| c == tube[0]),
            _ => false,
        }
    }

    /// Tube `t` is **locked**: full and monochrome (a solved column that never
    /// needs to move again — brief §1). The UI caps it and blocks selection.
    #[must_use]
    pub fn is_locked(&self, t: usize) -> bool {
        self.is_full_tube(t) && self.is_monochrome(t)
    }

    /// The win condition: every tube is empty or full-and-monochrome (brief §2.4).
    #[must_use]
    pub fn is_won(&self) -> bool {
        (0..self.tube_count()).all(|t| self.is_empty_tube(t) || self.is_locked(t))
    }

    /// A **trivial** deal — some full tube is already monochrome. Rejected during
    /// generation (brief §4) so a deal never starts partly solved.
    #[must_use]
    pub fn is_trivial_deal(&self) -> bool {
        (0..self.tube_count()).any(|t| self.is_full_tube(t) && self.is_monochrome(t))
    }
}
