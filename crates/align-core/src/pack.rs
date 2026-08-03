//! The daily seed-pack — a deterministic, byte-identically-regenerable daily
//! seed schedule + a fixture replay line (RULES.md "Daily pack").
//!
//! Like 2048/wyrdle there is **no winnability search**: every seed is playable (a
//! fresh board always accepts the spawn), so the pack is a *seeded shuffle* of a
//! seed range — a year of non-repeating, non-sequential dailies — plus one
//! `fixture` (a seed + a short recorded Marathon line) for replay tests. Reaching
//! a goal is skill, not seed.

use serde::{Deserialize, Serialize};

use crate::action::Action;
use crate::engine::Engine;
use crate::game::{moves_of, AlignMove};
use crate::mode::ModeConfig;

/// A daily deal: its seed and a short recorded line (for replay tests).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackEntry {
    /// The deal seed.
    pub seed: u64,
    /// A short recorded Marathon move list (`Begin` header + events) that replays
    /// without error and changes the board.
    pub moves: Vec<AlignMove>,
}

/// The daily seed-pack: the daily seed schedule + one fixture replay line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pack {
    /// Daily seeds, indexed by date at runtime (`seeds[day % len]`).
    pub seeds: Vec<u64>,
    /// One deal with a verified short recorded line, for tests + the board E2E.
    pub fixture: PackEntry,
}

/// A deterministic `splitmix64` step — a self-contained PRNG for the build-time
/// shuffle (no `rand` dependency, so the same inputs regenerate byte-identically).
fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// A short recorded line for `seed`: hard-drop `steps` pieces (each seats and
/// spawns the next), then quit. Deterministic; changes the board.
fn fixture_line(seed: u64, steps: usize) -> Vec<AlignMove> {
    let mut e = Engine::new(seed, ModeConfig::marathon(1));
    for _ in 0..steps {
        if e.is_over() {
            break;
        }
        e.input(Action::HardDrop);
        e.tick();
    }
    if !e.is_over() {
        e.input(Action::Quit);
    }
    moves_of(&e)
}

/// Generate the pack: a Fisher-Yates shuffle of `0..pool` seeded from
/// `master_seed`, truncated to `count` daily seeds. The `fixture` is the first
/// seed with a short recorded line. Deterministic → byte-identically regenerable.
///
/// # Panics
/// Panics if `count` is not in `1..=pool` — a build-time misconfiguration.
#[must_use]
pub fn generate_pack(master_seed: u64, pool: usize, count: usize, fixture_steps: usize) -> Pack {
    assert!(
        (1..=pool).contains(&count),
        "count {count} must be in 1..={pool} (the seed pool size)"
    );
    let mut indices: Vec<u64> = (0..pool as u64).collect();
    let mut state = master_seed;
    for i in (1..pool).rev() {
        let j = (splitmix64(&mut state) % (i as u64 + 1)) as usize;
        indices.swap(i, j);
    }
    let seeds: Vec<u64> = indices.into_iter().take(count).collect();
    let first = seeds[0];
    Pack {
        seeds,
        fixture: PackEntry {
            seed: first,
            moves: fixture_line(first, fixture_steps),
        },
    }
}

/// Serialize a pack through the `pond-docformat` envelope (`"align-daily-pack"`).
///
/// # Errors
/// Propagates a `pond-docformat` write error (never expected for a valid pack).
pub fn pack_to_doc(pack: &Pack) -> Result<Vec<u8>, pond_docformat::DocError> {
    pond_docformat::write("align-daily-pack", 1, pack)
}

/// Read a pack from a `pond-docformat` document.
///
/// # Errors
/// Returns a `pond-docformat` error if the envelope kind/version/body is wrong.
pub fn pack_from_doc(bytes: &[u8]) -> Result<Pack, pond_docformat::DocError> {
    pond_docformat::read_as::<Pack>(bytes, "align-daily-pack", 1)
}
