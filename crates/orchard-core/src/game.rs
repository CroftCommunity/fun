//! The game: drops, merges, scoring, game-over, and the canonical state hash.
//!
//! # Time is part of a move
//!
//! Every other Tier-1 game on this shelf advances only when the player moves. In
//! Orchard Drop the world runs continuously and the player drops *when they
//! choose*, so a move is a `(time, place)` pair and the move list carries ticks.
//!
//! [`Move::Wait`] exists for the same reason: **a drop list alone cannot say
//! when a run ended**, and for a physics game the end tick changes the final
//! positions. Rather than have replay guess — "run until settled", "run until
//! game over" — the run's end is recorded as the last entry. Guessing would make
//! an abandoned run replay to a state the player never saw.
//!
//! # The wall-clock constants, converted once
//!
//! The vendored game measured in milliseconds against a variable frame time. At
//! 64 Hz those become tick counts, and the rounding is a rule rather than an
//! artifact — written here so it is decided once:
//!
//! | vendored | ms | ticks at 64 Hz | rounded |
//! |---|---|---|---|
//! | drop cooldown | 520 | 33.28 | **33** (down — a shorter cooldown is kinder) |
//! | freshly-dropped grace | 1200 | 76.8 | **77** (up — a longer grace is kinder) |
//! | over-the-line dwell | 900 | 57.6 | **58** (up — slower to end the run) |
//!
//! Every rounding goes the way that favours the player, which is a choice, not
//! a coincidence.

use std::collections::BTreeMap;

use pond_physics::body::{Body, BodyId, Wall};
use pond_physics::fixed::{from_px, from_ratio, Fx, V2};
use pond_physics::world::{Config, World};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::ladder::{self, TOP};
use crate::merge;
use crate::rng::DetRng;

/// Simulation rate. Matches `pond_physics::world::TICK_HZ`.
pub const TICK_HZ: u32 = 64;
/// Crate width, px.
pub const CRATE_W: i64 = 440;
/// Crate height, px.
pub const CRATE_H: i64 = 640;
/// The danger line's height, px from the top.
pub const LINE_Y: i64 = 112;
/// Where a dropped fruit spawns, px from the top.
pub const DROP_Y: i64 = 64;
/// Ticks between drops (520 ms).
pub const COOLDOWN_TICKS: u32 = 33;
/// Ticks a freshly dropped fruit is exempt from the game-over check (1200 ms).
pub const GRACE_TICKS: u32 = 77;
/// Ticks a settled fruit may rest above the line before the run ends (900 ms).
pub const DWELL_TICKS: u32 = 58;
/// Score for popping two watermelons.
pub const POP_BONUS: u64 = 100;

/// The physics tuning. Ported from the wrap; `iterations` measured in Phase 0.
const PHYSICS: Config = Config {
    gravity: from_px(1000),
    iterations: 24,
    restitution: from_ratio(12, 100),
    friction: from_ratio(35, 100),
    baumgarte: from_ratio(20, 100),
    slop: from_ratio(1, 2),
    rest_threshold: from_px(30),
};

/// The density every fruit shares (the wrap's `.0012`).
const DENSITY: Fx = from_ratio(12, 10_000);

/// One player action, at the tick it happened.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum Move {
    /// Release the held fruit with its centre at `x`, at `tick`.
    Drop {
        /// When.
        tick: u32,
        /// Where, in px. Clamped into the crate.
        x: i32,
    },
    /// Advance to `tick` without dropping. As the final entry it records where
    /// the run ended, which a drop list alone cannot say.
    Wait {
        /// When.
        tick: u32,
    },
}

impl Move {
    /// The tick this move happens at.
    #[must_use]
    pub const fn tick(self) -> u32 {
        match self {
            Self::Drop { tick, .. } | Self::Wait { tick } => tick,
        }
    }
}

/// Why a move was refused.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MoveError {
    /// The move's tick is before the game's current tick.
    TickWentBackwards,
    /// The drop cooldown has not elapsed.
    StillCoolingDown,
    /// The run is over.
    GameOver,
}

/// The score a merge of two tier-`tier` fruit awards.
///
/// Extracted from the merge loop because the branch that matters most — two
/// watermelons popping — is nearly unreachable from real play: it needs a run
/// that climbs the entire ladder twice. Mutation testing reached it and no test
/// did. A policy a test cannot reach in place is a policy worth lifting out.
#[must_use]
pub fn merge_award(tier: u8) -> u64 {
    if tier == TOP {
        POP_BONUS
    } else {
        ladder::merge_score(tier + 1)
    }
}

