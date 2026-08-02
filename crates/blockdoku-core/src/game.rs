//! The Blockdoku game state machine (§ RULES).
//!
//! Deal 3 → place → clear → score → refill when the tray empties → game over when
//! no tray piece fits (or the move limit is hit). Endless score-attack: there is
//! **no win**. The only randomness is the seeded deal, so a run replays exactly
//! from `(seed, options, moves)` and native == wasm.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::board::Board;
use crate::deal::{deal, DealOptions, DealState};
use crate::hash::state_hash;
use crate::rng::DetRng;
use crate::scoring::score_placement;
use crate::shapes::{by_key, ShapeDef};

/// Pieces dealt per tray.
pub const TRAY_SIZE: usize = 3;

/// A player move: place tray slot `slot` with its top-left at `(row, col)`.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Move {
    /// Tray slot `0..TRAY_SIZE`.
    pub slot: usize,
    /// Anchor row.
    pub row: usize,
    /// Anchor column.
    pub col: usize,
}

/// Why a move was rejected. Rejected moves leave the state unchanged.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Error)]
pub enum MoveError {
    /// The game has already ended.
    #[error("the game is over")]
    GameOver,
    /// The slot index is out of range.
    #[error("no such tray slot")]
    BadSlot,
    /// The slot holds no piece (already placed this deal).
    #[error("that tray slot is empty")]
    EmptySlot,
    /// The piece does not fit at the requested anchor.
    #[error("illegal placement")]
    Illegal,
}

/// How a finished game ended (there is no win).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum GameResult {
    /// No remaining tray piece fits anywhere.
    Stuck,
    /// The difficulty's move limit was reached (expert).
    MoveLimit,
}

/// Max undo depth retained.
pub const UNDO_DEPTH: usize = 20;

/// A restorable pre-move snapshot (for undo).
#[derive(Clone)]
struct Snapshot {
    board: Board,
    tray: [Option<&'static str>; TRAY_SIZE],
    score: u64,
    streak_count: u32,
    combo: u32,
    rng: DetRng,
    deal_state: DealState,
    moves_len: usize,
    result: Option<GameResult>,
}

/// The full game state.
#[derive(Clone)]
pub struct GameState {
    seed: u64,
    options: DealOptions,
    board: Board,
    /// The three tray slots; `None` once a slot's piece has been placed.
    tray: [Option<&'static str>; TRAY_SIZE],
    score: u64,
    /// Consecutive-combo streak (feeds the streak bonus).
    streak_count: u32,
    /// Streak-combo counter (display stat; resets on any non-combo placement).
    combo: u32,
    rng: DetRng,
    deal_state: DealState,
    moves: Vec<Move>,
    result: Option<GameResult>,
    assistance_used: bool,
    undo_stack: Vec<Snapshot>,
}

impl GameState {
    /// Start a new game: empty board, seeded RNG, first tray dealt.
    #[must_use]
    pub fn new_game(seed: u64, options: DealOptions) -> Self {
        let board = Board::empty();
        let mut rng = DetRng::from_seed(seed);
        let mut deal_state = DealState::default();
        let tray = Self::deal_tray(&options, &board, &mut rng, &mut deal_state);
        let mut game = Self {
            seed,
            options,
            board,
            tray,
            score: 0,
            streak_count: 0,
            combo: 0,
            rng,
            deal_state,
            moves: Vec::new(),
            result: None,
            assistance_used: false,
            undo_stack: Vec::new(),
        };
        game.check_over();
        game
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            board: self.board.clone(),
            tray: self.tray,
            score: self.score,
            streak_count: self.streak_count,
            combo: self.combo,
            rng: self.rng.clone(),
            deal_state: self.deal_state,
            moves_len: self.moves.len(),
            result: self.result,
        }
    }

    fn deal_tray(
        options: &DealOptions,
        board: &Board,
        rng: &mut DetRng,
        deal_state: &mut DealState,
    ) -> [Option<&'static str>; TRAY_SIZE] {
        let pieces = deal(TRAY_SIZE, options, board, rng, deal_state);
        let mut tray = [None; TRAY_SIZE];
        for (slot, shape) in pieces.into_iter().enumerate().take(TRAY_SIZE) {
            tray[slot] = Some(shape.key);
        }
        tray
    }

