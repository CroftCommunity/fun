//! The fixed-timestep tick engine (RULES.md "The tick model").
//!
//! [`Engine`] holds all run state. A frame is: apply the queued [`Action`]s (each
//! stamped with the current tick and recorded), then call [`Engine::tick`] once
//! (gravity + lock resolution, then `tick += 1`). Replay mirrors this exactly, so
//! a run reconstructs byte-identically from `(seed, events)` and native == wasm.
//! No wall clock ever enters this file.

use std::collections::VecDeque;

use crate::action::{Action, InputEvent};
use crate::board::{Board, VISIBLE};
use crate::gravity::{ticks_per_row, LOCK_DELAY_TICKS, MAX_LOCK_RESETS};
use crate::hash::{state_hash, ActiveDigest, HashInput};
use crate::mode::ModeConfig;
use crate::piece::{kicks, PieceKind, RotState, ALL_KINDS};
use crate::rng::DetRng;
use crate::scoring::{
    base_points, clears_lines, combo_points, is_difficult, label, perfect_clear_bonus, ClearLabel,
    TSpin,
};

/// How many upcoming pieces are kept visible / buffered.
pub const PREVIEW: usize = 5;

/// The active (falling) piece.
#[derive(Clone, Copy)]
struct ActivePiece {
    kind: PieceKind,
    rot: RotState,
    x: i32,
    y: i32,
    last_action_was_rotation: bool,
    last_kick_index: u8,
}

/// The result of applying one atomic action.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum InputResult {
    /// The action changed state.
    Applied,
    /// The action was legal-to-attempt but changed nothing (e.g. shift into a
    /// wall, blocked rotation, hold while locked out) — the core rejected it.
    Rejected,
    /// The game is over; no further input is accepted.
    Over,
}

/// A snapshot of the active piece's absolute cells + landing, for rendering.
#[derive(Clone, Copy, Debug)]
pub struct ActiveView {
    /// Colour id.
    pub color: u8,
    /// The four absolute cells `(x, y)`.
    pub cells: [(i32, i32); 4],
    /// The ghost landing cells (hard-drop position).
    pub ghost: [(i32, i32); 4],
}

/// The whole falling-block run.
pub struct Engine {
    board: Board,
    mode: ModeConfig,
    rng: DetRng,
    queue: VecDeque<PieceKind>,
    active: Option<ActivePiece>,
    hold: Option<PieceKind>,
    hold_used: bool,
    tick: u32,
    gravity_counter: u32,
    lock_timer: u32,
    lock_resets: u32,
    lowest_y: i32,
    lines: u32,
    score: u64,
    combo: i64,
    b2b: bool,
    last_label: ClearLabel,
    over: bool,
    won: bool,
    // per-run stats (off the hashed path; for the result screen)
    pieces: u32,
    tspins: u32,
    aligns: u32,
    max_combo: u32,
    moves: Vec<InputEvent>,
}

impl Engine {
    /// A new run for `seed` under `mode`: fill the queue and spawn the first piece.
    #[must_use]
    pub fn new(seed: u64, mode: ModeConfig) -> Self {
        let mut e = Self {
            board: Board::empty(),
            mode,
            rng: DetRng::from_seed(seed),
            queue: VecDeque::new(),
            active: None,
            hold: None,
            hold_used: false,
            tick: 0,
            gravity_counter: 0,
            lock_timer: 0,
            lock_resets: 0,
            lowest_y: 0,
            lines: 0,
            score: 0,
            combo: -1,
            b2b: false,
            last_label: ClearLabel::Nothing,
            over: false,
            won: false,
            pieces: 0,
            tspins: 0,
            aligns: 0,
            max_combo: 0,
            moves: Vec::new(),
        };
        e.refill_queue();
        e.spawn_from_queue();
        e
    }

    // ---- bag / spawn -------------------------------------------------------

