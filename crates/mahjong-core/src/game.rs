//! A live game and its verifiable-outcome binding.
//!
//! [`Game`] holds one board, the RNG stream the deal came from (shuffles
//! continue it), the ordered [`Move`] list, and the construction line of the
//! most recent deal or shuffle. [`Mahjong`] implements [`pond_outcome::Game`]:
//! replaying `(packed origin, moves)` regenerates the exact deal, applies the
//! moves (an illegal one is a no-op, so a tampered list diverges), and
//! re-derives the hash and whether the board cleared.

use serde::{Deserialize, Serialize};

use crate::board::{Board, MoveError};
use crate::config::{daily_origin, level_origin};
use crate::generate::{deal_with, redeal, DealError};
use crate::hash::state_hash;
use crate::layout::{layout, LayoutId};
use crate::rng::Rng;

/// Where a deal came from: a layout and a 32-bit seed. Packs into a JS-safe
/// integer (`layout << 32 | seed`, below 2^40).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Origin {
    /// The layout.
    pub layout: LayoutId,
    /// The RNG seed the deal (and its shuffles) draw from.
    pub seed: u32,
}

impl Origin {
    /// Pack for a record's `seed` field.
    #[must_use]
    pub fn to_packed(self) -> u64 {
        (u64::from(self.layout as u8) << 32) | u64::from(self.seed)
    }

    /// Unpack; `None` for an unknown layout byte.
    #[must_use]
    pub fn from_packed(packed: u64) -> Option<Self> {
        let layout = LayoutId::from_u8((packed >> 32) as u8)?;
        if packed >> 40 != 0 {
            return None;
        }
        Some(Self {
            layout,
            seed: packed as u32,
        })
    }
}

/// A move: a pair of slot ids, or the shuffle. One `u32`: `a << 8 | b` with
/// `a < b` for a pair, [`SHUFFLE`] otherwise.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Move(u32);

/// The shuffle move.
pub const SHUFFLE: Move = Move(0x1_0000);

impl Move {
    /// A pair of slots, in either order.
    #[must_use]
    pub fn pair(a: usize, b: usize) -> Self {
        let (lo, hi) = (a.min(b), a.max(b));
        Move(((lo as u32) << 8) | hi as u32)
    }

    /// The slots of a pair move, or `None` for the shuffle / an invalid code.
    #[must_use]
    pub fn pair_slots(self) -> Option<(usize, usize)> {
        if self.0 >= 0x1_0000 {
            return None;
        }
        Some(((self.0 >> 8) as usize, (self.0 & 0xFF) as usize))
    }

    /// The wire code.
    #[must_use]
    pub fn to_u32(self) -> u32 {
        self.0
    }

    /// From a wire code (any value; an invalid one is refused at play time).
    #[must_use]
    pub fn from_u32(v: u32) -> Self {
        Move(v)
    }
}

/// A live game.
#[derive(Debug, Clone)]
pub struct Game {
    origin: Origin,
    board: Board,
    rng: Rng,
    moves: Vec<Move>,
    line: Vec<(usize, usize)>,
}

impl Game {
    /// Deal a fresh game.
    ///
    /// # Errors
    /// [`DealError`] if the generator gives up (pinned never to on the shipped layouts).
    pub fn new(origin: Origin) -> Result<Self, DealError> {
        let l = layout(origin.layout);
        let mut rng = Rng::new(origin.seed);
        let d = deal_with(&l, &mut rng)?;
        Ok(Self {
            origin,
            board: Board::new(l, d.faces),
            rng,
            moves: Vec::new(),
            line: d.line,
        })
    }

    /// Campaign level `n`.
    ///
    /// # Errors
    /// As [`Game::new`].
    pub fn level(n: u32) -> Result<Self, DealError> {
        Self::new(level_origin(n))
    }

    /// The daily for an ISO date key.
    ///
    /// # Errors
    /// As [`Game::new`].
    pub fn daily(date_key: &str) -> Result<Self, DealError> {
        Self::new(daily_origin(date_key))
    }

