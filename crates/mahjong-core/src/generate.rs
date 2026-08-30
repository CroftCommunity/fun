//! Reverse construction — deals that are winnable by construction.
//!
//! Play removes free matching pairs until the board is empty. A deal is built
//! by **peeling** the layout the same way with faces not yet decided: start
//! with every slot occupied, repeatedly take two currently-FREE slots at
//! random and remove them, until none remain. That removal order is a winning
//! line by construction, so the deal gives the `i`-th removed pair the `i`-th
//! matching pair of faces. A peel dead-ends only when fewer than two slots are
//! free while some remain (the last two stacked, say); the attempt then
//! restarts on the continuing RNG stream, and a test pins how rarely that
//! happens.
//!
//! The same peel over the *present* slots of a part-played board is the
//! shuffle: those slots are always downward-closed (nothing is removed from
//! under a tile), so a re-deal over them is winnable too.

use thiserror::Error;

use crate::board::Board;
use crate::layout::Layout;
use crate::rng::{shuffle, Rng};
use crate::tiles::{pair_up, pairs, Face};

/// Restarts before the generator gives up on a seed.
pub const MAX_ATTEMPTS: u32 = 64;

/// Why a deal could not be built.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum DealError {
    /// Every attempt hit a dead end.
    #[error("no arrangement found within {MAX_ATTEMPTS} attempts")]
    Exhausted,
    /// The tiles to place do not form matchable pairs.
    #[error("tiles do not pair up")]
    Unpairable,
}

/// A built deal: a face per slot, the winning line (pairs in removal order),
/// and how many attempts it took.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Deal {
    /// One face per slot, in slot order.
    pub faces: Vec<Face>,
    /// Pairs `(a, b)` in an order that clears the board.
    pub line: Vec<(usize, usize)>,
    /// Attempts used (`1` = no restart).
    pub attempts: u32,
}

/// A re-deal of the present tiles: the new face per present slot, the winning
/// line, and the attempts used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Redeal {
    /// `(slot, face)` for every present slot.
    pub assign: Vec<(usize, Face)>,
    /// Pairs `(a, b)` in an order that clears the remaining tiles.
    pub line: Vec<(usize, usize)>,
    /// Attempts used.
    pub attempts: u32,
}

/// Deal a full board for `layout` from `seed`.
///
/// # Errors
/// [`DealError::Exhausted`] if no attempt completes (never observed on the
/// shipped layouts; pinned by test).
pub fn deal(layout: &Layout, seed: u32) -> Result<Deal, DealError> {
    let mut rng = Rng::new(seed);
    deal_with(layout, &mut rng)
}

/// Deal a full board drawing from `rng` (the game keeps the stream for shuffles).
///
/// # Errors
/// As [`deal`].
pub fn deal_with(layout: &Layout, rng: &mut Rng) -> Result<Deal, DealError> {
    let n = layout.len();
    let mut ps = pairs();
    shuffle(&mut ps, rng);
    ps.truncate(n / 2);
    let target: Vec<usize> = (0..n).collect();
    let (assign, line, attempts) = construct(layout, &target, &ps, rng)?;
    let mut faces = vec![Face(0); n];
    for (slot, face) in assign {
        faces[slot] = face;
    }
    Ok(Deal {
        faces,
        line,
        attempts,
    })
}

/// Re-deal the present tiles of `board` over their own slots.
///
/// # Errors
/// [`DealError::Unpairable`] if the present faces do not pair (impossible for
/// a board reached by legal play), or [`DealError::Exhausted`].
pub fn redeal(board: &Board, rng: &mut Rng) -> Result<Redeal, DealError> {
    let target: Vec<usize> = (0..board.layout().len())
        .filter(|&i| board.is_present(i))
        .collect();
    let faces: Vec<Face> = target.iter().map(|&i| board.face(i)).collect();
    let mut ps = pair_up(&faces).ok_or(DealError::Unpairable)?;
    shuffle(&mut ps, rng);
    let (assign, line, attempts) = construct(board.layout(), &target, &ps, rng)?;
    Ok(Redeal {
        assign,
        line,
        attempts,
    })
}

/// What a peel builds: `(slot, face)` assignments, the line, the attempts used.
type Built = (Vec<(usize, Face)>, Vec<(usize, usize)>, u32);

/// The peel. `target` are the slots to clear; `pairs` (already shuffled)
/// supplies `target.len() / 2` face pairs, one per removed pair in order.
fn construct(
    layout: &Layout,
    target: &[usize],
    pairs: &[[Face; 2]],
    rng: &mut Rng,
) -> Result<Built, DealError> {
    let n = layout.len();
    let mut in_target = vec![false; n];
    for &t in target {
        in_target[t] = true;
    }
    debug_assert_eq!(pairs.len() * 2, target.len());
    for attempt in 1..=MAX_ATTEMPTS {
        if let Some(line) = peel_once(layout, &in_target, rng) {
            let assign = line
                .iter()
                .zip(pairs)
                .flat_map(|(&(a, b), p)| [(a, p[0]), (b, p[1])])
                .collect();
            return Ok((assign, line, attempt));
        }
    }
    Err(DealError::Exhausted)
}

/// One peel: remove random free pairs until the target is empty, or `None` at
/// a dead end.
fn peel_once(layout: &Layout, in_target: &[bool], rng: &mut Rng) -> Option<Vec<(usize, usize)>> {
    let mut present = in_target.to_vec();
    let mut remaining = in_target.iter().filter(|&&p| p).count();
    let mut line = Vec::with_capacity(remaining / 2);
    while remaining > 0 {
        let free: Vec<usize> = (0..layout.len())
            .filter(|&s| present[s] && free_now(layout, &present, s))
            .collect();
        if free.len() < 2 {
            return None;
        }
        let i = rng.below(free.len() as u32) as usize;
        let mut j = rng.below(free.len() as u32 - 1) as usize;
        if j >= i {
            j += 1;
        }
        let (a, b) = (free[i], free[j]);
        present[a] = false;
        present[b] = false;
        remaining -= 2;
        line.push((a.min(b), a.max(b)));
    }
    Some(line)
}

/// Whether `s` is FREE among the present tiles.
fn free_now(layout: &Layout, present: &[bool], s: usize) -> bool {
    if layout.above[s].iter().any(|&j| present[j]) {
        return false;
    }
    let touched = |side: &[usize]| side.iter().any(|&j| present[j]);
    !touched(&layout.left[s]) || !touched(&layout.right[s])
}