    /// Append one seeded 7-bag to the queue.
    fn add_bag(&mut self) {
        let mut bag = ALL_KINDS;
        // Fisher-Yates over the seeded stream.
        for i in (1..bag.len()).rev() {
            let j = self.rng.index(i + 1);
            bag.swap(i, j);
        }
        // First-piece bias: on the opening bag only, keep S/Z/O out of slot 0.
        if self.mode.first_piece_not_szo && self.pieces == 0 && self.queue.is_empty() {
            if let Some(pos) = bag
                .iter()
                .position(|k| !matches!(k, PieceKind::S | PieceKind::Z | PieceKind::O))
            {
                bag.swap(0, pos);
            }
        }
        self.queue.extend(bag);
    }

    /// Refill the queue with fresh 7-bags until at least `PREVIEW + 1` are ready.
    fn refill_queue(&mut self) {
        while self.queue.len() <= PREVIEW {
            self.add_bag();
        }
    }

    /// Pop the next piece and spawn it.
    fn spawn_from_queue(&mut self) {
        self.refill_queue();
        let kind = self.queue.pop_front().expect("queue refilled");
        self.spawn(kind);
    }

    /// Spawn a specific `kind` at its spawn origin; top-out if it overlaps.
    fn spawn(&mut self, kind: PieceKind) {
        let (x, y) = kind.spawn_origin();
        let p = ActivePiece {
            kind,
            rot: RotState::Zero,
            x,
            y,
            last_action_was_rotation: false,
            last_kick_index: 0,
        };
        self.gravity_counter = 0;
        self.lock_timer = 0;
        self.lock_resets = 0;
        self.lowest_y = y;
        self.pieces += 1;
        if self.collides(kind, RotState::Zero, x, y) {
            // Block out — a spawned piece overlaps the stack.
            self.over = true;
            self.won = false;
            self.active = Some(p); // keep it visible for the render
            return;
        }
        self.active = Some(p);
    }

    // ---- geometry ----------------------------------------------------------

    fn cells_at(kind: PieceKind, rot: RotState, x: i32, y: i32) -> [(i32, i32); 4] {
        let mut out = [(0, 0); 4];
        for (i, (dx, dy)) in kind.cells(rot).into_iter().enumerate() {
            out[i] = (x + i32::from(dx), y + i32::from(dy));
        }
        out
    }

    fn collides(&self, kind: PieceKind, rot: RotState, x: i32, y: i32) -> bool {
        Self::cells_at(kind, rot, x, y)
            .iter()
            .any(|&(cx, cy)| self.board.is_blocked(cx, cy))
    }

    fn can_move_down(&self) -> bool {
        self.active
            .is_some_and(|p| !self.collides(p.kind, p.rot, p.x, p.y - 1))
    }

    fn landing_y(&self, p: &ActivePiece) -> i32 {
        let mut y = p.y;
        while !self.collides(p.kind, p.rot, p.x, y - 1) {
            y -= 1;
        }
        y
    }

    /// If the piece descended to a new lowest row, restore the reset budget.
    fn note_descent(&mut self, new_y: i32) {
        if new_y < self.lowest_y {
            self.lowest_y = new_y;
            self.lock_resets = 0;
        }
    }

    /// On a successful shift/rotation, update the rotation flag and, if grounded,
    /// reset the lock timer within the reset cap.
    fn on_successful_move(&mut self, is_rotation: bool) {
        if let Some(p) = self.active.as_mut() {
            p.last_action_was_rotation = is_rotation;
        }
        if !self.can_move_down() && self.lock_resets < MAX_LOCK_RESETS {
            self.lock_timer = 0;
            self.lock_resets += 1;
        }
    }

    // ---- public input ------------------------------------------------------

    /// Apply an atomic action from live input: record it (tick-stamped) then act.
    /// Returns whether it changed state. Rejected once the game is over.
    pub fn input(&mut self, action: Action) -> InputResult {
        if self.over {
            return InputResult::Over;
        }
        self.moves.push(InputEvent {
            tick: self.tick,
            action,
        });
        self.apply(action)
    }

