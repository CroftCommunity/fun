//! A live Loose Ends game and its verifiable-outcome binding.
//!
//! The runtime [`Game`] holds one board and the ordered ids of released arrows
//! (the move list). [`LooseEnds`] implements [`pond_outcome::Game`]: replay a
//! `(packed_seed, moves)` pair — the packed seed re-derives the exact board's
//! [`Origin`], so the board regenerates from it alone — and re-derives the final
//! [`state_hash`] and whether the board cleared. A clean solve is `Won` with no
//! declared assistance; mistakes and hints are UI-side (not part of the move
//! list), graded for display by [`crate::score`].

use crate::board::{Board, ReleaseError};
use crate::config::{daily_config, level_config};
use crate::generate::generate;
use crate::hash::state_hash;

/// What a tap on an arrow did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tap {
    /// The arrow was FREE and slid off — the board changed.
    Released,
    /// The arrow was BLOCKED — no change (the UI charges a droplet).
    Blocked,
    /// The arrow's ray is clear but its key (the id carried) is still on the
    /// board — no change, no droplet: the UI flashes the key.
    Locked(u32),
    /// The arrow was already gone (or unknown) — no change.
    Gone,
}

/// Where a board came from — the compact identity a record carries so replay
/// regenerates the exact board. Packs into a small, JS-safe `u64` (≤ 2^33):
/// a mode bit plus either the level number or the daily seed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// Campaign level `n` (`1..=100`).
    Level(u32),
    /// A daily board keyed by its FNV daily seed.
    Daily(u32),
}

impl Origin {
    /// Pack into a `u64`: bit 0 is the mode (0 level / 1 daily), the rest the id.
    /// The largest value is a daily seed `< 2^32` shifted up by one (`< 2^33`),
    /// so the record's numeric seed stays an exact JS integer.
    #[must_use]
    pub fn to_packed(self) -> u64 {
        match self {
            Origin::Level(n) => u64::from(n) << 1,
            Origin::Daily(seed) => (u64::from(seed) << 1) | 1,
        }
    }

    /// Recover an origin from [`Origin::to_packed`].
    #[must_use]
    pub fn from_packed(packed: u64) -> Self {
        let id = (packed >> 1) as u32;
        if packed & 1 == 0 {
            Origin::Level(id)
        } else {
            Origin::Daily(id)
        }
    }

    /// Generate this origin's board.
    #[must_use]
    pub fn board(self) -> Board {
        match self {
            Origin::Level(n) => generate(&level_config(n)),
            Origin::Daily(seed) => generate(&daily_config(seed)),
        }
    }
}

/// A live game: one board plus the ordered ids of released arrows.
#[derive(Debug, Clone)]
pub struct Game {
    origin: Origin,
    board: Board,
    released: Vec<u32>,
}

impl Game {
    /// Start a fresh game for a given board origin.
    #[must_use]
    pub fn from_origin(origin: Origin) -> Self {
        Self {
            board: origin.board(),
            origin,
            released: Vec::new(),
        }
    }

    /// A game over a hand-built board (tests): the origin is what a record
    /// would carry; the board is whatever the test laid out.
    #[cfg(test)]
    pub(crate) fn with_board(origin: Origin, board: Board) -> Self {
        Self {
            origin,
            board,
            released: Vec::new(),
        }
    }

    /// Rebuild a game from a packed origin (used by replay / verification).
    #[must_use]
    pub fn from_packed(packed: u64) -> Self {
        Self::from_origin(Origin::from_packed(packed))
    }

    /// Start campaign level `n` (`1..=100`).
    #[must_use]
    pub fn level(n: u32) -> Self {
        Self::from_origin(Origin::Level(n))
    }

    /// Start the daily board for a precomputed daily `seed`.
    #[must_use]
    pub fn daily(seed: u32) -> Self {
        Self::from_origin(Origin::Daily(seed))
    }

    /// The board (for rendering).
    #[must_use]
    pub fn board(&self) -> &Board {
        &self.board
    }

    /// Tap arrow `id`: release it if FREE, else report BLOCKED / LOCKED / GONE
    /// with no change. A successful release is appended to the move list.
    pub fn tap(&mut self, id: u32) -> Tap {
        let idx = id as usize;
        if !self.board.is_present(idx) {
            return Tap::Gone;
        }
        match self.board.release(idx) {
            Ok(()) => {
                self.released.push(id);
                Tap::Released
            }
            Err(ReleaseError::Locked(key)) => Tap::Locked(key as u32),
            Err(_) => Tap::Blocked,
        }
    }

    /// A currently-FREE arrow id to highlight as a hint, if any (the lowest id).
    #[must_use]
    pub fn hint(&self) -> Option<u32> {
        self.board.free_arrows().first().map(|&id| id as u32)
    }

    /// The ordered ids of released arrows (the move list).
    #[must_use]
    pub fn moves(&self) -> &[u32] {
        &self.released
    }

    /// The board's canonical state hash.
    #[must_use]
    pub fn current_hash(&self) -> String {
        state_hash(&self.board)
    }

    /// Whether every arrow has been cleared.
    #[must_use]
    pub fn is_won(&self) -> bool {
        self.board.is_cleared()
    }