    /// The deal seed.
    #[must_use]
    pub fn seed(&self) -> u64 {
        self.seed
    }

    /// The current score.
    #[must_use]
    pub fn score(&self) -> u64 {
        self.score
    }

    /// The current consecutive-combo streak.
    #[must_use]
    pub fn streak(&self) -> u32 {
        self.streak_count
    }

    /// The current streak-combo counter (display).
    #[must_use]
    pub fn combo(&self) -> u32 {
        self.combo
    }

    /// A read-only view of the board.
    #[must_use]
    pub fn board(&self) -> &Board {
        &self.board
    }

    /// The tray shape keys (`None` for a placed slot).
    #[must_use]
    pub fn tray(&self) -> [Option<&'static str>; TRAY_SIZE] {
        self.tray
    }

    /// Resolve a tray slot to its shape, if any.
    #[must_use]
    pub fn tray_shape(&self, slot: usize) -> Option<&'static ShapeDef> {
        self.tray.get(slot).copied().flatten().and_then(by_key)
    }

    /// The recorded move list (the verifiable proof).
    #[must_use]
    pub fn moves(&self) -> &[Move] {
        &self.moves
    }

    /// How the game ended, or `None` if still playing.
    #[must_use]
    pub fn result(&self) -> Option<GameResult> {
        self.result
    }

    /// Whether the game has ended.
    #[must_use]
    pub fn is_over(&self) -> bool {
        self.result.is_some()
    }

    /// Whether assistance (undo/hint) was declared this game.
    #[must_use]
    pub fn assistance_used(&self) -> bool {
        self.assistance_used
    }

    /// Declare that assistance was used (undo/hint; not replay-derivable).
    pub fn mark_assistance(&mut self) {
        self.assistance_used = true;
    }

    /// The canonical legal-move list: slot ascending, then row-major anchors — the
    /// exact set the UI glows. Empty once the game is over.
    #[must_use]
    pub fn legal_moves(&self) -> Vec<Move> {
        if self.is_over() {
            return Vec::new();
        }
        let mut out = Vec::new();
        for (slot, entry) in self.tray.iter().enumerate() {
            if let Some(shape) = entry.and_then(by_key) {
                for (row, col) in self.board.placements(shape) {
                    out.push(Move { slot, row, col });
                }
            }
        }
        out
    }

    /// Apply a move. On success the piece is placed, completed regions clear as a
    /// union, the score updates, the tray refills when emptied, and the game-over
    /// check runs. A rejected move leaves the state completely unchanged.
    ///
    /// # Errors
    /// Returns a [`MoveError`] if the game is over, the slot is invalid or empty,
    /// or the placement is illegal.
    pub fn play_move(&mut self, mv: Move) -> Result<(), MoveError> {
        if self.is_over() {
            return Err(MoveError::GameOver);
        }
        if mv.slot >= TRAY_SIZE {
            return Err(MoveError::BadSlot);
        }
        let key = self.tray[mv.slot].ok_or(MoveError::EmptySlot)?;
        let shape = by_key(key).ok_or(MoveError::EmptySlot)?;
        if !self.board.can_place(shape, mv.row, mv.col) {
            return Err(MoveError::Illegal);
        }

        // Snapshot for undo before mutating (bounded depth).
        self.undo_stack.push(self.snapshot());
        if self.undo_stack.len() > UNDO_DEPTH {
            self.undo_stack.remove(0);
        }

        // Place, then read completed regions before clearing.
        self.board.place(shape, mv.row, mv.col);
        let report = self.board.completed_regions();
        let total = report.total();

        // Score (streak bonus reads the streak *before* this event's increment).
        let ps = score_placement(
            shape.points,
            report.rows.len(),
            report.cols.len(),
            report.boxes.len(),
            self.streak_count,
            self.options.difficulty.multiplier(),
        );
        self.score += u64::from(ps.total());

        // Update streak/combo per the reference order (after scoring).
        if total >= 2 {
            self.streak_count += 1;
            self.combo += 1;
        } else if total == 1 {
            self.combo = 0; // a single clear breaks the combo but not the streak
        } else {
            self.combo = 0;
            self.streak_count = 0;
        }

        self.board.clear_regions(&report);
        self.tray[mv.slot] = None;
        self.moves.push(mv);

        if self.tray.iter().all(Option::is_none) {
            self.tray = Self::deal_tray(
                &self.options,
                &self.board,
                &mut self.rng,
                &mut self.deal_state,
            );
        }

        self.check_over();
        Ok(())
    }