    /// Apply an action **without** recording it (used by replay).
    fn apply(&mut self, action: Action) -> InputResult {
        if self.over || self.active.is_none() {
            return InputResult::Over;
        }
        match action {
            Action::ShiftL => self.shift(-1),
            Action::ShiftR => self.shift(1),
            Action::RotCW => self.rotate(RotDir::Cw),
            Action::RotCCW => self.rotate(RotDir::Ccw),
            Action::Rot180 => self.rotate(RotDir::Flip),
            Action::SoftStep => self.soft_step(),
            Action::HardDrop => self.hard_drop(),
            Action::Hold => self.hold(),
            Action::Quit => {
                self.over = true;
                self.won = false;
                InputResult::Applied
            }
        }
    }

    fn shift(&mut self, dx: i32) -> InputResult {
        let Some(p) = self.active else {
            return InputResult::Over;
        };
        if self.collides(p.kind, p.rot, p.x + dx, p.y) {
            return InputResult::Rejected;
        }
        if let Some(a) = self.active.as_mut() {
            a.x += dx;
        }
        self.on_successful_move(false);
        InputResult::Applied
    }

    fn rotate(&mut self, dir: RotDir) -> InputResult {
        let Some(p) = self.active else {
            return InputResult::Over;
        };
        let to = match dir {
            RotDir::Cw => p.rot.cw(),
            RotDir::Ccw => p.rot.ccw(),
            RotDir::Flip => p.rot.flip(),
        };
        for (i, (kx, ky)) in kicks(p.kind, p.rot, to).into_iter().enumerate() {
            let nx = p.x + i32::from(kx);
            let ny = p.y + i32::from(ky);
            if !self.collides(p.kind, to, nx, ny) {
                if let Some(a) = self.active.as_mut() {
                    a.rot = to;
                    a.x = nx;
                    a.y = ny;
                    a.last_kick_index = i as u8;
                }
                self.note_descent(ny);
                self.on_successful_move(true);
                return InputResult::Applied;
            }
        }
        InputResult::Rejected
    }

    fn soft_step(&mut self) -> InputResult {
        if !self.can_move_down() {
            return InputResult::Rejected;
        }
        if let Some(a) = self.active.as_mut() {
            a.y -= 1;
        }
        self.score += 1;
        let ny = self.active.map_or(0, |p| p.y);
        self.note_descent(ny);
        InputResult::Applied
    }

    fn hard_drop(&mut self) -> InputResult {
        let Some(mut p) = self.active else {
            return InputResult::Over;
        };
        let target = self.landing_y(&p);
        let dropped = p.y - target;
        if dropped > 0 {
            self.score += 2 * dropped as u64;
        }
        p.y = target;
        self.active = Some(p);
        self.lock_active();
        InputResult::Applied
    }

    fn hold(&mut self) -> InputResult {
        if self.hold_used {
            return InputResult::Rejected;
        }
        let Some(p) = self.active else {
            return InputResult::Over;
        };
        let cur = p.kind;
        match self.hold.take() {
            Some(h) => {
                self.hold = Some(cur);
                self.spawn(h);
            }
            None => {
                self.hold = Some(cur);
                self.spawn_from_queue();
            }
        }
        self.hold_used = true;
        InputResult::Applied
    }

    // ---- tick / lock -------------------------------------------------------

    /// Advance one fixed timestep: gravity, then lock resolution, then `tick += 1`.
    pub fn tick(&mut self) {
        // Once over, ticks are frozen: the terminal tick is well-defined
        // regardless of how the caller's loop is structured, so a live run and
        // its replay stop at the same tick (which the hash pins).
        if self.over {
            return;
        }
        if self.active.is_none() {
            self.tick = self.tick.wrapping_add(1);
            return;
        }
        if self.can_move_down() {
            self.lock_timer = 0;
            self.gravity_counter += 1;
            let tpr = ticks_per_row(self.level());
            while self.gravity_counter >= tpr && self.can_move_down() {
                self.gravity_counter -= tpr;
                let ny = self.active.map_or(0, |p| p.y) - 1;
                if let Some(a) = self.active.as_mut() {
                    a.y = ny;
                }
                self.note_descent(ny);
            }
        } else {
            self.gravity_counter = 0;
            self.lock_timer += 1;
            if self.lock_timer >= LOCK_DELAY_TICKS {
                self.lock_active();
            }
        }
        self.tick = self.tick.wrapping_add(1);
    }