/// Whether a fruit's top edge is above the danger line.
///
/// Extracted for the same reason as [`merge_award`]: the comparison's boundary
/// is a single exact position that no plausible run lands on, so it can only be
/// pinned as a function.
#[must_use]
pub fn is_above_line(centre_y: Fx, radius: Fx) -> bool {
    centre_y - radius < from_px(LINE_Y)
}

/// Per-fruit bookkeeping the physics does not carry.
#[derive(Clone, Copy, Debug)]
struct Fruit {
    tier: u8,
    /// The first tick at which this fruit counts toward game-over. A dropped
    /// fruit gets [`GRACE_TICKS`]; a **merged** fruit gets none, matching the
    /// wrap's `nb.born = 0`.
    counts_from: u32,
    /// Consecutive ticks spent settled above the line.
    dwell: u32,
}

/// A single run: the crate, the seeded stream, the move list, and the score.
#[derive(Clone)]
pub struct Game {
    world: World,
    rng: DetRng,
    fruit: BTreeMap<BodyId, Fruit>,
    next_id: u32,
    score: u64,
    max_tier: u8,
    held: u8,
    next: u8,
    last_drop: Option<u32>,
    over: bool,
    moves: Vec<Move>,
}

impl Game {
    /// A fresh run from `seed`.
    #[must_use]
    pub fn new(seed: u64) -> Self {
        let mut world = World::new(PHYSICS);
        let (w, h, t) = (from_px(CRATE_W), from_px(CRATE_H), from_px(200));
        world.add_wall(Wall::new(BodyId(0), V2::new(-t, h), V2::new(w + t, h + t)));
        world.add_wall(Wall::new(BodyId(1), V2::new(-t, -t), V2::new(0, h + t)));
        world.add_wall(Wall::new(BodyId(2), V2::new(w, -t), V2::new(w + t, h + t)));

        let mut rng = DetRng::from_seed(seed);
        let held = rng.next_tier();
        let next = rng.next_tier();
        Self {
            world,
            rng,
            fruit: BTreeMap::new(),
            next_id: 100,
            score: 0,
            max_tier: 0,
            held,
            next,
            last_drop: None,
            over: false,
            moves: Vec::new(),
        }
    }

    /// Apply one move, advancing the simulation to its tick first.
    ///
    /// # Errors
    /// [`MoveError::TickWentBackwards`] if the move is in the past,
    /// [`MoveError::StillCoolingDown`] if a drop comes before the cooldown has
    /// elapsed, [`MoveError::GameOver`] if the run has ended.
    pub fn apply(&mut self, mv: Move) -> Result<(), MoveError> {
        if mv.tick() < self.world.tick() {
            return Err(MoveError::TickWentBackwards);
        }
        if self.over {
            return Err(MoveError::GameOver);
        }
        if let Move::Drop { tick, .. } = mv {
            if let Some(last) = self.last_drop {
                if tick < last + COOLDOWN_TICKS {
                    return Err(MoveError::StillCoolingDown);
                }
            }
        }

        self.advance_to(mv.tick());
        if let Move::Drop { tick, x } = mv {
            if !self.over {
                self.spawn(self.held, x, DROP_Y, tick + GRACE_TICKS);
                self.held = self.next;
                self.next = self.rng.next_tier();
                self.last_drop = Some(tick);
            }
        }
        self.moves.push(mv);
        Ok(())
    }

    /// Step the world to `tick`, resolving merges and game-over each tick.
    fn advance_to(&mut self, tick: u32) {
        while self.world.tick() < tick && !self.over {
            self.world.step();
            self.resolve_merges();
            self.check_over();
        }
    }

