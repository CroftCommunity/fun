//! The tile set: 42 faces, 144 tiles, and the match predicate.
//!
//! Face ids are dense `u8`s in a fixed order so a board serialises as bytes:
//! dots 1–9 (`0..9`), bamboo 1–9 (`9..18`), characters 1–9 (`18..27`), winds
//! E S W N (`27..31`), dragons red green white (`31..34`), flowers plum orchid
//! chrysanthemum bamboo (`34..38`), seasons spring summer autumn winter (`38..42`).
//! Every suit and honour face has four copies; each bonus face is unique, and the
//! two bonus classes are the only place a match is not an identity.

use serde::{Deserialize, Serialize};

/// A tile face id (`0..FACE_COUNT`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Face(pub u8);

/// The number of distinct faces.
pub const FACE_COUNT: u8 = 42;
/// The number of tiles in a full set.
pub const TILE_COUNT: usize = 144;

/// What a face is — the suit or honour family it belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Kind {
    /// Circles, 1–9.
    Dots,
    /// Bamboo sticks, 1–9.
    Bamboo,
    /// Characters (wan), 1–9.
    Characters,
    /// East, South, West, North.
    Wind,
    /// Red, Green, White.
    Dragon,
    /// Plum, Orchid, Chrysanthemum, Bamboo — a wild class.
    Flower,
    /// Spring, Summer, Autumn, Winter — a wild class.
    Season,
}

impl Face {
    /// The family this face belongs to.
    #[must_use]
    pub fn kind(self) -> Kind {
        match self.0 {
            0..=8 => Kind::Dots,
            9..=17 => Kind::Bamboo,
            18..=26 => Kind::Characters,
            27..=30 => Kind::Wind,
            31..=33 => Kind::Dragon,
            34..=37 => Kind::Flower,
            _ => Kind::Season,
        }
    }

    /// The 1-based rank within the family (1–9 for suits, 1–4 winds/bonus, 1–3 dragons).
    #[must_use]
    pub fn rank(self) -> u8 {
        match self.0 {
            0..=8 => self.0 + 1,
            9..=17 => self.0 - 8,
            18..=26 => self.0 - 17,
            27..=30 => self.0 - 26,
            31..=33 => self.0 - 30,
            34..=37 => self.0 - 33,
            _ => self.0 - 37,
        }
    }

    /// Whether this face belongs to one of the two wild classes.
    #[must_use]
    pub fn is_bonus(self) -> bool {
        self.0 >= 34
    }
}

/// Whether two tiles may be matched: identical faces, or both flowers, or both
/// seasons.
#[must_use]
pub fn matches(a: Face, b: Face) -> bool {
    a == b || (a.is_bonus() && a.kind() == b.kind())
}

/// The 72 matchable pairs of a full set, in canonical order: two pairs of each
/// suit/honour face, then the flowers as two pairs, then the seasons as two.
#[must_use]
pub fn pairs() -> Vec<[Face; 2]> {
    let mut out = Vec::with_capacity(72);
    for f in 0..34u8 {
        out.push([Face(f), Face(f)]);
        out.push([Face(f), Face(f)]);
    }
    out.push([Face(34), Face(35)]);
    out.push([Face(36), Face(37)]);
    out.push([Face(38), Face(39)]);
    out.push([Face(40), Face(41)]);
    out
}

/// Group a multiset of faces into matchable pairs, or `None` when it cannot be
/// paired (an odd count within some class). Used by the shuffle: the tiles
/// still on the board always pair, because every removal took two of a class.
#[must_use]
pub fn pair_up(faces: &[Face]) -> Option<Vec<[Face; 2]>> {
    let mut exact: Vec<Vec<Face>> = vec![Vec::new(); 34];
    let mut flowers = Vec::new();
    let mut seasons = Vec::new();
    for &f in faces {
        match f.kind() {
            Kind::Flower => flowers.push(f),
            Kind::Season => seasons.push(f),
            _ => exact[f.0 as usize].push(f),
        }
    }
    let mut out = Vec::with_capacity(faces.len() / 2);
    for group in exact.into_iter().chain([flowers, seasons]) {
        if group.len() % 2 != 0 {
            return None;
        }
        for pair in group.chunks(2) {
            out.push([pair[0], pair[1]]);
        }
    }
    Some(out)
}
