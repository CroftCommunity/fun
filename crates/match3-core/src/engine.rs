//! The deterministic match-3 engine: match / clear / gravity / refill / cascade.
//! All ordering is fixed by the tie-break tables in RULES.md.

use std::collections::{BTreeMap, BTreeSet};

use crate::board::{Board, Cell, Obstacle, SpecialKind};
use crate::hash::state_hash;
use crate::rng::DetRng;

/// `(row, col)`, `row = 0` at the top.
pub type Pos = (usize, usize);

/// Result of clearing a matched set in one cascade step.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct ClearOutcome {
    pub gems_cleared: u32,
    pub blocker_layers_removed: u32,
    /// Jelly layers scrubbed by this clear (a match over a jellied cell removes
    /// one layer beneath it) — the clear-the-jelly objective's progress.
    pub jelly_layers_removed: u32,
}

/// One cascade step within a move's resolution.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct StepReport {
    /// Matched cells cleared this step (sorted, unique).
    pub cleared: Vec<Pos>,
    pub blocker_layers_removed: u32,
    pub jelly_layers_removed: u32,
    /// Ingredients that reached the bottom row and exited this step (Track D).
    pub ingredients_collected: u32,
    /// Gems **truly cleared** this step counted per colour (`index = colour`;
    /// length = the game's colour count). Excludes creation survivors (they are
    /// transformed, not cleared). The checklist objective's "clear N of a colour"
    /// progress signal (Track D, T6). Off the hashed path.
    pub gems_cleared_by_color: Vec<u32>,
    /// Striped candies (H + V) created this step — the checklist objective's
    /// "make N striped" progress signal (Track D, T6).
    pub striped_created: u32,
    /// Wrapped candies created this step — the checklist objective's "make N
    /// wrapped" progress signal (Track D, T6).
    pub wrapped_created: u32,
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

/// T1 — every **2×2 same-colour square** on the board, each as its four cells in
/// row-major order `[(r,c), (r,c+1), (r+1,c), (r+1,c+1)]`, top-left anchor in scan
/// order (rows top→bottom, cols left→right). A 2×2 is a first-class match (B4,
/// Option A): its cells are part of [`find_matches`], and a *pure* 2×2 (no ≥3 line
/// through it) creates a fish ([`creations_for`]). Blockers/holes are never gems, so
/// they never form a square.
#[must_use]
pub fn find_squares(board: &Board) -> Vec<[Pos; 4]> {
    let mut out = Vec::new();
    for r in 0..board.height.saturating_sub(1) {
        for c in 0..board.width.saturating_sub(1) {
            if let Cell::Gem(g) = board.get(r, c) {
                if board.get(r, c + 1) == Cell::Gem(g)
                    && board.get(r + 1, c) == Cell::Gem(g)
                    && board.get(r + 1, c + 1) == Cell::Gem(g)
                {
                    out.push([(r, c), (r, c + 1), (r + 1, c), (r + 1, c + 1)]);
                }
            }
        }
    }
    out
}

/// T1 — the union of all horizontal and vertical runs of ≥3 same-colour gems, plus
/// every 2×2 same-colour square (B4, Option A — a 2×2 is a match too).
/// Returned sorted by (row, col), unique.
pub fn find_matches(board: &Board) -> Vec<Pos> {
    let mut hit: BTreeSet<Pos> = BTreeSet::new();

    // 2×2 squares (B4): every cell of every monochrome 2×2 block is matched.
    for square in find_squares(board) {
        for cell in square {
            hit.insert(cell);
        }
    }

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

/// Orientation of a match run — fixes which striped candy a line-4 creates.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Orientation {
    /// A run within one row.
    Horizontal,
    /// A run within one column.
    Vertical,
}

/// A maximal same-colour run of ≥3 gems in a single row or column — the run-
/// structured detection specials need (`find_matches` returns only the flat
/// union). `cells` are in scan order (H: left→right, V: top→bottom).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Run {
    /// The run's cells, in scan order.
    pub cells: Vec<Pos>,
    /// Whether the run lies along a row or a column.
    pub orientation: Orientation,
}

/// Every maximal same-colour run of ≥3 gems: horizontal runs first (rows
/// top→bottom, left→right), then vertical (columns left→right, top→bottom). The
/// **union** of all run cells equals [`find_matches`] exactly (proven in
/// `tests/shapes.rs`), so the flat clear set is unchanged — only the structure
/// (which cells form which run) is new. This is the same scan as `find_matches`.
#[must_use]
pub fn find_runs(board: &Board) -> Vec<Run> {
    let mut runs = Vec::new();
    for r in 0..board.height {
        let mut run_start = 0;
        for c in 1..=board.width {
            let same = c < board.width && same_gem(board.get(r, c), board.get(r, run_start));
            if !same {
                if c - run_start >= 3 {
                    runs.push(Run {
                        cells: (run_start..c).map(|cc| (r, cc)).collect(),
                        orientation: Orientation::Horizontal,
                    });
                }
                run_start = c;
            }
        }
    }
    for c in 0..board.width {
        let mut run_start = 0;
        for r in 1..=board.height {
            let same = r < board.height && same_gem(board.get(r, c), board.get(run_start, c));
            if !same {
                if r - run_start >= 3 {
                    runs.push(Run {
                        cells: (run_start..r).map(|rr| (rr, c)).collect(),
                        orientation: Orientation::Vertical,
                    });
                }
                run_start = r;
            }
        }
    }
    runs
}

/// A special candy to spawn where a qualifying match resolved (RULES.md
/// "Special candies"). The placement cell keeps its colour and gains the marker;
/// the other matched cells clear normally.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Creation {
    /// Where the special spawns (a cell of the matched component).
    pub pos: Pos,
    /// Which special (by shape).
    pub kind: SpecialKind,
    /// The component's gem colour (all cells in a component share a colour).
    pub color: u8,
}

/// Classify the current matches into the specials they create. `swap` is
/// `Some((from, to))` for the swap-triggered step (step 0), enabling the
/// "spawn at the moved candy" rule; `None` for cascade steps (spawn at the
/// deterministic anchor). At most **one** special per connected match component,
/// by the priority **colour-bomb (≥5) > wrapped (L/T) > striped (line-4)**.
#[must_use]
pub fn creations_for(board: &Board, swap: Option<(Pos, Pos)>) -> Vec<Creation> {
    let runs = find_runs(board);
    let mut out = Vec::new();
    for comp in group_runs(&runs) {
        let comp_runs: Vec<&Run> = comp.iter().map(|&i| &runs[i]).collect();
        let max_len = comp_runs.iter().map(|r| r.cells.len()).max().unwrap_or(0);
        let has_h = comp_runs
            .iter()
            .any(|r| r.orientation == Orientation::Horizontal);
        let has_v = comp_runs
            .iter()
            .any(|r| r.orientation == Orientation::Vertical);
        // The dominant run (longest; ties keep the earlier = scan order) anchors
        // striped / colour-bomb placement.
        let dominant = comp_runs
            .iter()
            .copied()
            .reduce(|a, b| if b.cells.len() > a.cells.len() { b } else { a })
            .expect("a component has at least one run");
        let kind = if max_len >= 5 {
            SpecialKind::ColorBomb
        } else if has_h && has_v {
            SpecialKind::Wrapped
        } else if max_len == 4 {
            match dominant.orientation {
                Orientation::Horizontal => SpecialKind::StripedH,
                Orientation::Vertical => SpecialKind::StripedV,
            }
        } else {
            continue; // a lone line-3 makes no special
        };
        let pos = placement(&comp_runs, dominant, kind, swap);
        // Placement is always a matched gem cell; skip defensively otherwise.
        if let Cell::Gem(color) = board.get(pos.0, pos.1) {
            out.push(Creation { pos, kind, color });
        }
    }
    // Fish (B4): a **pure** 2×2 square — one whose cells lie in no ≥3 line run —
    // creates a fish. Priority is below every line shape (a 2×2 that overlaps a line
    // is part of that line's component and makes its special, not a fish). Pure
    // squares are pairwise disjoint (any overlap would be a 2×3/3×2 = a line run), so
    // each yields exactly one fish. Placement: the swapped cell if it is in the
    // square (Candy-Crush "at the moved candy"), else the square's top-left cell.
    let run_cells: BTreeSet<Pos> = runs.iter().flat_map(|r| r.cells.iter().copied()).collect();
    for square in find_squares(board) {
        if square.iter().any(|cell| run_cells.contains(cell)) {
            continue; // not pure — a line shape already claimed these cells
        }
        let pos = fish_placement(&square, swap);
        if let Cell::Gem(color) = board.get(pos.0, pos.1) {
            out.push(Creation {
                pos,
                kind: SpecialKind::Fish,
                color,
            });
        }
    }
    out
}

