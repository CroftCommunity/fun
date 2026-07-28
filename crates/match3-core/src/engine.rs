//! The deterministic match-3 engine: match / clear / gravity / refill / cascade.
//! All ordering is fixed by the tie-break tables in RULES.md.

use std::collections::BTreeSet;

use crate::board::{Board, Cell};
use crate::hash::state_hash;
use crate::rng::DetRng;

/// `(row, col)`, `row = 0` at the top.
pub type Pos = (usize, usize);

/// Result of clearing a matched set in one cascade step.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct ClearOutcome {
    pub gems_cleared: u32,
    pub blocker_layers_removed: u32,
}

/// One cascade step within a move's resolution.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct StepReport {
    /// Matched cells cleared this step (sorted, unique).
    pub cleared: Vec<Pos>,
    pub blocker_layers_removed: u32,
    pub score_gained: u64,
}

/// Result of `play_move`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct MoveReport {
    pub legal: bool,
    pub steps: Vec<StepReport>,
    pub score_gained: u64,
}

// --- Pure tie-break-table operations (each unit-tested against RULES.md) -----

/// T1 — the union of all horizontal and vertical runs of ≥3 same-colour gems.
/// Returned sorted by (row, col), unique.
pub fn find_matches(board: &Board) -> Vec<Pos> {
    let mut hit: BTreeSet<Pos> = BTreeSet::new();

    // Horizontal runs.
    for r in 0..board.height {
        let mut run_start = 0;
        for c in 1..=board.width {
            let same = c < board.width && same_gem(board.get(r, c), board.get(r, run_start));
            if !same {
                if c - run_start >= 3 {
                    for cc in run_start..c {
                        hit.insert((r, cc));
                    }
                }
                run_start = c;
            }
        }
    }

    // Vertical runs.
    for c in 0..board.width {
        let mut run_start = 0;
        for r in 1..=board.height {
            let same = r < board.height && same_gem(board.get(r, c), board.get(run_start, c));
            if !same {
                if r - run_start >= 3 {
                    for rr in run_start..r {
                        hit.insert((rr, c));
                    }
                }
                run_start = r;
            }
        }
    }

    hit.into_iter().collect()
}

/// Two cells match iff both are the same-coloured gem.
fn same_gem(a: Cell, b: Cell) -> bool {
    matches!((a, b), (Cell::Gem(x), Cell::Gem(y)) if x == y)
}

fn neighbours(board: &Board, r: usize, c: usize) -> Vec<Pos> {
    let mut v = Vec::with_capacity(4);
    if r > 0 {
        v.push((r - 1, c));
    }
    if r + 1 < board.height {
        v.push((r + 1, c));
    }
    if c > 0 {
        v.push((r, c - 1));
    }
    if c + 1 < board.width {
        v.push((r, c + 1));
    }
    v
}

/// T2 — clear the matched cells to `Empty` and damage adjacent blockers by at
/// most one layer each. Returns the counts needed for scoring.
pub fn clear_cells(board: &mut Board, matched: &[Pos]) -> ClearOutcome {
    // Which blockers are orthogonally adjacent to a matched cell (deduped, so a
    // blocker touched from two sides still loses only one layer).
    let mut to_damage: BTreeSet<Pos> = BTreeSet::new();
    for &(r, c) in matched {
        for (nr, nc) in neighbours(board, r, c) {
            if board.get(nr, nc).is_blocker() {
                to_damage.insert((nr, nc));
            }
        }
    }

    let mut gems_cleared = 0;
    for &(r, c) in matched {
        if board.get(r, c).is_gem() {
            gems_cleared += 1;
        }
        board.set(r, c, Cell::Empty);
    }

    let mut blocker_layers_removed = 0;
    for (r, c) in to_damage {
        if let Cell::Blocker(l) = board.get(r, c) {
            blocker_layers_removed += 1;
            if l <= 1 {
                board.set(r, c, Cell::Empty);
            } else {
                board.set(r, c, Cell::Blocker(l - 1));
            }
        }
    }

    ClearOutcome {
        gems_cleared,
        blocker_layers_removed,
    }
}

