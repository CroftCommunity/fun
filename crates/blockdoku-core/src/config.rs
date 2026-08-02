//! Config-packed seeds — the transport that keeps every configuration verifiable.
//!
//! `pond_outcome::Game::replay(seed, moves)` receives only a `u64` seed, but a
//! Blockdoku deal also depends on its [`DealOptions`] (difficulty, wild/magic
//! frequencies, the placeability guarantee). We therefore **pack the options into
//! the high bits of the seed** for outcome/verify transport, and unpack them
//! before use.
//!
//! The base game seed occupies the low **36 bits** and the config bits 36..49, so
//! the whole packed value stays below `2^49` — comfortably within
//! `Number.MAX_SAFE_INTEGER` (`2^53 - 1`), because the outcome record carries the
//! seed as a JSON number the JS host round-trips:
//!
//! ```text
//!  bit 48    47      43      42  38      36  35              0
//!      |guar| wild_f |wild_on| magic_f |m|dd| ... base_seed (36b) ...
//! ```
//!
//! Packing is a pure, reversible integer function — no floats, so it plays nicely
//! with the determinism contract.

use crate::deal::DealOptions;
use crate::difficulty::Difficulty;

const BASE_BITS: u32 = 36;
const BASE_MASK: u64 = (1u64 << BASE_BITS) - 1;

fn diff_code(d: Difficulty) -> u64 {
    match d {
        Difficulty::Easy => 0,
        Difficulty::Normal => 1,
        Difficulty::Hard => 2,
        Difficulty::Expert => 3,
    }
}

fn diff_from(code: u64) -> Difficulty {
    match code & 0b11 {
        0 => Difficulty::Easy,
        2 => Difficulty::Hard,
        3 => Difficulty::Expert,
        _ => Difficulty::Normal,
    }
}

/// Pack `(base_seed, options)` into a single transport seed. `base_seed` is
/// masked to its low 48 bits.
#[must_use]
pub fn pack_seed(base_seed: u64, o: DealOptions) -> u64 {
    let base = base_seed & BASE_MASK;
    let diff = diff_code(o.difficulty) << 36;
    let magic_f = u64::from(o.magic_frequency.min(15)) << 38;
    let magic_on = u64::from(o.enable_magic) << 42;
    let wild_f = u64::from(o.wild_frequency.min(15)) << 43;
    let wild_on = u64::from(o.enable_wild) << 47;
    let guar = u64::from(o.guarantee_placeable) << 48;
    base | diff | magic_f | magic_on | wild_f | wild_on | guar
}

/// Unpack a transport seed into `(base_seed, options)`.
#[must_use]
pub fn unpack_seed(packed: u64) -> (u64, DealOptions) {
    let base = packed & BASE_MASK;
    let options = DealOptions {
        difficulty: diff_from(packed >> 36),
        magic_frequency: u32::try_from((packed >> 38) & 0b1111).unwrap_or(0),
        enable_magic: (packed >> 42) & 1 == 1,
        wild_frequency: u32::try_from((packed >> 43) & 0b1111).unwrap_or(0),
        enable_wild: (packed >> 47) & 1 == 1,
        guarantee_placeable: (packed >> 48) & 1 == 1,
    };
    (base, options)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_every_field() {
        let cases = [
            DealOptions::default(),
            DealOptions {
                difficulty: Difficulty::Hard,
                enable_magic: true,
                magic_frequency: 7,
                enable_wild: true,
                wild_frequency: 3,
                guarantee_placeable: false,
            },
            DealOptions {
                difficulty: Difficulty::Expert,
                enable_wild: true,
                wild_frequency: 10,
                ..DealOptions::default()
            },
        ];
        for base in [0u64, 1, 42, 0x00ff_ffff, BASE_MASK] {
            for o in cases {
                let packed = pack_seed(base, o);
                // Stays within JS's safe-integer range for JSON round-trip.
                assert!(packed < (1u64 << 53), "packed seed fits a JS number");
                let (b, got) = unpack_seed(packed);
                assert_eq!(b, base & BASE_MASK);
                assert_eq!(got, o);
            }
        }
    }
}