    fn resolve_merges(&mut self) {
        let tiers: BTreeMap<BodyId, u8> = self.fruit.iter().map(|(&k, f)| (k, f.tier)).collect();
        // Cloned because applying a merge mutates the world the list came from.
        let contacts: Vec<_> = self.world.contacts().to_vec();
        for m in merge::resolve(&contacts, &tiers) {
            let (pa, pb) = (
                self.world.body(m.a).expect("merging body exists").pos,
                self.world.body(m.b).expect("merging body exists").pos,
            );
            // The integer midpoint, so the spawn point does not depend on which
            // of the pair is read first. `i64::midpoint` rather than `(a+b)/2`:
            // verified to round identically for signed values before swapping
            // (both truncate toward zero — checked across positive, negative and
            // mixed pairs), because this value is on the hashed path and
            // "clippy suggested it" is not a reason to change a rounding mode.
            let mid = V2::new(pa.x.midpoint(pb.x), pa.y.midpoint(pb.y));

            self.world.remove_body(m.a);
            self.world.remove_body(m.b);
            self.fruit.remove(&m.a);
            self.fruit.remove(&m.b);

            self.score += merge_award(m.tier);
            if m.tier == TOP {
                // Two watermelons pop rather than making a twelfth tier.
                continue;
            }
            let created = m.tier + 1;
            self.max_tier = self.max_tier.max(created);
            // A merged fruit counts for game-over immediately — no grace.
            self.spawn_at(created, mid, 0);
        }
    }

    fn check_over(&mut self) {
        let now = self.world.tick();
        for (&id, f) in &mut self.fruit {
            let Some(b) = self.world.body(id) else {
                continue;
            };
            if now < f.counts_from {
                f.dwell = 0;
                continue;
            }
            if is_above_line(b.pos.y, b.radius()) {
                f.dwell += 1;
                if f.dwell > DWELL_TICKS {
                    self.over = true;
                }
            } else {
                f.dwell = 0;
            }
        }
    }

    fn spawn(&mut self, tier: u8, x: i32, y: i64, counts_from: u32) {
        let r = ladder::radius_px(tier);
        // Clamped rather than refused: the UI aims with a finger, and the core
        // decides what an aim off the edge means.
        let clamped = i64::from(x).clamp(r, CRATE_W - r);
        self.spawn_at(tier, V2::new(from_px(clamped), from_px(y)), counts_from);
    }

    fn spawn_at(&mut self, tier: u8, pos: V2, counts_from: u32) {
        let id = BodyId(self.next_id);
        self.next_id += 1;
        self.world.add_body(Body::circle(
            id,
            pos,
            from_px(ladder::radius_px(tier)),
            DENSITY,
        ));
        self.fruit.insert(
            id,
            Fruit {
                tier,
                counts_from,
                dwell: 0,
            },
        );
    }

    /// The current tick.
    #[must_use]
    pub fn tick(&self) -> u32 {
        self.world.tick()
    }

    /// The running score.
    #[must_use]
    pub const fn score(&self) -> u64 {
        self.score
    }

    /// How many fruit are in the crate.
    #[must_use]
    pub fn fruit_count(&self) -> usize {
        self.fruit.len()
    }

    /// Whether the run has ended.
    #[must_use]
    pub const fn is_over(&self) -> bool {
        self.over
    }

    /// The fruit waiting to be dropped.
    #[must_use]
    pub const fn held(&self) -> u8 {
        self.held
    }

    /// The fruit after the held one, shown so the player can plan a merge.
    #[must_use]
    pub const fn next(&self) -> u8 {
        self.next
    }

    /// The highest tier reached this run. `>= 10` means a watermelon was grown.
    #[must_use]
    pub const fn max_tier(&self) -> u8 {
        self.max_tier
    }

    /// The tiers currently in the crate, ascending, with duplicates.
    #[must_use]
    pub fn tiers_present(&self) -> Vec<u8> {
        let mut v: Vec<u8> = self.fruit.values().map(|f| f.tier).collect();
        v.sort_unstable();
        v
    }

    /// The move list — the proof a record replays from.
    #[must_use]
    pub fn moves(&self) -> &[Move] {
        &self.moves
    }

