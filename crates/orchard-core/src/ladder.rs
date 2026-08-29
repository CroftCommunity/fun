//! The fruit ladder: eleven tiers, cherry to watermelon.
//!
//! Every number here is transcribed from the vendored game's `FRUITS` table and
//! `MERGE_SCORE` array (`src/games/orchard-drop/vendor/index.html`), so the
//! rebuilt game plays the ladder the wrap played. The scoring is the Switch
//! original's: **triangular numbers, awarded on the merge that creates a tier**,
//! which is why `merge_score` computes `n(n+1)/2` rather than indexing a copied
//! array — a formula cannot suffer a transcription slip.

/// How many tiers the ladder has.
pub const TIERS: usize = 11;

/// Only the lowest this many tiers spawn from the top (`DROPPABLE`).
///
/// The rule the whole game rests on: **bigger fruit only ever appears by
/// merging.** Change it and the ladder stops being a ladder.
pub const DROPPABLE: u8 = 5;

/// Radii in px, by tier.
const RADII: [i64; TIERS] = [17, 25, 33, 41, 50, 60, 72, 85, 99, 113, 128];

/// Names, by tier. Presentational, but they belong beside the radii they go with.
const NAMES: [&str; TIERS] = [
    "cherry",
    "strawberry",
    "grape",
    "dekopon",
    "persimmon",
    "apple",
    "pear",
    "peach",
    "pineapple",
    "melon",
    "watermelon",
];

/// The radius of `tier`, in whole px.
///
/// # Panics
/// Panics if `tier` is past the ladder. That is a bug in the caller, and a
/// default radius would hide it inside the physics where it would surface as
/// mysterious behaviour rather than a stack trace.
#[must_use]
pub fn radius_px(tier: u8) -> i64 {
    assert!((tier as usize) < TIERS, "tier {tier} is past the ladder");
    RADII[tier as usize]
}

/// The score awarded for the merge that **creates** `tier`.
///
/// Triangular: `n(n+1)/2`. Creating a cherry scores nothing, because cherries
/// are dropped rather than merged into existence.
///
/// # Panics
/// Panics if `tier` is past the ladder — see [`radius_px`].
#[must_use]
pub fn merge_score(tier: u8) -> u64 {
    assert!((tier as usize) < TIERS, "tier {tier} is past the ladder");
    let n = u64::from(tier);
    n * (n + 1) / 2
}

/// Whether `tier` can spawn from the top.
#[must_use]
pub const fn is_droppable(tier: u8) -> bool {
    tier < DROPPABLE
}

/// The name of `tier`.
///
/// # Panics
/// Panics if `tier` is past the ladder — see [`radius_px`].
#[must_use]
pub fn name(tier: u8) -> &'static str {
    assert!((tier as usize) < TIERS, "tier {tier} is past the ladder");
    NAMES[tier as usize]
}

/// The top of the ladder. Two of these pop for a bonus rather than merging.
pub const TOP: u8 = (TIERS - 1) as u8;

#[cfg(test)]
mod tests {
    use super::*;

    // Every number here is transcribed from the vendored game's FRUITS table and
    // MERGE_SCORE array (src/games/orchard-drop/vendor/index.html). They are
    // data, and data gets a failing test first like anything else — this is the
    // category CLAUDE.md names as the one people rationalise past.

    #[test]
    fn the_ladder_is_eleven_tiers_cherry_to_watermelon() {
        assert_eq!(TIERS, 11);
        assert_eq!(name(0), "cherry");
        assert_eq!(name(10), "watermelon");
    }

    #[test]
    fn radii_match_the_vendored_table() {
        let expected = [17i64, 25, 33, 41, 50, 60, 72, 85, 99, 113, 128];
        for (tier, &r) in expected.iter().enumerate() {
            assert_eq!(radius_px(tier as u8), r, "tier {tier}");
        }
    }

    #[test]
    fn radii_increase_strictly_so_a_merge_always_grows() {
        for tier in 1..TIERS as u8 {
            assert!(
                radius_px(tier) > radius_px(tier - 1),
                "tier {tier} is not larger than {}",
                tier - 1
            );
        }
    }

    #[test]
    fn merge_scores_are_the_triangular_numbers() {
        // The Switch original's scoring: tier n is awarded n*(n+1)/2, given on
        // the merge that CREATES tier n. Stated as the formula rather than a
        // copied array, so a transcription slip cannot pass.
        for tier in 0..TIERS as u8 {
            let n = u64::from(tier);
            assert_eq!(merge_score(tier), n * (n + 1) / 2, "tier {tier}");
        }
        // ... and spot-checked against the vendored array itself.
        assert_eq!(merge_score(1), 1);
        assert_eq!(merge_score(10), 55);
    }

    #[test]
    fn creating_a_cherry_scores_nothing_because_cherries_are_dropped_not_merged() {
        assert_eq!(merge_score(0), 0);
    }

    #[test]
    fn the_top_of_the_ladder_is_the_watermelon() {
        // TOP drives the watermelon pop and the `won` condition, and was
        // derived from TIERS without ever being checked — mutating the
        // subtraction changed it silently.
        assert_eq!(TOP, 10);
        assert_eq!(name(TOP), "watermelon");
        assert_eq!(radius_px(TOP), 128);
        assert_eq!(TOP as usize, TIERS - 1, "TOP is the last valid tier");
    }

    #[test]
    fn only_the_lowest_five_tiers_spawn_from_the_top() {
        // DROPPABLE = 5. Bigger fruit only ever appears by merging — the rule the
        // whole game rests on. Boundary at 4/5, not just a happy point.
        for tier in 0..5u8 {
            assert!(is_droppable(tier), "tier {tier} should be droppable");
        }
        for tier in 5..TIERS as u8 {
            assert!(!is_droppable(tier), "tier {tier} must not be droppable");
        }
    }

    #[test]
    #[should_panic(expected = "tier")]
    fn a_tier_past_the_ladder_is_a_programming_error_not_a_silent_zero() {
        // Fail loud: a bad tier is a bug in the caller, and returning a default
        // radius would hide it inside the physics.
        let _ = radius_px(11);
    }
}
