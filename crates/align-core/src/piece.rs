//! The seven pieces, their four rotation states, spawn positions, and the
//! SRS-compatible wall-kick tables (RULES.md "Pieces" / "Rotation").
//!
//! Coordinates are `(x, y)` with `+x` right and **`+y` up**, matching the kick
//! tables verbatim. A piece has an integer box-origin `(x, y)`; its four cells in
//! rotation state `rot` are `origin + offset` for each offset in [`PieceKind::cells`].
//! The board stores locked cells by colour id (1..=7); `0` is empty.

use serde::{Deserialize, Serialize};

/// One of the seven shapes. The letters are **internal shape identifiers only** —
/// the UI never shows them (IP guardrail). Order fixes the colour id (`index + 1`)
/// and the 7-bag contents.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash, Serialize, Deserialize)]
pub enum PieceKind {
    /// The line piece (violet).
    I,
    /// The square piece (coral).
    O,
    /// The tee piece (teal).
    T,
    /// The S piece (gold).
    S,
    /// The Z piece (sky).
    Z,
    /// The J piece (rose).
    J,
    /// The L piece (green).
    L,
}

/// All seven kinds, in colour-id / bag order.
pub const ALL_KINDS: [PieceKind; 7] = [
    PieceKind::I,
    PieceKind::O,
    PieceKind::T,
    PieceKind::S,
    PieceKind::Z,
    PieceKind::J,
    PieceKind::L,
];

/// A rotation state. `0` spawn, `R` one clockwise, `Two` 180°, `L` one
/// counter-clockwise (the guideline `0/R/2/L`).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum RotState {
    /// Spawn orientation.
    Zero,
    /// One clockwise turn from spawn.
    R,
    /// 180° from spawn.
    Two,
    /// One counter-clockwise turn from spawn.
    L,
}

impl RotState {
    /// Table index `0/1/2/3` for `Zero/R/Two/L`.
    #[must_use]
    pub fn index(self) -> usize {
        match self {
            RotState::Zero => 0,
            RotState::R => 1,
            RotState::Two => 2,
            RotState::L => 3,
        }
    }

    /// The state after a clockwise quarter-turn.
    #[must_use]
    pub fn cw(self) -> Self {
        match self {
            RotState::Zero => RotState::R,
            RotState::R => RotState::Two,
            RotState::Two => RotState::L,
            RotState::L => RotState::Zero,
        }
    }

    /// The state after a counter-clockwise quarter-turn.
    #[must_use]
    pub fn ccw(self) -> Self {
        match self {
            RotState::Zero => RotState::L,
            RotState::L => RotState::Two,
            RotState::Two => RotState::R,
            RotState::R => RotState::Zero,
        }
    }

    /// The state after a half-turn.
    #[must_use]
    pub fn flip(self) -> Self {
        match self {
            RotState::Zero => RotState::Two,
            RotState::R => RotState::L,
            RotState::Two => RotState::Zero,
            RotState::L => RotState::R,
        }
    }
}

impl PieceKind {
    /// The colour id used on the board and in the palette (`1..=7`).
    #[must_use]
    pub fn color_id(self) -> u8 {
        match self {
            PieceKind::I => 1,
            PieceKind::O => 2,
            PieceKind::T => 3,
            PieceKind::S => 4,
            PieceKind::Z => 5,
            PieceKind::J => 6,
            PieceKind::L => 7,
        }
    }

    /// The kind for a board colour id (`1..=7`), or `None` for empty/invalid.
    #[must_use]
    pub fn from_color_id(id: u8) -> Option<Self> {
        match id {
            1 => Some(PieceKind::I),
            2 => Some(PieceKind::O),
            3 => Some(PieceKind::T),
            4 => Some(PieceKind::S),
            5 => Some(PieceKind::Z),
            6 => Some(PieceKind::J),
            7 => Some(PieceKind::L),
            _ => None,
        }
    }

    /// The four cell offsets `(dx, dy)` for this kind in rotation state `rot`,
    /// relative to the piece box-origin (`+y` up). Canonical SRS shapes.
    #[must_use]
    pub fn cells(self, rot: RotState) -> [(i8, i8); 4] {
        CELLS[self.color_id() as usize - 1][rot.index()]
    }

    /// The spawn box-origin `(x, y)` for a fresh piece: horizontal, in the buffer
    /// just above the visible field. I/O centred, others rounded left.
    #[must_use]
    pub fn spawn_origin(self) -> (i32, i32) {
        // Board is 10 wide, 40 tall, y-up; visible rows 0..=19, buffer 20..=39.
        // Spawn so the flat spawn row sits at y=20 (first buffer row, one above
        // the top visible row 19); the piece falls into view.
        match self {
            // 4-wide box (I): cols 3..=6, flat row (box y=2) at y=20 → py=18.
            PieceKind::I => (3, 18),
            // 2-wide box (O): centred cols 4..=5, cells at box y=0,1 → py=20.
            PieceKind::O => (4, 20),
            // 3-wide box (rest): cols 3..=5, flat row (box y=1) at y=20 → py=19.
            _ => (3, 19),
        }
    }
}