    /// Write the active piece, score the clear, then spawn the next piece.
    fn lock_active(&mut self) {
        let Some(p) = self.active.take() else {
            return;
        };
        let tspin = self.detect_tspin(&p);
        let cells = Self::cells_at(p.kind, p.rot, p.x, p.y);
        let all_in_buffer = cells.iter().all(|&(_, y)| y >= VISIBLE as i32);
        for &(cx, cy) in &cells {
            if cx >= 0 && cy >= 0 {
                self.board.set(cx as usize, cy as usize, p.kind.color_id());
            }
        }
        let cleared = self.board.clear_full_rows();
        let lvl = u64::from(self.level());
        let lbl = label(cleared, tspin);
        self.score_lock(lbl, cleared, lvl);

        // stats
        if cleared > 0 {
            self.lines += cleared as u32;
            if lbl == ClearLabel::Align {
                self.aligns += 1;
            }
        }
        if tspin != TSpin::None {
            self.tspins += 1;
        }
        self.last_label = lbl;

        // lock-out: the piece locked entirely above the visible field.
        if all_in_buffer {
            self.over = true;
            self.won = false;
            return;
        }
        // goal reached?
        if self.lines >= self.mode.goal_lines {
            self.over = true;
            self.won = true;
            return;
        }
        self.hold_used = false;
        self.spawn_from_queue();
    }

    fn score_lock(&mut self, lbl: ClearLabel, cleared: usize, lvl: u64) {
        let base = base_points(lbl, lvl);
        let difficult = is_difficult(lbl);
        let mut pts = base;
        let mut b2b_applied = false;
        if difficult && self.b2b && base > 0 {
            pts = base * 3 / 2; // ×1.5
            b2b_applied = true;
        }
        // back-to-back state: only line-clearing placements update it.
        if clears_lines(lbl) {
            self.b2b = difficult;
        }
        self.score += pts;

        // combo
        if clears_lines(lbl) {
            self.combo += 1;
            let combo = self.combo.max(0) as u64;
            self.score += combo_points(combo, lvl);
            self.max_combo = self.max_combo.max(combo as u32);
        } else {
            self.combo = -1;
        }

        // perfect clear
        if cleared > 0 && self.board.is_empty() {
            let b2b_align = lbl == ClearLabel::Align && b2b_applied;
            self.score += perfect_clear_bonus(cleared, b2b_align, lvl);
        }
    }

    /// 3-corner T-spin detection (RULES.md "T-spins").
    fn detect_tspin(&self, p: &ActivePiece) -> TSpin {
        if p.kind != PieceKind::T || !p.last_action_was_rotation {
            return TSpin::None;
        }
        let (bl, br, tl, tr) = (
            self.board.corner_filled(p.x, p.y),
            self.board.corner_filled(p.x + 2, p.y),
            self.board.corner_filled(p.x, p.y + 2),
            self.board.corner_filled(p.x + 2, p.y + 2),
        );
        let total = u8::from(bl) + u8::from(br) + u8::from(tl) + u8::from(tr);
        if total < 3 {
            return TSpin::None;
        }
        // kick test 5 (0-based index 4) upgrades to a full T-spin.
        if p.last_kick_index == 4 {
            return TSpin::Full;
        }
        // Front corners depend on the pointing direction.
        let (f1, f2) = match p.rot {
            RotState::Zero => (tl, tr), // points up
            RotState::R => (tr, br),    // points right
            RotState::Two => (bl, br),  // points down
            RotState::L => (tl, bl),    // points left
        };
        if f1 && f2 {
            TSpin::Full
        } else {
            TSpin::Mini
        }
    }

    // ---- accessors ---------------------------------------------------------

    /// The mode configuration this run was created with.
    #[must_use]
    pub fn mode(&self) -> ModeConfig {
        self.mode
    }

    /// The effective level for gravity and scoring.
    #[must_use]
    pub fn level(&self) -> u32 {
        self.mode.level_for(self.lines)
    }

    /// The simulation tick.
    #[must_use]
    pub fn tick_count(&self) -> u32 {
        self.tick
    }

    /// The board.
    #[must_use]
    pub fn board(&self) -> &Board {
        &self.board
    }

