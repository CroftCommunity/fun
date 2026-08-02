//! Config-packed seeds — the transport that keeps every configuration verifiable.
//!
//! `pond_outcome::Game::replay(seed, moves)` receives only a `u64` seed, but a
//! Blockdoku deal also depends on its [`DealOptions`] (difficulty, wild/magic
//! frequencies, the placeability guarantee). We therefore **pack the options into
//! the high bits of the seed** for outcome/verify transport, and unpack them
//! before use. The base game seed occupies the low 48 bits (daily/`?seed=` values
//! stay well under that), and the config occupies bits 48..61:
//!
//! ```text
//!  bit  60        56        52   50 49        0
//!       | guar |  wild_f  |m| magic_f |d d| ... base_seed (48b) ...
//! ```
//!
//! Packing is a pure, reversible integer function — no floats, so it plays nicely
//! with the determinism contract.

use crate::deal::DealOptions;
use crate::difficulty::Difficulty;

const BASE_BITS: u32 = 48;
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
    let diff = diff_code(o.difficulty) << 48;
    let magic_f = u64::from(o.magic_frequency.min(15)) << 50;
    let magic_on = u64::from(o.enable_magic) << 54;
    let wild_f = u64::from(o.wild_frequency.min(15)) << 55;
    let wild_on = u64::from(o.enable_wild) << 59;
    let guar = u64::from(o.guarantee_placeable) << 60;
    base | diff | magic_f | magic_on | wild_f | wild_on | guar
}

/// Unpack a transport seed into `(base_seed, options)`.
#[must_use]
pub fn unpack_seed(packed: u64) -> (u64, DealOptions) {
    let base = packed & BASE_MASK;
    let options = DealOptions {
        difficulty: diff_from(packed >> 48),
        magic_frequency: u32::try_from((packed >> 50) & 0b1111).unwrap_or(0),
        enable_magic: (packed >> 54) & 1 == 1,
        wild_frequency: u32::try_from((packed >> 55) & 0b1111).unwrap_or(0),
        enable_wild: (packed >> 59) & 1 == 1,
        guarantee_placeable: (packed >> 60) & 1 == 1,
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
                let (b, got) = unpack_seed(pack_seed(base, o));
                assert_eq!(b, base & BASE_MASK);
                assert_eq!(got, o);
            }
        }
    }
}
