//! Board and cell model. Pure data — the logic lives in `engine`.

use thiserror::Error;

/// A single board cell. See RULES.md "Board model".
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Cell {
    /// Transient hole; exists only mid-resolution (between clear and refill).
    Empty,
    /// A movable coloured gem, colour in `0..colors`.
    Gem(u8),
    /// A fixed, non-movable, non-matchable blocker with `layers >= 1` remaining.
    Blocker(u8),
}

impl Cell {
    pub fn is_gem(&self) -> bool {
        matches!(self, Cell::Gem(_))
    }
    pub fn is_blocker(&self) -> bool {
        matches!(self, Cell::Blocker(_))
    }
    pub fn is_empty(&self) -> bool {
        matches!(self, Cell::Empty)
    }
}

/// A special-candy kind carried by a gem via the parallel `special` overlay
/// (Track B0). A special is a `Cell::Gem(color)` marked with one of these — it
/// still matches, swaps, and falls as its colour (the match/legality core never
/// sees the overlay); the marker only governs clear, gravity-carry, hashing,
/// rendering, and (from B1) activation. The 2×2 fish is deferred to B4.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SpecialKind {
    /// From a horizontal line-4 (clears its row when activated — B1).
    StripedH,
    /// From a vertical line-4 (clears its column when activated — B1).
    StripedV,
    /// From an L/T match (3×3 area blast when activated — B2).
    Wrapped,
    /// From a line-5 (clears a whole colour when activated — B3).
    ColorBomb,
}

impl SpecialKind {
    /// The stable hash tag byte (RULES.md "State hash"). `0x00` is reserved for
    /// "no special", so kinds start at `0x01`. These bytes are part of the
    /// verifiable fingerprint — never renumber a shipped value.
    #[must_use]
    pub fn tag(self) -> u8 {
        match self {
            SpecialKind::StripedH => 0x01,
            SpecialKind::StripedV => 0x02,
            SpecialKind::Wrapped => 0x03,
            SpecialKind::ColorBomb => 0x04,
        }
    }

    /// The authoring char for `from_rows_with_specials` / debug grids.
    fn from_char(ch: char) -> Option<Option<SpecialKind>> {
        match ch {
            '.' => Some(None),
            'H' => Some(Some(SpecialKind::StripedH)),
            'V' => Some(Some(SpecialKind::StripedV)),
            'W' => Some(Some(SpecialKind::Wrapped)),
            'C' => Some(Some(SpecialKind::ColorBomb)),
            _ => None,
        }
    }
}

/// Row-major grid. `row = 0` is the top; gravity pulls toward larger `row`.
///
/// `jelly` is a parallel row-major grid of jelly layers per cell (`0` = none),
/// an overlay that sits *under* the gems: it is orthogonal to `cells`, moves
/// with neither gems nor gravity, and is scrubbed one layer when a match clears
/// the cell above it (the clear-the-jelly objective). A gem-only board has an
/// all-zero `jelly` grid and hashes exactly as it did before jelly existed.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Board {
    pub width: usize,
    pub height: usize,
    cells: Vec<Cell>,
    jelly: Vec<u8>,
    /// Parallel row-major special-candy overlay (`None` = a plain gem). Like
    /// `jelly` it is orthogonal to matching/legality, but unlike jelly it moves
    /// *with* its gem under gravity (a special candy falls) — see `engine`. A
    /// board with no specials appends nothing to the hash, so a gem-only board
    /// hashes exactly as it did before the overlay existed.
    special: Vec<Option<SpecialKind>>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum BoardError {
    #[error("cell grid has {got} cells, expected {width}x{height}={want}")]
    ShapeMismatch {
        width: usize,
        height: usize,
        got: usize,
        want: usize,
    },
    #[error("unknown cell char {0:?}")]
    BadChar(char),
    #[error("ragged rows: row {row} has width {got}, expected {width}")]
    Ragged {
        row: usize,
        got: usize,
        width: usize,
    },
}

impl Board {
    pub fn new(width: usize, height: usize, cells: Vec<Cell>) -> Result<Self, BoardError> {
        let want = width * height;
        if cells.len() != want {
            return Err(BoardError::ShapeMismatch {
                width,
                height,
                got: cells.len(),
                want,
            });
        }
        let jelly = vec![0u8; want];
        let special = vec![None; want];
        Ok(Self {
            width,
            height,
            cells,
            jelly,
            special,
        })
    }

    /// The special-candy overlay, row-major (`None` = a plain gem).
    #[must_use]
    pub fn special(&self) -> &[Option<SpecialKind>] {
        &self.special
    }

    /// The special kind on one cell (`None` = a plain gem).
    #[inline]
    #[must_use]
    pub fn special_at(&self, row: usize, col: usize) -> Option<SpecialKind> {
        self.special[self.idx(row, col)]
    }

