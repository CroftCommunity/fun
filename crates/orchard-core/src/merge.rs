//! The merge rule — which two fruit combine when several touch at once.
//!
//! This is the subtlest correctness requirement in the game. When three
//! same-tier fruit touch in one tick, **which two merge decides the whole rest
//! of the run**: the survivor's position, the next contact, the score, every
//! drop after it. The vendored game resolved this incidentally, from Matter's
//! internal pair order plus a `Set` of already-merged ids — reproducible only by
//! accident, and not reproducible at all across engines.
//!
//! Here it is a rule:
//!
//! > Walk the contact list **in the order given**. Merge a pair when both bodies
//! > are the same tier and neither has already been consumed this tick.
//!
//! The list arrives already sorted canonically by `pond-physics` (walls first,
//! then by low id, high id), which is why this function does not sort it again.
//! A second sort here would be a second, silently different opinion about order,
//! and the two would diverge the first time one changed.

use std::collections::{BTreeMap, BTreeSet};

use pond_physics::body::BodyId;
use pond_physics::world::ContactPair;

/// Two fruit that will combine, and the tier **they are** — not the tier that
/// results. The caller adds one, except at the top of the ladder where two
/// watermelons pop and nothing is created.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Merge {
    /// The lower-id body.
    pub a: BodyId,
    /// The higher-id body.
    pub b: BodyId,
    /// The tier both bodies are.
    pub tier: u8,
}

/// Resolve this tick's merges from the contact list and the id→tier map.
///
/// Contacts naming a body that is not in `tiers` are skipped rather than
/// treated as an error: a body removed by an earlier merge in the same tick can
/// still appear in a later contact, and that is ordinary rather than exceptional.
#[must_use]
pub fn resolve(contacts: &[ContactPair], tiers: &BTreeMap<BodyId, u8>) -> Vec<Merge> {
    let mut consumed: BTreeSet<BodyId> = BTreeSet::new();
    let mut out = Vec::new();

    for c in contacts {
        if consumed.contains(&c.a) || consumed.contains(&c.b) {
            continue;
        }
        let (Some(&ta), Some(&tb)) = (tiers.get(&c.a), tiers.get(&c.b)) else {
            continue;
        };
        if ta != tb {
            continue;
        }
        consumed.insert(c.a);
        consumed.insert(c.b);
        out.push(Merge {
            a: c.a,
            b: c.b,
            tier: ta,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pair(a: u32, b: u32) -> ContactPair {
        ContactPair {
            a: BodyId(a),
            b: BodyId(b),
        }
    }

    fn tiers(pairs: &[(u32, u8)]) -> BTreeMap<BodyId, u8> {
        pairs.iter().map(|&(id, t)| (BodyId(id), t)).collect()
    }

    #[test]
    fn two_fruit_of_the_same_tier_merge() {
        let m = resolve(&[pair(1, 2)], &tiers(&[(1, 3), (2, 3)]));
        assert_eq!(
            m,
            vec![Merge {
                a: BodyId(1),
                b: BodyId(2),
                tier: 3
            }]
        );
    }

    #[test]
    fn fruit_of_different_tiers_do_not_merge() {
        assert!(resolve(&[pair(1, 2)], &tiers(&[(1, 3), (2, 4)])).is_empty());
    }

    #[test]
    fn a_contact_with_an_unknown_body_is_ignored() {
        // Defensive, and reachable: a body can be removed by one merge while a
        // later contact in the same tick still names it.
        assert!(resolve(&[pair(1, 9)], &tiers(&[(1, 3)])).is_empty());
    }

    #[test]
    fn three_touching_fruit_merge_exactly_one_pair_and_the_lowest_ids_win() {
        // THE tie-break. When three same-tier fruit touch in one tick, which two
        // merge decides the whole rest of the game. The rule is: canonical
        // contact order, first wins, each body consumed at most once per tick.
        // The vendored game resolved this incidentally from Matter's pair order
        // plus a Set; ours resolves it by rule, so it is reproducible.
        let m = resolve(&[pair(1, 2), pair(2, 3)], &tiers(&[(1, 3), (2, 3), (3, 3)]));
        assert_eq!(
            m,
            vec![Merge {
                a: BodyId(1),
                b: BodyId(2),
                tier: 3
            }]
        );
    }

    #[test]
    fn the_tie_break_follows_contact_order_not_id_order() {
        // Same three bodies, but body 3 touches body 1 first in the contact
        // list. The rule reads the list it is given — the physics has already
        // sorted it canonically, and re-sorting here would be a second, silently
        // different opinion about order.
        let m = resolve(&[pair(1, 3), pair(1, 2)], &tiers(&[(1, 3), (2, 3), (3, 3)]));
        assert_eq!(
            m,
            vec![Merge {
                a: BodyId(1),
                b: BodyId(3),
                tier: 3
            }]
        );
    }

    #[test]
    fn four_fruit_in_two_disjoint_pairs_both_merge() {
        // Consuming a body blocks only the pairs that share it.
        let m = resolve(
            &[pair(1, 2), pair(3, 4)],
            &tiers(&[(1, 5), (2, 5), (3, 5), (4, 5)]),
        );
        assert_eq!(m.len(), 2);
        assert_eq!(m[0].a, BodyId(1));
        assert_eq!(m[1].a, BodyId(3));
    }

    #[test]
    fn a_body_already_consumed_cannot_merge_again_in_the_same_tick() {
        // Without this a chain of four would collapse to one in a single tick,
        // scoring twice for the same fruit.
        let m = resolve(
            &[pair(1, 2), pair(2, 3), pair(3, 4)],
            &tiers(&[(1, 2), (2, 2), (3, 2), (4, 2)]),
        );
        assert_eq!(m.len(), 2, "expected (1,2) and (3,4): {m:?}");
        assert_eq!(
            m[0],
            Merge {
                a: BodyId(1),
                b: BodyId(2),
                tier: 2
            }
        );
        assert_eq!(
            m[1],
            Merge {
                a: BodyId(3),
                b: BodyId(4),
                tier: 2
            }
        );
    }

    #[test]
    fn the_merge_reports_the_tier_that_was_consumed_not_the_one_created() {
        // The caller needs both, and derives the created tier by adding one —
        // except at the top of the ladder, where nothing is created at all.
        let m = resolve(&[pair(1, 2)], &tiers(&[(1, 10), (2, 10)]));
        assert_eq!(m[0].tier, 10);
    }

    #[test]
    fn no_contacts_means_no_merges() {
        assert!(resolve(&[], &tiers(&[(1, 3), (2, 3)])).is_empty());
    }
}
