//! The reusable spine for two-player adversarial games on the shelf.
//!
//! Drop 4, checkers, and chess are all **perfect-information, deterministic,
//! turn-based, zero-sum** games. This crate captures that shape in one trait so
//! the harness (match-runner, scorer, tournament) and the classic engines are
//! written **once**, generically, and each game plugs in by implementing
//! [`Adversary`] rather than re-writing the runner.
//!
//! A finished match is `(seed, moves)` — one move list holding **both** sides'
//! moves in play order, which is **not** necessarily alternating: Dots and Boxes
//! grants the mover another move when they close a box, so `side_to_move` is a
//! function of the position and never of the move index — which replays through the core to a stable [`Adversary::state_hash`]
//! and a [`MatchResult`]. That is the same verifiable-outcome property the
//! single-player cores have (`pond_outcome`), so a two-player record verifies by
//! replay with no special handling. No floats on the hashed path; integer
//! fields serialize little-endian so `native == wasm`.

#![warn(missing_docs)]

use serde::{de::DeserializeOwned, Deserialize, Serialize};

/// Which side is to move, or which side a piece belongs to. Side `A` always
/// moves first (it is the opening player).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Side {
    /// The opening player (moves first).
    A,
    /// The second player.
    B,
}

impl Side {
    /// The opposing side.
    #[must_use]
    pub fn other(self) -> Self {
        match self {
            Side::A => Side::B,
            Side::B => Side::A,
        }
    }
}

/// The terminal result of a match, stated from no particular perspective.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MatchResult {
    /// Side `A` (the opening player) won.
    WinA,
    /// Side `B` (the second player) won.
    WinB,
    /// A draw (e.g. a full board with no line, or a rules draw).
    Draw,
}

impl MatchResult {
    /// The winning side, or `None` for a draw.
    #[must_use]
    pub fn winner(self) -> Option<Side> {
        match self {
            MatchResult::WinA => Some(Side::A),
            MatchResult::WinB => Some(Side::B),
            MatchResult::Draw => None,
        }
    }

    /// The result recording that `side` won.
    #[must_use]
    pub fn win_for(side: Side) -> Self {
        match side {
            Side::A => MatchResult::WinA,
            Side::B => MatchResult::WinB,
        }
    }
}

/// A two-player, perfect-information, turn-based, zero-sum game.
///
/// Positions are values (not a stateful engine) so a search can branch cheaply
/// by cloning. [`apply`](Adversary::apply) assumes its move is legal — callers
/// pick from [`legal_moves`](Adversary::legal_moves); the wasm boundary and the
/// harness enforce legality before applying. The three text methods
/// ([`render_text`](Adversary::render_text),
/// [`move_to_text`](Adversary::move_to_text),
/// [`parse_move`](Adversary::parse_move)) are the bridge an LLM player speaks
/// through.
pub trait Adversary {
    /// A game position (whose turn it is included). Cheap to clone for search.
    type Position: Clone;
    /// A move; small and serializable so it can be recorded and replayed.
    type Move: Copy + Serialize + DeserializeOwned + Eq;

    /// A short document kind, e.g. `"drop4"`.
    const KIND: &'static str;

    /// The starting position for `seed` (the seed may pick a start layout).
    fn initial(seed: u64) -> Self::Position;
    /// Whose turn it is in `pos`.
    fn side_to_move(pos: &Self::Position) -> Side;
    /// The legal moves in `pos`. Empty when `pos` is terminal.
    fn legal_moves(pos: &Self::Position) -> Vec<Self::Move>;
    /// The position after playing `mv` in `pos`. `mv` must be legal.
    fn apply(pos: &Self::Position, mv: Self::Move) -> Self::Position;
    /// `Some(result)` when `pos` is terminal, else `None`.
    fn result(pos: &Self::Position) -> Option<MatchResult>;
    /// The canonical lowercase-hex state hash of `pos` (native == wasm).
    fn state_hash(pos: &Self::Position) -> String;

    /// A human/LLM-readable rendering of `pos` (board + whose turn + how to move).
    fn render_text(pos: &Self::Position) -> String;
    /// The canonical text form of `mv` (what a player is asked to output).
    fn move_to_text(mv: Self::Move) -> String;
    /// Parse a player's raw text into a **legal** move in `pos`, or `None`.
    /// Strict: an unparseable or illegal move returns `None` (the caller then
    /// counts a retry / forfeit).
    fn parse_move(pos: &Self::Position, s: &str) -> Option<Self::Move>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn side_other_is_involutive() {
        assert_eq!(Side::A.other(), Side::B);
        assert_eq!(Side::B.other(), Side::A);
        assert_eq!(Side::A.other().other(), Side::A);
    }

    #[test]
    fn match_result_winner_and_win_for_agree() {
        assert_eq!(MatchResult::WinA.winner(), Some(Side::A));
        assert_eq!(MatchResult::WinB.winner(), Some(Side::B));
        assert_eq!(MatchResult::Draw.winner(), None);
        assert_eq!(MatchResult::win_for(Side::A), MatchResult::WinA);
        assert_eq!(MatchResult::win_for(Side::B), MatchResult::WinB);
    }
}
