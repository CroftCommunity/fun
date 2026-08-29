//! The crib table: expected crib score for the two cards a seat throws,
//! indexed by (lower rank, higher rank, suited), in hundredths of a point.
//!
//! Generated once from the core's scorer under the shipped discard policy and
//! **checked in** (`crib_table_data.rs`), the solitaire-pack pattern: a table
//! computed at runtime is a table nobody diffs, and a regeneration test is how a
//! scorer change re-locks it deliberately. Phase 0 measured that the assumed
//! opponent policy moves the table by 0.17 pts mean against a 0.11 noise floor,
//! so one table serves both seats.

use cribbage_core::card::{full_deck, Card};
use cribbage_core::rng::DetRng;
use cribbage_core::score::score_hand;

use crate::crib_table_data::SHIPPED;
use crate::expect::hand_expectation;

/// Entries: 14 × 14 rank pairs × suited flag.
pub const ENTRIES: usize = 14 * 14 * 2;

/// The table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CribTable {
    entries: Vec<i32>,
}

impl CribTable {
    /// The checked-in table the engine ships with.
    #[must_use]
    pub fn shipped() -> CribTable {
        CribTable {
            entries: SHIPPED.to_vec(),
        }
    }

    /// The index for a throw of `a` and `b`.
    #[must_use]
    pub fn key(a: Card, b: Card) -> usize {
        let (lo, hi) = if a.rank <= b.rank {
            (a.rank, b.rank)
        } else {
            (b.rank, a.rank)
        };
        (usize::from(lo) * 14 + usize::from(hi)) * 2 + usize::from(a.suit == b.suit)
    }

    /// Expected crib score, in hundredths, for throwing `a` and `b`.
    #[must_use]
    pub fn get(&self, a: Card, b: Card) -> i32 {
        self.entries[Self::key(a, b)]
    }

    /// The raw entries, for the generator's output.
    #[must_use]
    pub fn entries(&self) -> &[i32] {
        &self.entries
    }

    /// Regenerate: `samples` random deals, the other seat throwing by hand-only
    /// expectation, a random cut, every one of our fifteen throws scored into
    /// that crib. Deterministic in `seed`.
    #[must_use]
    pub fn generate(samples: u32, seed: u64) -> CribTable {
        let mut rng = DetRng::from_seed(seed);
        let mut sum = vec![0i64; ENTRIES];
        let mut count = vec![0i64; ENTRIES];
        let mut deck = full_deck();
        for _ in 0..samples {
            rng.shuffle(&mut deck);
            let ours: [Card; 6] = [deck[0], deck[1], deck[2], deck[3], deck[4], deck[5]];
            let theirs: [Card; 6] = [deck[6], deck[7], deck[8], deck[9], deck[10], deck[11]];
            let cut = deck[12];
            let (t1, t2) = best_hand_only_throw(&theirs);
            for a in 0..6 {
                for b in a + 1..6 {
                    let crib = [ours[a], ours[b], t1, t2];
                    let k = Self::key(ours[a], ours[b]);
                    sum[k] += i64::from(score_hand(&crib, cut, true).total()) * 100;
                    count[k] += 1;
                }
            }
        }
        let entries = sum
            .iter()
            .zip(&count)
            .map(|(s, c)| if *c > 0 { (s / c) as i32 } else { 0 })
            .collect();
        CribTable { entries }
    }
}

/// The other seat's throw under the hand-only policy: keep the four with the
/// highest expectation over the cuts, ignore the crib. (The policy that does
/// not need the table it is generating.)
pub(crate) fn best_hand_only_throw(six: &[Card; 6]) -> (Card, Card) {
    let mut best: Option<(i32, (Card, Card))> = None;
    for a in 0..6 {
        for b in a + 1..6 {
            let keep: Vec<Card> = six
                .iter()
                .enumerate()
                .filter(|(k, _)| *k != a && *k != b)
                .map(|(_, c)| *c)
                .collect();
            let v = hand_expectation(&[keep[0], keep[1], keep[2], keep[3]], six);
            if best.is_none_or(|(bv, _)| v > bv) {
                best = Some((v, (six[a], six[b])));
            }
        }
    }
    best.map_or((six[0], six[1]), |(_, t)| t)
}

