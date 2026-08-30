//! Rules tests — the tile set, the match predicate, the layouts, and the FREE
//! predicate — through the crate's public API. RED before the engine exists.

use mahjong_core::{
    layout, matches, pairs, Board, Face, Kind, LayoutId, Slot, FACE_COUNT, TILE_COUNT,
};

// ---------- tiles ----------

#[test]
fn the_set_is_144_tiles_over_42_faces() {
    assert_eq!(FACE_COUNT, 42);
    assert_eq!(TILE_COUNT, 144);
    let ps = pairs();
    assert_eq!(ps.len(), 72, "72 matchable pairs make 144 tiles");
    let mut copies = [0u32; 42];
    for [a, b] in &ps {
        copies[a.0 as usize] += 1;
        copies[b.0 as usize] += 1;
    }
    for f in 0..34u8 {
        assert_eq!(
            copies[f as usize], 4,
            "suit/honour face {f} has four copies"
        );
    }
    for f in 34..42u8 {
        assert_eq!(copies[f as usize], 1, "bonus face {f} is unique");
    }
}

#[test]
fn faces_decode_to_kind_and_rank() {
    assert_eq!(Face(0).kind(), Kind::Dots);
    assert_eq!(Face(0).rank(), 1);
    assert_eq!(Face(8).rank(), 9);
    assert_eq!(Face(9).kind(), Kind::Bamboo);
    assert_eq!(Face(18).kind(), Kind::Characters);
    assert_eq!(Face(26).rank(), 9);
    assert_eq!(Face(27).kind(), Kind::Wind);
    assert_eq!(Face(30).rank(), 4);
    assert_eq!(Face(31).kind(), Kind::Dragon);
    assert_eq!(Face(33).rank(), 3);
    assert_eq!(Face(34).kind(), Kind::Flower);
    assert_eq!(Face(37).rank(), 4);
    assert_eq!(Face(38).kind(), Kind::Season);
    assert_eq!(Face(41).rank(), 4);
}

#[test]
fn matching_is_identity_except_the_two_wild_classes() {
    assert!(matches(Face(4), Face(4)), "5 dots matches 5 dots");
    assert!(
        !matches(Face(4), Face(13)),
        "5 dots does not match 5 bamboo"
    );
    assert!(!matches(Face(27), Face(28)), "east does not match south");
    assert!(matches(Face(34), Face(37)), "any flower matches any flower");
    assert!(matches(Face(38), Face(41)), "any season matches any season");
    assert!(
        !matches(Face(34), Face(38)),
        "a flower never matches a season"
    );
}

// ---------- layouts ----------

fn overlaps(a: Slot, b: Slot) -> bool {
    a.x < b.x + 2 && b.x < a.x + 2 && a.y < b.y + 2 && b.y < a.y + 2
}

#[test]
fn every_layout_is_even_supported_and_overlap_free() {
    for (id, count) in [
        (LayoutId::Pond, 36),
        (LayoutId::Bridge, 60),
        (LayoutId::Fortress, 88),
        (LayoutId::Steps, 112),
        (LayoutId::Turtle, 144),
    ] {
        let l = layout(id);
        assert_eq!(l.slots.len(), count, "{id:?} tile count");
        assert_eq!(count % 2, 0);
        for (i, a) in l.slots.iter().enumerate() {
            assert!(
                a.x + 2 <= l.width && a.y + 2 <= l.height,
                "{id:?} slot {i} inside the grid"
            );
            for (j, b) in l.slots.iter().enumerate() {
                if i != j && a.z == b.z {
                    assert!(
                        !overlaps(*a, *b),
                        "{id:?}: slots {i} and {j} overlap on layer {}",
                        a.z
                    );
                }
            }
            if a.z > 0 {
                let supported = l.slots.iter().any(|b| b.z + 1 == a.z && overlaps(*a, *b));
                assert!(supported, "{id:?}: slot {i} at z={} floats", a.z);
            }
        }
        // Canonical order: by layer, then row, then column — so slot ids are stable.
        let mut sorted = l.slots.clone();
        sorted.sort_by_key(|s| (s.z, s.y, s.x));
        assert_eq!(sorted, l.slots, "{id:?} slots are in canonical order");
    }
}

#[test]
fn the_turtle_has_the_standard_five_layers() {
    let l = layout(LayoutId::Turtle);
    let per_layer = |z: u8| l.slots.iter().filter(|s| s.z == z).count();
    assert_eq!(
        [
            per_layer(0),
            per_layer(1),
            per_layer(2),
            per_layer(3),
            per_layer(4)
        ],
        [87, 36, 16, 4, 1]
    );
    assert_eq!((l.width, l.height), (30, 16));
    // The head tile sits half-offset over the 2x2 crown.
    let top = l.slots.iter().find(|s| s.z == 4).unwrap();
    assert_eq!((top.x, top.y), (13, 7));
    // The three side tiles straddle rows 3 and 4.
    let sides: Vec<_> = l
        .slots
        .iter()
        .filter(|s| s.z == 0 && s.y == 7)
        .map(|s| s.x)
        .collect();
    assert_eq!(sides, vec![0, 26, 28]);
}