/// The deterministic placement cell for a fish from a 2×2 `square`: the swapped
/// candy (`to`, then `from`) if it is one of the four cells, else the square's
/// top-left cell (`square[0]`, the earliest in row-major order).
fn fish_placement(square: &[Pos; 4], swap: Option<(Pos, Pos)>) -> Pos {
    if let Some((from, to)) = swap {
        if square.contains(&to) {
            return to;
        }
        if square.contains(&from) {
            return from;
        }
    }
    square[0]
}

/// Connected components of runs (runs sharing a cell), as ascending index
/// groups. `n` runs per clear step is tiny, so a simple union-find is ample.
fn group_runs(runs: &[Run]) -> Vec<Vec<usize>> {
    let n = runs.len();
    let mut parent: Vec<usize> = (0..n).collect();
    fn root(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    for i in 0..n {
        for j in (i + 1)..n {
            if runs[i].cells.iter().any(|c| runs[j].cells.contains(c)) {
                let (ri, rj) = (root(&mut parent, i), root(&mut parent, j));
                parent[ri] = rj;
            }
        }
    }
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for i in 0..n {
        let r = root(&mut parent, i);
        groups.entry(r).or_default().push(i);
    }
    groups.into_values().collect()
}

/// The deterministic placement cell (RULES.md creation tie-break table): on
/// step 0, prefer the swapped candy (`to`, then `from`) if it lies in the
/// candidate set; else the anchor — the earliest junction (wrapped) or the
/// dominant run's median (striped / colour-bomb).
fn placement(
    comp_runs: &[&Run],
    dominant: &Run,
    kind: SpecialKind,
    swap: Option<(Pos, Pos)>,
) -> Pos {
    let candidates: Vec<Pos> = if kind == SpecialKind::Wrapped {
        // Junctions: cells shared by ≥2 runs (the L/T corner), earliest first.
        let mut js: Vec<Pos> = Vec::new();
        for (i, r) in comp_runs.iter().enumerate() {
            for &cell in &r.cells {
                let shared = comp_runs
                    .iter()
                    .enumerate()
                    .any(|(j, r2)| j != i && r2.cells.contains(&cell));
                if shared && !js.contains(&cell) {
                    js.push(cell);
                }
            }
        }
        js.sort_unstable();
        js
    } else {
        dominant.cells.clone()
    };
    if let Some((from, to)) = swap {
        if candidates.contains(&to) {
            return to;
        }
        if candidates.contains(&from) {
            return from;
        }
    }
    if kind == SpecialKind::Wrapped {
        candidates[0]
    } else {
        candidates[candidates.len() / 2]
    }
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

/// Whether a special kind fires a blast **when matched or chained** — striped
/// (B1) and wrapped (B2). Colour-bomb activation is B3.
fn fires_on_match(kind: Option<SpecialKind>) -> bool {
    matches!(
        kind,
        Some(SpecialKind::StripedH | SpecialKind::StripedV | SpecialKind::Wrapped)
    )
}

/// Whether a special kind fires **when swapped** (swap-activation legality) —
/// striped (B1.2), wrapped (B2.2), colour bomb (B3), and fish (B4.2). Kept separate
/// from [`fires_on_match`]: a colour bomb and a fish are **not** in `fires_on_match`
/// (a colour bomb is colourless, and a fish's activation needs a seeded target draw
/// handled in `resolve_move`, not the pure blast queue), yet both are swappable.
fn fires_on_swap(kind: Option<SpecialKind>) -> bool {
    matches!(
        kind,
        Some(
            SpecialKind::StripedH
                | SpecialKind::StripedV
                | SpecialKind::Wrapped
                | SpecialKind::ColorBomb
                | SpecialKind::Fish
        )
    )
}

/// Step-0 swap classification when the swap is **not** a combo: sort each swapped
/// special into how it fires independently — a colour bomb detonates the colour of
/// the gem it traded with (`bombs`), a fish draws a seeded target (`swapped_fish`),
/// and a striped/wrapped fires its own blast (`seed`). This is the pre-B5 behaviour,
/// unchanged; the combo dispatch (RULES.md T1d) routes two-special swaps elsewhere.
fn classify_swapped_specials(
    board: &Board,
    from: Pos,
    to: Pos,
) -> (Vec<Pos>, Vec<(Pos, u8)>, Vec<Pos>) {
    let mut seed = Vec::new();
    let mut bombs = Vec::new();
    let mut swapped_fish = Vec::new();
    for (pos, other) in [(from, to), (to, from)] {
        match board.special_at(pos.0, pos.1) {
            Some(SpecialKind::ColorBomb) => {
                // Target = the colour now at `other` (the gem the bomb traded with).
                if let Cell::Gem(color) = board.get(other.0, other.1) {
                    bombs.push((pos, color));
                }
            }
            // A swapped fish fires (B4.2) — its target is drawn in `resolve_move`.
            Some(SpecialKind::Fish) => swapped_fish.push(pos),
            k if fires_on_swap(k) => seed.push(pos),
            _ => {}
        }
    }
    (seed, bombs, swapped_fish)
}

/// The step-0 swap classification: either a **combo** (both swapped cells hold a
/// non-fish firing special → one combined blast, RULES.md T1d) or the independent
/// per-special seeds (a combo's fields stay empty, and vice-versa). Bundled so
/// `resolve_move` threads one value instead of a wide tuple.
#[derive(Default)]
struct Step0Seeds {
    /// Striped/wrapped specials swapped into place (fire their own blast).
    seed: Vec<Pos>,
    /// Colour bombs swapped with a gem, each `(bomb_cell, target_colour)`.
    bombs: Vec<(Pos, u8)>,
    /// Fish swapped into place (each draws a seeded target in `resolve_move`).
    swapped_fish: Vec<Pos>,
    /// A combo (both cells are specials, any kind incl. fish) — consumes both,
    /// mutually exclusive with the seeds above.
    combo: Option<ComboEffect>,
}

/// Classify a step-0 swap into [`Step0Seeds`]. If **both** swapped cells hold a
/// firing special (any kind, incl. fish — B5.4), it is a combo: the pure pairs
/// (striped/wrapped/bomb, and fish + bomb) come from [`combo`]; the RNG fish combos
/// (fish + fish/striped/wrapped) draw their targets via [`fish_combo_clear`] (hence
/// the `rng`). Otherwise it falls back to the independent [`classify_swapped_specials`].
fn classify_step0(board: &Board, from: Pos, to: Pos, rng: &mut DetRng) -> Step0Seeds {
    let is_special = |k: Option<SpecialKind>| matches!(k, Some(kind) if fires_on_swap(Some(kind)));
    if is_special(board.special_at(from.0, from.1)) && is_special(board.special_at(to.0, to.1)) {
        // Pure combo first (no RNG); else an RNG fish combo.
        let clear =
            combo(board, from, to, to).unwrap_or_else(|| fish_combo_clear(board, from, to, rng));
        return Step0Seeds {
            combo: Some(ComboEffect {
                clear,
                sources: [from, to],
            }),
            ..Step0Seeds::default()
        };
    }
    let (seed, bombs, swapped_fish) = classify_swapped_specials(board, from, to);
    Step0Seeds {
        seed,
        bombs,
        swapped_fish,
        combo: None,
    }
}

/// A fish's target cell (B4.2) — the cell it swims to and eats. Deterministic:
/// from the highest non-empty preference tier — (1) a **jellied** cell (advancing
/// the jelly objective), else (2) any other **gem** — pick via `rng.index` over the
/// candidates in **row-major** order. The fish's own cell is excluded. `None` only
/// if the board holds no other gem (degenerate; never on a real grid). The target
/// is always a gem, so [`clear_cells`] handles it (clears it, scrubs its jelly, and
/// chips any adjacent blocker); direct blocker-eating is a revisable follow-up.
fn fish_target(board: &Board, fish_pos: Pos, rng: &mut DetRng) -> Option<Pos> {
    let mut exclude = BTreeSet::new();
    exclude.insert(fish_pos);
    fish_target_excluding(board, &exclude, rng)
}

/// The seeded target rule of [`fish_target`], generalized to **exclude** an
/// arbitrary set of cells (a fish's own cell, and — for a fish combo, B5.4 — the
/// combo sources plus already-chosen targets so the spawned fish hit distinct
/// cells). Same tiers (jellied first, else any gem) and the same single `rng.index`
/// draw, so a lone fish (`exclude = {fish_pos}`) is byte-identical to B4.
fn fish_target_excluding(board: &Board, exclude: &BTreeSet<Pos>, rng: &mut DetRng) -> Option<Pos> {
    let mut jellied: Vec<Pos> = Vec::new();
    let mut gems: Vec<Pos> = Vec::new();
    for r in 0..board.height {
        for c in 0..board.width {
            if exclude.contains(&(r, c)) || !board.get(r, c).is_gem() {
                continue;
            }
            gems.push((r, c));
            if board.jelly_at(r, c) > 0 {
                jellied.push((r, c));
            }
        }
    }
    let candidates = if jellied.is_empty() { gems } else { jellied };
    if candidates.is_empty() {
        return None;
    }
    Some(candidates[rng.index(candidates.len())])
}

/// The cells a special candy at `pos` blasts, excluding blockers — a blocker in
/// the region is not cleared but takes adjacency damage via [`clear_cells`], like
/// any match. `StripedH` clears its whole row, `StripedV` its whole column, and
/// `Wrapped` the 3×3 block around it (clamped to the board). A non-special cell
/// blasts nothing. The region **includes** the special's own cell (a caller
/// firing a wrapped's *first* blast excludes the centre so it survives — see
/// [`activate`]).
fn blast_region(board: &Board, pos: Pos) -> Vec<Pos> {
    let (r, c) = pos;
    match board.special_at(r, c) {
        Some(SpecialKind::StripedH) => (0..board.width)
            .map(|cc| (r, cc))
            .filter(|&(rr, cc)| !board.get(rr, cc).is_blocker())
            .collect(),
        Some(SpecialKind::StripedV) => (0..board.height)
            .map(|rr| (rr, c))
            .filter(|&(rr, cc)| !board.get(rr, cc).is_blocker())
            .collect(),
        Some(SpecialKind::Wrapped) => {
            let r0 = r.saturating_sub(1);
            let r1 = (r + 1).min(board.height.saturating_sub(1));
            let c0 = c.saturating_sub(1);
            let c1 = (c + 1).min(board.width.saturating_sub(1));
            (r0..=r1)
                .flat_map(|rr| (c0..=c1).map(move |cc| (rr, cc)))
                .filter(|&(rr, cc)| !board.get(rr, cc).is_blocker())
                .collect()
        }
        _ => Vec::new(),
    }
}

/// Every non-blocker cell in the rectangle `[r0,r1] × [c0,c1]` (clamped by the
/// caller), sorted row-major — the shared region builder for the combo blasts
/// (blockers are excluded like [`blast_region`], taking adjacency damage in T2).
fn region(board: &Board, r0: usize, r1: usize, c0: usize, c1: usize) -> BTreeSet<Pos> {
    let mut s = BTreeSet::new();
    for rr in r0..=r1 {
        for cc in c0..=c1 {
            if !board.get(rr, cc).is_blocker() {
                s.insert((rr, cc));
            }
        }
    }
    s
}

/// The union of `f(cell)` over every cell holding `Gem(color)` — the colour-bomb
/// transform builder (B5.2): `f` is the per-cell region a transformed candy fires
/// (row+col for a striped transform, 3×3 for a wrapped transform). Blockers are
/// excluded by [`region`].
fn colour_transform(
    board: &Board,
    color: u8,
    f: impl Fn(&Board, Pos) -> BTreeSet<Pos>,
) -> Vec<Pos> {
    let mut s = BTreeSet::new();
    for r in 0..board.height {
        for c in 0..board.width {
            if board.get(r, c) == Cell::Gem(color) {
                s.extend(f(board, (r, c)));
            }
        }
    }
    s.into_iter().collect()
}

/// The combined blast produced by swapping **two non-fish specials** together
/// (RULES.md T1d), centered on the destination cell `center` (= `to`), consuming
/// both. `a`/`b` are the two specials' post-swap cells. Returns the cells to clear
/// (blockers excluded), or `None` if the pair is not a handled combo (a fish never
/// reaches here — a fish pair skips the combo dispatch).
///
/// Striped/wrapped combos (B5.1):
/// - **striped + striped → a cross:** the full row **and** full column through
///   `center`.
/// - **striped + wrapped → a thick cross:** a 3-wide row band **and** 3-wide column
///   band through `center`.
/// - **wrapped + wrapped → a 5×5 block** around `center` (clamped). A single blast:
///   both specials are consumed, so there is no survivor to pin/re-blast (the canon
///   "explodes twice" is a revisable realization — the generic clears the 5×5 once).
///
/// Colour-bomb combos (B5.2) — the **direct equivalent clear-set**, no intermediate
/// specials materialized:
/// - **colour bomb + striped → every gem of the partner's colour** contributes its
///   full row + full column.
/// - **colour bomb + wrapped → every gem of the partner's colour** contributes its
///   3×3.
/// - **colour bomb + colour bomb → every gem cell** on the board (blockers survive,
///   chipped by adjacency in T2).
fn combo(board: &Board, a: Pos, b: Pos, center: Pos) -> Option<Vec<Pos>> {
    use SpecialKind::{ColorBomb, Fish, StripedH, StripedV, Wrapped};
    let ka = board.special_at(a.0, a.1)?;
    let kb = board.special_at(b.0, b.1)?;
    let striped = |k| matches!(k, StripedH | StripedV);
    let (r, c) = center;
    let last_r = board.height.saturating_sub(1);
    let last_c = board.width.saturating_sub(1);
    // Colour-bomb combos (B5.2) — a direct equivalent clear-set.
    if ka == ColorBomb && kb == ColorBomb {
        // The entire board: every gem cell (a blocker is not a gem → it survives).
        return Some(region(board, 0, last_r, 0, last_c).into_iter().collect());
    }
    if ka == ColorBomb || kb == ColorBomb {
        // Partner = the non-bomb special; its underlying colour is the target.
        let (partner, partner_kind) = if ka == ColorBomb { (b, kb) } else { (a, ka) };
        let Cell::Gem(color) = board.get(partner.0, partner.1) else {
            return None;
        };
        if striped(partner_kind) {
            // Each colour cell fires a striped: its full row + full column.
            return Some(colour_transform(board, color, |bd, (rr, cc)| {
                let mut s = region(bd, rr, rr, 0, bd.width.saturating_sub(1));
                s.extend(region(bd, 0, bd.height.saturating_sub(1), cc, cc));
                s
            }));
        }
        if partner_kind == Wrapped {
            // Each colour cell fires a wrapped: its 3×3.
            return Some(colour_transform(board, color, |bd, (rr, cc)| {
                region(
                    bd,
                    rr.saturating_sub(1),
                    (rr + 1).min(bd.height.saturating_sub(1)),
                    cc.saturating_sub(1),
                    (cc + 1).min(bd.width.saturating_sub(1)),
                )
            }));
        }
        if partner_kind == Fish {
            // fish + colour bomb (B5.4): a flat clear of every gem of the fish's
            // colour (the fish supplies the colour; no RNG). The bomb cell is
            // consumed as a combo source by the caller.
            return Some(colour_transform(board, color, |_, cell| {
                let mut s = BTreeSet::new();
                s.insert(cell);
                s
            }));
        }
        return None;
    }
    // Striped/wrapped combos (B5.1).
    let cells: BTreeSet<Pos> = if striped(ka) && striped(kb) {
        // Full row ∪ full column through the centre.
        let mut s = region(board, r, r, 0, last_c);
        s.extend(region(board, 0, last_r, c, c));
        s
    } else if (striped(ka) && kb == Wrapped) || (ka == Wrapped && striped(kb)) {
        // 3-wide row band ∪ 3-wide column band.
        let mut s = region(board, r.saturating_sub(1), (r + 1).min(last_r), 0, last_c);
        s.extend(region(
            board,
            0,
            last_r,
            c.saturating_sub(1),
            (c + 1).min(last_c),
        ));
        s
    } else if ka == Wrapped && kb == Wrapped {
        // 5×5 block, clamped.
        region(
            board,
            r.saturating_sub(2),
            (r + 2).min(last_r),
            c.saturating_sub(2),
            (c + 2).min(last_c),
        )
    } else {
        return None; // fish + fish/striped/wrapped is the RNG path (fish_combo_clear)
    };
    Some(cells.into_iter().collect())
}

/// The clear-set of an **RNG fish combo** (B5.4): fish + fish / striped / wrapped
/// (fish + colour bomb is a pure colour clear handled in [`combo`]). It spawns `N`
/// fish that each draw a **distinct** seeded target (via [`fish_target_excluding`],
/// excluding the two sources and already-chosen targets), then applies the partner
/// special's blast at each target — a full line for a striped partner, a 3×3 for a
/// wrapped one, or a plain eat for fish + fish. The two source fish are consumed.
/// Draws happen in a pinned sequence, folded into `draws`/`state_hash`.
fn fish_combo_clear(board: &Board, from: Pos, to: Pos, rng: &mut DetRng) -> Vec<Pos> {
    /// Spawned-fish count (Candy-Crush-derived; a tunable balance knob).
    const N: usize = 3;
    let ka = board.special_at(from.0, from.1);
    let kb = board.special_at(to.0, to.1);
    // The partner blast = the non-fish special (fish + fish → no blast).
    let partner = if ka == Some(SpecialKind::Fish) {
        kb
    } else {
        ka
    };
    let last_r = board.height.saturating_sub(1);
    let last_c = board.width.saturating_sub(1);

    let mut exclude: BTreeSet<Pos> = [from, to].into_iter().collect();
    let mut cells: BTreeSet<Pos> = [from, to].into_iter().collect(); // sources consumed
    for _ in 0..N {
        let Some(t) = fish_target_excluding(board, &exclude, rng) else {
            break; // no distinct target left (tiny board)
        };
        exclude.insert(t);
        cells.insert(t);
        let blast = match partner {
            Some(SpecialKind::StripedH) => region(board, t.0, t.0, 0, last_c),
            Some(SpecialKind::StripedV) => region(board, 0, last_r, t.1, t.1),
            Some(SpecialKind::Wrapped) => region(
                board,
                t.0.saturating_sub(1),
                (t.0 + 1).min(last_r),
                t.1.saturating_sub(1),
                (t.1 + 1).min(last_c),
            ),
            _ => BTreeSet::new(), // fish + fish: a plain eat
        };
        cells.extend(blast);
    }
    cells.into_iter().collect()
}

/// A combo (B5): the combined blast of two swapped specials plus the two source
/// cells (consumed, so they never fire individually).
struct ComboEffect {
    /// The cells the combo clears (blockers excluded), sorted row-major.
    clear: Vec<Pos>,
    /// The two swapped special cells — consumed by the combo, not fired.
    sources: [Pos; 2],
}

/// The outcome of expanding a matched set by its special blasts (a single cascade
/// step): `clear` is the full sorted set of cells to clear this step; `pending` is
/// the wrapped candies that fired their **first** blast and survived — they are
/// pinned through this step's gravity and re-blast (consumed) on the next step.
struct Activation {
    clear: Vec<Pos>,
    pending: Vec<Pos>,
}

/// Activation — expand the matched set by the blasts of any firing special in it,
/// chaining: a blast cell holding another firing special fires it too. Returns the
/// cells to clear this step plus the wrapped candies that survive to re-blast.
/// Deterministic — each cell fires at most once and the union is order-independent.
///
/// - **Striped** (B1) clears its whole line, its own cell included.
/// - **Wrapped** (B2) is the canon **double 3×3**: on its *first* blast (it is in
///   `matched`/`seed`, or chained) it clears the 3×3 **minus its own centre** — the
///   candy survives — and is added to `pending`; on its *second* blast (it is in
///   `reblast`, seeded from the previous step) it clears the full 3×3, consuming
///   itself. A wrapped set off by a chain does its own double (survives + re-blasts).
/// - Surviving (`pending`) wrapped are subtracted from `clear`, so a simultaneous
///   blast over a survivor's cell cannot destroy it (the "just-created special
///   survives" protection, applied to survive-first-blast wrapped).
/// - **Colour bomb** (B3), one `(pos, target)` per firing bomb: clears its own cell
///   (consumed) plus **every cell holding `Gem(target)`**, and enqueues any
///   striped/wrapped of that colour so it chains. A colour bomb fires only from
///   `bombs` (swap-seeded) — it is not matched, and a colour-clear that sweeps up
///   another colour bomb does not detonate it (that is a B5 combo).
fn activate(
    board: &Board,
    matched: &[Pos],
    seed: &[Pos],
    reblast: &[Pos],
    bombs: &[(Pos, u8)],
    fish_targets: &[(Pos, Pos)],
    combo: Option<&ComboEffect>,
) -> Activation {
    let mut to_clear: BTreeSet<Pos> = matched.iter().copied().collect();
    let mut pending: BTreeSet<Pos> = BTreeSet::new();
    let mut fired: BTreeSet<Pos> = BTreeSet::new();
    // Queue of `(cell, is_reblast)`. First blasts: every firing special in the
    // matched set (match-activation) plus any swapped into place (swap-activation).
    // Re-blasts: the wrapped that survived last step, firing their second blast.
    let mut queue: Vec<(Pos, bool)> = matched
        .iter()
        .copied()
        .chain(seed.iter().copied())
        .filter(|&(r, c)| fires_on_match(board.special_at(r, c)))
        .map(|p| (p, false))
        .chain(reblast.iter().copied().map(|p| (p, true)))
        .collect();
    // Colour bombs (B3): clear the whole target colour + the bomb's own cell, and
    // chain any striped/wrapped of that colour into the blast queue.
    for &(bomb_pos, target) in bombs {
        to_clear.insert(bomb_pos);
        for r in 0..board.height {
            for c in 0..board.width {
                if board.get(r, c) == Cell::Gem(target) {
                    to_clear.insert((r, c));
                    if fires_on_match(board.special_at(r, c)) && !fired.contains(&(r, c)) {
                        queue.push(((r, c), false));
                    }
                }
            }
        }
    }
    // Fish (B4.2): each fired fish eats one target cell (chosen by the seeded rule in
    // `resolve_move`); the fish's own cell + its target clear, and a striped/wrapped
    // target chains. The fish fires only from here (matched/swapped) — a fish merely
    // caught in another blast just clears.
    for &(fish_pos, target) in fish_targets {
        to_clear.insert(fish_pos);
        to_clear.insert(target);
        if fires_on_match(board.special_at(target.0, target.1)) && !fired.contains(&target) {
            queue.push((target, false));
        }
    }
    // Combo (B5): both swapped specials are consumed by the combined blast, so
    // mark them fired first — they must NOT fire individually (a wrapped source
    // would otherwise survive/re-blast). Then clear the combo cells, chaining any
    // *other* firing special the combo sweeps up (bystanders, not the two sources).
    if let Some(cmb) = combo {
        fired.insert(cmb.sources[0]);
        fired.insert(cmb.sources[1]);
        for &cell in &cmb.clear {
            to_clear.insert(cell);
            if fires_on_match(board.special_at(cell.0, cell.1)) && !fired.contains(&cell) {
                queue.push((cell, false));
            }
        }
        to_clear.insert(cmb.sources[0]);
        to_clear.insert(cmb.sources[1]);
    }
    while let Some((cell, is_reblast)) = queue.pop() {
        if !fired.insert(cell) {
            continue;
        }
        let is_first_wrapped =
            !is_reblast && board.special_at(cell.0, cell.1) == Some(SpecialKind::Wrapped);
        for bc in blast_region(board, cell) {
            // A wrapped's FIRST blast spares its own centre so it survives to
            // re-blast; every other cell in the region clears.
            if is_first_wrapped && bc == cell {
                continue;
            }
            to_clear.insert(bc);
            // A firing special the blast hits fires too — a chained wrapped does
            // its own first blast (and thus its own double).
            if fires_on_match(board.special_at(bc.0, bc.1)) && !fired.contains(&bc) {
                queue.push((bc, false));
            }
        }
        if is_first_wrapped {
            pending.insert(cell);
        }
    }
    // Protect the survivors: a wrapped that fired its first blast must not be
    // cleared by another blast this step, or it could not re-blast.
    for p in &pending {
        to_clear.remove(p);
    }
    Activation {
        clear: to_clear.into_iter().collect(),
        pending: pending.into_iter().collect(),
    }
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
    let mut jelly_layers_removed = 0;
    for &(r, c) in matched {
        if board.get(r, c).is_gem() {
            gems_cleared += 1;
        }
        // A match over a jellied cell scrubs one jelly layer beneath it.
        let jelly = board.jelly_at(r, c);
        if jelly > 0 {
            jelly_layers_removed += 1;
            board.set_jelly(r, c, jelly - 1);
        }
        board.set(r, c, Cell::Empty);
        // A cleared cell holds no special candy (the marker is scrubbed with the
        // gem). Activation of a matched special lands in B1+; B0 only creates.
        board.set_special(r, c, None);
    }

    let mut blocker_layers_removed = 0;
    for (r, c) in to_damage {
        if let Cell::Blocker(l) = board.get(r, c) {
            blocker_layers_removed += 1;
            if l <= 1 {
                board.set(r, c, Cell::Empty);
                // A cleared blocker holds no obstacle flavour (Track D, T7) — the
                // marker is scrubbed with it (its hole then refills as a plain gem).
                board.set_obstacle(r, c, None);
            } else {
                board.set(r, c, Cell::Blocker(l - 1));
            }
        }
    }

    ClearOutcome {
        gems_cleared,
        blocker_layers_removed,
        jelly_layers_removed,
    }
}

/// T3 — gravity: per column, within each blocker-bounded segment, gems fall to
/// the bottom and holes rise to the top. Blockers never move.
pub fn apply_gravity(board: &mut Board) {
    apply_gravity_pinned(board, &BTreeSet::new());
}

/// [`apply_gravity`] with a set of **pinned** cells that hold their position for
/// this one pass (B2 wrapped double-blast: a wrapped that survived its first blast
/// stays put while candies fall in around it). A pinned cell is a one-pass shelf —
/// like a blocker it bounds segments and does not move, but it stays its
/// `Gem`+special and is a boundary only for this call.
fn apply_gravity_pinned(board: &mut Board, pinned: &BTreeSet<Pos>) {
    for c in 0..board.width {
        let mut seg_start = 0usize;
        for r in 0..=board.height {
            let boundary = r == board.height
                || board.get(r, c).is_blocker()
                || (r < board.height && pinned.contains(&(r, c)));
            if !boundary {
                continue;
            }
            // Segment is the non-blocker rows [seg_start, r). Carry each **falling**
            // cell (a gem or an ingredient — Track D) with its special marker as a
            // `(cell, special)` pair so the two grids cannot desync. An ingredient
            // falls like a gem (its marker is always `None`); a blocker never enters
            // a segment (it is the boundary).
            let falling: Vec<(Cell, Option<SpecialKind>)> = (seg_start..r)
                .filter(|&rr| board.get(rr, c).is_gem() || board.get(rr, c).is_ingredient())
                .map(|rr| (board.get(rr, c), board.special_at(rr, c)))
                .collect();
            let holes = (r - seg_start) - falling.len();
            for (i, rr) in (seg_start..r).enumerate() {
                if i < holes {
                    board.set(rr, c, Cell::Empty);
                    board.set_special(rr, c, None);
                } else {
                    let (cell, special) = falling[i - holes];
                    board.set(rr, c, cell);
                    board.set_special(rr, c, special);
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
    // Swap-activation: swapping a firing special is legal even with no line match
    // — the swap fires it (striped B1.2, wrapped B2.2). A board with no swap-firing
    // special takes the unchanged match-only path.
    if fires_on_swap(board.special_at(from.0, from.1))
        || fires_on_swap(board.special_at(to.0, to.1))
    {
        return true;
    }
    let mut b = board.clone();
    let tmp = b.get(from.0, from.1);
    b.set(from.0, from.1, b.get(to.0, to.1));
    b.set(to.0, to.1, tmp);
    !find_matches(&b).is_empty()
}

/// Every legal swap in `board` — each adjacent pair once, in (row, col) order.
/// The UI highlights from this list; the core stays the sole legality authority.
#[must_use]
pub fn legal_swaps(board: &Board) -> Vec<(Pos, Pos)> {
    let mut out = Vec::new();
    for r in 0..board.height {
        for c in 0..board.width {
            if c + 1 < board.width && swap_legal(board, (r, c), (r, c + 1)) {
                out.push(((r, c), (r, c + 1)));
            }
            if r + 1 < board.height && swap_legal(board, (r, c), (r + 1, c)) {
                out.push(((r, c), (r + 1, c)));
            }
        }
    }
    out
}

/// Escape a mid-run deadlock. If `board` has no legal swap, deterministically
/// permute its **gems** (a Fisher-Yates shuffle consuming `rng` draws; blockers
/// never move) into a board that has a legal swap and no rest-matches, retrying
/// up to a bound. A live board is returned untouched, consuming **no draws** —
/// so a normal, still-live move is byte-identical to the pre-reshuffle engine.
///
/// Living inside the core (not the UI) is what keeps the outcome verifiable:
/// `Game::play_move` calls this after every move, so `Match3::replay` reshuffles
/// identically. Returns whether the board ends with a legal move (`false` only
/// if the gem multiset admits none at all — impossible on a real 8×8/6 grid).
#[must_use]
pub fn reshuffle_if_dead(board: &mut Board, rng: &mut DetRng) -> bool {
    if has_legal_move(board) {
        return true;
    }
    // The mutable gem positions (blockers stay fixed; a settled board has no holes).
    let positions: Vec<Pos> = (0..board.height)
        .flat_map(|r| (0..board.width).map(move |c| (r, c)))
        .filter(|&(r, c)| board.get(r, c).is_gem())
        .collect();
    for _ in 0..64 {
        // Shuffle the (gem, special-marker) pairs together so a special candy's
        // marker travels with its gem — a bare `Vec<Cell>` shuffle would desync
        // the overlay (leaving a marker on a moved gem). Markers are all `None`
        // on a gem-only board, so this is byte-identical to the pre-specials
        // reshuffle there.
        let mut values: Vec<(Cell, Option<SpecialKind>)> = positions
            .iter()
            .map(|&(r, c)| (board.get(r, c), board.special_at(r, c)))
            .collect();
        // Fisher-Yates from the top; each step consumes exactly one rng draw so
        // the shuffle folds into the state hash and replays identically.
        for i in (1..values.len()).rev() {
            let j = rng.index(i + 1);
            values.swap(i, j);
        }
        for (&(r, c), &(cell, special)) in positions.iter().zip(values.iter()) {
            board.set(r, c, cell);
            board.set_special(r, c, special);
        }
        if find_matches(board).is_empty() && has_legal_move(board) {
            return true;
        }
    }
    has_legal_move(board)
}

/// Whether any legal swap exists (a dead board has none).
#[must_use]
pub fn has_legal_move(board: &Board) -> bool {
    for r in 0..board.height {
        for c in 0..board.width {
            if (c + 1 < board.width && swap_legal(board, (r, c), (r, c + 1)))
                || (r + 1 < board.height && swap_legal(board, (r, c), (r + 1, c)))
            {
                return true;
            }
        }
    }
    false
}

/// Fill a `width×height` board with gems in `0..colors`, rejecting any colour
/// that would complete a horizontal or vertical run of three (so the deal has
/// no free matches). Draw order is row-major; each cell consumes one RNG draw.
fn fill_no_initial_match(rng: &mut DetRng, width: usize, height: usize, colors: usize) -> Board {
    let mut cells = vec![Cell::Empty; width * height];
    let at = |r: usize, c: usize| r * width + c;
    for r in 0..height {
        for c in 0..width {
            let mut forbidden = vec![false; colors];
            if c >= 2 {
                if let (Cell::Gem(a), Cell::Gem(b)) = (cells[at(r, c - 1)], cells[at(r, c - 2)]) {
                    if a == b {
                        forbidden[a as usize] = true;
                    }
                }
            }
            if r >= 2 {
                if let (Cell::Gem(a), Cell::Gem(b)) = (cells[at(r - 1, c)], cells[at(r - 2, c)]) {
                    if a == b {
                        forbidden[a as usize] = true;
                    }
                }
            }
            // Forbid completing a 2×2 square (B4): the up, left, and up-left cells
            // all this colour would make a fish on a "settled" deal.
            if r >= 1 && c >= 1 {
                if let (Cell::Gem(up), Cell::Gem(left), Cell::Gem(diag)) = (
                    cells[at(r - 1, c)],
                    cells[at(r, c - 1)],
                    cells[at(r - 1, c - 1)],
                ) {
                    if up == left && up == diag {
                        forbidden[up as usize] = true;
                    }
                }
            }
            let allowed: Vec<usize> = (0..colors).filter(|g| !forbidden[*g]).collect();
            let pick = allowed[rng.index(allowed.len())];
            cells[at(r, c)] = Cell::Gem(u8::try_from(pick).expect("colour fits u8"));
        }
    }
    Board::new(width, height, cells).expect("deal shape is valid")
}

/// A seeded starting deal: a settled board with **no initial matches** and **at
/// least one legal swap**, deterministic from `seed`. Retries (advancing the
/// RNG) if a fill has no legal move — astronomically rare on a real grid, but
/// the guarantee keeps a daily deal from being a dead start.
#[must_use]
pub fn deal(seed: u64, width: usize, height: usize, colors: usize) -> Board {
    let mut rng = DetRng::from_seed(seed);
    for _ in 0..64 {
        let board = fill_no_initial_match(&mut rng, width, height, colors);
        if has_legal_move(&board) {
            return board;
        }
    }
    fill_no_initial_match(&mut rng, width, height, colors)
}

/// A seeded starting deal for **clear-the-blockers**: a settled, no-initial-
/// match board carrying `blockers` single-layer `Blocker` cells and at least one
/// legal swap, deterministic from `seed`. A gem fill is drawn, then `blockers`
/// distinct cells are converted to `Blocker(1)`; the fill is redrawn (advancing
/// the RNG) if the placement leaves no legal move — rare, but the guarantee
/// keeps a daily board from being a dead start. Blockers never match, so the
/// board stays match-free.
#[must_use]
pub fn deal_blockers(
    seed: u64,
    width: usize,
    height: usize,
    colors: usize,
    blockers: usize,
) -> Board {
    let mut rng = DetRng::from_seed(seed);
    let cell_count = width * height;
    let n = blockers.min(cell_count);
    for _ in 0..64 {
        let mut board = fill_no_initial_match(&mut rng, width, height, colors);
        // Distinct cell positions, drawn in RNG order (dedup by retrying a draw).
        let mut chosen: BTreeSet<usize> = BTreeSet::new();
        while chosen.len() < n {
            chosen.insert(rng.index(cell_count));
        }
        for idx in &chosen {
            board.set(idx / width, idx % width, Cell::Blocker(1));
        }
        if has_legal_move(&board) {
            return board;
        }
    }
    fill_no_initial_match(&mut rng, width, height, colors)
}

/// How many `Blocker` cells remain — the clear-the-blockers objective is met
/// when this reaches `0`. Counts cells, not layers. Refill only produces gems,
/// so this is monotone non-increasing under play.
#[must_use]
pub fn blockers_remaining(board: &Board) -> u32 {
    u32::try_from(board.cells().iter().filter(|c| c.is_blocker()).count()).unwrap_or(u32::MAX)
}

/// A seeded starting deal for **clear-the-jelly**: a settled, no-initial-match,
/// live all-gem board with `jelly` single-layer jellied cells, deterministic
/// from `seed`. Jelly is orthogonal to gem legality (it never blocks a swap), so
/// a normal deal is reused and jelly is sprinkled on distinct cells.
#[must_use]
pub fn deal_jelly(seed: u64, width: usize, height: usize, colors: usize, jelly: usize) -> Board {
    let mut board = deal(seed, width, height, colors);
    // Advance a fresh RNG stream off the seed to choose distinct jellied cells.
    let mut rng = DetRng::from_seed(seed ^ 0x006a_656c_6c79); // "jelly" tag
    let cell_count = width * height;
    let n = jelly.min(cell_count);
    let mut chosen: BTreeSet<usize> = BTreeSet::new();
    while chosen.len() < n {
        chosen.insert(rng.index(cell_count));
    }
    for idx in chosen {
        board.set_jelly(idx / width, idx % width, 1);
    }
    board
}

/// How many cells still carry jelly — the clear-the-jelly objective is met when
/// this reaches `0`. Counts jellied cells, not layers. Jelly can only be scrubbed
/// (never added), so this is monotone non-increasing under play.
#[must_use]
pub fn jelly_remaining(board: &Board) -> u32 {
    u32::try_from(board.jelly().iter().filter(|&&l| l > 0).count()).unwrap_or(u32::MAX)
}

/// T5 — **collect** every ingredient that has reached the bottom row (the exit):
/// each becomes `Empty` and is counted. Called in `resolve_move` after each step's
/// gravity, before refill, so an ingredient exits the moment it lands. Deterministic
/// (a bottom-row scan; no RNG). Returns how many exited this call.
pub fn collect_ingredients(board: &mut Board) -> u32 {
    if board.height == 0 {
        return 0;
    }
    let bottom = board.height - 1;
    let mut collected = 0;
    for c in 0..board.width {
        if board.get(bottom, c).is_ingredient() {
            board.set(bottom, c, Cell::Empty);
            collected += 1;
        }
    }
    collected
}

/// A seeded starting deal for **clear-the-ingredients**: a settled, no-initial-match,
/// live board with `ingredients` ingredient cells placed in the **top row** (they
/// must fall the full height to exit), deterministic from `seed`. A gem fill is drawn,
/// then distinct top-row columns become `Ingredient`; the fill is redrawn (advancing
/// the RNG) if the placement leaves no legal move — rare, but the guarantee keeps a
/// daily board from being a dead start. Ingredients never match, so the board stays
/// match-free.
#[must_use]
pub fn deal_ingredients(
    seed: u64,
    width: usize,
    height: usize,
    colors: usize,
    ingredients: usize,
) -> Board {
    let mut rng = DetRng::from_seed(seed);
    let n = ingredients.min(width);
    for _ in 0..64 {
        let mut board = fill_no_initial_match(&mut rng, width, height, colors);
        // Distinct top-row columns, drawn in RNG order (dedup by retrying a draw).
        let mut chosen: BTreeSet<usize> = BTreeSet::new();
        while chosen.len() < n {
            chosen.insert(rng.index(width));
        }
        for col in &chosen {
            board.set(0, *col, Cell::Ingredient);
        }
        if has_legal_move(&board) {
            return board;
        }
    }
    fill_no_initial_match(&mut rng, width, height, colors)
}

/// How many ingredients remain on the board — the clear-the-ingredients objective is
/// met when this reaches `0`. Ingredients can only exit (never spawn — refill makes
/// only gems), so this is monotone non-increasing under play.
#[must_use]
pub fn ingredients_remaining(board: &Board) -> u32 {
    u32::try_from(board.cells().iter().filter(|c| c.is_ingredient()).count()).unwrap_or(u32::MAX)
}

/// A seeded starting deal for the **clear-the-obstacles** objective (Track D, T7):
/// a settled, no-initial-match, live board with `licorice` single-layer licorice
/// blockers and `meringue` durable multi-layer (2–3) meringue blockers on distinct
/// cells, deterministic from `seed`. Both are `Blocker` cells carrying an obstacle
/// flavour, cleared by the proven adjacency mechanic; the objective is met when no
/// blocker remains ([`blockers_remaining`]). Redraws (advancing the RNG) if a
/// placement leaves no legal move (mirrors [`deal_blockers`]).
#[must_use]
pub fn deal_obstacles(
    seed: u64,
    width: usize,
    height: usize,
    colors: usize,
    licorice: usize,
    meringue: usize,
) -> Board {
    let mut rng = DetRng::from_seed(seed);
    let cell_count = width * height;
    let n = (licorice + meringue).min(cell_count);
    for _ in 0..64 {
        let mut board = fill_no_initial_match(&mut rng, width, height, colors);
        // Distinct cell positions, drawn in RNG order (dedup by retrying a draw).
        let mut chosen: BTreeSet<usize> = BTreeSet::new();
        while chosen.len() < n {
            chosen.insert(rng.index(cell_count));
        }
        // The first `licorice` chosen cells (scan order) become single-layer
        // licorice; the rest become meringue with 2–3 layers (a fixed-order RNG
        // draw per meringue, so the deal stays byte-identically reproducible).
        for (i, &idx) in chosen.iter().enumerate() {
            let (r, c) = (idx / width, idx % width);
            if i < licorice {
                board.set(r, c, Cell::Blocker(1));
                board.set_obstacle(r, c, Some(Obstacle::Licorice));
            } else {
                let layers = 2 + u8::try_from(rng.index(2)).unwrap_or(0); // 2 or 3
                board.set(r, c, Cell::Blocker(layers));
                board.set_obstacle(r, c, Some(Obstacle::Meringue));
            }
        }
        if has_legal_move(&board) {
            return board;
        }
    }
    fill_no_initial_match(&mut rng, width, height, colors)
}

/// A greedy reference playout: from the `seed` deal, play the highest-scoring
/// legal swap each turn for `budget` swaps, and return the total score. Used to
/// set **per-deal** star targets (fractions of this) — a deterministic function
/// of the seed, so play-time and verify-time agree without a shipped par table.
#[must_use]
pub fn reference_score(
    seed: u64,
    width: usize,
    height: usize,
    colors: usize,
    budget: usize,
) -> u64 {
    let mut game = Game::new(deal(seed, width, height, colors), seed, colors);
    for _ in 0..budget {
        let swaps = legal_swaps(&game.board);
        let Some(&first) = swaps.first() else { break };
        // Pick the swap with the greatest immediate score (probe on a clone);
        // ties resolve to the earliest in `legal_swaps` order (deterministic).
        let mut best = first;
        let mut best_gain = 0u64;
        for &(from, to) in &swaps {
            let mut probe = game.clone();
            let gain = probe.play_move(from, to).score_gained;
            if gain > best_gain {
                best_gain = gain;
                best = (from, to);
            }
        }
        game.play_move(best.0, best.1);
    }
    game.score
}

/// A **less-myopic** reference playout: a beam search over move sequences that
/// also carries the plain greedy line, so it provably scores **at least**
/// [`reference_score`] and catches cascades a one-ply greedy sets up but cannot
/// see. Deterministic (fixed tie-breaks: frontier order × `legal_swaps` order,
/// stable-sorted by cumulative score) and monotone in `budget`.
///
/// This is the item-4 "stronger reference" tool. It is **not** wired into the
/// shipped per-deal targets (`targets_for` still uses [`reference_score`]):
/// swapping it re-grades every seed, so adoption waits for real play data and a
/// `Match3::VERSION` bump. Cost is a build-time/analysis concern, not the
/// runtime path.
#[must_use]
pub fn reference_score_beam(
    seed: u64,
    width: usize,
    height: usize,
    colors: usize,
    budget: usize,
    beam_width: usize,
) -> u64 {
    let start = Game::new(deal(seed, width, height, colors), seed, colors);
    // Each frontier entry is a game and the score accumulated to reach it.
    let mut frontier = vec![(start, 0u64)];
    // The greedy line guarantees `beam >= reference_score` regardless of any
    // beam-search anomaly (a wider beam occasionally pruning the greedy branch).
    let mut best = reference_score(seed, width, height, colors, budget);
    for _ in 0..budget {
        let mut next: Vec<(Game, u64)> = Vec::new();
        for (game, score) in &frontier {
            for (from, to) in legal_swaps(&game.board) {
                let mut g = game.clone();
                let gain = g.play_move(from, to).score_gained;
                next.push((g, score + gain));
            }
        }
        if next.is_empty() {
            break;
        }
        // Keep the `beam_width` highest-cumulative states; the sort is stable, so
        // equal scores keep their (deterministic) generation order.
        next.sort_by_key(|&(_, score)| core::cmp::Reverse(score));
        next.truncate(beam_width.max(1));
        best = best.max(next.iter().map(|(_, s)| *s).max().unwrap_or(0));
        frontier = next;
    }
    best
}

/// A heuristic bonus (B6) rewarding a board that holds specials and **combo-ready**
/// adjacent special pairs. Used only to keep special-building lines alive in the
/// [`reference_score_specials`] beam frontier — it is **never** added to the reported
/// score. The weights are tunable balance knobs (parity Track C calibration).
fn special_potential(board: &Board) -> u64 {
    let weight = |k: SpecialKind| -> u64 {
        match k {
            SpecialKind::StripedH | SpecialKind::StripedV | SpecialKind::Fish => 20,
            SpecialKind::Wrapped => 40,
            SpecialKind::ColorBomb => 80,
        }
    };
    let mut p = 0u64;
    for r in 0..board.height {
        for c in 0..board.width {
            if let Some(k) = board.special_at(r, c) {
                p += weight(k);
                // An orthogonally-adjacent special (right / down) is a combo away.
                if c + 1 < board.width && board.special_at(r, c + 1).is_some() {
                    p += 100;
                }
                if r + 1 < board.height && board.special_at(r + 1, c).is_some() {
                    p += 100;
                }
            }
        }
    }
    p
}

/// The **specials-exploiting** reference playout (B6): the strong (3★) par rung. The
/// same beam as [`reference_score_beam`], but the frontier is ranked for **survival**
/// by `actual_score + special_potential(board)` — so lines that *build* specials (and
/// thus set up a combo) are not pruned before they pay off, unlike a purely
/// score-ranked beam that discards them for their low immediate score. It reports
/// honest **actual** score, and carries the plain beam line as a floor, so it provably
/// scores **≥ [`reference_score_beam`]** (never a weaker "strong" bar).
///
/// Deterministic: a stable sort with an integer key, and the frontier / `legal_swaps`
/// order are deterministic, so equal-key states keep generation order — the baked par
/// table is bit-identical on every build target.
#[must_use]
pub fn reference_score_specials(
    seed: u64,
    width: usize,
    height: usize,
    colors: usize,
    budget: usize,
    beam_width: usize,
) -> u64 {
    let start = Game::new(deal(seed, width, height, colors), seed, colors);
    let mut frontier = vec![(start, 0u64)];
    // Floor: the plain beam (which itself carries greedy) => specials >= beam >= greedy.
    let mut best = reference_score_beam(seed, width, height, colors, budget, beam_width);
    for _ in 0..budget {
        let mut next: Vec<(Game, u64)> = Vec::new();
        for (game, score) in &frontier {
            for (from, to) in legal_swaps(&game.board) {
                let mut g = game.clone();
                let gain = g.play_move(from, to).score_gained;
                next.push((g, score + gain));
            }
        }
        if next.is_empty() {
            break;
        }
        // Rank for SURVIVAL by actual score + special potential (special-building lines
        // survive pruning); report the best ACTUAL score. Stable sort keeps equal-key
        // states in deterministic generation order.
        next.sort_by_key(|s| core::cmp::Reverse(s.1 + special_potential(&s.0.board)));
        next.truncate(beam_width.max(1));
        best = best.max(next.iter().map(|(_, s)| *s).max().unwrap_or(0));
        frontier = next;
    }
    best
}

/// A **weak** reference playout: from the `seed` deal, play a *random* legal swap
/// each turn for `budget` swaps, and return the total score. The random choice is
/// a separate seeded stream (tagged off `seed`), so it is deterministic and
/// independent of the refill stream. Used as the gentle 1★ floor of the par
/// ladder — "even careless play clears this bar".
#[must_use]
pub fn random_score(seed: u64, width: usize, height: usize, colors: usize, budget: usize) -> u64 {
    let mut game = Game::new(deal(seed, width, height, colors), seed, colors);
    // A distinct stream for move *choice* (the game's own rng drives refills).
    let mut pick = DetRng::from_seed(seed ^ 0x0072_616e_646d); // "randm" tag
    for _ in 0..budget {
        let swaps = legal_swaps(&game.board);
        if swaps.is_empty() {
            break;
        }
        let (from, to) = swaps[pick.index(swaps.len())];
        game.play_move(from, to);
    }
    game.score
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
        self.resolve_move(from, to, false).0
    }

    /// The same resolution as [`play_move`], but additionally returns a board
    /// snapshot after **each cascade phase** (after the swap, then after every
    /// clear / gravity / refill) so the UI can animate clear→fall→refill. The
    /// RNG stream, final board, `state_hash`, and `MoveReport` are byte-identical
    /// to [`play_move`] — the trace is a *view* of the one resolution, not a
    /// second code path. An illegal move returns an empty snapshot list.
    pub fn play_move_traced(&mut self, from: Pos, to: Pos) -> (MoveReport, Vec<Board>) {
        self.resolve_move(from, to, true)
    }

    /// Shared move resolution. When `trace`, pushes a `board.clone()` after each
    /// phase; otherwise the `Vec<Board>` is empty and the work is identical.
    fn resolve_move(&mut self, from: Pos, to: Pos, trace: bool) -> (MoveReport, Vec<Board>) {
        let mut snapshots = Vec::new();
        if !swap_legal(&self.board, from, to) {
            return (
                MoveReport {
                    legal: false,
                    steps: Vec::new(),
                    score_gained: 0,
                },
                snapshots,
            );
        }

        // Swap the two cells AND their special markers, so a special candy moves
        // with its gem (a striped swapped into a match — or fired by the swap —
        // carries its power). Markers are both `None` for a plain swap → no-op.
        let tmp_cell = self.board.get(from.0, from.1);
        let tmp_special = self.board.special_at(from.0, from.1);
        self.board.set(from.0, from.1, self.board.get(to.0, to.1));
        self.board
            .set_special(from.0, from.1, self.board.special_at(to.0, to.1));
        self.board.set(to.0, to.1, tmp_cell);
        self.board.set_special(to.0, to.1, tmp_special);
        if trace {
            snapshots.push(self.board.clone());
        }

        let mut steps = Vec::new();
        let mut score_gained = 0u64;
        let mut step_index = 0usize;
        // Wrapped candies that fired their first blast last step and must re-blast
        // (consumed) this step — the second half of the canon double 3×3 (B2). A
        // transient carry within this one move; it never persists into `state_hash`.
        let mut reblast_seed: Vec<Pos> = Vec::new();
        loop {
            let matched = find_matches(&self.board);
            // Step 0 classifies the swapped specials. Combo dispatch (B5/B5.4, RULES
            // T1d): if BOTH swapped cells hold a firing special (any kind, incl. fish)
            // they combine into one blast (`combo_effect`) and are consumed — skipping
            // the independent classification. Otherwise each fires on its own
            // (striped/wrapped blast `seed` B1.2/B2.2, colour bomb `bombs` B3, fish
            // `swapped_fish` B4.2). A fish combo draws its targets here (needs `rng`).
            let Step0Seeds {
                seed,
                bombs,
                swapped_fish,
                combo: combo_effect,
            } = if step_index == 0 {
                classify_step0(&self.board, from, to, &mut self.rng)
            } else {
                Step0Seeds::default()
            };
            // Fish that fire this step: those in the matched set (any step) plus any
            // swapped fish (step 0), deduped + in scan order so the target draws are
            // in a fixed sequence. A just-created fish is not yet marked here (the
            // marker lands after the clear), so it does not fire the step it is made.
            // A combo self-contains its effect (incl. fish combos, whose targets were
            // drawn in `classify_step0`), so no independent fish fires on a combo step.
            let mut fired_fish: BTreeSet<Pos> = if combo_effect.is_some() {
                BTreeSet::new()
            } else {
                matched
                    .iter()
                    .copied()
                    .filter(|&(r, c)| self.board.special_at(r, c) == Some(SpecialKind::Fish))
                    .collect()
            };
            fired_fish.extend(swapped_fish);
            if matched.is_empty()
                && seed.is_empty()
                && reblast_seed.is_empty()
                && bombs.is_empty()
                && fired_fish.is_empty()
                && combo_effect.is_none()
            {
                break;
            }
            // Which specials this step's shapes create — step 0 uses the swap so
            // the special spawns at the moved candy (RULES.md). Computed on the
            // pre-clear board (the gems must still be present).
            let swap = if step_index == 0 {
                Some((from, to))
            } else {
                None
            };
            // A combo (B5) spawns no new specials — both sources are consumed and
            // the combined blast just clears. Suppress creation on a combo step.
            let creations = if combo_effect.is_some() {
                Vec::new()
            } else {
                creations_for(&self.board, swap)
            };
            // Draw each fired fish's target (B4.2), in scan order, from the seeded
            // RNG — before this step's refill, so the draw order is fixed and folds
            // into `draws`/`state_hash`. The target is a gem, so `clear_cells` eats it.
            let fish_targets: Vec<(Pos, Pos)> = fired_fish
                .iter()
                .filter_map(|&f| fish_target(&self.board, f, &mut self.rng).map(|t| (f, t)))
                .collect();
            // Activation: expand the cleared set by the blasts of any firing
            // special in the matched set (chained) + swap/re-blast/bomb/fish seeds. No
            // firing special -> `act.clear` == `matched`, so plain-gem and B0-creation
            // play stay byte-identical. `act.pending` = wrapped surviving their first
            // blast (B2), pinned through this gravity and re-blasting next step.
            let act = activate(
                &self.board,
                &matched,
                &seed,
                &reblast_seed,
                &bombs,
                &fish_targets,
                combo_effect.as_ref(),
            );
            let activated = act.clear;
            // Track D (T6) — the checklist's neutral per-step signals, computed on
            // the **pre-clear** board (colours must still be present): gems truly
            // cleared per colour (the activated set minus the creation survivors,
            // which are transformed not cleared), and specials made this step by
            // kind. No-op for every other mode (they just ignore these fields).
            let mut gems_cleared_by_color = vec![0u32; self.colors];
            for &(r, c) in &activated {
                if creations.iter().any(|cr| cr.pos == (r, c)) {
                    continue;
                }
                if let Cell::Gem(g) = self.board.get(r, c) {
                    let gi = g as usize;
                    if gi < gems_cleared_by_color.len() {
                        gems_cleared_by_color[gi] += 1;
                    }
                }
            }
            let striped_created = u32::try_from(
                creations
                    .iter()
                    .filter(|cr| matches!(cr.kind, SpecialKind::StripedH | SpecialKind::StripedV))
                    .count(),
            )
            .unwrap_or(0);
            let wrapped_created = u32::try_from(
                creations
                    .iter()
                    .filter(|cr| cr.kind == SpecialKind::Wrapped)
                    .count(),
            )
            .unwrap_or(0);
            let out = clear_cells(&mut self.board, &activated);
            // Each placement cell survives as a special candy: clear_cells set it
            // Empty (and scrubbed its jelly + damaged adjacent blockers as part of
            // the match), so restore it as a gem carrying the marker. It is
            // transformed, not cleared, so it does not score as a cleared gem.
            for cr in &creations {
                self.board.set(cr.pos.0, cr.pos.1, Cell::Gem(cr.color));
                self.board.set_special(cr.pos.0, cr.pos.1, Some(cr.kind));
            }
            let created = u32::try_from(creations.len()).unwrap_or(0);
            let gems_scored = out.gems_cleared.saturating_sub(created);
            let step_score =
                u64::from(gems_scored) * 10 + u64::from(out.blocker_layers_removed) * 20;
            score_gained += step_score;
            self.score += step_score;
            // Report the truly-cleared cells (the activated set minus the
            // survivors that became specials), so step0_cleared stays computable.
            let cleared: Vec<Pos> = activated
                .into_iter()
                .filter(|p| !creations.iter().any(|c| c.pos == *p))
                .collect();
            if trace {
                snapshots.push(self.board.clone());
            }
            // Pin the surviving wrapped through gravity (they hold their cells
            // while candies fall in around them), then carry them to the next step
            // as the re-blast seed for their second explosion.
            let pinned: BTreeSet<Pos> = act.pending.iter().copied().collect();
            apply_gravity_pinned(&mut self.board, &pinned);
            // Track D: an ingredient that gravity dropped into the bottom row exits
            // now (before refill), so its hole refills as a gem. No-op with no
            // ingredient on the board, so every other mode is unchanged.
            let ingredients_collected = collect_ingredients(&mut self.board);
            if trace {
                snapshots.push(self.board.clone());
            }
            refill(&mut self.board, &mut self.rng, self.colors);
            if trace {
                snapshots.push(self.board.clone());
            }
            // The step report is pushed after collection so it can carry the
            // ingredients that exited this step (the solver orders by that progress).
            steps.push(StepReport {
                cleared,
                blocker_layers_removed: out.blocker_layers_removed,
                jelly_layers_removed: out.jelly_layers_removed,
                ingredients_collected,
                gems_cleared_by_color,
                striped_created,
                wrapped_created,
                score_gained: step_score,
            });
            reblast_seed = act.pending;
            step_index += 1;
        }

        // The cascade has settled; if it settled into a dead board, reshuffle so
        // the run continues. Deterministic (uses `self.rng`) and reproduced on
        // replay because replay calls `play_move`. A live board is untouched.
        let reshuffled = !has_legal_move(&self.board);
        let _ = reshuffle_if_dead(&mut self.board, &mut self.rng);
        if trace && reshuffled {
            snapshots.push(self.board.clone());
        }

        (
            MoveReport {
                legal: true,
                steps,
                score_gained,
            },
            snapshots,
        )
    }
}