/// T3 — gravity: per column, within each blocker-bounded segment, gems fall to
/// the bottom and holes rise to the top. Blockers never move.
pub fn apply_gravity(board: &mut Board) {
    for c in 0..board.width {
        let mut seg_start = 0usize;
        for r in 0..=board.height {
            let boundary = r == board.height || board.get(r, c).is_blocker();
            if !boundary {
                continue;
            }
            // Segment is the non-blocker rows [seg_start, r).
            let gems: Vec<Cell> = (seg_start..r)
                .map(|rr| board.get(rr, c))
                .filter(|cell| cell.is_gem())
                .collect();
            let holes = (r - seg_start) - gems.len();
            for (i, rr) in (seg_start..r).enumerate() {
                if i < holes {
                    board.set(rr, c, Cell::Empty);
                } else {
                    board.set(rr, c, gems[i - holes]);
                }
            }
            seg_start = r + 1;
        }
    }
}

/// T4 — refill every `Empty` cell in draw order (cols L→R, then top→bottom
/// within a column, which is segments T→B then cells T→B), each consuming one
/// `rng.index(colors)`.
pub fn refill(board: &mut Board, rng: &mut DetRng, colors: usize) {
    for c in 0..board.width {
        for r in 0..board.height {
            if board.get(r, c).is_empty() {
                board.set(r, c, Cell::Gem(rng.index(colors) as u8));
            }
        }
    }
}

/// Legality of swapping `from`/`to` (RULES.md "The turn", step 1).
pub fn swap_legal(board: &Board, from: Pos, to: Pos) -> bool {
    let dr = from.0.abs_diff(to.0);
    let dc = from.1.abs_diff(to.1);
    if dr + dc != 1 {
        return false;
    }
    if !board.get(from.0, from.1).is_gem() || !board.get(to.0, to.1).is_gem() {
        return false;
    }
    let mut b = board.clone();
    let tmp = b.get(from.0, from.1);
    b.set(from.0, from.1, b.get(to.0, to.1));
    b.set(to.0, to.1, tmp);
    !find_matches(&b).is_empty()
}

// --- The game ---------------------------------------------------------------

/// A game is a board plus the seeded refill stream, colour count, and score.
#[derive(Clone)]
pub struct Game {
    pub board: Board,
    pub colors: usize,
    pub score: u64,
    rng: DetRng,
}

impl Game {
    pub fn new(board: Board, seed: u64, colors: usize) -> Self {
        Self {
            board,
            colors,
            score: 0,
            rng: DetRng::from_seed(seed),
        }
    }

    /// The verifiable-outcome anchor. Folds board, colours, draw count, score.
    pub fn state_hash(&self) -> String {
        state_hash(&self.board, self.colors, self.rng.draws(), self.score)
    }

    /// Play a swap. If illegal, the board is unchanged and `legal == false`.
    /// If legal, swap then resolve to a stable board (the cascade loop).
    pub fn play_move(&mut self, from: Pos, to: Pos) -> MoveReport {
        if !swap_legal(&self.board, from, to) {
            return MoveReport {
                legal: false,
                steps: Vec::new(),
                score_gained: 0,
            };
        }

        let tmp = self.board.get(from.0, from.1);
        self.board.set(from.0, from.1, self.board.get(to.0, to.1));
        self.board.set(to.0, to.1, tmp);

        let mut steps = Vec::new();
        let mut score_gained = 0u64;
        loop {
            let matched = find_matches(&self.board);
            if matched.is_empty() {
                break;
            }
            let out = clear_cells(&mut self.board, &matched);
            let step_score = out.gems_cleared as u64 * 10 + out.blocker_layers_removed as u64 * 20;
            score_gained += step_score;
            self.score += step_score;
            steps.push(StepReport {
                cleared: matched,
                blocker_layers_removed: out.blocker_layers_removed,
                score_gained: step_score,
            });
            apply_gravity(&mut self.board);
            refill(&mut self.board, &mut self.rng, self.colors);
        }

        MoveReport {
            legal: true,
            steps,
            score_gained,
        }
    }
}
