//! Canonical state hash — the anchor a replay is checked against.
//!
//! Lowercase-hex SHA-256 over a domain tag, the tick, the body count, then each
//! body **in id order**: id, position, velocity, angle, angular velocity and
//! radius. Every integer is little-endian, so the hash is byte-identical on
//! native and `wasm32`.
//!
//! **Id order, not insertion order.** Two worlds holding the same bodies are the
//! same world however they were built, and the solver already guarantees that;
//! hashing by insertion would quietly disagree with it.
//!
//! **Angle is hashed even though the solver never reads it.** It is
//! presentational to the *game* — no rule depends on it — but it accumulates
//! from `ang_vel`, which the solver very much does read. Hashing it makes the
//! cross-build check sensitive to a divergence in the angular path that would
//! otherwise be invisible until someone noticed the fruit spinning differently.
//!
//! Walls are not hashed: they are fixed for the life of a world and hashing them
//! would only re-lock every vector the first time a wall moves a pixel.

use sha2::{Digest, Sha256};

use crate::world::World;

/// The lowercase-hex SHA-256 of `world`'s canonical encoding.
///
/// # Panics
/// Cannot panic in practice: the ids are collected from `world` immediately
/// before they are looked up in it, and nothing mutates in between. The
/// `expect` is there because the lookup is fallible by type, not by situation.
#[must_use]
pub fn state_hash(world: &World) -> String {
    let mut h = Sha256::new();
    h.update(b"pond-physics\x00");
    h.update(world.tick().to_le_bytes());

    let mut ids: Vec<_> = world.bodies().map(crate::body::Body::id).collect();
    ids.sort_unstable();
    h.update((ids.len() as u32).to_le_bytes());

    for id in ids {
        let b = world.body(id).expect("id came from this world");
        h.update(id.0.to_le_bytes());
        for v in [
            b.pos.x,
            b.pos.y,
            b.vel.x,
            b.vel.y,
            b.ang,
            b.ang_vel,
            b.radius(),
        ] {
            h.update(v.to_le_bytes());
        }
    }
    hex::encode(h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::body::{Body, BodyId, Wall};
    use crate::fixed::{from_px, from_ratio, Fx, V2};
    use crate::world::{Config, World};

    const DENSITY: Fx = from_ratio(12, 10_000);
    const CFG: Config = Config {
        gravity: from_px(1000),
        iterations: 24,
        restitution: from_ratio(12, 100),
        friction: from_ratio(35, 100),
        baumgarte: from_ratio(20, 100),
        slop: from_ratio(1, 2),
        rest_threshold: from_px(30),
    };

    fn world_with(ids: &[u32]) -> World {
        let mut w = World::new(CFG);
        let (cw, ch, t) = (from_px(440), from_px(640), from_px(200));
        w.add_wall(Wall::new(
            BodyId(0),
            V2::new(-t, ch),
            V2::new(cw + t, ch + t),
        ));
        for (n, &id) in ids.iter().enumerate() {
            w.add_body(Body::circle(
                BodyId(id),
                V2::new(from_px(120 + 60 * n as i64), from_px(300)),
                from_px(33),
                DENSITY,
            ));
        }
        w
    }

    #[test]
    fn a_hash_is_sixty_four_lowercase_hex_characters() {
        let h = state_hash(&world_with(&[1, 2]));
        assert_eq!(h.len(), 64);
        assert!(h
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn the_same_world_hashes_the_same_twice() {
        // Rules out the boring failure: global state or unstable iteration order
        // masquerading as a result.
        let w = world_with(&[1, 2, 3]);
        assert_eq!(state_hash(&w), state_hash(&w));
    }

    #[test]
    fn stepping_changes_the_hash() {
        // A hash that cannot see the simulation advance is not measuring it.
        let mut w = world_with(&[1, 2]);
        let before = state_hash(&w);
        w.step();
        assert_ne!(state_hash(&w), before);
    }

    #[test]
    fn one_sub_unit_of_position_changes_the_hash() {
        // The smallest representable difference must be visible, or a replay
        // could drift without the cross-build check noticing.
        let mut a = World::new(CFG);
        a.add_body(Body::circle(
            BodyId(1),
            V2::new(from_px(100), from_px(100)),
            from_px(33),
            DENSITY,
        ));
        let mut b = World::new(CFG);
        b.add_body(Body::circle(
            BodyId(1),
            V2::new(from_px(100) + 1, from_px(100)),
            from_px(33),
            DENSITY,
        ));
        assert_ne!(state_hash(&a), state_hash(&b));
    }

    #[test]
    fn insertion_order_does_not_change_the_hash() {
        // Bodies hash in id order. Two worlds holding the same bodies are the
        // same world, however they were built — the same property the solver
        // holds, asserted at the hash so a replay cannot disagree about it.
        let mut a = world_with(&[]);
        let mut b = world_with(&[]);
        let make = |id: u32, x: i64| {
            Body::circle(
                BodyId(id),
                V2::new(from_px(x), from_px(300)),
                from_px(33),
                DENSITY,
            )
        };
        a.add_body(make(7, 120));
        a.add_body(make(3, 240));
        b.add_body(make(3, 240));
        b.add_body(make(7, 120));
        assert_eq!(state_hash(&a), state_hash(&b));
    }

    #[test]
    fn a_body_id_is_part_of_the_state() {
        // Two identical circles at identical places, differing only in id, are
        // different worlds — Phase 2's merges depend on identity surviving.
        let a = world_with(&[1]);
        let b = world_with(&[2]);
        assert_ne!(state_hash(&a), state_hash(&b));
    }

    #[test]
    fn removing_a_body_changes_the_hash() {
        let mut w = world_with(&[1, 2]);
        let before = state_hash(&w);
        assert!(w.remove_body(BodyId(2)));
        assert_ne!(state_hash(&w), before);
    }

    #[test]
    fn the_tick_count_is_part_of_the_state() {
        // Two worlds whose bodies happen to coincide are not the same state if
        // they are at different times — a settled pile is otherwise identical
        // tick after tick, and a replay must still know where it is.
        let mut a = world_with(&[1]);
        let mut b = world_with(&[1]);
        a.step();
        b.step();
        assert_eq!(state_hash(&a), state_hash(&b));
        b.step();
        assert_ne!(state_hash(&a), state_hash(&b));
    }

    #[test]
    fn an_empty_world_still_hashes() {
        let h = state_hash(&World::new(CFG));
        assert_eq!(h.len(), 64);
    }
}