    /// Rebuild from a packed origin (replay / verification). `None` for an
    /// origin that does not decode.
    #[must_use]
    pub fn from_packed(packed: u64) -> Option<Self> {
        Origin::from_packed(packed).and_then(|o| Self::new(o).ok())
    }

    /// The origin.
    #[must_use]
    pub fn origin(&self) -> Origin {
        self.origin
    }

    /// The packed origin a record carries.
    #[must_use]
    pub fn packed_seed(&self) -> u64 {
        self.origin.to_packed()
    }

    /// The board.
    #[must_use]
    pub fn board(&self) -> &Board {
        &self.board
    }

    /// The moves so far.
    #[must_use]
    pub fn moves(&self) -> &[Move] {
        &self.moves
    }

    /// The construction line of the most recent deal or shuffle — pairs in an
    /// order that cleared the board *at that moment*. Stale once the player
    /// deviates from it; the solver answers for the live position.
    #[must_use]
    pub fn last_line(&self) -> &[(usize, usize)] {
        &self.line
    }

    /// The canonical state hash.
    #[must_use]
    pub fn current_hash(&self) -> String {
        state_hash(&self.board)
    }

    /// Whether the board is cleared.
    #[must_use]
    pub fn is_won(&self) -> bool {
        self.board.is_cleared()
    }

    /// Play a move. A pair is removed if legal; the shuffle re-deals the
    /// remaining tiles. On error nothing changes.
    ///
    /// # Errors
    /// Any [`MoveError`].
    pub fn play(&mut self, mv: Move) -> Result<(), MoveError> {
        match mv.pair_slots() {
            Some((a, b)) => self.board.remove_pair(a, b)?,
            None if mv == SHUFFLE => {
                if self.board.is_cleared() {
                    return Err(MoveError::Gone);
                }
                let r = redeal(&self.board, &mut self.rng).map_err(|_| MoveError::Redeal)?;
                self.board.reface(&r.assign);
                self.line = r.line;
            }
            None => return Err(MoveError::NoSuchSlot),
        }
        self.moves.push(mv);
        Ok(())
    }

    /// Take back the last move by replaying the rest from the deal. `false`
    /// when there is nothing to undo.
    pub fn undo(&mut self) -> bool {
        let Some((_, keep)) = self.moves.split_last() else {
            return false;
        };
        let keep = keep.to_vec();
        let Ok(mut fresh) = Game::new(self.origin) else {
            return false;
        };
        for mv in keep {
            let _ = fresh.play(mv);
        }
        *self = fresh;
        true
    }

    /// The legal pair after which the most tiles are free (the greedy hint;
    /// ties go to the lowest pair), or `None` when the position is stuck or
    /// cleared.
    #[must_use]
    pub fn hint_greedy(&self) -> Option<Move> {
        let mut best: Option<(usize, (usize, usize))> = None;
        for (a, b) in self.board.legal_moves() {
            let mut next = self.board.clone();
            if next.remove_pair(a, b).is_err() {
                continue;
            }
            let free_after = next.free_slots().len();
            if best.is_none_or(|(f, _)| free_after > f) {
                best = Some((free_after, (a, b)));
            }
        }
        best.map(|(_, (a, b))| Move::pair(a, b))
    }
}

/// The verifiable-outcome binding.
pub struct Mahjong;

/// The hash reported for a record whose origin does not decode: it can never
/// equal a real board's hash, so such a record fails to verify.
pub const UNVERIFIABLE_HASH: &str = "unverifiable-origin";

impl pond_outcome::Game for Mahjong {
    type Move = Move;
    const KIND: &'static str = "mahjong";
    const VERSION: u32 = 1;

    fn replay(packed_seed: u64, moves: &[Move]) -> pond_outcome::Replayed {
        let Some(mut g) = Game::from_packed(packed_seed) else {
            return pond_outcome::Replayed::new(UNVERIFIABLE_HASH.to_owned(), false);
        };
        for &mv in moves {
            // A tampered move is a no-op, so the hash diverges from an honest run.
            let _ = g.play(mv);
        }
        pond_outcome::Replayed::new(g.current_hash(), g.is_won())
    }
}
