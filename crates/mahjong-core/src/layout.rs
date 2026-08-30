//! Layouts — where the tiles sit.
//!
//! Coordinates are **half-tile units**: a tile at `(x, y, z)` occupies
//! `x..x+2 × y..y+2` on layer `z`. Half units are what let a tile straddle two
//! rows (the Turtle's side tiles) or sit over four (its head). Slots are kept in
//! canonical `(z, y, x)` order so a slot id is stable for a layout, and the
//! adjacency every rule needs — what lies on a slot, what touches its long sides,
//! what it rests on — is computed once here.

use serde::{Deserialize, Serialize};

/// One tile position on the half-tile grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Slot {
    /// Left edge, in half tiles.
    pub x: u8,
    /// Top edge, in half tiles.
    pub y: u8,
    /// Layer, `0` = the table.
    pub z: u8,
}

/// The shipped layouts, by ladder position. The `u8` value is what a packed
/// seed carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum LayoutId {
    /// 36 tiles, two layers.
    Pond = 0,
    /// 60 tiles, three layers.
    Bridge = 1,
    /// 88 tiles, three layers.
    Fortress = 2,
    /// 112 tiles, three layers.
    Steps = 3,
    /// The classic 144-tile turtle, five layers.
    Turtle = 4,
}

impl LayoutId {
    /// Every layout, smallest first.
    pub const ALL: [LayoutId; 5] = [
        LayoutId::Pond,
        LayoutId::Bridge,
        LayoutId::Fortress,
        LayoutId::Steps,
        LayoutId::Turtle,
    ];

    /// Decode a packed layout byte.
    #[must_use]
    pub fn from_u8(v: u8) -> Option<Self> {
        Self::ALL.get(v as usize).copied()
    }

    /// The player-facing name.
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            LayoutId::Pond => "Pond",
            LayoutId::Bridge => "Bridge",
            LayoutId::Fortress => "Fortress",
            LayoutId::Steps => "Steps",
            LayoutId::Turtle => "Turtle",
        }
    }
}

/// A layout with its precomputed adjacency.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    /// Which layout this is.
    pub id: LayoutId,
    /// Grid width in half tiles.
    pub width: u8,
    /// Grid height in half tiles.
    pub height: u8,
    /// The slots, in canonical `(z, y, x)` order; the index is the slot id.
    pub slots: Vec<Slot>,
    /// Per slot: the slots one layer up whose footprint overlaps it.
    pub above: Vec<Vec<usize>>,
    /// Per slot: the slots one layer down whose footprint overlaps it.
    pub below: Vec<Vec<usize>>,
    /// Per slot: same-layer slots touching its left side.
    pub left: Vec<Vec<usize>>,
    /// Per slot: same-layer slots touching its right side.
    pub right: Vec<Vec<usize>>,
}

/// Whether two footprints overlap (any shared area, however small).
#[must_use]
pub fn overlaps(a: Slot, b: Slot) -> bool {
    a.x < b.x + 2 && b.x < a.x + 2 && a.y < b.y + 2 && b.y < a.y + 2
}

/// Whether the two share any vertical extent (the rows a side contact needs).
fn rows_touch(a: Slot, b: Slot) -> bool {
    a.y < b.y + 2 && b.y < a.y + 2
}

impl Layout {
    fn build(id: LayoutId, width: u8, height: u8, mut slots: Vec<Slot>) -> Self {
        slots.sort_by_key(|s| (s.z, s.y, s.x));
        let n = slots.len();
        let mut above = vec![Vec::new(); n];
        let mut below = vec![Vec::new(); n];
        let mut left = vec![Vec::new(); n];
        let mut right = vec![Vec::new(); n];
        for i in 0..n {
            for j in 0..n {
                if i == j {
                    continue;
                }
                let (a, b) = (slots[i], slots[j]);
                if b.z == a.z + 1 && overlaps(a, b) {
                    above[i].push(j);
                }
                if a.z == b.z + 1 && overlaps(a, b) {
                    below[i].push(j);
                }
                if a.z == b.z && rows_touch(a, b) {
                    if b.x + 2 == a.x {
                        left[i].push(j);
                    }
                    if a.x + 2 == b.x {
                        right[i].push(j);
                    }
                }
            }
        }
        Self {
            id,
            width,
            height,
            slots,
            above,
            below,
            left,
            right,
        }
    }

