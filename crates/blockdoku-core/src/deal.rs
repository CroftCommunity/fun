//! The seeded piece deal — ported from the original `generateRandomBlocks`
//! (§ RULES), made deterministic.
//!
//! A tray of `count` pieces (3 in play) is composed from the difficulty-resolved
//! pools: some magic, some wild (gated by opt-in frequencies), the rest standard,
//! then shuffled. Every random choice is drawn from the seeded [`DetRng`] in a
//! **canonical order** (magic picks, wild picks, standard fills, final shuffle),
//! locked by golden vectors.
//!
//! **Integer accumulators.** The original smooths wild/magic frequency across
//! deals with a *float* accumulator (`floor(freq/10 * count + acc)`, carry the
//! remainder). Because `freq/10 * count` is always a multiple of `1/10`, we carry
//! the accumulator in **integer tenths** — bit-exact to the original's intent with
//! **no floats on the hashed path**. The overlap round-robin toggle alternates
//! which tier yields when magic + wild would exceed the tray.

use serde::{Deserialize, Serialize};

use crate::board::Board;
use crate::difficulty::Difficulty;
use crate::rng::DetRng;
use crate::shapes::{by_key, ShapeDef};

/// Max re-rolls when guaranteeing a placeable tray before giving up.
const MAX_REROLL: u32 = 32;

/// Per-game deal settings.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct DealOptions {
    /// The difficulty preset (pools + size range).
    pub difficulty: Difficulty,
    /// Whether magic blocks may be dealt.
    pub enable_magic: bool,
    /// Magic frequency `0..=10` (percent tens; `freq/10` expected per slot).
    pub magic_frequency: u32,
    /// Whether wild shapes may be dealt.
    pub enable_wild: bool,
    /// Wild frequency `0..=10`. Below 5, at most one wild per tray.
    pub wild_frequency: u32,
    /// Re-roll until at least one piece is placeable on the current board.
    pub guarantee_placeable: bool,
}

// `Difficulty` has no `Default`; give `DealOptions` an explicit v1 default:
// normal, no wild/magic, placeability guaranteed.
impl Default for DealOptions {
    fn default() -> Self {
        Self {
            difficulty: Difficulty::Normal,
            enable_magic: false,
            magic_frequency: 0,
            enable_wild: false,
            wild_frequency: 0,
            guarantee_placeable: true,
        }
    }
}

/// Cross-deal state the accumulators and overlap toggle live in (part of the game
/// state; folded into serialization, not the hash — it is deal bookkeeping).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub struct DealState {
    /// Magic accumulator, in tenths.
    pub magic_acc: u32,
    /// Wild accumulator, in tenths.
    pub wild_acc: u32,
    /// Alternates which tier yields the overlap excess.
    pub overlap_toggle: bool,
}

fn tenths_freq(enable: bool, freq: u32) -> u32 {
    // pm = clamp(freq/10, 0, 1); as tenths that is min(freq, 10).
    if enable {
        freq.min(10)
    } else {
        0
    }
}

/// Compose one tray (no placeability guarantee), advancing `rng` and `state`.
fn compose(
    count: usize,
    opts: &DealOptions,
    rng: &mut DetRng,
    state: &mut DealState,
) -> Vec<&'static ShapeDef> {
    let (standard_all, wild_all, magic_all) = opts.difficulty.resolve_pool();
    // Fallback if a pool resolves empty (mirrors the original's guards).
    let standard_all = if standard_all.is_empty() {
        crate::shapes::keys_in_tier(crate::shapes::Tier::Standard)
    } else {
        standard_all
    };

    let count_u32 = u32::try_from(count).unwrap_or(u32::MAX);
    let pm = tenths_freq(opts.enable_magic, opts.magic_frequency);
    let pw = tenths_freq(opts.enable_wild, opts.wild_frequency);

    let magic_sum = pm * count_u32 + state.magic_acc;
    let mut magic_count = magic_sum / 10;
    state.magic_acc = magic_sum % 10;

    let wild_sum = pw * count_u32 + state.wild_acc;
    let mut wild_count = wild_sum / 10;
    state.wild_acc = wild_sum % 10;

    if opts.enable_wild && opts.wild_frequency < 5 {
        wild_count = wild_count.min(1);
    }
    if !opts.enable_magic || magic_all.is_empty() {
        magic_count = 0;
    }
    if !opts.enable_wild || wild_all.is_empty() {
        wild_count = 0;
    }

    // Overlap round-robin when magic + wild would exceed the tray.
    if magic_count + wild_count > count_u32 {
        let mut excess = magic_count + wild_count - count_u32;
        if state.overlap_toggle {
            let cut = excess.min(magic_count);
            magic_count -= cut;
            excess -= cut;
            wild_count -= excess.min(wild_count);
        } else {
            let cut = excess.min(wild_count);
            wild_count -= cut;
            excess -= cut;
            magic_count -= excess.min(magic_count);
        }
        state.overlap_toggle = !state.overlap_toggle;
    }

    magic_count = magic_count.min(count_u32);
    wild_count = wild_count.min(count_u32 - magic_count);

    let mut selected: Vec<&'static str> = Vec::with_capacity(count);
    for _ in 0..magic_count {
        if !magic_all.is_empty() {
            selected.push(magic_all[rng.index(magic_all.len())]);
        }
    }
    for _ in 0..wild_count {
        if !wild_all.is_empty() {
            selected.push(wild_all[rng.index(wild_all.len())]);
        }
    }

    // Standard fill, dup-avoiding: draw without replacement, refilling if drained.
    let mut remaining = standard_all.clone();
    while selected.len() < count {
        if remaining.is_empty() {
            remaining = standard_all.clone();
        }
        let idx = rng.index(remaining.len());
        selected.push(remaining.remove(idx));
    }

    rng.shuffle(&mut selected);
    selected.into_iter().filter_map(by_key).collect()
}

/// Deal a tray of `count` pieces onto `board`.
///
/// With [`DealOptions::guarantee_placeable`], re-rolls (bounded, deterministically
/// advancing the RNG) until at least one piece fits; if none fits after
/// [`MAX_REROLL`] tries, the last tray is returned as-is.
#[must_use]
pub fn deal(
    count: usize,
    opts: &DealOptions,
    board: &Board,
    rng: &mut DetRng,
    state: &mut DealState,
) -> Vec<&'static ShapeDef> {
    let mut tray = compose(count, opts, rng, state);
    if opts.guarantee_placeable {
        let mut attempts = 0;
        while attempts < MAX_REROLL && !board.has_any_placement(&tray) {
            tray = compose(count, opts, rng, state);
            attempts += 1;
        }
    }
    tray
}