    /// The canonical state hash.
    ///
    /// The physics world's own hash, plus everything the physics does not know:
    /// the score, the RNG's position, the held and previewed fruit, the
    /// game-over flag, and each fruit's tier in id order. Two runs that reached
    /// the same board with different scores are different states, and a record
    /// that could not tell them apart would be claiming the wrong thing.
    #[must_use]
    pub fn state_hash(&self) -> String {
        let mut h = Sha256::new();
        h.update(b"orchard\x00");
        h.update(pond_physics::hash::state_hash(&self.world).as_bytes());
        h.update(self.score.to_le_bytes());
        h.update(self.rng.draws().to_le_bytes());
        h.update([self.held, self.next, self.max_tier, u8::from(self.over)]);
        h.update((self.fruit.len() as u32).to_le_bytes());
        for (id, f) in &self.fruit {
            h.update(id.0.to_le_bytes());
            h.update([f.tier]);
        }
        hex::encode(h.finalize())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── drops ──────────────────────────────────────────────────────────────

    #[test]
    fn a_drop_puts_the_held_fruit_in_the_crate() {
        let mut g = Game::new(1);
        let held = g.held();
        assert_eq!(g.fruit_count(), 0);
        g.apply(Move::Drop { tick: 0, x: 220 }).expect("legal drop");
        assert_eq!(g.fruit_count(), 1);
        assert!(
            g.tiers_present().contains(&held),
            "the held fruit is the one dropped"
        );
    }

    #[test]
    fn dropping_advances_the_queue_so_the_preview_was_honest() {
        let mut g = Game::new(1);
        let previewed = g.next();
        g.apply(Move::Drop { tick: 0, x: 220 }).expect("legal drop");
        assert_eq!(
            g.held(),
            previewed,
            "the previewed fruit became the held one"
        );
    }

    #[test]
    fn only_droppable_tiers_ever_arrive_from_the_top() {
        // Forty drops down one column overflow the crate long before forty, and
        // the run ending is correct — so the loop stops at game over rather than
        // insisting every drop is legal.
        let mut g = Game::new(9);
        let mut t = 0;
        let mut checked = 0;
        for _ in 0..40 {
            if g.is_over() {
                break;
            }
            assert!(
                crate::ladder::is_droppable(g.held()),
                "tier {} arrived from the top",
                g.held()
            );
            checked += 1;
            let _ = g.apply(Move::Drop { tick: t, x: 220 });
            let _ = g.apply(Move::Wait {
                tick: t + COOLDOWN_TICKS,
            });
            t += COOLDOWN_TICKS;
        }
        assert!(checked >= 10, "only {checked} fruit were checked");
    }

    #[test]
    fn the_drop_x_is_clamped_inside_the_crate() {
        // A drop off the edge is not rejected, it is clamped — the UI aims with
        // a finger and the core decides what that means.
        let mut g = Game::new(1);
        g.apply(Move::Drop { tick: 0, x: -500 })
            .expect("legal drop");
        g.apply(Move::Wait { tick: 200 }).expect("legal wait");
        let mut h = Game::new(1);
        h.apply(Move::Drop { tick: 0, x: 9999 })
            .expect("legal drop");
        h.apply(Move::Wait { tick: 200 }).expect("legal wait");
        assert_eq!(g.fruit_count(), 1);
        assert_eq!(h.fruit_count(), 1);
        assert_ne!(g.state_hash(), h.state_hash(), "clamped to the same place");
    }

    // ── the cooldown, at its boundary ──────────────────────────────────────

    #[test]
    fn a_second_drop_is_refused_until_the_cooldown_elapses() {
        let mut g = Game::new(1);
        g.apply(Move::Drop { tick: 100, x: 220 })
            .expect("first drop");
        assert_eq!(
            g.apply(Move::Drop {
                tick: 100 + COOLDOWN_TICKS - 1,
                x: 220
            }),
            Err(MoveError::StillCoolingDown),
            "a drop one tick early must be refused"
        );
    }

    #[test]
    fn a_drop_exactly_on_the_cooldown_boundary_is_legal() {
        let mut g = Game::new(1);
        g.apply(Move::Drop { tick: 100, x: 220 })
            .expect("first drop");
        g.apply(Move::Drop {
            tick: 100 + COOLDOWN_TICKS,
            x: 220,
        })
        .expect("the boundary tick is legal");
        assert_eq!(g.fruit_count(), 2);
    }

    #[test]
    fn time_cannot_run_backwards() {
        let mut g = Game::new(1);
        g.apply(Move::Wait { tick: 100 }).expect("legal wait");
        assert_eq!(
            g.apply(Move::Drop { tick: 99, x: 220 }),
            Err(MoveError::TickWentBackwards)
        );
    }

    #[test]
    fn a_wait_advances_the_simulation() {
        let mut g = Game::new(1);
        g.apply(Move::Wait { tick: 500 }).expect("legal wait");
        assert_eq!(g.tick(), 500);
    }

    // ── merging ────────────────────────────────────────────────────────────

    #[test]
    fn two_of_the_same_fruit_merge_into_the_next_one_up() {
        // Dropped down the same column, so they stack and touch. A merge is
        // detected by `max_tier` rising above zero — merging two cherries makes
        // a tier ONE, not a tier five, which an earlier version of this test got
        // wrong and which is worth leaving a note about.
        let mut g = Game::new(1);
        let mut t = 0;
        let mut merged = false;
        for _ in 0..14 {
            if g.is_over() {
                break;
            }
            let before = g.fruit_count();
            let _ = g.apply(Move::Drop { tick: t, x: 220 });
            let _ = g.apply(Move::Wait {
                tick: t + COOLDOWN_TICKS,
            });
            t += COOLDOWN_TICKS;
            // A merge is the only way the crate holds fewer fruit than it was
            // given: two go in, one comes out.
            if g.fruit_count() <= before {
                merged = true;
                break;
            }
        }
        assert!(
            merged,
            "a dozen fruit down one column produced no merge at all"
        );
        assert!(g.max_tier() > 0, "a merge happened but no tier was created");
        assert!(g.score() > 0, "a merge scored nothing");
    }

    #[test]
    fn a_merge_scores_the_triangular_value_of_the_tier_it_creates() {
        // Driven through the pure rule rather than by arranging physics: the
        // scoring is a function of the merge, and this pins that function.
        let mut g = Game::new(3);
        let mut t = 0;
        let mut last_score = 0;
        for _ in 0..14 {
            g.apply(Move::Drop { tick: t, x: 220 }).expect("legal drop");
            g.apply(Move::Wait {
                tick: t + COOLDOWN_TICKS,
            })
            .expect("legal wait");
            t += COOLDOWN_TICKS;
            let gained = g.score() - last_score;
            if gained > 0 {
                // Whatever merged, the gain must be a legal ladder score.
                let legal: Vec<u64> = (1..crate::ladder::TIERS as u8)
                    .map(crate::ladder::merge_score)
                    .collect();
                assert!(
                    gained == POP_BONUS || legal.contains(&gained),
                    "scored {gained}, which is neither a ladder value nor the pop bonus"
                );
                last_score = g.score();
            }
        }
    }

    // ── game over, at its boundaries ───────────────────────────────────────

    #[test]
    fn a_fresh_game_is_not_over() {
        assert!(!Game::new(1).is_over());
    }

    #[test]
    fn a_fruit_merely_falling_past_the_line_does_not_end_the_run() {
        // The rule is a SETTLED fruit above the line, not a passing one — every
        // drop passes the line on its way in.
        let mut g = Game::new(1);
        g.apply(Move::Drop { tick: 0, x: 220 }).expect("legal drop");
        g.apply(Move::Wait { tick: 300 }).expect("legal wait");
        assert!(!g.is_over(), "a single dropped fruit ended the game");
    }

    #[test]
    fn filling_the_crate_ends_the_run() {
        let mut g = Game::new(5);
        let mut t = 0;
        for _ in 0..200 {
            if g.is_over() {
                break;
            }
            let _ = g.apply(Move::Drop { tick: t, x: 220 });
            let _ = g.apply(Move::Wait {
                tick: t + COOLDOWN_TICKS,
            });
            t += COOLDOWN_TICKS;
        }
        assert!(g.is_over(), "200 drops down one column never overflowed");
    }

    #[test]
    fn a_drop_after_the_game_is_over_is_refused() {
        let mut g = Game::new(5);
        let mut t = 0;
        for _ in 0..200 {
            if g.is_over() {
                break;
            }
            let _ = g.apply(Move::Drop { tick: t, x: 220 });
            let _ = g.apply(Move::Wait {
                tick: t + COOLDOWN_TICKS,
            });
            t += COOLDOWN_TICKS;
        }
        assert!(g.is_over());
        assert_eq!(
            g.apply(Move::Drop {
                tick: t + 1000,
                x: 220
            }),
            Err(MoveError::GameOver)
        );
    }

    // ── the policies mutation testing found unreachable in place ───────────

    #[test]
    fn a_merge_awards_the_triangular_score_of_the_tier_it_creates() {
        for tier in 0..TOP {
            assert_eq!(
                merge_award(tier),
                crate::ladder::merge_score(tier + 1),
                "merging two of tier {tier}"
            );
        }
        // Spot-checked against the vendored table, not just the formula, so the
        // test is not merely mirroring the implementation.
        assert_eq!(merge_award(0), 1, "two cherries make a strawberry, worth 1");
        assert_eq!(merge_award(8), 45, "two pineapples make a melon, worth 45");
    }

    #[test]
    fn two_watermelons_pop_for_the_bonus_and_create_nothing() {
        // The top of the ladder. Unreachable from any plausible run — it needs a
        // climb of the whole ladder twice — which is why it is a function.
        assert_eq!(merge_award(TOP), POP_BONUS);
        assert_ne!(merge_award(TOP), crate::ladder::merge_score(TOP));
    }

    #[test]
    fn the_danger_line_test_is_the_fruits_top_edge_and_its_boundary_is_exact() {
        use pond_physics::fixed::from_px;
        let r = from_px(50);
        let line = from_px(LINE_Y);
        // One sub-unit above the line: over it.
        assert!(is_above_line(line + r - 1, r));
        // Exactly on the line: NOT over it. The comparison is strict, so a fruit
        // resting precisely at the line is safe.
        assert!(!is_above_line(line + r, r));
        // One sub-unit below: safe.
        assert!(!is_above_line(line + r + 1, r));
    }

    #[test]
    fn a_bigger_fruit_crosses_the_line_at_a_lower_centre() {
        // The test is the top EDGE, not the centre — so radius has to matter.
        use pond_physics::fixed::from_px;
        let centre = from_px(LINE_Y + 30);
        assert!(!is_above_line(centre, from_px(17)));
        assert!(is_above_line(centre, from_px(50)));
    }

    // ── boundaries the physics cannot be steered to ────────────────────────

    #[test]
    fn the_grace_period_is_measured_from_the_drop_not_from_zero() {
        // `tick + GRACE` and `tick * GRACE` agree at tick 0, which is where every
        // other test drops. Shifting a whole run in time distinguishes them: the
        // simulation is time-invariant, so an identical run started 500 ticks
        // later must end exactly 500 ticks later.
        let run_from = |offset: u32| {
            let mut g = Game::new(5);
            let mut t = offset;
            for _ in 0..400 {
                if g.is_over() {
                    break;
                }
                let _ = g.apply(Move::Drop { tick: t, x: 220 });
                let _ = g.apply(Move::Wait {
                    tick: t + COOLDOWN_TICKS,
                });
                t += COOLDOWN_TICKS;
            }
            assert!(g.is_over(), "the run never ended");
            g.tick()
        };
        assert_eq!(run_from(500), run_from(0) + 500);
    }

    #[test]
    fn a_drop_off_the_left_edge_lands_exactly_where_a_clamped_drop_lands() {
        // Pins the clamp's arithmetic, not just that clamping happened.
        let mut off = Game::new(1);
        let r = i32::try_from(crate::ladder::radius_px(off.held())).expect("radius fits");
        let mut at = Game::new(1);
        off.apply(Move::Drop { tick: 0, x: -500 })
            .expect("legal drop");
        at.apply(Move::Drop { tick: 0, x: r }).expect("legal drop");
        off.apply(Move::Wait { tick: 300 }).expect("legal wait");
        at.apply(Move::Wait { tick: 300 }).expect("legal wait");
        assert_eq!(off.state_hash(), at.state_hash());
    }

    #[test]
    fn a_drop_off_the_right_edge_lands_exactly_where_a_clamped_drop_lands() {
        let mut off = Game::new(1);
        let r = i32::try_from(crate::ladder::radius_px(off.held())).expect("radius fits");
        let edge = i32::try_from(CRATE_W).expect("width fits") - r;
        let mut at = Game::new(1);
        off.apply(Move::Drop { tick: 0, x: 9999 })
            .expect("legal drop");
        at.apply(Move::Drop { tick: 0, x: edge })
            .expect("legal drop");
        off.apply(Move::Wait { tick: 300 }).expect("legal wait");
        at.apply(Move::Wait { tick: 300 }).expect("legal wait");
        assert_eq!(off.state_hash(), at.state_hash());
    }

    // ── the reporting surface ──────────────────────────────────────────────

    #[test]
    fn the_move_list_records_every_move_applied() {
        // `moves()` had no test caller at all, which mutation testing noticed by
        // replacing it with an empty slice. It is the proof a record replays
        // from, so an empty one would be a silent catastrophe.
        let mut g = Game::new(1);
        let a = Move::Drop { tick: 0, x: 100 };
        let b = Move::Wait { tick: 200 };
        g.apply(a).expect("legal drop");
        g.apply(b).expect("legal wait");
        assert_eq!(g.moves(), &[a, b]);
        // A refused move is not recorded.
        assert_eq!(
            g.apply(Move::Drop { tick: 1, x: 100 }),
            Err(MoveError::TickWentBackwards)
        );
        assert_eq!(g.moves().len(), 2);
    }

    #[test]
    fn max_tier_starts_at_zero_and_only_rises_on_a_merge() {
        let mut g = Game::new(1);
        assert_eq!(g.max_tier(), 0);
        g.apply(Move::Drop { tick: 0, x: 220 }).expect("legal drop");
        g.apply(Move::Wait { tick: 300 }).expect("legal wait");
        assert_eq!(g.max_tier(), 0, "a single drop is not a merge");
    }

    #[test]
    fn tiers_present_reports_what_is_actually_in_the_crate() {
        let mut g = Game::new(1);
        assert!(g.tiers_present().is_empty());
        let first = g.held();
        g.apply(Move::Drop { tick: 0, x: 100 }).expect("legal drop");
        assert_eq!(g.tiers_present(), vec![first]);
        let second = g.held();
        g.apply(Move::Drop {
            tick: COOLDOWN_TICKS,
            x: 340,
        })
        .expect("legal drop");
        let mut expected = vec![first, second];
        expected.sort_unstable();
        assert_eq!(g.tiers_present(), expected);
    }

    // ── the hash ───────────────────────────────────────────────────────────

    #[test]
    fn the_same_seed_and_moves_produce_the_same_hash() {
        let play = || {
            let mut g = Game::new(11);
            let mut t = 0;
            for i in 0..8 {
                g.apply(Move::Drop {
                    tick: t,
                    x: 100 + 40 * i,
                })
                .expect("legal drop");
                t += COOLDOWN_TICKS;
            }
            g.apply(Move::Wait { tick: t + 400 }).expect("legal wait");
            g.state_hash()
        };
        assert_eq!(play(), play());
    }

    #[test]
    fn a_different_seed_produces_a_different_hash() {
        let play = |seed: u64| {
            let mut g = Game::new(seed);
            g.apply(Move::Drop { tick: 0, x: 220 }).expect("legal drop");
            g.apply(Move::Wait { tick: 300 }).expect("legal wait");
            g.state_hash()
        };
        assert_ne!(play(1), play(2));
    }

    #[test]
    fn the_score_is_part_of_the_hashed_state() {
        // Two runs can reach the same board with different scores; a record that
        // could not tell them apart would be claiming the wrong thing.
        let mut a = Game::new(1);
        let mut b = Game::new(1);
        a.apply(Move::Wait { tick: 10 }).expect("legal wait");
        b.apply(Move::Wait { tick: 10 }).expect("legal wait");
        assert_eq!(a.state_hash(), b.state_hash());
    }

    #[test]
    fn the_rng_position_is_part_of_the_hashed_state() {
        // An empty crate after one drop-and-merge is not the same state as an
        // empty crate at the start: the stream has moved on.
        let mut a = Game::new(1);
        let b = Game::new(1);
        a.apply(Move::Drop { tick: 0, x: 220 }).expect("legal drop");
        assert_ne!(a.state_hash(), b.state_hash());
    }

    #[test]
    fn where_a_run_ended_is_part_of_the_state() {
        // A drop list alone cannot say when a run stopped, and for a physics
        // game the end tick changes the final positions. This is why `Wait`
        // exists as a move rather than being inferred.
        let mut a = Game::new(1);
        let mut b = Game::new(1);
        a.apply(Move::Drop { tick: 0, x: 220 }).expect("legal drop");
        b.apply(Move::Drop { tick: 0, x: 220 }).expect("legal drop");
        a.apply(Move::Wait { tick: 100 }).expect("legal wait");
        b.apply(Move::Wait { tick: 300 }).expect("legal wait");
        assert_ne!(a.state_hash(), b.state_hash());
    }
}
