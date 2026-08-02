//! The Blockdoku shape catalog and its value model.
//!
//! Shapes are **generated data** extracted verbatim from the original AGPL source
//! (`tools/extract-blockdoku-shapes.mjs` → [`crate::shapes_gen`]); this module
//! defines the types that catalog is expressed in, plus normalized lookups. Never
//! hand-edit `shapes_gen.rs`.
//!
//! There are three tiers ([`Tier`]): **standard** (the 8 base polyominoes, always
//! dealable), **wild** (38 exotic geometries — pure shapes, no special mechanic),
//! and **magic** (7 special-mechanic blocks — line-clear / bomb / lightning /
//! ghost). Colours from the original are cosmetic and intentionally omitted: they
//! never touch the determinism-critical path.

use serde::{Deserialize, Serialize};

use crate::shapes_gen::CATALOG;

/// Which pool a shape belongs to.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum Tier {
    /// The 8 base polyominoes, always available.
    Standard,
    /// Exotic geometries (opt-in), no special mechanic.
    Wild,
    /// Special-mechanic blocks (opt-in): line-clear / bomb / lightning / ghost.
    Magic,
}

/// A catalog entry: the static definition of one shape.
///
/// `cells` is a rectangular bit-matrix (rows of `0`/`1`), row-major, exactly as in
/// the original — `cells[r][c] == 1` means the shape occupies that offset.
#[derive(Clone, Copy, Debug)]
pub struct ShapeDef {
    /// Stable key (e.g. `"single"`, `"pentominoF"`), matching the original.
    pub key: &'static str,
    /// Human-readable name (e.g. `"F-Pentomino"`).
    pub name: &'static str,
    /// The pool this shape belongs to.
    pub tier: Tier,
    /// Placement points awarded for placing this shape (the shape's own value).
    pub points: u32,
    /// The special mechanic key for a magic block (`None` for standard/wild).
    pub magic_type: Option<&'static str>,
    /// The occupancy matrix, row-major.
    pub cells: &'static [&'static [u8]],
}

impl ShapeDef {
    /// Number of rows in the bounding box.
    #[must_use]
    pub fn rows(&self) -> usize {
        self.cells.len()
    }

    /// Number of columns in the bounding box.
    #[must_use]
    pub fn cols(&self) -> usize {
        self.cells.first().map_or(0, |r| r.len())
    }

    /// The larger bounding-box dimension — the value the size-range filter uses.
    #[must_use]
    pub fn max_dimension(&self) -> usize {
        self.rows().max(self.cols())
    }

    /// The filled offsets `(dr, dc)` of this shape, row-major.
    #[must_use]
    pub fn filled_offsets(&self) -> Vec<(usize, usize)> {
        let mut out = Vec::new();
        for (r, row) in self.cells.iter().enumerate() {
            for (c, &v) in row.iter().enumerate() {
                if v == 1 {
                    out.push((r, c));
                }
            }
        }
        out
    }

    /// The number of filled cells (its "weight").
    #[must_use]
    pub fn cell_count(&self) -> usize {
        self.filled_offsets().len()
    }
}

/// The full catalog, in source order.
#[must_use]
pub fn catalog() -> &'static [ShapeDef] {
    CATALOG
}

/// Look up a shape by its stable key.
#[must_use]
pub fn by_key(key: &str) -> Option<&'static ShapeDef> {
    CATALOG.iter().find(|s| s.key == key)
}

/// Keys of every shape in a given tier, in source order.
#[must_use]
pub fn keys_in_tier(tier: Tier) -> Vec<&'static str> {
    CATALOG
        .iter()
        .filter(|s| s.tier == tier)
        .map(|s| s.key)
        .collect()
}
