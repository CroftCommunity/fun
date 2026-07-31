//! The daily seed-pack — a deterministic, byte-identically-regenerable daily
//! seed schedule + a fixture replay line.
//!
//! Like wyrdle there is **no winnability search**: every seed is playable (a
//! non-full board always has a legal move), so the pack collapses to a *seeded
//! shuffle* of a seed range — a year of non-repeating, non-sequential dailies —
//! plus one `fixture` (a seed + a short legal direction line) for replay tests.
//! It keeps the pack machinery the other games use (a `pond-docformat` envelope,
//! `{ seeds, fixture }`, byte-identical regen, embedded in the wasm, indexed by
//! UTC day) without a solver. Whether you reach 2048 is skill, not seed.

use serde::{Deserialize, Serialize};

use crate::engine::Direction;
use crate::game::Game;

/// A daily deal: its seed and a short legal direction line (for replay tests).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackEntry {
    /// The deal seed.
    pub seed: u64,
    /// A legal direction line that replays without error and changes the board.
    pub moves: Vec<Direction>,
}

/// The daily seed-pack: the daily seed schedule + one fixture replay line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pack {
    /// Daily seeds, indexed by date at runtime (`seeds[day % len]`). A shuffle of
    /// distinct seeds, so dailies neither repeat nor run in order within a year.
    pub seeds: Vec<u64>,
    /// One deal with a verified short legal line, for tests + the board E2E.
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

/// A short legal line for `seed`: play up to `steps` hint-chosen moves (each
/// legal by construction), collecting the directions. Deterministic.
fn fixture_line(seed: u64, steps: usize) -> Vec<Direction> {
    let mut game = Game::new(seed);
    let mut moves = Vec::new();
    for _ in 0..steps {
        match game.hint() {
            Some(dir) if game.play(dir).is_ok() => moves.push(dir),
            _ => break,
        }
    }
    moves
}

/// Generate the pack: a Fisher-Yates shuffle of `0..pool` seeded from
/// `master_seed`, truncated to `count` daily seeds. The `fixture` is the first
/// seed with a short hint-driven legal line. Deterministic → byte-identically
/// regenerable.
///
/// # Panics
/// Panics if `count` is not in `1..=pool` — a build-time misconfiguration (the
/// daily schedule cannot be empty or exceed the seed pool). Never reached at
/// runtime; the pack is generated offline and committed.
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
    let fixture = PackEntry {
        seed: first,
        moves: fixture_line(first, fixture_steps),
    };
    Pack { seeds, fixture }
}

/// Serialize a pack through the `pond-docformat` envelope
/// (`kind = "2048-daily-pack"`, version 1).
///
/// # Errors
/// Propagates [`pond_docformat::DocError`] on a serialization failure.
pub fn pack_to_doc(pack: &Pack) -> Result<Vec<u8>, pond_docformat::DocError> {
    pond_docformat::write("2048-daily-pack", 1, pack)
}