    /// Set (or clear, with `None`) the special marker on one cell. Invariant:
    /// a marker is only ever set where the cell is a `Gem`, and is cleared when
    /// the cell clears/refills — the overlay never marks a hole or a blocker.
    #[inline]
    pub fn set_special(&mut self, row: usize, col: usize, kind: Option<SpecialKind>) {
        let i = self.idx(row, col);
        self.special[i] = kind;
    }

    /// Jelly layers per cell, row-major (`0` = no jelly).
    #[must_use]
    pub fn jelly(&self) -> &[u8] {
        &self.jelly
    }

    /// Jelly layers remaining on one cell.
    #[inline]
    #[must_use]
    pub fn jelly_at(&self, row: usize, col: usize) -> u8 {
        self.jelly[self.idx(row, col)]
    }

    /// Set the jelly layers on one cell.
    #[inline]
    pub fn set_jelly(&mut self, row: usize, col: usize, layers: u8) {
        let i = self.idx(row, col);
        self.jelly[i] = layers;
    }

    #[inline]
    fn idx(&self, row: usize, col: usize) -> usize {
        row * self.width + col
    }

    #[inline]
    pub fn get(&self, row: usize, col: usize) -> Cell {
        self.cells[self.idx(row, col)]
    }

    #[inline]
    pub fn set(&mut self, row: usize, col: usize, cell: Cell) {
        let i = self.idx(row, col);
        self.cells[i] = cell;
    }

    pub fn cells(&self) -> &[Cell] {
        &self.cells
    }

    /// Parse a char grid. `.` = Empty, `0`-`9` = Gem(digit), `A`-`Z` = Blocker
    /// with layers = (letter - 'A' + 1) so `A` is a 1-layer blocker, `B` two.
    pub fn from_rows(rows: &[&str]) -> Result<Self, BoardError> {
        let height = rows.len();
        let width = rows.first().map(|r| r.chars().count()).unwrap_or(0);
        let mut cells = Vec::with_capacity(width * height);
        for (r, row) in rows.iter().enumerate() {
            let mut n = 0;
            for ch in row.chars() {
                n += 1;
                let cell = match ch {
                    '.' => Cell::Empty,
                    '0'..='9' => Cell::Gem(ch as u8 - b'0'),
                    'A'..='Z' => Cell::Blocker(ch as u8 - b'A' + 1),
                    other => return Err(BoardError::BadChar(other)),
                };
                cells.push(cell);
            }
            if n != width {
                return Err(BoardError::Ragged {
                    row: r,
                    got: n,
                    width,
                });
            }
        }
        Board::new(width, height, cells)
    }

    /// Parse a char grid plus a parallel **jelly** grid (`0`-`9` layers per cell).
    /// The two grids must have the same shape. Used by clear-the-jelly vectors.
    pub fn from_rows_with_jelly(rows: &[&str], jelly_rows: &[&str]) -> Result<Self, BoardError> {
        let mut board = Board::from_rows(rows)?;
        for (r, jrow) in jelly_rows.iter().enumerate() {
            let mut n = 0;
            for (c, ch) in jrow.chars().enumerate() {
                n += 1;
                let layers = match ch {
                    '0'..='9' => ch as u8 - b'0',
                    other => return Err(BoardError::BadChar(other)),
                };
                board.set_jelly(r, c, layers);
            }
            if n != board.width {
                return Err(BoardError::Ragged {
                    row: r,
                    got: n,
                    width: board.width,
                });
            }
        }
        Ok(board)
    }

    /// Parse a char grid plus a parallel **special-overlay** grid
    /// (`.` = plain, `H`/`V` = striped, `W` = wrapped, `C` = colour-bomb). The
    /// two grids must have the same shape. Used by specials golden vectors.
    pub fn from_rows_with_specials(
        rows: &[&str],
        special_rows: &[&str],
    ) -> Result<Self, BoardError> {
        let mut board = Board::from_rows(rows)?;
        for (r, srow) in special_rows.iter().enumerate() {
            let mut n = 0;
            for (c, ch) in srow.chars().enumerate() {
                n += 1;
                let kind = SpecialKind::from_char(ch).ok_or(BoardError::BadChar(ch))?;
                board.set_special(r, c, kind);
            }
            if n != board.width {
                return Err(BoardError::Ragged {
                    row: r,
                    got: n,
                    width: board.width,
                });
            }
        }
        Ok(board)
    }

    /// Inverse of `from_rows`, for readable test failures and vector authoring.
    pub fn to_rows(&self) -> Vec<String> {
        (0..self.height)
            .map(|r| {
                (0..self.width)
                    .map(|c| match self.get(r, c) {
                        Cell::Empty => '.',
                        Cell::Gem(g) => (b'0' + g) as char,
                        Cell::Blocker(l) => (b'A' + l - 1) as char,
                    })
                    .collect()
            })
            .collect()
    }

    pub fn is_settled(&self) -> bool {
        !self.cells.iter().any(|c| c.is_empty())
    }
}