/// `CELLS[kind_index][rot_index]` = the four `(dx, dy)` offsets, `+y` up, box
/// bottom-left origin. Kind order I,O,T,S,Z,J,L; rot order Zero,R,Two,L.
const CELLS: [[[(i8, i8); 4]; 4]; 7] = [
    // I (4x4 box)
    [
        [(0, 2), (1, 2), (2, 2), (3, 2)], // 0
        [(2, 3), (2, 2), (2, 1), (2, 0)], // R
        [(0, 1), (1, 1), (2, 1), (3, 1)], // 2
        [(1, 3), (1, 2), (1, 1), (1, 0)], // L
    ],
    // O (2x2 box; rotation is a no-op)
    [
        [(0, 0), (1, 0), (0, 1), (1, 1)],
        [(0, 0), (1, 0), (0, 1), (1, 1)],
        [(0, 0), (1, 0), (0, 1), (1, 1)],
        [(0, 0), (1, 0), (0, 1), (1, 1)],
    ],
    // T (3x3 box)
    [
        [(0, 1), (1, 1), (2, 1), (1, 2)], // 0 (points up)
        [(1, 0), (1, 1), (1, 2), (2, 1)], // R (points right)
        [(0, 1), (1, 1), (2, 1), (1, 0)], // 2 (points down)
        [(1, 0), (1, 1), (1, 2), (0, 1)], // L (points left)
    ],
    // S (3x3 box)
    [
        [(1, 2), (2, 2), (0, 1), (1, 1)], // 0
        [(1, 2), (1, 1), (2, 1), (2, 0)], // R
        [(1, 1), (2, 1), (0, 0), (1, 0)], // 2
        [(0, 2), (0, 1), (1, 1), (1, 0)], // L
    ],
    // Z (3x3 box)
    [
        [(0, 2), (1, 2), (1, 1), (2, 1)], // 0
        [(2, 2), (1, 1), (2, 1), (1, 0)], // R
        [(0, 1), (1, 1), (1, 0), (2, 0)], // 2
        [(1, 2), (0, 1), (1, 1), (0, 0)], // L
    ],
    // J (3x3 box)
    [
        [(0, 2), (0, 1), (1, 1), (2, 1)], // 0
        [(1, 2), (2, 2), (1, 1), (1, 0)], // R
        [(0, 1), (1, 1), (2, 1), (2, 0)], // 2
        [(1, 2), (1, 1), (0, 0), (1, 0)], // L
    ],
    // L (3x3 box)
    [
        [(2, 2), (0, 1), (1, 1), (2, 1)], // 0
        [(1, 2), (1, 1), (1, 0), (2, 0)], // R
        [(0, 1), (1, 1), (2, 1), (0, 0)], // 2
        [(0, 2), (1, 2), (1, 1), (1, 0)], // L
    ],
];

/// A wall-kick offset `(dx, dy)`, `+y` up.
pub type Kick = (i8, i8);

/// The five kick tests for a rotation from `from` to `to`, for the given kind.
///
/// O never kicks (a single no-op test). J/L/S/T/Z share one table; I has its own
/// (both verbatim from the build plan). A 180° turn uses a single no-op test
/// (rotate in place or fail) — the guideline defines no standard 180 kicks.
#[must_use]
pub fn kicks(kind: PieceKind, from: RotState, to: RotState) -> [Kick; 5] {
    if kind == PieceKind::O {
        return [(0, 0); 5];
    }
    // 180° turns: no kicks.
    if to == from.flip() {
        return [(0, 0); 5];
    }
    let key = (from.index(), to.index());
    if kind == PieceKind::I {
        i_kicks(key)
    } else {
        jlstz_kicks(key)
    }
}

fn jlstz_kicks(key: (usize, usize)) -> [Kick; 5] {
    match key {
        (0, 1) => [(0, 0), (-1, 0), (-1, 1), (0, -2), (-1, -2)], // 0->R
        (1, 0) => [(0, 0), (1, 0), (1, -1), (0, 2), (1, 2)],     // R->0
        (1, 2) => [(0, 0), (1, 0), (1, -1), (0, 2), (1, 2)],     // R->2
        (2, 1) => [(0, 0), (-1, 0), (-1, 1), (0, -2), (-1, -2)], // 2->R
        (2, 3) => [(0, 0), (1, 0), (1, 1), (0, -2), (1, -2)],    // 2->L
        (3, 2) => [(0, 0), (-1, 0), (-1, -1), (0, 2), (-1, 2)],  // L->2
        (3, 0) => [(0, 0), (-1, 0), (-1, -1), (0, 2), (-1, 2)],  // L->0
        (0, 3) => [(0, 0), (1, 0), (1, 1), (0, -2), (1, -2)],    // 0->L
        _ => [(0, 0); 5],
    }
}

fn i_kicks(key: (usize, usize)) -> [Kick; 5] {
    match key {
        (0, 1) => [(0, 0), (-2, 0), (1, 0), (-2, -1), (1, 2)], // 0->R
        (1, 0) => [(0, 0), (2, 0), (-1, 0), (2, 1), (-1, -2)], // R->0
        (1, 2) => [(0, 0), (-1, 0), (2, 0), (-1, 2), (2, -1)], // R->2
        (2, 1) => [(0, 0), (1, 0), (-2, 0), (1, -2), (-2, 1)], // 2->R
        (2, 3) => [(0, 0), (2, 0), (-1, 0), (2, 1), (-1, -2)], // 2->L
        (3, 2) => [(0, 0), (-2, 0), (1, 0), (-2, -1), (1, 2)], // L->2
        (3, 0) => [(0, 0), (1, 0), (-2, 0), (1, -2), (-2, 1)], // L->0
        (0, 3) => [(0, 0), (-1, 0), (2, 0), (-1, 2), (2, -1)], // 0->L
        _ => [(0, 0); 5],
    }
}
