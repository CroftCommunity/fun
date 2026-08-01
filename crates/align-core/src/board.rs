//! The playfield — 10 wide × 40 tall (20 visible + 20 buffer), `+y` up, row 0 at
//! the bottom (RULES.md "Board"). Cells hold a colour id: `0` empty, else the
//! locked piece's [`crate::piece::PieceKind::color_id`].

/// Board columns.
pub const WIDTH: usize = 10;
/// Total board rows (visible + hidden buffer).
pub const HEIGHT: usize = 40;
/// Visible rows (the bottom of the board).
pub const VISIBLE: usize = 20;

/// A rectangular field of colour ids, row-major with `y` ascending from the
/// bottom (index `y * WIDTH + x`).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Board {
    cells: Vec<u8>,
}

impl Default for Board {
    fn default() -> Self {
        Self::empty()
    }
}

impl Board {
    /// An empty board.
    #[must_use]
    pub fn empty() -> Self {
        Self {
            cells: vec![0; WIDTH * HEIGHT],
        }
    }

    /// Build from stack rows given **bottom-to-top** (row 0 is the bottom). Each
    /// row is `WIDTH` colour ids; unspecified higher rows are empty. For tests
    /// and the pack fixture.
    #[must_use]
    pub fn from_stack_rows(rows: &[&[u8]]) -> Self {
        let mut b = Self::empty();
        for (y, row) in rows.iter().enumerate() {
            for (x, &v) in row.iter().enumerate() {
                if x < WIDTH && y < HEIGHT {
                    b.set(x, y, v);
                }
            }
        }
        b
    }

    /// The colour id at `(x, y)`, or `0` if out of bounds above/below (walls are
    /// handled by [`Board::is_blocked`]).
    #[must_use]
    pub fn get(&self, x: i32, y: i32) -> u8 {
        if x < 0 || x >= WIDTH as i32 || y < 0 || y >= HEIGHT as i32 {
            0
        } else {
            self.cells[y as usize * WIDTH + x as usize]
        }
    }

    /// Set the colour id at `(x, y)` (ignores out-of-bounds).
    pub fn set(&mut self, x: usize, y: usize, v: u8) {
        if x < WIDTH && y < HEIGHT {
            self.cells[y * WIDTH + x] = v;
        }
    }

    /// Whether `(x, y)` blocks a piece cell: outside the walls/floor, above the
    /// ceiling, or an occupied cell. This is the collision primitive.
    #[must_use]
    pub fn is_blocked(&self, x: i32, y: i32) -> bool {
        if x < 0 || x >= WIDTH as i32 || y < 0 || y >= HEIGHT as i32 {
            return true;
        }
        self.cells[y as usize * WIDTH + x as usize] != 0
    }

    /// Whether `(x, y)` counts as a filled corner for T-spin detection: walls and
    /// floor count as filled; the ceiling (above the board) does **not**.
    #[must_use]
    pub fn corner_filled(&self, x: i32, y: i32) -> bool {
        if x < 0 || x >= WIDTH as i32 || y < 0 {
            return true; // wall / floor
        }
        if y >= HEIGHT as i32 {
            return false; // open ceiling
        }
        self.cells[y as usize * WIDTH + x as usize] != 0
    }

    /// Clear every full row and shift the rows above down. Returns the number of
    /// rows cleared (0..=4).
    pub fn clear_full_rows(&mut self) -> usize {
        let mut kept: Vec<u8> = Vec::with_capacity(self.cells.len());
        let mut cleared = 0usize;
        for y in 0..HEIGHT {
            let row = &self.cells[y * WIDTH..(y + 1) * WIDTH];
            if row.iter().all(|&v| v != 0) {
                cleared += 1;
            } else {
                kept.extend_from_slice(row);
            }
        }
        kept.resize(WIDTH * HEIGHT, 0);
        self.cells = kept;
        cleared
    }

    /// Whether the whole board is empty (for perfect-clear detection).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.cells.iter().all(|&v| v == 0)
    }

    /// The highest occupied row index + 1 (`0` if empty) — the stack height.
    #[must_use]
    pub fn stack_height(&self) -> usize {
        for y in (0..HEIGHT).rev() {
            let row = &self.cells[y * WIDTH..(y + 1) * WIDTH];
            if row.iter().any(|&v| v != 0) {
                return y + 1;
            }
        }
        0
    }

    /// Row-major cells (`y` ascending), for the state hash and rendering.
    #[must_use]
    pub fn cells(&self) -> &[u8] {
        &self.cells
    }
}