    /// The number of slots.
    #[must_use]
    pub fn len(&self) -> usize {
        self.slots.len()
    }

    /// Whether the layout has no slots (never, for a shipped one).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }
}

/// A row of whole tiles on layer `z`, top edge `y`, columns `cols` (whole-tile
/// columns, so `x = 2 * col`).
fn row(out: &mut Vec<Slot>, z: u8, y: u8, cols: std::ops::RangeInclusive<u8>) {
    for c in cols {
        out.push(Slot { x: 2 * c, y, z });
    }
}

/// A rectangular block of whole tiles.
fn block(
    out: &mut Vec<Slot>,
    z: u8,
    rows: std::ops::RangeInclusive<u8>,
    cols: std::ops::RangeInclusive<u8>,
) {
    for r in rows {
        row(out, z, 2 * r, cols.clone());
    }
}

/// Build a layout by id.
#[must_use]
pub fn layout(id: LayoutId) -> Layout {
    let mut s = Vec::new();
    match id {
        // 6 x 5 on the table, a 2 x 3 raft in the middle.
        LayoutId::Pond => {
            block(&mut s, 0, 0..=4, 0..=5);
            block(&mut s, 1, 1..=3, 2..=3);
            Layout::build(id, 12, 10, s)
        }
        // Two long banks joined by a deck, with a cabin on top.
        LayoutId::Bridge => {
            row(&mut s, 0, 0, 0..=9);
            row(&mut s, 0, 2, 1..=8);
            row(&mut s, 0, 4, 1..=8);
            row(&mut s, 0, 6, 0..=9);
            row(&mut s, 1, 0, 2..=7);
            row(&mut s, 1, 2, 3..=6);
            row(&mut s, 1, 4, 3..=6);
            row(&mut s, 1, 6, 2..=7);
            block(&mut s, 2, 1..=2, 4..=5);
            Layout::build(id, 20, 8, s)
        }
        // A wide wall with a keep rising from its centre.
        LayoutId::Fortress => {
            block(&mut s, 0, 0..=4, 0..=11);
            block(&mut s, 1, 0..=3, 3..=8);
            block(&mut s, 2, 1..=2, 5..=6);
            Layout::build(id, 24, 10, s)
        }
        // Three receding terraces.
        LayoutId::Steps => {
            block(&mut s, 0, 0..=5, 0..=11);
            block(&mut s, 1, 1..=4, 2..=9);
            block(&mut s, 2, 2..=3, 4..=7);
            Layout::build(id, 24, 12, s)
        }
        // The classic turtle: 87 / 36 / 16 / 4 / 1.
        LayoutId::Turtle => {
            row(&mut s, 0, 0, 1..=12);
            row(&mut s, 0, 2, 3..=10);
            row(&mut s, 0, 4, 2..=11);
            row(&mut s, 0, 6, 1..=12);
            row(&mut s, 0, 8, 1..=12);
            row(&mut s, 0, 10, 2..=11);
            row(&mut s, 0, 12, 3..=10);
            row(&mut s, 0, 14, 1..=12);
            // The side tiles straddle rows 3 and 4.
            s.push(Slot { x: 0, y: 7, z: 0 });
            s.push(Slot { x: 26, y: 7, z: 0 });
            s.push(Slot { x: 28, y: 7, z: 0 });
            block(&mut s, 1, 1..=6, 4..=9);
            block(&mut s, 2, 2..=5, 5..=8);
            block(&mut s, 3, 3..=4, 6..=7);
            s.push(Slot { x: 13, y: 7, z: 4 });
            Layout::build(id, 30, 16, s)
        }
    }
}
