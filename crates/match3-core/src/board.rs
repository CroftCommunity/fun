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

/// Row-major grid. `row = 0` is the top; gravity pulls toward larger `row`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Board {
    pub width: usize,
    pub height: usize,
    cells: Vec<Cell>,
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
        Ok(Self {
            width,
            height,
            cells,
        })
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