    /// The score.
    #[must_use]
    pub fn score(&self) -> u64 {
        self.score
    }

    /// Lines cleared.
    #[must_use]
    pub fn lines(&self) -> u32 {
        self.lines
    }

    /// The current combo count (`0` when not in a combo).
    #[must_use]
    pub fn combo(&self) -> u32 {
        self.combo.max(0) as u32
    }

    /// Back-to-back active.
    #[must_use]
    pub fn b2b(&self) -> bool {
        self.b2b
    }

    /// The last clear's label (for the HUD callout).
    #[must_use]
    pub fn last_label(&self) -> ClearLabel {
        self.last_label
    }

    /// The game is over.
    #[must_use]
    pub fn is_over(&self) -> bool {
        self.over
    }

    /// The run reached its goal.
    #[must_use]
    pub fn is_won(&self) -> bool {
        self.won
    }

    /// The hold piece colour id (`0` if empty).
    #[must_use]
    pub fn hold_color(&self) -> u8 {
        self.hold.map_or(0, PieceKind::color_id)
    }

    /// Whether hold is currently locked out.
    #[must_use]
    pub fn hold_used(&self) -> bool {
        self.hold_used
    }

    /// The next `PREVIEW` upcoming piece colour ids.
    #[must_use]
    pub fn preview(&self) -> Vec<u8> {
        self.queue
            .iter()
            .take(PREVIEW)
            .map(|k| k.color_id())
            .collect()
    }

    /// The active piece view (cells + ghost), or `None` when there is none.
    #[must_use]
    pub fn active_view(&self) -> Option<ActiveView> {
        let p = self.active?;
        let ghost_y = self.landing_y(&p);
        Some(ActiveView {
            color: p.kind.color_id(),
            cells: Self::cells_at(p.kind, p.rot, p.x, p.y),
            ghost: Self::cells_at(p.kind, p.rot, p.x, ghost_y),
        })
    }

    /// A hint: the four absolute cells of a good legal placement for the active
    /// piece, by a greedy one-piece heuristic (aggregate-height / holes / bumpiness weights). `None`
    /// when there is no active piece. Using a hint counts as assistance.
    #[must_use]
    pub fn hint(&self) -> Option<[(i32, i32); 4]> {
        let p = self.active?;
        let mut best: Option<(i64, [(i32, i32); 4])> = None;
        // Start the drop with the whole piece box inside the ceiling (max cell
        // offset is +3), then descend to the landing.
        let top = crate::board::HEIGHT as i32 - 4;
        for rot in [RotState::Zero, RotState::R, RotState::Two, RotState::L] {
            for x in -2..(crate::board::WIDTH as i32 + 2) {
                if self.collides(p.kind, rot, x, top) {
                    continue;
                }
                let mut y = top;
                while !self.collides(p.kind, rot, x, y - 1) {
                    y -= 1;
                }
                let cells = Self::cells_at(p.kind, rot, x, y);
                if cells
                    .iter()
                    .any(|&(cx, cy)| cx < 0 || cx >= crate::board::WIDTH as i32 || cy < 0)
                {
                    continue;
                }
                let score = self.placement_score(p.kind, &cells);
                if best.is_none_or(|(bs, _)| score > bs) {
                    best = Some((score, cells));
                }
            }
        }
        best.map(|(_, cells)| cells)
    }

    /// The stacking heuristic score of writing `cells` onto a copy of the board
    /// (higher is better). Fixed-point (×1000) so it stays integer.
    fn placement_score(&self, _kind: PieceKind, cells: &[(i32, i32); 4]) -> i64 {
        let mut b = self.board.clone();
        for &(x, y) in cells {
            if x >= 0 && y >= 0 {
                b.set(x as usize, y as usize, 1);
            }
        }
        let w = crate::board::WIDTH;
        let h = crate::board::HEIGHT;
        let cleared = {
            let mut c = b.clone();
            c.clear_full_rows() as i64
        };
        let mut heights = vec![0i64; w];
        let mut agg = 0i64;
        let mut holes = 0i64;
        for (x, hcell) in heights.iter_mut().enumerate() {
            let mut seen = false;
            for y in (0..h).rev() {
                if b.get(x as i32, y as i32) != 0 {
                    if !seen {
                        *hcell = y as i64 + 1;
                        seen = true;
                    }
                } else if seen {
                    holes += 1;
                }
            }
            agg += *hcell;
        }
        let bump: i64 = heights.windows(2).map(|p| (p[0] - p[1]).abs()).sum();
        // Classic stacking weights ×1000: rows +760, aggHeight -510, holes -3600, bump -180.
        760 * cleared - 510 * agg - 3600 * holes - 180 * bump
    }

