//! The deterministic deal and the packed outcome-seed encoding.
//!
//! A deal is a seeded Fisher–Yates shuffle of `[colour i × cap]` chunked into
//! `colors` full tubes plus `empties` empty tubes (brief §4). The generator loop
//! (which rejects trivial deals and re-attempts until the solver certifies the
//! deal winnable) lives in `color-sort-solver`; this module owns only the pure,
//! solver-free deal for a given `attempt` so replay reconstructs it with no search.
//!
//! ## Packed outcome seed
//!
//! `pond_outcome::replay` receives a single `u64` seed, but a deal needs
//! `(base, attempt, colors, empties)` to reconstruct. They pack into one `u64`
//! that stays under `2^53` (an exact JSON `Number`, so the `?r=` share round-trips):
//!
//! | bits    | field   | width |
//! |---------|---------|-------|
//! | 0..32   | base    | 32    |
//! | 32..44  | attempt | 12    |
//! | 44..49  | colors  | 5     |
//! | 49..52  | empties | 3     |
//!
//! `cap` is always [`crate::board::CAP`], not encoded.

use crate::board::{State, CAP};
use crate::rng::DetRng;

/// The `(base, attempt, colors, empties)` deal parameters carried by a packed seed.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct DealParams {
    /// The shuffle base seed (32-bit).
    pub base: u32,
    /// The generator attempt index that produced a winnable deal (brief §4).
    pub attempt: u16,
    /// Number of colours (`n`).
    pub colors: u8,
    /// Number of empty tubes (`k`).
    pub empties: u8,
}

/// Pack deal parameters into a single `u64` outcome seed (see the module table).
#[must_use]
pub fn pack_seed(p: DealParams) -> u64 {
    (u64::from(p.base))
        | (u64::from(p.attempt & 0x0FFF) << 32)
        | (u64::from(p.colors & 0x1F) << 44)
        | (u64::from(p.empties & 0x07) << 49)
}

/// Unpack a `u64` outcome seed back into deal parameters.
#[must_use]
pub fn unpack_seed(s: u64) -> DealParams {
    DealParams {
        base: (s & 0xFFFF_FFFF) as u32,
        attempt: ((s >> 32) & 0x0FFF) as u16,
        colors: ((s >> 44) & 0x1F) as u8,
        empties: ((s >> 49) & 0x07) as u8,
    }
}

/// The RNG seed for a given `(base, attempt)`: attempt mixes in so each re-attempt
/// draws an independent stream, deterministically.
#[must_use]
fn rng_seed(base: u32, attempt: u16) -> u64 {
    u64::from(base) ^ u64::from(attempt).wrapping_mul(0x9E37_79B9_7F4A_7C15)
}

/// The deterministic deal for `params` (brief §4). Pure and solver-free: the same
/// parameters always yield the same tubes, so replay reconstructs it exactly.
#[must_use]
pub fn deal(params: DealParams) -> State {
    let n = params.colors as usize;
    let mut pool: Vec<u8> = Vec::with_capacity(n * CAP);
    for c in 0..n {
        for _ in 0..CAP {
            pool.push(c as u8);
        }
    }
    let mut rng = DetRng::from_seed(rng_seed(params.base, params.attempt));
    rng.shuffle(&mut pool);

    let mut tubes: Vec<Vec<u8>> = pool.chunks(CAP).map(<[u8]>::to_vec).collect();
    for _ in 0..params.empties {
        tubes.push(Vec::new());
    }
    #[allow(clippy::cast_possible_truncation)]
    State::from_tubes(tubes, params.colors, CAP as u8)
}

/// The deal from a packed outcome seed.
#[must_use]
pub fn deal_from_seed(seed: u64) -> State {
    deal(unpack_seed(seed))
}