    /// End the game if the move limit is reached or no tray piece fits.
    fn check_over(&mut self) {
        if let Some(limit) = self.options.difficulty.move_limit() {
            if u32::try_from(self.moves.len()).unwrap_or(u32::MAX) >= limit {
                self.result = Some(GameResult::MoveLimit);
                return;
            }
        }
        let remaining: Vec<&ShapeDef> = self
            .tray
            .iter()
            .filter_map(|k| k.and_then(by_key))
            .collect();
        if !self.board.has_any_placement(&remaining) {
            self.result = Some(GameResult::Stuck);
        }
    }

    /// Undo the last placement, restoring the exact pre-move state (board, tray,
    /// score, streak, RNG position, and any refill). Counts as assistance.
    /// Returns `true` if a move was undone, `false` if there was nothing to undo.
    pub fn undo(&mut self) -> bool {
        let Some(s) = self.undo_stack.pop() else {
            return false;
        };
        self.board = s.board;
        self.tray = s.tray;
        self.score = s.score;
        self.streak_count = s.streak_count;
        self.combo = s.combo;
        self.rng = s.rng;
        self.deal_state = s.deal_state;
        self.moves.truncate(s.moves_len);
        self.result = s.result;
        self.assistance_used = true;
        true
    }

    /// Whether an undo is available.
    #[must_use]
    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    /// A hint: the legal move clearing the **most** regions, tie-broken
    /// deterministically by row, then column, then slot. `None` when the game is
    /// over or no move exists. Using a hint counts as assistance (the caller marks
    /// it).
    #[must_use]
    pub fn best_hint(&self) -> Option<Move> {
        let mut best: Option<(usize, Move)> = None;
        for mv in self.legal_moves() {
            let Some(shape) = self.tray[mv.slot].and_then(by_key) else {
                continue;
            };
            let mut probe = self.board.clone();
            probe.place(shape, mv.row, mv.col);
            let cleared = probe.completed_regions().total();
            let better = match best {
                None => true,
                // legal_moves is already slot-then-row-major, so the first move
                // seen at a given clear-count is the row/col/slot-minimal one;
                // only strictly-more clears should replace it.
                Some((best_cleared, _)) => cleared > best_cleared,
            };
            if better {
                best = Some((cleared, mv));
            }
        }
        best.map(|(_, mv)| mv)
    }

    /// The canonical state hash: board + RNG draw position + score.
    #[must_use]
    pub fn state_hash(&self) -> String {
        state_hash(&self.board, self.rng.draws(), self.score)
    }

    /// Replay `moves` from `(seed, options)` into a fresh game — the verifiable
    /// re-derivation. Stops early (returning the state so far) if a move is
    /// rejected, so a tampered move list is caught by a hash/score mismatch.
    #[must_use]
    pub fn replay(seed: u64, options: DealOptions, moves: &[Move]) -> Self {
        let mut game = Self::new_game(seed, options);
        for &mv in moves {
            if game.play_move(mv).is_err() {
                break;
            }
        }
        game
    }
}

/// The verifiable-outcome binding for Blockdoku.
///
/// Blockdoku is endless score-attack, so a record proves "on this config-packed
/// seed, this move sequence reached score S and ended Stuck/limit". The seed is a
/// [`crate::config`]-packed value so the deal options travel with it — replay
/// unpacks them, so `(seed, moves)` fully determines the run.
pub struct Blockdoku;

impl pond_outcome::Game for Blockdoku {
    type Move = Move;
    const KIND: &'static str = "blockdoku";
    const VERSION: u32 = 1;

    fn replay(seed: u64, moves: &[Move]) -> pond_outcome::Replayed {
        let (base, options) = crate::config::unpack_seed(seed);
        let game = GameState::replay(base, options, moves);
        pond_outcome::Replayed {
            final_hash: game.state_hash(),
            won: false, // endless score-attack: never "won"
            score: Some(game.score()),
            stars: None,
        }
    }
}
