//! The answer daily-pack — a deterministic, byte-identically-regenerable answer
//! schedule + a fixture win-line.
//!
//! Unlike bubble/solitaire there is **no winnability search**: every answer is
//! trivially winnable (the answer is itself a legal guess). So the pack collapses
//! to a *seeded shuffle* of the answer indices — a year of non-repeating,
//! non-sequential dailies — plus one `fixture` (a seed + its one-guess winning
//! line) for the win-path test. It keeps the exact pack machinery the other games
//! use (a `pond-docformat` envelope, `{ seeds, fixture }`, byte-identical regen,
//! embedded in the wasm, indexed by UTC day) without a solver.
//!
//! The shuffle uses an inline `splitmix64` (pure integer, deterministic) rather
//! than the `rand` crate, so the core stays dependency-lean and the generator is
//! byte-identically reproducible.

use serde::{Deserialize, Serialize};

use crate::word::Word;
use crate::words::{answer_for, answers_len};

/// A winnable daily deal: its seed and a guess line that solves it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackEntry {
    /// The deal seed (an answer index).
    pub seed: u64,
    /// A guess line (words) that replays to a solved game.
    pub moves: Vec<Word>,
}

/// The answer daily-pack: the daily seed schedule + one fixture win-line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pack {
    /// Daily seeds, indexed by date at runtime (`seeds[day % len]`). A shuffle of
    /// distinct answer indices, so dailies neither repeat nor run in dictionary
    /// order within a year.
    pub seeds: Vec<u64>,
    /// One winnable deal with its verified one-guess winning line, for tests and
    /// the board's win-path E2E.
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

/// Generate the pack: a Fisher-Yates shuffle of `0..answers_len()` seeded from
/// `master_seed`, truncated to `count` daily seeds. The `fixture` is the first
/// seed with its one-guess winning line (the answer itself). Deterministic →
/// byte-identically regenerable.
///
/// # Panics
/// Panics if `count` is not in `1..=answers_len()` — a build-time misconfiguration
/// (the daily schedule cannot be empty or exceed the answer pool). Never reached
/// at runtime; the pack is generated offline and committed.
#[must_use]
pub fn generate_pack(master_seed: u64, count: usize) -> Pack {
    let n = answers_len();
    assert!(
        (1..=n).contains(&count),
        "count {count} must be in 1..={n} (the answer pool size)"
    );
    let mut indices: Vec<u64> = (0..n as u64).collect();
    let mut state = master_seed;
    for i in (1..n).rev() {
        let j = (splitmix64(&mut state) % (i as u64 + 1)) as usize;
        indices.swap(i, j);
    }
    let seeds: Vec<u64> = indices.into_iter().take(count).collect();
    let first = seeds[0];
    let fixture = PackEntry {
        seed: first,
        moves: vec![answer_for(first)],
    };
    Pack { seeds, fixture }
}

/// Serialize a pack through the `pond-docformat` envelope
/// (`kind = "wyrdle-answer-pack"`, version 1).
///
/// # Errors
/// Propagates [`pond_docformat::DocError`] on a serialization failure.
pub fn pack_to_doc(pack: &Pack) -> Result<Vec<u8>, pond_docformat::DocError> {
    pond_docformat::write("wyrdle-answer-pack", 1, pack)
}