impl CribTable {}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(rank: u8, suit: u8) -> Card {
        Card { rank, suit }
    }

    #[test]
    #[cfg_attr(
        debug_assertions,
        ignore = "20k samples take minutes in debug; the release gate runs it"
    )]
    fn the_shipped_table_is_the_generator_output() {
        // 20,000 samples, seed 1 — the numbers the generator test prints.
        assert_eq!(CribTable::generate(20_000, 1), CribTable::shipped());
    }

    /// Runs in debug too (the 20k-sample regeneration does not), so the
    /// generator is exercised under `cargo mutants`: mutation audit 2026-08-29
    /// found every arithmetic mutant in `generate` surviving because nothing
    /// ran it in a debug build.
    #[test]
    fn a_small_generation_is_deterministic_plausible_and_ranks_the_throws() {
        let a = CribTable::generate(300, 1);
        assert_eq!(a, CribTable::generate(300, 1), "deterministic in the seed");
        assert_ne!(
            a,
            CribTable::generate(300, 2),
            "and different for another seed"
        );
        let filled: Vec<i32> = a.entries().iter().copied().filter(|&v| v != 0).collect();
        assert!(
            filled.len() > 150,
            "most rank pairs were sampled: {}",
            filled.len()
        );
        assert!(
            filled.iter().all(|&v| (50..=1500).contains(&v)),
            "a crib averages 0.5–15: {filled:?}"
        );
        // 300 samples is enough for the strongest throw to rank above the weakest.
        assert!(a.get(c(5, 0), c(5, 1)) > a.get(c(13, 0), c(9, 1)));
        assert_eq!(a.entries().len(), ENTRIES);
        assert_eq!(
            a.entries()[CribTable::key(c(5, 0), c(5, 1))],
            a.get(c(5, 0), c(5, 1))
        );
    }

    #[test]
    fn the_hand_only_policy_keeps_the_four_with_the_highest_expectation() {
        // Three fives and a jack are the keep; the 2 and the 9 are the throw.
        let six = [c(5, 3), c(5, 2), c(2, 0), c(5, 1), c(9, 1), c(11, 0)];
        let (t1, t2) = best_hand_only_throw(&six);
        let mut thrown = [t1.rank, t2.rank];
        thrown.sort_unstable();
        assert_eq!(thrown, [2, 9]);
        // and it beats every other keep, not merely a plausible one
        let keep = [c(5, 3), c(5, 2), c(5, 1), c(11, 0)];
        let best = hand_expectation(&keep, &six);
        for a in 0..6 {
            for b in a + 1..6 {
                let k: Vec<Card> = six
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != a && *i != b)
                    .map(|(_, x)| *x)
                    .collect();
                assert!(hand_expectation(&[k[0], k[1], k[2], k[3]], &six) <= best);
            }
        }
    }

    #[test]
    fn fives_are_the_best_throw_and_a_king_ten_is_a_poor_one() {
        let t = CribTable::shipped();
        assert!(
            t.get(c(5, 0), c(5, 1)) > 800,
            "5-5 into a crib averages over 8"
        );
        assert!(t.get(c(13, 0), c(10, 1)) < 400);
        assert!(t.get(c(5, 0), c(5, 1)) > t.get(c(13, 0), c(10, 1)));
        assert!(
            t.get(c(7, 0), c(8, 0)) >= t.get(c(7, 0), c(8, 1)),
            "suited is never worse"
        );
    }

    #[test]
    fn key_is_symmetric_in_the_pair() {
        assert_eq!(
            CribTable::key(c(3, 0), c(9, 1)),
            CribTable::key(c(9, 1), c(3, 0))
        );
        assert_ne!(
            CribTable::key(c(3, 0), c(9, 0)),
            CribTable::key(c(3, 0), c(9, 1))
        );
    }

    /// `cargo test -p cribbage-solver --release -- --ignored --nocapture gen_table`
    /// prints `crib_table_data.rs`.
    #[test]
    #[ignore = "a generator, run by hand to re-lock the artefact"]
    fn gen_table() {
        let t = CribTable::generate(20_000, 1);
        println!("//! GENERATED by `crib_table::tests::gen_table` (20,000 samples, seed 1). Do not edit.\n");
        println!("/// The shipped crib table, hundredths of a point.");
        println!("pub(crate) const SHIPPED: [i32; {ENTRIES}] = [");
        for chunk in t.entries().chunks(14) {
            let row: Vec<String> = chunk.iter().map(ToString::to_string).collect();
            println!("    {},", row.join(", "));
        }
        println!("];");
    }
}