    /// The packed origin a record carries — replay regenerates the exact board
    /// from it (see [`Origin::to_packed`]).
    #[must_use]
    pub fn packed_seed(&self) -> u64 {
        self.origin.to_packed()
    }
}

/// The verifiable-outcome binding for Loose Ends.
pub struct LooseEnds;

impl pond_outcome::Game for LooseEnds {
    type Move = u32;
    const KIND: &'static str = "looseends";
    const VERSION: u32 = 1;

    fn replay(packed_seed: u64, moves: &[u32]) -> pond_outcome::Replayed {
        let mut board = Origin::from_packed(packed_seed).board();
        for &id in moves {
            // A tampered move (blocked, out of range, or replayed after the
            // board cleared) is a no-op, so the hash diverges from an honest run
            // and verification fails.
            let _ = board.release(id as usize);
        }
        pond_outcome::Replayed::new(state_hash(&board), board.is_cleared())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pond_outcome::{attest, verify, Game as _, Outcome};

    #[test]
    fn tap_releases_free_blocks_bound_and_reports_gone() {
        let mut g = Game::level(1);
        // Level 1 has three arrows; at least one is FREE at the start.
        let free = g.board().free_arrows();
        assert!(!free.is_empty(), "a fresh board has a free arrow");
        let id = free[0] as u32;
        assert_eq!(g.tap(id), Tap::Released);
        assert_eq!(g.tap(id), Tap::Gone, "re-tapping a gone arrow does nothing");
        assert_eq!(g.moves(), &[id]);
    }

    #[test]
    fn a_tap_on_a_locked_arrow_names_its_key_and_changes_nothing() {
        use crate::board::{Arrow, Board};
        let arrow = |cells: &[[i32; 2]], dir: [i32; 2]| Arrow {
            cells: cells.to_vec(),
            dir,
        };
        // The key is id 0 and the lock id 1, so the hint (the lowest FREE id)
        // is the key only because the lock is not free.
        let k = arrow(&[[0, 1], [1, 1]], [1, 0]);
        let a = arrow(&[[0, 0], [1, 0]], [1, 0]);
        let board = Board::with_locks(5, 2, vec![k, a], vec![(1, 0)]);
        let mut g = Game::with_board(Origin::Level(1), board);
        assert!(!g.is_won(), "two arrows on the board");
        assert_eq!(
            g.tap(1),
            Tap::Locked(0),
            "the key is named so the UI can flash it"
        );
        assert_eq!(g.moves(), &[] as &[u32], "a locked tap is not a move");
        assert_eq!(g.hint(), Some(0), "the hint is the key, never the lock");
        assert_eq!(g.tap(0), Tap::Released);
        assert!(!g.is_won(), "the lock is still on the board");
        assert_eq!(
            g.hint(),
            Some(1),
            "with the key gone the hint moves to the freed lock"
        );
        assert_eq!(g.tap(1), Tap::Released, "unlocked with its key gone");
        assert!(g.is_won());
    }

    #[test]
    fn a_full_greedy_solve_wins_and_verifies() {
        let mut g = Game::level(3);
        // Play the greedy release order through the live tap API.
        loop {
            let free = g.board().free_arrows();
            if free.is_empty() {
                break;
            }
            for id in free {
                assert_eq!(g.tap(id as u32), Tap::Released);
            }
        }
        assert!(g.is_won(), "the board clears");

        let record = attest::<LooseEnds>(
            g.packed_seed(),
            g.moves().to_vec(),
            Outcome::Abandoned,
            Some(false),
        );
        assert_eq!(record.result, Outcome::Won);
        assert!(verify::<LooseEnds>(&record).ok, "an honest clear verifies");

        // Tampering with the move list breaks verification.
        let mut bad = record.clone();
        bad.moves.reverse();
        // A reversed order likely tries to release a blocked arrow first (no-op),
        // so the replayed board does not clear and the hash diverges.
        let v = verify::<LooseEnds>(&bad);
        assert!(
            !v.ok || bad.moves == record.moves,
            "a tampered order fails to verify"
        );
    }

    #[test]
    fn origin_packing_round_trips_and_stays_js_safe() {
        for o in [
            Origin::Level(1),
            Origin::Level(100),
            Origin::Daily(2_028_026_207),
            Origin::Daily(u32::MAX),
        ] {
            let packed = o.to_packed();
            assert_eq!(Origin::from_packed(packed), o, "{o:?} round-trips");
            assert!(
                packed < (1u64 << 33),
                "{o:?} packs under 2^33 (an exact JS integer)"
            );
        }
        assert_eq!(
            Origin::Level(1).to_packed(),
            2,
            "a level is its number shifted up one"
        );
        assert_eq!(
            Origin::Daily(1).to_packed(),
            3,
            "a daily: seed shifted up one, mode bit set"
        );
    }

    #[test]
    fn replay_is_self_contained_from_the_packed_seed() {
        let g = Game::level(50);
        // Regenerating from just the packed seed reproduces the same board.
        let a = LooseEnds::replay(g.packed_seed(), &[]);
        assert_eq!(a.final_hash, g.current_hash());
        assert!(!a.won);
    }
}
