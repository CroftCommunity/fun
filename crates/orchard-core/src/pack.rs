//! The daily seed-pack: a deterministic, byte-identically regenerable schedule
//! of daily seeds.
//!
//! **No solver, and that is a claim rather than an omission.** Orchard Drop is
//! never unwinnable: the crate starts empty, every seed deals a droppable fruit,
//! and there is no deal that cannot be played. So the pack collapses to a
//! *seeded shuffle* of a seed range — a year of non-repeating, non-sequential
//! dailies — with none of the winnability search solitaire and bubble need. It
//! keeps the machinery the rest of the shelf uses (a `pond-docformat` envelope,
//! byte-identical regeneration, indexed by UTC day) without shipping an empty
//! solver crate to look symmetric. Whether you grow a watermelon is skill, not
//! seed.
//!
//! `every_daily_seed_is_playable` checks that claim rather than asserting it.

use serde::{Deserialize, Serialize};

/// The daily seed schedule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pack {
    /// Daily seeds, indexed by date at runtime (`seeds[day % len]`). A shuffle
    /// of distinct seeds, so dailies neither repeat nor run in order.
    pub seeds: Vec<u64>,
    /// One seed called out for tests and the board E2E, so a fixture does not
    /// have to hardcode a number that the pack could later reshuffle.
    pub fixture: u64,
}

/// A deterministic `splitmix64` step — self-contained, so the shuffle needs no
/// `rand` dependency and the same inputs regenerate byte-identically. Matches
/// the generator `twenty48-core` uses for the same job.
fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Generate the pack: a Fisher-Yates shuffle of `0..pool` seeded from
/// `master_seed`, truncated to `count` daily seeds.
///
/// # Panics
/// Panics if `count` is not in `1..=pool`. That is a build-time
/// misconfiguration — the schedule cannot be empty or exceed the seed pool —
/// and is never reachable at runtime, because the pack is generated offline and
/// committed.
#[must_use]
pub fn generate_pack(master_seed: u64, pool: usize, count: usize) -> Pack {
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
    let fixture = seeds[0];
    Pack { seeds, fixture }
}

/// The seed for `day_index`, wrapping so the calendar never runs out.
///
/// # Panics
/// Panics on an empty pack, which `generate_pack` cannot produce.
#[must_use]
pub fn daily_seed(pack: &Pack, day_index: u64) -> u64 {
    assert!(!pack.seeds.is_empty(), "an empty pack has no dailies");
    pack.seeds[(day_index % pack.seeds.len() as u64) as usize]
}

/// Serialize a pack through the `pond-docformat` envelope
/// (`kind = "orchard-daily-pack"`, version 1).
///
/// # Errors
/// Propagates [`pond_docformat::DocError`] on a serialization failure.
#[cfg(test)]
pub fn pack_to_doc(pack: &Pack) -> Result<Vec<u8>, pond_docformat::DocError> {
    pond_docformat::write("orchard-daily-pack", 1, pack)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MASTER: u64 = 0x0C_A5E5_0001;
    const POOL: usize = 4096;
    const COUNT: usize = 366;

    fn pack() -> Pack {
        generate_pack(MASTER, POOL, COUNT)
    }

    #[test]
    fn a_pack_holds_a_year_of_dailies() {
        assert_eq!(pack().seeds.len(), COUNT);
    }

    #[test]
    fn the_same_master_seed_regenerates_the_pack_byte_identically() {
        // The pack is generated offline and committed. If regeneration were not
        // exact, a rebuild would silently reissue everyone's dailies.
        assert_eq!(pack(), pack());
    }

    #[test]
    fn a_different_master_seed_produces_a_different_pack() {
        assert_ne!(pack(), generate_pack(MASTER + 1, POOL, COUNT));
    }

    #[test]
    fn dailies_do_not_repeat_within_the_year() {
        let p = pack();
        let mut seen = p.seeds.clone();
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), p.seeds.len(), "a seed repeats inside one year");
    }

    #[test]
    fn dailies_do_not_run_in_order() {
        // A shuffle, not a counter: consecutive days must not be consecutive
        // seeds, or a player could predict tomorrow from today.
        let p = pack();
        let sequential = p.seeds.windows(2).filter(|w| w[1] == w[0] + 1).count();
        assert!(
            sequential < 5,
            "{sequential} consecutive pairs — this is a counter, not a shuffle"
        );
    }

    #[test]
    fn the_day_index_wraps_so_the_calendar_never_runs_out() {
        let p = pack();
        assert_eq!(daily_seed(&p, 0), p.seeds[0]);
        assert_eq!(
            daily_seed(&p, COUNT as u64),
            p.seeds[0],
            "day 366 wraps to day 0"
        );
        assert_eq!(daily_seed(&p, COUNT as u64 + 3), p.seeds[3]);
    }

    #[test]
    fn every_daily_seed_is_playable() {
        // The believability guard. Orchard Drop is never unwinnable — every seed
        // deals a droppable fruit and the crate starts empty — so the pack needs
        // no solver. That claim is worth checking rather than asserting: play a
        // few drops on every daily and confirm none is dead on arrival.
        use crate::game::{Game, Move, COOLDOWN_TICKS};
        for (day, &seed) in pack().seeds.iter().enumerate() {
            let mut g = Game::new(seed);
            assert!(
                crate::ladder::is_droppable(g.held()),
                "day {day} deals an undroppable fruit"
            );
            g.apply(Move::Drop { tick: 0, x: 220 })
                .expect("the first drop is always legal");
            g.apply(Move::Drop {
                tick: COOLDOWN_TICKS,
                x: 120,
            })
            .expect("the second drop is always legal");
            assert!(!g.is_over(), "day {day} was over after two drops");
        }
    }

    #[test]
    fn the_pack_is_a_recorded_schedule_not_merely_a_deterministic_one() {
        // GOLDEN VECTOR. Every property test above ("no repeats", "not
        // sequential", "regenerates identically") is satisfied by ANY decent
        // scrambler, which is why mutating splitmix64's arithmetic survived nine
        // ways. Only recorded output pins the generator — and it has to be
        // pinned, because these seeds are the dailies people will play.
        //
        // The expected values were derived from an INDEPENDENT reimplementation
        // of splitmix64 and Fisher-Yates (in Python), not recorded from this
        // code's own output. A golden vector copied from the thing it checks
        // pins that the code has not changed; one derived separately pins that
        // the code is right.
        let p = pack();
        assert_eq!(
            &p.seeds[..6],
            &[823, 3807, 2003, 2490, 3369, 3025],
            "the daily schedule changed — if that was intended, say so in the commit"
        );
        assert_eq!(p.fixture, p.seeds[0]);
    }

    #[test]
    fn the_fixture_is_one_of_the_pack_seeds() {
        let p = pack();
        assert!(p.seeds.contains(&p.fixture));
    }

    #[test]
    #[should_panic(expected = "seed pool")]
    fn a_count_larger_than_the_pool_is_a_build_time_error() {
        let _ = generate_pack(MASTER, 10, 11);
    }
}