    /// Per-run stats for the result screen: (pieces, tspins, aligns, max_combo).
    #[must_use]
    pub fn stats(&self) -> (u32, u32, u32, u32) {
        (self.pieces, self.tspins, self.aligns, self.max_combo)
    }

    /// The recorded tick-stamped move list (for `attest`).
    #[must_use]
    pub fn moves(&self) -> &[InputEvent] {
        &self.moves
    }

    /// The canonical state hash.
    #[must_use]
    pub fn current_hash(&self) -> String {
        let active = self.active.map_or(
            ActiveDigest {
                color: 0,
                rot: 0,
                x: 0,
                y: 0,
            },
            |p| ActiveDigest {
                color: p.kind.color_id(),
                rot: p.rot.index() as u8,
                x: p.x,
                y: p.y,
            },
        );
        state_hash(HashInput {
            board: &self.board,
            draws: self.rng.draws(),
            score: self.score,
            lines: self.lines,
            combo: self.combo,
            b2b: self.b2b,
            tick: self.tick,
            over: self.over,
            won: self.won,
            active,
            hold: self.hold_color(),
        })
    }

    // ---- test hooks (never used by replay, so they don't weaken verification) --

    /// Build an engine with an explicit board + active piece (tests only).
    #[doc(hidden)]
    #[must_use]
    pub fn test_with(
        board: Board,
        mode: ModeConfig,
        kind: PieceKind,
        rot: RotState,
        x: i32,
        y: i32,
    ) -> Self {
        let mut e = Self::new(0, mode);
        e.board = board;
        e.active = Some(ActivePiece {
            kind,
            rot,
            x,
            y,
            last_action_was_rotation: false,
            last_kick_index: 0,
        });
        e.lowest_y = y;
        e
    }

    /// Force the "last action was a rotation" flag + kick index (tests only).
    #[doc(hidden)]
    pub fn test_set_rotation_flag(&mut self, kick_index: u8) {
        if let Some(a) = self.active.as_mut() {
            a.last_action_was_rotation = true;
            a.last_kick_index = kick_index;
        }
    }

    /// The active piece as `(rot_index, x, y)` (tests only).
    #[doc(hidden)]
    #[must_use]
    pub fn active_pos(&self) -> Option<(u8, i32, i32)> {
        self.active.map(|p| (p.rot.index() as u8, p.x, p.y))
    }

    /// Peek the next `n` upcoming piece colour ids, refilling as needed (tests only).
    #[doc(hidden)]
    pub fn peek_upcoming(&mut self, n: usize) -> Vec<u8> {
        while self.queue.len() < n {
            self.add_bag();
        }
        self.queue.iter().take(n).map(|k| k.color_id()).collect()
    }

    /// Replay a recorded move list to its terminal, returning the final engine.
    /// Used by the verifiable-outcome binding.
    #[must_use]
    pub fn replay(seed: u64, mode: ModeConfig, events: &[InputEvent]) -> Self {
        let mut e = Self::new(seed, mode);
        let mut i = 0usize;
        let cap = events
            .last()
            .map_or(0, |ev| ev.tick)
            .saturating_add(100_000);
        loop {
            while i < events.len() && events[i].tick == e.tick {
                let _ = e.apply(events[i].action);
                i += 1;
            }
            if e.over {
                break;
            }
            if e.tick >= cap {
                break;
            }
            e.tick();
        }
        e
    }
}

#[derive(Clone, Copy)]
enum RotDir {
    Cw,
    Ccw,
    Flip,
}