#[test]
fn layout_ids_round_trip_through_u8() {
    for id in [
        LayoutId::Pond,
        LayoutId::Bridge,
        LayoutId::Fortress,
        LayoutId::Steps,
        LayoutId::Turtle,
    ] {
        assert_eq!(LayoutId::from_u8(id as u8), Some(id));
    }
    assert_eq!(LayoutId::from_u8(5), None);
}

// ---------- the FREE predicate ----------

/// A board over the Turtle with every slot holding face 0, so freedom depends on
/// geometry alone.
fn full_turtle() -> Board {
    let l = layout(LayoutId::Turtle);
    let faces = vec![Face(0); l.slots.len()];
    Board::new(l, faces)
}

fn slot_id(b: &Board, x: u8, y: u8, z: u8) -> usize {
    b.layout()
        .slots
        .iter()
        .position(|s| (s.x, s.y, s.z) == (x, y, z))
        .unwrap_or_else(|| panic!("no slot at ({x},{y},{z})"))
}

#[test]
fn free_needs_nothing_on_top_and_one_open_long_side() {
    let b = full_turtle();
    // Row ends on the bottom layer are free (one side open, nothing above).
    assert!(b.is_free(slot_id(&b, 2, 0, 0)), "left end of the top row");
    assert!(b.is_free(slot_id(&b, 24, 0, 0)), "right end of the top row");
    // A middle tile of a row is touched on both sides.
    assert!(!b.is_free(slot_id(&b, 12, 0, 0)));
    // A bottom-layer tile under the 6x6 block is covered.
    assert!(!b.is_free(slot_id(&b, 8, 2, 0)));
    // The head is free; the crown under it is not.
    assert!(b.is_free(slot_id(&b, 13, 7, 4)));
    assert!(!b.is_free(slot_id(&b, 12, 6, 3)));
    // The half-offset side tiles: the far left one is free, the inner right one
    // (x=26) is touched on both sides (rows 3/4 ends on its left, x=28 on its right).
    assert!(b.is_free(slot_id(&b, 0, 7, 0)));
    assert!(!b.is_free(slot_id(&b, 26, 7, 0)));
    assert!(b.is_free(slot_id(&b, 28, 7, 0)));
    // And the row-3/row-4 ends at x=24 are blocked by that side tile on their right
    // and their neighbour on the left.
    assert!(!b.is_free(slot_id(&b, 24, 6, 0)));
}

#[test]
fn removing_a_tile_frees_its_neighbours_and_covering_counts_partially() {
    let mut b = full_turtle();
    let end = slot_id(&b, 2, 0, 0);
    let next = slot_id(&b, 4, 0, 0);
    assert!(!b.is_free(next));
    b.remove(end).unwrap();
    assert!(
        b.is_free(next),
        "removing the end frees the next tile in the row"
    );
    assert!(!b.is_present(end));
    assert!(!b.is_free(end), "a removed tile is not free");
    // Partial cover: the head at (13,7) covers all four crown tiles even though it
    // overlaps each by only a quarter.
    let crown = slot_id(&b, 14, 8, 3);
    assert!(!b.is_free(crown));
    let head = slot_id(&b, 13, 7, 4);
    b.remove(head).unwrap();
    assert!(
        b.is_free(crown),
        "the crown corner is free once the head is gone"
    );
}

#[test]
fn legal_moves_are_free_matching_pairs_and_only_those() {
    let l = layout(LayoutId::Pond);
    let n = l.slots.len();
    // Alternate two faces so many free pairs exist, plus a flower/season each.
    let mut faces: Vec<Face> = (0..n).map(|i| Face((i % 2) as u8)).collect();
    faces[0] = Face(34);
    faces[1] = Face(37);
    faces[2] = Face(38);
    faces[3] = Face(39);
    let b = Board::new(l, faces);
    for (a, c) in b.legal_moves() {
        assert!(a < c);
        assert!(b.is_free(a) && b.is_free(c));
        assert!(matches(b.face(a), b.face(c)));
    }
    // Every free matching pair appears exactly once.
    let mut expected = 0;
    for a in 0..n {
        for c in a + 1..n {
            if b.is_free(a) && b.is_free(c) && matches(b.face(a), b.face(c)) {
                expected += 1;
            }
        }
    }
    assert_eq!(b.legal_moves().len(), expected);
    assert!(expected > 0);
}
